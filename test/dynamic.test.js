'use strict';

// Dynamic Forms: the fixture's SfUiDyn__c page places Name, Note, Level, Loc and the Probe__c lookup as field instances,
// and its layout also carries Hidden. The edit dialog follows the page, so the form model must come from the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, form, api, discover } = require('..');
const { auth, env, skip, record, account, probe, stamp } = require('./helpers');

test('dynamic forms', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await record(s, t, 'SfUiDyn__c', { Name: `sfui dyn ${stamp()}` });

  await t.test('editRecord on a Dynamic Forms page models the page\'s fields, not the layout\'s', async () => {
    const f = await form.editRecord(s, id);
    assert.equal(f.model.source, 'dynamicForms');
    assert.deepEqual(f.model.fields.map((x) => x.apiName), ['Name', 'Note__c', 'Level__c', 'Loc__Latitude__s', 'Loc__Longitude__s', 'Probe__c']);
    assert.deepEqual(f.missing, []);
    await form.cancel(f);
  });

  await t.test('setFields and save work on the Dynamic Forms dialog', async () => {
    const f = await form.editRecord(s, id);
    await form.setFields(f, { Note__c: 'from the page', Level__c: 'High' });
    assert.equal((await form.save(f)).outcome, 'saved');
    const { fields } = await api.call(s, `/ui-api/records/${id}?fields=SfUiDyn__c.Note__c,SfUiDyn__c.Level__c`);
    assert.deepEqual([fields.Note__c.value, fields.Level__c.value], ['from the page', 'High']);
  });

  await t.test('a field only on the layout is not on the Dynamic Forms form', async () => {
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { Hidden__c: 'x' }), { code: 'FIELD_NOT_ON_FORM' });
    await form.cancel(f);
  });

  // A compound field instance (a location, an address) is edited through its parts, as on a layout.
  await t.test('setFields reaches the parts of a compound field on a Dynamic Forms page', async () => {
    const f = await form.editRecord(s, id);
    await form.setFields(f, { Loc__Latitude__s: '12.5', Loc__Longitude__s: '-3.25' });
    assert.equal((await form.save(f)).outcome, 'saved');
    const { fields } = await api.call(s, `/ui-api/records/${id}?fields=SfUiDyn__c.Loc__Latitude__s,SfUiDyn__c.Loc__Longitude__s`);
    assert.deepEqual([fields.Loc__Latitude__s.value, fields.Loc__Longitude__s.value], [12.5, -3.25]);
  });

  // A route that names the form model it was checked on goes red when an admin upgrades the page, not green.
  await t.test('editRecord and editInline refuse a form model the caller did not expect', async () => {
    await assert.rejects(form.editRecord(s, id, { source: 'pageLayout' }), (e) => e.code === 'SOURCE_MISMATCH' && e.evidence.source === 'dynamicForms');
    await assert.rejects(form.editInline(s, id, 'Note__c', { source: 'pageLayout' }), (e) => e.code === 'SOURCE_MISMATCH');
    const f = await form.editRecord(s, id, { source: 'dynamicForms' });
    await form.cancel(f);
  });

  // A Dynamic Forms page has no detail panel: inline edit turns the page's field sections into the form.
  await t.test('editInline works on a Dynamic Forms page', async () => {
    const f = await form.editInline(s, id, 'Note__c');
    await form.setFields(f, { Note__c: 'inline on the page' });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.equal((await api.call(s, `/ui-api/records/${id}?fields=SfUiDyn__c.Note__c`)).fields.Note__c.value, 'inline on the page');
  });
});

// F-cascade-36: SfUi_Gate_Record_Page (SfUi_App) places only Level__c and Note__c, which the admin cannot read without
// SfUi_Gate_Access, so the dialog shows no field and the form model must not fall back to the layout's Name.
test('a Dynamic Forms page that shows the user no field models no field', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const { fields } = await api.call(s, '/ui-api/object-info/SfUiGate__c');
  if (fields.Level__c || fields.Note__c) return t.skip('the admin can read Level__c or Note__c here, so the gate page shows a field');
  await session.openApp(s, 'SfUi_App');
  const id = await record(s, t, 'SfUiGate__c', { Name: `BREAK fix gate ${stamp()}` });
  const f = await form.editRecord(s, id);
  assert.equal(f.model.source, 'dynamicForms');
  assert.equal(f.model.flexiPageApiName, 'SfUi_Gate_Record_Page');
  assert.deepEqual(f.model.fields, []);
  assert.deepEqual(f.missing, []);
  await form.cancel(f);
  // control: a record page that places no field instance is still modelled from the layout
  const a = await form.editRecord(s, await probe(s, t, { Name: `BREAK fix probe ${stamp()}` }));
  assert.equal(await discover.renderedPage(s), 'SfUi_Probe_Record_Page');
  assert.equal(a.model.source, 'pageLayout');
  assert.ok(a.model.fields.some((x) => x.apiName === 'Name'));
  await form.cancel(a);
});

// F-cascade-14: SfUiC_Contact_Page (SfUiC_App) places the standard lookup AccountId. Object-info labels it "Account ID",
// the dialog "Account Name" as the layout does, so the model must take the layout's label to find the box.
test('a standard lookup on a Dynamic Forms page is labelled as the form labels it', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  const acct = await account(s, t, { Name: `BREAK fix account ${stamp()}` });
  const id = await record(s, t, 'Contact', { LastName: `BREAK fix contact ${stamp()}` });
  const f = await form.editRecord(s, id);
  assert.equal(f.model.flexiPageApiName, 'SfUiC_Contact_Page');
  assert.equal(f.model.fields.find((x) => x.apiName === 'AccountId').label, 'Account Name');
  assert.ok(!f.missing.includes('AccountId'), `missing: ${f.missing}`);
  await form.setFields(f, { AccountId: acct });
  assert.equal((await form.save(f)).outcome, 'saved');
  assert.equal((await api.call(s, `/ui-api/records/${id}?fields=Contact.AccountId`)).fields.AccountId.value, acct);
});

// F-cascade-18: SfUiC_Place_App_Page (SfUiC_App) places the custom Address Site__c. The dialog names its boxes as
// object-info labels the parts ("Site (City)"), so the model must keep that label to find them.
test('a custom Address on a Dynamic Forms page is labelled as the form labels its parts', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  const id = await record(s, t, 'SfUiC_Place__c', { Name: `BREAK fix place ${stamp()}` });
  const f = await form.editRecord(s, id);
  assert.equal(f.model.flexiPageApiName, 'SfUiC_Place_App_Page');
  const label = (api) => f.model.fields.find((x) => x.apiName === api).label;
  assert.deepEqual([label('Site__City__s'), label('Site__Street__s')], ['Site (City)', 'Site (Street)']);
  assert.deepEqual(f.missing, []); // the coordinates have no box on an address form, so they are not modelled
  await form.setFields(f, { Site__City__s: 'Oakland', Site__Street__s: '2 Break Street' });
  assert.equal((await form.save(f)).outcome, 'saved');
  const { fields } = await api.call(s, `/ui-api/records/${id}?fields=SfUiC_Place__c.Site__City__s,SfUiC_Place__c.Site__Street__s`);
  assert.deepEqual([fields.Site__City__s.value, fields.Site__Street__s.value], ['Oakland', '2 Break Street']);
});
