'use strict';

// sf_login_as and the session's app on the fixture org. It logs in as the platform user, which can disturb other
// sessions from the same alias: run it alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { env, skip } = require('./helpers');

test('app across Login As', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
  };

  // The fixture persona can open no app (Lightning says USER_HAS_NO_APPS), so the app is checked against its list.
  await t.test('Login As with no app re-opens the session\'s app as the new user, refused when that user cannot open it', async () => {
    assert.equal((await call('sf_start', { org: env.org, app: 'SF UI Console' })).body.app.developerName, 'SfUi_Console');
    const { isError, body } = await call('sf_login_as', { user: env.user });
    assert.deepEqual([isError, body.code, body.evidence?.app, body.evidence?.apps], [true, 'APP_UNAVAILABLE', 'SfUi_Console', []], JSON.stringify(body));
    const me = (await call('sf_whoami')).body;
    assert.deepEqual([me.app.id, me.apps], ['USER_HAS_NO_APPS', []], JSON.stringify(me));
    assert.deepEqual([body.evidence.userId, body.message.includes(`logged in as ${me.userId}`)], [me.userId, true], 'the error names the user the session now runs as');
  });

  await t.test('Login As with an app checks that one', async () => {
    await call('sf_start', { org: env.org, app: 'SF UI Console' });
    const { body } = await call('sf_login_as', { user: env.user, app: 'SfUi_App' });
    assert.deepEqual([body.code, body.evidence?.app], ['APP_UNAVAILABLE', 'SfUi_App'], JSON.stringify(body));
  });

  await t.test('control: with no app anywhere, Login As reports the app the user landed in and keeps none', async () => {
    await call('sf_start', { org: env.org });
    const { isError, body } = await call('sf_login_as', { user: env.user });
    assert.deepEqual([isError, body.app?.id, body.appKept], [false, 'USER_HAS_NO_APPS', undefined], JSON.stringify(body));
  });
});
