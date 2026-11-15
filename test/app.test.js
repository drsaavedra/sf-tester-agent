'use strict';

// sf_start's app on the fixture org (SfUi_App, SfUi_Console), over stdio as an agent calls it. No Login As, so it
// leaves other sessions alone; app-login-as.test.js has the persona half.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { auth, env, skip } = require('./helpers');

test('app', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };
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
