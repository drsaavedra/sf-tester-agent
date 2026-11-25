'use strict';

// A scenario that ends PASS saves its steps as a candidate route. No org: stub-server.js stands in for it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { CLASSES, NOT_A_STEP, ENTRY, PAGE_OPENERS } = require('../src/tool-limits');
const { slug } = require('../src/combinations');

async function serve(t, { catalogue = true, broken = false, env: more, prefix = 'sf-route-', app, started = true, org = 'stub' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, 'catalogue.json');
  const env = { ...process.env, SF_TESTER_IMPROVEMENTS: path.join(dir, 'imp.jsonl'), ...more };
  delete env.SF_TESTER_COMBINATIONS;
  if (catalogue) env.SF_TESTER_COMBINATIONS = file;
  if (broken) fs.mkdirSync(file); // a catalogue that cannot be read: EISDIR, no SfUiError
  const client = new Client({ name: 'sf-route-save', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['-r', path.join(__dirname, 'stub-server.js'), path.join(__dirname, '..', 'src', 'server.js')], env }));
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  if (started) await call('sf_start', { org, ...(app && { app }) });
  const saved = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).candidates : []);
  return { call, saved, file, dir };
}
const check = { path: '/number', expect: { path: 'result', equals: 0 } };
// The reported command: the cli by its absolute path, so it runs from any folder.
const cli = path.join(__dirname, '..', 'src', 'cli.js');
const replayOf = (file, id) => `node '${cli}' replay --catalogue '${file}' --org 'stub' --only '^${id}$'`;
// The id a title gets: its slug, or scenario when it has none, and 6 hex of its sha1.
const idOf = (title) => `${slug(title) || 'scenario'}-${createHash('sha1').update(title).digest('hex').slice(0, 6)}@scenario`;
// The step a scenario opens its page with.
const open = ['sf_open_tab', { tab: 'SfUi_Vf' }];
const opened = { tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } };
// A scenario that ends with the given result, running the given calls between its start and end; it sends its plan first.
const run = async (call, title, result, calls = [], plan = true) => {
  if (plan) await call('sf_scenario', { plan: [{ title, kind: 'positive' }] });
  await call('sf_scenario', { start: title });
  for (const [name, args] of calls) await call(name, args);
  return call('sf_scenario', { end: title, result, ...(result === 'FAIL' && { reason: 'probe' }) });
};

test('a PASS saves the navigation and the check, not the failed call, with the plan\'s requirement', async (t) => {
  const { call, saved, file } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Case A saves', kind: 'positive', requirement: 'Close a Case' }] });
  await call(...open); // before start: the scenario's own
  const end = await run(call, 'Case A saves', 'PASS', [['sf_api', { path: '/fails' }], ['sf_api', { ...check, session: 'default' }]]); // run's own re-plan leaves requirement out
  const id = idOf('Case A saves');
  assert.deepEqual(end.body.route, { saved: true, id, file, replay: replayOf(file, id) }, JSON.stringify(end.body));
  const [entry, ...rest] = saved();
  assert.equal(rest.length, 0);
  assert.deepEqual(entry.route, [opened, { tool: 'sf_api', args: check }]);
  assert.deepEqual([entry.id, entry.requirement, entry.container, entry.task], [id, 'Close a Case', 'scenario', 'Case A saves']);
  assert.deepEqual(entry.validity, { page: { object: 'Stub__c', formHash: 'now' } });
});

test('a session that sent no plan captures nothing', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { start: 'Unplanned' });
  await call('sf_api', check);
  assert.deepEqual((await call('sf_scenario', { end: 'Unplanned', result: 'PASS' })).body.route, { saved: false, reason: 'NO_STEPS' });
  assert.deepEqual(saved(), []);
});

test('a negative scenario is NEGATIVE and writes nothing', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Refused', kind: 'negative' }] });
  const end = await run(call, 'Refused', 'PASS', [open, ['sf_api', check]], false);
  assert.deepEqual(end.body.route, { saved: false, reason: 'NEGATIVE' });
  await call('sf_scenario', { plan: [{ title: 'Refused by api', kind: 'negative' }] });
  assert.deepEqual((await run(call, 'Refused by api', 'PASS', [['sf_api', check]], false)).body.route, { saved: false, reason: 'NEGATIVE' }); // no page needed
  await call('sf_scenario', { plan: [{ title: 'Refused on purpose', kind: 'negative' }] });
  const refused = await run(call, 'Refused on purpose', 'PASS', [open, ['sf_api', { path: '/fails', expect: { path: 'x', equals: 1 } }]], false);
  assert.deepEqual(refused.body.route, { saved: false, reason: 'NEGATIVE' }, JSON.stringify(refused.body)); // its failing check was never captured
  assert.deepEqual((await run(call, 'Api only', 'PASS', [['sf_api', check]])).body.route, { saved: false, reason: 'NO_ENTRY' }); // a check, but no page
  // Its check ran inside a route that then failed, so no check is left in the steps: NO_CHECK, not the NO_ENTRY of what is left.
  const trimmed = await run(call, 'Trimmed', 'PASS', [['sf_viewport', { width: 600 }], ['sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_api', args: check }, { tool: 'sf_api', args: { path: '/fails' } }] }]]);
  assert.deepEqual(trimmed.body.route, { saved: false, reason: 'NO_CHECK' }, JSON.stringify(trimmed.body));
  assert.deepEqual(saved(), []);
});

test('a scenario that begins mid-page is NO_ENTRY; a page opened after the last end and before start counts', async (t) => {
  const { call, saved } = await serve(t);
  await run(call, 'First', 'PASS', [open, ['sf_api', check]]);
  const click = ['sf_click', { name: 'Approve' }]; // acts on a page the scenario never opened
  assert.deepEqual((await run(call, 'Blind', 'PASS', [click, ['sf_api', check]])).body.route, { saved: false, reason: 'NO_ENTRY' }); // First's page is not carried
  await call(...open); // between the last end and this start: part of the scenario
  const second = await run(call, 'Second', 'PASS', [['sf_api', check]]); // the check follows the open, so it is kept
  assert.equal(second.body.route.saved, true, JSON.stringify(second.body));
  assert.deepEqual(saved()[1].route, [opened, { tool: 'sf_api', args: check }]);
});
test('an id an earlier step returned is saved as a {{stepN.recordId}} reference, and the id itself is not stored', async (t) => {
  const { call, saved } = await serve(t);
  const echo = { path: '/echo/001STUB', expect: { path: 'echo', equals: '/echo/001STUB' } };
  const longer = { path: '/echo/001STUBAAA', expect: { path: 'echo', equals: '/echo/001STUBAAA' } }; // the id with more id characters after it
  const inside = { path: '/echo/X001STUB', expect: { path: 'echo', equals: '/echo/X001STUB' } }; // and with one before it
  const coded = { path: '/echo/X%30001STUB', expect: { path: 'echo', equals: '/echo/X%30001STUB' } }; // %30 is 0, an id character
  const codedAfter = { path: '/echo/001STUB%41', expect: { path: 'echo', equals: '/echo/001STUB%41' } }; // %41 is A
  const echoes = ['%27001STUB%27', 'line\n001STUB'].map((tail) => ({ path: `/echo/${tail}`, expect: { path: 'echo', equals: `/echo/${tail}` } })); // after an encoded quote, after a newline
  const end = await run(call, 'Create then assert', 'PASS', [open, ['sf_api', { path: '/created' }], ['sf_api', longer], ['sf_api', inside], ['sf_api', coded], ['sf_api', codedAfter], ['sf_api', echo], ...echoes.map((x) => ['sf_api', x])]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: { path: '/created' } },
    { tool: 'sf_api', args: longer }, { tool: 'sf_api', args: inside }, { tool: 'sf_api', args: coded }, { tool: 'sf_api', args: codedAfter }, { tool: 'sf_api', args: { path: '/echo/{{step1.recordId}}', expect: { path: 'echo', equals: '/echo/{{step1.recordId}}' } } },
    ...['%27{{step1.recordId}}%27', 'line\n{{step1.recordId}}'].map((tail) => ({ tool: 'sf_api', args: { path: `/echo/${tail}`, expect: { path: 'echo', equals: `/echo/${tail}` } } }))]);
});

test('the stored id is read from the path its reference names, not from another recordId in the answer', async (t) => {
  const { call, saved } = await serve(t);
  const echo = (id) => ({ path: `/echo/${id}`, expect: { path: 'echo', equals: `/echo/${id}` } });
  const end = await run(call, 'Mixed answer', 'PASS', [open, ['sf_api', { path: '/created-mixed' }], ['sf_api', echo('5')], ['sf_api', echo('001MIX')]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route.slice(2).map((x) => x.args.path), ['/echo/5', '/echo/{{step1.result.recordId}}']); // the 5 is not the id
});

test('an id inside an answer that has its own at is saved as a reference that sf_run_route resolves', async (t) => {
  const { call, saved } = await serve(t);
  const echo = { path: '/echo/001ATBOX', expect: { path: 'echo', equals: '/echo/001ATBOX' } };
  const end = await run(call, 'Boxed id', 'PASS', [open, ['sf_api', { path: '/created-at' }], ['sf_api', echo]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.equal(saved()[0].route[2].args.path, '/echo/{{step1.result.recordId}}');
  const replayed = await call('sf_run_route', { steps: saved()[0].route }); // the saved route runs: the reference finds the id
  assert.equal(replayed.isError, false, JSON.stringify(replayed.body));
});

test('an sf_assert_field in the page and sf_actions are entries; a component read and an api assert are not', async (t) => {
  const { call } = await serve(t);
  const id = { recordId: '001STUB' };
  const entry = async (title, first) => (await run(call, title, 'PASS', [first, ['sf_api', check]])).body.route;
  assert.deepEqual(await entry('Asserts by api', ['sf_assert_field', { ...id, field: 'Name', expected: 'x', via: 'api' }]), { saved: false, reason: 'NO_ENTRY' });
  assert.deepEqual(await entry('Reads the New form', ['sf_form_model', { objectApiName: 'Stub__c', mode: 'Create' }]), { saved: false, reason: 'NO_ENTRY' }); // no recordId: no page opened
  // A component read reuses an open page, so a route starting with one would replay on a page it never opened.
  assert.deepEqual(await entry('Reads a component', ['sf_lwc_read', { ...id, lwcApiName: 'long' }]), { saved: false, reason: 'NO_ENTRY' });
  assert.deepEqual(await entry('Verifies live', ['sf_verify_live', { ...id, lwcApiName: 'long', marker: 'live' }]), { saved: false, reason: 'NO_ENTRY' });
  assert.equal((await entry('Asserts in the page', ['sf_assert_field', { ...id, field: 'Name', expected: 'x', via: 'ui' }])).saved, true);
  assert.equal((await entry('Asserts both', ['sf_assert_field', { ...id, field: 'Name', expected: 'x' }])).saved, true);
  assert.equal((await entry('Reads a record form', ['sf_form_model', { recordId: '001000000000STB', mode: 'Edit' }])).saved, true);
  assert.equal((await entry('Lists actions', ['sf_actions', id])).saved, true); // it opens the record to read its page
  for (const tool of ['sf_open_record', 'sf_open_tab', 'sf_open_list', 'sf_open_related_list', 'sf_search', 'sf_create_record', 'sf_edit_record']) assert.ok(ENTRY.includes(tool), tool);
});
test('reads before the scenario opens its page are dropped, and what is left must still hold a check', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Look first', 'PASS', [['sf_page_errors', {}], ['sf_whoami', {}], ['sf_api', check], open, ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]); // the leading read and the leading api check are gone
  const only = await run(call, 'Look only', 'PASS', [['sf_api', check], open, ['sf_api', { path: '/string' }]]); // its one check was before the page
  assert.deepEqual(only.body.route, { saved: false, reason: 'NO_CHECK' });
  // A step that sets state is replayed, so it is not dropped, and a route that starts with one has no entry.
  const sized = await run(call, 'Sized first', 'PASS', [['sf_viewport', { width: 600, height: 800 }], open, ['sf_api', check]]);
  assert.deepEqual(sized.body.route, { saved: false, reason: 'NO_ENTRY' });
  // A leading look whose id a later step uses stays, so the reference is made.
  const looked = await run(call, 'Id first', 'PASS', [['sf_api', { path: '/created' }], ['sf_assert_field', { recordId: '001STUB', field: 'Name', expected: 'x', via: 'ui' }], ['sf_api', check]]);
  assert.equal(looked.body.route.saved, true, JSON.stringify(looked.body));
  assert.deepEqual(saved().at(-1).route.slice(0, 2).map((x) => x.args.path ?? x.args.recordId), ['/created', '{{step0.recordId}}']);
  const unused = await run(call, 'Id unused', 'PASS', [['sf_api', { path: '/created' }], open, ['sf_api', check]]); // no later step uses the id
  assert.equal(unused.body.route.saved, true, JSON.stringify(unused.body));
  assert.deepEqual(saved().at(-1).route, [opened, { tool: 'sf_api', args: check }]);
  // The id only inside a longer one is no use, as the swap reads it, so that look goes too.
  const inside = await run(call, 'Id inside', 'PASS', [['sf_api', { path: '/created' }], open, ['sf_api', { path: '/echo/X001STUB', expect: { path: 'echo', equals: '/echo/X001STUB' } }]]);
  assert.equal(inside.body.route.saved, true, JSON.stringify(inside.body));
  assert.deepEqual(saved().at(-1).task, 'Id inside');
  assert.equal(saved().at(-1).route[0].tool, 'sf_open_tab');
  // A chain: the second look uses the first one's id and a later step uses the second's, so both stay as references.
  const chain = await run(call, 'Id chain', 'PASS', [['sf_api', { path: '/created' }], ['sf_api', { path: '/chain/001STUB' }], ['sf_assert_field', { recordId: '001CHAIN', field: 'Name', expected: 'x', via: 'ui' }], ['sf_api', check]]);
  assert.equal(chain.body.route.saved, true, JSON.stringify(chain.body));
  assert.deepEqual(saved().at(-1).route.slice(0, 3).map((x) => x.args.path ?? x.args.recordId), ['/created', '/chain/{{step0.recordId}}', '{{step1.recordId}}']);
  // Two reads that return the same id: the swap points at the first, so only that one stays.
  const same = await run(call, 'Same id twice', 'PASS', [['sf_api', { path: '/created' }], ['sf_api', { path: '/created' }], ['sf_assert_field', { recordId: '001STUB', field: 'Name', expected: 'x', via: 'ui' }], ['sf_api', check]]);
  assert.equal(same.body.route.saved, true, JSON.stringify(same.body));
  assert.deepEqual(saved().at(-1).route.map((x) => x.args.path ?? x.args.recordId), ['/created', '{{step0.recordId}}', check.path]);
  // The planners are never steps: the agent acts on their answer with steps of its own.
  const planned = await run(call, 'Planned', 'PASS', [['sf_map_feature', {}], ['sf_route', { to: 'x' }], open, ['sf_route', { to: 'y' }], ['sf_api', check]]);
  assert.equal(planned.body.route.saved, true, JSON.stringify(planned.body));
  assert.deepEqual(saved().at(-1).route, [opened, { tool: 'sf_api', args: check }]);
});

test('a snapshot of a page left from before the scenario stays out of the route, and its id stays literal', async (t) => {
  const { call, saved } = await serve(t, { env: { STUB_SNAP_ID: '001SNAP' } });
  const end = await run(call, 'Snapshot first', 'PASS', [['sf_page_snapshot', {}], ['sf_assert_field', { recordId: '001SNAP', field: 'Name', expected: 'x', via: 'ui' }], ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route.map((x) => x.tool), ['sf_assert_field', 'sf_api']);
  assert.equal(saved()[0].route[0].args.recordId, '001SNAP');
});
test('a read after a snapshot of the same record is kept, and the id becomes its reference', async (t) => {
  const { call, saved } = await serve(t, { env: { STUB_SNAP_ID: '001STUB' } }); // the snapshot and /created answer one id
  const read = await run(call, 'Snapshot then read', 'PASS', [['sf_page_snapshot', {}], ['sf_api', { path: '/created' }], ['sf_assert_field', { recordId: '001STUB', field: 'Name', expected: 'x', via: 'ui' }], ['sf_api', check]]);
  assert.equal(read.body.route.saved, true, JSON.stringify(read.body));
  assert.deepEqual(saved().at(-1).route.slice(0, 2).map((x) => x.args.path ?? x.args.recordId), ['/created', '{{step0.recordId}}']);
});

test('a saved route is checked before it runs: stale runs no step unless asked, unknown runs and says so', async (t) => {
  const { call } = await serve(t);
  const page = (flexiPage) => ({ page: { object: 'Stub__c', flexiPage, flexiPageHash: 'h', formHash: 'f' } });
  const steps = [{ tool: 'sf_api', args: { path: '/created' } }];
  const stale = await call('sf_run_route', { steps, validity: page('Stale_Page') });
  assert.equal(stale.isError, true);
  assert.deepEqual([stale.body.code, stale.body.evidence.decision, stale.body.evidence.stale], ['STALE_ROUTE', 'remap', ['FlexiPage Stale_Page']]);
  assert.equal(stale.body.evidence.done, undefined, 'no step ran');
  const forced = await call('sf_run_route', { steps, validity: page('Stale_Page'), onStale: 'run' });
  assert.deepEqual([forced.isError, 'check' in forced.body, forced.body.steps.length], [false, false, 1], 'run: no check, the steps run');
  assert.equal((await call('sf_run_route', { steps, validity: page('Probe_Page') })).body.check.state, 'valid');
  const blank = await call('sf_run_route', { steps, validity: {} });
  assert.deepEqual([blank.isError, blank.body.check.state], [false, 'unknown'], 'nothing saved to compare: it runs');
  assert.equal('check' in (await call('sf_run_route', { steps })).body, false, 'a route given no validity is not a saved one');
  const refused = await call('sf_run_route', { steps, validity: page('Api_Error_Page') });
  assert.deepEqual([refused.isError, refused.body.check.state, refused.body.check.unchecked[0]], [false, 'unknown', 'the check failed: API_ERROR: stub: the org refused the check'], 'an org error runs the route as unknown');
  assert.equal((await call('sf_run_route', { steps, validity: page('Bug_Page') })).isError, true, 'a bug in the check is not hidden as unknown');
  const odd = await call('sf_run_route', { steps, validity: { page: { object: 'X', formHash: 'f', extra: 1 } } });
  assert.deepEqual([odd.isError, odd.body.check], [false, { state: 'unknown', unchecked: ['the saved validity is not a shape this version reads'] }]);
});

test('a remap saves a new Draft that names the stale route, and leaves the stale route as it was', async (t) => {
  const { call, saved } = await serve(t);
  const first = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]]);
  const stale = saved()[0];
  await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'positive', replaces: first.body.route.id }] });
  const remap = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(remap.body.route.saved, true, JSON.stringify(remap.body));
  assert.notEqual(remap.body.route.id, stale.id, 'its own id, though the title is the same');
  assert.deepEqual([saved()[1].replaces, saved()[1].status], [stale.id, 'candidate']);
  assert.deepEqual(saved()[0], stale, 'the stale route is not overwritten');
  assert.equal('replaces' in stale, false, 'control: a first run replaces nothing');
  await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'positive' }] });
  const third = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.deepEqual([third.body.route.reason, third.body.route.id], ['DUPLICATE_ID', stale.id], 'the end cleared replaces: a re-plan without it is the first route again');
});

test('a remap whose end is DUPLICATE_ID is cleared: its Draft already stands, so a later run is the plain title again', async (t) => {
  const { call } = await serve(t);
  const first = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]]);
  const remap = async () => {
    await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'positive', replaces: first.body.route.id }] });
    return run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  };
  const saved = await remap();
  const twice = await remap();
  assert.deepEqual([saved.body.route.saved, twice.body.route.reason], [true, 'DUPLICATE_ID'], JSON.stringify([saved.body, twice.body]));
  assert.notEqual(twice.body.route.id, first.body.route.id, 'control: the second end hit the remap\'s id');
  const later = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false); // no re-plan
  assert.deepEqual([later.body.route.reason, later.body.route.id], ['DUPLICATE_ID', first.body.route.id], 'the DUPLICATE_ID end cleared replaces');
});

test('a remap that fails once and is run again under the same title still names the stale route', async (t) => {
  const { call, saved } = await serve(t);
  const page = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  const refused = ['sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }], id: 'old@x', validity: page }];
  await run(call, 'Find it', 'FAIL', [refused]);
  await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(saved()[0].replaces, 'old@x', 'the first end was a FAIL, which does not clear it');
  const later = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(later.body.route.saved, true, JSON.stringify(later.body));
  assert.equal(saved().at(-1).replaces, undefined, 'control: a PASS cleared it, so a later run of the title is no remap');
});

test('a remap whose PASS saved nothing still names the stale route when the title is run again', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'positive', replaces: 'old@x' }] });
  const bare = await run(call, 'Find it', 'PASS', [open], false);
  assert.deepEqual(bare.body.route, { saved: false, reason: 'NO_CHECK' }, 'a PASS with no check saves nothing');
  const again = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(again.body.route.saved, true, JSON.stringify(again.body));
  assert.equal(saved()[0].replaces, 'old@x', 'the first end saved nothing, so it did not clear the remap');
});

test('a different remap of one route waits beside the first Draft; the same remap again is refused', async (t) => {
  const readFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-read-')), 'read.json');
  const { call, saved } = await serve(t, { env: { STUB_READ_FILE: readFile } });
  const first = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]]);
  const persona = (hash) => ({ profile: 'P', permissionSets: ['X'], permissionSetHashes: { X: hash } });
  // The remap's read: the page's form hash and the persona's set hash, as the org gave them this time.
  const remap = async (steps, { form = 'now', set = 'h1' } = {}) => {
    fs.writeFileSync(readFile, JSON.stringify({ page: { object: 'Stub__c', formHash: form }, persona: persona(set) }));
    await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'positive', replaces: first.body.route.id }] });
    return run(call, 'Find it', 'PASS', [...steps, open, ['sf_api', check]], false);
  };
  const one = await remap([]);
  const otherRoute = await remap([open]); // one more step
  const otherPage = await remap([], { form: 'changed' }); // the same steps, a page that reads otherwise
  const sameSetsLate = await remap([], { set: 'h2' }); // the same steps and page; only the persona's set hash differs
  assert.deepEqual([one, otherRoute, otherPage].map((x) => x.body.route.saved), [true, true, true], JSON.stringify([one.body, otherRoute.body, otherPage.body]));
  assert.equal(new Set([one, otherRoute, otherPage].map((x) => x.body.route.id)).size, 3, 'each different remap has an id of its own');
  assert.deepEqual([sameSetsLate.body.route.reason, sameSetsLate.body.route.id], ['DUPLICATE_ID', one.body.route.id], 'a persona hash a timeout can drop is not part of the remap');
  assert.equal(saved().length, 4, 'the stale route and three Drafts');
});

test('a stale refusal inside a scenario makes its Draft name the stale route; a valid route names nothing', async (t) => {
  const { call, saved } = await serve(t);
  const page = (flexiPage) => ({ page: { object: 'Stub__c', flexiPage, flexiPageHash: 'h', formHash: 'f' } });
  const steps = [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }];
  await call('sf_scenario', { plan: [{ title: 'Found again', kind: 'positive' }, { title: 'Still valid', kind: 'positive' }] });
  await call('sf_scenario', { start: 'Found again' });
  const stale = await call('sf_run_route', { steps, id: 'old@x', validity: page('Stale_Page') });
  assert.deepEqual([stale.body.code, stale.body.evidence.replaces], ['STALE_ROUTE', 'old@x']);
  await call(...open);
  await call('sf_api', check);
  await call('sf_scenario', { end: 'Found again', result: 'PASS' });
  assert.equal(saved()[0].replaces, 'old@x');
  await call('sf_scenario', { start: 'Still valid' });
  assert.equal((await call('sf_run_route', { steps, id: 'ok@x', validity: page('Probe_Page') })).isError, false);
  await call('sf_api', check);
  await call('sf_scenario', { end: 'Still valid', result: 'PASS' });
  assert.equal('replaces' in saved()[1], false, 'a valid route is replayed, not replaced');
});

test('a second stale refusal in one scenario does not take the place of the route already named', async (t) => {
  const { call, saved } = await serve(t);
  const stale = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  const steps = [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }];
  await call('sf_scenario', { plan: [{ title: 'Two stale', kind: 'positive' }, { title: 'Planned', kind: 'positive', replaces: 'a@x' }] });
  await call('sf_scenario', { start: 'Two stale' });
  assert.equal((await call('sf_run_route', { steps, id: 'a@x', validity: stale })).body.evidence.replaces, 'a@x');
  const second = await call('sf_run_route', { steps, id: 'b@x', validity: stale });
  assert.equal(second.body.evidence.replaces, 'a@x', 'the Draft still names the first');
  assert.match(second.body.message, /b@x needs a scenario of its own/, 'and the refusal says the second route is not handled by it');
  const again = await call('sf_run_route', { steps, id: 'a@x', validity: stale });
  assert.match(again.body.message, /Draft will name a@x$/, 'control: the first route again is the one the Draft names');
  await call(...open);
  await call('sf_api', check);
  await call('sf_scenario', { end: 'Two stale', result: 'PASS' });
  await call('sf_scenario', { start: 'Planned' });
  assert.equal((await call('sf_run_route', { steps, id: 'b@x', validity: stale })).body.evidence.replaces, 'a@x', 'a route the plan named is not overwritten');
  await call(...open);
  await call('sf_api', check);
  await call('sf_scenario', { end: 'Planned', result: 'PASS' });
  assert.deepEqual(saved().map((c) => c.replaces), ['a@x', 'a@x']);
});

test('a persona route run as the alias\'s own user keeps that persona in its read, so --baseline can take its new set hashes', async (t) => {
  const { call } = await serve(t);
  const steps = [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_api', args: { path: '/created' } }];
  const same = await call('sf_run_route', { steps, validity: { persona: { profile: 'Alias', permissionSets: [] } } });
  assert.deepEqual(same.body.validity.persona, { profile: 'Alias', permissionSets: [] }, JSON.stringify(same.body));
  const other = await call('sf_run_route', { steps, validity: { persona: { profile: 'Other', permissionSets: [] } } });
  assert.equal(other.body.validity?.persona, undefined, 'another persona is read to compare, never kept');
  // With no entry step no page is read, but the persona still is, so --baseline can take its set hashes.
  const bare = await call('sf_run_route', { steps: steps.slice(1), validity: { persona: { profile: 'Alias', permissionSets: [] } } });
  assert.deepEqual([bare.body.validity, bare.body.unread], [{ persona: { profile: 'Alias', permissionSets: [] } }, ['page: the route opened no page']], JSON.stringify(bare.body));
});

test('a FAIL saves nothing and has no route key', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Red', 'FAIL', [['sf_api', check]]);
  assert.equal(end.isError, false);
  assert.equal('route' in end.body, false);
  assert.deepEqual(saved(), []);
});

test('a PASS the code verdict overrules saves nothing', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Overruled', 'PASS', [open, ['sf_api', { path: '/number', expect: { path: 'result', equals: 1 } }], ['sf_api', check]]);
  assert.deepEqual([end.body.verdict, end.body.overruled], ['FAIL', true], JSON.stringify(end.body));
  assert.equal('route' in end.body, false);
  assert.deepEqual(saved(), []);
  const control = await run(call, 'Green', 'PASS', [open, ['sf_api', check]]);
  assert.equal(control.body.route?.saved, true, 'control: the same steps without the failed check save');
});

test('a PASS with no check is NO_CHECK and writes nothing', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Weak', 'PASS', [['sf_api', { path: '/string' }]]);
  assert.deepEqual(end.body.route, { saved: false, reason: 'NO_CHECK' });
  assert.deepEqual(saved(), []);
  assert.deepEqual((await run(call, 'Empty', 'PASS')).body.route, { saved: false, reason: 'NO_STEPS' });
});

test('a weak PASS is NO_CHECK even when a check ran before its start', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Early', kind: 'positive' }] });
  await call('sf_api', check); // before start: in the steps, not in this scenario's checks
  const end = await run(call, 'Early', 'PASS', [['sf_api', { path: '/string' }]], false);
  assert.deepEqual([end.body.weak, end.body.route], [true, { saved: false, reason: 'NO_CHECK' }]);
  assert.deepEqual(saved(), []);
});

test('steps run through sf_run_route are captured with resolved args, and sf_run_route is not one', async (t) => {
  const { call, saved } = await serve(t);
  const steps = [opened, { tool: 'sf_api', args: { path: '/own-at' } }, { tool: 'sf_api', args: { path: '/null?n={{step1.result.n}}' } }, { tool: 'sf_api', args: check }];
  const end = await run(call, 'Routed', 'PASS', [['sf_run_route', { steps }]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: { path: '/own-at' } }, { tool: 'sf_api', args: { path: '/null?n=1' } }, { tool: 'sf_api', args: check }]);
});

test('an sf_verify_checks step runs on the session\'s org, takes absolute paths only, and fails the route unless green', async (t) => {
  const { call, dir } = await serve(t);
  const app = path.join(dir, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'sfdx-project.json'), '{}');
  const step = (args) => call('sf_run_route', { steps: [{ tool: 'sf_verify_checks', args }] });
  assert.deepEqual((await step({ checksFile: '/abs/ok.json' })).body.last.lines, ['PASS stub /abs/ok.json']);
  assert.deepEqual((await step({ checks: [{}], project: app })).body.last.lines, [`PASS stub ${app}`]);
  // The call's own argument rules are met before any step runs: a relative path, both or neither file, a project with no sfdx-project.json.
  for (const [args, why] of [[{ checksFile: 'checks/ok.json' }, /checksFile must be an absolute path/], [{ checks: [{}], project: 'app' }, /checks need project/],
    [{ checksFile: '/abs/ok.json', checks: [{}] }, /not both/], [{}, /not neither/], [{ checksFile: '/abs/ok.json', project: app }, /project goes with checks/], [{ checks: [{}], project: dir }, /checks need project/]]) {
    const out = await call('sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_verify_checks', args }] });
    assert.deepEqual([out.body.code, out.body.message.startsWith('BAD_ARGS: step 1 sf_verify_checks: '), why.test(out.body.message)], ['BAD_ARGS', true, true], JSON.stringify(out.body));
  }
  const red = await step({ checksFile: '/abs/red.json' });
  assert.deepEqual([red.body.code, red.body.evidence.code, red.body.evidence.evidence.lines], ['ROUTE_STEP_FAILED', 'VERIFY_NOT_GREEN', ['FAIL stub /abs/red.json']], JSON.stringify(red.body));
  for (const [file, message] of [['/abs/notrun.json', 'verdict not run: stub: git diffs past 60 s'], ['/abs/none.json', 'verdict nothing checked: no check passed'], ['/abs/timed.json', 'verdict not run: changed 0, covered 0']]) { // timed: the time line is never the reason
    const out = await step({ checksFile: file });
    assert.deepEqual([out.body.evidence.code, out.body.evidence.error], ['VERIFY_NOT_RUN', `VERIFY_NOT_RUN: ${message}`], JSON.stringify(out.body));
  }
  const org = await step({ org: 'other', checksFile: '/abs/ok.json' });
  assert.deepEqual([org.body.code, /org/.test(org.body.message)], ['BAD_ARGS', true], 'a step leaves out org');
  const since = await step({ since: 'origin/main', checksFile: '/abs/ok.json' });
  assert.deepEqual([since.body.code, /since/.test(since.body.message)], ['BAD_ARGS', true], 'a step takes no since');
  // Called by itself, org is required and a red verdict is the answer, not an error.
  await assert.rejects(call('sf_verify_checks', { checksFile: '/abs/ok.json' }), /MCP error/, 'the input schema refuses a call with no org');
  const alone = await call('sf_verify_checks', { org: 'other', checksFile: '/abs/red.json' });
  assert.deepEqual([alone.isError, alone.body.verdict, alone.body.lines], [false, 'red', ['FAIL other /abs/red.json']]);
});

test('a verify call is captured with no org and a path relative to the catalogue, which sf_combinations gives back absolute', async (t) => {
  const { call, saved, dir } = await serve(t);
  const abs = { tool: 'sf_verify_checks', args: { checksFile: path.join(dir, 'checks', 'ok.json') } };
  const verify = { tool: 'sf_verify_checks', args: { checksFile: path.join('checks', 'ok.json') } };
  // A call with since checked what a git diff picked, not the whole file a replay would run: it is not captured.
  const since = await run(call, 'Verify since', 'PASS', [['sf_verify_checks', { org: 'stub', since: 'origin/main', ...abs.args }], open, ['sf_api', check]]);
  assert.equal(since.body.route.saved, true, JSON.stringify(since.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
  const first = await run(call, 'Verify first', 'PASS', [['sf_verify_checks', { org: 'stub', ...abs.args }], open, ['sf_api', check]]);
  assert.equal(first.body.route.saved, true, JSON.stringify(first.body));
  assert.deepEqual(saved()[1].route, [verify, opened, { tool: 'sf_api', args: check }]);
  const routed = await run(call, 'Verify routed', 'PASS', [['sf_run_route', { steps: [opened, abs, { tool: 'sf_api', args: check }] }]]);
  assert.equal(routed.body.route.saved, true, JSON.stringify(routed.body));
  assert.deepEqual(saved()[2].route, [opened, verify, { tool: 'sf_api', args: check }]);
  // sf_save_route stores it the same way, and a path outside the catalogue's folder climbs out of it.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-proj-'));
  t.after(() => fs.rmSync(project, { recursive: true }));
  fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
  const out = await call('sf_save_route', { id: 'v@x', component: 'v', container: 'x', interaction: 'i', task: 't', requirement: 'r',
    route: [opened, { tool: 'sf_verify_checks', args: { checks: [{}], project } }] });
  assert.equal(out.isError, false, JSON.stringify(out.body));
  assert.deepEqual(saved()[3].route[1].args, { checks: [{}], project: path.join('..', path.basename(project)) });
  // A verify path is never a placeholder: refused on save and on a run, before any step, and nothing is stored.
  const held = await call('sf_save_route', { id: 'h@x', component: 'h', container: 'x', interaction: 'i', task: 't', requirement: 'r', needs: ['checks'],
    route: [opened, { tool: 'sf_verify_checks', args: { checksFile: '{{checks}}' } }] });
  assert.equal(held.body.code, 'BAD_ARGS', JSON.stringify(held.body));
  assert.equal(saved().length, 4);
  const ref = await call('sf_run_route', { steps: [opened, { tool: 'sf_verify_checks', args: { checksFile: path.join(dir, '{{step0.recordId}}.json') } }] });
  assert.deepEqual([ref.body.code, ref.body.evidence.step, ref.body.evidence.done], ['BAD_ARGS', 1, undefined], JSON.stringify(ref.body));
  assert.match(ref.body.message, /checksFile must be an absolute path/);
  // Loaded, each comes back absolute from the catalogue's folder, so the route runs as sf_combinations gives it.
  const listed = (await call('sf_combinations', { component: 'v@x' })).body.combinations[0];
  assert.deepEqual(listed.route[1].args, { checks: [{}], project });
  const first0 = (await call('sf_combinations', { component: idOf('Verify first') })).body.combinations[0];
  assert.deepEqual(first0.route[0], abs);
  assert.equal((await call('sf_run_route', { steps: first0.route })).isError, false, 'a listed route runs as given');
});

test('each verify step in a route counts against the session\'s budget, as a direct call does', async (t) => {
  const { call } = await serve(t, { started: false });
  await call('sf_start', { org: 'stub', budget: 4 });
  const verify = { tool: 'sf_verify_checks', args: { checksFile: '/abs/ok.json' } };
  assert.equal((await call('sf_run_route', { steps: [verify, verify] })).isError, false);
  // The route would be call 4 and its step 5: refused before its first step, which would have saved a record.
  const spent = await call('sf_run_route', { steps: [opened, { tool: 'sf_save', args: {} }, verify] });
  assert.deepEqual([spent.body.code, spent.body.evidence], ['BUDGET_SPENT', { used: 3, budget: 4 }], JSON.stringify(spent.body));
  assert.equal((await call('sf_whoami')).isError, false, 'the refusal spent nothing');
  // A budget refusal is not a tool error, so sf_end lists none.
  const end = (await call('sf_end')).body;
  assert.deepEqual([end.calls, end.improvements], [{ used: 4, budget: 4 }, undefined], JSON.stringify(end));
});

test('a verify step runs on the ledger\'s org with no live browser', async (t) => {
  const { call } = await serve(t, { org: 'closed' });
  const out = await call('sf_run_route', { steps: [{ tool: 'sf_verify_checks', args: { checksFile: '/abs/ok.json' } }] });
  assert.deepEqual(out.body.last?.lines, ['PASS closed /abs/ok.json'], JSON.stringify(out.body));
  const page = await call('sf_run_route', { steps: [{ tool: 'sf_page_snapshot' }] });
  assert.equal(page.body.evidence?.code, 'NO_SESSION', 'control: a step that needs the browser fails');
});

test('a verify step runs on the ledger its route started on, not the next run\'s', async (t) => {
  const { call } = await serve(t, { started: false });
  await call('sf_start', { org: 'stub', budget: 10 });
  const ok = { tool: 'sf_verify_checks', args: { checksFile: '/abs/ok.json' } };
  const route = call('sf_run_route', { steps: [{ tool: 'sf_verify_checks', args: { checksFile: '/abs/slow.json' } }, ok] });
  await new Promise((r) => setTimeout(r, 300)); // the first step is waiting on its validate
  await call('sf_end');
  await call('sf_start', { org: 'other', budget: 10 });
  const out = await route;
  assert.deepEqual(out.body.last?.lines, ['PASS stub /abs/ok.json'], JSON.stringify(out.body));
  assert.deepEqual((await call('sf_end')).body.calls, { used: 0, budget: 10 }, 'the next run was charged nothing');
});

test('a verify call whose verdict is not green is not captured', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Verify red', 'PASS', [['sf_verify_checks', { org: 'stub', checksFile: '/abs/red.json' }], open, ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
});

test('before the page opens, a verify call repeated with the same args is kept once', async (t) => {
  const { call, saved, dir } = await serve(t);
  const a = { org: 'stub', checksFile: path.join(dir, 'a.json') };
  const b = { org: 'stub', checksFile: path.join(dir, 'b.json') };
  const end = await run(call, 'Verify retried', 'PASS', [['sf_verify_checks', a], ['sf_verify_checks', b], ['sf_verify_checks', a], open, ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route.map((x) => x.args.checksFile), ['b.json', 'a.json', undefined, undefined]);
});

test('a failed sf_run_route leaves none of its steps behind', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Retry', kind: 'positive' }] });
  await call('sf_scenario', { start: 'Retry' });
  const failed = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/string' } }, { tool: 'sf_api', args: { path: '/fails' } }] });
  assert.equal(failed.body.code, 'ROUTE_STEP_FAILED');
  await call(...open);
  await call('sf_api', check);
  assert.equal((await call('sf_scenario', { end: 'Retry', result: 'PASS' })).body.route.saved, true);
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
});

test('sf_login_as empties the steps; sf_scenario and sf_screenshot are never captured', async (t) => {
  const { call, saved, dir } = await serve(t);
  await call('sf_scenario', { start: 'Persona' });
  await call(...open);
  await call('sf_api', { path: '/list' });
  assert.equal((await call('sf_login_as', { user: '005other' })).isError, false);
  await call('sf_screenshot', { path: path.join(dir, 'a.png') });
  await call('sf_scenario', { plan: [{ title: 'x', kind: 'positive' }] });
  await call(...open);
  await call('sf_api', check);
  const end = await call('sf_scenario', { end: 'Persona', result: 'PASS' });
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
  assert.match(end.body.route.id, /~read-only~probe-read$/);
});

test('a second end of the same title is DUPLICATE_ID with the id and replay already there', async (t) => {
  const { call, saved, file } = await serve(t);
  await run(call, 'Twice', 'PASS', [open, ['sf_api', check]]);
  const again = await run(call, 'Twice', 'PASS', [open, ['sf_api', check]]);
  const id = idOf('Twice');
  const { message, ...rest } = again.body.route;
  assert.deepEqual(rest, { saved: false, reason: 'DUPLICATE_ID', id, replay: replayOf(file, id) });
  assert.match(message, /already in/);
  assert.equal(saved().length, 1);
});

test('with no SF_TESTER_COMBINATIONS the end succeeds and says NO_CATALOGUE', async (t) => {
  const { call } = await serve(t, { catalogue: false });
  const end = await run(call, 'Nowhere', 'PASS', [open, ['sf_api', check]]);
  const { message, ...rest } = end.body.route;
  assert.deepEqual([end.isError, rest], [false, { saved: false, reason: 'NO_CATALOGUE' }]);
  assert.match(message, /SF_TESTER_COMBINATIONS/);
  assert.equal((await call('sf_api', { path: '/reads' })).body.reads, 0); // no page or persona read was paid for it
  assert.equal('improvements' in (await call('sf_end')).body, false); // a coded refusal is not a bug to list
});

test('the replay command runs from any folder and survives an apostrophe in the catalogue path or the org', async (t) => {
  const { call, file } = await serve(t, { prefix: "sf-o'route-", org: "o'neil@x.com" });
  const { replay } = (await run(call, 'Quoted', 'PASS', [open, ['sf_api', check]])).body.route;
  // The shell reads each quoted word back as the path it was made from.
  const words = replay.match(/^node (.+) replay --catalogue (.+) --org (.+) --only '\^quoted-[0-9a-f]{6}@scenario\$'$/);
  const unquote = (word) => execFileSync('sh', ['-c', `printf %s ${word}`], { encoding: 'utf8' });
  assert.deepEqual([unquote(words[1]), unquote(words[2]), unquote(words[3])], [fs.realpathSync(cli), file, "o'neil@x.com"]);
  assert.ok(file.includes("'") && path.isAbsolute(unquote(words[1])));
});

test('the app is saved as sf_start or sf_login_as took it, not as the developer name', async (t) => {
  const { call, saved } = await serve(t, { app: 'sf ui app' });
  await run(call, 'In start app', 'PASS', [open, ['sf_api', check]]);
  await call('sf_login_as', { user: '005other', app: 'sf ui console' });
  await run(call, 'In login app', 'PASS', [open, ['sf_api', check]]);
  assert.deepEqual(saved().map((x) => x.app), ['sf ui app', 'sf ui console']);
});

test('an app sf_login_as could not open leaves a route with no app, until one opens', async (t) => {
  const { call, saved } = await serve(t, { app: 'sf ui app' });
  const login = await call('sf_login_as', { user: '005other', app: 'No Such App' });
  assert.deepEqual([login.isError, login.body.code], [true, 'APP_UNAVAILABLE']);
  await run(call, 'After a failed app', 'PASS', [open, ['sf_api', check]]);
  assert.equal('app' in saved()[0], false); // not the app that failed, not the sf_start one, and not a guess
  await call('sf_start', { org: 'stub', app: 'sf ui app' }); // control: a start takes the null back too
  await run(call, 'After a start', 'PASS', [open, ['sf_api', check]]);
  assert.equal(saved()[1].app, 'sf ui app');
  assert.equal((await call('sf_login_as', { user: '005other', app: 'crash' })).isError, true); // not an SfUiError
  await run(call, 'After a crash', 'PASS', [open, ['sf_api', check]]);
  assert.equal('app' in saved()[2], false);
  const kept = await call('sf_login_as', { user: '005other' }); // no app: the session's app opens again
  assert.equal(kept.body.appKept, true, JSON.stringify(kept.body));
  await run(call, 'After the kept app', 'PASS', [open, ['sf_api', check]]);
  assert.equal(saved()[3].app, 'sf ui app'); // a kept app that opens ends it too, under the label sf_start took
  await call('sf_login_as', { user: '005other', app: 'No Such App' });
  assert.equal((await call('sf_login_as', { user: '005other', app: 'sf ui console' })).isError, false);
  await run(call, 'After an app that opens', 'PASS', [open, ['sf_api', check]]);
  assert.equal(saved()[4].app, 'sf ui console'); // an app that opens takes the null back
});

test('a plan sent before sf_start is kept, so the run is captured', async (t) => {
  const { call, saved } = await serve(t, { started: false });
  await call('sf_scenario', { plan: [{ title: 'Early plan', kind: 'positive', requirement: 'Close a Case' }] });
  await call('sf_start', { org: 'stub' });
  const end = await run(call, 'Early plan', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.equal(saved()[0].requirement, 'Close a Case');
});

test('every id carries a hash of the title, so titles that slug alike or not at all keep ids of their own', async (t) => {
  const { call, saved } = await serve(t);
  const titles = ['Save: ok', 'Save ok', '中文 1', '日本語 1', '🙂🙂'];
  const ids = [];
  for (const title of titles) ids.push((await run(call, title, 'PASS', [open, ['sf_api', check]])).body.route.id);
  assert.deepEqual(ids, titles.map(idOf));
  assert.deepEqual(ids.map((id) => id.replace(/-[0-9a-f]{6}@scenario$/, '')), ['save-ok', 'save-ok', '1', '1', 'scenario']); // written out, not from slug
  assert.equal(new Set(ids).size, titles.length);
  assert.deepEqual(saved().map((x) => x.component), ids.map((id) => id.replace('@scenario', '')));
});
test('a persona the page read already names is not read again', async (t) => {
  const { call, saved } = await serve(t, { env: { STUB_READ_PERSONA: '1' } });
  await call('sf_scenario', { plan: [{ title: 'As reader', kind: 'positive' }] });
  await call('sf_scenario', { start: 'As reader' });
  await call('sf_login_as', { user: '005other' });
  await call(...open);
  await call('sf_api', check);
  const end = await call('sf_scenario', { end: 'As reader', result: 'PASS' });
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].validity.persona, { profile: 'Read Only', permissionSets: ['Probe_Read'] });
});

test('a save that throws keeps its message, and a non-SfUiError is listed by sf_end', async (t) => {
  const { call } = await serve(t, { broken: true });
  const end = await run(call, 'Broken', 'PASS', [open, ['sf_api', check]]);
  assert.equal(end.isError, false);
  assert.deepEqual([end.body.route.saved, end.body.route.reason], [false, 'EISDIR']);
  assert.match(end.body.route.message, /EISDIR/);
  const [noted] = (await call('sf_end')).body.improvements.errors;
  assert.deepEqual([noted.tool, noted.code], ['sf_scenario', 'EISDIR']);
  assert.match(noted.message, /EISDIR/);
});

test('a call that settles after its scenario ended does not join the next scenario', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'A', kind: 'positive' }, { title: 'B', kind: 'positive' }] });
  await call('sf_scenario', { start: 'A' });
  const slow = call('sf_api', { path: '/slow' }); // answers after 2 s
  await call('sf_scenario', { end: 'A', result: 'FAIL', reason: 'probe' });
  await call('sf_scenario', { start: 'B' });
  await call(...open);
  await call('sf_api', check);
  assert.equal((await slow).isError, false);
  const end = await call('sf_scenario', { end: 'B', result: 'PASS' });
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
});
test('a call that settles after sf_login_as does not join the route run as the new user', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Relogged', kind: 'positive' }] });
  await call('sf_scenario', { start: 'Relogged' });
  const slow = call('sf_api', { path: '/slow' }); // answers after 2 s, after the login
  await call('sf_login_as', { user: '005other' });
  await call(...open);
  await call('sf_api', check);
  assert.equal((await slow).isError, false);
  const end = await call('sf_scenario', { end: 'Relogged', result: 'PASS' });
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
});
test('sf_start empties the steps of the session it restarts', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Restarted', kind: 'positive' }] });
  await call('sf_api', { path: '/string' });
  await call('sf_start', { org: 'stub' });
  const end = await run(call, 'Restarted', 'PASS', [open, ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route, [opened, { tool: 'sf_api', args: check }]);
});

test('sf_combinations and sf_improvements are never captured', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Looked up', 'PASS', [open, ['sf_combinations', {}], ['sf_improvements', {}], ['sf_api', check]]);
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved()[0].route.map((x) => x.tool), ['sf_open_tab', 'sf_api']);
});

test('sf_launch_action returns the toasts of an action that opens no dialog', async (t) => {
  const { call } = await serve(t);
  const r = await call('sf_launch_action', { recordId: 'a01x', apiName: 'Toast_Only' });
  assert.deepEqual([r.isError, r.body.toasts], [false, [{ type: 'success', title: 'Bumped' }]], JSON.stringify(r.body));
  assert.equal((await call('sf_launch_action', { recordId: 'a01x', apiName: 'Printable_View' })).body.navigated, true); // control: no dialog, no toast
});

test('sf_improvements says how many log lines did not parse, and only when some did', async (t) => {
  const { call, dir } = await serve(t);
  const ok = { area: 'a', kind: 'missing', what: 'w', seen: 1 };
  fs.writeFileSync(path.join(dir, 'imp.jsonl'), `${JSON.stringify(ok)}\n`);
  assert.equal('skipped' in (await call('sf_improvements')).body, false);
  fs.appendFileSync(path.join(dir, 'imp.jsonl'), '{"cut short\n');
  const r = await call('sf_improvements');
  assert.deepEqual([r.body.improvements.length, r.body.skipped], [1, 1], JSON.stringify(r.body));
});

test('sf_scenario is a localFile tool, so a route cannot hold it', async (t) => {
  assert.ok(CLASSES.localFile.includes('sf_scenario'));
  assert.ok(NOT_A_STEP.includes('sf_scenario'));
  const { call } = await serve(t);
  const r = await call('sf_run_route', { steps: [{ tool: 'sf_scenario', args: { start: 'x' } }] });
  assert.deepEqual([r.isError, r.body.code], [true, 'BAD_ARGS']);
});

test('a stale route in a negative scenario takes no remap, and the refusal says to remap in a positive scenario of its own', async (t) => {
  const { call } = await serve(t);
  const stale = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  await call('sf_scenario', { plan: [{ title: 'Refused', kind: 'negative' }, { title: 'Control', kind: 'positive' }] });
  await call('sf_scenario', { start: 'Refused' });
  const refused = await call('sf_run_route', { steps: [opened], id: 'old@x', validity: stale });
  assert.equal(refused.body.code, 'STALE_ROUTE');
  assert.equal('replaces' in refused.body.evidence, false, 'a negative scenario takes no remap');
  assert.match(refused.body.message, /a negative scenario saves no Draft: remap old@x in a positive scenario planned with replaces: old@x$/);
  await call('sf_scenario', { end: 'Refused', result: 'FAIL', reason: 'probe' });
  await call('sf_scenario', { start: 'Control' });
  const control = await call('sf_run_route', { steps: [opened], id: 'old@x', validity: stale });
  assert.equal(control.body.evidence.replaces, 'old@x', 'control: a positive scenario takes it');
});

test('a negative scenario already planned with replaces gets the same refusal', async (t) => {
  const { call } = await serve(t);
  const stale = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  await call('sf_scenario', { plan: [{ title: 'Refused', kind: 'negative', replaces: 'old@x' }] });
  await call('sf_scenario', { start: 'Refused' });
  const refused = await call('sf_run_route', { steps: [opened], id: 'old@x', validity: stale });
  assert.equal('replaces' in refused.body.evidence, false);
  assert.match(refused.body.message, /a negative scenario saves no Draft: remap old@x in a positive scenario planned with replaces: old@x$/);
});

test('a stale route with no id in a negative scenario is told to pass its id', async (t) => {
  const { call } = await serve(t);
  const stale = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  await call('sf_scenario', { plan: [{ title: 'Refused', kind: 'negative' }] });
  await call('sf_scenario', { start: 'Refused' });
  const refused = await call('sf_run_route', { steps: [opened], validity: stale });
  assert.equal(refused.body.code, 'STALE_ROUTE');
  assert.match(refused.body.message, /a negative scenario saves no Draft: pass the route's id so the remap can name it/);
  assert.doesNotMatch(refused.body.message, /replaces: the stale route/);
});

test('a stale route with no id in a positive scenario is told to pass its id, not to plan replaces again', async (t) => {
  const { call } = await serve(t);
  const stale = { page: { object: 'Stub__c', flexiPage: 'Stale_Page', flexiPageHash: 'h', formHash: 'f' } };
  await call('sf_scenario', { plan: [{ title: 'Remap', kind: 'positive', replaces: 'old@x' }] });
  await call('sf_scenario', { start: 'Remap' });
  const refused = await call('sf_run_route', { steps: [opened], validity: stale });
  assert.equal(refused.body.code, 'STALE_ROUTE');
  assert.match(refused.body.message, /; pass the route's id so the remap can name it$/);
  assert.doesNotMatch(refused.body.message, /plan the scenario with replaces/);
});

test('a remap planned on a scenario that ends NEGATIVE survives a re-plan as positive and saves its Draft', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_scenario', { plan: [{ title: 'Find it', kind: 'negative', replaces: 'old@x' }] });
  const neg = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]], false);
  assert.equal(neg.body.route.reason, 'NEGATIVE');
  const pos = await run(call, 'Find it', 'PASS', [open, ['sf_api', check]]);
  assert.equal(pos.body.route.saved, true, JSON.stringify(pos.body));
  assert.equal(saved()[0].replaces, 'old@x', 'the NEGATIVE end did not clear the remap');
});

test('sf_measure and sf_on_top with expect throw MEASURE_MISMATCH outside the tolerance and return the reading inside it', async (t) => {
  const { call } = await serve(t);
  const at = (path, value, tolerance) => ({ expect: { path, value, tolerance } });
  assert.equal((await call('sf_measure', { selector: 'x', ...at('elements.0.rect.height', 204, 5) })).isError, false);
  const bad = await call('sf_measure', { selector: 'x', ...at('elements.0.rect.height', 204, 3) });
  assert.deepEqual([bad.isError, bad.body.code, bad.body.evidence.actual], [true, 'MEASURE_MISMATCH', 200]);
  assert.equal((await call('sf_on_top', { ...at('onTop', true) })).isError, false);
  assert.equal((await call('sf_on_top', { ...at('visible', 1) })).body.code, 'MEASURE_MISMATCH');
  assert.equal((await call('sf_measure', { selector: 'x' })).isError, false); // no expect: a reading, as before
});

test('a scenario that ends PASS with a failed sf_measure is FAIL; one expect holds the route to NO_CHECK without it', async (t) => {
  const { call, saved } = await serve(t);
  const hold = { selector: 'x', expect: { path: 'elements.0.rect.height', value: 200 } };
  const ok = await run(call, 'Box height holds', 'PASS', [open, ['sf_measure', hold]]);
  assert.equal(ok.body.route.saved, true, JSON.stringify(ok.body));
  assert.equal(saved().at(-1).route.at(-1).args.expect.value, 200);
  const looked = await run(call, 'Box looked at', 'PASS', [open, ['sf_measure', { selector: 'x' }]]);
  assert.deepEqual(looked.body.route, { saved: false, reason: 'NO_CHECK' });
  await call('sf_scenario', { plan: [{ title: 'Box too tall', kind: 'positive' }] });
  const bad = await run(call, 'Box too tall', 'PASS', [open, ['sf_measure', { ...hold, expect: { ...hold.expect, value: 150 } }]], false);
  assert.equal(bad.body.verdict, 'FAIL', JSON.stringify(bad.body));
});

test('a route holding a layout check sets the laptop viewport after its page opens, unless it sets one before the check', async (t) => {
  const { call, saved } = await serve(t);
  const hold = ['sf_measure', { selector: 'x', expect: { path: 'count', value: 1 } }];
  await run(call, 'Sized by the route', 'PASS', [open, hold]);
  assert.deepEqual(saved().at(-1).route.map((x) => x.tool), ['sf_open_tab', 'sf_viewport', 'sf_measure']);
  assert.deepEqual(saved().at(-1).route[1].args, { width: 1470, height: 956 });
  await run(call, 'Sized by the agent', 'PASS', [open, ['sf_viewport', { width: 800, height: 600 }], hold]);
  assert.deepEqual(saved().at(-1).route.map((x) => x.args.width), [undefined, 800, undefined]);
  await run(call, 'No layout check', 'PASS', [open, ['sf_api', check]]);
  assert.deepEqual(saved().at(-1).route.map((x) => x.tool), ['sf_open_tab', 'sf_api']);
});

test('a route saved after an earlier scenario resized sets the size that is live, not the laptop one', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_viewport', { width: 800, height: 600 }); // an earlier scenario's resize holds for the session
  await run(call, 'Saved at 800', 'PASS', [open, ['sf_measure', { selector: 'x', expect: { path: 'count', value: 1 } }]]);
  assert.deepEqual(saved().at(-1).route[1], { tool: 'sf_viewport', args: { width: 800, height: 600 } });
});

test('a route sets the size its first layout check ran at, not the one live when it is saved', async (t) => {
  const { call, saved } = await serve(t);
  await call('sf_viewport', { width: 1000, height: 700 });
  const hold = ['sf_measure', { selector: 'x', expect: { path: 'count', value: 1 } }];
  await run(call, 'Resized after', 'PASS', [open, hold, ['sf_viewport', { width: 800, height: 600 }]]);
  assert.deepEqual(saved().at(-1).route[1], { tool: 'sf_viewport', args: { width: 1000, height: 700 } });
});

test('a route saves when the browser is gone at the end, at the size its check ran at', async (t) => {
  const { call, saved } = await serve(t, { env: { SF_TESTER_IDLE_MS: '50' }, started: false });
  const session = (await call('sf_start', { org: 'stub', session: 'new' })).body.session;
  const on = (args) => ({ ...args, session });
  await call('sf_viewport', on({ width: 1000, height: 700 }));
  await call('sf_scenario', on({ plan: [{ title: 'Reaped', kind: 'positive' }] }));
  await call('sf_scenario', on({ start: 'Reaped' }));
  await call(open[0], on(open[1]));
  await call('sf_measure', on({ selector: 'x', expect: { path: 'count', value: 1 } }));
  await new Promise((r) => setTimeout(r, 200));
  await call('sf_start', { org: 'stub' }); // a start reaps every session idle past the window
  const end = await call('sf_scenario', on({ end: 'Reaped', result: 'PASS' }));
  assert.equal(end.body.route.saved, true, JSON.stringify(end.body));
  assert.deepEqual(saved().at(-1).route[1], { tool: 'sf_viewport', args: { width: 1000, height: 700 } });
});

test('a sf_measure with no expect after the page opens is no check, even when an sf_api before it has one', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Looks only after open', 'PASS', [['sf_api', check], open, ['sf_measure', { selector: 'x' }]]);
  assert.deepEqual(end.body.route, { saved: false, reason: 'NO_CHECK' }, JSON.stringify(end.body));
  assert.deepEqual(saved(), []);
});

test('expect takes a null value and refuses a negative tolerance', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('sf_measure', { selector: 'x', expect: { path: 'elements.0.clippedBy', value: null } })).body.code, 'MEASURE_MISMATCH'); // the stub's element has no clippedBy: not there is not null
  const bad = await call('sf_run_route', { steps: [{ tool: 'sf_measure', args: { selector: 'x', expect: { path: 'count', value: 1, tolerance: -1 } } }] });
  assert.deepEqual([bad.isError, bad.body.code], [true, 'BAD_ARGS'], JSON.stringify(bad.body)); // a route meets the schema before its first step
});

test('an expect equal to an earlier reading of the same aim is marked weak, not refused; another aim is not', async (t) => {
  const { call } = await serve(t);
  const hold = (selector) => ['sf_measure', { selector, expect: { path: 'elements.0.rect.height', value: 200 } }];
  const end = await run(call, 'Copied', 'PASS', [['sf_measure', { selector: 'x' }], hold('x'), hold('y')]);
  const [copied, other] = end.body.checks;
  assert.deepEqual([copied.pass, copied.weak, copied.reason], [true, true, 'expect copied from a reading in this run'], JSON.stringify(end.body));
  assert.deepEqual([other.pass, other.weak], [true, undefined]);
});

test('an expect that states what a requirement states is not copied, though a look gave the same value', async (t) => {
  const { call, saved } = await serve(t);
  const end = await run(call, 'Requirement shapes', 'PASS', [open, ['sf_on_top', { name: 'Save' }], ['sf_on_top', { name: 'Save', expect: { path: 'onTop', value: true } }],
    ['sf_measure', { selector: 'x' }], ['sf_measure', { selector: 'x', expect: { path: 'elements.0.visible', value: 0.5 } }]]);
  assert.deepEqual(end.body.checks.map((c) => c.weak), [undefined, undefined], JSON.stringify(end.body));
  assert.equal(end.body.route.saved, true);
  assert.equal(saved().length, 1);
});

test('a look in an earlier scenario, or before the page opened, is not one an expect copies', async (t) => {
  const { call } = await serve(t);
  const look = ['sf_measure', { selector: 'x' }];
  const copy = ['sf_measure', { selector: 'x', expect: { path: 'elements.0.rect.height', value: 200 } }];
  await run(call, 'First', 'PASS', [open, look]);
  const next = await run(call, 'Second', 'PASS', [copy]); // no page opens, so only begin can clear the look
  assert.equal(next.body.checks[0].weak, undefined, JSON.stringify(next.body)); // the first scenario's look is gone
  const reopened = await run(call, 'Third', 'PASS', [look, open, copy]);
  assert.equal(reopened.body.checks[0].weak, undefined, JSON.stringify(reopened.body)); // the look was at the page before
});

test('a copied expect after the page opens is no check, even when a real one ran before it', async (t) => {
  const { call, saved } = await serve(t);
  const copy = ['sf_measure', { selector: 'x', expect: { path: 'elements.0.rect.height', value: 200 } }];
  const end = await run(call, 'Real before open', 'PASS', [['sf_api', check], open, ['sf_measure', { selector: 'x' }], copy]);
  assert.deepEqual([end.body.weak, end.body.checks.map((c) => !!c.weak), end.body.route], [undefined, [false, true], { saved: false, reason: 'NO_CHECK' }], JSON.stringify(end.body));
  assert.deepEqual(saved(), []);
});

test('a scenario whose only checks are copied expects is NO_CHECK; one real check beside them saves', async (t) => {
  const { call, saved } = await serve(t);
  const look = ['sf_measure', { selector: 'x' }];
  const copy = ['sf_measure', { selector: 'x', expect: { path: 'elements.0.rect.height', value: 200 } }];
  const only = await run(call, 'Copy only', 'PASS', [open, look, copy]);
  assert.deepEqual([only.body.route, only.body.weak], [{ saved: false, reason: 'NO_CHECK' }, true], JSON.stringify(only.body));
  const real = await run(call, 'Copy and real', 'PASS', [open, look, copy, ['sf_api', check]]);
  assert.equal(real.body.route.saved, true, JSON.stringify(real.body));
  assert.equal(saved().length, 1);
});

// A production org saves no route by default: sf_start's saveRoutes turns it on, and a restart on the same org keeps it.
test('on a production org a PASS saves no route unless sf_start asks with saveRoutes', async (t) => {
  const { call, saved } = await serve(t, { started: false });
  const started = await call('sf_start', { org: 'prod' });
  assert.deepEqual([started.body.production, started.body.saveRoutes], [true, false]);
  assert.deepEqual((await run(call, 'Prod off', 'PASS', [open, ['sf_api', check]])).body.route, { saved: false, reason: 'SAVE_ROUTES_OFF' });
  assert.deepEqual(saved(), []);
  assert.equal((await call('sf_start', { org: 'prod', saveRoutes: true })).body.saveRoutes, true);
  assert.equal((await run(call, 'Prod on', 'PASS', [open, ['sf_api', check]])).body.route.saved, true);
  assert.equal((await call('sf_start', { org: 'prod' })).body.saveRoutes, true, 'a restart keeps the last one given');
  // Asked on a scratch org, it does not follow a restart onto production: the default is back there.
  assert.equal((await call('sf_start', { org: 'stub', saveRoutes: true })).body.saveRoutes, true);
  assert.equal((await call('sf_start', { org: 'prod' })).body.saveRoutes, false, 'another org takes its own default');
  // Control: off by request on a scratch org too, and on by default there.
  const other = await serve(t, { started: false });
  assert.equal((await other.call('sf_start', { org: 'stub' })).body.saveRoutes, true);
  assert.equal((await other.call('sf_start', { org: 'stub', saveRoutes: false })).body.saveRoutes, false);
  assert.equal((await run(other.call, 'Stub off', 'PASS', [open, ['sf_api', check]])).body.route.reason, 'SAVE_ROUTES_OFF');
});
