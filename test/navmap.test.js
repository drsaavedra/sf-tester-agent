'use strict';

// navmap: the per-run map from the org's own metadata. No org: the readers over the fixture's own component source,
// and route over a hand-made map. Fixture org: map the probe record page and run the route to its inline dialog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { navmap } = require('..');
const { env, skip, auth } = require('./helpers');

const lwc = (name, ext) => fs.readFileSync(path.join(__dirname, 'fixture', 'force-app', 'main', 'default', 'lwc', name, `${name}.${ext}`), 'utf8');

test('read finds a component\'s children and the dialogs its buttons open', () => {
  const probe = navmap.read(lwc('sfUiProbe', 'html'), lwc('sfUiProbe', 'js'));
  assert.deepEqual(probe.children, ['sfUiProbeHelp']);
  // Close inline dialog shares the toggle but sits inside the dialog, so it is no way in.
  assert.deepEqual(probe.dialogs, [
    { label: 'Inline dialog', button: 'Open inline dialog', kind: 'inline' },
    { label: 'SF UI Probe Dialog', button: 'Open dialog', kind: 'modal', component: 'sfUiProbeModal' },
  ]);
  assert.ok(probe.buttons.includes('Ping'), 'a button that opens nothing is still listed');
  const more = navmap.read(lwc('sfUiMore', 'html'), lwc('sfUiMore', 'js'));
  assert.ok(['sfUiStates', 'sfUiWidgets', 'sfUiExtra'].every((c) => more.children.includes(c)), JSON.stringify(more.children));
});

test('route goes through the placed parent, its tabs and the button to a dialog, and names what it cannot reach', () => {
  const map = {
    pages: { Page: [{ component: 'parent', tabs: ['More'], tabsets: ['ts'] }] },
    components: {
      parent: { children: ['child'], buttons: [], dialogs: [] },
      child: { children: [], buttons: ['Open it'], dialogs: [{ label: 'The dialog', button: 'Open it', kind: 'inline' }] },
    },
  };
  const r = navmap.route(map, { to: 'the dialog', recordId: 'a01' });
  assert.deepEqual(r.steps.map((s) => [s.tool, s.args.lwcApiName || s.args.text || s.args.recordId]), [['sf_open_record', 'a01'], ['sf_lwc_read', 'parent'], ['sf_lwc_read', 'child'], ['sf_click', 'child'], ['sf_wait', 'The dialog']]);
  assert.equal(r.steps[3].args.name, 'Open it');
  assert.deepEqual(r.via.map((v) => v.known), ['metadata', 'code', 'code']);
  assert.deepEqual(r.via[0].tabs, ['More']);
  assert.deepEqual(navmap.route(map, { to: 'parent' }).needs, ['recordId']);
  assert.throws(() => navmap.route(map, { to: 'elsewhere' }), (e) => e.code === 'NOT_FOUND' && e.evidence.dialogs.includes('The dialog'));
});

test('build reads every page of component source, so a component on a later page is not taken for a standard one', async (t) => {
  const { api } = require('..');
  const row = (name, ext, Source) => ({ FilePath: `lwc/${name}/${name}.${ext}`, Source, LightningComponentBundle: { DeveloperName: name } });
  const asked = [];
  t.mock.method(api, 'call', async (s, p) => {
    asked.push(p);
    return p.startsWith('/tooling/query?') ? { done: false, nextRecordsUrl: '/services/data/v60.0/tooling/query/01gx-2000', records: [row('first', 'html', '<template></template>')] }
      : { done: true, records: [row('second', 'html', '<template><button onclick={go}>Go</button></template>')] };
  });
  const map = await navmap.build({}, { lwcs: ['first', 'second'] });
  assert.deepEqual(Object.keys(map.components).sort(), ['first', 'second']);
  assert.deepEqual(map.components.second.buttons, ['Go']);
  assert.equal(asked[1], '/tooling/query/01gx-2000', 'the next page by its own path');
});

test('build tries a Tooling page once more after a blip', async (t) => {
  const { api, SfUiError } = require('..');
  let blips = 1;
  t.mock.method(api, 'call', async () => {
    if (blips-- > 0) throw new SfUiError('API_ERROR', 'answered 503', { status: 503 });
    return { done: true, records: [{ FilePath: 'lwc/one/one.html', Source: '<template><button onclick={go}>Go</button></template>', LightningComponentBundle: { DeveloperName: 'one' } }] };
  });
  const map = await navmap.build({}, { lwcs: ['one'] });
  assert.deepEqual(map.components.one.buttons, ['Go']);
});

test('navmap on the fixture org', { skip, timeout: 300_000 }, async (t) => {
  const client = new Client({ name: 'sf-ui-navmap', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], env: process.env }));
  t.after(async () => { await client.callTool({ name: 'sf_end', arguments: {} }); await client.close(); });
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, body: JSON.parse(r.content[0].text) }; };
  const admin = await auth(env.org);
  const rest = async (p, init = {}) => (await fetch(`${admin.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' } })).json().catch(() => null);
  const { id } = await rest('/sobjects/SfUiProbe__c', { method: 'POST', body: JSON.stringify({ Name: `sf-ui navmap ${Date.now()}`, Tags__c: 'Alpha' }) });
  t.after(() => fetch(`${admin.instanceUrl}/services/data/v60.0/sobjects/SfUiProbe__c/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin.accessToken}` } }));
  await call('sf_start', { org: env.org });
  assert.equal((await call('sf_route', { to: 'Inline dialog' })).body.code, 'NO_MAP', 'the control: no map before sf_map_feature');

  const built = await call('sf_map_feature', { flexiPages: ['SfUi_Probe_Record_Page'] });
  assert.equal(built.isError, false, JSON.stringify(built.body).slice(0, 500));
  // The nested help component is in no FlexiPage: only a source round finds it.
  assert.ok(built.body.components.sfUiProbeHelp, JSON.stringify(built.body.rounds));
  assert.ok(built.body.rounds.length >= 3 && built.body.rounds.length <= 5, JSON.stringify(built.body.rounds));
  console.log(`navmap rounds ${JSON.stringify(built.body.rounds)} in ${built.body.seconds} s, ${JSON.stringify(built.body).length} chars`);

  const r = await call('sf_route', { to: 'Inline dialog', recordId: id });
  assert.equal(r.isError, false, JSON.stringify(r.body));
  const ran = await call('sf_run_route', { steps: r.body.steps });
  assert.equal(ran.isError, false, JSON.stringify(ran.body).slice(0, 600));
});
