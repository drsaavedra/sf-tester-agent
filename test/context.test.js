'use strict';

// objectContext: the Salesforce facts a QA new to the platform cannot see on the page. No org: canned API answers
// prove how access merges across a user's profile and permission sets; on the fixture org, a read-only persona
// against the admin, and the fixture's own validation rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, discover, session } = require('..');
const { auth, env, skip } = require('./helpers');

test('objectContext merges access across permission sets, lets a required field follow the object, and lists what runs on save', async (t) => {
  const [real, realAlias] = [api.call, session.aliasUsername];
  t.after(() => { api.call = real; session.aliasUsername = realAlias; });
  session.aliasUsername = async (a) => a; // no sf CLI here: a username is its own alias
  const answers = [
    [/FROM User WHERE Username = 'qa@x'/, { records: [{ Id: '005QA' }] }],
    [/FROM User WHERE Username = 'nobody@x'/, { records: [] }],
    [/FROM FieldPermissions .*AssigneeId = '005QA'/, { records: [
      { Field: 'SfUiProbe__c.Count__c', PermissionsRead: true, PermissionsEdit: false },
      { Field: 'SfUiProbe__c.Count__c', PermissionsRead: true, PermissionsEdit: true },
    ] }],
    [/FROM ObjectPermissions .*AssigneeId = '005QA'/, { records: [
      { PermissionsCreate: false, PermissionsRead: true, PermissionsEdit: false, PermissionsDelete: false },
      { PermissionsCreate: false, PermissionsRead: true, PermissionsEdit: true, PermissionsDelete: false },
    ] }],
    [/FROM EntityParticle .*IsPermissionable = true/, { records: [{ QualifiedApiName: 'Count__c' }, { QualifiedApiName: 'Kind__c' }] }],
    [/^\/ui-api\/object-info\/SfUiProbe__c$/, { label: 'SF UI Probe', fields: { Count__c: { label: 'Count', required: false }, Tags__c: { label: 'Tags', required: true }, Kind__c: { label: 'Kind', required: false } } }],
    [/FROM ValidationRule/, { records: [{ ValidationName: 'SfUi_Count_Not_Negative', ErrorDisplayField: 'Count__c', ErrorMessage: 'Count cannot be negative' }] }],
    [/FROM ApexTrigger WHERE TableEnumOrId = 'SfUiProbe__c'$/, { records: [{ Name: 'ProbeTrigger', Status: 'Active' }] }],
    [/FROM FlowDefinitionView WHERE IsActive = true AND TriggerObjectOrEvent.QualifiedApiName = 'SfUiProbe__c'$/, { records: [{ ApiName: 'Probe_Before', Label: 'Probe Before', TriggerType: 'RecordBeforeSave', RecordTriggerType: 'CreateAndUpdate' }] }],
  ];
  api.call = async (s, p) => {
    const path = decodeURIComponent(p).replace(/\+/g, ' ');
    const hit = answers.find(([re]) => re.test(path));
    if (!hit) throw new Error(`unexpected call ${path}`);
    return hit[1];
  };

  const ctx = await discover.objectContext({}, 'SfUiProbe__c', { users: ['qa@x'], fields: ['Count__c', 'Tags__c', 'Kind__c'] });
  assert.equal(ctx.label, 'SF UI Probe');
  assert.deepEqual(ctx.access['qa@x'].object, { create: false, read: true, edit: true, delete: false }, 'any grant wins');
  assert.deepEqual(ctx.access['qa@x'].fields, {
    Count__c: { read: true, edit: true },
    Tags__c: { read: true, edit: true, required: true },
    Kind__c: { read: false, edit: false },
  });
  assert.deepEqual(ctx.onSave, {
    validationRules: [{ name: 'SfUi_Count_Not_Negative', field: 'Count__c', message: 'Count cannot be negative' }],
    triggers: [{ name: 'ProbeTrigger', status: 'Active' }],
    flows: [{ name: 'Probe_Before', label: 'Probe Before', when: 'RecordBeforeSave', on: 'CreateAndUpdate' }],
  });
  await assert.rejects(discover.objectContext({}, 'SfUiProbe__c', { users: ['nobody@x'] }), { code: 'USER_NOT_FOUND' });
  // A field the object does not have is refused by name, not given the object's access.
  await assert.rejects(discover.objectContext({}, 'SfUiProbe__c', { users: ['qa@x'], fields: ['Count__c', 'Typo_Not_A_Field__c'] }),
    (e) => e.code === 'NOT_FOUND' && e.evidence.fields.join() === 'Typo_Not_A_Field__c' && /Typo_Not_A_Field__c/.test(e.message));
});

// No org: a grant on the second page of rows counts, as the org pages field permissions at 2,000 rows.
test('objectContext reads every page of a query', async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  const paths = [];
  api.call = async (s, p) => {
    const path = decodeURIComponent(p);
    paths.push(path);
    if (path === '/query/01gNEXT-2000') return { done: true, records: [{ Field: 'Account.Phone', PermissionsRead: true, PermissionsEdit: true }] };
    if (/FROM FieldPermissions/.test(path)) return { done: false, nextRecordsUrl: '/services/data/v62.0/query/01gNEXT-2000', records: [{ Field: 'Account.Fax', PermissionsRead: true, PermissionsEdit: false }] };
    if (/FROM EntityParticle/.test(path)) return { records: [{ QualifiedApiName: 'Phone' }, { QualifiedApiName: 'Fax' }] };
    if (path.startsWith('/ui-api/object-info/')) return { label: 'Account', fields: { Phone: {}, Fax: {} } };
    return { records: [] };
  };
  const ctx = await discover.objectContext({}, 'Account', { users: ['005000000000001AAA'], fields: ['Phone', 'Fax'] });
  assert.deepEqual(ctx.access['005000000000001AAA'].fields, { Phone: { read: true, edit: true }, Fax: { read: true, edit: false } });
  assert.ok(paths.includes('/query/01gNEXT-2000'), 'the next page is read under the API root');
});

// No org: the paging is validity's, so a blip on a query (a 503 on the Tooling trigger read) is tried once more.
test('objectContext retries a query that failed with a 5xx once', async (t) => {
  const { SfUiError } = require('../src/errors');
  const real = api.call;
  t.after(() => { api.call = real; });
  let fails = 1;
  api.call = async (s, p) => {
    const path = decodeURIComponent(p);
    if (/FROM ApexTrigger/.test(path)) {
      if (fails-- > 0) throw new SfUiError('API_ERROR', 'answered 503', { status: 503 });
      assert.match(path, /^\/tooling\/query/, 'the Tooling read stays on the Tooling API');
      return { records: [{ Name: 'T', Status: 'Active' }] };
    }
    if (path.startsWith('/ui-api/object-info/')) return { label: 'Account', fields: { Phone: {} } };
    return { records: [] };
  };
  const ctx = await discover.objectContext({}, 'Account', { fields: ['Phone'] });
  assert.deepEqual(ctx.onSave.triggers, [{ name: 'T', status: 'Active' }]);
});

test('userId takes a User Id, a username or an sf CLI alias, and refuses a user the org does not have', async (t) => {
  const [realCall, realAlias] = [api.call, session.aliasUsername];
  t.after(() => { api.call = realCall; session.aliasUsername = realAlias; });
  session.aliasUsername = async (a) => (a === 'qa-alias' ? 'qa@x' : a);
  api.call = async (s, p) => ({ records: /Username = 'qa@x'/.test(decodeURIComponent(p)) ? [{ Id: '005QA' }] : [] });
  assert.equal(await discover.userId({}, '005000000000001'), '005000000000001');
  assert.equal(await discover.userId({}, '005000000000001AAA'), '005000000000001AAA');
  // A value that only starts 005 is looked up as a username, quote stripped, never sent on as an id.
  await assert.rejects(discover.userId({}, "005' OR AssigneeId != '"), { code: 'USER_NOT_FOUND' });
  assert.equal(await discover.userId({}, 'qa@x'), '005QA');
  assert.equal(await discover.userId({}, 'qa-alias'), '005QA', 'an alias resolves to its username first');
  await assert.rejects(discover.userId({}, 'nobody@x'), { code: 'USER_NOT_FOUND' });
  api.call = async () => ({ records: [{ Id: '005QA' }] });
  assert.equal(await discover.userId({}, '005qa@x.com'), '005QA', 'a username that starts 005 is looked up');
});

test('objectContext on the fixture: the read-only persona cannot edit Count, the admin can, and the validation rule is listed', { skip, timeout: 120_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const [persona] = (await api.call(s, `/query?q=${encodeURIComponent("SELECT Id FROM User WHERE FirstName = 'Probe' AND LastName = 'Platform' AND IsActive = true LIMIT 1")}`, { as: 'admin' })).records;
  const ctx = await discover.objectContext(s, 'SfUiProbe__c', { users: [persona.Id, s.tokenUserId], fields: ['Count__c', 'Name', 'CreatedDate'] });
  assert.deepEqual(ctx.access[persona.Id].fields.Count__c, { read: true, edit: false }, JSON.stringify(ctx.access[persona.Id]));
  assert.deepEqual(ctx.access[s.tokenUserId].fields.Count__c, { read: true, edit: true }, 'the admin is the control');
  // Name takes no field permission: it follows the object; a system field is read-only whoever edits the object.
  assert.deepEqual(ctx.access[persona.Id].fields.Name, { read: true, edit: false }, JSON.stringify(ctx.access[persona.Id]));
  assert.deepEqual(ctx.access[s.tokenUserId].fields.Name, { read: true, edit: true });
  assert.deepEqual(ctx.access[s.tokenUserId].fields.CreatedDate, { read: true, edit: false });
  assert.ok(ctx.onSave.validationRules.some((v) => v.name === 'SfUi_Count_Not_Negative'), JSON.stringify(ctx.onSave));
  // A custom object's trigger and record-triggered flow are found by its API name (its flow row holds the object's Id).
  const mapped = await discover.objectContext(s, 'S4Map_Item__c');
  assert.deepEqual([mapped.onSave.triggers.map((x) => x.name), mapped.onSave.flows.map((x) => x.name)], [['S4Map_ItemTrigger'], ['S4Map_Item_Flow']], JSON.stringify(mapped.onSave));
});
