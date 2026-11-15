'use strict';

// sf_scenario marks the scenarios a tester runs a requirement with; it needs no org, so this suite runs anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('sf_scenario takes a plan, a start and an end with its result, and refuses a mark that says nothing', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-scenario', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const call = async (args) => {
    const r = await client.callTool({ name: 'sf_scenario', arguments: args });
    return { isError: r.isError, body: JSON.parse(r.content[0].text) };
  };

  const plan = [{ title: 'A complete case saves', kind: 'positive' }, { title: 'No Subject is refused', kind: 'negative' }];
  const first = await call({ plan, start: plan[0].title });
  assert.equal(first.isError, undefined, JSON.stringify(first.body));
  assert.deepEqual(first.body.plan, plan);
  assert.equal(first.body.start, 'A complete case saves');

  const next = await call({ end: plan[0].title, result: 'PASS', start: plan[1].title });
  assert.equal(next.isError, undefined, JSON.stringify(next.body));
  // No check ran, so the PASS is weak: no control that could have come out red.
  assert.deepEqual(next.body.checks, []);
  assert.equal(next.body.weak, true);
  const last = await call({ end: plan[1].title, result: 'FAIL', reason: 'the case saved with no Subject' });
  assert.equal(last.body.reason, 'the case saved with no Subject');
  assert.deepEqual(last.body.checks, []);
  assert.equal('weak' in last.body, false, 'a FAIL is not weak');

  // Each scenario under its requirement with its source, technique and persona.
  const tagged = { title: 'Reason_Required blocks a blank Reason', kind: 'negative', requirement: 'Close a Case', source: 'org rule', technique: 'invalid partition', persona: 'sales-rep' };
  const marked = await call({ plan: [tagged] });
  assert.equal(marked.isError, undefined, JSON.stringify(marked.body));
  assert.deepEqual(marked.body.plan[0], tagged);
  // A check ends PASS or FAIL: the schema refuses OBSERVED.
  const observed = await client.callTool({ name: 'sf_scenario', arguments: { end: tagged.title, result: 'OBSERVED' } });
  assert.equal(observed.isError, true, 'OBSERVED is not a result');

  // One call with the same start and end does both, so a scenario FAILed without trying is not a BAD_ARGS.
  const untried = await call({ start: 'Untried', end: 'Untried', result: 'FAIL', reason: 'the step it needs failed' });
  assert.equal(untried.isError, undefined, JSON.stringify(untried.body));
  assert.deepEqual(untried.body.checks, []);
  assert.equal('weak' in untried.body, false);
  assert.equal((await call({ start: 'Next one' })).isError, undefined, 'the scenario is closed again');
  assert.equal((await call({ end: 'Next one', result: 'FAIL', reason: 'probe' })).isError, undefined);

  // A plan with two scenarios of one title is refused: records are kept per scenario, and a title names one.
  const twin = await call({ plan: [{ title: 'Same', kind: 'positive' }, { title: 'Same', kind: 'negative' }] });
  assert.deepEqual([twin.isError, twin.body.code], [true, 'BAD_ARGS']);
  assert.match(twin.body.message, /"Same"/);

  // One scenario is open at a time, on the default session too: a second title is refused, a retried start is not.
  assert.equal((await call({ start: 'Open one' })).isError, undefined);
  assert.equal((await call({ start: 'Open one' })).isError, undefined);
  const other = await call({ start: 'Open two' });
  assert.deepEqual([other.isError, other.body.code], [true, 'BAD_ARGS']);
  assert.match(other.body.message, /"Open one"/);
  assert.equal((await call({ end: 'Open one', result: 'PASS' })).isError, undefined);

  // A session id nothing started is NO_SESSION, as on every other tool; with no id the mark needs none.
  const gone = await call({ start: 'x', session: 's9' });
  assert.deepEqual([gone.isError, gone.body.code], [true, 'NO_SESSION']);

  for (const bad of [{}, { end: 'x' }, { result: 'PASS', start: 'x' }, { questions: [{ text: 'Which app?' }] }, { planned: true }]) {
    const r = await call(bad);
    assert.equal(r.isError, true, JSON.stringify(bad));
    assert.equal(r.body.code, 'BAD_ARGS', JSON.stringify(r.body));
  }
});

// No org: stub-server.js makes sf_verify_live fail, so sf_verify_live records a failed STALE_BUILD check.
test('a plan\'s kind reaches end: a positive scenario with a failed check is FAIL over a PASS', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-scenario-verdict', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['-r', path.join(__dirname, 'stub-server.js'), path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError, body: JSON.parse(r.content[0].text) };
  };
  await call('sf_start', { org: 'stub' });
  await call('sf_scenario', { plan: [{ title: 'P', kind: 'positive' }, { title: 'N', kind: 'negative' }] });
  for (const [title, verdict] of [['P', 'FAIL'], ['N', 'PASS']]) {
    await call('sf_scenario', { start: title });
    const w = await call('sf_verify_live', { recordId: 'a', lwcApiName: 'c', marker: 'm' });
    assert.equal(w.body.code, 'STALE_BUILD', JSON.stringify(w.body));
    const end = await call('sf_scenario', { end: title, result: 'PASS' });
    assert.deepEqual([end.body.verdict, end.body.checks.length, 'overruled' in end.body], [verdict, 1, verdict === 'FAIL'], JSON.stringify(end.body));
  }
});
