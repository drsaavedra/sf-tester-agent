'use strict';

// A route with an sf_list step whose action lacks an argument, or has one it does not take, is refused before its
// first step runs (docs/tool-guidelines.md rule 8), through the MCP server with no org.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('sf_run_route refuses a bad sf_list step at plan time, before step 0, no org', async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_ORG: '', SF_TESTER_USER: '' } }));
  t.after(() => client.close());
  const route = async (step) => {
    const r = await client.callTool({ name: 'sf_run_route', arguments: { steps: [{ tool: 'sf_open_list', args: { objectApiName: 'SfUiProbe__c', listView: 'All' } }, { tool: 'sf_list', args: step }] } });
    return JSON.parse(r.content[0].text);
  };
  // The control: a good step plans, so the route runs step 0, which fails with no session.
  assert.equal((await route({ action: 'sort', column: 'Kind' })).code, 'ROUTE_STEP_FAILED');
  for (const step of [{ action: 'sort' }, { action: 'delete', row: 'x', column: 'Kind' }]) {
    const r = await route(step);
    assert.equal(r.code, 'BAD_ARGS', JSON.stringify(r));
    assert.match(r.message, /^BAD_ARGS: step 1 sf_list: /);
  }
});

// D3 edge: a check before sf_login_as is no step after it, so a display or mass step must not stand as the route's check.
test('a route whose only sf_list step is display or mass does not save; one with sort does', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-list-route-'));
  const pre = path.join(dir, 'list-stub.js');
  fs.writeFileSync(pre, `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'list'))}).run = async (s, action, args) => ({ action, ...args });\n`);
  const env = { ...process.env, SF_TESTER_COMBINATIONS: path.join(dir, 'c.json'), SF_TESTER_IMPROVEMENTS: path.join(dir, 'i.jsonl') };
  const client = new Client({ name: 'sf-list-route', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['-r', path.join(__dirname, 'stub-server.js'), '-r', pre, path.join(__dirname, '..', 'src', 'server.js')], env }));
  t.after(() => client.close());
  const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  await call('sf_start', { org: 'stub' });
  const run = async (title, step) => {
    await call('sf_scenario', { plan: [{ title, kind: 'positive' }] });
    await call('sf_scenario', { start: title });
    await call('sf_api', { path: '/number', expect: { path: 'result', equals: 0 } }); // a check, then a login that drops it from the steps
    await call('sf_login_as', { user: '005other' });
    await call('sf_open_tab', { tab: 'SfUi_Vf' });
    await call('sf_list', step);
    return (await call('sf_scenario', { end: title, result: 'PASS' })).route;
  };
  assert.deepEqual(await run('Display only', { action: 'display', display: 'Table' }), { saved: false, reason: 'NO_CHECK' });
  assert.deepEqual(await run('Mass only', { action: 'mass', rows: ['a'], button: 'Change Owner' }), { saved: false, reason: 'NO_CHECK' });
  assert.equal((await run('Sort', { action: 'sort', column: 'Kind' })).saved, true, 'control: a sorted list is a check');
});
