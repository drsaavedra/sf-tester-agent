#!/usr/bin/env node
'use strict';

// MCP server over sf-tester: browser sessions that outlive a tool call, so a Login As, an open form or an armed
// recorder survives between calls. Results are compact JSON; coded errors come back as tool errors.
const { AsyncLocalStorage } = require('node:async_hooks');
const { isAbsolute, join } = require('node:path');
const { createHash } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const lib = require('.');
const checks = require('./checks');
const { CLASSES, NOT_CAPTURED, ENTRY, PAGE_OPENERS, LOOKS } = require('./tool-limits');

// Sessions by id, each with its browser (s), open form and Apex recorder. A call with no session input uses
// 'default', as before ids existed; sf_start with session "new" opens another, so testers can run in parallel.
const sessions = new Map();
// Checks, the open scenario and the run's errors by session id, apart from the browser entry. sf_end drops one; an idle or
// cap close drops it unless it holds something sf_end hands back (its call count aside), and an abandoned one goes at the idle window.
const ledgers = new Map();
// A session id is known while it has a browser or a ledger; default always is.
const known = (id) => id === 'default' || sessions.has(id) || ledgers.has(id);
const MAX_SESSIONS = Number(process.env.SF_TESTER_MAX_SESSIONS) || 4;
const IDLE_MS = Number(process.env.SF_TESTER_IDLE_MS) || 30 * 60_000;
const CAP_IDLE_MS = Number(process.env.SF_TESTER_CAP_IDLE_MS) || 2 * 60_000;
let minted = 0;
// `state` is the calling tool's session: the wrapper runs each call inside a frame of its own holding that session.
// foundBy stays in the frame, so a cancelled call still running cannot write it into the next call's result.
const current = new AsyncLocalStorage();
const slot = (k) => (k === 'foundBy' || k === 'scoped' ? current.getStore() : current.getStore().entry);
const state = new Proxy({}, { get: (_, k) => slot(k)[k], set: (_, k, v) => { slot(k)[k] = v; return true; } });
const assertPng = (path) => { if (!(isAbsolute(path) && path.endsWith('.png'))) throw new lib.SfUiError('BAD_ARGS', `path must be an absolute .png path, not ${path}`, { path }); };
const server = new McpServer({ name: 'sf-tester', version: require('../package.json').version });

const noSession = (id) => new lib.SfUiError('NO_SESSION', `no open session ${id}: never started, ended, or closed after ${IDLE_MS / 60_000} min idle (${CAP_IDLE_MS / 60_000} min at the session cap); sf_start opens one`, { session: id });
const openNamed = () => [...sessions].filter(([k, v]) => k !== 'default' && v.s).map(([k]) => k);
const need = () => {
  if (!state.s) throw state.id === 'default' ? new lib.SfUiError('NO_SESSION', 'call sf_start first') : noSession(state.id);
  // A person closed the headed window, or Chrome died: the session is gone, not an unexpected error. macOS keeps a
  // headed Chrome running after its last window closes, so the page is closed while the browser stays connected.
  if (state.s.browser?.isConnected?.() === false || state.s.page?.isClosed?.()) {
    const id = state.id;
    // Only the entry this call started on: a restart on the same id must not lose its new browser to a stale call.
    if (sessions.get(id) === current.getStore().entry) close(id).catch((e) => console.error(`sf-tester: closing session ${id} failed: ${e?.message || e}`)); // the ledger stays for sf_end
    throw new lib.SfUiError('NO_SESSION', `the browser of session ${id} was closed (a person closing the window?); sf_start opens a new one`, { session: id });
  }
  return state.s;
};

// No result carries an access token: a frontdoor sid= (Playwright's call log has it) or the session's own token.
// Run before any cut, so a cut cannot leave a prefix of one.
const redact = (text) => {
  const out = text.replace(/sid=[^&"\s\\]+/g, 'sid=<redacted>');
  return [state.s?.accessToken, state.token].filter(Boolean).reduce((o, tok) => o.split(tok).join('<redacted>'), out);
};

const sessionInput = z.string().min(1).optional().describe('the session id sf_start returned; leave out for the one default session');

// Each tool's handler and argument schema by name, so sf_run_route can run tools as steps of one call.
const handlers = new Map();

// A result's image rides beside its JSON as MCP image content, so nothing is written to disk for it.
const IMAGE = Symbol('image');
// A call's milliseconds per stage, for its timings: mark(stage) closes the stage that ran since the last mark.
// performance.now, not Date.now: a clock correction during a call would give a negative or stretched stage.
const stopwatch = () => {
  const ms = {};
  let at = performance.now();
  return { ms, mark: (stage) => { const now = performance.now(); ms[stage] = Math.round(now - at); at = now; } };
};
// A tool's return as its result shows it, so a route's {{stepN.path}} reads the same keys.
function wrap(out) {
  if (out === undefined) return { ok: true };
  // An sf_api answer that is a list, a primitive, null, {} or has its own at arrives whole under result.
  if (out === null || typeof out !== 'object' || Array.isArray(out) || 'at' in out || !Reflect.ownKeys(out).length) out = { result: out };
  return Object.keys(out).length ? out : { ok: true, ...out }; // a result of moments only (a click) is ok too
}
// Holds a click timeout's call log with one blocker (1,625 characters). It keeps the head, so a log whose blocker keeps
// changing can still lose its last line.
const ERROR_CHARS = 2000;
// A raw Playwright TimeoutError (a locator, goto or waitForFunction that ran out) is not sf_wait's own coded TIMEOUT.
const codeOf = (e) => e instanceof lib.SfUiError ? e.code : e.name === 'TimeoutError' ? 'LOCATOR_TIMEOUT' : 'UNEXPECTED';
// A step that succeeded joins its session's steps, so a scenario that passes can be saved as a route. A call the client
// cancelled, one that outlived its scenario's reset, or one on a session with no plan (a CLI replay) adds nothing.
const isEntry = (x) => ENTRY.includes(x.tool) || (PAGE_OPENERS.includes(x.tool) && !!x.args.recordId && x.args.via !== 'api');
// A step given the record the page shows reuses that page; a look (sf_whoami) or an API-only assert never does.
const reuses = (name, args, url) => !!url && lib.nav.isId(args.recordId) && args.via !== 'api' && !LOOKS.includes(name) && lib.nav.showsRecord(url, args.recordId);
const captured = (name, run) => async (args, extra = {}) => {
  const led = ledgers.get(state.id);
  const steps = led?.kinds.size && led.steps;
  const out = await run(args, extra);
  if (led && isEntry({ tool: name, args })) led.readings = []; // a new page: a look at the last one is not one an expect copies
  // A verify verdict that is not green is an answer, not a step: a route replaying it would fail every time. A call with
  // since checked only what a moving git diff picked, so a replay of the whole file is not what went green: not kept.
  if (steps && led.steps === steps && !extra.signal?.aborted && (name !== 'sf_verify_checks' || (out?.verdict === 'green' && args.since === undefined))) {
    const { session, ...own } = args;
    if (name === 'sf_verify_checks') delete own.org; // a route runs it on the route session's org
    // A later step that uses the id is saved as a reference into the result as sf_run_route sees it: an answer with its own at is boxed.
    const shown = wrap(out);
    const [idAt, recordId] = typeof shown.recordId === 'string' ? ['recordId', shown.recordId]
      : typeof shown.result?.recordId === 'string' ? ['result.recordId', shown.result.recordId] : [];
    // A layout check reads px at the size live now, so the step keeps it for the route to set before the check.
    const viewport = checks.LAYOUT.includes(name) && args.expect && state.s ? { ...lib.session.viewportOf(state.s) } : undefined;
    led.steps.push({ tool: name, args: own, ...(idAt && { recordId, idAt }), ...(viewport && { viewport }), ...(led.copies.has(args) && { weak: true }) });
  }
  return out;
};
// A route that fails leaves none of its successful prefix in the scenario's steps: the retry is what the route holds.
const unwound = (run) => async (args, extra) => {
  const led = ledgers.get(state.id);
  const steps = led?.steps;
  const mark = steps?.length;
  try { return await run(args, extra); } catch (e) { if (steps && led.steps === steps) steps.length = mark; throw e; }
};
// A tester must always be able to close its scenario, record the gap that cost it its budget and read the catalogue: these are the
// tools that keep the run's records or need no session, bar sf_verify_checks, which runs a validate and so is counted. ponytail: any other tool called with no session is charged to the default ledger.
const NEVER_COUNTED = ['sf_scenario', 'sf_end', 'sf_record_improvement', 'sf_improvements', 'sf_fix_improvement', 'sf_combinations', 'sf_save_route', 'sf_promote_route'];
// The one read a spent session may still make: the run's records, which step 8 of the agent reads before sf_end.
// ponytail: five reads cover step 8's objects; led.reads counts them, so a restart that lowers the budget cannot hide them. Raise it if a run touches more.
const READS_PAST_BUDGET = 5;
// One call against the session's budget. A ledger with no budget has had no sf_start, so counts nothing.
function charge(led, name, args) {
  if (led?.budget === undefined || NEVER_COUNTED.includes(name)) return;
  // A route is one call plus one per verify step, all charged before any step runs, so a route that does not fit runs nothing.
  const cost = name === 'sf_run_route' ? 1 + args.steps.filter((s) => s.tool === 'sf_verify_checks').length : 1;
  const spent = led.budget && led.calls + cost > led.budget;
  if (spent && !(readsRecords(name, args) && led.reads < READS_PAST_BUDGET)) throw new lib.SfUiError('BUDGET_SPENT', `this session used its budget of ${led.budget} tool calls: end an open scenario with a reason that starts "not tested:", then call sf_end`, { used: led.calls, budget: led.budget });
  if (spent) led.reads += 1; // only a record read gets here once spent
  led.calls += cost;
}
function readsRecords(name, args) {
  if (name !== 'sf_api' || args.as !== 'admin') return false;
  try { const route = lib.api.routeOf(args.path); return route === 'queryAll' || route.startsWith('queryAll/'); } catch { return false; } // as assertRead reads it
}
// Every action, edit and page open starts a new toast window before it runs, even one that then fails, so no toast
// from before it is left to match (2026-11-11). Looks never do. The library arms again once a target is found.
const ARMS = [...CLASSES.uiWrite, 'sf_set_fields', 'sf_edit_inline'];
const arms = (name, args) => ARMS.includes(name) || isEntry({ tool: name, args });
function tool(name, description, shape, handler) {
  const run = async (args, extra) => { if (arms(name, args) && state.s?.page?.context) await lib.act.armToasts(state.s.page); return handler(args, extra); };
  // The checking tools (checks.FAIL) are recorded here, once, so the MCP call and a route step both leave their check.
  const checking = name in checks.FAIL ? checks.recorded(ledgers, () => state.id, name, run) : run;
  const recording = NOT_CAPTURED.includes(name) ? checking : captured(name, checking);
  handlers.set(name, { run: recording, schema: z.object(shape).strict() });
  server.registerTool(name, { description, inputSchema: { session: sessionInput, ...shape } }, (args = {}, extra = {}) => {
    const entry = sessions.get(args.session || 'default') || { id: args.session || 'default' };
    const start = new Date();
    entry.used = start.getTime();
    entry.busy = (entry.busy || 0) + 1; // a call in work: the cap close passes it by (a call stuck past IDLE_MS still goes)
    // Every result and error says when the call ran, in this machine's UTC clock, so a tester times from it.
    // A tool's own moments (clicked, seen, fileSet, done) sit between them.
    const at = (moments) => ({ start: start.toISOString(), ...moments, end: new Date().toISOString() });
    const led = ledgers.get(entry.id); // the one the call started on: a call that outlives sf_end must not reach the next run's
    return current.run({ entry, foundBy: null, scoped: !!args.session }, async () => {
      try {
        charge(led, name, args);
        const out = wrap(await recording(args, extra));
        // A tool that reached a component says how: from the FlexiPage, or inside another component.
        const text = { type: 'text', text: redact(JSON.stringify({ ...out, ...(state.foundBy && { foundBy: state.foundBy }), at: at(out[lib.AT]) })) };
        return { content: out[IMAGE] ? [text, { type: 'image', data: out[IMAGE], mimeType: 'image/png' }] : [text] };
      } catch (e) {
        // A Playwright wait that ran out is still a LOCATOR_TIMEOUT the agent can act on, so it gets the code and the page.
        const message = redact(String(e.message || e)).slice(0, ERROR_CHARS);
        if (led && !extra.signal?.aborted && e.code !== 'BUDGET_SPENT') checks.noteError(led, { tool: name, code: e.code === 'ROUTE_STEP_FAILED' ? e.evidence.code : codeOf(e), message: message.slice(0, 200) });
        const body = e instanceof lib.SfUiError ? { code: e.code, message: e.message, evidence: e.evidence }
          : { code: codeOf(e), message, ...(e.name === 'TimeoutError' && { evidence: { url: state.s ? state.s.page.url() : undefined } }) };
        return { isError: true, content: [{ type: 'text', text: redact(JSON.stringify({ ...body, at: at(e?.[lib.AT]) })) }] };
      } finally {
        entry.busy -= 1;
        entry.used = Date.now(); // idle counts from the end of the last call, not its start
      }
    });
  });
}

// Ends a session and frees its id; a session nobody ended goes once it has been idle IDLE_MS (checked at sf_start).
async function close(id) {
  if (ledgers.has(id)) ledgers.get(id).used = Date.now(); // the browser is lost now: the ledger's idle window starts here
  const { s } = sessions.get(id) || {};
  sessions.delete(id);
  if (s) await lib.session.end(s);
}

// An idle or cap close frees the session's ledger too, unless checks.free keeps it or a same-id sf_start took the id meanwhile.
async function reap(id) {
  await close(id);
  checks.free(ledgers, sessions, id);
}

// The page's app when none was asked for is only information: a failure answers app null and why, never an error.
const appNow = (s, list) => lib.session.currentApp(s, list).then(
  (app) => (app.id ? { app } : { app: null, appReason: 'the page shows no Lightning app' }),
  (e) => ({ app: null, appReason: String(e.message || e).slice(0, 300) }));

const snapshot = async (locator, max = 6000) => lib.act.marked(locator, lib.act.cut(await locator.ariaSnapshot(), max));

tool('sf_improvements', 'Known gaps and workarounds in the sf-tester tools, most seen first, from earlier testing; optionally one area. Fixed ones only with all; skipped counts log lines that did not parse, when any. Needs no session.',
  { area: z.string().optional(), all: z.boolean().optional().describe('include entries already marked fixed') },
  async ({ area, all }) => { const l = lib.improvements.list({ area, all }); return { improvements: l, ...(l.skipped && { skipped: l.skipped }) }; });

tool('sf_combinations', 'UI combinations (a base component in a container: record page tab, sidebar, LightningModal, screen flow...) that already have a checked route: on the sf-tester fixture org, or on your own org when SF_TESTER_COMBINATIONS names your catalogue file. Optionally filtered by component or container (any part, any case). Each gives a user-terms task, the placeholders it needs and a route: fill the {{name}} placeholders and run it with sf_run_route instead of exploring. An entry that has a validity (what the route was saved against: app and page hashes, and the persona it ran as) lists it: pass it to sf_run_route with the id, and log in as a user who matches a persona in it first. With no filter it gives an index: components, each with what the route does and the containers it is tested in (an id is component@container, e.g. slider@record-tab), a legend of those containers, and candidates (routes not yet promoted to tested); pass an id as component for that entry\'s route. An sf_verify_checks step\'s checksFile or project, stored relative to the catalogue\'s folder, comes absolute. Needs no session.',
  { component: z.string().optional().describe('any part of the component, an entry id, or its task or requirement (case, spaces and punctuation aside), so the name of the card or field the requirement names finds its route'), container: z.string().optional() },
  async ({ component, container }) => {
    const list = lib.combinations.list({ component, container });
    // The whole catalogue is too big to read in one result, so no filter gives an index to pick from.
    if (!component && !container) return { ...lib.combinations.index(list), placeholders: lib.combinations.describe(lib.combinations.catalogue().placeholders) };
    return { combinations: list, placeholders: lib.combinations.describe(lib.combinations.catalogue().placeholders) };
  });

const verifyShape = {
  checksFile: z.string().min(1).optional().describe('absolute path to a check file; or give checks'),
  checks: z.array(z.object({}).passthrough()).min(1).optional().describe('the checks themselves, as a check file\'s checks list holds them; needs project'),
  project: z.string().min(1).optional().describe('with checks: absolute path of the folder that holds sfdx-project.json'),
  since: z.string().min(1).optional().describe('a git ref: run only the checks that cover what changed since it, and validate the branch\'s changed rules, fields and classes'),
  only: z.array(z.string().min(1)).min(1).optional().describe('run only the checks with these ids'),
};
tool('sf_verify_checks', 'Check access before the UI, with no browser: runs sf-tester verify, each check as its persona, on a check file kept in the project (checksFile) or on checks you write (checks, with project). A check is { id (no slash), kind, requirement, persona: { profile, permissionSets: [] }, covers: [item keys such as objects/Account/fields/X__c, objects/Account/validationRules/R, layouts/Account-Account Layout, flexipages/P, classes/C, permissionsets/S, lwc/b, flows/F] } plus, by kind: record { object, cases: [{ name, fields: {}, expect: { saves, error } }], one that saves and one that does not, with its error text }; pageRequired { object, field, recordType?, flexiPage?, expect: { required } }; classAccess { class, or covers naming an lwc bundle, expect: { access } }; apex { act: Apex ending in return, cases: [{ name, input?, expect: { returns } or { throws } }], one of each }; flow { flow, covers flows/<flow>, object when a case uses record, cases: two or more [{ name, input?, record?, expect: { returns?, record? } or { throws } }], or none (left out or []) for a flow verify hands off whose file is in the project: a screen flow, one with a later path or a Wait, one triggered only on update or delete, or another process type }; componentVisible { object, flexiPage, app, component or field, action?, recordType?, cases: [{ name, record?, user?, customPermissions?, expect: { visible } }], one shown and one hidden }. A bad one comes back as a BAD_CHECK problem naming what to fix; a problem or line that names --checks, --only or --since means checksFile or checks, only and since. record, apex and flow checks run in one check-only validate, so nothing stays in the org; pageRequired, classAccess and componentVisible read metadata. Returns verdict (green, red, nothing checked when no check passed or failed, or not run: a production org, a bad check, an org it could not read, git diffs past 60 s), exit, verify\'s lines (PASS, FAIL, ERROR, UNCOVERED, NEEDS BROWSER for a case only the page decides) and problems. Needs no session; a session\'s budget counts it, as it runs a validate. As an sf_run_route step it leaves out org and runs on the route session\'s org, takes no since (a call with since is not captured), its paths are absolute, and a verdict other than green fails the step; called by itself, it returns the verdict.',
  { org: z.string().min(1).describe('sf CLI alias or username; a route step leaves it out'), ...verifyShape },
  (args, extra) => require('./access').run(args, { signal: extra.signal }));
// In a route: the route session's org, and a verdict other than green fails the step.
const verifyStep = {
  schema: z.object(verifyShape).omit({ since: true }).strict(),
  run: async (args, { led, ...extra }) => {
    // The ledger the route started on: a route that outlives sf_end must not run on the next run's org.
    if (!led?.org) throw noSession(state.id);
    const out = await handlers.get('sf_verify_checks').run({ ...args, org: led.org }, extra);
    // red is an access regression; not run and nothing checked are a run that checked no access (a bad check, git, the org).
    if (out.verdict !== 'green') throw new lib.SfUiError(out.verdict === 'red' ? 'VERIFY_NOT_GREEN' : 'VERIFY_NOT_RUN', `verdict ${out.verdict}: ${out.lines.find((l) => !l.startsWith('PASS ') && !l.startsWith('time: ')) ?? out.problems?.[0] ?? 'no check passed'}`, out);
    return out;
  },
};

tool('sf_fix_improvement', 'Mark a recorded improvement fixed by a commit, so testing stops working around it. Recording it again reopens it. Needs no session.',
  {
    area: z.string(),
    what: z.string().describe('the entry\'s what, as sf_improvements lists it'),
    fixedBy: z.string().describe('the commit that fixed it'),
  },
  async (entry) => lib.improvements.fix(entry));

tool('sf_record_improvement', 'Record something the sf-tester tools could not do, or did only by a workaround, so the tools improve. A repeat counts up: same area and what, or sameAs naming the listed entry. Needs no session; pass yours so sf_end counts it.',
  {
    area: z.string().describe('the tool area or page part: form, lookup, navigation, modal, upload, actions, flow, search, a component name'),
    kind: z.enum(['missing', 'broken', 'workaround', 'flaky']),
    what: z.string().describe('one sentence: what a user can do that the tools could not'),
    sameAs: z.string().optional().describe('when this repeats a gap sf_improvements already lists, that entry\'s what, so it counts up'),
    tried: z.string().optional().describe('the tool calls tried'),
    evidence: z.string().optional().describe('error code, message, snapshot excerpt'),
    suggestion: z.string().optional().describe('the tool or option that would have done it'),
  },
  async (entry) => {
    const out = lib.improvements.record(entry);
    const led = ledgers.get(state.id);
    if (led) led.recorded += 1;
    return out;
  });

// A mark in the transcript for a person following the run; end also returns the checks its session recorded since start.
// A passing scenario's steps as a candidate route; any refusal, or a throw, comes back as the reason it was not saved.
// An id is on its own when no id character, and no %XX code for one (%30 is 0), comes before or after it.
const NON_ID_CODE = '%(?:[0-2][0-9A-Fa-f]|3[A-Fa-f]|40|5[B-Fb-f]|60|7[B-Fb-f]|[89A-Fa-f][0-9A-Fa-f])';
const ID_CODE = '%(?:3[0-9]|4[1-9A-Fa-f]|5[0-9Aa]|6[1-9A-Fa-f]|7[0-9Aa])';
const idPattern = (id) => new RegExp(`(?:(?<![A-Za-z0-9])|(?<=${NON_ID_CODE}))${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9]|${ID_CODE})`, 'g');
async function saveRun(led, title, steps, weak) {
  const no = (reason, more) => ({ saved: false, reason, ...more });
  // replay runs only tested routes, so a candidate is promoted first.
  const sq = (text) => `'${text.replace(/'/g, `'\\''`)}'`; // single-quoted for a shell, an apostrophe closed and escaped
  const replay = (id, file) => `node ${sq(join(__dirname, 'cli.js'))} replay --catalogue ${sq(file)} --org ${sq(led.org)} --only '^${id}$'`;
  try {
    if (led.saveRoutes === false) return no('SAVE_ROUTES_OFF'); // sf_start's saveRoutes, off by default on production
    if (!steps.length) return no('NO_STEPS');
    const checked = (list) => list.some((x) => !x.weak && x.tool in checks.FAIL && (!checks.NEEDS_EXPECT.includes(x.tool) || x.args.expect) && !(x.tool === 'sf_list' && checks.LIST_UNCHECKED.includes(x.args.action)));
    // A negative scenario's step that fails on purpose is never captured, so its route would pass what it should refuse.
    if (led.kinds.get(title) === 'negative') return no('NEGATIVE');
    // weak: no check ran in this scenario; a check that ran but was never captured (a trimmed route) leaves none in steps.
    if (weak || !checked(steps)) return no('NO_CHECK');
    // A look before the scenario opens its page (errors, toasts, whoami) is not replayed, except an sf_api whose id a kept later
    // step uses (no page read, so it replays alone; a snapshot's id came from an earlier page). Walked from the page back, so a
    // chain of ids keeps every link.
    // A verify call needs no page, so one before the page opens is kept where it ran and is no entry.
    const cut = steps.findIndex((x) => !LOOKS.includes(x.tool) && x.tool !== 'sf_verify_checks');
    const at = cut < 0 ? steps.length : cut;
    const rest = steps.slice(at);
    const strings = (args) => { const out = []; JSON.stringify(args, (_, v) => (typeof v === 'string' && out.push(v), v)); return out; };
    const later = rest.map((y) => strings(y.args));
    // The first sf_api that returned each id is the one the swap points at, so a later read of the same id would replay for nothing.
    const first = new Map();
    steps.slice(0, at).forEach((y, k) => { if (y.tool === 'sf_api' && y.recordId && !first.has(y.recordId)) first.set(y.recordId, k); });
    const lead = [];
    const verified = new Set(); // a retried verify keeps its last run only, so a replay runs each validate once
    for (let i = at - 1; i >= 0; i -= 1) {
      const x = steps[i];
      if (x.tool === 'sf_verify_checks') {
        const key = JSON.stringify(x.args);
        if (verified.has(key)) continue;
        verified.add(key);
      } else {
        if (first.get(x.recordId) !== i) continue;
        const re = new RegExp(idPattern(x.recordId).source); // no g, so test keeps no lastIndex
        if (!later.some((list) => list.some((v) => re.test(v)))) continue;
      }
      lead.unshift(x);
      later.push(strings(x.args));
    }
    // A route must open its own page to replay alone: the first step that is not a look opens it.
    if (!rest[0] || !isEntry(rest[0])) return no('NO_ENTRY');
    // The route's own check comes after its page opens.
    if (!checked(rest)) return no('NO_CHECK');
    // A layout check reads px: unless a step of the route sets the viewport before it, the route sets the size the first check ran at
    // (no browser is read at save time) after its page opens.
    const gauge = rest.findIndex((x) => checks.LAYOUT.includes(x.tool) && x.args.expect);
    const sized = gauge < 0 || rest.slice(0, gauge).some((x) => x.tool === 'sf_viewport') ? rest : [rest[0], { tool: 'sf_viewport', args: { ...(rest[gauge].viewport ?? lib.session.VIEWPORT) } }, ...rest.slice(1)];
    steps = [...lead, ...sized];
    // An id an earlier step returned is that run's record: the route reads it from the step again, as sf_run_route resolves.
    // Swapped inside each string value, so a JSON escape such as the n of a newline is not read as an id character.
    const ids = []; // each earlier step's id, as its pattern (built once) and the reference that replaces it
    const route = steps.map(({ tool, args, recordId, idAt }, j) => {
      const refer = (v) => (typeof v === 'string' ? ids.reduce((text, [re, ref]) => text.replace(re, () => ref), v) : v);
      const step = { tool, args: JSON.parse(JSON.stringify(args, (_, v) => refer(v))) };
      if (recordId) ids.push([idPattern(recordId), `{{step${j}.${idAt}}}`]);
      return step;
    });
    try { planRoute(route); } catch (e) { return no('BAD_ARGS', { message: e.message }); }
    lib.combinations.own(process.env.SF_TESTER_COMBINATIONS); // NO_CATALOGUE before any org read
    const own = (await lib.validity.read(state.s)) || {};
    const persona = own.persona ?? await lib.validity.personaOf(state.s); // the read already names a logged-in user
    // Every id carries a short hash of the title: two titles that slug alike, or not at all, keep ids of their own. A remap
    // also hashes the route it replaces, its steps, app and page, not the persona's set hashes, which a timeout can drop:
    // its Draft never takes the stale route's id, a different remap waits beside it, the same remap twice is DUPLICATE_ID.
    const replaces = led.plan?.[title]?.replaces;
    const validity = persona ? { ...own, persona } : Object.keys(own).length ? own : undefined;
    const slug = `${lib.combinations.slug(title) || 'scenario'}-${createHash('sha1').update(replaces ? `${title}\0${replaces}\0${JSON.stringify([route, validity?.app, validity?.page])}` : title).digest('hex').slice(0, 6)}`;
    const { saved, file } = lib.combinations.save({
      id: `${slug}@scenario`, component: slug, container: 'scenario', interaction: 'as the scenario ran', task: title,
      requirement: led.plan?.[title]?.requirement ?? title, ...(replaces && { replaces }), ...(!led.noApp && { app: led.app ?? state.s?.app?.developerName }), route, validity,
    }, { promoted: false });
    return { saved: true, id: saved.id, file, replay: replay(saved.id, file) };
  } catch (e) {
    const code = e.code ?? 'UNEXPECTED';
    // Only a bug in saving is not an SfUiError: sf_end lists it with the run's tool errors.
    if (!(e instanceof lib.SfUiError)) checks.noteError(led, { tool: 'sf_scenario', code, message: e.message });
    return no(code, { message: e.message, ...(code === 'DUPLICATE_ID' && { id: e.evidence.id, replay: replay(e.evidence.id, e.evidence.file) }) });
  }
}

tool('sf_scenario', 'Mark the scenarios you test the requirements with, so the transcript shows each one under its requirement and `end` can judge it. plan lists them before the first step, each with its requirement, its source (requirement, brief or org rule) and a technique where one applies. start names the one you begin; end with result closes one: PASS or FAIL, with reason on a FAIL. One call can end one scenario and start the next; start a scenario before ending it, and one call with the same start and end does both. end returns checks, the typed records its session made since start; verdict, PASS or FAIL by code (on a positive scenario any check whose last record failed makes it FAIL whatever result says; a negative keeps result); overruled: true when verdict differs from result; unplanned: true when no plan on this session named the scenario, so it was judged as positive; and weak: true on a PASS whose checks are all missing or marked weak (a layout check whose expect copied a px number from an earlier reading of the same aim carries weak: true and a reason, and counts as no check). On a session that sent a plan (steps are captured only after one, else end gives NO_STEPS), a PASS verdict whose steps open a page and then hold a check also saves them as a candidate route in the SF_TESTER_COMBINATIONS catalogue (looks before the page opens are left out, except the first sf_api that returned an id a later step uses; an sf_verify_checks call with a green verdict and no since is kept where it ran, before the page opens too (there, a call repeated with the same arguments once, the last), with no org and its checksFile or project stored relative to the catalogue\'s folder; a route needs a check that is not marked weak after its page opens). A route that holds an sf_measure or sf_on_top with expect also gets an sf_viewport step you never ran, at the size live when its first such check ran. End returns route, { saved: true, id, file, replay } with replay the command that runs it once sf_promote_route has made it tested, or { saved: false, reason } (NO_CATALOGUE, DUPLICATE_ID, NO_CHECK, NEGATIVE, NO_ENTRY, BAD_ARGS, NO_STEPS, SAVE_ROUTES_OFF when sf_start\'s saveRoutes is off, or the code of the error that stopped the save, with its message); a FAIL has no route. Pass the session the checks ran on; with no session a plan, start or end is refused while a named session is open, and "default" names the default one. Changes nothing in the org.',
  {
    plan: z.array(z.object({
      title: z.string().min(1),
      kind: z.enum(['positive', 'negative']),
      requirement: z.string().min(1).optional().describe('the requirement it belongs to, word for word from the brief (a saved route reports it); the title is its short label'),
      source: z.enum(['requirement', 'brief', 'org rule']).optional(),
      technique: z.string().min(1).optional().describe('invalid partition, boundary, decision table, state transition, access'),
      persona: z.string().min(1).optional().describe('the user it runs as'),
      replaces: z.string().min(1).optional().describe('the id of the saved route sf_run_route refused as STALE_ROUTE, which this scenario finds again: its Draft names it, and the stale route is left as it is. A different remap of the same route waits beside the first Draft; once a person promotes one, the other cannot be promoted (ALREADY_REPLACED) and is run again'),
    })).min(1).optional(),
    start: z.string().min(1).optional().describe('the title of the scenario you begin'),
    end: z.string().min(1).optional().describe('the title of the scenario you finish'),
    result: z.enum(['PASS', 'FAIL']).optional().describe('with end'),
    reason: z.string().optional().describe('on a FAIL: what the page did instead'),
  },
  async ({ session, ...mark }) => { // session only leaves mark: the wrapper already made it state.id
    const id = state.id;
    if (!known(id)) throw noSession(id);
    if (!mark.plan && !mark.start && !mark.end) throw new lib.SfUiError('BAD_ARGS', 'give plan, start or end', {});
    if (!mark.end !== !mark.result) throw new lib.SfUiError('BAD_ARGS', 'end and result go together', { end: mark.end, result: mark.result });
    // A call (or a route) naming no session lands on the default ledger; a named session's checks would miss it.
    if (!state.scoped && (mark.plan || mark.start || mark.end)) {
      const open = openNamed();
      if (open.length) throw new lib.SfUiError('BAD_ARGS', `no session given and a named session is open; pass the session your checks run on (open: ${open.join(', ')}), or "default" for a plan or scenario for it; in a route, pass it to sf_run_route`, { open });
    }
    const seen = new Set();
    const dup = mark.plan?.find((p) => seen.has(p.title) || (seen.add(p.title), false));
    if (dup) throw new lib.SfUiError('BAD_ARGS', `plan has two scenarios titled "${dup.title}": a title names one scenario`, { title: dup.title });
    const out = { ok: true, ...mark };
    // The plan's kinds ride on the session's ledger, kept even when the plan comes before sf_start, so end can judge a positive scenario by its checks.
    const led = (mark.plan || mark.start || mark.end) && checks.ledger(ledgers, id);
    for (const p of mark.plan || []) led.kinds.set(p.title, p.kind);
    if (mark.end && mark.end === mark.start) checks.begin(led, mark.start); // one call does both: a FAIL without trying
    // The plan keeps each title's requirement; a re-plan that leaves it out keeps the earlier one.
    if (mark.plan) {
      led.plan = { ...led.plan };
      for (const { title, requirement, replaces } of mark.plan) if (requirement || replaces) led.plan[title] = { ...led.plan[title], ...(requirement && { requirement }), ...(replaces && { replaces }) };
    }
    if (mark.end) {
      Object.assign(out, checks.finish(led, mark.end, mark.result));
      const steps = led.steps;
      led.steps = [];
      // The code's verdict decides, so a PASS that a failed check overruled saves nothing.
      if (out.verdict === 'PASS') out.route = await saveRun(led, mark.end, steps, out.weak);
      // A remap is cleared once it has saved (or its Draft already stands); a FAIL, or a PASS that saved nothing, keeps it for the retry.
      if ((out.route?.saved || out.route?.reason === 'DUPLICATE_ID') && led.plan?.[mark.end]?.replaces) { const { replaces, ...kept } = led.plan[mark.end]; led.plan = { ...led.plan, [mark.end]: kept }; }
    }
    if (mark.start && mark.start !== mark.end) checks.begin(led, mark.start);
    return out;
  });

const MIN_APP_MS = 5_000; // the least time worth giving openApp
tool('sf_start', 'Start a browser session logged into Lightning as the owner of an sf CLI alias, ending that session first if open. With session "new" it opens another browser beside the others (a parallel tester) and returns its id to pass as session on every later call. serverSkewMs is the org clock minus the one every at uses, to about 1 s. At SF_TESTER_MAX_SESSIONS (default 4) it first closes the "new" session idle longest past SF_TESTER_CAP_IDLE_MS (default 2 min), then throws TOO_MANY_SESSIONS if none is. With app it opens that Lightning app (record pages, layouts and components can differ by app); without, the page is in the user\'s last-used app. Returns app, the app the page is in (a developer name that is also another app\'s label opens the one it names, with warning on app; with no app asked for, null and appReason when it cannot be read), headed, whether the browser shows a window, and production: true on a production org: edit or delete only test records and ones the brief names there. saveRoutes says whether sf_scenario end saves a passing scenario\'s route (reason SAVE_ROUTES_OFF when not): off by default on a production org. Throws APP_UNAVAILABLE, listing the apps the user can open, AMBIGUOUS for a label two apps share, and APP_NOT_OPENED when the app\'s page never loads. The whole call has one 150 s deadline, covering the browser launch, the login and the Login As policy read: START_TIMEOUT when any of them runs past it, or when under 5 s is left to open app. headed: true on a host with no display throws NO_DISPLAY. budget is the tool calls this session may make (none by default, and 0 is none; a restart that leaves it out keeps it). A call past it throws BUDGET_SPENT, a restart of the same session included (a restart with a new budget too); the server cannot tie a new session to the run, so a tester must not start one after it; sf_scenario, sf_end, the tools that need no session (bar sf_verify_checks, which runs a validate) and up to five admin sf_api reads of /queryAll are never refused, and a route is one call, plus one for each sf_verify_checks step. The first sf_start of a session is not counted.',
  {
    org: z.string().min(1).describe('sf CLI alias or username'),
    session: z.string().min(1).optional().describe('"new" for a session of your own; an id sf_start returned to restart it; leave out for the default session'),
    app: z.string().min(1).optional().describe('the Lightning app to test in, by developer name or label (any case); a later sf_login_as re-opens it'),
    headed: z.boolean().optional().describe('true opens a visible browser window, for a person who wants to watch the run; a restart that leaves it out keeps the last choice for that session, headless at first'),
    budget: z.number().int().min(0).optional().describe('tool calls this session may make before BUDGET_SPENT; 0 for no limit; a restart that leaves it out keeps the last one for that session, none at first'),
    saveRoutes: z.boolean().optional().describe('whether sf_scenario end saves a passing scenario\'s route; off by default on a production org, on elsewhere; a restart that leaves it out keeps the last one given for that session on the same org, and takes the default on another'),
  },
  async ({ org, session = 'default', app, headed, budget, saveRoutes }, { signal }) => {
    const deadline = Date.now() + lib.session.START_MS; // one deadline for the launch, the login and the app open
    const sw = stopwatch();
    if (session !== 'new' && !known(session)) throw noSession(session);
    const id = session === 'new' ? `s${(minted += 1)}` : session;
    // The last start that ran on this id, kept on its ledger, so a restart that leaves headed out keeps the window.
    const show = headed ?? ledgers.get(id)?.headed ?? false;
    // No default: calls per run differ by org, so only a stated budget caps a run (2026-11-11); the bench states none.
    const limit = budget ?? ledgers.get(id)?.budget ?? 0;
    const routesAsked = saveRoutes ?? (ledgers.get(id)?.org === org ? ledgers.get(id)?.routesAsked : undefined); // kept on the same org only
    await close(id);
    const idle = [...sessions.values()].filter((e) => e.id !== 'default' && Date.now() - e.used > IDLE_MS);
    await Promise.all(idle.map((e) => reap(e.id)));
    checks.sweep(ledgers, sessions, IDLE_MS, id); // not the id being started: its browser is between close and launch
    // At the cap, the session idle longest past CAP_IDLE_MS (a tester that ended without sf_end) gives way first.
    if (sessions.size >= MAX_SESSIONS) {
      const stale = [...sessions.values()].filter((e) => e.id !== 'default' && e.s && !e.busy && Date.now() - e.used > CAP_IDLE_MS).sort((x, y) => x.used - y.used)[0];
      if (stale) await reap(stale.id);
    }
    if (sessions.size >= MAX_SESSIONS) {
      const open = [...sessions.values()].map((e) => ({ session: e.id, ...(e.busy ? { busy: true } : { idleS: Math.round((Date.now() - e.used) / 1000) }) })); // used is a busy call's start
      throw new lib.SfUiError('TOO_MANY_SESSIONS', `${MAX_SESSIONS} sessions are open (${open.map((o) => o.session).join(', ')}); sf_end one, or raise SF_TESTER_MAX_SESSIONS`, { max: MAX_SESSIONS, open });
    }
    const entry = { id, s: null, form: null, rec: null, used: Date.now() };
    sessions.set(id, entry); // held while the browser starts, so parallel starts count against the cap
    sw.mark('close'); // ending this id's last session and any idle ones
    try {
      const creds = await lib.session.fromAlias(org);
      sw.mark('auth');
      state.token = creds.accessToken; // the call's own entry: a first start has no session to redact by yet
      entry.s = await lib.session.start(creds, { headless: !show, deadline });
      sw.mark('browser'); // the launch, the org reads and the first Lightning page
      // Too little left to open an app is the start's deadline, not an app that failed to open in 0.001 s.
      if (app && lib.session.left(deadline) < MIN_APP_MS) throw new lib.SfUiError('START_TIMEOUT', `the start deadline left under ${MIN_APP_MS / 1000} s to open ${app}`, { deadlineMs: lib.session.START_MS });
      const inApp = app ? { app: await lib.session.openApp(entry.s, app, { timeout: lib.session.left(deadline, 60_000) }) } : await appNow(entry.s);
      sw.mark('app');
      // The same deadline: a hung org answer is START_TIMEOUT, as it is inside start().
      const policy = await lib.session.loginAsEnabled(entry.s, { signal: AbortSignal.timeout(lib.session.left(deadline)) })
        .catch((e) => { throw e.name === 'TimeoutError' ? lib.session.startTimeout(e, lib.session.START_MS) : e; });
      sw.mark('policy');
      // Another sf_start or sf_end on this id, or the idle close, ran during the launch: this browser has no owner.
      if (sessions.get(id) !== entry) throw new lib.SfUiError('SESSION_REPLACED', `another sf_start or sf_end on ${id} ran while this one started, so this browser was closed`, { session: id });
      // The caller gave up (a client timeout, an interrupt): nobody learns this id, so free it now.
      if (signal?.aborted) throw new lib.SfUiError('CANCELLED', `the caller cancelled sf_start, so ${id} was closed`, { session: id });
      const routes = routesAsked ?? !entry.s.production;
      Object.assign(checks.ledger(ledgers, id), { headed: show, budget: limit, routesAsked, saveRoutes: routes, org, steps: [], app, noApp: false }); // a started session has a ledger, so a check never has to make one; app as asked, for the route's entry
      return { session: id, headed: show, ...(entry.s.production && { production: true }), saveRoutes: routes, userId: entry.s.tokenUserId, ...inApp, apiVersion: entry.s.apiVersion, loginAsEnabled: policy.loginAs, serverSkewMs: entry.s.serverSkewMs, timings: sw.ms };
    } catch (e) {
      // A failed start frees its id and closes its browser; the id may already hold another start's entry.
      if (sessions.get(id) === entry) sessions.delete(id);
      if (entry.s) await lib.session.end(entry.s);
      if (ledgers.has(id)) ledgers.get(id).used = Date.now(); // the launch took time: the idle window starts at the failure
      throw e;
    }
  });

tool('sf_login_as', 'Become another user for this whole session (needs Login As enabled). It can disturb other sessions started from the same alias on their next call (a record page that never loads, or a reload): avoid it while other testers run; a sibling that fails right after it should restart with new. With app it then opens that Lightning app; without, it re-opens the session\'s app (appKept: true), so personas stay in one app. Returns app, the app the page is in (with warning when app is a developer name that is also another app\'s label). Throws APP_UNAVAILABLE, listing the apps this user can open, AMBIGUOUS for a label two apps share, and APP_NOT_OPENED when the app\'s page never loads.',
  { user: z.string().describe('User Id (005...), username or sf CLI alias'), app: z.string().min(1).optional().describe('the Lightning app to open, by label or developer name; leave out to keep the session\'s') },
  async ({ user, app }) => {
    const s = need();
    const sw = stopwatch();
    const id = await lib.discover.userId(s, user);
    sw.mark('user');
    await lib.session.loginAs(s, id);
    sw.mark('login');
    const led = ledgers.get(state.id);
    if (led) led.steps = []; // what ran before the login ran as another user
    state.form = null;
    // Login As lands in the new user's last-used app, so the session's app is opened again.
    const want = app || s.app?.developerName;
    const userId = await lib.session.whoAmI(s);
    // The Login As has happened by now, so a failed app says the session runs as the new user.
    const timed = (out) => { sw.mark('app'); return { ...out, timings: sw.ms }; };
    if (!want) return timed({ userId, ...(await appNow(s)) });
    const inApp = await lib.session.openApp(s, want).catch((e) => {
      if (led) led.noApp = true; // no app is known for this user: a route saved now names none, until sf_start or an app that opens
      if (!(e instanceof lib.SfUiError)) throw e;
      throw new lib.SfUiError(e.code, `logged in as ${userId}, but ${e.message.replace(/^\w+: /, '')}; sf_start to return to the alias owner`, { ...e.evidence, userId });
    });
    if (led) Object.assign(led, { noApp: false }, app && { app }); // kept once it opened; a kept app keeps the label it was given
    const { warning, ...kept } = inApp; // the caller never typed a kept app's value, so it gets no warning
    return timed({ userId, app: app ? inApp : kept, ...(!app && { appKept: true }) });
  });

tool('sf_whoami', 'The user Id the page runs as, app (the Lightning app the page is in) and apps (the Lightning apps this user can open: label, developerName, console); app null and appReason when they cannot be read.', {}, async () => {
  const s = need();
  const userId = await lib.session.whoAmI(s);
  const list = await lib.session.apps(s).catch((e) => e);
  if (list instanceof Error) return { userId, app: null, apps: null, appReason: String(list.message).slice(0, 300) };
  return { userId, ...(await appNow(s, list)), apps: list.map(({ id, ...a }) => a) };
});

tool('sf_open_record', 'Open a record page and wait until it has loaded. Throws RECORD_UNAVAILABLE when the user cannot see it, UNSUPPORTED_LANGUAGE for a non-English user.',
  { recordId: z.string(), objectApiName: z.string().optional() },
  async ({ recordId, objectApiName }) => {
    const r = await lib.nav.openRecord(need(), recordId, { objectApiName });
    return { ...r, flexiPage: await lib.discover.renderedPage(state.s) };
  });

tool('sf_open_tab', 'Open a custom tab by its API name or its label (a Visualforce, Lightning component or web tab), as the App Launcher would. Returns the tab as { name, label }, plus warning when the value is an API name that is also another tab\'s label (the name wins), or an API-name-shaped underscore value that is only a tab\'s label (opened by label), the label being what the user sees (null, with labelReason, when the list could not be read or lacks the tab), and the main area snapshot. A Visualforce page sits in an iframe: measure inside it with sf_measure frame iframe[name^=vfFrameId]. Throws TAB_UNAVAILABLE with the tabs the user can open (tabsReason when the list could not be read), or AMBIGUOUS when two tabs share the label.',
  { tab: z.string().min(1).describe('tab API name (e.g. My_VF_Tab) or label') },
  async ({ tab }) => { const { main, tab: opened } = await lib.nav.openTab(need(), tab); return { tab: opened, url: state.s.page.url(), snapshot: await snapshot(main) }; });

tool('sf_open_list', 'Open an object\'s list view by its API name (DeveloperName), or the object home when listView is left out. Returns the main area snapshot (the split pane for a list shown as Split View, with warning when that pane does not render; an empty Split View list hides its pane, so it returns the main area with no warning). Throws LIST_UNAVAILABLE.',
  { objectApiName: z.string(), listView: z.string().optional() },
  async ({ objectApiName, listView }) => { const main = await lib.nav.openList(need(), objectApiName, listView); return { url: state.s.page.url(), ...(main.warning && { warning: main.warning }), snapshot: await snapshot(main) }; });

tool('sf_open_related_list', 'Open a record\'s related list by relationship name (Contacts, Things__r). Returns the main area snapshot. Throws LIST_UNAVAILABLE.',
  { recordId: z.string(), relationship: z.string() },
  async ({ recordId, relationship }) => { const main = await lib.nav.openRelatedList(need(), recordId, relationship); return { url: state.s.page.url(), snapshot: await snapshot(main) }; });

// sf_list: one tool for the actions on an open list view (src/list.js), each confirmed by a second signal.
const list = require('./list');
tool('sf_list', 'Act on the list view sf_open_list opened, as a user does; each action is confirmed apart from its click, from the server where it can. sort: column (header label), direction ascending (default) or descending; the rows match the server\'s order (SORT_NOT_APPLIED, LIST_MISMATCH); the sort is kept for the user. search: text; the rows match the server\'s search and the box still holds it (SEARCH_NOT_APPLIED). select: rows, a text in each; the status line counts them (SELECTION_MISMATCH). delete: row; the server no longer returns it (NOT_DELETED) and its row leaves (ROW_STILL_SHOWN). edit: row, column, value, in a text, number or picklist cell (a picklist value is its option label; EDITOR_UNSUPPORTED otherwise, a lookup cell among them); refused at once when the record already holds the value (VALUE_ALREADY_SET); the server holds it (NOT_SAVED, with the errors this save raised, its draft then cancelled). massEdit: rows (two or more different rows, else BAD_ARGS), column, value: the same edit applied to every row (Update N selected items), refused when every row already holds it (VALUE_ALREADY_SET); each record holds it (NOT_SAVED lists each record with what the server holds, a deleted one as gone), refused as mass is (OTHER_ROWS_SELECTED). mass: rows and button (a list button or an item under Show more actions or Show N more actions); refused when rows not named are selected (OTHER_ROWS_SELECTED); returns the dialog or page it opens (ACTION_NOT_OPENED): finish it with sf_fill / sf_click inModal and check the records. changeOwner: rows, owner (the user\'s full name): Change Owner on those rows, the notification email unticked unless notify is true (NOTIFY_NOT_SET); the owner of each record on the server (OWNER_NOT_CHANGED lists each record, with the dialog\'s own text when it stays open); refused before Submit when every row already has that owner (OWNER_ALREADY_SET), and `already` names the rows that had it. It changes who owns and can see the records; the undo is a second changeOwner. A record that answers 404 to the session user after Save or Submit is read once by the alias owner: there it is confirmed and named in `unseen` (the user no longer sees it); a 404 there too is gone. A failure once the cell editor or the dialog is open closes it, a missing Save included. massEdit and changeOwner untick the rows they ticked, on a failure too; select keeps its rows, but Lightning clears every tick after changeOwner, so `select` rows do not survive it (`unticked` names them); and an edit on a row while other rows are ticked changes that row only. filter, removeFilter: field (label), operator (as the panel names it) and value; a filter is saved on the list view for every user, so a test that adds one removes it in the same test with removeFilter and the same three; confirmed in list-info (FILTER_NOT_SAVED) and the rows (LIST_MISMATCH). display: Table, Kanban or Split View (some apps only) (DISPLAY_NOT_SHOWN; KANBAN_NOT_SET for a list with no Kanban grouping, its settings cancelled, unsaved). Split View is kept for the user across sessions and for every list of the object in that app, Kanban within the session: end with display Table. move: row (a card\'s full name), to (a Kanban column), shown as Kanban first; the server holds the value (NOT_MOVED). open: row in the split view\'s list, shown as Split View first; the record opens beside it (RECORD_NOT_SHOWN). The actions that read rows need the list as a Table (NOT_TABLE), with rows where they act on one (LIST_EMPTY). A row text must match one row (ROW_NOT_FOUND, AMBIGUOUS_ROW). A list that shows its error card in place of rows is LIST_UNAVAILABLE. Also NOT_ON_LIST, COLUMN_NOT_FOUND, BAD_ARGS.',
  {
    action: z.enum(Object.keys(list.ACTIONS)),
    column: z.string().min(1).optional().describe('sort: the column header label'),
    direction: z.enum(['ascending', 'descending']).optional(),
    text: z.string().min(1).optional().describe('search: the text to search the list for'),
    row: z.string().min(1).optional().describe('text in the one row to act on'),
    rows: z.array(z.string().min(1)).min(1).optional().describe('select, mass, massEdit, changeOwner: text in each row to select'),
    owner: z.string().min(1).optional().describe('changeOwner: the new owner\'s full name, as the user picker lists it'),
    notify: z.boolean().optional().describe('changeOwner: true keeps Send notification email ticked (default: unticked)'),
    value: z.union([z.string(), z.number()]).optional().describe('edit, massEdit: the value to type in a text or number cell, or the option label in a picklist cell ("" is --None--); filter, removeFilter: the filter value'),
    button: z.string().min(1).optional().describe('mass: the list button\'s label, e.g. Change Owner'),
    field: z.string().min(1).optional().describe('filter, removeFilter: the field\'s label'),
    display: z.enum(['Table', 'Kanban', 'Split View']).optional().describe('display: the view to show the list as'),
    to: z.string().min(1).optional().describe('move: the Kanban column to move the card to'),
    operator: z.string().min(1).optional().describe('filter, removeFilter: the operator as the panel names it (equals, contains...)'),
  },
  async ({ action, session, ...args }) => list.run(need(), action, args)); // session is the wrapper's, not the action's

tool('sf_search', 'Global search from the header box, as a user types it. Returns the results page snapshot once it shows a result row or its no-match text (SEARCH_FAILED when it shows neither within 60 s, or the results page never opens). A new record can take a minute to be searchable.',
  { text: z.string() },
  async ({ text }) => { const main = await lib.nav.search(need(), text); return { url: state.s.page.url(), snapshot: await snapshot(main) }; });

tool('sf_actions', 'Open the record page and list the actions it offers this user (Edit, Delete, quick actions): apiName, label, type. On a page with Dynamic Actions, the page\'s own list after its visibility rules; an action whose rule cannot be decided here carries shown: "unknown" and its visibilityRule.',
  { recordId: z.string() },
  async ({ recordId }) => ({ actions: await lib.discover.actions(need(), recordId) }));

tool('sf_launch_action', 'Open a record action by API name (from sf_actions), from its button or the "Show more actions" menu ("Show N more actions" on a Task); returns the dialog it opens (for sf_fill / sf_click with inModal), navigated when it opened a page or tab instead, or toasts when it opened neither and raised toasts (an action with no dialog: after its first toast, a dialog gets 2 s more; a toast from before the click never counts). Throws ACTION_NOT_AVAILABLE, AMBIGUOUS, TIMEOUT.',
  { recordId: z.string(), apiName: z.string() },
  async ({ recordId, apiName }) => {
    const dialog = await lib.action.launch(need(), recordId, apiName);
    if (dialog?.toasts) return { toasts: dialog.toasts };
    return dialog ? { snapshot: await snapshot(dialog) } : { navigated: true, url: state.s.page.url() };
  });

tool('sf_form_model', 'The form this user gets for a record (it opens the record page, closing any open form): fields with label, type, editable, required, section; from the page on a Dynamic Forms page. For the New form, objectApiName with mode Create and no recordId (the Create layout, no page opened).',
  { recordId: z.string().optional(), objectApiName: z.string().optional(), mode: z.enum(['Edit', 'View', 'Create']).optional() },
  async ({ recordId, objectApiName, mode }) => {
    if (!recordId) {
      if (mode !== 'Create' || !objectApiName) throw new lib.SfUiError('BAD_ARGS', 'give a recordId, or objectApiName with mode Create for the New form', { objectApiName, mode });
      return lib.discover.formModel(need(), null, { mode, objectApiName });
    }
    if (!lib.nav.isId(recordId)) throw new lib.SfUiError('BAD_ARGS', `"${recordId}" is not a record Id; for the New form pass objectApiName with mode Create`, { recordId });
    await lib.nav.openRecord(need(), recordId); // a Dynamic Forms page, not the layout, defines the form there
    return lib.discover.formModel(state.s, recordId, { mode, flexiPageApiName: await lib.discover.renderedPage(state.s) });
  });

tool('sf_object_context', 'The Salesforce facts a tester cannot see on the page, for one object: for each user named (a User Id, a username or an sf CLI alias), create, read, edit and delete on the object and read and edit on each field, profile and permission sets together (a required field follows the object); and what runs on save: active validation rules, Apex triggers and record-triggered flows. Admin reads, so no Login As. Read it before planning scenarios; sf_form_model gives the form one user gets. Throws USER_NOT_FOUND for a user it cannot find, and NOT_FOUND naming each field the object does not have.',
  {
    objectApiName: z.string().min(1),
    users: z.array(z.string().min(1)).optional().describe('the personas: User Ids (005...) or usernames'),
    fields: z.array(z.string().min(1)).optional().describe('field API names; every field of the object when left out'),
  },
  async ({ objectApiName, users, fields }) => lib.discover.objectContext(need(), objectApiName, { users, fields }));

tool('sf_edit_record', 'Open the standard Edit dialog for a record as this user. Keeps the form open for sf_set_fields and sf_save.',
  { recordId: z.string(), source: z.enum(['pageLayout', 'dynamicForms']).optional().describe('the form model this route was checked on; another one throws SOURCE_MISMATCH') },
  async ({ recordId, source }) => {
    state.form = await lib.form.editRecord(need(), recordId, { source });
    const editable = state.form.model.fields.filter((f) => f.editable).map((f) => `${f.apiName} (${f.dataType}) "${f.label}"`);
    return { source: state.form.model.source, missing: state.form.missing, editable };
  });

tool('sf_create_record', 'Open the New dialog for an object as this user: New is pressed on the object home, as a user does: a button named New or New <object label>, or that item in the home\'s overflow menu (the Task home, a split view, has New Task under Show N more actions), and a home with none throws ACTION_NOT_AVAILABLE; the form is never opened by its URL. A Task create stays on the Task home and its toast holds no id, so sf_save returns the one Task this user created with the typed Subject during the save (recordIdFrom says so); none or more than one such Task is CREATE_UNCONFIRMED (tasksMade: the count), as is a failed read of them (unread says why), and an empty Subject is outcome blocked (the dialog requires one). Once its id is known the new record is read back and checked as an edit is (each field set, a lookup picked by name by the id of the option picked): a saved create carries values when a field was set (none: nothing was compared), a field it does not hold, or a lookup set by id or cleared that was not compared, is CREATE_UNCONFIRMED with recordId and values, and a failed read with recordId and unread: the record exists, so do not create it again. Once the form\'s dialog has closed, sf_set_fields and sf_save on it throw FORM_CLOSED and never reach another dialog; while another dialog stays over it, FORM_COVERED names that dialog. On an object with several record types, pass recordType (its label): New is pressed and that type chosen in the picker; without it, RECORD_TYPE_REQUIRED lists them. Keeps the form open for sf_set_fields; sf_save then returns the new recordId.',
  { objectApiName: z.string(), recordType: z.string().optional().describe('record type label, e.g. Partner Account') },
  async ({ objectApiName, recordType }) => {
    state.form = await lib.form.createRecord(need(), objectApiName, { recordType });
    return { missing: state.form.missing, editable: state.form.model.fields.filter((f) => f.editable).map((f) => `${f.apiName} (${f.dataType}) "${f.label}"`) };
  });

tool('sf_edit_inline', 'Open inline edit from the pencil on one view field of a record page (the detail panel becomes a form with a footer Save). Keeps the form open for sf_set_fields and sf_save like sf_edit_record.',
  { recordId: z.string(), field: z.string().describe('API name of the field whose pencil to press'), source: z.enum(['pageLayout', 'dynamicForms']).optional().describe('the form model this route was checked on; another one throws SOURCE_MISMATCH') },
  async ({ recordId, field, source }) => {
    state.form = await lib.form.editInline(need(), recordId, field, { source });
    return { source: state.form.model.source, missing: state.form.missing, editable: state.form.model.fields.filter((f) => f.editable).map((f) => `${f.apiName} (${f.dataType}) "${f.label}"`) };
  });

// The form sf_edit_record, sf_edit_inline or sf_create_record opened in this session.
const openForm = () => {
  need();
  if (!state.form) throw new lib.SfUiError('NO_FORM', 'call sf_edit_record, sf_edit_inline or sf_create_record first');
  return state.form;
};

tool('sf_set_fields', 'Set fields on the open edit form by API name. Text, number, picklist, checkbox, lookup by record name or by 15- or 18-char record id (the option with that id is picked, for records that share a name, on a Task\'s Name and Related To by the id its option holds; on a lookup whose options carry no id, the one option with that record\'s name is picked, two are AMBIGUOUS, and sf_save checks the stored id; an id the API finds no record for is typed as a name, and a record this user cannot read is VALUE_NOT_FOUND, at once when the API answers 403 and in about 12 s when it answers 404 (then it is typed as a name); "" clears it, first waiting for a choice the record holds to show, or on a create up to 3 s for a prefilled one, and reads it back empty), date as ISO (2026-12-31), datetime as an ISO instant with a zone in whole minutes (typed as wall time in the user timezone; seconds are INVALID_VALUE, and an instant in the first pass of an hour the zone repeats when daylight saving ends is VALUE_NOT_SET naming the instant that wall time saves), multi-select as "A;B" (the whole chosen set), time as HH:mm (14:30), and dependent picklists in any order (controllers are set first). A picklist option that takes no click is tried once more (a closed dropdown is opened again), then TIMEOUT within about 20 s (visible: true when it stayed shown): that is not a missing value, which only an open list that never showed it proves. Throws VALUE_NOT_FOUND with the options seen (on a lookup, clickFailed: true when the option was listed but no click on it took), and AMBIGUOUS, listing each option\'s lines and record id, when two lookup records share the name: pass that id instead. Any lookup error may have removed the old choice, so a save could leave it blank; cleared: true on the error confirms it did. Only the first page of lookup search results is read, so a record past it is VALUE_NOT_FOUND; a lookup to several objects (a Task\'s Name, Related To) is switched to a record id\'s object, or for a name to the object objects names ({ WhoId: "Lead" }); a name with no entry is searched in the object the switcher shows, an object the lookup does not look up is VALUE_NOT_FOUND listing those it does, and an id of another object than objects names is BAD_ARGS. A record another user made in the last minute may not be in this user\'s lookup search yet: by a record id this user can read it is searched again for up to 60 s, then NOT_SEARCHABLE_YET; by name, or an id this user cannot read, VALUE_NOT_FOUND names both causes (not searchable yet, or not visible to this user). FORM_COVERED, within about 5 s, while another dialog is over the form; FORM_CLOSED once the form is gone, a navigation during that check too. Each value is read back after typing: VALUE_NOT_SET, with what the box holds, when the box cut it (maxlength) or kept another value.',
  { values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), objects: z.record(z.string(), z.string()).optional().describe('for a lookup set by name: the object to search (API name, e.g. { WhoId: "Lead" })') },
  async ({ values, objects }) => {
    await lib.form.setFields(openForm(), values, { objects });
    return { set: Object.keys(values) };
  });

tool('sf_save', 'Save the open form. Returns outcome saved (with recordId, the new one after a create, and toasts), blocked (with field and page errors: always at least one; an inline edit\'s within about 2 s; an Aura dialog that keeps its error banner with none listed gets the save\'s 30 s to close, then SAVE_UNCONFIRMED, or CREATE_UNCONFIRMED on a create: a create is read back as sf_create_record says), or conflict when another save changed the record since the form opened: snapshot is Salesforce\'s Choose values to keep dialog (each field\'s Your Value and Saved Value); choose with sf_click inModal (a radio, then Save), and nothing is written until then. An edit form that closed while the page left the record (a login page, a redirect) is saved when the record\'s SystemModstamp moved, its LastModifiedById is the user the form runs as, and it holds each value the form held at Save for the fields sf_set_fields or sf_fill set (compared by kind); values.checked lists the fields compared, values.notChecked, with why, those only the stamp and its writer confirm (rich text, a kind not compared, a value the record already held, a field not read back, a box gone from the form or showing another value or no number at Save, an sf_fill label that names no one field, or no field set at all). Otherwise it throws SAVE_UNCONFIRMED with what was read (modstamp: before, after, runsAs, and unread: why a read, bounded at 5 s, came back null; values.mismatched: each field\'s apiName, typed (the value the form held) and stored; by, when every field holds but another user wrote last), so nothing confirms the save. An edit with a lookup set by id but picked by name, or cleared with "" (sf_set_fields), is read back after any save with the call\'s other fields, and SAVE_UNCONFIRMED when the record holds another id or value, or one of them was not compared; a lookup picked by name is compared by the id of the option picked. FORM_COVERED, within about 5 s, while another dialog (Choose values to keep, a lookup\'s New) is over the form: finish or close it first; FORM_CLOSED once the form is gone, a navigation during that check too. A Save that takes no click in 5 s is TIMEOUT (button, disabled), and a form with no Save is ACTION_NOT_AVAILABLE.', {},
  async () => {
    const r = await lib.form.save(openForm());
    if (r.outcome === 'saved') state.form = null;
    return r;
  });

tool('sf_cancel', 'Cancel the open edit form; NO_FORM when none is open; FORM_COVERED, within about 5 s, naming the dialog over the form (finish or close it first); FORM_CLOSED when a navigation ends the form during that check, or, with dialogs, when the form is gone and another form is on screen (the New that Save & New opens); TIMEOUT (button, disabled) when its Cancel takes no click in 5 s, and ACTION_NOT_AVAILABLE when the form shows none.', {}, async () => {
  await lib.form.cancel(openForm());
  state.form = null;
});

tool('sf_lwc_read', 'Find a custom component on a record page from FlexiPage metadata (opening its tabs), or rendered inside another component there, and return its accessibility snapshot and foundBy. A component placed twice is the copy that shows (none showing, the first); AMBIGUOUS, with each place and its visibilityRule, when both show.',
  { recordId: z.string(), lwcApiName: z.string(), flexiPageApiName: z.string().optional() },
  async (at) => ({ snapshot: await snapshot(await scopeOf(need(), at)) }));

// Where a click or an upload looks: a component on a record page, the newest modal, or the whole page.
const where = {
  recordId: z.string().optional().describe('the record page to act on, opened unless it is the one showing; with lwcApiName, the component on it'),
  lwcApiName: z.string().optional(), flexiPageApiName: z.string().optional(), inModal: z.boolean().optional(),
  frame: z.string().optional().describe('CSS selector of the one visible iframe in that scope to work inside, e.g. iframe[title="Report Viewer"] or iframe[name^=vfFrameId]'),
};
const scopeOf = async (s, { recordId, lwcApiName, flexiPageApiName, inModal, frame }) => {
  let scope = s.page;
  if (inModal) scope = await lib.modal.find(s);
  else if (lwcApiName) {
    const { host, foundBy } = await lib.lwc.locate(s, recordId, lwcApiName, { flexiPageApiName });
    state.foundBy = foundBy;
    scope = host;
  } else if (recordId) {
    // A recordId alone is the record page: open it, never act on whichever record is open.
    if (!lib.nav.isId(recordId)) throw new lib.SfUiError('BAD_ARGS', `${recordId} is not a record id`, { recordId });
    await lib.lwc.onRecord(s, recordId);
  }
  if (!frame) return scope;
  // Inside an iframe (a report, a Visualforce page): the one visible match.
  return (await lib.layer.oneFrame(scope, frame, 20_000)).contentFrame().locator('body');
};

tool('sf_upload_file', 'Give files to the one file input in a component (recordId + lwcApiName), the newest modal (inModal), or the page, as the file picker would; presses Done on the Upload Files dialog, waiting for it however late once the uploader sends its request; at.fileSet and at.done say when. Throws NO_SINGLE_FILE_INPUT, and UPLOAD_FAILED when the dialog shows an alert or not every file uploaded (count, alerts; it closes the dialog once the page has finished opening it, so the page stays usable, and closed says whether it did; viewport says whether the page behind was seen hidden first).',
  { paths: z.array(z.string()).describe('absolute file paths'), ...where },
  async ({ paths, ...at }) => lib.files.upload(need(), await scopeOf(state.s, at), paths));

// Narrowing shared by the tools that aim at one element: the table row with some text, the cell under a header.
const aim = { row: z.string().optional().describe('text in the one table row to look in'), column: z.string().optional().describe('column header: look only in the cell under it'), nth: z.number().int().min(1).optional().describe('1-based, in page order: which of several same-named matches, when no row tells them apart; an nth past them is NOT_FOUND whose count is how many matched when it looked (a list still rendering shows fewer, so wait and retry), and a count of 0 means nothing matched where it looked, so check the name and any row or column') };

tool('sf_click', 'Click by role and accessible name (name "" for an unnamed icon button), or by exact text for an element with no role, in a component (recordId + lwcApiName, opens the record), the newest modal (inModal), or the current page; row and column narrow to one table cell, and row with a role and no name is the one element of that role in the row (the checkbox of a list view row, named by its position); at.clicked says when, at the latest (after a click that loads a new page, when that page committed). A click that expands a menu or a list returns opened, the snapshot of the popup it controls, which may render where no other snapshot reaches. Throws TARGET_MOVED with its before and after boxes when the element moved mid-click so no click reached it (a layout shift: report it). Throws CLICK_MISSED when it did not move but the release landed on something the press put over it, so no click reached it (report it too). Throws NOT_FOUND, AMBIGUOUS, ROW_NOT_FOUND, AMBIGUOUS_ROW with a snapshot to re-aim from (marked when cut; a component that shows twice is AMBIGUOUS with its places instead, as sf_lwc_read says); a miss adds near, what the asked words match and the components (host tags) each sits in.',
  { name: z.string().optional(), role: z.string().optional().describe('ARIA role, default button (menuitem, link, tab, checkbox...)'), text: z.string().optional().describe('exact text, in place of role and name, for an element the snapshot shows only as text'), download: z.boolean().optional().describe('the click starts a file download: save it and return download (name, path, bytes); NO_DOWNLOAD if none starts'), ...aim, ...where },
  async ({ name, role, text, row, column, nth, download, ...at }) => lib.act.click(await scopeOf(need(), at), { name, role, text, row, column, nth, download }));

tool('sf_fill', 'Type into a textbox by accessible name in a component, the newest modal (inModal) or the page, replacing its text (a native select takes value as an option label; VALUE_NOT_FOUND lists the options); row and column narrow to one table cell. For the standard record edit form use sf_set_fields. Each value is read back after typing: VALUE_NOT_SET, with what the box holds, when the box cut it (maxlength) or kept another value. A Lightning date, time or number box parses its text only once left, so it is then left (a blur): VALUE_NOT_SET, with its help text, when the component kept no value (a date or time not in the user\'s format, letters in a number).',
  { name: z.string(), value: z.string(), role: z.string().optional().describe('ARIA role, default textbox (searchbox, combobox...)'), ...aim, ...where },
  async ({ name, value, role, row, column, nth, ...at }) => {
    const out = await lib.act.fill(await scopeOf(need(), at), { name, value, role, row, column, nth });
    if (state.form) lib.form.filled(state.form, name, value); // a left save then checks it
    return out;
  });

tool('sf_press', 'Press a key on whatever has focus: Tab after sf_fill so a box that reads its value on change takes it (sf_fill already leaves a Lightning date, time or number box), Enter to confirm, Escape to close a dropdown or dialog, a chord like Shift+Tab. Throws BAD_ARGS on an unknown key name; at.pressed says when.',
  { key: z.string() },
  async ({ key }) => lib.act.press(need().page, { key }));

// expect on a layout reading: path is dotted keys into the result (box.y, visible, elements.0.rect.height). Take value from the
// requirement or design, or from a reading a person approved once; never from the run being checked.
const expectZ = z.object({
  path: z.string(), value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  tolerance: z.number().min(0).optional().describe('px a number at x, y, width, height, left, top, right or bottom may differ by, default 0; a count, a visible share, a boolean, a string and null compare exactly'),
}).optional().describe('fail with MEASURE_MISMATCH unless the value at path equals value (a px number within tolerance px; any other value exactly). Value comes from the requirement or design, or a reading a person approved; do not copy it from this run');

tool('sf_on_top', 'Stacking and clipping check on a target: an element by role and name (default button; name "" for an unnamed icon button) or by exact text, narrowed by row and column, in a component (recordId + lwcApiName), the newest modal (inModal) or the page, or with no name the component or modal itself. Returns onTop, the topmost element at its centre and inset corners (through shadow roots, with tag, label and host components), modalOpen, and visible: the share of its box inside the viewport and not cut off by an overflow ancestor (clippedBy). Reaches elements an open modal hides. visible and box are the page as it is; an element past the viewport edge is scrolled to the centre for the points only, as a user scrolls to it (scrolled gives the px it moved), and the page is scrolled back. With expect, throws MEASURE_MISMATCH when the value at expect.path (dotted keys into this result, e.g. onTop, visible, box.y) is not expect.value, a px number (x, y, width, height, left, top, right, bottom) within expect.tolerance px, any other value exactly.',
  { name: z.string().optional(), role: z.string().optional(), text: z.string().optional(), expect: expectZ, ...aim, ...where },
  async ({ name, role, text, expect, row, column, nth, ...at }) => {
    const out = await lib.layer.onTop(await scopeOf(need(), at), { name, role, text, row, column, nth });
    return expect ? checks.expectReading(out, expect) : out;
  });

tool('sf_hover', 'Put the mouse over an element aimed as sf_click aims (role and name, or exact text, narrowed by row and column, in a component, the newest modal or the page), so a tooltip opens or a hover style applies; focus: true also focuses it as the keyboard would (a focus ring, a tooltip that opens on focus) and throws NOT_FOCUSABLE when it cannot take focus. Read what changed with sf_wait (a tooltip text on the page) or sf_measure; a tooltip mounts outside the page main area that sf_page_snapshot reads. Holds until another tool moves the mouse or the focus; focus left by an earlier click stays, and SLDS styles a focused button as hovered. at.hovered says when.',
  { name: z.string().optional(), role: z.string().optional(), text: z.string().optional(), focus: z.boolean().optional(), ...aim, ...where },
  async ({ name, role, text, focus, row, column, nth, ...at }) => lib.act.hover(await scopeOf(need(), at), { name, role, text, focus, row, column, nth }));

tool('sf_viewport', 'Resize the page viewport in CSS px so the layout reflows (a breakpoint, a narrower window), and return viewport as the page reads it. A session starts at 1470x956, a 13-inch MacBook Air screen, and keeps a resize until sf_start restarts it.',
  { width: z.number().int().min(320).max(3840), height: z.number().int().min(320).max(2160).optional().describe('default: the current height') },
  async (size) => ({ viewport: await lib.session.resize(need(), size) }));

tool('sf_measure', 'Layout readings in CSS px of the viewport: for one element by role and name or exact text (aimed as sf_on_top aims), every match of a CSS selector (crosses shadow roots; the first 50 are measured), or with neither the component or modal itself. Each element gives tag, label, hosts, rect (x, y, width, height, right, bottom), visible (the share of its box inside the viewport and not cut off by an overflow ancestor, clippedBy), overflow (scroll minus client size, x and y; above 0 means content is cut off or scrolls) and the computed styles named; textBox adds textLines, where its drawn text sits, one box per line and per column (text more than 1 em from the rest of its line is a column of its own, so justified text or a spaced badge can count as extra lines), hidden and assistive text left out, clipped: true where an ancestor cuts it sideways (an ellipsis); in left-to-right text the right edge of the last line is where the last word ends. An input or textarea value is not text here. With frame (a selector for the one visible iframe, e.g. a Visualforce page; several visible is AMBIGUOUS) it measures inside that iframe, with rects in page px and visible also cut by where the iframe shows. The result gives viewport (innerWidth, innerHeight), count, rendered (matches with a non-zero box) and inView (matches with some of the box showing), so a sweep carries its denominator. With expect, throws MEASURE_MISMATCH when the value at expect.path (dotted keys into this result, e.g. elements.0.rect.height) is not expect.value, a px number (x, y, width, height, left, top, right, bottom) within expect.tolerance px, any other value exactly.',
  {
    expect: expectZ,
    name: z.string().optional(), role: z.string().optional(), text: z.string().optional(),
    selector: z.string().optional().describe('CSS selector, e.g. lightning-helptext or .slds-modal__container'),
    styles: z.array(z.string()).optional().describe('computed CSS properties to read, e.g. grid-template-columns, z-index'),
    textBox: z.boolean().optional().describe('also return textLines: the box of the text on each line'),
    ...aim, ...where,
    // After where: its frame (one scope's iframe) would otherwise replace this description, which measure means.
    frame: z.string().optional().describe('CSS selector of an iframe in the target (e.g. a Visualforce page): aim and selector then look inside it, rects in page px'),
  },
  async ({ name, role, text, selector, styles, textBox, frame, expect, row, column, nth, ...at }) => {
    const out = await lib.layer.measure(await scopeOf(need(), at), { name, role, text, selector, styles, textBox, frame, row, column, nth });
    return expect ? checks.expectReading(out, expect) : out;
  });

tool('sf_toasts', 'The toasts raised since the last action (sf_click, sf_save, sf_press, sf_upload_file, sf_launch_action), edit (sf_fill, sf_set_fields, sf_edit_inline) or page open (sf_open_record, sf_open_tab, sf_open_list, sf_open_related_list, sf_search, sf_create_record, sf_edit_record, and sf_form_model or sf_assert_field when they open the record) (type, title, message), even ones already gone or raised before a page load; a toast during a look (sf_api, sf_page_snapshot, sf_measure...) joins that window, and one from before the action, edit or page open never does. Waits up to 5 s for the first.', {},
  async () => ({ toasts: await lib.act.toasts(need().page) }));

tool('sf_wait','Wait until text shows (or, with gone, leaves) in a component, the newest modal or the page: a result, a status line, a spinner label; at.seen is when it did. With any in place of text, waits for the first of several conditions (texts, gone or not, and toasts raised since the last action or page open, as sf_toasts lists them, even ones already gone; never one from before that action) and returns matched (its index and the condition) and toasts (all recorded since that action), so one call tells success from error. Text that is in the DOM but covered by another layer does not count as shown (covered by a fixed or sticky layer or one outside its scrolling box, or off-screen where it sits, it is scrolled to the centre and read again, as a user would scroll to it, and the scroll is put back; a cover that scrolls with the text is not cleared by that): the wait throws TEXT_COVERED, naming what covers it, in place of TIMEOUT; when not every copy has its cover read by the deadline (a busy page, copies left unread included), the text counts as shown with coverUnchecked: true. Text a collapsed box cuts to nothing (a block ancestor, not an inline one, of height or width 0 that hides its overflow, as a closed accordion), or that a box the user cannot scroll (overflow hidden or clip) cuts off, as the off-stage slide of a carousel, is not shown, and a gone wait counts it gone; visually hidden text (slds-assistive-text, a 1x1 box) counts as shown. Gone holds on two polls in a row with no match, each read within one document (a read a navigation cut short is not one). A gone wait for a text no poll saw still passes, with neverSeen: true; polls are 100 ms apart, so a shorter flash can be missed. Throws TIMEOUT with a snapshot; with any, it names every condition and carries the toasts.',
  {
    text: z.string().optional(),
    gone: z.boolean().optional(),
    any: z.array(z.object({ text: z.string().optional(), gone: z.boolean().optional(), toast: z.string().optional().describe('text in a toast\'s title or message, any case') }))
      .optional().describe('conditions, each a text (with gone) or a toast; the first to hold wins, the lower index on a tie'),
    timeoutMs: z.number().optional().describe('default 30000; 0 checks once and does not wait (a gone condition twice, 100 ms apart)'),
    ...where,
  },
  async ({ text, gone, any, timeoutMs, ...at }) => lib.act.waitFor(await scopeOf(need(), at), { text, gone, any, timeout: timeoutMs }));

tool('sf_modal','Read the newest open modal (snapshot) or close it. With no dialog showing after timeoutMs (default 5000) it answers { open: false } instead of throwing, so it also checks that a dialog closed.',
  { action: z.enum(['snapshot', 'close']), timeoutMs: z.number().optional() },
  async ({ action, timeoutMs }) => {
    const m = await lib.modal.open(need(), { timeout: timeoutMs, body: action === 'snapshot' });
    if (!m) return { open: false };
    if (action === 'close') return lib.modal.close(m);
    return { snapshot: await snapshot(m) };
  });

tool('sf_apex', 'Record the Apex calls the page makes: start, read what was logged so far, or stop.',
  { action: z.enum(['start', 'read', 'stop']) },
  async ({ action }) => {
    const s = need();
    if (action === 'start') { if (state.rec) state.rec.stop(); state.rec = lib.apex.record(s); return; }
    if (!state.rec) throw new lib.SfUiError('NOT_RECORDING', 'call sf_apex start first');
    const calls = state.rec.calls.map(({ returnValue, ...c }) => ({ ...c, returnValue: JSON.stringify(returnValue ?? null).slice(0, 300) }));
    if (action === 'stop') { state.rec.stop(); state.rec = null; }
    return { calls };
  });

tool('sf_watch', 'Watch the page over time, for a progress bar, a spinner or a result event. start: every everyMs (default 250) read the first rendered match of a CSS selector, found in any shadow root under the scope, in a component, the newest modal or the page, and keep a sample each time it changes (present, count, rendered, text, width, height, the named attrs and styles); and keep the named events (e.g. ocrresult) as they fire, with their detail: on window, which hears only composed events, and on every match of on (a CSS selector for the component that fires them, e.g. c-travel-docs; default the sampled selector), listened to from the first tick that finds it. read: what was kept so far, with ISO times on the same clock as at, ticks and maxGapMs (the longest gap between ticks; far above everyMs means the page was throttled). stop: read and end it. Each selector must match within one shadow root (c-x .bar, with .bar inside c-x, is BAD_ARGS; name .bar alone). A page load ends a watch (NOT_WATCHING).',
  {
    action: z.enum(['start', 'read', 'stop']),
    selector: z.string().optional().describe('CSS selector to sample, e.g. [role=progressbar]'),
    on: z.string().optional().describe('CSS selector of the elements whose events to record, e.g. the host that fires them'),
    everyMs: z.number().int().min(50).max(10_000).optional(),
    attrs: z.array(z.string()).optional().describe('attributes to sample, e.g. aria-valuenow'),
    styles: z.array(z.string()).optional().describe('computed CSS properties to sample'),
    events: z.array(z.string()).optional().describe('event types to record, e.g. ocrresult'),
    ...where,
  },
  async ({ action, selector, on, everyMs, attrs, styles, events, ...at }) => {
    const s = need();
    if (action === 'start') return lib.watch.start(await scopeOf(s, at), { selector, on, everyMs, attrs, styles, events });
    return lib.watch.read(s.page, { stop: action === 'stop' });
  });

tool('sf_assert_field', 'Check a field value through the UI API, the record page, or both. A date, datetime or time is given as its ISO value on every side; via ui reads the stored value too, to match it to the page\'s text. Throws FIELD_VALUE_MISMATCH, and FIELD_NOT_SHOWN (with the page\'s tabs) when the record page shows the field on neither its landing tab nor Details, after up to 13 s; hidden: true means a copy is in the page but not visible (a collapsed section, another tab, or another console tab); a field the page hides within 1 s of showing it counts as hidden (the first load after the user collapses its section shows it open a moment). Both are failed checks, so a scenario ended PASS over either is FAIL.',
  { recordId: z.string(), field: z.string(), expected: z.union([z.string(), z.number(), z.boolean(), z.null()]), via: z.enum(['api', 'ui', 'both']).optional() },
  async ({ recordId, field, expected, via }) => lib.assert.fieldValue(need(), recordId, field, expected, { via }));

tool('sf_verify_live', 'Prove a component runs the deployed build by finding text only that build renders. The marker matches as a whole word, case included: V21 is found in "Build V21, deployed 12 Nov", not in V210, XV21, ÜV21 or v21. The word edge holds only where the marker begins or ends with a letter or digit (#21 is found in Build#21), and a space in it matches any whitespace, a source line wrap included. A leading or trailing space is trimmed. Throws STALE_BUILD. A marker with no non-space character is refused as an invalid argument before any page opens (BAD_ARGS in a route step).',
  { recordId: z.string(), lwcApiName: z.string(), marker: z.string().regex(/\S/, 'needs a non-space character') },
  async ({ recordId, lwcApiName, marker }) => ({ live: await lib.deploy.verifyLive(need(), recordId, lwcApiName, marker) }));

tool('sf_api', `Read through REST or UI API: ${lib.api.READ_ROOTS.map((r) => `/${r}`).join(', ')} only (PATH_REFUSED for any other). as=user runs in the page as the current user (UI API only); as=admin uses the token (queries, tooling). The q of /query, /queryAll, /tooling/query, /tooling/queryAll and /search is everything after ?q=, written raw or encoded: it is sent encoded, so % + & # in a literal stay as written (a + is a plus, not a space), while a raw literal that is also an escape (LIKE 'A%20B') decodes; a q with a lone surrogate is INVALID_VALUE. An answer that is a list, a string, a number, a boolean, null, {} or has its own at key arrives as { result }. With expect, throws VALUE_MISMATCH unless the value at expect.path (dotted keys into that result, { result } included, as in {{stepN.path}}) equals expect.equals (polled up to expect.timeoutMs), so a route can fail on what only an API shows.`,
  {
    path: z.string().describe('path after /services/data/vXX.X, e.g. /ui-api/object-info/Account'),
    as: z.enum(['user', 'admin']).optional(),
    expect: z.object({
      path: z.string(), equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      timeoutMs: z.number().min(0).max(120_000).optional().describe('ask again every 500 ms until it matches, for a value an async save writes; at most 120000'),
    }).optional(),
  },
  async ({ path, as, expect }, { signal } = {}) => {
    lib.api.assertRead(path); // here too, so a refusal comes before the session check
    for (const end = Date.now() + (expect?.timeoutMs || 0); ; await new Promise((r) => setTimeout(r, 500))) {
      if (signal?.aborted) throw new lib.SfUiError('CANCELLED', `the caller cancelled sf_api ${path}`, { path }); // stop polling
      const r = await lib.api.call(need(), path, { as });
      const actual = expect && checks.at(wrap(r), expect.path);
      if (!expect || actual === expect.equals) return r;
      if (Date.now() >= end) throw new lib.SfUiError('VALUE_MISMATCH', `${expect.path} is ${JSON.stringify(actual)}, not ${JSON.stringify(expect.equals)}`, { path: expect.path, expected: expect.equals, actual });
    }
  });

tool('sf_page_errors', 'Uncaught errors and console errors the page produced since the last call (a component can crash without showing anything); reading clears them.', {},
  async () => lib.session.pageErrors(need()));

tool('sf_page_snapshot', 'Accessibility snapshot of the current page main area: what a screen reader sees. No vision. On a record page recordId is the record shown, for a later route step ({{stepN.recordId}} after a Clone or a New that a click saved).', {},
  async () => { const url = need().page.url(); return { url, recordId: lib.nav.recordIdOf(url), snapshot: await snapshot(await lib.act.mainOf(state.s.page)) }; });

tool('sf_screenshot', 'A screenshot for pixel or layout measurement only, never for navigation. With no path it comes back in this result and no file is written; give a path only when the brief asks to keep the image.',
  { path: z.string().optional().describe('absolute .png path, to keep the file') },
  async ({ path }) => {
    if (path) { assertPng(path); await need().page.screenshot({ path }); return { path, kept: true }; }
    return { kept: false, [IMAGE]: (await need().page.screenshot()).toString('base64') };
  });

// A navigation map of the org under test, built for this session from its own metadata and dropped with it.
tool('sf_map_feature', 'Map a feature from this org\'s own metadata (Tooling API, read-only), kept for this session until sf_end or an sf_start that restarts it (map again after one): the components placed on the FlexiPages named, with the tab path to each, the components each renders, and the dialogs its buttons open (an inline dialog or a LightningModal). Returns rounds (components read and found per round), seconds, each page\'s places, each component\'s children and dialogs. Then sf_route gives the steps to a place.',
  { flexiPages: z.array(z.string()).optional().describe('FlexiPage API names, e.g. the record page'), lwcs: z.array(z.string()).optional().describe('component API names to map from as well') },
  async ({ flexiPages, lwcs }) => {
    const map = await lib.navmap.build(need(), { flexiPages, lwcs });
    state.map = map;
    return {
      seconds: map.seconds, rounds: map.rounds,
      pages: Object.fromEntries(Object.entries(map.pages).map(([page, placed]) => [page, placed.map((p) => ({ component: p.component, tabs: p.tabs, ...(p.conditional && { conditional: true }) }))])),
      components: Object.fromEntries(Object.entries(map.components).map(([name, c]) => [name, { children: c.children, dialogs: c.dialogs.map((d) => `${d.label} (button ${d.button})`) }])),
    };
  });

tool('sf_route', 'The steps to a component (its API name) or a dialog (its label) from this session\'s sf_map_feature map, opening the record page first, in the shape sf_run_route takes, with via: each hop and how it is known (metadata from the page, code from a component\'s source). recordId is the record whose page holds it ({{recordId}} when left out). NO_MAP before sf_map_feature; NOT_FOUND lists the places and dialogs the map has.',
  { to: z.string(), recordId: z.string().optional() },
  async ({ to, recordId }) => {
    need();
    if (!state.map) throw new lib.SfUiError('NO_MAP', 'call sf_map_feature first');
    return lib.navmap.route(state.map, { to, recordId });
  });

// A known route as one call, so a tester spends one turn on it instead of one per step.
const { NOT_A_STEP } = require('./tool-limits');
// A value an earlier step returned, e.g. {{step2.recordId}}; the dot keeps combinations.fill from taking it.
const STEP_REF = /\{\{step(\d+)\.([\w.]+)\}\}/g;
// A route meets its steps' limits before its first step runs; a value only a run can fill is judged by the step itself.
function stepLimits(name, { path, recordId, objectApiName, ...rest }) {
  const plain = (v) => typeof v === 'string' && !v.includes('{{');
  if (name === 'sf_list') list.check(rest); // each action's own arguments
  if (name === 'sf_api' && plain(path)) lib.api.assertRead(path);
  if (name === 'sf_screenshot' && plain(path)) assertPng(path);
  if (name === 'sf_verify_checks') require('./access').check(rest); // the call's own rules
  lib.nav.segment(...[recordId, objectApiName].filter(plain));
}
// Every step checked before any runs: a tool that may be a step, its arguments, its limits, no reference ahead of itself.
function planRoute(steps) {
  return steps.map(({ tool: name, args = {} }, i) => {
    const h = !NOT_A_STEP.includes(name) && (name === 'sf_verify_checks' ? verifyStep : handlers.get(name));
    if (!h) throw new lib.SfUiError('BAD_ARGS', `step ${i}: ${name} cannot be a route step`, { step: i, tool: name });
    const { session, ...own } = args;
    const parsed = h.schema.safeParse(own);
    if (!parsed.success) throw new lib.SfUiError('BAD_ARGS', `step ${i} ${name}: ${parsed.error.issues.map((x) => `${x.path.join('.') || 'args'} ${x.message}`).join('; ')}`, { step: i, tool: name });
    const ahead = [...JSON.stringify(own).matchAll(STEP_REF)].find((m) => Number(m[1]) >= i);
    if (ahead) throw new lib.SfUiError('BAD_ARGS', `step ${i} ${name}: ${ahead[0]} names a step not yet run`, { step: i, tool: name, ref: ahead[0] });
    try { stepLimits(name, parsed.data); } catch (e) { throw new lib.SfUiError(e.code, `step ${i} ${name}: ${e.message.replace(/^\w+: /, '')}`, { step: i, tool: name, ...e.evidence }); }
    return { name, run: h.run, args: parsed.data };
  });
}
const validityShape = lib.validity.shape;
// What a STALE_ROUTE refusal tells the caller to do next, by the scenario the route ran in.
const staleNext = ({ negative, open, id, remap }) => {
  if (negative && !id) return 'a negative scenario saves no Draft: pass the route\'s id so the remap can name it, and remap in a positive scenario';
  if (negative) return `a negative scenario saves no Draft: remap ${id} in a positive scenario planned with replaces: ${id}`;
  if (open && !id) return 'pass the route\'s id so the remap can name it';
  if (!remap) return 'plan the scenario with replaces naming the stale route';
  return id !== remap ? `this scenario's Draft names ${remap}, so ${id} needs a scenario of its own` : `this scenario's Draft will name ${remap}`;
};
tool('sf_run_route', 'Run a known route in one call: steps, each another sf-tester tool and its arguments (leave session out: the route\'s session applies), in order. Every step\'s arguments are checked before any step runs (BAD_ARGS, or PATH_REFUSED for a path sf_api refuses), and sf_start, sf_end, sf_run_route and the tools that keep a record of the run (sf_scenario, sf_save_route, sf_promote_route, sf_record_improvement, sf_fix_improvement) cannot be steps. An sf_verify_checks step leaves out org, as it runs on the route session\'s org, takes an absolute checksFile or project and meets the call\'s own argument rules (BAD_ARGS before any step otherwise; sf_combinations gives a saved route\'s paths absolute), counts against the session\'s budget as a direct call does, charged with the route before any step runs (BUDGET_SPENT, and no step runs, when they do not fit), and fails the route on any verdict but green (code VERIFY_NOT_GREEN for red, VERIFY_NOT_RUN for not run or nothing checked, verify\'s lines in evidence). A string argument can carry {{stepN.path}}, a value an earlier step returned: N counts from 0, path is dotted keys into that step\'s result ({{step2.recordId}} after a create\'s sf_save, {{step0.actions.0.apiName}}); one to a step not yet run, or to a value that is not there, is BAD_ARGS naming the step. Returns steps (each tool with its at moments), last, the final step\'s whole result, and validity, the app and record page the route ended on, with the persona only when a login names one, or the persona read is the one the route\'s own validity names (any other is read to compare, not to save). A read that threw comes back as unread, so a red with no stale may be a page nobody read; a route with a saved validity that opened no page reads its app and persona only, and unread says the page was not read. The first step that fails stops the route with ROUTE_STEP_FAILED: failedAt, that step\'s code, error and evidence, and the steps done before it. Given a saved route\'s validity, it is first checked against the org with no browser (app, FlexiPage, the persona\'s permission sets and its profile\'s own set): stale refuses the route with STALE_ROUTE, naming what changed, before any step runs, so you remap it (find the route again, and the passing scenario saves a new Draft with replaces; a negative scenario saves none, so remap in a positive one of its own); onStale run skips the check (the CLI replay checks first). The result carries check: valid, stale or unknown (nothing compared, or the check could not run: it runs, and unchecked says why), and what could not be checked before the run (the form, read where the route ends). A result or a failure also adds stale, what has changed on that page since the route was saved; a red with stale is still a red.',
  { steps: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional() })).min(1), id: z.string().min(1).optional().describe('the saved route\'s id, from sf_combinations: a stale refusal inside a positive scenario makes that scenario\'s Draft name it; a negative scenario saves no Draft, so remap in a positive one'), onStale: z.enum(['refuse', 'run']).optional().describe('refuse (the default): a route the pre-run check finds stale runs no step; run: no check, for the CLI replay (it checks first) and replay --baseline; a tester remaps a stale route instead'), validity: z.unknown().optional().describe('a saved route\'s validity, from sf_combinations, to check it and to report what changed since it was saved, or that it ran as another persona than the one it names; leave it out for a route that has none') },
  unwound(async ({ steps, id, validity, onStale = 'refuse' }, extra) => {
    const led = ledgers.get(state.id); // read before any await, so a verify step runs on the ledger the call started on
    const plan = planRoute(steps);
    // A baseline only reports, so one a hand edit broke counts as none rather than refusing the route.
    const saved = validityShape.safeParse(validity).data;
    const sw = stopwatch();
    // A saved route is checked before its first step, by API alone; an unreadable validity or an org error leaves it to run as unknown.
    const check = validity === undefined || onStale === 'run' ? undefined : await lib.validity.guarded(need(), validity);
    sw.mark('check');
    // In a positive scenario, the stale route's id goes on its plan, so its passing run saves a Draft that names it.
    // The first route named stands, planned or refused: a second refusal in the scenario does not take its place.
    // A negative scenario never saves a Draft, so it takes no remap.
    const negative = led?.open && led.kinds.get(led.open) === 'negative';
    const remap = check?.state === 'stale' && id && led?.open && !negative && (led.plan?.[led.open]?.replaces ?? id);
    if (remap) led.plan = { ...led.plan, [led.open]: { ...led.plan?.[led.open], replaces: remap } };
    if (check?.state === 'stale') {
      // A Draft names one route, so another stale route (not the one named) waits for a scenario of its own.
      const next = staleNext({ negative, open: led?.open, id, remap });
      throw new lib.SfUiError('STALE_ROUTE', `changed since this route was saved: ${check.stale.join('; ')}. Remap it: find the route again (sf_map_feature, sf_route) and run that; ${next}`, { decision: 'remap', ...check, ...(remap && { replaces: remap }) });
    }
    // Read once, where the route ended or failed, so no step's timing changes.
    // A route that opened no page reads its app and persona but not the page: the session still shows the last route's.
    const ended = async (withPage = true) => {
      const { read, unread: threw } = await lib.validity.readParts(state.s, undefined, !!saved?.persona, withPage);
      const unread = withPage ? threw : ['page: the route opened no page', ...threw];
      const stale = lib.validity.changed(saved, read);
      if (saved?.persona && state.s?.loggedInAs === 'unknown') stale.push('persona: a login failed, so this run has no known user');
      // The alias user's persona is read to compare, not to keep: a save of this would make it a persona route.
      const { persona, ...own } = read || {};
      // Unless the route is that persona's: then its set hashes are kept, so --baseline can accept a changed set.
      const mine = persona && saved?.persona && lib.validity.personaKey(persona) === lib.validity.personaKey(saved.persona);
      const kept = state.s?.loggedInAs || mine ? read : Object.keys(own).length ? own : null;
      return { ...(kept && { validity: kept }), ...(stale.length && { stale }), ...(unread.length && { unread }) };
    };
    // A red gives no validity: the page it failed on is no baseline to save. With no baseline, it needs no read.
    // A page is opened by an entry step, any step that moved the URL (a link, a launched action), or a step given the
    // record the page shows, which reuses that page (sf_click on a component of the open record).
    const start = state.s?.page.url();
    let opened = false;
    const staleNow = async () => { const { stale, unread } = saved ? await ended(opened) : {}; return { ...(stale && { stale }), ...(unread && { unread }) }; };
    const done = [];
    const results = [];
    const stepMs = []; // one entry per step, in step order
    let last;
    for (const [i, { name, run, args: template }] of plan.entries()) {
      const began = performance.now();
      // Each {{stepN.path}} becomes the text of that value, as combinations.fill does for {{name}}.
      let gap;
      const args = JSON.parse(JSON.stringify(template).replace(STEP_REF, (ref, n, keys) => {
        const value = checks.at(results[n], keys);
        if (value == null || typeof value === 'object') { gap ??= { n, ref }; return ''; }
        return JSON.stringify(String(value)).slice(1, -1);
      }));
      // A page that changed can empty an earlier step's value, so this red says so too.
      if (gap) throw new lib.SfUiError('BAD_ARGS', `step ${i} ${name}: step ${gap.n} returned no value for ${gap.ref}`, { step: i, tool: name, ref: gap.ref, done, ...(await staleNow()) });
      try {
        last = await run(args, name === 'sf_verify_checks' ? { ...extra, led } : extra);
      } catch (e) {
        const at = state.s?.page.url();
        if (at !== start || reuses(name, args, at)) opened = true; // a step that moved or reused the page before it threw
        const code = codeOf(e);
        const error = redact(String(e.message || e)).slice(0, ERROR_CHARS);
        throw new lib.SfUiError('ROUTE_STEP_FAILED', `step ${i} ${name}: ${error.split('\n')[0]}`, { failedAt: i, tool: name, code, error, evidence: e.evidence, done, ...(await staleNow()) });
      }
      const url = state.s?.page.url();
      opened ||= isEntry({ tool: name, args }) || url !== start || reuses(name, args, url);
      done.push({ tool: name, ...(last?.[lib.AT] && { at: last[lib.AT] }) });
      last = wrap(last);
      results.push(last);
      stepMs.push(Math.round(performance.now() - began));
    }
    sw.mark('steps');
    const end = await ended(opened || !saved);
    sw.mark('end'); // the read of the app and page the route ended on
    return { steps: done, last, ...(check && { check }), ...end, timings: { ...sw.ms, stepMs } };
  }));

// planRoute is sf_run_route's own check, so a saved route is one it would run.
// ponytail: a {{placeholder}} in a number or boolean arg is refused here; fill it before checking if that bites.
tool('sf_save_route', 'Save a route sf_scenario end did not save (its reason says why), or a red route you recovered, to your own catalogue, the file SF_TESTER_COMBINATIONS names, as a candidate that sf_combinations lists at once. With promote it goes straight into the tested routes that replays and CI run, under SF_TESTER_PROMOTE auto, the default; under manual, or any other value (with a warning), it stays a candidate a person promotes with sf_promote_route, and promoted says which. Use {{name}} placeholders for record ids and names, listed in needs. Pass the app you checked it in, so a replay runs it there, and the validity sf_run_route returned for this route, so a replay can say what changed behind a red (from a run as the user a replay will use: a persona\'s validity is saved as a persona route). A route saved after sf_login_as keeps that user\'s persona (profile and perm sets) in validity and on its id, and a replay logs in as a user who matches. An sf_verify_checks step leaves out org (it runs on the route session\'s org), and its checksFile or project, an absolute path, is stored relative to the catalogue\'s folder. Save an sf_open_tab step with the tab label the requirement quotes, and the app as the app label the brief quotes, so a replay fails on a rename; with no quoted label, as sf_open_tab and sf_start took it. Refuses NO_CATALOGUE when SF_TESTER_COMBINATIONS is unset, DUPLICATE_ID for an id already there, BAD_ARGS for a step sf_run_route would refuse, an sf_login_as step or no session while a named one is open, NO_SESSION for a session it cannot find and VIEWER_UNKNOWN after a failed login, unless the validity holds a persona. Pass your session if you logged in, so the route keeps its persona. A persona route given promote is saved as a candidate with a note saying so: a person promotes it with sf_promote_route, and with no page read in its validity the note also says it has no baseline.',
  {
    id: z.string().min(1).describe('component@container, unique in the catalogue; a persona is added to it'),
    component: z.string().min(1).describe('the base component, e.g. lightning-combobox'),
    container: z.string().min(1).describe('where it sits: record page tab, sidebar, LightningModal, screen flow...'),
    interaction: z.string().min(1).describe('what the user does, e.g. choose an option'),
    task: z.string().min(1).describe('the check in user terms, with the {{name}} placeholders'),
    requirement: z.string().min(1).describe('the requirement the route proves, word for word from the brief, or for a scenario derived from a diff, its title: a replay reports it, so its pass is read against it, not against the run that saved it'),
    needs: z.array(z.string()).optional().describe('the placeholder names the route uses'),
    app: z.string().min(1).optional().describe('the Lightning app the route was checked in: the app label the brief quotes, else as sf_start took it'),
    route: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional() })).min(1).describe('the steps as sf_run_route takes them'),
    validity: validityShape.optional().describe('the validity sf_run_route returned when you replayed this route'),
    promote: z.boolean().optional().describe('you judge it sound: a replay of it with sf_run_route passed and its last steps check the requirement; never for a persona route, which a person promotes'),
    replaces: z.string().min(1).optional().describe('the id of the saved route sf_run_route refused as STALE_ROUTE, which this route was found again for; the stale route is left as it is until a person promotes a remap of it'),
  },
  async ({ promote, ...entry }) => {
    planRoute(entry.route);
    // A step's user is a username, which no other org has, and a green one leaves the next route on that user.
    if (entry.route.some((r) => r.tool === 'sf_login_as')) throw new lib.SfUiError('BAD_ARGS', 'a saved route has no sf_login_as step: log in first, and the route keeps that user\'s persona', { id: entry.id });
    if (!entry.validity?.persona) {
      // The persona comes from the session, so it must be the one that logged in. A route that holds its own needs none.
      if (state.scoped && !state.s) throw noSession(state.id);
      if (!state.scoped && openNamed().length) throw new lib.SfUiError('BAD_ARGS', `no session given and a named session is open, so the route could lose its persona; pass your session (open: ${openNamed().join(', ')})`, { open: openNamed() });
    }
    // Read here, so a route saved with no validity (a red replay) still replays as who checked it.
    const persona = entry.validity?.persona ? null : await lib.validity.personaOf(state.s);
    if (persona) {
      const { page, ...rest } = entry.validity || {}; // a page read before the login is another user's view
      entry.validity = { ...rest, persona };
    }
    // A persona's route is run as another user by a replay: a person judges that, never the tester, so promote saves a candidate.
    const held = !!promote && !!entry.validity?.persona;
    // auto, the default, lets the tester promote what it judges sound; manual leaves every route to a person.
    // An unknown value reads as manual: a typo meant to keep a person in the loop never promotes, and the route the run
    // checked is still kept, with a warning naming the setting.
    const raw = String(process.env.SF_TESTER_PROMOTE || '').trim().toLowerCase();
    const known = ['', 'auto', 'manual'].includes(raw);
    const mode = raw === '' || raw === 'auto' ? 'auto' : 'manual';
    const promoted = mode === 'auto' && !!promote && !held && !entry.replaces; // a remap waits for a person, who retires the stale route
    const note = [held && 'a persona route is not promoted by the tester: saved as a candidate, which a person promotes with sf_promote_route',
      entry.validity?.persona && !entry.validity.page && 'a persona route is saved with no baseline: replay --baseline reads one once it is tested and green'].filter(Boolean).join('; ');
    return { ...lib.combinations.save(entry, { promoted }), promoted, mode, ...(note && { note }), ...(!known && { warning: `SF_TESTER_PROMOTE is "${raw}", read as manual: set auto or manual` }) };
  });

tool('sf_promote_route', 'Promote a candidate route in your own catalogue to tested, so replays and CI run it: a person\'s call; a remap (a candidate with replaces) also retires the stale route it names (retired), kept under replaced in the file, the way routes are promoted when SF_TESTER_PROMOTE is manual. Refuses NO_CATALOGUE when SF_TESTER_COMBINATIONS is unset, NOT_FOUND, listing the candidates, for an id that is not one, DUPLICATE_ID for an id that appears more than once in the file, and ALREADY_REPLACED for a remap whose stale route another remap already retired (run the remap again against that route). Needs no session.',
  { id: z.string().min(1).describe('the candidate\'s id, component@container') },
  async ({ id }) => lib.combinations.promote(id));

tool('sf_end', 'Close the browser session: the default one, or the one session names. Returns checks, the records made since the last sf_scenario start or end, with open naming a scenario still open, then drops them (no checks key when there are none and none is open). Also returns improvements: { recorded, errors }, the gaps this session recorded and its tool errors, newest 20, each with tool, code, message and at, for you to account for, and dropped, how many older ones the limit left out (no improvements key when both are empty). Also returns calls: { used, budget }, the tool calls this session made and its budget (0 for none). It accepts an id whose browser closed with any of these still to hand back, until the idle window passes; a session the idle or cap close reaped with none of them is gone, so sf_end on it answers NO_SESSION and its call count is lost.', {}, async ({ session }) => {
  if (session && !known(session)) throw noSession(session);
  const id = session || 'default';
  await close(id);
  const led = ledgers.get(id);
  const out = checks.drain(led); // after close, so a check that settled during it is kept; close keeps the ledger
  ledgers.delete(id);
  return led?.budget === undefined ? out : { ...out, calls: { used: led.calls, budget: led.budget } };
});

// Exit at once when the client goes: Playwright's exit hook then kills each Chrome process group and deletes its profile.
// A Ctrl-C reaches a client's child too, so under a client (no terminal) SIGINT is the client's to act on: it closes stdin.
for (const [signal, code] of Object.entries({ SIGTERM: 143, SIGINT: 130, SIGHUP: 129 })) process.on(signal, () => (signal === 'SIGINT' && !process.stdin.isTTY) || process.exit(code));
process.stdin.on('end', () => process.exit(0));
server.connect(new StdioServerTransport());
