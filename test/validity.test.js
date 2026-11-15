'use strict';

// A route's validity with no org: what is read from a page, and what counts as changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validity, api, discover, SfUiError } = require('..');
const { fetchCoded } = require('../src/errors');

const ID = 'a01C1000001AbCdEAK';
const queries = [];
const page = (path, app = 'LightningSales') => ({ apiVersion: '66.0', app: app && { developerName: app }, page: { url: () => `https://x.lightning.force.com${path}` } });
// One org's answers: the app and page it shows, and the metadata Tooling holds, keyed by type then name.
function org(t, { broken, flexiPage = 'Probe_Page', fields = [{ apiName: 'Name' }], meta = { CustomApplication: { LightningSales: { tabs: ['a'] } }, FlexiPage: { Probe_Page: { regions: 1 } } } } = {}) {
  const asked = [];
  t.mock.method(discover, 'renderedPage', async () => flexiPage);
  t.mock.method(discover, 'formModel', async (s, recordId) => { if (broken) throw broken; asked.push(recordId); return { objectApiName: 'Probe__c', fields }; });
  t.mock.method(api, 'call', async (s, path) => {
    assert.equal(s.apiVersion, '60.0', 'a hash read at the session\'s version would move with each release');
    queries.push(decodeURIComponent(path));
    const [, type, name] = /FROM (\w+) WHERE DeveloperName = '(\w+)'/.exec(decodeURIComponent(path));
    const m = meta[type]?.[name];
    return { records: m ? [{ Metadata: m }] : [] };
  });
  return asked;
}

test('read says which part threw on the session, and nothing when none did', async (t) => {
  org(t, { broken: new SfUiError('API_ERROR', 'form boom') });
  const { read, unread } = await validity.readParts(page(`/lightning/r/Probe__c/${ID}/view`));
  assert.deepEqual(Object.keys(read), ['app'], 'the part that finished is kept');
  assert.deepEqual(unread, ['page: API_ERROR: form boom']);
  assert.deepEqual((await validity.readParts(page('/lightning/o/Probe__c/list'))).unread, [], 'control: a read that threw nothing');
});

test('read keeps the app and the record page by content hash, on the page and in its edit dialog', async (t) => {
  const asked = org(t);
  const view = await validity.read(page(`/lightning/r/Probe__c/${ID}/view`));
  assert.deepEqual(view, { app: { name: 'LightningSales', hash: validity.hash({ tabs: ['a'] }) }, page: { object: 'Probe__c', flexiPage: 'Probe_Page', flexiPageHash: validity.hash({ regions: 1 }), formHash: validity.hash([{ apiName: 'Name' }]) } });
  assert.deepEqual(await validity.read(page(`/lightning/r/Probe__c/${ID}/edit?count=1`)), view);
  assert.deepEqual(asked, [ID, ID]);
  assert.match(queries.find((q) => q.includes('CustomApplication')), /DeveloperName = 'LightningSales' AND \(NamespacePrefix = null OR NamespacePrefix = 'standard'\) ORDER BY NamespacePrefix NULLS FIRST LIMIT 1/);
  await validity.read(page('/lightning/o/Probe__c/list', 'pkg__LightningSales'));
  assert.match(queries.at(-1), /DeveloperName = 'LightningSales' AND NamespacePrefix = 'pkg' LIMIT 1/, 'a packaged app of the same name');
  assert.equal((await validity.read(page(`/lightning/r/Probe__c/${ID}/editAllocations`, null))), null, 'a segment that only starts with edit');
});

test('read keeps only the app off a record page, and null when nothing can be read', async (t) => {
  org(t);
  assert.deepEqual(Object.keys(await validity.read(page('/lightning/o/Probe__c/list'))), ['app']);
  assert.equal(await validity.read(page('/lightning/o/Probe__c/list', null)), null, 'no app opened');
  api.call.mock.mockImplementation(async () => { throw new Error('API_ERROR'); });
  assert.equal(await validity.read(page('/lightning/o/Probe__c/list')), null);
  assert.equal(await validity.read(undefined), null, 'a route with no session');
});

test('a page with no FlexiPage keeps its form; a page not rendered yet is no read at all', async (t) => {
  const asked = org(t, { flexiPage: null });
  const s = (hosts) => ({ ...page(`/lightning/r/Probe__c/${ID}/view`, null), page: { url: () => `https://x/lightning/r/Probe__c/${ID}/view`, locator: () => ({ count: async () => hosts }) } });
  assert.deepEqual(await validity.read(s(1)), { page: { object: 'Probe__c', formHash: validity.hash([{ apiName: 'Name' }]) } });
  assert.equal(discover.renderedPage.mock.callCount(), 2, 'asked again, with the host there');
  asked.length = 0;
  assert.equal(await validity.read(s(0)), null);
  assert.deepEqual(asked, [], 'no form read, so no fetch that can fail in the page');
});

test('a host that came just after the wait gives its FlexiPage, not none', async (t) => {
  org(t, { flexiPage: null });
  discover.renderedPage.mock.mockImplementationOnce(async () => null, 0);
  discover.renderedPage.mock.mockImplementation(async () => 'Probe_Page');
  const s = { ...page(`/lightning/r/Probe__c/${ID}/view`, null), page: { url: () => `https://x/lightning/r/Probe__c/${ID}/view`, locator: () => ({ count: async () => 1 }) } };
  assert.equal((await validity.read(s)).page.flexiPage, 'Probe_Page');
});

test('a page that never answers costs the read, not the route', async (t) => {
  org(t);
  discover.renderedPage.mock.mockImplementation(() => new Promise(() => {}));
  assert.equal(await validity.read(page(`/lightning/r/Probe__c/${ID}/view`, null), 10), null);
  assert.deepEqual(Object.keys(await validity.read(page(`/lightning/r/Probe__c/${ID}/view`), 10)), ['app'], 'the part that finished is kept');
  const { unread } = await validity.readParts(page(`/lightning/r/Probe__c/${ID}/view`), 10);
  assert.deepEqual(unread, ['page: timed out after 10ms'], 'a part that ran out of time is unread, the one that finished is not');
});

test('a page read that ran out of time keeps the console errors logged meanwhile', async (t) => {
  org(t);
  const s = page(`/lightning/r/Probe__c/${ID}/view`);
  s.errors = [];
  discover.renderedPage.mock.mockImplementation(() => { s.errors.push({ message: 'Failed to load resource: the page\'s own 404' }); return new Promise(() => {}); });
  await validity.read(s, 10);
  assert.deepEqual(s.errors.map((e) => e.message), ['Failed to load resource: the page\'s own 404'], 'a slow read is not a failed one');
});

test('a failed read leaves no error for sf_page_errors; a read that worked leaves the page\'s own', async (t) => {
  org(t);
  const s = page(`/lightning/r/Probe__c/${ID}/view`);
  s.errors = [{ message: 'Failed to load resource: earlier, the page\'s own' }];
  discover.formModel.mock.mockImplementation(async () => {
    s.errors.push({ message: 'Failed to load resource: the server responded with a status of 403 ()' }, { message: 'Uncaught TypeError: x' });
    throw new Error('API_ERROR');
  });
  await validity.read(s);
  assert.deepEqual(s.errors.map((e) => e.message), ['Failed to load resource: earlier, the page\'s own', 'Uncaught TypeError: x']);
  discover.formModel.mock.mockImplementation(async () => {
    s.errors.push({ message: 'Failed to load resource: the page\'s own 500' });
    return { objectApiName: 'Probe__c', fields: [] };
  });
  await validity.read(s);
  assert.equal(s.errors.at(-1).message, 'Failed to load resource: the page\'s own 500');
});

const SAVED = { app: { name: 'A', hash: 'a1' }, page: { object: 'Probe__c', flexiPage: 'P', flexiPageHash: 'p1', formHash: 'f1' } };
const withPage = (part) => ({ ...SAVED, page: { ...SAVED.page, ...part } });

test('changed names each part that differs', () => {
  assert.deepEqual(validity.changed(SAVED, { ...SAVED }), [], 'control: nothing changed');
  assert.deepEqual(validity.changed(SAVED, { ...SAVED, app: { name: 'A', hash: 'a2' } }), ['app A']);
  assert.deepEqual(validity.changed(SAVED, withPage({ flexiPageHash: 'p2' })), ['FlexiPage P']);
  assert.deepEqual(validity.changed(SAVED, withPage({ formHash: 'f2' })), ['form of Probe__c']);
  assert.deepEqual(validity.changed(SAVED, withPage({ flexiPage: 'Q', flexiPageHash: 'q1' })), ['FlexiPage P is now Q']);
  const none = { object: 'Probe__c', formHash: 'f2' };
  assert.deepEqual(validity.changed(SAVED, { ...SAVED, page: none }), ['FlexiPage P is now none', 'form of Probe__c'], 'a page removed');
  assert.deepEqual(validity.changed({ ...SAVED, page: none }, SAVED), ['FlexiPage none is now P', 'form of Probe__c'], 'a page added');
});

test('changed compares like with like: another app, another object or no read says nothing', () => {
  assert.deepEqual(validity.changed(SAVED, { app: { name: 'B', hash: 'b1' }, page: { ...SAVED.page, flexiPage: 'Q', formHash: 'x' } }), [], 'another app, which can assign its own page');
  assert.deepEqual(validity.changed(SAVED, { page: { ...SAVED.page, formHash: 'f2' } }), ['form of Probe__c'], 'a session with no app still compares its page');
  assert.deepEqual(validity.changed(SAVED, withPage({ object: 'Other__c', flexiPage: 'Q', formHash: 'x' })), [], 'a red before the saved page');
  assert.deepEqual(validity.changed(SAVED, { app: SAVED.app }), [], 'off a record page');
  assert.deepEqual(validity.changed(undefined, SAVED), [], 'a route with no baseline');
  assert.deepEqual(validity.changed(SAVED, null), [], 'no read');
});

const PERSONA = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe_Read', 'ns__Extra'] };

test('changed compares a page only between reads of one persona, and an app across them', () => {
  const as = (persona, form) => ({ app: SAVED.app, ...(persona && { persona }), page: { ...SAVED.page, formHash: form } });
  assert.deepEqual(validity.changed(as(null, 'f1'), as(PERSONA, 'f2')), [], 'an alias-user baseline read as a persona');
  assert.deepEqual(validity.changed(as(PERSONA, 'f1'), as(null, 'f2')), [], 'a read that could not name its user is not another persona');
  assert.deepEqual(validity.changed(as(PERSONA, 'f1'), as({ ...PERSONA, profile: 'Other' }, 'f2')), ['persona: saved as Standard Platform User + SfUi_Probe_Read + ns__Extra'], 'another persona says so, with no page comparison');
  assert.deepEqual(validity.changed(as(PERSONA, 'f1'), as({ ...PERSONA, permissionSets: [...PERSONA.permissionSets].reverse() }, 'f1')), [], 'hand-edited order is one persona');
  assert.deepEqual(validity.changed(as(PERSONA, 'f1'), null), [], 'no read says nothing');
  assert.deepEqual(validity.changed(as(PERSONA, 'f1'), as(PERSONA, 'f2')), ['form of Probe__c'], 'control: one persona still compares');
  assert.deepEqual(validity.changed({ app: SAVED.app }, { app: { ...SAVED.app, hash: 'a2' }, persona: PERSONA }), [`app ${SAVED.app.name}`], 'the app is not per user');
});

// The two persona reads answered, beside what the page reads answer.
function personaOrg(t, answers) {
  const asked = [];
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Probe__c', fields: [] }));
  t.mock.method(api, 'call', async (s, path) => {
    const q = decodeURIComponent(path);
    asked.push(q);
    return { records: answers(q) };
  });
  return asked;
}
const on = (extra) => ({ ...page(`/lightning/r/Probe__c/${ID}/view`, null), ...extra, page: { url: () => `https://x.lightning.force.com/lightning/r/Probe__c/${ID}/view`, locator: () => ({ count: async () => 1 }) } });
const people = (q) => (q.includes('FROM User') ? [{ Profile: { Name: PERSONA.profile } }]
  : q.includes('FROM PermissionSetAssignment') ? [{ PermissionSetId: '0PS1', PermissionSet: { Name: 'Extra', NamespacePrefix: 'ns' } }, { PermissionSetId: '0PS2', PermissionSet: { Name: 'SfUi_Probe_Read' } }] : []);
const users = (asked) => asked.filter((q) => q.includes('FROM User')).length;
const named = (p) => p && { profile: p.profile, permissionSets: p.permissionSets };

test('read says who it read as after a login, once per user, and nothing for the alias user', async (t) => {
  const asked = personaOrg(t, people);
  const s = on({ loggedInAs: '005a' });
  assert.deepEqual(named((await validity.read(s)).persona), PERSONA, 'sorted, whatever order the org answers in');
  assert.match(asked.find((q) => q.includes('FROM PermissionSetAssignment')), /IsOwnedByProfile = false AND PermissionSet.Type != 'Session'/, 'a profile\'s own set and a Session set are no part of the key');
  await validity.read(s);
  assert.equal(users(asked), 1, 'the second route reads no persona');
  s.loggedInAs = '005b';
  await validity.read(s);
  assert.equal(users(asked), 2, 'control: another user is read');
  const alone = on({});
  assert.equal((await validity.read(alone)).persona, undefined);
  assert.equal(users(asked), 2, 'the alias user costs no read');
});

test('a saved persona makes the alias user\'s read name its own, so one user compares with itself', async (t) => {
  const asked = personaOrg(t, people);
  const s = on({ tokenUserId: '005alias' });
  assert.deepEqual(named((await validity.read(s, undefined, true)).persona), PERSONA);
  assert.match(asked.find((q) => q.includes('FROM User')), /005alias/);
  assert.equal((await validity.read(s)).persona, undefined, 'control: with no saved persona it stays out');
});

test('a cut query is refused: rows it lost would read as sets a user does not hold', async (t) => {
  t.mock.method(api, 'call', async () => ({ records: [], done: false }));
  await assert.rejects(validity.queryAs({})('SELECT Id FROM User'), /QUERY_TOO_LARGE/);
});

test('a permission set group goes by its own name, which holds across orgs', async (t) => {
  personaOrg(t, (q) => (q.includes('FROM User') ? [{ Profile: { Name: 'P' } }] : [{ PermissionSet: { Name: 'X0P1a2b' }, PermissionSetGroup: { DeveloperName: 'Sales_Group', NamespacePrefix: 'ns' } }]));
  assert.deepEqual((await validity.read(on({ loggedInAs: '005a' }))).persona.permissionSets, ['ns__Sales_Group']);
});

test('after a failed login a read keeps no page, and a save is refused', async (t) => {
  personaOrg(t, people);
  assert.equal(await validity.read(on({ loggedInAs: 'unknown' })), null);
  assert.deepEqual((await validity.readParts(on({ loggedInAs: 'unknown' }))).unread, [], 'an unknown viewer says so already, so it is not also unread');
  await assert.rejects(validity.personaOf({ loggedInAs: 'unknown' }), /VIEWER_UNKNOWN/);
});

test('a page read with no known viewer is no baseline', async (t) => {
  personaOrg(t, () => { throw new Error('read failed'); });
  assert.equal(await validity.read(on({ loggedInAs: '005a' })), null);
  assert.deepEqual((await validity.readParts(on({ loggedInAs: '005a' }))).unread, ['persona: read failed'], 'control: any other persona failure is unread');
  assert.ok((await validity.read(on({}))).page, 'control: the alias user keeps the page');
});

// What each set grants, as the org answers the five content queries and the name lookups for its setup entities. A name
// lookup is answered as the org does: only for the object's own key column and fields, and an id matches on its first 15
// characters. A wrong type, field or key gets no row (or throws), so a mapping that is wrong in the org goes red here.
const LOOKUP = { ApexClass: ['Id', 'NamespacePrefix', 'Name'], ApexPage: ['Id', 'NamespacePrefix', 'Name'], CustomPermission: ['Id', 'NamespacePrefix', 'DeveloperName'], FlowDefinitionView: ['DurableId', 'NamespacePrefix', 'ApiName'], AppMenuItem: ['ApplicationId', 'NamespacePrefix', 'Name'] };
function grants(t, rows) {
  const asked = [];
  t.mock.method(api, 'call', async (s, path) => {
    const q = decodeURIComponent(path);
    asked.push(q);
    const from = /FROM (\w+)/.exec(q)[1];
    const fields = LOOKUP[from];
    if (!fields) return { records: (rows[from] || []).filter((r) => !r.ParentId || q.includes(r.ParentId) || from === 'PermissionSet') };
    const [, select, key, list] = /SELECT (.+) FROM \w+ WHERE (\w+) IN \((.*)\)$/.exec(q);
    const wanted = list.split(', ').map((id) => id.slice(1, -1).slice(0, 15));
    for (const f of select.split(', ')) assert.ok(fields.includes(f), `${from} has no field ${f}`);
    assert.equal(key, fields[0], `${from} is keyed by ${fields[0]}`);
    return { records: (rows[from] || []).filter((r) => wanted.includes(r[key]?.slice(0, 15))).map((r) => Object.fromEntries(select.split(', ').map((f) => [f, r[f]]))) };
  });
  return asked;
}
// As the sfui-fixture scratch org answered on 2026-11-09: a flow is type FlowDefinition and an app an 18-character id.
const GRANTS = {
  ObjectPermissions: [{ ParentId: '0PS1', SobjectType: 'Probe__c', PermissionsRead: true, PermissionsEdit: false }],
  FieldPermissions: [{ ParentId: '0PS1', Field: 'Probe__c.Size__c', PermissionsRead: true, PermissionsEdit: true }],
  PermissionSetTabSetting: [{ ParentId: '0PS1', Name: 'Probe__c', Visibility: 'DefaultOn' }],
  SetupEntityAccess: [{ ParentId: '0PS1', SetupEntityType: 'ApexClass', SetupEntityId: '01pA' }, { ParentId: '0PS1', SetupEntityType: 'TabSet', SetupEntityId: '02uC1000001Cv0LIAS' }, { ParentId: '0PS1', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR4IAJ' }],
  PermissionSet: [{ Id: '0PS1', Name: 'Probe', PermissionsApiEnabled: true, PermissionsViewSetup: false }],
  ApexClass: [{ Id: '01pA', Name: 'ProbeController', NamespacePrefix: null }],
  FlowDefinitionView: [{ DurableId: '300C100000K6iR4IAJ', ApiName: 'Probe_Flow', NamespacePrefix: null }],
  AppMenuItem: [{ ApplicationId: '02uC1000001Cv0L', Name: 'Probe_App', NamespacePrefix: null }], // 15 characters, to prove the match
};

test('a permission set hashes what it grants, by name, never by id', async (t) => {
  grants(t, GRANTS);
  const [base] = Object.values(await validity.permSetHashes({}, { Probe: '0PS1' }));
  const again = () => validity.permSetHashes({}, { Probe: '0PS1' }).then((h) => h.Probe);
  const differs = async (what, rows) => { grants(t, { ...GRANTS, ...rows }); assert.notEqual(await again(), base, what); };
  grants(t, { ...GRANTS, ApexClass: [{ ...GRANTS.ApexClass[0], Id: '01pB' }], SetupEntityAccess: [{ ...GRANTS.SetupEntityAccess[0], SetupEntityId: '01pB' }, ...GRANTS.SetupEntityAccess.slice(1)], ObjectPermissions: [{ ...GRANTS.ObjectPermissions[0] }] });
  assert.equal(await again(), base, 'control: other ids, the same grants');
  await differs('an object permission', { ObjectPermissions: [{ ...GRANTS.ObjectPermissions[0], PermissionsEdit: true }] });
  await differs('a field permission', { FieldPermissions: [{ ...GRANTS.FieldPermissions[0], PermissionsEdit: false }] });
  await differs('a tab', { PermissionSetTabSetting: [{ ...GRANTS.PermissionSetTabSetting[0], Visibility: 'Hidden' }] });
  await differs('a class by name', { ApexClass: [{ ...GRANTS.ApexClass[0], Name: 'Other' }] });
  await differs('a flow by name', { FlowDefinitionView: [{ ...GRANTS.FlowDefinitionView[0], ApiName: 'Other_Flow' }] });
  await differs('an app by name', { AppMenuItem: [{ ...GRANTS.AppMenuItem[0], Name: 'Other_App' }] });
  await differs('a system permission', { PermissionSet: [{ ...GRANTS.PermissionSet[0], PermissionsViewSetup: true }] });
});

test('a set hashes View All Fields, read at API 63.0 where the column exists, and every other query at the pinned version', async (t) => {
  const asked = grants(t, GRANTS);
  const versions = {};
  const base = (await validity.permSetHashes({}, { Probe: '0PS1' })).Probe;
  for (const c of api.call.mock.calls) versions[/FROM (\w+)/.exec(decodeURIComponent(c.arguments[1]))[1]] = c.arguments[0].apiVersion;
  assert.match(asked.find((q) => q.includes('FROM ObjectPermissions')), /PermissionsViewAllFields/);
  assert.equal(versions.ObjectPermissions, '63.0');
  assert.deepEqual(Object.entries(versions).filter(([from]) => from !== 'ObjectPermissions').map(([, v]) => v).filter((v) => v !== '60.0'), [], JSON.stringify(versions));
  grants(t, { ...GRANTS, ObjectPermissions: [{ ...GRANTS.ObjectPermissions[0], PermissionsViewAllFields: true }] });
  assert.notEqual((await validity.permSetHashes({}, { Probe: '0PS1' })).Probe, base, 'a set that gains View All Fields reads as changed');
});

// A retry's sleep runs on mock timers (slow), so no test pays a real second: flush lets the code reach it, ticking lets it pass.
const httpError = (status) => new SfUiError('API_ERROR', `answered ${status}`, { status });
const flush = () => new Promise((done) => setImmediate(done));
const slow = (t) => t.mock.timers.enable({ apis: ['setTimeout'] });
const ticking = async (t, p) => {
  let over = false;
  p.then(() => { over = true; }, () => { over = true; });
  while (!over) { await flush(); t.mock.timers.tick(1000); }
  return p;
};

test('a name lookup that fails leaves unhashed only the sets that grant that type', async (t) => {
  const two = { ...GRANTS, PermissionSet: [...GRANTS.PermissionSet, { Id: '0PS2', Name: 'Plain' }], ObjectPermissions: [...GRANTS.ObjectPermissions, { ParentId: '0PS2', SobjectType: 'Other__c', PermissionsRead: true }] };
  grants(t, two);
  slow(t);
  const whole = await validity.permSetHashes({}, { Probe: '0PS1', Plain: '0PS2' });
  const fake = api.call;
  t.mock.method(api, 'call', async (s, path) => { if (decodeURIComponent(path).includes('FROM FlowDefinitionView')) throw httpError(503); return fake(s, path); });
  assert.deepEqual(await ticking(t, validity.permSetHashes({}, { Probe: '0PS1', Plain: '0PS2' })), { Plain: whole.Plain }, 'the set with a flow is left out, the other is hashed as before');
});

test('a name lookup that fails makes the set unchecked, never gone and never stale', async (t) => {
  const access = [{ ParentId: '0PS2', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR4IAJ' }];
  liveOrg(t, { access });
  const persona = { profile: 'P', permissionSets: ['SfUi_Probe_Read'], permissionSetHashes: await validity.permSetHashes({}, { SfUi_Probe_Read: '0PS2' }) };
  assert.equal((await validity.check({}, { persona })).state, 'valid', 'control: with the lookup answering');
  liveOrg(t, { access, lookupFails: true });
  slow(t);
  assert.deepEqual(await ticking(t, validity.check({}, { persona })), { state: 'unknown', unchecked: ['persona profile P, saved with no hash', 'persona permission set SfUi_Probe_Read, a name lookup failed'] });
});

test('renaming one flow changes only the sets that grant it', async (t) => {
  const both = { ...GRANTS, PermissionSet: [...GRANTS.PermissionSet, { Id: '0PS2', Name: 'Other' }], SetupEntityAccess: [...GRANTS.SetupEntityAccess, { ParentId: '0PS2', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR5IAJ' }], FlowDefinitionView: [...GRANTS.FlowDefinitionView, { DurableId: '300C100000K6iR5IAJ', ApiName: 'Other_Flow', NamespacePrefix: null }] };
  const read = async (rows) => { grants(t, rows); return validity.permSetHashes({}, { Probe: '0PS1', Other: '0PS2' }); };
  const was = await read(both);
  const renamed = await read({ ...both, FlowDefinitionView: [{ ...both.FlowDefinitionView[0], ApiName: 'Renamed' }, both.FlowDefinitionView[1]] });
  assert.notEqual(renamed.Probe, was.Probe);
  assert.equal(renamed.Other, was.Other, 'the set that does not grant it is untouched');
});

test('a set that grants something else under its old name reads as changed; no saved hash says nothing', () => {
  const as = (hashes) => ({ persona: { ...PERSONA, ...(hashes && { permissionSetHashes: hashes }) } });
  const was = { SfUi_Probe_Read: 'a1', ns__Extra: 'b1' };
  assert.deepEqual(validity.changed(as(was), as(was)), [], 'control: the same grants');
  assert.deepEqual(validity.changed(as(was), as({ ...was, ns__Extra: 'b2' })), ['persona permission set ns__Extra']);
  assert.deepEqual(validity.changed(as(null), as({ ...was, ns__Extra: 'b2' })), [], 'a route saved before sets were hashed');
});

test('a set whose field permissions span pages is read whole', async (t) => {
  const asked = [];
  const field = (n) => ({ ParentId: '0PS1', Field: `Probe__c.F${n}__c`, PermissionsRead: true });
  t.mock.method(api, 'call', async (s, path) => {
    asked.push(path);
    if (path.startsWith('/query/01g')) return { records: [field(2)] };
    if (decodeURIComponent(path).includes('FROM FieldPermissions')) return { records: [field(1)], nextRecordsUrl: '/services/data/v60.0/query/01gNEXT-2000' };
    return { records: [] };
  });
  const both = (await validity.permSetHashes({}, { Probe: '0PS1' })).Probe;
  assert.ok(asked.includes('/query/01gNEXT-2000'), 'the next page is asked for under /query');
  t.mock.method(api, 'call', async (s, path) => ({ records: decodeURIComponent(path).includes('FROM FieldPermissions') ? [field(1)] : [] }));
  assert.notEqual((await validity.permSetHashes({}, { Probe: '0PS1' })).Probe, both, 'control: the first page alone hashes otherwise');
});

// An org for check: tooling answers each type's Metadata, the PermissionSet list names the sets, the rest are grants.
test('a name lookup that fails for the profile\'s own set lists the profile unchecked, as it does a set', async (t) => {
  const access = [{ ParentId: '0PSP', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR4IAJ' }];
  liveOrg(t, { access });
  const persona = { profile: 'P', permissionSets: [], permissionSetHashes: await validity.permSetHashes({}, { [validity.PROFILE]: '0PSP' }) };
  assert.deepEqual(await validity.check({}, { persona }), { state: 'valid' }, 'control: with the lookup answering');
  liveOrg(t, { access, lookupFails: true });
  slow(t);
  assert.deepEqual(await ticking(t, validity.check({}, { persona })), { state: 'unknown', unchecked: ['persona profile P, a name lookup failed'] });
});

function liveOrg(t, { app = { label: 'A' }, flexi = { regions: 1 }, sets = { SfUi_Probe_Read: '0PS2' }, edit = false, access = [], lookupFails = false, profile = '0PSP', profileEdit = false } = {}) {
  const asked = [];
  t.mock.method(api, 'call', async (s, path) => {
    const q = decodeURIComponent(path);
    asked.push(q);
    if (lookupFails && q.includes('FROM FlowDefinitionView')) throw httpError(503);
    if (q.includes('FROM SetupEntityAccess')) return { records: access };
    if (q.includes('FROM CustomApplication')) return { records: app ? [{ Metadata: app }] : [] };
    if (q.includes('FROM FlexiPage')) return { records: flexi ? [{ Metadata: flexi }] : [] };
    if (q.includes('FROM PermissionSet WHERE IsOwnedByProfile = true')) return { records: profile ? [{ Id: profile }] : [] };
    if (q.includes('FROM PermissionSet WHERE (Name IN')) return { records: Object.entries(sets).map(([Name, Id]) => (Name.startsWith('group:') ? { Id, Name: 'X0P', PermissionSetGroup: { DeveloperName: Name.slice(6) } } : { Id, Name })) };
    if (q.includes('FROM ObjectPermissions')) return { records: [{ ParentId: '0PS2', SobjectType: 'Probe__c', PermissionsRead: true, PermissionsEdit: edit }, ...(q.includes('0PG9') ? [{ ParentId: '0PG9', SobjectType: 'Other__c', PermissionsRead: true }] : []), ...(q.includes('0PSP') ? [{ ParentId: '0PSP', SobjectType: 'Account', PermissionsRead: true, PermissionsEdit: profileEdit }] : [])] };
    return { records: [] };
  });
  return asked;
}
const CHECKED = { app: { name: 'A', hash: validity.hash({ label: 'A' }) }, page: { object: 'Probe__c', flexiPage: 'P', flexiPageHash: validity.hash({ regions: 1 }), formHash: 'f1' } };
const asPersona = async (t, edit = false) => { liveOrg(t, { edit }); return { profile: 'P', permissionSets: ['SfUi_Probe_Read'], permissionSetHashes: await validity.permSetHashes({}, { SfUi_Probe_Read: '0PS2' }) }; };

test('check reads app and FlexiPage from the org before a run: valid, or stale with what changed', async (t) => {
  liveOrg(t);
  assert.deepEqual(await validity.check({}, CHECKED), { state: 'valid', unchecked: ['form of Probe__c, read where the route ends'] });
  liveOrg(t, { flexi: { regions: 2 } });
  assert.deepEqual((await validity.check({}, CHECKED)).stale, ['FlexiPage P']);
  liveOrg(t, { flexi: null });
  assert.deepEqual((await validity.check({}, CHECKED)).stale, ['FlexiPage P is gone']);
  liveOrg(t, { app: { label: 'B' } });
  assert.deepEqual(await validity.check({}, { app: CHECKED.app }), { state: 'stale', stale: ['app A'] });
  liveOrg(t, { app: null });
  assert.deepEqual(await validity.check({}, { app: CHECKED.app }), { state: 'stale', stale: ['app A is gone'] });
});

test('guarded: an org error or a validity it cannot read runs the route as unknown, and a bug throws', async (t) => {
  t.mock.method(validity, 'check', async () => { throw new SfUiError('API_ERROR', 'org said no'); });
  assert.deepEqual(await validity.guarded({}, CHECKED), { state: 'unknown', unchecked: ['the check failed: API_ERROR: org said no'] });
  validity.check.mock.mockImplementation(async () => { throw new TypeError('a bug'); });
  await assert.rejects(validity.guarded({}, CHECKED), TypeError);
  validity.check.mock.mockImplementation(async (s, saved) => ({ state: 'valid', saved }));
  assert.deepEqual(await validity.guarded({}, { persona: { profile: 'X' } }), { state: 'unknown', unchecked: ['the saved validity is not a shape this version reads'] }, 'a persona with no sets would make check throw');
  assert.equal(validity.check.mock.callCount(), 2, 'and the check is not asked');
  assert.equal((await validity.guarded({}, CHECKED)).state, 'valid', 'control: a readable validity is checked');
  assert.equal((await validity.guarded({}, null)).saved, undefined, 'null is no validity, asked as such');
  validity.check.mock.mockImplementation(async () => ({ state: 'unknown', unchecked: ['why'] }));
  assert.deepEqual((await validity.guarded({}, CHECKED)).unchecked, ['why'], 'the reason check gave on an unknown passes through unchanged');
});

test('check with nothing saved is unknown, never valid', async (t) => {
  const asked = liveOrg(t);
  for (const saved of [undefined, null, {}]) assert.deepEqual(await validity.check({}, saved), { state: 'unknown', unchecked: ['no validity saved'] });
  assert.equal(asked.length, 0, 'and asks the org nothing');
});

test('check reads each persona permission set by its content: changed, gone, or saved with no hash', async (t) => {
  const persona = await asPersona(t);
  liveOrg(t);
  assert.deepEqual(await validity.check({}, { persona }), { state: 'valid', unchecked: ['persona profile P, saved with no hash'] }, 'control: the same grants; saved before the profile was hashed');
  liveOrg(t, { edit: true });
  assert.deepEqual(await validity.check({}, { persona }), { state: 'stale', stale: ['persona permission set SfUi_Probe_Read'], unchecked: ['persona profile P, saved with no hash'] });
  liveOrg(t, { sets: {} });
  assert.deepEqual((await validity.check({}, { persona })).stale, ['persona permission set SfUi_Probe_Read is gone']);
  liveOrg(t, { edit: true });
  const { permissionSetHashes, ...old } = persona;
  assert.deepEqual(await validity.check({}, { persona: old }), { state: 'unknown', unchecked: ['persona permission set SfUi_Probe_Read, saved with no hash'] }, 'a route saved before sets were hashed compares nothing');
  assert.equal((await validity.check({}, { ...CHECKED, persona: old })).state, 'valid', 'control: with a FlexiPage to compare it is valid for that');
  assert.deepEqual(await validity.check({}, { page: { object: 'Probe__c', formHash: 'f1' } }), { state: 'unknown', unchecked: ['form of Probe__c, read where the route ends'] }, 'a page on a layout, with no FlexiPage hash');
});

test('a persona saved with its profile\'s own set hash is stale when the profile changes or is gone', async (t) => {
  const asked = liveOrg(t);
  const persona = { profile: 'P', permissionSets: ['SfUi_Probe_Read'], permissionSetHashes: await validity.permSetHashes({}, { SfUi_Probe_Read: '0PS2', [validity.PROFILE]: '0PSP' }) };
  assert.deepEqual(await validity.check({}, { persona }), { state: 'valid' }, 'control: nothing changed, and nothing left unchecked');
  assert.match(asked.find((q) => q.includes('IsOwnedByProfile = true')), /AND Profile.Name = 'P'$/);
  liveOrg(t, { profileEdit: true });
  assert.deepEqual(await validity.check({}, { persona }), { state: 'stale', stale: ['persona profile P'] });
  liveOrg(t, { profile: null });
  assert.deepEqual((await validity.check({}, { persona })).stale, ['persona profile P is gone']);
  const now = await (liveOrg(t, { profileEdit: true }), validity.permSetHashes({}, { [validity.PROFILE]: '0PSP' }));
  assert.deepEqual(validity.changed({ persona }, { persona: { ...persona, permissionSetHashes: { ...persona.permissionSetHashes, ...now } } }), ['persona profile P'], 'and at the route\'s end');
});

test('a persona read hashes the user\'s profile\'s own set beside its sets, and a failed lookup costs the hashes, not the persona', async (t) => {
  const withProfile = (q) => (q.includes('FROM User') ? [{ ProfileId: '00eP', Profile: { Name: PERSONA.profile } }]
    : q.includes('IsOwnedByProfile = true') ? (q.includes("ProfileId = '00eP'") ? [{ Id: '0PSP' }] : [])
      : q.includes('FROM ObjectPermissions') ? [{ ParentId: '0PSP', SobjectType: 'Account', PermissionsRead: true }] : people(q));
  personaOrg(t, withProfile);
  const p = (await validity.read(on({ loggedInAs: '005a' }))).persona;
  assert.deepEqual(named(p), PERSONA, 'the profile\'s set is no part of the key');
  assert.ok(p.permissionSetHashes[validity.PROFILE], JSON.stringify(p.permissionSetHashes));
  personaOrg(t, (q) => { if (q.includes('IsOwnedByProfile = true')) throw new SfUiError('API_ERROR', 'no'); return withProfile(q); });
  const lost = (await validity.read(on({ loggedInAs: '005b' }))).persona;
  assert.deepEqual([named(lost), 'permissionSetHashes' in lost], [PERSONA, false]);
});

test('a persona with no sets, and no app or page, is unknown and says why', async () => {
  const { state, unchecked } = await validity.check({}, { persona: { profile: 'P', permissionSets: [] } });
  assert.deepEqual([state, unchecked.length], ['unknown', 1], 'a reason, never an unknown with none');
  assert.match(unchecked[0], /nothing saved has a hash/);
});

test('a persona whose set hashes fail or come late keeps its sets, with no hashes', async (t) => {
  const failing = (q) => { if (/FROM (ObjectPermissions|FieldPermissions|PermissionSetTabSetting|SetupEntityAccess|PermissionSet WHERE)/.test(q)) throw new SfUiError('API_ERROR', 'no'); return people(q); };
  personaOrg(t, failing);
  const p = (await validity.read(on({ loggedInAs: '005a' }))).persona;
  assert.deepEqual([named(p), 'permissionSetHashes' in p], [PERSONA, false]);
  personaOrg(t, people);
  assert.ok((await validity.read(on({ loggedInAs: '005b' }))).persona.permissionSetHashes, 'control: hashes when the org answers');
});

test('a persona whose set hashes never come is left without them after the wait, and read again, not kept hashless', { timeout: 5000 }, async (t) => {
  let stuck = true;
  t.mock.method(api, 'call', async (s, path) => {
    const q = decodeURIComponent(path);
    if (stuck && q.includes('FROM ObjectPermissions')) return new Promise(() => {});
    return { records: people(q) };
  });
  const s = { loggedInAs: '005a' };
  const late = await validity.personaOf(s, false, 20);
  assert.deepEqual([named(late), 'permissionSetHashes' in late], [PERSONA, false]);
  stuck = false;
  assert.ok((await validity.personaOf(s, false, 20)).permissionSetHashes, 'the hashless persona was not kept for the session');
  const count = api.call.mock.callCount();
  await validity.personaOf(s, false, 20);
  assert.equal(api.call.mock.callCount(), count, 'control: a persona with hashes is kept');
});

// The org as grants() has it, except that the queries matching `from` fail with the next of `errors`, then answer.
function flaky(t, from, errors) {
  grants(t, GRANTS);
  const real = api.call;
  const left = [...errors];
  let asked = 0;
  t.mock.method(api, 'call', async (s, path) => {
    if (decodeURIComponent(path).includes(`FROM ${from} `)) { asked++; if (left.length) throw left.shift(); }
    return real(s, path);
  });
  return () => asked;
}
const probeHashes = () => validity.permSetHashes({}, { Probe: '0PS1' });

test('a name lookup that fails with a 5xx is retried once after a second, then the set is left out', async (t) => {
  grants(t, GRANTS);
  const whole = await probeHashes();
  const asked = flaky(t, 'FlowDefinitionView', [httpError(503)]);
  slow(t);
  const first = probeHashes();
  await flush();
  assert.equal(asked(), 1, 'the retry waits');
  t.mock.timers.tick(999);
  await flush();
  assert.equal(asked(), 1, 'a second has not passed');
  t.mock.timers.tick(1);
  assert.deepEqual(await first, whole, 'one failure, then whole');
  assert.equal(asked(), 2, 'exactly one extra query');
  const twice = flaky(t, 'FlowDefinitionView', [httpError(503), httpError(503)]);
  assert.deepEqual(await ticking(t, probeHashes()), {}, 'two failures leave the set out');
  assert.equal(twice(), 2, 'and no third query');
});

test('every validity query is retried, not only the name lookups: a 429 on a content query', async (t) => {
  grants(t, GRANTS);
  const whole = await probeHashes();
  const asked = flaky(t, 'ObjectPermissions', [httpError(429)]);
  slow(t);
  assert.deepEqual(await ticking(t, probeHashes()), whole);
  assert.equal(asked(), 2, 'one retry');
});

// The error api.call really throws for a network fault: fetchCoded's API_ERROR with the cause, no status.
const networkFault = async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); });
  const e = await fetchCoded('https://x.my.salesforce.com/services/data/v60.0/query').catch((x) => x);
  t.mock.restoreAll();
  return e;
};

test('a blip is a network fault, a 5xx or a 429; a TypeError and a 4xx are not', async (t) => {
  assert.equal(validity.transient(await networkFault(t)), true);
  assert.deepEqual([503, 429, 400, 403].map((n) => validity.transient(httpError(n))), [true, true, false, false]);
  assert.equal(validity.transient(new TypeError('x is not a function')), false, 'a bug is not tried again');
});

test('a transport fault is retried once, like a 5xx', async (t) => {
  const fault = await networkFault(t);
  assert.deepEqual([fault.code, fault.evidence], ['API_ERROR', { cause: 'UND_ERR_CONNECT_TIMEOUT' }], 'control: the shape the code produces');
  grants(t, GRANTS);
  const whole = await probeHashes();
  const asked = flaky(t, 'FlowDefinitionView', [fault]);
  slow(t);
  assert.deepEqual(await ticking(t, probeHashes()), whole);
  assert.equal(asked(), 2, 'one retry');
  const twice = flaky(t, 'FlowDefinitionView', [fault, fault]);
  assert.deepEqual(await ticking(t, probeHashes()), {}, 'control: a second fault leaves the set out');
  assert.equal(twice(), 2);
});

test('a 4xx is not retried: the same query would be refused again', async (t) => {
  for (const status of [400, 403, 414]) {
    const asked = flaky(t, 'FlowDefinitionView', [httpError(status), httpError(status)]);
    assert.deepEqual(await probeHashes(), {}, `${status} leaves the set out`);
    assert.equal(asked(), 1, `${status}: one query, no retry`);
  }
  const content = flaky(t, 'ObjectPermissions', [httpError(403), httpError(403)]);
  await assert.rejects(probeHashes(), /403/);
  assert.equal(content(), 1, 'a content query too');
});

test('a retry that wakes after the persona read gave up is not made', async (t) => {
  let flows = 0;
  personaOrg(t, (q) => {
    if (q.includes('FROM FlowDefinitionView')) { flows++; throw httpError(503); }
    if (q.includes('FROM SetupEntityAccess')) return [{ ParentId: '0PS1', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR4IAJ' }];
    return people(q);
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const read = validity.personaOf({ loggedInAs: '005a' }, false, 20);
  await flush();
  assert.equal(flows, 1, 'the first lookup failed and its retry sleeps');
  t.mock.timers.tick(20);
  assert.equal('permissionSetHashes' in await read, false, 'the read gave up at its 20 ms');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(flows, 1, 'the retry woke past the deadline and did not query');
});

test('a persona short of one set hash is kept with the gap, a whole one is kept at once', async (t) => {
  let flows = false;
  const answers = (q) => {
    if (q.includes('FROM FlowDefinitionView')) { if (!flows) throw httpError(503); return []; }
    if (q.includes('FROM SetupEntityAccess')) return [{ ParentId: '0PS1', SetupEntityType: 'FlowDefinition', SetupEntityId: '300C100000K6iR4IAJ' }];
    return people(q);
  };
  personaOrg(t, answers);
  slow(t);
  const calls = () => api.call.mock.callCount();
  const s = { loggedInAs: '005a' };
  assert.deepEqual(Object.keys((await ticking(t, validity.personaOf(s, false))).permissionSetHashes), ['SfUi_Probe_Read'], 'the set that grants a flow is left out');
  const kept = calls();
  flows = true;
  assert.deepEqual(Object.keys((await validity.personaOf(s, false)).permissionSetHashes), ['SfUi_Probe_Read'], 'the gap is kept, though the org would now answer whole');
  assert.equal(calls(), kept, 'a later personaOf makes no API call');
  const t2 = { loggedInAs: '005b' };
  assert.deepEqual(Object.keys((await validity.personaOf(t2, false)).permissionSetHashes).sort(), ['SfUi_Probe_Read', 'ns__Extra'], 'control: a fresh session reads it whole');
  const whole = calls();
  await validity.personaOf(t2, false);
  assert.equal(calls(), whole, 'control: the whole persona is kept at once');
});

test('check asks for the saved sets by name, and a set and a group of one name hash together', async (t) => {
  const persona = await asPersona(t);
  const asked = liveOrg(t);
  await validity.check({}, { persona });
  assert.match(asked.find((q) => q.includes('FROM PermissionSet WHERE')), /Name IN \('SfUi_Probe_Read'\) OR PermissionSetGroup.DeveloperName IN \('SfUi_Probe_Read'\)/, 'not every set in the org');
  const sets = { SfUi_Probe_Read: '0PS2', 'group:SfUi_Probe_Read': '0PG9' };
  liveOrg(t, { sets });
  const together = { ...persona, permissionSetHashes: await validity.permSetHashes({}, { SfUi_Probe_Read: ['0PS2', '0PG9'] }) };
  assert.notEqual(together.permissionSetHashes.SfUi_Probe_Read, persona.permissionSetHashes.SfUi_Probe_Read, 'control: the group adds a grant');
  assert.deepEqual(await validity.check({}, { persona: together }), { state: 'valid', unchecked: ['persona profile P, saved with no hash'] }, 'the group of that name is hashed with the set, not instead of it');
});

test('a persona that holds only the set, or only the group, of one name is not stale because the other exists', async (t) => {
  const sets = { SfUi_Probe_Read: '0PS2', 'group:SfUi_Probe_Read': '0PG9' };
  liveOrg(t, { sets });
  const [set, group, both] = await Promise.all(['0PS2', '0PG9', ['0PS2', '0PG9']].map((held) => validity.permSetHashes({}, { SfUi_Probe_Read: held }).then((h) => h.SfUi_Probe_Read)));
  assert.equal(new Set([set, group, both]).size, 3, 'control: the three differ');
  const persona = (h) => ({ persona: { profile: 'P', permissionSets: ['SfUi_Probe_Read'], permissionSetHashes: { SfUi_Probe_Read: h } } });
  for (const [what, h] of [['the set', set], ['the group', group], ['both', both]]) assert.deepEqual(await validity.check({}, persona(h)), { state: 'valid', unchecked: ['persona profile P, saved with no hash'] }, `held: ${what}`);
  assert.deepEqual((await validity.check({}, persona('0000000000000'))).stale, ['persona permission set SfUi_Probe_Read'], 'control: a hash none of them gives is stale');
  liveOrg(t, { sets, edit: true });
  assert.deepEqual((await validity.check({}, persona(set))).stale, ['persona permission set SfUi_Probe_Read'], 'control: a changed set is still stale');
});

test('check gives up on an org that does not answer, and looks up no FlexiPage it has no name for', async (t) => {
  const asked = liveOrg(t);
  assert.deepEqual(await validity.check({}, { page: { object: 'Probe__c', flexiPageHash: 'h', formHash: 'f' } }), { state: 'unknown', unchecked: ['form of Probe__c, read where the route ends'] });
  assert.equal(asked.length, 0, 'a hash with no FlexiPage name asks nothing');
  t.mock.method(api, 'call', () => new Promise(() => {}));
  assert.deepEqual(await validity.check({}, CHECKED, 50), { state: 'unknown', unchecked: ['the org did not answer the check in 0.05 s'] });
});
