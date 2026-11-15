'use strict';

// discover.formModel as the user the page runs as. The control is the platform user's own
// User record: the admin may edit ManagerId on it, the platform user may not.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, discover } = require('..');
const { auth, env, skip, account } = require('./helpers');

test('discover', { skip, timeout: 300_000 }, async (t) => {
  const target = await auth(env.user);
  const targetId = (await (await fetch(`${target.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${target.accessToken}` } })).json()).user_id;
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const record = await account(s, t);
  const field = (model, apiName) => model.fields.find((f) => f.apiName === apiName);

  await t.test('formModel as admin: ManagerId is on the form and editable', async () => {
    const model = await discover.formModel(s, targetId);
    assert.equal(model.objectApiName, 'User');
    assert.equal(field(model, 'ManagerId').editable, true);
    assert.ok(field(model, 'ManagerId').label);
    assert.ok(field(model, 'ManagerId').dataType);
  });

  await t.test('formModel labels match what the form shows, compound fields by part', async () => {
    const model = await discover.formModel(s, record);
    assert.equal(field(model, 'Rating').label, 'Rating');
    assert.equal(field(model, 'BillingStreet').label, 'Billing Street');
  });

  // sf_open_record names the page on every open, so a page with no record FlexiPage must answer null, not stall.
  await t.test('renderedPage answers null at once on a page that is not a record FlexiPage', async () => {
    await s.page.goto(`${s.origin}/lightning/page/home`);
    await s.page.getByRole('main').waitFor();
    const started = Date.now();
    assert.equal(await discover.renderedPage(s), null);
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  });

  await t.test('formModel as the platform user: ManagerId on the form but read-only', async () => {
    await session.loginAs(s, targetId);
    const model = await discover.formModel(s, targetId);
    assert.equal(field(model, 'ManagerId').editable, false);
  });
});

// No org: Lightning keeps the last record's page hidden in the record home after an in-app navigation (measured on
// sfui-s4-flow, Account then a probe), so the page named is the shown one, not the first in the DOM.
test('renderedPage names the record page that shows, not a hidden one kept from the last record, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const page = await localPage(t);
  const id = 'a02000000000001AAA';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<one-record-home-flexipage2>
    <forcegenerated-flexipage_account_rec_l_account__view_js style="display:none">old</forcegenerated-flexipage_account_rec_l_account__view_js>
    <forcegenerated-flexipage_sfui_probe_record_page_sfuiprobe__c__view_js>now</forcegenerated-flexipage_sfui_probe_record_page_sfuiprobe__c__view_js>
    </one-record-home-flexipage2>` }));
  await page.goto(`https://x.lightning.force.com/lightning/r/SfUiProbe__c/${id}/view`);
  t.mock.method(api, 'call', async (s, path) => ({ records: /'sfui_probe_record_page'/.test(decodeURIComponent(path)) ? [{ DeveloperName: 'SfUi_Probe_Record_Page' }] : [] }));
  assert.equal(await discover.renderedPage({ page }), 'SfUi_Probe_Record_Page');
});

// No org: a component placed twice is the one whose wrapper (data-component-id, measured on sfui-s4-flow) shows;
// AMBIGUOUS only when two show, each place with its visibility rule.
test('lwcOnPage takes the one shown copy of a component placed twice, AMBIGUOUS when two show, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const page = await localPage(t);
  const rule = { criteria: [{ leftValue: '{!Record.Name}', operator: 'EQUAL', rightValue: 'x' }] };
  const placed = (...ids) => ({ records: [{ Metadata: { flexiPageRegions: [{ name: 'main', itemInstances: ids.map((identifier) => ({ componentInstance: { componentName: 'c:sfUiProbe', identifier, ...(identifier.endsWith('2') && { visibilityRule: rule }) } })) }] } }] });
  const wrap = (id, shown = true) => `<div data-component-id="${id}"${shown ? '' : ' style="display:none"'}><c-sf-ui-probe>${id}</c-sf-ui-probe></div>`;
  t.mock.method(api, 'call', async () => placed('c_sfUiProbe', 'c_sfUiProbe2'));
  await page.setContent(wrap('c_sfUiProbe', false) + wrap('c_sfUiProbe2'));
  assert.equal((await discover.lwcOnPage({ page }, 'Probe_Page', 'sfUiProbe')).identifier, 'c_sfUiProbe2', 'the shown copy, not the first');
  await page.setContent(wrap('c_sfUiProbe') + wrap('c_sfUiProbe2'));
  await assert.rejects(discover.lwcOnPage({ page }, 'Probe_Page', 'sfUiProbe'), (e) => e.code === 'AMBIGUOUS' && /lwcApiName/.test(e.message)
    && e.evidence.places.map((p) => p.identifier).join() === 'c_sfUiProbe,c_sfUiProbe2' && e.evidence.places[1].visibilityRule === rule);
  await page.setContent('<p>no copy shows</p>');
  assert.equal((await discover.lwcOnPage({ page }, 'Probe_Page', 'sfUiProbe')).identifier, 'c_sfUiProbe', 'none shows: the first, whose tabs locate opens');
  t.mock.method(api, 'call', async () => placed('c_sfUiProbe'));
  assert.equal((await discover.lwcOnPage({}, 'Probe_Page', 'sfUiProbe')).identifier, 'c_sfUiProbe'); // control: placed once
});
