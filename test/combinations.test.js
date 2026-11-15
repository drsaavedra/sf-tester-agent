'use strict';

// The combinations catalogue: list filters and fills placeholders without an org; on the fixture org every tested
// entry's route is replayed through sf_run_route, so a route that stops working goes red here, not in a tester run.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { combinations } = require('..');
const { replay } = require('../src/replay');
const { auth, env, skip } = require('./helpers');

test('combinations list filters by component and container, any case', () => {
  const all = combinations.list();
  assert.ok(all.length >= 16, `${all.length} entries`);
  assert.deepEqual(combinations.list({ component: 'COMBOBOX', container: 'modal' }).map((c) => c.id), ['combobox@lightning-modal']);
  assert.deepEqual(combinations.list({ component: 'no such component' }), []);
  // The card a requirement names is in the task, not the component: an LWC name finds it, punctuation aside.
  for (const name of ['sf-ui-inputs', 'SF UI Inputs']) assert.ok(combinations.list({ component: name, container: 'sidebar' }).some((c) => c.id === 'combobox@sidebar'), name);
  const ids = all.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

// The fixture replays on a scratch org and on CI's Developer Edition org. A standard app and a standard object's form differ
// between those (26 of 26 routes on CI), so a baseline of them would mark every route on one org as changed.
test('a fixture baseline holds only what the fixture ships', () => {
  const held = combinations.list({ file: combinations.BUNDLED }).filter((c) => c.validity);
  assert.ok(held.length >= 200, `${held.length} baselines`);
  for (const { id, validity } of held) {
    // A persona route (id ~persona) keeps only its persona: the replay needs it to log in as a matching user.
    if (id.includes('~')) { assert.deepEqual(Object.keys(validity), ['persona'], `${id}: persona only`); continue; }
    assert.deepEqual(Object.keys(validity), ['page'], `${id}: no app part`);
    assert.match(validity.page.object, /__c$/, `${id}: a custom object`);
  }
});

test('fill puts the run\'s values into a route and refuses a missing one', () => {
  const entry = combinations.list({ component: 'record-picker', container: 'sidebar' })[0];
  const route = combinations.fill(entry.route, { dynId: 'a01X', accountName: 'Acme' });
  assert.equal(route[0].args.recordId, 'a01X');
  assert.equal(route.at(-1).args.text, 'Company chosen: Acme');
  assert.doesNotMatch(JSON.stringify(route), /\{\{/);
  assert.throws(() => combinations.fill(entry.route, { dynId: 'a01X' }), { code: 'BAD_ARGS' });
});

test('sf_combinations serves the catalogue with its placeholders and needs no session', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-combinations-tool', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'sf_combinations', arguments: { container: 'sidebar' } });
  const body = JSON.parse(r.content[0].text);
  assert.equal(r.isError, undefined, r.content[0].text);
  assert.deepEqual(body.combinations.map((c) => c.id), combinations.list({ container: 'sidebar' }).map((c) => c.id));
  assert.ok(body.combinations.length >= 3 && body.combinations[0].route.length, JSON.stringify(body).slice(0, 300));
  assert.equal(typeof body.placeholders.probeId, 'string');
});

// With no filter the whole catalogue is too big to read (500k chars at 324 entries), so it comes back as an index:
// each component once, with the containers its route is tested in, a legend for those, and the candidates apart.
test('sf_combinations with no filter lists every tested id by component, and candidates apart', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-combinations-index', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'sf_combinations', arguments: {} });
  const body = JSON.parse(r.content[0].text);
  const all = combinations.list();
  const tested = all.filter((c) => c.status === 'tested');
  // Every tested id comes back as component@slug, a slug with a note after it keeps its own interaction.
  const ids = Object.entries(body.components).flatMap(([comp, { in: where }]) => where.map((w) => `${comp}@${w.split(' (')[0]}`));
  assert.deepEqual(ids.sort(), tested.map((c) => c.id).sort(), 'every tested entry is listed once');
  assert.deepEqual(Object.keys(body.containers).sort(), [...new Set(tested.map((c) => c.id.split('@')[1]))].sort());
  assert.equal(body.containers['record-tab'], 'record page tab');
  assert.deepEqual(body.candidates.map((c) => c.id), all.filter((c) => c.status !== 'tested').map((c) => c.id));
  assert.ok(body.candidates.length >= 1, 'the bundled catalogue holds a candidate');
  assert.equal(body.components['inline-edit'].in.filter((w) => w.includes(' (')).length, 1, 'a different interaction is noted beside its slug');
  // The budget keeps the index readable in one call; it grows with the catalogue (15,188 chars at the Task routes).
  assert.ok(r.content[0].text.length < 17_000, `${r.content[0].text.length} chars`);
  const one = JSON.parse((await client.callTool({ name: 'sf_combinations', arguments: { component: tested[0].id } })).content[0].text);
  assert.equal(one.combinations[0].id, tested[0].id);
  assert.ok(one.combinations[0].route.length, 'a filtered entry carries its route');
});

// A catalogue of the user's own org routes: read in place of the bundled one, fresh on every call; not there yet is empty.
test('SF_TESTER_COMBINATIONS names a catalogue of your own that sf_combinations reads instead', { timeout: 30_000 }, async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'combinations.json');
  const own = { about: 'mine', placeholders: { caseId: 'a Case Id' }, combinations: [{ id: 'button@case-page', component: 'lightning-button', container: 'record page', interaction: 'press', task: 'Press Escalate on {{caseId}}', needs: ['caseId'], route: [{ tool: 'sf_click', args: { recordId: '{{caseId}}', role: 'button', name: 'Escalate' } }], status: 'tested' }] };
  const client = new Client({ name: 'sf-ui-own-combinations', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_COMBINATIONS: file } }));
  t.after(() => client.close());
  const read = async () => {
    const r = await client.callTool({ name: 'sf_combinations', arguments: {} });
    assert.equal(r.isError, undefined, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  assert.deepEqual((await read()).components, {}, 'a missing file is an empty catalogue');
  fs.writeFileSync(file, JSON.stringify(own));
  const body = await read();
  assert.deepEqual(body.components, { button: { does: 'press', in: ['case-page'] } });
  assert.deepEqual(body.containers, { 'case-page': 'record page' });
  assert.deepEqual(body.placeholders, own.placeholders);
  assert.deepEqual(combinations.list({ file, component: 'BUTTON' }).map((c) => c.id), ['button@case-page']);
});

// A route a tester checked goes into the user's file as a candidate: listed, never replayed until a person tests it.
test('sf_save_route appends a checked route to your catalogue as a candidate, and refuses what it must not write', { timeout: 30_000 }, async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'combinations.json');
  const connect = async (env) => {
    const client = new Client({ name: 'sf-ui-save-route', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env }));
    t.after(() => client.close());
    return async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      const text = r.content[0].text; // a schema refusal is plain text
      return { error: r.isError, body: text.startsWith('{') ? JSON.parse(text) : { text } };
    };
  };
  const entry = { id: 'button@case-page', component: 'lightning-button', container: 'record page', interaction: 'press', task: 'Press Escalate on {{caseId}}', requirement: 'Escalate marks the case Escalated', needs: ['caseId'], route: [{ tool: 'sf_click', args: { recordId: '{{caseId}}', role: 'button', name: 'Escalate' } }, { tool: 'sf_wait', args: { text: 'Escalated', timeoutMs: 10000 } }] };

  const bundled = fs.readFileSync(combinations.BUNDLED, 'utf8');
  const unset = await (await connect(undefined))('sf_save_route', entry);
  assert.equal(unset.error, true, 'refused without SF_TESTER_COMBINATIONS');
  assert.equal(unset.body.code, 'NO_CATALOGUE');
  assert.equal(fs.readFileSync(combinations.BUNDLED, 'utf8'), bundled, 'the bundled catalogue is never written');

  const call = await connect({ ...process.env, SF_TESTER_COMBINATIONS: file });
  const saved = await call('sf_save_route', entry);
  assert.equal(saved.error, undefined, JSON.stringify(saved.body));
  const listed = (await call('sf_combinations', { component: 'button@case-page' })).body.combinations;
  assert.deepEqual(listed.map((c) => [c.id, c.status, c.verified.by]), [['button@case-page', 'candidate', 'sf-tester run']]);
  assert.match(listed[0].verified.on, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(listed[0].route, entry.route);
  assert.equal(listed[0].requirement, 'Escalate marks the case Escalated', 'the requirement it proves is kept with it');
  const { requirement, ...bare } = entry;
  assert.match((await call('sf_save_route', { ...bare, id: 'f' })).body.text ?? '', /requirement/, 'a route without its requirement is refused');
  assert.equal(combinations.list({ file }).filter((c) => c.status === 'tested').length, 0, 'a candidate is not replayed');

  assert.equal((await call('sf_save_route', entry)).body.code, 'DUPLICATE_ID');
  const notAStep = await call('sf_save_route', { ...entry, id: 'b', route: [{ tool: 'sf_start', args: { org: 'x' } }] });
  assert.equal(notAStep.body.code, 'BAD_ARGS', JSON.stringify(notAStep.body));
  const badArgs = await call('sf_save_route', { ...entry, id: 'c', route: [{ tool: 'sf_wait', args: { bogus: 1 } }] });
  assert.equal(badArgs.body.code, 'BAD_ARGS', JSON.stringify(badArgs.body));
  const ahead = await call('sf_save_route', { ...entry, id: 'd', route: [{ tool: 'sf_wait', args: { text: '{{step0.recordId}}' } }] });
  assert.equal(ahead.body.code, 'BAD_ARGS', `a reference to a step not yet run, as sf_run_route refuses: ${JSON.stringify(ahead.body)}`);
  assert.equal(combinations.list({ file }).length, 1, 'a refused route adds nothing');
  await call('sf_save_route', { ...entry, id: 'e', app: 'SF UI Console' });
  assert.deepEqual(combinations.list({ file }).map((c) => [c.id, c.app]), [['button@case-page', undefined], ['e', 'SF UI Console']], 'the app it was checked in is kept');
  const validity = { page: { object: 'Case', formHash: 'abc' } };
  await call('sf_save_route', { ...entry, id: 'f', validity });
  assert.deepEqual(combinations.list({ file }).map((c) => c.validity), [undefined, undefined, validity], 'the validity of its run is kept, and a route saved with none has none');
  for (const bad of [{ page: { object: 'Case', formHash: 'abc', extra: 'x' } }, { ...validity, extra: 'x' }]) {
    assert.match((await call('sf_save_route', { ...entry, id: 'g', validity: bad })).body.text ?? '', /validity|extra|Unrecognized/i, `not a read sf_run_route could return: ${JSON.stringify(bad)}`);
  }
  await call('sf_save_route', { ...entry, id: 'h', replaces: 'f' });
  assert.deepEqual(combinations.list({ file }).map((c) => c.replaces), [undefined, undefined, undefined, 'f'], 'a remap names the stale route it was found again for');
  const auto = await call('sf_save_route', { ...entry, id: 'i', replaces: 'f', promote: true });
  assert.deepEqual([auto.body.promoted, auto.body.mode], [false, 'auto'], 'a remap is never promoted by the tester, even in auto mode');
});

// Two replays on one org, or two workers as one user, would make two Tasks with one fixed Subject in one save window,
// which a Task create cannot tell apart (CREATE_UNCONFIRMED): every create route stamps the Subject it types.
test('every bundled create route stamps the Subject it types per route', () => {
  const routes = combinations.catalogue({ file: path.join(__dirname, '..', 'src', 'combinations.json') }).combinations.filter((c) => c.route.some((x) => x.tool === 'sf_create_record'));
  const subjects = routes.flatMap((c) => c.route.filter((x) => x.tool === 'sf_set_fields' && x.args.values.Subject != null).map((x) => [c.id, x.args.values.Subject]));
  assert.ok(subjects.some(([id]) => id === 'new-task@task-new-dialog'), `checked ${subjects.length}: ${subjects.map(([id]) => id).join()}`);
  assert.deepEqual(subjects.filter(([, v]) => !/\{\{stamp\}\}n\{\{routeIndex\}\}/.test(v)), []);
});

test('a hand-edited null task or requirement does not break a lookup', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-null-')), 'c.json');
  const route = [{ tool: 'sf_open_tab', args: { tab: 'X' } }];
  fs.writeFileSync(file, JSON.stringify({ placeholders: {}, combinations: [{ id: 'a@x', task: null, requirement: null, route, status: 'tested' }, { id: 'b@x', task: 'Press Go', requirement: null, route, status: 'tested' }], candidates: [] }));
  assert.deepEqual(combinations.list({ component: 'press', file }).map((c) => c.id), ['b@x']);
  assert.deepEqual(combinations.list({ component: 'a@x', file }).map((c) => c.id), ['a@x'], 'control: the id still finds its entry');
});

test('promoting a remap retires the stale route it names, and keeps it under replaced', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-remap-')), 'c.json');
  const route = [{ tool: 'sf_open_tab', args: { tab: 'X' } }];
  fs.writeFileSync(file, JSON.stringify({ placeholders: {}, combinations: [{ id: 'old@x', route, status: 'tested' }, { id: 'other@x', route, status: 'tested' }], candidates: [{ id: 'new@scenario', route, replaces: 'old@x' }, { id: 'plain@scenario', route }] }));
  assert.equal(combinations.promote('new@scenario', { file }).retired, 'old@x');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(all.combinations.map((c) => c.id), ['other@x', 'new@scenario']);
  assert.deepEqual([all.replaced[0].id, all.replaced[0].replacedBy.id], ['old@x', 'new@scenario']);
  assert.equal(combinations.list({ file }).some((c) => c.id === 'old@x'), false, 'no lookup reaches it');
  assert.equal(combinations.promote('plain@scenario', { file }).retired, undefined, 'control: a plain candidate retires nothing');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).combinations.length, 3);
});

test('a second remap of one stale route cannot be promoted once the first retired it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-remap-')), 'c.json');
  const route = [{ tool: 'sf_open_tab', args: { tab: 'X' } }];
  fs.writeFileSync(file, JSON.stringify({ placeholders: {}, combinations: [{ id: 'old@x', route, status: 'tested' }], candidates: [{ id: 'a@scenario', route, replaces: 'old@x' }, { id: 'b@scenario', route, replaces: 'old@x' }] }));
  combinations.promote('a@scenario', { file });
  assert.throws(() => combinations.promote('b@scenario', { file }), (e) => e.code === 'ALREADY_REPLACED' && e.evidence.replacedBy === 'a@scenario' && /run the remap again/.test(e.message));
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([all.combinations.map((c) => c.id), all.candidates.map((c) => c.id)], [['a@scenario'], ['b@scenario']], 'the refused draft stays a candidate, and nothing else moved');
});

test('a remap of a live route whose id was retired before retires it again', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-remap-')), 'c.json');
  const route = [{ tool: 'sf_open_tab', args: { tab: 'X' } }];
  fs.writeFileSync(file, JSON.stringify({ placeholders: {}, combinations: [{ id: 'X@s', route, status: 'tested' }], candidates: [{ id: 'A@s', route, replaces: 'X@s' }] }));
  combinations.promote('A@s', { file });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.candidates.push({ id: 'X@s', route }, { id: 'B@s', route, replaces: 'X@s' });
  fs.writeFileSync(file, JSON.stringify(all));
  combinations.promote('X@s', { file });
  assert.equal(combinations.promote('B@s', { file }).retired, 'X@s');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([after.combinations.map((c) => c.id), after.replaced.map((c) => `${c.id}>${c.replacedBy.id}`)], [['A@s', 'B@s'], ['X@s>A@s', 'X@s>B@s']]);
  after.candidates.push({ id: 'C@s', route, replaces: 'X@s' });
  fs.writeFileSync(file, JSON.stringify(after));
  assert.throws(() => combinations.promote('C@s', { file }), (e) => e.code === 'ALREADY_REPLACED' && e.evidence.replacedBy === 'B@s', 'the error names the last route that retired it');
});

test('sf_run_route passes a value one step returns into a later step, and refuses a missing one', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-route-refs', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const route = async (second) => {
    const r = await client.callTool({ name: 'sf_run_route', arguments: { steps: [{ tool: 'sf_combinations', args: { container: 'sidebar' } }, { tool: 'sf_combinations', args: second }] } });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  const first = combinations.list({ container: 'sidebar' })[0].id;
  const ok = await route({ component: '{{step0.combinations.0.id}}' });
  assert.equal(ok.isError, false, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.last.combinations.map((c) => c.id), [first]);
  const missing = await route({ component: '{{step0.nope}}' });
  assert.equal(missing.body.code, 'BAD_ARGS', JSON.stringify(missing.body));
  assert.equal(missing.body.evidence.step, 1);
  assert.match(missing.body.message, /step 1 sf_combinations.*\{\{step0\.nope\}\}/);
  // A step not yet run is refused before any step runs: sf_whoami would fail NO_SESSION if it ran.
  const r = await client.callTool({ name: 'sf_run_route', arguments: { steps: [{ tool: 'sf_whoami' }, { tool: 'sf_combinations', args: { component: '{{step1.combinations.0.id}}' } }] } });
  const ahead = JSON.parse(r.content[0].text);
  assert.equal(ahead.code, 'BAD_ARGS', JSON.stringify(ahead));
  assert.equal(ahead.evidence.step, 1);
});

// A route has no other way to fail on a value only an API shows (the app the App Launcher switched to).
test('sf_api expect passes on the value at path and fails VALUE_MISMATCH on another', { skip, timeout: 120_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-api-expect', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: process.env }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  assert.equal((await client.callTool({ name: 'sf_start', arguments: { org: env.org } })).isError, undefined);
  const call = async (equals) => {
    const r = await client.callTool({ name: 'sf_api', arguments: { path: '/ui-api/object-info/SfUiProbe__c', as: 'user', expect: { path: 'fields.Count__c.dataType', equals } } });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  const ok = await call('Double');
  assert.equal(ok.isError, false, JSON.stringify(ok.body).slice(0, 300));
  const bad = await call('String');
  assert.equal(bad.body.code, 'VALUE_MISMATCH', JSON.stringify(bad.body).slice(0, 300));
  assert.deepEqual([bad.body.evidence.expected, bad.body.evidence.actual], ['String', 'Double']);

  // With timeoutMs it polls, so a value an async save writes a moment later still passes.
  const name = `sf-ui expect poll ${Date.now()}`;
  const admin = await auth(env.org);
  const rest = (p, init = {}) => fetch(`${admin.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' } });
  const later = new Promise((r) => setTimeout(r, 1_500)).then(() => rest('/sobjects/SfUiProbe__c', { method: 'POST', body: JSON.stringify({ Name: name, Tags__c: 'Alpha' }) })).then((r) => r.json());
  t.after(async () => rest(`/sobjects/SfUiProbe__c/${(await later).id}`, { method: 'DELETE' }));
  const q = `/query?q=${encodeURIComponent(`SELECT Name FROM SfUiProbe__c WHERE Name = '${name}'`)}`;
  const polled = await client.callTool({ name: 'sf_api', arguments: { path: q, as: 'admin', expect: { path: 'records.0.Name', equals: name, timeoutMs: 15_000 } } });
  assert.equal(polled.isError, undefined, polled.content[0].text.slice(0, 300));
});

// A plan-only tester asked for the New form by object name and waited 60 s for a record page that cannot exist.
test('sf_form_model models a New form from objectApiName and refuses an object name as recordId', { skip, timeout: 120_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-form-model-create', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: process.env }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  assert.equal((await client.callTool({ name: 'sf_start', arguments: { org: env.org } })).isError, undefined);
  const call = async (args) => {
    const r = await client.callTool({ name: 'sf_form_model', arguments: args });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  const started = Date.now();
  const wrong = await call({ recordId: 'SfUiProbe__c', mode: 'Create' });
  assert.equal(wrong.body.code, 'BAD_ARGS', JSON.stringify(wrong.body).slice(0, 300));
  assert.ok(Date.now() - started < 5_000, `${Date.now() - started} ms`);
  const created = await call({ objectApiName: 'SfUiProbe__c', mode: 'Create' });
  assert.equal(created.isError, false, JSON.stringify(created.body).slice(0, 300));
  assert.deepEqual([created.body.mode, created.body.fields.find((f) => f.apiName === 'Tags__c')?.required], ['Create', true]);
});

// A replay result's subtest: skipped for its reason, except a route stale to remap, which is red as the CLI exits 1
// for it, so a page change cannot merge green.
const subtest = (r) => ({ skip: r ? !r.remap && r.reason : 'not in SF_TESTER_REPLAY_ONLY', message: r?.remap ? r.reason : `step ${r?.step}: ${r?.error}` });

test('a stale route is a red subtest; a sideEffects route and an unplanned one are skipped', () => {
  const stale = subtest({ status: 'skip', remap: true, reason: 'stale (x): remap it with the tester' });
  assert.ok(!stale.skip, 'stale is run, not skipped');
  assert.equal(stale.message, 'stale (x): remap it with the tester');
  assert.equal(subtest({ status: 'skip', reason: 'sideEffects: email' }).skip, 'sideEffects: email');
  assert.equal(subtest(undefined).skip, 'not in SF_TESTER_REPLAY_ONLY');
  assert.ok(!subtest({ status: 'fail', step: 2, error: 'boom' }).skip, 'control: a red route is run');
});

// About 3.3 s an entry: 295 entries run 16 min, past the 15 min this had.
// The CLI's replay, records from the catalogue's placeholders. SF_TESTER_REPLAY_ONLY (a regex on the id) replays a
// slice; a sideEffects entry (a Flow Error email) runs only with SF_TESTER_REPLAY_SIDE_EFFECTS=1.
test('every tested route replays on the fixture org', { skip, timeout: 2_400_000 }, async (t) => {
  const { results, cleanup } = await replay({ org: env.org, file: combinations.BUNDLED, only: process.env.SF_TESTER_REPLAY_ONLY, sideEffects: process.env.SF_TESTER_REPLAY_SIDE_EFFECTS === '1' });
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const entry of combinations.list({ file: combinations.BUNDLED }).filter((c) => c.status === 'tested')) {
    const r = byId.get(entry.id);
    if (r?.stale) t.diagnostic(`${entry.id} changed since saved: ${r.stale.join('; ')}`);
    const { skip: why, message } = subtest(r);
    await t.test(entry.id, { skip: why }, () => assert.equal(r.status, 'pass', message));
  }
  assert.deepEqual(cleanup, [], 'every record the replay made is deleted');
});

// Two promotion modes: auto (the default) lets the tester promote the routes it judges sound, straight into the tested
// routes replays and CI run; manual leaves every saved route a candidate for a person to promote.
test('sf_save_route promotes in auto mode, the default; sf_promote_route is how a person promotes under manual', { timeout: 30_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-'));
  const connect = async (env) => {
    const client = new Client({ name: 'sf-ui-promote', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env }));
    t.after(() => client.close());
    return async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      return { error: r.isError, body: JSON.parse(r.content[0].text) };
    };
  };
  const entry = (id) => ({ id, component: 'lightning-button', container: 'record page', interaction: 'press', task: 'Press Go', requirement: 'Go goes', route: [{ tool: 'sf_wait', args: { text: 'Gone' } }] });
  const status = (file) => combinations.list({ file }).map((c) => [c.id, c.status]);

  const manualFile = path.join(dir, 'manual.json');
  const manual = await connect({ ...process.env, SF_TESTER_COMBINATIONS: manualFile, SF_TESTER_PROMOTE: 'manual' });
  const asked = await manual('sf_save_route', { ...entry('a@x'), promote: true });
  assert.deepEqual([asked.body.promoted, asked.body.mode], [false, 'manual'], JSON.stringify(asked.body));
  assert.deepEqual(status(manualFile), [['a@x', 'candidate']], 'manual keeps a promote request a candidate');
  const promoted = await manual('sf_promote_route', { id: 'a@x' });
  assert.equal(promoted.error, undefined, JSON.stringify(promoted.body));
  assert.deepEqual(status(manualFile), [['a@x', 'tested']], 'the person promoted it');
  assert.equal(promoted.body.promoted.verified.promoted.by, 'a person');
  const missing = await manual('sf_promote_route', { id: 'a@x' });
  // A hand-merged file with the id in both lists: promoting it again would make two tested routes.
  const merged = JSON.parse(fs.readFileSync(manualFile, 'utf8'));
  merged.candidates.push({ ...merged.combinations[0], status: 'candidate' });
  fs.writeFileSync(manualFile, JSON.stringify(merged));
  const twice = await manual('sf_promote_route', { id: 'a@x' });
  assert.deepEqual([twice.error, twice.body.code], [true, 'DUPLICATE_ID'], JSON.stringify(twice.body));
  merged.candidates.pop();
  // Two candidates under one id: promoting one would leave the other beside the tested route.
  merged.candidates.push({ ...entry('z@x'), status: 'candidate' }, { ...entry('z@x'), status: 'candidate' })
  fs.writeFileSync(manualFile, JSON.stringify(merged));
  assert.equal((await manual('sf_promote_route', { id: 'z@x' })).body.code, 'DUPLICATE_ID');
  merged.candidates.splice(-2);
  fs.writeFileSync(manualFile, JSON.stringify(merged));
  assert.deepEqual([missing.error, missing.body.code], [true, 'NOT_FOUND'], 'a tested route is not a candidate any more');

  const autoFile = path.join(dir, 'auto.json');
  const auto = await connect({ ...process.env, SF_TESTER_COMBINATIONS: autoFile, SF_TESTER_PROMOTE: '' });
  const judged = await auto('sf_save_route', { ...entry('b@x'), promote: true });
  assert.deepEqual([judged.body.promoted, judged.body.mode], [true, 'auto'], JSON.stringify(judged.body));
  await auto('sf_save_route', entry('c@x'));
  assert.deepEqual(status(autoFile), [['b@x', 'tested'], ['c@x', 'candidate']], 'auto promotes only what the tester judged sound');

  const typoFile = path.join(dir, 'typo.json');
  const typo = await connect({ ...process.env, SF_TESTER_COMBINATIONS: typoFile, SF_TESTER_PROMOTE: 'off' });
  const kept = await typo('sf_save_route', { ...entry('d@x'), promote: true });
  assert.deepEqual([kept.error, kept.body.promoted, kept.body.mode], [undefined, false, 'manual'], 'an unknown mode reads as manual, never auto');
  assert.match(kept.body.warning, /SF_TESTER_PROMOTE is "off"/);
  assert.deepEqual(status(typoFile), [['d@x', 'candidate']], 'the checked route is kept as a candidate');
});
