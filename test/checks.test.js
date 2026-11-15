'use strict';

// checks.map turns a checking tool's result or error into a typed record; no org, no server.

const test = require('node:test');
const assert = require('node:assert/strict');
const checks = require('../src/checks');

const fail = (code, evidence) => Object.assign(new Error(code), { code, evidence });

test('sf_assert_field records its oracle and both sides, on a pass and on a mismatch', () => {
  const args = { recordId: '001', field: 'Rating', expected: 'Warm' };
  assert.deepEqual(checks.map('sf_assert_field', args, { api: 'Warm', ui: 'Warm', apiDisplay: 'Warm', extra: 1 }),
    { tool: 'sf_assert_field', oracle: 'both', target: { recordId: '001', field: 'Rating' }, expected: 'Warm', actual: { api: 'Warm', apiDisplay: 'Warm', ui: 'Warm' }, pass: true });
  const bad = checks.map('sf_assert_field', { ...args, via: 'api' }, null, fail('FIELD_VALUE_MISMATCH', { expected: 'Warm', api: 'Hot' }));
  assert.deepEqual(bad, { tool: 'sf_assert_field', oracle: 'api', target: { recordId: '001', field: 'Rating' }, expected: 'Warm', actual: { api: 'Hot' }, pass: false });
  // A field the page does not show is a failed check, so a scenario ended PASS over it is FAIL.
  const gone = checks.map('sf_assert_field', args, null, fail('FIELD_NOT_SHOWN', { apiName: 'Rating', tabs: ['Related'], hidden: true }));
  assert.deepEqual([gone.pass, gone.actual], [false, { ui: null, notShown: true, hidden: true }]);
  assert.equal(checks.map('sf_assert_field', args, null, fail('LOCATOR_TIMEOUT', {})), null, 'control: another error is no check');
});

test('sf_api records only with expect, and takes the actual from the evidence on a failure', () => {
  const args = { path: '/x', expect: { path: 'a.b', equals: 3 } };
  assert.deepEqual(checks.map('sf_api', args, { a: { b: 3 } }), { tool: 'sf_api', oracle: 'api', target: { path: '/x', as: 'user', at: 'a.b' }, expected: 3, actual: 3, pass: true });
  assert.deepEqual(checks.map('sf_api', args, null, fail('VALUE_MISMATCH', { actual: 4 })), { tool: 'sf_api', oracle: 'api', target: { path: '/x', as: 'user', at: 'a.b' }, expected: 3, actual: 4, pass: false });
  assert.equal(checks.map('sf_api', { path: '/x' }, { a: 1 }), null);
  // Nothing at the path is not a null: expecting null of a missing value must not read as null against null.
  const none = checks.map('sf_api', { path: '/x', expect: { path: 'a.b', equals: null } }, null, fail('VALUE_MISMATCH', { path: 'a.b', expected: null, actual: undefined }));
  assert.deepEqual([none.expected, none.actual, none.pass, none.missing], [null, null, false, true]);
  const lookalike = checks.map('sf_api', args, null, fail('VALUE_MISMATCH', { actual: { missing: true } }));
  assert.deepEqual([lookalike.actual, 'missing' in lookalike], [{ missing: true }, false], 'an API value shaped like the flag is not the flag');
  assert.equal(checks.map('sf_api', args, null, fail('VALUE_MISMATCH', { actual: null })).actual, null, 'a real null stays null');
});

test('sf_wait records matched, or null on a timeout; a gone wait carries its text', () => {
  const any = [{ toast: 'Saved' }];
  assert.deepEqual(checks.map('sf_wait', { any }, { matched: { index: 0 } }), { tool: 'sf_wait', oracle: 'rendered', expected: any, actual: { index: 0 }, pass: true });
  assert.deepEqual(checks.map('sf_wait', { text: 'Busy', gone: true }, {}, fail('TIMEOUT', {})), { tool: 'sf_wait', oracle: 'rendered', expected: { text: 'Busy', gone: true }, actual: null, pass: false });
  const covered = [{ index: 1, text: 'Done', top: { tag: 'span' } }]; // index is the condition that was covered
  const both = [{ toast: 'Saved' }, { text: 'Done' }];
  assert.deepEqual(checks.map('sf_wait', { any: both }, {}, fail('TEXT_COVERED', { covered })), { tool: 'sf_wait', oracle: 'rendered', expected: both, actual: { covered }, pass: false });
  assert.deepEqual(checks.map('sf_wait', { text: 'Done' }, {}, fail('TEXT_COVERED', { covered })).actual.covered.map((c) => c.index), [1]);
  assert.equal(checks.map('sf_wait', { text: 'Done' }, {}, fail('BAD_ARGS')), null);
  assert.equal(checks.map('sf_wait', { text: 'Done' }, {}).actual, 'Done');
  assert.deepEqual(checks.map('sf_wait', { text: 'Busy', gone: true }, {}).actual, { text: 'Busy', gone: true });
  assert.equal(checks.map('sf_wait', { any }, {}).actual, null);
});

test('sf_verify_live records the marker, false on STALE_BUILD', () => {
  assert.deepEqual(checks.map('sf_verify_live', { marker: 'v2' }, { live: true }), { tool: 'sf_verify_live', oracle: 'rendered', target: {}, expected: 'v2', actual: true, pass: true });
  assert.equal(checks.map('sf_verify_live', { marker: 'v2' }, null, fail('STALE_BUILD', {})).actual, false);
});

test('an error that is not the check outcome, and a tool that does not check, record nothing', () => {
  for (const code of ['NO_SESSION', 'BAD_ARGS', 'RECORD_UNAVAILABLE', 'VALUE_MISMATCH']) assert.equal(checks.map('sf_assert_field', {}, null, fail(code, {})), null, code);
  assert.equal(checks.map('sf_wait', { text: 'x' }, null, fail('NO_SESSION')), null);
  assert.equal(checks.map('sf_measure', {}, {}), null); // a reading with no expect is not a check
  assert.equal(checks.map('sf_on_top', {}, {}), null);
});

test('a raw Playwright TimeoutError records nothing on any of the checking tools', () => {
  const raw = Object.assign(new Error('Timeout 5000ms exceeded'), { name: 'TimeoutError' });
  const args = { sf_assert_field: {}, sf_api: { expect: { path: 'a', equals: 1 } }, sf_wait: { text: 'x' }, sf_verify_live: { marker: 'm' } };
  for (const [tool, a] of Object.entries(args)) assert.equal(checks.map(tool, a, null, raw), null, tool);
});

test('record stamps at, weak is only an empty PASS', () => {
  const list = [];
  checks.record(list, { tool: 'a' });
  checks.record(list, { tool: 'b' });
  assert.match(list[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(checks.weak('PASS', []), true);
  assert.equal(checks.weak('PASS', list), false);
  assert.equal(checks.weak('FAIL', []), false);
});

test('a ledger is made on first use and is the same object after', () => {
  const ledgers = new Map();
  const led = checks.ledger(ledgers, 's1');
  assert.deepEqual([led.open, led.checks, typeof led.used], [null, [], 'number']);
  assert.equal(checks.ledger(ledgers, 's1'), led);
  assert.notEqual(checks.ledger(ledgers, 's2'), led);
});

test('finish returns the scenario\'s checks and empties the list', () => {
  const led = checks.ledger(new Map(), 'default');
  checks.begin(led, 'A');
  checks.record(led.checks, { tool: 'x' });
  assert.deepEqual(checks.finish(led, 'A', 'PASS').checks.map((c) => c.tool), ['x']);
  assert.deepEqual([led.open, led.checks], [null, []]);
});

test('noteError keeps the newest 20 and drain lists them with the recorded count, then nothing when both are empty', () => {
  const led = checks.ledger(new Map(), 'default');
  for (let i = 0; i < 25; i += 1) checks.noteError(led, { tool: 'sf_click', code: 'NOT_FOUND', message: `m${i}` });
  const { improvements } = checks.drain(led);
  assert.deepEqual([improvements.errors.length, improvements.errors[0].message, improvements.errors.at(-1).message, improvements.recorded, improvements.dropped], [20, 'm5', 'm24', 0, 5]);
  assert.match(improvements.errors[0].at, /^\d{4}-/);
  const recordedOnly = checks.ledger(new Map(), 'default');
  recordedOnly.recorded = 2;
  assert.deepEqual(checks.drain(recordedOnly), { improvements: { recorded: 2, errors: [] } }, 'no checks key beside it');
});

test('drain hands sf_end the records since the last start or end, with a scenario still open, and nothing when there are none', () => {
  assert.equal(checks.drain(undefined), undefined, 'a session with no ledger');
  const led = checks.ledger(new Map(), 'default');
  assert.equal(checks.drain(led), undefined, 'a ledger with no records');
  checks.record(led.checks, { tool: 'stray' });
  assert.deepEqual(checks.drain(led), { checks: [led.checks[0]] }, 'records made with no scenario at all');
  checks.begin(led, 'A');
  assert.deepEqual(checks.drain(led), { checks: [], open: 'A' }, 'a scenario left open with no records is still named');
  checks.record(led.checks, { tool: 'x' });
  assert.deepEqual([checks.drain(led).checks.map((c) => c.tool), checks.drain(led).open], [['x'], 'A']);
  checks.finish(led, 'A', 'PASS');
  assert.equal(checks.drain(led), undefined, 'what an sf_scenario end returned is not handed back again');
});

test('an end naming another title than the open one is BAD_ARGS naming the open one, and changes nothing', () => {
  const led = checks.ledger(new Map(), 'default');
  checks.begin(led, 'B');
  checks.record(led.checks, { tool: 'x' });
  assert.throws(() => checks.finish(led, 'A', 'PASS'), (e) => e.code === 'BAD_ARGS' && e.message.includes('"B"') && e.message.includes('"A"'));
  assert.deepEqual([led.open, led.checks.length], ['B', 1]);
});

test('an end with nothing open returns stray records, else is BAD_ARGS', () => {
  const led = checks.ledger(new Map(), 'default');
  checks.begin(led, 'A');
  checks.finish(led, 'A', 'FAIL');
  assert.throws(() => checks.finish(led, 'A', 'PASS'), (e) => e.code === 'BAD_ARGS' && e.message.includes('no scenario named "A"'));
  checks.record(led.checks, { tool: 'stray' });
  assert.deepEqual(checks.finish(led, 'Z', 'PASS').checks.map((c) => c.tool), ['stray']);
  assert.throws(() => checks.finish(led, 'Z', 'PASS'), { code: 'BAD_ARGS' });
});

test('begin of the open title is a no-op that keeps its checks; another title is BAD_ARGS naming the open one', () => {
  const led = checks.ledger(new Map(), 'default');
  checks.begin(led, 'A');
  checks.record(led.checks, { tool: 'x' });
  checks.begin(led, 'A');
  assert.equal(led.checks.length, 1, 'a retried start keeps what the scenario recorded');
  assert.throws(() => checks.begin(led, 'B'), (e) => e.code === 'BAD_ARGS' && e.message.includes('"A"'));
  assert.throws(() => checks.finish(led, 'B', 'PASS'), (e) => e.code === 'BAD_ARGS' && e.message.includes('"A"'));
  assert.equal(led.open, 'A', 'a refused call changes nothing');
  checks.finish(led, 'A', 'PASS');
  checks.begin(led, 'B');
});

test('a start drops records made while no scenario was open', () => {
  const led = checks.ledger(new Map(), 'default');
  checks.record(led.checks, { tool: 'stray' });
  checks.begin(led, 'A');
  assert.deepEqual(led.checks, []);
});

// A fake handler over a real ledger map: what the server's wrapper does for every tool.
const harness = (run) => {
  const ledgers = new Map();
  const led = checks.ledger(ledgers, 's1');
  return { led, call: (args, extra) => checks.recorded(ledgers, () => 's1', 'sf_wait', run)(args, extra) };
};

test('recorded leaves one record after the call settles, a failure included, and rethrows the error', async () => {
  const ok = harness(async () => ({ matched: { index: 0 } }));
  assert.deepEqual(await ok.call({ any: [{ text: 'a' }] }), { matched: { index: 0 } });
  assert.deepEqual(ok.led.checks.map((c) => c.pass), [true]);
  const bad = harness(async () => { throw fail('TIMEOUT', {}); });
  await assert.rejects(bad.call({ text: 'a' }), { code: 'TIMEOUT' });
  assert.deepEqual(bad.led.checks.map((c) => c.pass), [false]);
  const other = harness(async () => { throw fail('NO_SESSION'); });
  await assert.rejects(other.call({ text: 'a' }), { code: 'NO_SESSION' });
  assert.deepEqual(other.led.checks, []);
});

test('recorded drops the record of a cancelled call', async () => {
  const h = harness(async () => ({}));
  const ac = new AbortController();
  const late = h.call({ text: 'a' }, { signal: ac.signal });
  ac.abort();
  await late;
  assert.deepEqual(h.led.checks, []);
});

test('recorded drops the record of a call that straddled an end and a start', async () => {
  let release;
  const h = harness(() => new Promise((r) => { release = r; }));
  checks.begin(h.led, 'A');
  const late = h.call({ text: 'a' });
  checks.finish(h.led, 'A', 'PASS');
  checks.begin(h.led, 'B');
  release({});
  await late;
  assert.deepEqual(h.led.checks, [], 'the result belongs to A, not to B');
  // The same call inside one scenario still records.
  const same = harness(async () => ({}));
  checks.begin(same.led, 'A');
  await same.call({ text: 'a' });
  assert.equal(same.led.checks.length, 1);
});

test('recorded drops a late record after a rerun of the same title', async () => {
  let release;
  const h = harness(() => new Promise((r) => { release = r; }));
  checks.begin(h.led, 'A');
  const late = h.call({ text: 'a' });
  checks.finish(h.led, 'A', 'FAIL');
  checks.begin(h.led, 'A');
  release({});
  await late;
  assert.deepEqual(h.led.checks, [], 'the same title, a new instance');
});

test('recorded does not bring back a ledger that sf_end deleted', async () => {
  let release;
  const ledgers = new Map();
  checks.ledger(ledgers, 's1');
  const call = checks.recorded(ledgers, () => 's1', 'sf_wait', () => new Promise((r) => { release = r; }));
  const late = call({ text: 'a' });
  ledgers.delete('s1');
  release({});
  await late;
  assert.equal(ledgers.has('s1'), false);
});

test('recorded drops a record whose scenario ended with none started after, or began after the call did', async () => {
  let release;
  const gate = () => new Promise((r) => { release = r; });
  const ended = harness(gate);
  checks.begin(ended.led, 'A');
  const a = ended.call({ text: 'a' });
  checks.finish(ended.led, 'A', 'PASS');
  release({});
  await a;
  assert.deepEqual(ended.led.checks, [], 'an end alone makes the call stale');
  const stray = harness(gate);
  const b = stray.call({ text: 'a' });
  checks.begin(stray.led, 'B');
  release({});
  await b;
  assert.deepEqual(stray.led.checks, [], 'a call made before the scenario began is not its check');
});

test('recorded makes no ledger for a session that has none', async () => {
  const ledgers = new Map();
  assert.deepEqual(await checks.recorded(ledgers, () => 'ghost', 'sf_wait', async () => ({}))({ text: 'a' }), {});
  assert.equal(ledgers.size, 0);
});

test('free drops a ledger with no browser and nothing for sf_end to hand back, and keeps one a restart took or default is', () => {
  const led = (more) => ({ open: null, checks: [], errors: [], recorded: 0, ...more });
  const ledgers = new Map([['a', led()], ['b', led()], ['c', led({ open: 'X' })], ['default', led()], ['e', led({ errors: [{}] })], ['r', led({ recorded: 1 })], ['k', led({ checks: [{}] })]]);
  const browsers = new Map([['b', {}]]); // a same-id sf_start took b while the close was awaited
  for (const id of ['a', 'b', 'c', 'default', 'e', 'r', 'k']) {
    checks.free(ledgers, browsers, id);
  }
  assert.deepEqual([...ledgers.keys()], ['b', 'c', 'default', 'e', 'r', 'k'], 'e, r and k hold what sf_end still has to hand back');
});

test('sweep drops an abandoned ledger past the idle window, open or not, and spares default, a live browser and a recent one', () => {
  const ledgers = new Map([['old', { open: 'X', used: 0 }], ['oldfree', { open: null, used: 0 }], ['default', { open: 'X', used: 0 }], ['live', { open: null, used: 0 }], ['fresh', { open: 'X', used: 900 }], ['kept', { open: 'X', used: 0 }]]);
  checks.sweep(ledgers, new Map([['live', {}]]), 500, 'kept', 1000);
  assert.deepEqual([...ledgers.keys()], ['default', 'live', 'fresh', 'kept'], 'kept is the id being started');
});

test('recorded and begin keep used current', async () => {
  const ledgers = new Map();
  const led = checks.ledger(ledgers, 's1');
  led.used = 0;
  checks.begin(led, 'A');
  assert.ok(led.used > 0, 'begin');
  led.used = 0;
  await checks.recorded(ledgers, () => 's1', 'sf_wait', async () => ({}))({ text: 'a' });
  assert.ok(led.used > 0, 'a record');
  led.used = 0;
  checks.finish(led, 'A', 'PASS');
  assert.ok(led.used > 0, 'finish');
});

// finish decides the verdict: a positive scenario cannot end PASS over a check whose last record failed.
const wait = (pass, text = 'Saved') => ({ tool: 'sf_wait', oracle: 'rendered', expected: text, actual: pass ? text : { covered: [{ text }] }, pass });
const ended = (kinds, records, title, result) => {
  const led = checks.ledger(new Map(), 'default');
  for (const [k, v] of Object.entries(kinds)) led.kinds.set(k, v);
  checks.begin(led, title);
  records.forEach((r) => checks.record(led.checks, r));
  return checks.finish(led, title, result);
};

test('a positive scenario with failed checks is FAIL whatever the tester passed, and says so', () => {
  const out = ended({ A: 'positive' }, [wait(false), wait(false)], 'A', 'PASS');
  assert.deepEqual([out.verdict, out.overruled], ['FAIL', true]);
});

test('a retried check that ends passing stands, but a still-failing retry does not', () => {
  const out = ended({ A: 'positive' }, [wait(false), wait(true)], 'A', 'PASS');
  assert.deepEqual([out.verdict, 'overruled' in out], ['PASS', false]);
  assert.equal(ended({ A: 'positive' }, [wait(true), wait(false)], 'A', 'PASS').verdict, 'FAIL');
  assert.equal(ended({ A: 'positive' }, [wait(false, 'X'), wait(true, 'Y')], 'A', 'PASS').verdict, 'FAIL', 'a different expected is a different check');
});

test('a negative scenario keeps the tester result over a failed check', () => {
  const out = ended({ A: 'negative' }, [wait(false)], 'A', 'PASS');
  assert.deepEqual([out.verdict, 'overruled' in out], ['PASS', false]);
});

test('a title no plan named is judged as positive', () => {
  assert.equal(ended({}, [wait(false)], 'A', 'PASS').verdict, 'FAIL');
});

test('a tester FAIL stands over passing checks, and a PASS with no checks is still weak', () => {
  const failed = ended({ A: 'positive' }, [wait(true)], 'A', 'FAIL');
  assert.deepEqual([failed.verdict, 'overruled' in failed], ['FAIL', false]);
  const bare = ended({ A: 'positive' }, [], 'A', 'PASS');
  assert.deepEqual([bare.verdict, bare.weak, 'overruled' in bare], ['PASS', true, false]);
});

// A check is what it looked at as well as what it expected: a pass on another field must not hide a fail.
test('a pass on another field, record, path or marker does not hide a failed check', () => {
  const field = (recordId, f, bad) => checks.map('sf_assert_field', { recordId, field: f, expected: true }, bad ? null : { api: true, ui: true }, bad && fail('FIELD_VALUE_MISMATCH', { api: false }));
  assert.equal(ended({ A: 'positive' }, [field('001', 'X', true), field('001', 'Y')], 'A', 'PASS').verdict, 'FAIL');
  assert.equal(ended({ A: 'positive' }, [field('001', 'X', true), field('002', 'X')], 'A', 'PASS').verdict, 'FAIL');
  const api = (path, bad) => checks.map('sf_api', { path, expect: { path: 'a', equals: 1 } }, bad ? null : { a: 1 }, bad && fail('VALUE_MISMATCH', { actual: 2 }));
  assert.equal(ended({ A: 'positive' }, [api('/p1', true), api('/p2')], 'A', 'PASS').verdict, 'FAIL');
  const live = (recordId, bad) => checks.map('sf_verify_live', { recordId, lwcApiName: 'c', marker: 'v2' }, bad ? null : { live: true }, bad && fail('STALE_BUILD', {}));
  assert.equal(ended({ A: 'positive' }, [live('001', true), live('002')], 'A', 'PASS').verdict, 'FAIL');
});

test('a retry of the same field with a longer timeout is still the same check', () => {
  const args = { path: '/x', expect: { path: 'a', equals: 1 } };
  const first = checks.map('sf_api', args, null, fail('VALUE_MISMATCH', { actual: 2 }));
  const retry = checks.map('sf_api', { ...args, expect: { ...args.expect, timeoutMs: 5000 } }, { a: 1 });
  assert.equal(ended({ A: 'positive' }, [first, retry], 'A', 'PASS').verdict, 'PASS');
});

test('an end with no plan on the ledger says unplanned, and a planned one does not', () => {
  const failing = [wait(false)];
  const bare = ended({}, failing, 'A', 'PASS');
  assert.deepEqual([bare.verdict, bare.unplanned], ['FAIL', true]);
  for (const kind of ['positive', 'negative']) assert.equal('unplanned' in ended({ A: kind }, failing, 'A', 'PASS'), false, kind);
});

test('an sf_api read as the user that failed is not hidden by a pass as admin', () => {
  const args = { path: '/x', expect: { path: 'a', equals: 1 } };
  const user = checks.map('sf_api', args, null, fail('VALUE_MISMATCH', { actual: 2 }));
  const admin = checks.map('sf_api', { ...args, as: 'admin' }, { a: 1 });
  assert.equal(ended({ A: 'positive' }, [user, admin], 'A', 'PASS').verdict, 'FAIL');
  assert.equal(ended({ A: 'positive' }, [user, checks.map('sf_api', { ...args, as: 'user' }, { a: 1 })], 'A', 'PASS').verdict, 'PASS', 'an explicit user is the default');
});

test('a wait re-aimed at another scope is one check, and a covered text stays failed in any scope', () => {
  const timeout = checks.map('sf_wait', { text: 'Saved', inModal: true }, {}, fail('TIMEOUT', {}));
  const pass = checks.map('sf_wait', { text: 'Saved' }, {});
  assert.equal(ended({ A: 'positive' }, [timeout, pass], 'A', 'PASS').verdict, 'PASS');
  const covered = (scope) => checks.map('sf_wait', { text: 'Saved', ...scope }, {}, fail('TEXT_COVERED', { covered: [{ text: 'Saved' }] }));
  assert.equal(ended({ A: 'positive' }, [covered({ inModal: true }), covered({})], 'A', 'PASS').verdict, 'FAIL');
});

test('expectReading passes within the tolerance and throws MEASURE_MISMATCH outside it, for a number, a boolean and a missing path', () => {
  const out = { onTop: true, elements: [{ rect: { y: -94 } }] };
  assert.equal(checks.expectReading(out, { path: 'elements.0.rect.y', value: -90, tolerance: 4 }), out);
  assert.equal(checks.expectReading(out, { path: 'onTop', value: true }), out);
  const miss = (e) => { try { checks.expectReading(out, e); } catch (err) { return err; } };
  assert.deepEqual([miss({ path: 'elements.0.rect.y', value: -90, tolerance: 3 })?.code, miss({ path: 'elements.0.rect.y', value: -90 })?.evidence.actual], ['MEASURE_MISMATCH', -94]);
  assert.equal(miss({ path: 'onTop', value: false })?.code, 'MEASURE_MISMATCH');
  assert.equal(miss({ path: 'elements.3.rect.y', value: 0 })?.evidence.actual, null);
});

test('sf_measure and sf_on_top with expect record the layout oracle, the reading on a pass and the miss on a fail', () => {
  const args = { expect: { path: 'elements.0.rect.height', value: 204, tolerance: 5 } };
  const target = { path: 'elements.0.rect.height', tolerance: 5 };
  assert.deepEqual(checks.map('sf_measure', args, { elements: [{ rect: { height: 200 } }] }),
    { tool: 'sf_measure', oracle: 'layout', target, expected: 204, actual: 200, pass: true });
  const bad = checks.map('sf_measure', args, null, fail('MEASURE_MISMATCH', { actual: 150 }));
  assert.deepEqual([bad.pass, bad.actual], [false, 150]);
  assert.deepEqual(checks.map('sf_on_top', { expect: { path: 'onTop', value: true } }, { onTop: true }),
    { tool: 'sf_on_top', oracle: 'layout', target: { path: 'onTop' }, expected: true, actual: true, pass: true });
  assert.equal(checks.map('sf_on_top', { expect: { path: 'onTop', value: true } }, null, fail('NOT_FOUND', {})), null);
});

test('a pass on one aim does not replace a fail on another that shares the path', () => {
  const led = checks.ledger(new Map(), 'a');
  checks.begin(led, 'Two elements');
  const expect = { path: 'elements.0.visible', value: 1 };
  led.checks.push(checks.map('sf_measure', { selector: '.hover-card', expect }, null, fail('MEASURE_MISMATCH', { actual: 0.2 })));
  led.checks.push(checks.map('sf_measure', { selector: '.modal-header', expect }, { elements: [{ visible: 1 }] }));
  assert.deepEqual(led.checks.map((c) => c.target.selector), ['.hover-card', '.modal-header']);
  assert.equal(checks.finish(led, 'Two elements', 'PASS').verdict, 'FAIL');
});

test('a look the client cancelled is not kept as a reading', async () => {
  const ledgers = new Map();
  const led = checks.ledger(ledgers, 's1');
  const look = checks.recorded(ledgers, () => 's1', 'sf_measure', async () => ({ count: 1 }));
  await look({ selector: 'x' }, { signal: { aborted: true } });
  assert.equal(led.readings.length, 0);
  await look({ selector: 'x' }, {});
  assert.equal(led.readings.length, 1); // control: a look nobody cancelled is kept
});

test('a look still running when its scenario ends is not a reading of the next scenario', async () => {
  const ledgers = new Map();
  const led = checks.ledger(ledgers, 's1');
  checks.begin(led, 'First');
  let finish;
  const look = checks.recorded(ledgers, () => 's1', 'sf_measure', () => new Promise((r) => { finish = r; }));
  const running = look({ selector: 'x' }, {});
  checks.finish(led, 'First', 'PASS');
  checks.begin(led, 'Second');
  finish({ count: 1 });
  await running;
  assert.equal(led.readings.length, 0);
  await checks.recorded(ledgers, () => 's1', 'sf_measure', async () => ({ count: 1 }))({ selector: 'x' }, {});
  assert.equal(led.readings.length, 1); // control: a look inside the scenario is kept
});

test('a pass on one FlexiPage does not replace a fail on another that shares the aim and the path', () => {
  const led = checks.ledger(new Map(), 'a');
  checks.begin(led, 'Two pages');
  const args = (flexiPageApiName) => ({ recordId: '001', lwcApiName: 'card', flexiPageApiName, expect: { path: 'onTop', value: true } });
  led.checks.push(checks.map('sf_on_top', args('Page_A'), null, fail('MEASURE_MISMATCH', { actual: false })));
  led.checks.push(checks.map('sf_on_top', args('Page_B'), { onTop: true }));
  assert.equal(checks.finish(led, 'Two pages', 'PASS').verdict, 'FAIL');
});

test('tolerance is for px: a visible share and a null compare exactly, and the message says so', () => {
  const miss = (out, e) => { try { checks.expectReading(out, e); } catch (err) { return err; } };
  assert.equal(miss({ elements: [{ visible: 0.97 }] }, { path: 'elements.0.visible', value: 1, tolerance: 5 })?.code, 'MEASURE_MISMATCH');
  assert.doesNotMatch(miss({ elements: [{ visible: 0.5 }] }, { path: 'elements.0.visible', value: 1, tolerance: 5 }).message, /tolerance/);
  assert.match(miss({ box: { y: 9 } }, { path: 'box.y', value: 0, tolerance: 5 }).message, /tolerance 5 px/);
  const out = { elements: [{ clippedBy: null }, { clippedBy: { tag: 'div' } }] };
  assert.equal(checks.expectReading(out, { path: 'elements.0.clippedBy', value: null }), out);
  assert.equal(miss(out, { path: 'elements.1.clippedBy', value: null })?.code, 'MEASURE_MISMATCH');
  assert.equal(miss(out, { path: 'elements.5.clippedBy', value: null })?.code, 'MEASURE_MISMATCH'); // a path that is not there is not null
});

test('tolerance widens a px key only: a count compares exactly', () => {
  const out = { count: 2, rendered: 2, inView: 2, viewport: { width: 1470 }, elements: [{ rect: { y: 40 }, overflow: { x: 3 }, textLines: [{ right: 9 }] }] };
  const code = (e) => { try { checks.expectReading(out, e); } catch (err) { return err.code; } };
  assert.deepEqual(['count', 'rendered', 'inView'].map((path) => code({ path, value: 4, tolerance: 2 })), Array(3).fill('MEASURE_MISMATCH'));
  const near = [['elements.0.rect.y', 42], ['viewport.width', 1471], ['elements.0.overflow.x', 4], ['elements.0.textLines.0.right', 10]];
  assert.deepEqual(near.map(([path, value]) => code({ path, value, tolerance: 2 })), Array(4).fill(undefined));
});

test('at reads a dotted path and gives undefined where nothing is', () => {
  assert.equal(checks.at({ a: [{ b: 7 }] }, 'a.0.b'), 7);
  assert.equal(checks.at({ a: null }, 'a.0.b'), undefined);
  assert.deepEqual(checks.LAYOUT, ['sf_measure', 'sf_on_top']);
});
