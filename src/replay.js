'use strict';

// A model-free replay of a catalogue's tested routes, for CI. Each placeholder in the catalogue says how a run makes
// it: a value template, a record over admin REST (its Id), or a temp file; a string is a description only.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SfUiError } = require('./errors');
const { unxml, esc } = require('./xml');
const combinations = require('./combinations');
const api = require('./api');
const validity = require('./validity');
const { VALIDATE } = require('./cascade-log');

const REF = /\{\{(\w+)\}\}/g;
const BUILTIN = ['stamp', 'routeIndex'];
// The names a placeholder's templates use; about and with are not templates.
const refs = (spec) => (typeof spec === 'string' ? [] : [...JSON.stringify({ ...spec, about: undefined, with: undefined }).matchAll(REF)].map((m) => m[1]));

// Every placeholder names need, closed over the names their templates use and their with (made alongside, as a
// Name needs its record), each after what its templates use. A given value is taken as is; a cycle is refused,
// and so is a given record whose name would be made: that name would belong to no record.
function order(placeholders, names, given = {}) {
  const out = [];
  const missing = [];
  const unpaired = [];
  const state = {};
  const visit = (k, trail) => {
    if (BUILTIN.includes(k) || k in given || state[k] === 'done') return;
    if (state[k] === 'busy') throw new SfUiError('BAD_ARGS', `placeholder cycle: ${[...trail, k].join(' -> ')}`, { cycle: [...trail, k] });
    const spec = placeholders[k];
    if (!spec || typeof spec === 'string' || !('value' in spec || spec.create || spec.tempFile)) {
      const about = typeof spec === 'string' ? spec : spec?.about;
      state[k] = 'done';
      return missing.push(about ? `${k} (${about})` : k);
    }
    state[k] = 'busy';
    for (const r of refs(spec)) visit(r, [...trail, k]);
    state[k] = 'done';
    out.push(k);
    for (const w of spec.with || []) {
      if (w in given) unpaired.push(`--values gives ${w} but not ${k}, which is made with it: give both`);
      else if (state[w] !== 'busy') visit(w, []);
    }
  };
  for (const k of names) visit(k, []);
  if (unpaired.length) throw new SfUiError('BAD_ARGS', unpaired.join('; '), { unpaired });
  if (missing.length) throw new SfUiError('BAD_ARGS', `no value for ${missing.join(', ')}: give it in --values, or say in the catalogue how to make it`, { missing });
  return out;
}

// Those made once per route: marked perRoute, or a template uses routeIndex or one made per route. names is in order.
// ponytail: not through with; a name paired with a perRoute record needs {{routeIndex}} to differ per route.
function perRoute(placeholders, names) {
  const each = new Set();
  for (const k of names) if (placeholders[k].perRoute || refs(placeholders[k]).some((r) => r === 'routeIndex' || each.has(r))) each.add(k);
  return each;
}

// Fills values for names in order; each record made goes on made, so cleanup deletes it, and to onMade, which keeps it on disk.
async function make(placeholders, names, values, { create, made, tempDir, onMade = () => {} }) {
  for (const k of names) {
    const { value, create: record, tempFile } = placeholders[k];
    if (value !== undefined) values[k] = combinations.fill(value, values);
    else if (record) {
      const { sobject, fields } = combinations.fill(record, values);
      values[k] = await create(sobject, fields);
      made.push({ sobject, id: values[k] });
      onMade(made.at(-1));
    } else {
      const { name, content } = combinations.fill(tempFile, values);
      values[k] = path.join(tempDir(), name);
      fs.writeFileSync(values[k], content);
    }
  }
  return values;
}

// The records a run made, on disk until deleted, so the next run removes what a killed run or a failed delete left. Under
// ~/.sf-tester, never in a repo; a folder per org, so two orgs never share one, and a file per process, so a run never
// takes the records of a live run on the same org. ponytail: a dead run's pid reused by a live process waits for that one.
function ledger(org, root = path.join(os.homedir(), '.sf-tester', 'replay-made'), warn = () => {}) {
  const dir = path.join(root, encodeURIComponent(org));
  const file = path.join(dir, `${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`); // a run, not just a pid
  let held = [];
  const save = () => {
    if (!held.length) return fs.rmSync(file, { force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(held));
    fs.renameSync(`${file}.tmp`, file); // a kill mid-write leaves the last whole list
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  return {
    dir,
    add: (r) => { held.push(r); save(); },
    done: (r) => { held = held.filter((x) => x.id !== r.id); save(); },
    // The records of each run that has ended, moved into this run's file before the old file goes, so none is lost.
    left: () => {
      const found = [];
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []; // a .json before its .json.tmp
      const whole = new Set(); // the files read as a list in this pass
      for (const n of names) {
        const pid = Number(n.match(/^(\d+)(?:-[0-9a-f]+)?\.json(?:\.tmp)?$/)?.[1]); // .tmp: killed before its rename
        // This pid on another run's file is a dead run whose pid came round again, or an earlier replay in this process.
        if (!pid || path.join(dir, n).startsWith(file) || (pid !== process.pid && alive(pid))) continue;
        const f = path.join(dir, n);
        let rows, text;
        try { text = fs.readFileSync(f, 'utf8'); rows = JSON.parse(text); } catch (e) {
          if (e.code === 'ENOENT') continue; // another run on this org took it first
          if (!(e instanceof SyntaxError)) throw e;
          // An empty .tmp is a kill before its first byte, and its file beside it was read whole; any other cut .tmp warns.
          if (n.endsWith('.tmp') && text === '' && whole.has(n.slice(0, -4))) { fs.rmSync(f, { force: true }); continue; }
          rows = e.message;
        }
        if (!Array.isArray(rows)) { // moved aside, so one bad file never stops a run or hides the files after it
          const bad = `${f}.${Date.now()}.bad`; // never over an earlier .bad
          try { fs.renameSync(f, bad); } catch (e) { if (e.code === 'ENOENT') continue; throw e; } // another run moved it
          warn(`${f} is not a list of records (${typeof rows === 'string' ? rows : JSON.stringify(rows).slice(0, 80)}): moved to ${bad}`);
          continue;
        }
        whole.add(n);
        const fresh = rows.filter((r) => !held.some((x) => x.id === r.id)); // a .tmp and its file share records
        found.push(...fresh);
        held.push(...fresh);
        save();
        fs.rmSync(f, { force: true });
      }
      return found;
    },
  };
}


// The org's records over admin REST with the sf CLI's auth; already gone (a route deleted it) counts as deleted, as GONE.
const GONE = Symbol('already gone');
// It connects as verify does, so an org that cannot be read is an API_ERROR marked connect, which the CLI exits 2 on.
async function admin(org, connect = (o) => require('./verify').defaultConnect(o, api)) {
  const s = await connect(org).catch((e) => { if (e.code === 'API_ERROR') e.evidence = { ...e.evidence, phase: 'connect' }; throw e; });
  return {
    create: async (sobject, fields) => (await api.call(s, `/sobjects/${sobject}`, { method: 'POST', as: 'admin', body: fields })).id,
    remove: (sobject, id) => api.call(s, `/sobjects/${sobject}/${id}`, { method: 'DELETE', as: 'admin' }).catch((e) => { if (e.evidence?.status !== 404) throw e; return GONE; }),
    query: validity.queryPaged(s), // a persona's users and their assignments, every page
    check: (saved) => validity.guarded(s, saved),
  };
}

// Past the SDK's 60 s default: the longest tested route's UI waits add to 90 s, and sf_start launches a browser.
// ponytail: fixed ceilings, not each route's summed timeoutMs; a route that hangs costs 5 min, plus each verify step's validate.
const TIMEOUT_MS = { sf_run_route: 300_000, sf_start: 180_000, sf_login_as: 180_000 };
// A verify step runs a check-only validate, which may take VALIDATE.minutes on top of the route's UI waits.
const routeCeiling = (steps) => TIMEOUT_MS.sf_run_route + steps.filter((s) => s.tool === 'sf_verify_checks').length * VALIDATE.minutes * 60_000;
// The session's app or user is not the next route's (a failed restart, a red route's browser, a persona's login).
const DOWN = Symbol('no session');
// One app named in two cases is the same app, so it needs no restart.
const sameApp = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

// The sf-tester server over stdio, as an agent runs it, with no model in the loop.
async function server(env = process.env) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'sf-tester-replay', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, 'server.js')], env }));
  return {
    call: async (name, args, timeout = TIMEOUT_MS[name]) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout }); return { isError: !!r.isError, text: r.content[0].text }; },
    close: () => client.close(),
  };
}

// A red route's step and error: a failed step from ROUTE_STEP_FAILED's evidence, else from its message: a route refused
// before any step ran, or a BAD_ARGS for a step value, which can come after steps ran and so can carry stale.
function failure(text) {
  let body;
  try { body = JSON.parse(text); } catch { return { status: 'fail', error: text }; }
  const ev = body.evidence || {};
  const notes = { ...(ev.stale && { stale: ev.stale }), ...(ev.unread && { unread: ev.unread }) };
  return ev.failedAt != null ? { status: 'fail', step: ev.failedAt, error: `${ev.tool}: ${ev.error}`, ...notes } : { status: 'fail', step: ev.step, error: body.message, ...notes };
}

// A green route's read of its page, for --baseline, and what changed since it was saved, as a note.
function passed(text) {
  let body = {};
  try { body = JSON.parse(text); } catch { /* a result with no read is still a pass */ }
  return { status: 'pass', ...(body.validity && { validity: body.validity }), ...(body.stale && { stale: body.stale }), ...(body.unread && { unread: body.unread }) };
}

// Every tested route in the catalogue (only: a regex on id; ids: a Set, as --since selects), each as one sf_run_route;
// a sideEffects one is a skip unless asked for. A route's records go after it, the run's after the last route.
// ponytail: one session, routes in turn; lanes of sessions when the full catalogue outgrows CI's time.
async function replay({ org, app, file, only, ids, values: given = {}, sideEffects = false, baseline = false, onResult = () => {}, onCleanup = () => {}, onError = () => {}, onProduction = () => {}, onLeftover = () => {}, onWarn = () => {}, signal, rest, tools, connect, madeDir }) {
  const { placeholders } = combinations.catalogue({ file });
  const tested = combinations.list({ file }).filter((e) => e.status === 'tested');
  const match = only && new RegExp(only);
  // One width for the whole run, so no route's name is a prefix of another's; at least 3 keeps the fixture's names.
  const width = Math.max(3, String(tested.length - 1).length);
  const plans = tested
    .map((entry, n) => ({ entry, routeIndex: String(n).padStart(width, '0'), skip: entry.sideEffects && !sideEffects && `sideEffects: ${entry.sideEffects}` }))
    .filter(({ entry }) => (!match || match.test(entry.id)) && (!ids || ids.has(entry.id)));
  // Planned before anything is made, so a placeholder no one can fill stops the run with nothing to clean up.
  const run = plans.filter((p) => !p.skip);
  for (const p of run) p.names = order(placeholders, p.entry.needs || [], given);
  const all = order(placeholders, run.flatMap((p) => p.names), given);
  const each = perRoute(placeholders, all);
  const stamp = String(Date.now()).slice(-7);
  const values = { ...given, stamp };
  const results = [];
  const cleanup = [];
  const errors = [];
  const made = [];
  let dir;
  const tempDir = () => (dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-')));
  const kept = ledger(org, madeDir, onWarn);
  // A delete that failed on the network (or a 5xx, a 429) is tried once more: a record left is a red run.
  const remove = (sobject, id) => validity.retryOnce(() => rest.remove(sobject, id));
  // Each record deleted leaves the file; one that fails stays there for the next run. Returns how many it deleted and
  // how many were already gone.
  const drop = async (records) => {
    let gone = 0;
    let already = 0;
    for (const r of records.reverse()) {
      await remove(r.sobject, r.id).then((v) => { kept.done(r); if (v === GONE) already += 1; else gone += 1; }, (e) => { cleanup.push({ sobject: r.sobject, id: r.id, error: String(e.message || e) }); onCleanup(cleanup.at(-1)); });
    }
    return [gone, already];
  };
  rest ??= await admin(org, connect);
  // What an earlier run on this org left goes before this run makes anything. A file that does not read is reported.
  let earlier = [];
  try { earlier = kept.left(); } catch (e) { errors.push(`records an earlier run left, in ${kept.dir}: ${e.message}`); onError(errors.at(-1)); }
  if (earlier.length) onLeftover(...await drop(earlier), earlier.length);
  let srv;
  try {
    srv = tools || await server();
    const started = await srv.call('sf_start', { org, budget: 0, ...(app && { app }) });
    if (started.isError) throw new SfUiError('START_FAILED', `sf_start ${org}: ${started.text}`, { org, app });
    const { production, userId: self } = JSON.parse(started.text);
    if (production) onProduction(org);
    // A production run skips a persona's route, so it makes nothing that only such a route needs.
    const needed = production ? order(placeholders, run.filter((p) => !p.entry.validity?.persona).flatMap((p) => p.names), given) : all;
    await make(placeholders, needed.filter((k) => !each.has(k)), values, { create: rest.create, made, tempDir, onMade: kept.add });
    let inApp = app;
    let red = false; // the last try that reached its route was red: a restart's failure names it
    let reached; // the try just made reached sf_run_route
    const users = new Map();
    for (const p of plans) {
      if (signal?.aborted) break; // stopped (a cancelled CI job): no more routes, cleanup still runs
      // The requirement a saved route proves rides with its result, so a reader judges the pass against it.
      const persona = p.entry.validity?.persona;
      // The tester keeps to the accounts a brief names, so a replay never picks a real user by itself.
      let skip = p.skip || (persona && production && 'persona: a replay on a production org logs in as no one');
      // Checked before any login or per-route record: a stale route costs neither. --baseline reads it anew, so it is not checked.
      // A bug in the check fails this route alone, never the replay.
      let check;
      let broke;
      const checkedAt = Date.now(); // a route the check stops reports the check's time
      if (!skip && p.entry.validity && !baseline) {
        try { check = await rest.check?.(p.entry.validity); } catch (e) { broke = `the check threw: ${String(e.message || e)}`; }
      }
      if (check?.state === 'stale') skip = `stale (${check.stale?.join('; ') || 'no reason given'}): remap it with the tester`;
      // What the check did not compare rides with the result: unknown and why, or a valid check's unchecked parts. The form
      // is left out: every route with a page compares it where it ends.
      const why = (check?.unchecked || []).filter((u) => u !== validity.formNote(p.entry.validity?.page?.object));
      const note = skip || broke || baseline ? undefined : !p.entry.validity ? 'unknown: no validity saved'
        : check?.state === 'unknown' ? ['unknown', why.join('; ')].filter(Boolean).join(': ') : why.length ? `unchecked: ${why.join('; ')}` : undefined;
      const r = { id: p.entry.id, status: broke ? 'fail' : 'skip', ms: check || broke ? Date.now() - checkedAt : 0, ...(broke ? { error: broke } : { reason: skip }), ...(check?.state === 'stale' && { remap: true }), ...(note && { note }), ...(p.entry.requirement && { requirement: p.entry.requirement }) };
      const mine = [];
      const attempt = async (routeIndex) => {
        const t0 = Date.now();
        let ran = false; // a refusal before sf_run_route (a placeholder record) left the page as it was; DOWN covers a login
        let got;
        try {
          // An entry's own app restarts the session in it; the next entry without one goes back to the run's.
          const want = p.entry.app ?? app;
          // ponytail: a restart relaunches the browser and logs in again; openApp in the live session would save that.
          if (!sameApp(want, inApp)) {
            inApp = DOWN; // a failed start leaves no session, so the next route starts one whatever its app
            const restarted = await srv.call('sf_start', { org, budget: 0, ...(want && { app: want }) });
            if (restarted.isError) throw new Error(`sf_start in app ${want}${red ? ' (restart after a red)' : ''}: ${restarted.text}`);
            inApp = want;
            red = false; // a new session: a later failed restart follows whatever ends this one, not an older red
          }
          if (persona) {
            const key = JSON.stringify(persona);
            if (!users.has(key)) users.set(key, await validity.userFor(rest.query, persona, self));
            const user = users.get(key);
            if (user !== self) { // the alias's user can hold the persona too
              inApp = DOWN; // the next route restarts as the alias's user
              const as = await srv.call('sf_login_as', { user, ...(want && { app: want }) });
              if (as.isError) throw new Error(`sf_login_as for ${persona.profile}: ${as.text}`);
            }
          }
          const v = await make(placeholders, p.names.filter((k) => each.has(k)), { ...values, routeIndex }, { create: rest.create, made: mine, tempDir, onMade: kept.add });
          ran = true;
          // Checked above (or read anew for --baseline), so sf_run_route does not check it again.
          const steps = combinations.fill(p.entry.route, v, placeholders);
          const out = await srv.call('sf_run_route', { steps, ...(p.entry.validity && { validity: p.entry.validity, onStale: 'run' }) }, routeCeiling(steps));
          got = out.isError ? failure(out.text) : passed(out.text);
        } catch (e) {
          got = { status: 'fail', error: String(e.message || e) };
        }
        got.ms = Date.now() - t0;
        // A red route can leave its browser in another app or user, so the next one restarts in its own app. A try
        // refused before its route leaves red as it was, so a rerun's failed restart keeps the hint for the next.
        reached = ran;
        if (ran) red = got.status === 'fail';
        if (ran && red) inApp = DOWN;
        return got;
      };
      if (!skip && !broke) {
        const t0 = Date.now();
        let got = await attempt(p.routeIndex);
        // A red in the route runs once more, on fresh per-route records (the run's are shared) and a fresh session, so a
        // flake does not fail CI; the first red rides along. Not a refusal before the route (a login, an app, a record: a rerun cannot change it), a
        // sideEffects route (a second run repeats its change), nor a red the changed page explains.
        if (reached && got.status === 'fail' && !got.stale && !p.entry.sideEffects && !signal?.aborted) {
          await drop(mine.splice(0));
          const first = got;
          // Its own index, r and the route's: a record the first try left (a failed delete, a save in the UI) or the
          // search index still lists never shares a name with the rerun's, nor with another route's rerun.
          got = await attempt(`r${p.routeIndex}`);
          Object.assign(got, { ms: Date.now() - t0, retried: { step: first.step, error: first.error } }); // the delete between counts
        }
        Object.assign(r, got);
      }
      results.push(r);
      onResult(r);
      await drop(mine);
    }
  } finally {
    // A server that will not end is reported, never thrown: a throw here would lose every result above.
    const ends = srv ? [['sf_end', () => srv.call('sf_end', {})], ['close', () => srv.close()]] : [];
    for (const [what, end] of ends) {
      try {
        const out = await end();
        if (out?.isError) throw new Error(out.text);
      } catch (e) {
        errors.push(`${what}: ${e.message || e}`);
        onError(errors.at(-1));
      }
    }
    await drop(made);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return { stamp, results, cleanup, errors };
}

// A failed try as one text, "step N error", for the CLI line and the JUnit report alike; either part can be missing.
const tried = ({ step, error }) => [step != null && `step ${step}`, error].filter(Boolean).join(' ');

// JUnit XML for a CI's test report: one testcase per route, the failing step and error as the failure message;
// an error is a testcase of its own: a string, or { name, message }. A suite name other than replay's is for verify.
function junit(results, errors = [], suite = 'sf-tester replay') {
  // A route stale to remap is red, as the CLI exits 1 for it, though it did not run.
  const kind = (r) => (r.remap ? 'fail' : r.status);
  const count = (status) => results.filter((r) => kind(r) === status).length;
  const body = { pass: () => '', fail: (r) => `<failure message="${esc([r.stale && `stale (${r.stale.join('; ')}):`, r.step != null && `step ${r.step}`, r.error || r.reason].filter(Boolean).join(' '))}"/>`, skip: (r) => `<skipped message="${esc(r.reason || '')}"/>` };
  // A route that ran twice says so in system-out, which every reader shows; a pass on rerun also carries Surefire's
  // flakyFailure, which flaky-test reporters read.
  const again = (r) => (r.retried && r.status === 'pass' ? `<flakyFailure message="${esc(tried(r.retried))}" type="rerun"/>` : '');
  const said = (r) => [r.note && `validity ${r.note}`, r.requirement && `requirement: ${r.requirement}`, r.retried && `rerun after a red: ${tried(r.retried)}`].filter(Boolean);
  const out = (r) => (said(r).length ? `<system-out>${esc(said(r).join('\n'))}</system-out>` : '');
  const cases = [...results.map((r) => `  <testcase classname="${suite.replace(/ /g, '.')}" name="${esc(r.id)}" time="${(r.ms / 1000).toFixed(3)}">${body[kind(r)](r)}${again(r)}${out(r)}</testcase>`),
    ...errors.map((e) => `  <testcase classname="${suite.replace(/ /g, '.')}" name="${esc(e.name ?? 'replay')}" time="0.000"><error message="${esc(e.message ?? e)}"/></testcase>`)];
  const secs = (results.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${suite}" tests="${cases.length}" failures="${count('fail')}" errors="${errors.length}" skipped="${count('skip')}" time="${secs}">\n${cases.join('\n')}\n</testsuite>\n`;
}

module.exports = { unxml, esc, order, perRoute, make, server, admin, failure, replay, junit, refs, tried, ledger };
