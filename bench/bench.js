#!/usr/bin/env node
'use strict';

// The known-route benchmark: does a tester that is given a checked route (B: listed, C: one sf_run_route call) spend
// fewer turns and tokens than one that explores (A)? D and E drop sf-tester for a generic Playwright MCP (E with the route
// as a guide), to measure what the sf-tester tools themselves buy; G is D with read-only sf CLI reads, the fair arm.
// Targets are the combinations catalogue, or a held-out corpus's own (--corpus); see README.md.
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { parseArgs: parseUtil } = require('node:util');
const path = require('node:path');
const { session, combinations } = require('..');

// Each arm and the tester agent it starts.
// G is the fair Playwright arm: D's tester plus read-only sf CLI reads (bench/sf-read-guard.js), as sf-tester has.
const AGENT = { A: 'sf-tester', B: 'sf-tester', C: 'sf-tester', D: 'pw-tester', E: 'pw-tester', G: 'pw-tester-cli' };
const ARMS = Object.keys(AGENT);
const OUTCOMES = ['caught', 'missed', 'refused', 'false-fail', 'pass', 'unfinished'];
const { DEFAULT_ROOT, benchRoot, beside, real, within } = require('./paths');
const { words, ORG_FLAGS, username } = require('./sh');
// Beside the bench dir, never inside it: the defect states, so no run name reaches them, and the uploads, whose
// path a brief prints, so it points no tester at the folder that lists the runs.
const stateDir = () => beside('defect-state');
const uploadFile = (key) => path.join(beside('uploads'), key, 'bench-upload.txt');
const runDir = (run) => path.join(benchRoot(), run);
const corpus = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'defects.json'), 'utf8'));
// A held-out corpus: { root, defects, targets } in one file the tester guard covers. Its patches resolve beside it, and the
// clean check covers the whole app tree, since the app is not test/fixture. A target makes no records: the app has its own.
function loadCorpus(file, { patches = true } = {}) {
  const key = real(path.resolve(benchRoot()));
  // Judged by its real path, as the guard judges it: a link counts where it points.
  const inKey = (p, what) => { const r = real(p); if (!within(r, key)) throw new Error(`${what}${r} is outside the bench folder ${benchRoot()}: a tester could read the key there`); return r; };
  const f = inKey(path.resolve(file), '');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const dir = path.dirname(f);
  // A patch shows the defect, so it must sit under the guard too; a revert skips this, since it is the way out.
  const patch = (d) => (patches ? inKey(path.resolve(dir, d.patch), `${d.id} patch `) : path.resolve(dir, d.patch));
  return { root: path.resolve(dir, c.root), spec: '.', defects: c.defects.map((d) => (d.patch ? { ...d, patch: patch(d) } : d)),
    targets: c.targets.map((t) => ({ status: 'tested', needs: [], ...t })) };
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function brief({ cell, entry, arm, values, org, instanceUrl }) {
  const route = entry.route && combinations.fill(entry.route, values); // a corpus target has none until a first run saves one
  const task = combinations.fill(entry.task, values);
  // A persona is reached the same way in every arm, as a person would: start as the alias owner, then Login As.
  const p = entry.persona && `${entry.persona.name} (${entry.persona.username})`;
  if (['D', 'E', 'G'].includes(arm)) return genericBrief({ cell, arm, route, task, org, instanceUrl, persona: p });
  const lines = [`Timed benchmark run ${cell} of the sf-tester. Work as you normally would.`, '',
    p ? `Org: ${org} (a scratch org). Persona: ${p}: start your own session with session "new" as the alias owner, then become that user with sf_login_as.`
      : `Org: ${org} (a scratch org). Persona: the alias owner (no sf_login_as). Start your own session with session "new".`, '',
    `Requirement: ${task}`, '',
    // The tester needs an app; with none named, the run would end BLOCKED instead of timing anything.
    `App: ${entry.app ?? 'none to pick: start with no app and test in the one the session opens'}`, '',
    // A timed cell measures; saving its route would grow the user's catalogue and add calls to the timing.
    'Do not save a route with sf_save_route.', ''];
  // A measures exploration, so it must not read the routes the other arms are given.
  if (arm === 'A') lines.push('This run measures finding the way yourself: do not call sf_combinations.', '');
  // B is one call per step; without saying so, the agent doc folds a listed route into sf_run_route, which is C.
  if (arm === 'B') lines.push('A known route for this requirement, already checked on this org. Run these sf-tester calls in this order, one call at a time, not with sf_run_route, adding your session id to each, then judge the requirement from what they return:',
    ...route.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`), '');
  if (arm === 'C') lines.push('A known route for this requirement, already checked on this org. Run it as one sf_run_route call with your session id and these steps, then judge the requirement from what it returns:',
    JSON.stringify(route), '');
  lines.push(`End your session with sf_end. Make the last line of your report exactly: RESULT ${cell}: PASS or RESULT ${cell}: FAIL`);
  return lines.join('\n');
}

// D, E and G run a generic Playwright tester: the same requirement, a browser already signed in as the alias owner, and
// the record URL form sf_open_record would use; E also gets the sf-tester route, in that tool set's words, as a guide.
function genericBrief({ cell, arm, route, task, org, instanceUrl, persona }) {
  const as = persona ? ` Test as ${persona}: become that user with Login As, from the user's detail page in Setup.` : '';
  const lines = [`Timed benchmark run ${cell} of the sf-tester. Work as you normally would.`, '',
    `Org: ${org} (a scratch org) at ${instanceUrl}. The browser is already signed in as the alias owner.${as} Open a record at ${instanceUrl}/lightning/r/<record id>/view.`, '',
    `Requirement: ${task}`, ''];
  if (arm === 'E') lines.push('A known route for this requirement, already checked on this org with a different tool set (the sf-tester MCP server, which you do not have). Use it as a guide to what to do and in what order:',
    JSON.stringify(route), '');
  if (arm === 'G') lines.push(`You also have the sf CLI for read-only reads of this org: sf data query, sf sobject describe or list, and sf api request rest (GET), each with -o ${org}.`, '');
  lines.push(`End with browser_close. Make the last line of your report exactly: RESULT ${cell}: PASS or RESULT ${cell}: FAIL`);
  return lines.join('\n');
}

// How a defect cell scored against its expected verdict. refused is a PASS expected where a tool refused the user's language
// (a tool error result carrying UNSUPPORTED_LANGUAGE) and the run did not PASS; what the agent wrote is not read for it.
function outcome(expected, result, refused) {
  if (!expected) return '';
  const refusal = expected === 'PASS' && refused;
  if (result === 'NONE' && !refusal) return 'unfinished';
  if (expected === 'FAIL') return result === 'FAIL' ? 'caught' : 'missed';
  return result === 'PASS' ? 'pass' : refusal ? 'refused' : 'false-fail';
}

// A tool result's JSON, parsed on first ask and kept; the error code, or under ROUTE_STEP_FAILED the failing step's own code.
const body = (r) => { if (!('parsed' in r)) { try { r.parsed = JSON.parse(r.raw); } catch { r.parsed = null; } } return r.parsed; };
const codeOf = (b) => (b?.code === 'ROUTE_STEP_FAILED' && b.evidence?.code) || b?.code;

// What caught it: the oracle of the first failed check an sf_scenario end or sf_end returned, else the first tool error's code,
// else none. What catches no defect is skipped: errors of sf_start, sf_scenario and sf_end, and BAD_ARGS, NO_SESSION or BUDGET_SPENT, also inside a route step.
function caughtBy(results) {
  const bad = results.filter((r) => r.name === 'sf_scenario' || r.name === 'sf_end').flatMap((r) => { const c = body(r)?.checks; return Array.isArray(c) ? c : []; }).find((c) => c.pass === false);
  if (bad) return bad.oracle;
  const err = results.filter((r) => r.error && !/^sf_(start|scenario|end)$/.test(r.name)).map(body).find((b) => b?.code && !['BAD_ARGS', 'NO_SESSION', 'BUDGET_SPENT'].includes(codeOf(b)));
  return err ? `error:${codeOf(err)}` : 'none';
}

// One run's numbers from its subagent transcript: turns are distinct assistant messages, tokens are summed per message.
function run({ cell, file, defect, expected, org }) {
  if (!fs.existsSync(file)) return null;
  const es = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const usage = new Map();
  const tools = [];
  const names = new Map();
  const results = [];
  const orgs = new Set(); // every org the run named: sf_start's org, a Bash sf command's -o or --target-org
  for (const e of es.filter((x) => x.type === 'user' && Array.isArray(x.message?.content))) {
    for (const c of e.message.content.filter((x) => x.type === 'tool_result')) {
      const raw = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join('');
      results.push({ id: c.tool_use_id, error: c.is_error, raw });
    }
  }
  const first = es.find((x) => x.type === 'assistant')?.message.usage || {};
  let text = '';
  for (const e of es.filter((x) => x.type === 'assistant')) {
    usage.set(e.message.id, e.message.usage || {});
    for (const c of e.message.content || []) {
      if (c.type === 'tool_use' && c.name !== 'ToolSearch') { tools.push(c.name.replace(/^mcp__(sf-tester|playwright)__/, '')); names.set(c.id, tools.at(-1)); }
      if (c.type === 'tool_use' && c.name === 'SubagentHandback') text += `${c.input?.message ?? ''}\n`; // the report the agent hands back
      if (c.type === 'tool_use' && c.name.endsWith('__sf_start') && c.input?.org) orgs.add(c.input.org);
      if (c.type === 'tool_use' && c.name === 'Bash') {
        // Read as the sf read guard reads it; a command it cannot split is one the guard refused, so it reached no org.
        let w = [];
        try { w = words(String(c.input?.command ?? '')); } catch { w = []; }
        if (w[0] === 'sf') w.forEach((x, i) => { const eq = x.startsWith('-') ? x.indexOf('=') : -1; const [f, v] = eq > 0 ? [x.slice(0, eq), x.slice(eq + 1)] : [x, w[i + 1]]; if (ORG_FLAGS.includes(f) && v) orgs.add(v); });
      }
      if (c.type === 'text') text += `${c.text}\n`;
    }
  }
  const sum = (k) => [...usage.values()].reduce((n, u) => n + (u[k] || 0), 0);
  // The last verdict line the agent wrote, markup allowed in front, in its own text; the brief's "PASS or FAIL" is not one.
  const verdict = [...text.matchAll(new RegExp(`^[\\s>*_\`#-]*RESULT ${escape(cell)}: (PASS|FAIL)(?!\\s*(?:or|/)\\s*RESULT)`, 'gm'))].at(-1);
  const result = verdict ? verdict[1] : 'NONE';
  for (const r of results) r.name = names.get(r.id);
  // Only an sf tool's error can be a catch or a refusal; ToolSearch, Read and the rest are the agent's plumbing.
  const sfResults = results.filter((r) => r.name?.startsWith('sf_'));
  // Check records and tool errors exist only for a run that called an sf tool; D, E and G results are never parsed.
  // A run that ended PASS caught nothing, so its tool errors are slips, not a catch.
  const sfRun = tools.some((t) => t.startsWith('sf_'));
  return {
    cell, result, defect, expected, outcome: outcome(expected, result, sfRun && sfResults.some((r) => r.error && codeOf(body(r)) === 'UNSUPPORTED_LANGUAGE')),
    caughtBy: sfRun && result !== 'PASS' ? caughtBy(sfResults) : '', turns: usage.size, calls: tools.length, sfCalls: tools.filter((t) => t.startsWith('sf_')).length,
    screenshots: tools.filter((t) => /screenshot/.test(t)).length,
    startCtx: (first.input_tokens || 0) + (first.cache_read_input_tokens || 0) + (first.cache_creation_input_tokens || 0),
    cacheRead: sum('cache_read_input_tokens'), fresh: sum('input_tokens') + sum('cache_creation_input_tokens'),
    cacheWrite: sum('cache_creation_input_tokens'), output: sum('output_tokens'), // priced apart from the rest of fresh
    wallS: Math.round((Date.parse(es.at(-1).timestamp) - Date.parse(es[0].timestamp)) / 1000),
    otherOrgs: [...orgs].filter((o) => username(o) !== username(org)).join(','), // an alias and its username are one org
    tools: tools.join(' '), // another org: reviewed, never dropped
  };
}

async function rest(org) {
  const a = await session.fromAlias(org);
  const call = async (p, init = {}) => {
    const r = await fetch(`${a.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${a.accessToken}`, 'Content-Type': 'application/json' } });
    if (!r.ok && r.status !== 404) throw new Error(`${init.method || 'GET'} ${p}: ${r.status} ${await r.text()}`);
    return r.status === 204 || r.status === 404 ? null : r.json();
  };
  // Every bench write goes through here, so a production org stops before the first one.
  const [row] = (await call(`/query?q=${encodeURIComponent(session.ORG_QUERY)}`)).records;
  if (session.isProduction(row)) throw new Error(`${org} is a production org: the benchmark never runs on production`);
  return call;
}

// One record set per cell, named after it, so no run writes another's records; every id is kept for cleanup.
// A defect id (or none, the control) tags every cell with it and its expected verdict; an id also limits the targets to its own.
function scope(defect, only, defects = corpus()) {
  if (!defect) return { only, tag: {} };
  if (defect === 'none') return { only: only || [...new Set(defects.map((x) => x.target))], tag: { defect, expected: 'PASS' } };
  const d = defects.find((x) => x.id === defect);
  if (!d) throw new Error(`no defect ${defect}; known: none, ${defects.map((x) => x.id).join(', ')}`);
  return { only: only || [d.target], tag: { defect, expected: d.expected } };
}

// Exit 1 is "does not reverse"; no git or a bad path is not an answer.
const patchIn = (d, root) => { try { execFileSync('git', ['apply', '-R', '--check', path.resolve(__dirname, d.patch)], { cwd: root, stdio: 'ignore' }); return true; } catch (e) { if (e.status !== 1) throw e; return false; } };
const patchOut = (d, root) => execFileSync('git', ['apply', '-R', path.resolve(__dirname, d.patch)], { cwd: root });

// The corpus defects applied now: a patch whose reverse applies to the working tree, any defect with a state file.
// This is the worktree and the state files, not the org: whether the fixture was deployed is not something it can see.
function appliedIds(defects = corpus(), root = path.join(__dirname, '..')) {
  const patched = defects.filter((d) => d.kind === 'patch' && patchIn(d, root)).map((d) => d.id);
  // Every state counts whatever its org, as in assertSingle: one defect at a time. A set: a state can sit beside a patch in the tree.
  return [...new Set([...patched, ...states().map((x) => x.id)])];
}

// Each tester gets a git status at spawn, so a patched file left in the tree would name the defect. The state file keeps
// the record the tree no longer holds, so the one-defect checks stay true until defect --revert.
function revertPatch(id, org, defects = corpus(), root = path.join(__dirname, '..')) {
  const d = defects.find((x) => x.id === id);
  if (d?.kind !== 'patch' || !patchIn(d, root)) return undefined;
  const file = stateFile(org, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, org })); // first: a clean tree with no record is the state this exists to prevent
  patchOut(d, root);
  return `${id}: reverted in the working tree, so no tester's git status names it; the org keeps it if you deployed it first`;
}

async function seed({ org, run: name, n = 3, arms = ['A', 'B', 'C'], only: asked_, defect, call: given, instanceUrl: url, applied, defects, root, spec, targets }) {
  const { only, tag } = scope(defect, asked_, defects || corpus());
  const asked = (c) => (only ? only.includes(c.id) : !c.sideEffects || process.env.SF_TESTER_REPLAY_SIDE_EFFECTS === '1'); // a side effect runs only when named
  const entries = (targets || combinations.list()).filter((c) => c.status === 'tested' && asked(c));
  // B, C and E give the target's route; a corpus target has none until a run saves one. Refused before the tree is touched.
  const routeless = entries.filter((e) => !e.route).map((e) => e.id);
  const routed = arms.filter((a) => ['B', 'C', 'E'].includes(a));
  if (routeless.length && routed.length) throw new Error(`arms ${routed.join(', ')} give a route, and ${routeless.join(', ')} has none: seed it with --arms A,D,G, or add its saved route to the target`);
  let reverted;
  // A cell's expected verdict holds only if that defect, and no other, is in place; a wrong tag would score a setup error as a tester miss.
  if (defect) {
    const now = applied || appliedIds(defects, root);
    if (defect === 'none' && now.length) throw new Error(`--defect none, but ${now.join(', ')} is applied: revert it first`);
    if (defect !== 'none' && (now.length !== 1 || now[0] !== defect)) {
      throw new Error(now.includes(defect) ? `${defect} is applied with ${now.filter((x) => x !== defect).join(', ')}: one defect at a time` : `${defect} is not applied: run defect --id ${defect} --apply and deploy the fixture first`);
    }
    // A state names one org: the cells must be seeded for that org.
    const st = states().find((x) => x.id === defect);
    if (st) sameOrg(st, org);
  }
  const dir = runDir(name);
  fs.mkdirSync(path.join(dir, 'briefs'), { recursive: true });
  // A caller can pass the REST call and the instance URL, which is how a test seeds without an org.
  const call = given || await rest(org);
  const instanceUrl = url || (await session.fromAlias(org)).instanceUrl;
  // After the org answers, so a bad alias leaves no state; before the records, so a retry finds the same tree.
  if (defect && !applied) { reverted = revertPatch(defect, org, defects, root); assertClean(root, spec); }
  // Records are named by a random token, never the run name: a tester reads record names, and a run name can carry the defect.
  const key = randomBytes(3).toString('hex');
  const cells = [];
  for (let i = 1; i <= n; i += 1) {
    for (const entry of entries) {
      for (const arm of arms) {
        const cell = `${entry.id}/${arm}${i}`;
        const label = `bench ${key} ${cell}`;
        const records = [];
        const make = async (sobject, body) => { const { id } = await call(`/sobjects/${sobject}`, { method: 'POST', body: JSON.stringify(body) }); records.push({ sobject, id }); return id; };
        const values = {};
        if (entry.needs.includes('accountId') || entry.needs.includes('accountName')) {
          values.accountName = label;
          values.accountId = await make('Account', { Name: label });
          values.contactName = `benchcontact ${key} ${i}`;
          await make('Contact', { LastName: values.contactName, AccountId: values.accountId });
        }
        if (entry.needs.includes('probeId') || entry.needs.includes('probeName')) {
          // A list search matches shared words, so the probe a list route searches for is one word no other cell has.
          values.probeName = entry.needs.includes('probeName') ? `bench${key}${cell}x`.replace(/\W/g, '') : label;
          values.probeId = await make('SfUiProbe__c', { Name: values.probeName, Tags__c: 'Alpha', Count__c: 1 });
        }
        if (entry.needs.includes('dynId')) values.dynId = await make('SfUiDyn__c', { Name: label });
        if (entry.needs.includes('childName')) {
          values.childName = `benchchild ${key} ${cell}`;
          await make('SfUiDyn__c', { Name: values.childName, Probe__c: values.probeId, Level__c: 'High', Note__c: 'child note' });
        }
        if (entry.needs.includes('uploadFile')) {
          values.uploadName = 'bench-upload.txt';
          // The brief prints this path, so it sits under the key, outside the bench folder.
          values.uploadFile = uploadFile(key);
          if (!fs.existsSync(values.uploadFile)) { fs.mkdirSync(path.dirname(values.uploadFile), { recursive: true }); fs.writeFileSync(values.uploadFile, 'bench upload'); }
        }
        const file = path.join(dir, 'briefs', `${cell.replace(/[/@]/g, '_')}.txt`);
        fs.writeFileSync(file, brief({ cell, entry, arm, values, org, instanceUrl }));
        cells.push({ cell, entry: entry.id, arm, ...tag, brief: file, records });
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'cells.json'), JSON.stringify({ org, run: name, key, createdAt: new Date().toISOString(), cells }, null, 2));
  return { dir, key, cells: cells.length, entries: entries.length, ...(reverted && { reverted }) }; // key: what the run's record names carry, to find them in the org
}

async function cleanup({ run: name, call: given }) {
  const { org, key, cells } = JSON.parse(fs.readFileSync(path.join(runDir(name), 'cells.json'), 'utf8'));
  const call = given || await rest(org);
  if (key) fs.rmSync(path.dirname(uploadFile(key)), { recursive: true, force: true }); // first, so a failed delete leaves no file behind
  // Children first: an account delete would take its contact with it and leave a 404, which is fine too.
  const all = cells.flatMap((c) => c.records).reverse();
  for (const r of all) await call(`/sobjects/${r.sobject}/${r.id}`, { method: 'DELETE' });
  return { deleted: all.length };
}

// The state of a user defect, or of a patch defect seed took out of the tree: <org>__<id>.json, the org percent-encoded so two orgs never share a name.
const stateFile = (org, id) => path.join(stateDir(), `${encodeURIComponent(org)}__${id}.json`);
const readState = (file) => { try { return { file, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { throw new Error(`${file}: ${e.message}`); } };
const sameOrg = (s, org) => { if (s.org !== org) throw new Error(`${s.id} was applied on ${s.org}, not ${org}`); };
const stateFiles = () => { const dir = stateDir(); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []; };
const states = () => stateFiles().map(readState);

// One defect at a time, across kinds: no change under test/fixture, or the whole app tree for a corpus (staged and
// untracked count), and no state file.
// git status exits 0 or fails, so a failure (no git, not a repo) throws rather than reading as a clean fixture.
function assertClean(root = path.join(__dirname, '..'), spec = 'test/fixture') {
  if (execFileSync('git', ['status', '--porcelain', '--', spec], { cwd: root, encoding: 'utf8' }).trim()) {
    throw new Error(`${spec === '.' ? root : spec} has uncommitted changes: revert the applied defect first`);
  }
}

function assertSingle(root, spec) {
  assertClean(root, spec);
  const [left] = states();
  if (left) throw new Error(`a defect is applied (${left.file}): revert it first`);
}

const current = async (api, userId, field) => (await api(`/sobjects/User/${userId}?fields=${field}`))?.[field];

// Applies or reverts one corpus defect. It never deploys: the caller deploys the fixture after each. A user defect keeps
// the old value in the bench dir, and a second apply is refused so that the first value is not overwritten.
async function defect({ id, op, org, call, username = session.aliasUsername, defects = corpus(), root = path.join(__dirname, '..'), spec }) {
  const d = defects.find((x) => x.id === id);
  // A state from another defect list blocks every later apply, so name the way out. A corrupt state is not this case.
  // Each state read alone: a corrupt one neither hides a readable one that names the id nor goes unreported.
  const unreadable = [];
  const held = !d && stateFiles().map((f) => { try { return readState(f); } catch { unreadable.push(f); return null; } }).find((x) => x?.id === id);
  if (held) throw new Error(`no defect ${id} in this list, but ${held.file} names it: revert it with the defects it was applied with (its --corpus, or none)`);
  if (!d) throw new Error(`no defect ${id}; known: ${defects.map((x) => x.id).join(', ')}${unreadable.length ? `; unreadable state: ${unreadable.join(', ')}` : ''}`);
  if (d.kind === 'patch') {
    // A revert is the way out of a dirty fixture, so only an apply is checked.
    if (op === 'apply') { assertSingle(root, spec); execFileSync('git', ['apply', path.resolve(__dirname, d.patch)], { cwd: root }); return { id, op }; }
    // Seed took the patch out of the tree, so a revert clears its record; the tree is reverted only if it is back there.
    const seeded = states().find((x) => x.id === id);
    if (seeded && org) sameOrg(seeded, org);
    if (!seeded || patchIn(d, root)) patchOut(d, root);
    if (seeded) fs.unlinkSync(seeded.file);
    return { id, op, ...(seeded && { org: seeded.org }) };
  }
  // The state is per org and defect: --org is the one value both the apply and the revert must give.
  if (!org) throw new Error(`${id} is a user defect: --org is required`);
  const file = stateFile(org, id);
  const { field, value } = d.user;
  if (op === 'apply') {
    if (fs.existsSync(file)) throw new Error(`${id} is already applied (${file}); revert it first`);
    assertSingle(root, spec);
    const api = call || await rest(org);
    const name = await username(org);
    const u = (await api(`/query?q=${encodeURIComponent(`SELECT Id, ${field} FROM User WHERE Username = '${name}'`)}`)).records[0];
    if (!u) throw new Error(`no User with username ${name}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id, org, userId: u.Id, field, old: u[field] }));
    // A failed PATCH may still have landed, so the state goes only if the field reads the old value; unreadable keeps it.
    await api(`/sobjects/User/${u.Id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) }).catch(async (e) => {
      if (await current(api, u.Id, field).catch(() => undefined) === u[field]) fs.unlinkSync(file);
      throw e;
    });
    return { id, op, userId: u.Id, field, old: u[field], value };
  }
  if (!fs.existsSync(file)) throw new Error(`${id} is not applied on ${org}: no ${file}`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The file name says the org too; the saved org is what the restore goes to, so a mismatch stops before any PATCH.
  sameOrg(saved, org);
  const api = call || await rest(org);
  await api(`/sobjects/User/${saved.userId}`, { method: 'PATCH', body: JSON.stringify({ [saved.field]: saved.old }) });
  // A 404 reads back as nothing, which is not the old value; the state stays until the field is seen restored.
  const now = await current(api, saved.userId, saved.field);
  if (now !== saved.old) throw new Error(`${id}: ${saved.field} reads ${now} after the restore, expected ${saved.old}; ${file} kept`);
  fs.unlinkSync(file);
  return { id, op, userId: saved.userId, field: saved.field, restored: saved.old };
}

// The signed-in browser state for the Playwright MCP of arms D, E and G (--storage-state): a frontdoor session, saved
// to a file outside the repo and never printed. sf-tester's end closes the browser without logging out, so it stays valid.
async function auth({ org, out }) {
  await rest(org); // refuses a production org before any login
  const s = await session.start(await session.fromAlias(org));
  try {
    await s.context.storageState({ path: out });
  } finally {
    await session.end(s);
  }
  fs.chmodSync(out, 0o600);
  return { out, cookies: JSON.parse(fs.readFileSync(out, 'utf8')).cookies.length };
}

// "cell agentId" for every transcript whose first message is a benchmark brief, so a workflow run needs no hand log.
function spawned(transcripts) {
  return fs.readdirSync(transcripts).filter((f) => /^agent-.+\.jsonl$/.test(f)).sort().map((f) => {
    // A workflow puts a harness message before the brief, so look through the opening user messages.
    const opening = fs.readFileSync(path.join(transcripts, f), 'utf8').split('\n').slice(0, 5).filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === 'user');
    const text = opening.map((e) => (typeof e.message?.content === 'string' ? e.message.content : (e.message?.content || []).map((c) => c.text || '').join(''))).join('\n');
    const cell = text.match(/Timed benchmark run (\S+) of the sf-tester/);
    return cell && `${cell[1]} ${f.slice(6, -6)}`;
  }).filter(Boolean);
}

// spawn.log: one "cell agentId" line per spawned tester; a line starting with # is excluded (and says why).
// With no spawn.log, it is written from the transcripts' briefs.
function metrics({ run: name, transcripts }) {
  const dir = runDir(name);
  const { cells, org } = JSON.parse(fs.readFileSync(path.join(dir, 'cells.json'), 'utf8'));
  const log = path.join(dir, 'spawn.log');
  if (!fs.existsSync(log)) fs.writeFileSync(log, spawned(transcripts).filter((l) => cells.some((c) => c.cell === l.split(' ')[0])).join('\n') + '\n');
  const byCell = Object.fromEntries(cells.map((c) => [c.cell, c]));
  const rows = fs.readFileSync(path.join(dir, 'spawn.log'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [cell, agent] = l.split(/\s+/); const c = byCell[cell]; return { ...run({ cell, file: path.join(transcripts, `agent-${agent}.jsonl`), defect: c?.defect, expected: c?.expected, org }), entry: c?.entry, arm: c?.arm }; })
    .filter((r) => r.turns !== undefined);
  const cols = ['cell', 'defect', 'expected', 'outcome', 'caughtBy', 'result', 'turns', 'calls', 'sfCalls', 'screenshots', 'startCtx', 'cacheRead', 'fresh', 'cacheWrite', 'output', 'wallS', 'otherOrgs', 'tools'];
  fs.writeFileSync(path.join(dir, 'metrics.tsv'), [cols.join('\t'), ...rows.map((r) => cols.map((c) => r[c]).join('\t'))].join('\n') + '\n');
  const mean = (rs, k) => (rs.length ? Math.round(rs.reduce((n, r) => n + r[k], 0) / rs.length) : 0);
  // n, pass and the means are over finished cells; the outcome counts are over all of a group's cells, so out_unfinished shows.
  const done = (x) => x.result !== 'NONE' || x.outcome === 'refused';
  const counts = (rs) => OUTCOMES.map((o) => rs.filter((r) => r.outcome === o).length).join('\t');
  const line = (k, rs) => { const fin = rs.filter(done); return `${k}\t${fin.length}\t${fin.filter((r) => r.result === 'PASS').length}\t${mean(fin, 'turns')}\t${mean(fin, 'cacheRead')}\t${mean(fin, 'wallS')}\t${counts(rs)}`; };
  const groups = {};
  for (const r of rows) (groups[`${r.entry}\t${r.defect || ''}\t${r.arm}`] ||= []).push(r);
  const summary = Object.entries(groups).sort().map(([k, rs]) => line(k, rs));
  const arms = ARMS.map((arm) => { const rs = rows.filter((r) => r.arm === arm); return rs.length ? line(`ALL\t\t${arm}`, rs) : null; }).filter(Boolean);
  const out = [`entry\tdefect\tarm\tn\tpass\tturns\tcacheRead\twallS\t${OUTCOMES.map((o) => `out_${o}`).join('\t')}`, ...summary, ...arms].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'summary.tsv'), out);
  const elsewhere = rows.filter((r) => r.otherOrgs);
  return { runs: rows.length, unfinished: rows.filter((r) => !done(r)).map((r) => r.cell), otherOrg: `${elsewhere.length} of ${rows.length}`, otherOrgCells: elsewhere.map((r) => r.cell), summary: out };
}

// Strict, as src/cli.js: an unknown option or a missing value throws. apply and revert are flags; a value may not be empty and --n is a positive integer.
const OPTIONS = { apply: { type: 'boolean' }, revert: { type: 'boolean' }, n: { type: 'string' } };
for (const k of ['org', 'run', 'arms', 'only', 'defect', 'transcripts', 'out', 'id', 'corpus']) OPTIONS[k] = { type: 'string' };
function parseArgs(args) {
  const { values } = parseUtil({ args, options: OPTIONS, strict: true, allowPositionals: false });
  for (const [k, v] of Object.entries(values)) if (v === '') throw new Error(`--${k} needs a value`);
  if (values.n !== undefined && !/^[1-9]\d*$/.test(values.n)) throw new Error(`--n must be a positive integer, got ${values.n}`);
  return { ...values };
}

// What each command needs on its command line; a defect needs exactly one of --apply and --revert, and --org for a user defect.
// The CLI passes the corpus it loaded (opt.loaded); a direct caller with only --corpus gets it read here.
function cliOk(cmd, opt) {
  if (cmd === 'defect') return Boolean(opt.id) && Boolean(opt.apply) !== Boolean(opt.revert) && !((opt.loaded?.defects ?? (opt.corpus ? loadCorpus(opt.corpus).defects : corpus())).find((x) => x.id === opt.id)?.kind === 'user' && !opt.org);
  const needs = { seed: ['run', 'org'], metrics: ['run', 'transcripts'], cleanup: ['run'], auth: ['org', 'out'] }[cmd];
  return Boolean(needs) && needs.every((k) => opt[k]);
}

// The tools that can reach a local file, each of which the guard must see before it runs.
const GUARDED = ['Read', 'Grep', 'Glob', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_tabs', 'mcp__playwright__browser_file_upload', 'mcp__playwright__browser_drop', 'mcp__sf-tester__sf_upload_file', 'mcp__sf-tester__sf_run_route', 'mcp__sf-tester__sf_save_route', 'mcp__sf-tester__sf_verify_checks'];
// An agent file's frontmatter runs agents/guard.js before every guarded tool it lists.
function wiresGuard(text) {
  const head = text.split('\n---')[0];
  const line = head.match(/^tools:(.*)$/m);
  if (!line || !line[1].trim()) return false; // no list: the agent has every tool
  const tools = line[1].split(',').map((t) => t.trim());
  // The matcher of the hook entry that runs the guard, not merely the first one.
  const entry = head.split(/^\s*- matcher:/m).slice(1).find((e) => /\/agents\/guard\.js" \|\| exit 2'/.test(e));
  const matcher = (entry?.match(/^\s*"([^"]*)"/)?.[1] ?? '').split('|');
  // Bash reaches any file, so an agent with it must also run bench/sf-read-guard.js before every Bash call.
  const bash = !tools.includes('Bash') || head.split(/^\s*- matcher:/m).slice(1).some((e) => /^\s*"Bash"/.test(e) && /\/sf-read-guard\.js" \|\| exit 2'/.test(e));
  return Boolean(entry) && bash && GUARDED.filter((t) => tools.includes(t)).every((t) => matcher.includes(t));
}
// The tester agents the arms start, as installed, that run no guard: no link, no guard.js beside its target, or no hook.
function unguarded(arms, dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'agents')) {
  const names = [...new Set(arms.map((a) => AGENT[a] ?? `arm ${a} (no such arm)`))];
  return names.filter((n) => {
    const f = path.join(dir, `${n}.md`);
    if (!fs.existsSync(f)) return true;
    const target = fs.realpathSync(f);
    return !fs.existsSync(path.join(path.dirname(target), '..', 'agents', 'guard.js')) || !wiresGuard(fs.readFileSync(target, 'utf8'));
  });
}

module.exports = { brief, run, unguarded, wiresGuard, scope, appliedIds, spawned, seed, cleanup, metrics, auth, defect, parseArgs, cliOk, corpus, loadCorpus, runDir, stateDir, ARMS };

const USAGE = 'usage: bench.js seed --org <alias> --run <name> [--n 3] [--arms A,B,C,D,E,G] [--only id,id] [--defect <id|none>] [--corpus <file>] | metrics --run <name> --transcripts <dir> | cleanup --run <name> | auth --org <alias> --out <file> | defect --id <id> --apply|--revert [--org <alias>, required for a user defect] [--corpus <file>]';

if (require.main === module) {
  const [cmd, ...rest_] = process.argv.slice(2);
  let opt;
  try { opt = parseArgs(rest_); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
  // The tester guard (agents/guard.js) protects ~/.sf-tester paths, so a run or defect-state folder moved elsewhere would be readable.
  const unmoved = () => {
    const b = process.env.SF_TESTER_BENCH;
    if (b && path.resolve(b) !== DEFAULT_ROOT) throw new Error(`SF_TESTER_BENCH moves the bench folders out of the tester guard: unset it to ${cmd}`);
  };
  const go = { seed: () => {
    unmoved();
    const arms = opt.arms ? opt.arms.split(',') : ARMS;
    const unknown = arms.filter((a) => !ARMS.includes(a));
    if (unknown.length) throw new Error(`no such arm ${unknown.join(', ')}: the arms are ${ARMS.join(', ')}`);
    const open = unguarded(arms);
    if (open.length) throw new Error(`testers can read the answer key: ${open.join(', ')} as installed runs no agents/guard.js; link it from a checkout that has the guard (README.md, Setup)`);
    return seed({ org: opt.org, run: opt.run, n: Number(opt.n || 3), arms, only: opt.only && opt.only.split(','), defect: opt.defect, ...opt.loaded });
  },
    cleanup: () => cleanup({ run: opt.run }), metrics: () => metrics({ run: opt.run, transcripts: opt.transcripts }),
    auth: () => auth({ org: opt.org, out: opt.out }),
    // A revert is the way out, so only an apply is refused.
    defect: () => { if (opt.apply) unmoved(); return defect({ id: opt.id, op: opt.apply ? 'apply' : 'revert', org: opt.org, ...opt.loaded }); } }[cmd];
  if (!go) { console.error(USAGE); process.exit(2); }
  // Only seed and defect read a corpus. Loaded once, with the CLI's own error handling: one line and exit 1, no stack trace.
  try { opt.loaded = ['seed', 'defect'].includes(cmd) && opt.corpus && loadCorpus(opt.corpus, { patches: !(cmd === 'defect' && opt.revert) }); } catch (e) { console.error(e.message); process.exit(1); }
  if (!cliOk(cmd, opt)) { console.error(USAGE); process.exit(2); }
  Promise.resolve().then(go).then((r) => console.log(typeof r.summary === 'string' ? `${JSON.stringify({ ...r, summary: undefined })}\n${r.summary}` : JSON.stringify(r))).catch((e) => { console.error(e.message); process.exit(1); });
}
