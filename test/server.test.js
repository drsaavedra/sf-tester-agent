'use strict';

// The MCP server end to end over stdio: tools list, one session across calls, coded errors, and the edit, click,
// upload and Login As tools driven as an agent would.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { auth, env, skip } = require('./helpers');

// ISO UTC to the millisecond, as new Date().toISOString() writes it.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ordered = (...times) => times.every((x, i) => ISO.test(x) && (i === 0 || times[i - 1] <= x));

test('server', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  // The improvements log goes to a temporary file, never the real one in the home folder.
  const improvementsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'improvements.jsonl');
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IMPROVEMENTS: improvementsFile } }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  // The server runs its own browser, so the record comes from a plain REST call with the admin token.
  const admin = await auth(env.org);
  const rest = (p, init = {}) => fetch(`${admin.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' } });
  const { id: record } = await (await rest('/sobjects/Account', { method: 'POST', body: JSON.stringify({ Name: `sf-ui server ${Date.now()}` }) })).json();
  t.after(() => rest(`/sobjects/Account/${record}`, { method: 'DELETE' }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };

  await t.test('lists the tools', async () => {
    const { tools } = await client.listTools();
    for (const n of ['sf_start', 'sf_open_record', 'sf_edit_record', 'sf_save', 'sf_modal', 'sf_apex', 'sf_upload_file', 'sf_click', 'sf_fill', 'sf_press', 'sf_wait', 'sf_toasts', 'sf_edit_inline', 'sf_page_errors', 'sf_open_list', 'sf_open_related_list', 'sf_search', 'sf_create_record', 'sf_actions', 'sf_launch_action', 'sf_improvements', 'sf_record_improvement', 'sf_fix_improvement', 'sf_on_top', 'sf_measure', 'sf_viewport', 'sf_hover', 'sf_watch', 'sf_open_tab', 'sf_run_route', 'sf_combinations']) assert.ok(tools.find((x) => x.name === n), n);
  });

  await t.test('sf_record_improvement and sf_improvements work without a session', async () => {
    const r = await call('sf_record_improvement', { area: 'navigation', kind: 'missing', what: 'No tool opens an app from the App Launcher' });
    assert.equal(r.isError, false, JSON.stringify(r.body));
    assert.equal((await call('sf_improvements', { area: 'navigation' })).body.improvements[0].what, 'No tool opens an app from the App Launcher');
    assert.equal((await call('sf_fix_improvement', { area: 'navigation', what: 'No tool opens an app from the App Launcher', fixedBy: 'abc1234' })).isError, false);
    assert.deepEqual((await call('sf_improvements', { area: 'navigation' })).body.improvements, []);
    assert.equal((await call('sf_improvements', { area: 'navigation', all: true })).body.improvements[0].fixed.by, 'abc1234');
    // An unknown kind is refused by the tool schema before the library sees it.
    assert.equal((await client.callTool({ name: 'sf_record_improvement', arguments: { area: 'x', kind: 'wish', what: 'x' } })).isError, true);
  });

  await t.test('a tool before sf_start is a NO_SESSION tool error', async () => {
    const r = await call('sf_whoami');
    assert.equal(r.isError, true);
    assert.equal(r.body.code, 'NO_SESSION');
  });

  await t.test('one session carries across calls', async () => {
    const started = await call('sf_start', { org: env.org });
    assert.equal(started.isError, false, JSON.stringify(started.body));
    // Both clocks run on NTP, so the org's Date header lands within a couple of seconds of this machine's.
    assert.ok(Number.isInteger(started.body.serverSkewMs) && Math.abs(started.body.serverSkewMs) < 3000, JSON.stringify(started.body));
    assert.equal((await call('sf_whoami')).body.userId, started.body.userId);
    const opened = await call('sf_open_record', { recordId: record });
    assert.equal(opened.body.objectApiName, 'Account');
    const name = (await call('sf_api', { path: `/ui-api/records/${record}?fields=Account.Name` })).body.fields.Name.value;
    assert.match((await call('sf_page_snapshot')).body.snapshot, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the record name is in the snapshot');
    assert.doesNotMatch((await call('sf_page_snapshot')).body.snapshot, /App Launcher/, 'the app shell header is left out');
  });

  // A raw Playwright timeout's LOCATOR_TIMEOUT code is checked with no org in sessions.test.js, through the stub.
  await t.test('sf_modal with no dialog open answers open false within its short wait', async () => {
    const start = Date.now();
    const r = await call('sf_modal', { action: 'snapshot', timeoutMs: 1_000 });
    assert.equal(r.isError, false, JSON.stringify(r.body));
    assert.deepEqual({ open: r.body.open }, { open: false });
    assert.ok(Date.now() - start < 10_000, `${Date.now() - start} ms`);
  });

  await t.test('a coded library error comes back as a tool error with its code', async () => {
    const r = await call('sf_open_record', { recordId: record.slice(0, 12) + 'ZZZAA0', objectApiName: 'Account' });
    assert.equal(r.isError, true);
    assert.equal(r.body.code, 'RECORD_UNAVAILABLE');
  });

  await t.test('sf_edit_record, sf_set_fields and sf_save store a value', async () => {
    assert.equal((await call('sf_edit_record', { recordId: record })).isError, false);
    const phone = `+1 555 ${String(Date.now()).slice(-7)}`;
    assert.equal((await call('sf_set_fields', { values: { Phone: phone } })).isError, false);
    assert.equal((await call('sf_save')).body.outcome, 'saved');
    assert.equal((await call('sf_api', { path: `/ui-api/records/${record}?fields=Account.Phone` })).body.fields.Phone.value, phone);
  });

  // The scenario's end returns what sf_assert_field compared, so a pass can be read without the screen.
  await t.test('sf_scenario end returns the checks sf_assert_field made, a mismatch included', async () => {
    const phone = (await call('sf_api', { path: `/ui-api/records/${record}?fields=Account.Phone` })).body.fields.Phone.value;
    await call('sf_scenario', { start: 'Phone is stored' });
    assert.equal((await call('sf_assert_field', { recordId: record, field: 'Phone', expected: phone, via: 'api' })).isError, false);
    const good = (await call('sf_scenario', { end: 'Phone is stored', result: 'PASS', start: 'A wrong Phone is refused' })).body;
    assert.equal(good.checks.length, 1, JSON.stringify(good));
    assert.deepEqual([good.checks[0].oracle, good.checks[0].pass, good.checks[0].expected, good.checks[0].actual.api], ['api', true, phone, phone]);
    assert.equal(good.weak, undefined);
    assert.equal((await call('sf_assert_field', { recordId: record, field: 'Phone', expected: 'not that phone', via: 'api' })).body.code, 'FIELD_VALUE_MISMATCH');
    const bad = (await call('sf_scenario', { end: 'A wrong Phone is refused', result: 'PASS' })).body;
    assert.equal(bad.checks.length, 1, 'the first scenario\'s check is not carried over');
    assert.deepEqual([bad.checks[0].pass, bad.checks[0].actual.api], [false, phone]);
    // A check inside a route lands once: the step settles it and the route call itself records nothing.
    await call('sf_scenario', { start: 'A route checks Phone' });
    const route = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: `/ui-api/records/${record}?fields=Account.Phone`, expect: { path: 'fields.Phone.value', equals: phone } } }] });
    assert.equal(route.isError, false, JSON.stringify(route.body));
    assert.equal((await call('sf_scenario', { end: 'A route checks Phone', result: 'PASS' })).body.checks.length, 1);
    // A route step that fails still leaves its check, with pass false: the route's own error is not a check.
    await call('sf_scenario', { start: 'A route step fails' });
    const failed = await call('sf_run_route', { steps: [{ tool: 'sf_assert_field', args: { recordId: record, field: 'Phone', expected: 'not that phone', via: 'api' } }] });
    assert.equal(failed.body.code, 'ROUTE_STEP_FAILED', JSON.stringify(failed.body));
    const ended = (await call('sf_scenario', { end: 'A route step fails', result: 'FAIL', reason: 'probe' })).body;
    assert.deepEqual(ended.checks.map((c) => [c.tool, c.pass, c.actual.api]), [['sf_assert_field', false, phone]], JSON.stringify(ended));
  });

  await t.test('sf_click opens a form and closes it inside the modal', async () => {
    await call('sf_open_record', { recordId: record });
    const name = (await call('sf_api', { path: `/ui-api/records/${record}?fields=Account.Name` })).body.fields.Name.value;
    const click = await call('sf_click', { name: 'Edit' });
    assert.ok(ordered(click.body.at.start, click.body.at.clicked, click.body.at.end), JSON.stringify(click.body));
    const wait = await call('sf_wait', { text: `Edit ${name}` });
    assert.equal(wait.isError, false, 'the Edit dialog opened');
    assert.ok(ordered(wait.body.at.start, wait.body.at.seen, wait.body.at.end), JSON.stringify(wait.body));
    assert.equal((await call('sf_click', { name: 'Cancel', inModal: true })).isError, false);
    assert.equal((await call('sf_wait', { text: `Edit ${name}`, gone: true, timeoutMs: 10_000 })).isError, false);
    assert.doesNotMatch((await call('sf_page_snapshot')).body.snapshot, /dialog "Edit/);
  });

  // F-cascade-31: a recordId with no lwcApiName was dropped, so the tool acted on whichever record was open.
  await t.test('a recordId with no lwcApiName opens that record before acting, not the one showing', async () => {
    const other = `BREAK fix server other ${Date.now()}`;
    const { id } = await (await rest('/sobjects/Account', { method: 'POST', body: JSON.stringify({ Name: other }) })).json();
    t.after(() => rest(`/sobjects/Account/${id}`, { method: 'DELETE' }));
    await call('sf_open_record', { recordId: record });
    const wait = await call('sf_wait', { recordId: id, text: other, timeoutMs: 20_000 });
    assert.equal(wait.isError, false, JSON.stringify(wait.body));
    assert.match((await call('sf_page_snapshot')).body.snapshot, new RegExp(other), 'the named record is the page');
    // '.' matches any record URL in showsRecord, so with no id check it would skip the open and act on this page.
    assert.equal((await call('sf_wait', { recordId: '.', text: other, timeoutMs: 0 })).body.code, 'BAD_ARGS');
  });

  await t.test('sf_upload_file and sf_wait reach a component on a record page', async () => {
    const { id: probe } = await (await rest('/sobjects/SfUiProbe__c', { method: 'POST', body: JSON.stringify({ Name: `sf-ui server probe ${Date.now()}`, Tags__c: 'Alpha' }) })).json();
    t.after(() => rest(`/sobjects/SfUiProbe__c/${probe}`, { method: 'DELETE' }));
    const title = `sf-ui-server-${Date.now()}`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), `${title}.png`);
    fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    t.after(async () => {
      const q = `SELECT ContentDocumentId FROM ContentVersion WHERE Title = '${title}'`;
      for (const v of (await (await rest(`/query?q=${encodeURIComponent(q)}`)).json()).records) await rest(`/sobjects/ContentDocument/${v.ContentDocumentId}`, { method: 'DELETE' });
    });
    const up = await call('sf_upload_file', { paths: [file], recordId: probe, lwcApiName: 'sfUiProbe' });
    assert.equal(up.body.dialog, true, JSON.stringify(up.body));
    assert.ok(ordered(up.body.at.start, up.body.at.fileSet, up.body.at.done, up.body.at.end), JSON.stringify(up.body));
    assert.equal((await call('sf_wait', { text: `Uploaded ${title}.png`, recordId: probe, lwcApiName: 'sfUiProbe' })).isError, false);
  });

  const newProbe = async () => {
    const { id } = await (await rest('/sobjects/SfUiProbe__c', { method: 'POST', body: JSON.stringify({ Name: `sf-ui server probe ${Date.now()}`, Tags__c: 'Alpha' }) })).json();
    t.after(() => rest(`/sobjects/SfUiProbe__c/${id}`, { method: 'DELETE' }));
    return id;
  };

  await t.test('sf_lwc_read reaches a component another one renders, and foundBy says so', async () => {
    const read = await call('sf_lwc_read', { recordId: await newProbe(), lwcApiName: 'sfUiProbeHelp' });
    assert.deepEqual([read.body.foundBy.via, read.body.foundBy.inside[0]], ['shadowRoots', 'c-sf-ui-probe'], JSON.stringify(read.body));
  });

  await t.test('sf_on_top aims by text at an icon with no role', async () => {
    const help = { recordId: await newProbe(), lwcApiName: 'sfUiProbeHelp' };
    const top = await call('sf_on_top', { ...help, text: 'Info' });
    assert.deepEqual([top.isError, top.body.onTop, top.body.box.width], [false, true, 16], JSON.stringify(top.body));
    assert.notEqual(top.body.box.x, (await call('sf_on_top', { ...help, name: 'Help' })).body.box.x, 'the icon, not the helptext button beside it');
  });

  await t.test('sf_click presses one of two unnamed buttons in a row by its column', async () => {
    const at = { recordId: await newProbe(), lwcApiName: 'sfUiProbe' };
    const click = await call('sf_click', { ...at, name: '', row: 'row two', column: 'Edit' });
    assert.deepEqual([click.isError, click.body.foundBy.via], [false, 'flexiPage'], JSON.stringify(click.body));
    assert.equal((await call('sf_wait', { ...at, text: 'Edited row two' })).isError, false);
  });

  // Ping raises Lightning's real toast; any takes the place of text, which the schema must allow.
  await t.test('sf_wait with any matches a toast in a component scope and returns it', async () => {
    const at = { recordId: await newProbe(), lwcApiName: 'sfUiProbe' };
    assert.equal((await call('sf_click', { ...at, name: 'Ping' })).isError, false);
    const wait = await call('sf_wait', { ...at, any: [{ text: 'text that never renders' }, { toast: 'pong' }], timeoutMs: 15_000 });
    assert.deepEqual([wait.isError, wait.body.matched, wait.body.toasts.map((x) => x.title)], [false, { index: 1, toast: 'pong' }, ['Ping']], JSON.stringify(wait.body));
    assert.ok(ordered(wait.body.at.start, wait.body.at.seen, wait.body.at.end), JSON.stringify(wait.body));
    assert.equal((await call('sf_wait', { ...at, text: 'x', any: [{ text: 'y' }] })).body.code, 'BAD_ARGS');
  });

  // sf_open_record starts a new toast window (d583a36): a toast from before it is not reported, one after it is.
  await t.test('sf_wait after sf_open_record matches a toast raised after the open, not one from before it', async () => {
    const at = { recordId: await newProbe(), lwcApiName: 'sfUiProbe' };
    await call('sf_click', { ...at, name: 'Ping' });
    assert.deepEqual((await call('sf_toasts')).body.toasts.map((x) => x.title), ['Ping'], 'the control: Ping toasted before the open');
    await call('sf_open_record', { recordId: at.recordId });
    const before = await call('sf_wait', { ...at, any: [{ toast: 'pong' }], timeoutMs: 3_000 });
    assert.deepEqual([before.body.code, before.body.evidence?.toasts], ['TIMEOUT', []], JSON.stringify(before.body));
    assert.equal((await call('sf_click', { ...at, name: 'Ping' })).isError, false);
    const wait = await call('sf_wait', { ...at, any: [{ toast: 'pong' }], timeoutMs: 15_000 });
    assert.deepEqual([wait.isError, wait.body.matched], [false, { index: 0, toast: 'pong' }], JSON.stringify(wait.body));
  });

  // A route is several tools in one call: it opens and reads the inline dialog, and stops at the first failing step.
  await t.test('sf_run_route runs steps in order in one call and stops at the first error', async () => {
    const at = { recordId: await newProbe(), lwcApiName: 'sfUiProbe' };
    const open = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { ...at, name: 'Open inline dialog' } }, { tool: 'sf_wait', args: { ...at, text: 'Close inline dialog', timeoutMs: 10_000 } }] });
    assert.deepEqual([open.isError, open.body.steps.map((x) => x.tool), open.body.foundBy?.via], [false, ['sf_click', 'sf_wait'], 'flexiPage'], JSON.stringify(open.body));
    assert.ok(ordered(open.body.at.start, open.body.steps[0].at.clicked, open.body.steps[1].at.seen, open.body.at.end), JSON.stringify(open.body));
    const stop = await call('sf_run_route', { steps: [{ tool: 'sf_wait', args: { ...at, text: 'text that never renders', timeoutMs: 0 } }, { tool: 'sf_click', args: { ...at, name: 'Close inline dialog' } }] });
    assert.deepEqual([stop.isError, stop.body.code, stop.body.evidence.failedAt, stop.body.evidence.code], [true, 'ROUTE_STEP_FAILED', 0, 'TIMEOUT'], JSON.stringify(stop.body));
    assert.equal((await call('sf_wait', { ...at, text: 'Close inline dialog', timeoutMs: 0 })).isError, false, 'the step after the failure never ran, so the dialog is still open');
    // Every step is checked before any runs: a misspelt argument or a session tool refuses the whole route.
    assert.equal((await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { ...at, name: 'Close inline dialog' } }, { tool: 'sf_click', args: { nmae: 'x' } }] })).body.code, 'BAD_ARGS');
    assert.equal((await call('sf_run_route', { steps: [{ tool: 'sf_end' }] })).body.code, 'BAD_ARGS');
    assert.equal((await call('sf_wait', { ...at, text: 'Close inline dialog', timeoutMs: 0 })).isError, false, 'the refused route ran nothing');
  });

  await t.test('sf_open_list reports the URL of the list it opened', async () => {
    await call('sf_open_record', { recordId: record });
    const r = await call('sf_open_list', { objectApiName: 'SfUiProbe__c', listView: 'All' });
    assert.match(r.body.url, /\/lightning\/o\/SfUiProbe__c\/list/);
  });

  // Last: Login As changes the session for good.
  await t.test('sf_login_as takes a username and the session then runs as that user', async () => {
    const persona = await auth(env.user);
    const me = await (await fetch(`${persona.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${persona.accessToken}` } })).json();
    const r = await call('sf_login_as', { user: me.preferred_username });
    assert.equal(r.isError, false, JSON.stringify(r.body));
    assert.equal((await call('sf_whoami')).body.userId.slice(0, 15), me.user_id.slice(0, 15));
  });

  // The server's wait outlives the cancel and times out later, when the next scenario may be open.
  await t.test('a call the client cancelled records no check', async () => {
    await call('sf_scenario', { start: 'Cancelled wait' });
    const ac = new AbortController();
    const pending = client.callTool({ name: 'sf_wait', arguments: { text: 'no such text anywhere', timeoutMs: 3_000 } }, undefined, { signal: ac.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 500));
    ac.abort();
    await pending;
    await new Promise((r) => setTimeout(r, 6_000));
    assert.deepEqual((await call('sf_scenario', { end: 'Cancelled wait', result: 'FAIL', reason: 'probe' })).body.checks, []);
  });

  // Returning from a persona is sf_start on the same id; one that fails must not cost the open scenario its checks.
  await t.test('a failed sf_start on the same id keeps the open scenario and its checks', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: 'Survives a failed restart', session: id });
    await call('sf_api', { session: id, path: `/ui-api/records/${record}?fields=Account.Name`, expect: { path: 'fields.Name.value', equals: 'no such name' } });
    const restart = await call('sf_start', { org: env.org, session: id, app: 'NoSuchApp' });
    assert.equal(restart.body.code, 'APP_UNAVAILABLE', JSON.stringify(restart.body));
    const end = (await call('sf_scenario', { end: 'Survives a failed restart', result: 'FAIL', reason: 'probe', session: id })).body;
    assert.deepEqual(end.checks.map((c) => c.pass), [false], JSON.stringify(end));
    // The end on a browser-less id leaves the ledger: the id can still start again, as the agent doc says.
    assert.equal((await call('sf_start', { org: env.org, session: id })).isError, false);
    await call('sf_end', { session: id });
  });

  // A started session has a ledger from the start, so a check made before any scenario is kept for the next end.
  await t.test('a check made with no scenario open is returned by the next end', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_api', { session: id, path: `/ui-api/records/${record}?fields=Account.Name`, expect: { path: 'fields.Name.value', equals: 'no such name' } });
    const end = (await call('sf_scenario', { end: 'Made before a start', result: 'FAIL', reason: 'probe', session: id })).body;
    assert.deepEqual(end.checks.map((c) => c.pass), [false], JSON.stringify(end));
    await call('sf_end', { session: id });
  });

  // The browser is gone and the ledger is not, so sf_end still knows the id and drops the ledger with its scenario.
  await t.test('sf_end on an id whose browser closed while a scenario was open drops the ledger', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: 'Open at a failed restart', session: id });
    assert.equal((await call('sf_start', { org: env.org, session: id, app: 'NoSuchApp' })).body.code, 'APP_UNAVAILABLE');
    assert.equal((await call('sf_end', { session: id })).isError, false);
    assert.equal((await call('sf_scenario', { end: 'Open at a failed restart', result: 'FAIL', reason: 'probe', session: id })).body.code, 'NO_SESSION');
  });

  // The retry that follows a failed persona return must reach the id: its browser is gone, its ledger is not.
  await t.test('sf_start on the same id after a failed restart succeeds and the scenario goes on', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: 'Survives a retried restart', session: id });
    await call('sf_api', { session: id, path: `/ui-api/records/${record}?fields=Account.Name`, expect: { path: 'fields.Name.value', equals: 'no such name' } });
    assert.equal((await call('sf_start', { org: env.org, session: id, app: 'NoSuchApp' })).body.code, 'APP_UNAVAILABLE');
    const retry = await call('sf_start', { org: env.org, session: id });
    assert.equal(retry.isError, false, JSON.stringify(retry.body));
    const end = (await call('sf_scenario', { end: 'Survives a retried restart', result: 'FAIL', reason: 'probe', session: id })).body;
    assert.deepEqual(end.checks.map((c) => c.pass), [false], JSON.stringify(end));
    await call('sf_end', { session: id }); // the cap counts every open session
  });

  // Returning from a persona is sf_start on the same id: the one that works must keep the open scenario's checks.
  await t.test('a successful sf_start on the same id keeps the open scenario and its checks', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: 'Survives a restart', session: id });
    await call('sf_api', { session: id, path: `/ui-api/records/${record}?fields=Account.Name`, expect: { path: 'fields.Name.value', equals: 'no such name' } });
    assert.equal((await call('sf_start', { org: env.org, session: id })).isError, false);
    const end = (await call('sf_scenario', { end: 'Survives a restart', result: 'FAIL', reason: 'probe', session: id })).body;
    assert.deepEqual(end.checks.map((c) => c.pass), [false], JSON.stringify(end));
    await call('sf_end', { session: id }); // the cap counts every open session
  });

  // sf_end drops the session's ledger with its scenario, so that scenario can no longer be ended.
  await t.test('after sf_end the session id is NO_SESSION for sf_scenario', async () => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: 'Ended with the session', session: id });
    assert.equal((await call('sf_end', { session: id })).isError, false);
    const r = await call('sf_scenario', { end: 'Ended with the session', result: 'FAIL', reason: 'probe', session: id });
    assert.deepEqual([r.isError, r.body.code], [true, 'NO_SESSION']);
  });
});

// A session the cap evicts frees its ledger, unless a scenario is open on it.
test('server, cap eviction frees an idle session\'s ledger and keeps an open scenario\'s', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_MAX_SESSIONS: '2', SF_TESTER_CAP_IDLE_MS: '1' } }));
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  // A pause between steps keeps `used` strictly ordered, so which session the cap evicts never depends on a clock tie.
  const pause = () => new Promise((r) => setTimeout(r, 25));
  const s1 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  await pause();
  const s2 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  await pause();
  await call('sf_scenario', { start: 'Kept open', session: s2 });
  await call('sf_api', { session: s2, path: '/ui-api/object-info/Account', expect: { path: 'apiName', equals: 'nope' } });
  await pause();
  // The third start evicts s1 (idle longest, nothing open), the fourth s2 (a scenario is open).
  const s3 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  const gone = await call('sf_scenario', { end: 'x', result: 'PASS', session: s1 });
  assert.deepEqual([gone.isError, gone.body.code], [true, 'NO_SESSION'], 'the idle ledger is freed with its session');
  await pause();
  const s4 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  const kept = (await call('sf_scenario', { end: 'Kept open', result: 'FAIL', reason: 'probe', session: s2 })).body;
  assert.deepEqual(kept.checks.map((c) => c.pass), [false], JSON.stringify(kept));
  // Every session this test opened is ended; s1 and s2 are already gone, which sf_end answers as NO_SESSION.
  for (const id of [s3, s4]) assert.equal((await call('sf_end', { session: id })).isError, false);
});

// The idle sweep that runs at the next sf_start frees the ledger of a session nobody ended.
test('server, cap eviction: the idle sweep frees a ledger too', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IDLE_MS: '1' } }));
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  const s1 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  const s2 = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  const gone = await call('sf_scenario', { end: 'x', result: 'PASS', session: s1 });
  assert.deepEqual([gone.isError, gone.body.code], [true, 'NO_SESSION']);
  await call('sf_end', { session: s2 });
});

// The idle window counts from the close, not from the tester's last call: a ledger kept for its open scenario survives
// the sweep that runs in the same sf_start, and goes only after a window with no browser.
test('server, cap eviction: an idle close keeps an open scenario\'s ledger for the window', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IDLE_MS: '2000' } }));
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const probe = (id) => call('sf_api', { session: id, path: '/ui-api/object-info/Account', expect: { path: 'apiName', equals: 'nope' } });
  const ended = async (id, title) => (await call('sf_scenario', { end: title, result: 'FAIL', reason: 'probe', session: id })).body;
  const started = async (title) => {
    const id = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
    await call('sf_scenario', { start: title, session: id });
    await probe(id);
    return id;
  };

  // Idle past the window with a scenario open: another session's sf_start closes it, and the same id starts again.
  const idle = await started('Idle with a scenario');
  await wait(2_500);
  const other = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  assert.equal((await call('sf_start', { org: env.org, session: idle })).isError, false, 'the ledger outlived the idle close');
  assert.deepEqual((await ended(idle, 'Idle with a scenario')).checks.map((c) => c.pass), [false]);
  await call('sf_end', { session: idle });

  // A restart of a live session after the window: its browser is gone between the close and the launch.
  const live = await started('Restarted after the window');
  await wait(2_500);
  assert.equal((await call('sf_start', { org: env.org, session: live })).isError, false);
  assert.deepEqual((await ended(live, 'Restarted after the window')).checks.map((c) => c.pass), [false]);
  await call('sf_end', { session: live });

  // A failed restart stamps the close too: another tester's sweep right after it leaves the ledger for the retry.
  const failed = await started('Failed restart');
  await wait(2_500);
  assert.equal((await call('sf_start', { org: env.org, session: failed, app: 'NoSuchApp' })).body.code, 'APP_UNAVAILABLE');
  const next = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  assert.equal((await call('sf_start', { org: env.org, session: failed })).isError, false);
  assert.deepEqual((await ended(failed, 'Failed restart')).checks.map((c) => c.pass), [false]);
  await call('sf_end', { session: failed });

  // A tester that crashed mid-scenario: no browser, a scenario open, untouched for the whole window.
  const lost = await started('Abandoned');
  assert.equal((await call('sf_start', { org: env.org, session: lost, app: 'NoSuchApp' })).body.code, 'APP_UNAVAILABLE');
  await wait(2_500);
  const last = (await call('sf_start', { org: env.org, session: 'new' })).body.session;
  const swept = await call('sf_scenario', { end: 'Abandoned', result: 'FAIL', reason: 'probe', session: lost });
  assert.deepEqual([swept.isError, swept.body.code], [true, 'NO_SESSION'], 'the sweep freed the abandoned ledger');
  for (const id of [other, next, last]) await call('sf_end', { session: id });
});

// Org: sf_fill on an open edit form puts its field in the form's set, so a left save checks it. A spy preloaded into
// the server logs each form.filled call; no left save is needed to see the server make it.
test('server, sf_fill on an open edit form joins the save value check', { skip, timeout: 300_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-'));
  const [spy, log] = [path.join(dir, 'spy.js'), path.join(dir, 'filled.jsonl')];
  fs.writeFileSync(spy, `const form = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'form.js'))}); const real = form.filled;
form.filled = (f, ...a) => { real(f, ...a); require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ label: a[0], set: Object.keys(f.set || {}) }) + '\\n'); };`);
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--require', spy, path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IMPROVEMENTS: path.join(dir, 'improvements.jsonl') } }));
  const admin = await auth(env.org);
  const rest = (p, init = {}) => fetch(`${admin.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' } });
  const { id: record } = await (await rest('/sobjects/Account', { method: 'POST', body: JSON.stringify({ Name: `sf-ui fill ${Date.now()}` }) })).json();
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); await rest(`/sobjects/Account/${record}`, { method: 'DELETE' }); });
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, body: JSON.parse(r.content[0].text) }; };
  assert.equal((await call('sf_start', { org: env.org })).isError, false);
  assert.equal((await call('sf_edit_record', { recordId: record })).isError, false);
  const fill = await call('sf_fill', { name: 'Phone', value: '555-0100', inModal: true });
  assert.equal(fill.isError, false, JSON.stringify(fill.body));
  assert.deepEqual(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [], [{ label: 'Phone', set: ['Phone'] }]);
  assert.equal((await call('sf_cancel')).isError, false);
});

// No org: the wrapper alone stamps a result and a coded error with when the call ran.
test('every result and coded error says when the call started and ended', { timeout: 30_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  const improvementsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'improvements.jsonl');
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IMPROVEMENTS: improvementsFile } }));
  t.after(() => client.close());
  const before = new Date().toISOString();
  const ok = await client.callTool({ name: 'sf_improvements', arguments: {} });
  const failed = await client.callTool({ name: 'sf_whoami', arguments: {} });
  const after = new Date().toISOString();
  const [okAt, failedAt] = [ok, failed].map((r) => JSON.parse(r.content[0].text).at);
  assert.equal(failed.isError, true);
  assert.ok(ordered(before, okAt?.start, okAt?.end, failedAt?.start, failedAt?.end, after), JSON.stringify({ before, okAt, failedAt, after }));
});

// No org: the server exits 128 plus the signal number on a signal, and 0 when its client closes stdin.
test('the server exit code names the signal that stopped it', { timeout: 30_000 }, async (t) => {
  // SIGINT under a client is the client's to act on: the test below.
  for (const [stop, code] of [['SIGTERM', 143], ['SIGHUP', 129], ['stdin', 0]]) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] });
    await new Client({ name: 'sf-ui-test', version: '0' }).connect(transport); // its handlers are installed once it answers
    const child = transport._process;
    // A server that ignores the signal must fail the test, not hang it or outlive it.
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const exited = new Promise((resolve) => child.once('exit', (c, sig) => resolve([c, sig])));
    if (stop === 'stdin') child.stdin.end(); else child.kill(stop);
    assert.deepEqual(await exited, [code, null], stop);
  }
});

// No org, fixed inputs: a Date header 10 s ahead of the request midpoint is +10 s, plus 500 ms for the header's dropped
// milliseconds; any other formula (no +500, sign, sent or got alone) gives another number. No header gives undefined.
test('the skew is the server clock minus this one', () => {
  const { skewFrom } = require('../src/session');
  const T = Date.parse('2026-01-01T00:00:10.000Z');
  assert.equal(skewFrom({ headers: new Headers({ date: new Date(T).toUTCString() }) }, T - 10_200, T - 9_800), 10_500);
  assert.equal(skewFrom({ headers: new Headers() }, 0, 0), undefined);
});

// No org: a Ctrl-C reaches the replay's server child too; under a client it keeps running the route in work, and ends
// when the client closes its stdin. SIGTERM still ends it at once (the control).
test('the server under a client outlives a SIGINT and ends when its stdin closes', { timeout: 30_000 }, async () => {
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const start = () => spawn(process.execPath, [require('node:path').join(__dirname, '..', 'src', 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const child = start();
  await new Promise((r) => setTimeout(r, 1_500)); // its handlers are set once it has loaded
  child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 1_000));
  assert.equal(child.exitCode, null, 'still running after SIGINT');
  child.stdin.end();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  const other = start();
  await new Promise((r) => setTimeout(r, 1_500));
  other.kill('SIGTERM');
  assert.equal((await once(other, 'exit'))[0], 143);
});

