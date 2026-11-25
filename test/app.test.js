'use strict';

// sf_start's app on the fixture org (SfUi_App, SfUi_Console), over stdio as an agent calls it. No Login As, so it
// leaves other sessions alone; app-login-as.test.js has the persona half.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { auth, env, skip, stamp, localPage } = require('./helpers');
const { session } = require('..');

const connect = async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  return async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
};

test('app', { skip, timeout: 300_000 }, async (t) => {
  const call = await connect(t);
  // The user's last-used app, which only the App Launcher saves; the control for a start with no app.
  const admin = await auth(env.org);
  const lastUsed = (await (await fetch(`${admin.instanceUrl}/services/data/v60.0/ui-api/apps/selected?formFactor=Large`, { headers: { Authorization: `Bearer ${admin.accessToken}` } })).json()).developerName;

  await t.test('with no app the page is in the user\'s last-used app', async () => {
    const { body } = await call('sf_start', { org: env.org });
    assert.equal(body.app.developerName, lastUsed, JSON.stringify(body));
  });

  // At least one of the two is not the last-used app, so a start that ignored app fails it.
  for (const [asked, want, console] of [['sf ui console', 'SfUi_Console', true], ['SFUI_APP', 'SfUi_App', false]]) {
    await t.test(`app ${asked} opens ${want}, sf_whoami reports it, and a later page load stays in it`, async () => {
      const { body } = await call('sf_start', { org: env.org, app: asked });
      assert.equal(body.app?.developerName, want, JSON.stringify(body));
      const me = (await call('sf_whoami')).body;
      assert.equal(me.app.developerName, want, JSON.stringify(me));
      assert.deepEqual(me.apps.filter((a) => /^SfUi_/.test(a.developerName)), [{ label: 'SF UI App', developerName: 'SfUi_App', console: false }, { label: 'SF UI Console', developerName: 'SfUi_Console', console: true }], JSON.stringify(me.apps));
      assert.equal(me.apps.find((a) => a.developerName === want).console, console);
      const list = await call('sf_open_list', { objectApiName: 'SfUiProbe__c' });
      assert.equal(list.isError, false, JSON.stringify(list.body));
      assert.equal((await call('sf_whoami')).body.app.developerName, want, 'a fresh page load keeps the app');
    });
  }

  await t.test('an app the user cannot open is APP_UNAVAILABLE with the apps it can', async () => {
    const { isError, body } = await call('sf_start', { org: env.org, app: 'No Such App' });
    assert.deepEqual([isError, body.code], [true, 'APP_UNAVAILABLE'], JSON.stringify(body));
    assert.ok(body.evidence.apps.some((a) => a.developerName === 'SfUi_App'), JSON.stringify(body.evidence));
  });

  await t.test('opening an app by URL leaves the user\'s last-used app as it was', async () => {
    const now = (await (await fetch(`${admin.instanceUrl}/services/data/v60.0/ui-api/apps/selected?formFactor=Large`, { headers: { Authorization: `Bearer ${admin.accessToken}` } })).json()).developerName;
    assert.equal(now, lastUsed);
  });
});

// F-flow-29 (component fixture): after a Visualforce button the record page shows SfUiC_App's navigation bar while
// $Global.appContextId stays empty, in most runs (some refill it): the no-org test below is the one that always fails without the fix.
test('sf_whoami names the app the navigation bar shows after a Visualforce button', { skip, timeout: 300_000 }, async (t) => {
  const call = await connect(t);
  const start = await call('sf_start', { org: env.org, app: 'SfUiC_App' });
  if (start.body.code === 'APP_UNAVAILABLE') return t.skip('the org has no test/fixture-components app SfUiC_App');
  assert.equal(start.isError, false, JSON.stringify(start.body));
  const admin = await auth(env.org);
  const sobjects = `${admin.instanceUrl}/services/data/v60.0/sobjects/SfUiC_Item__c`;
  const headers = { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' };
  const name = `BREAK fix whoami ${stamp()}`;
  const { id } = await (await fetch(sobjects, { method: 'POST', headers, body: JSON.stringify({ Name: name }) })).json();
  t.after(() => fetch(`${sobjects}/${id}`, { method: 'DELETE', headers }));
  const ok = async (tool, args) => {
    const r = await call(tool, args);
    assert.equal(r.isError, false, `${tool}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  assert.match((await ok('sf_launch_action', { recordId: id, apiName: 'SfUiC_Vf_Button' })).url, /\/one\/one\.app#/);
  await ok('sf_wait', { frame: 'iframe[name^=vfFrameId]', text: `SFUIC Item: ${name}`, timeoutMs: 8000 });
  await ok('sf_launch_action', { recordId: id, apiName: 'SfUiC_Open_Web' });
  const me = (await call('sf_whoami')).body;
  assert.equal(me.app?.developerName, 'SfUiC_App', JSON.stringify(me));
  if (me.appReason) assert.match(me.appReason, /navigation bar/, 'sf_whoami says where the app was read from');
});

// F-flow-29 with no org: Lightning's $A with no app id (as after a Visualforce page) under a navigation bar.
test('currentApp, no org: reads the app from the navigation bar when Lightning names none', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  const shown = (ctx) => page.goto(`data:text/html,<script>window.$A={get:()=>'${ctx}'}</script><one-appnav><span class="appName">SFUIC App</span></one-appnav>`);
  const app = (id, developerName) => ({ id, label: 'SFUIC App', developerName });
  await shown('');
  const one = await session.currentApp({ page }, [app('06m1', 'SfUiC_App'), { id: '06m2', label: 'Sales', developerName: 'LightningSales' }]);
  assert.deepEqual([one.developerName, one.id], ['SfUiC_App', '06m1']);
  assert.match(one.reason, /navigation bar/);
  // Two apps share the label: the session's own app wins; with no session app neither is guessed.
  await shown('06mGone');
  const two = [app('06m1', 'SfUiC_App'), app('06m3', 'SfUiC_Twin')];
  assert.equal((await session.currentApp({ page, app: { id: '06m3' } }, two)).developerName, 'SfUiC_Twin');
  assert.equal((await session.currentApp({ page }, two)).developerName, undefined);
});
