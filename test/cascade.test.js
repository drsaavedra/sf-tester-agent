'use strict';

// The static map: what a changed LWC or Apex class could set off, read from source with no org.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const { scan, onSave } = require('../src/cascade');
const { resolveCI } = require('../src/verify');

const FIXTURE = path.join(__dirname, 'fixture');
const D = 'force-app/main/default/';
const RULE = 'objects/S4Map_Item__c/validationRules/S4Map_Qty_Not_Negative';
const gitOf = (changed) => (args) => { if (args.includes('--name-only')) return args.includes('HEAD') && !args.some((x) => x.includes('...')) ? '' : changed.join('\n'); throw new Error(`git ${args}`); };

// A copy of the fixture project the test may cut a link out of.
function copy(t, checks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(FIXTURE, 'force-app'), path.join(dir, 'force-app'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'sfdx-project.json'), path.join(dir, 'sfdx-project.json'));
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify({ checks: checks ?? JSON.parse(fs.readFileSync(path.join(FIXTURE, 'verify-checks.json'), 'utf8')).checks }));
  return dir;
}
async function plan(dir, changed) {
  const out = [];
  const code = await cli.main(['verify', '--plan', '--checks', path.join(dir, 'checks.json'), '--since', 'main'], { log: (l) => out.push(l), warn: (l) => out.push(l), git: gitOf(changed) });
  return { code, cascade: out.filter((l) => l.startsWith('cascade') || l.startsWith('NOTE cascade')), out };
}
const edit = (dir, rel, from, to) => { const f = path.join(dir, D, rel); const s = fs.readFileSync(f, 'utf8'); assert.ok(s.includes(from), `${rel} has ${from}`); fs.writeFileSync(f, s.replace(from, to)); };

// Written from the fixture's requirement: the panel saves an item through Apex, and the item has a rule, a trigger and a flow.
const VIA = 'cascade lwc/s4MapPanel > classes/S4Map_Controller > S4Map_Item__c';
const CHAIN = [VIA, `${VIA} > flows/S4Map_Item_Flow: GAP`, `${VIA} > ${RULE}: GAP`, `${VIA} > triggers/S4Map_ItemTrigger: GAP`,
  'cascade: 3 reachable, 3 gaps (a gap is a note, not a verdict)'];

test('--plan --since on the fixture prints the chain from the LWC to the rule, trigger and flow behind its Apex', async (t) => {
  const r = await plan(copy(t), [`${D}lwc/s4MapPanel/s4MapPanel.js`]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.cascade, CHAIN);
});

test('a changed class starts at the class, and a check covering the rule turns its line from GAP to covered', async (t) => {
  const checks = [{ id: 'qty', kind: 'record', requirement: 'r', covers: [RULE], persona: { profile: 'P', permissionSets: [] }, object: 'S4Map_Item__c',
    cases: [{ name: 'a', fields: { Name: 'v', Qty__c: -1 }, expect: { saves: false, error: 'e' } }, { name: 'b', fields: { Name: 'v' }, expect: { saves: true } }] }];
  const r = await plan(copy(t, checks), [`${D}classes/S4Map_Controller.cls`]);
  assert.deepEqual(r.cascade.slice(0, 3), ['cascade classes/S4Map_Controller > S4Map_Item__c', 'cascade classes/S4Map_Controller > S4Map_Item__c > flows/S4Map_Item_Flow: GAP', `cascade classes/S4Map_Controller > S4Map_Item__c > ${RULE}: covered by qty`]);
  assert.equal(r.cascade.at(-1), 'cascade: 3 reachable, 2 gaps (a gap is a note, not a verdict)');
});

test('red proof: cutting the import removes every line behind it', async (t) => {
  const dir = copy(t);
  edit(dir, 'lwc/s4MapPanel/s4MapPanel.js', "import saveItem from '@salesforce/apex/S4Map_Controller.saveItem';", 'const saveItem = () => 1;');
  assert.deepEqual((await plan(dir, [`${D}lwc/s4MapPanel/s4MapPanel.js`])).cascade, []);
});

test('red proof: cutting the DML removes the object and the items behind it, and an item file removes only itself', async (t) => {
  const dir = copy(t);
  edit(dir, 'classes/S4Map_Controller.cls', 'insert item;', 'item.Name = name;');
  assert.deepEqual((await plan(dir, [`${D}lwc/s4MapPanel/s4MapPanel.js`])).cascade, []);
  const dir2 = copy(t);
  fs.rmSync(path.join(dir2, D, 'triggers'), { recursive: true });
  assert.deepEqual((await plan(dir2, [`${D}lwc/s4MapPanel/s4MapPanel.js`])).cascade, CHAIN.filter((l) => !l.includes('triggers/')).map((l) => l.replace('3 reachable, 3 gaps', '2 reachable, 2 gaps')));
});

test('scan reads DML on typed variables, new, collections, Database calls and a SOQL delete, and ignores comments and strings', () => {
  const r = scan(`public class A {
    // insert new Ghost__c();
    void f(List<B__c> bs, Map<Id, C__c> cs, D__c[] ds) {
      String s = 'insert new Str__c();';
      insert bs; update cs.values(); Database.upsert(ds, false);
      Database.insert(new E__c(), false); insert new List<F__c>{ new F__c() };
      delete [SELECT Id FROM G__c WHERE Name = 'x'];
      List<H__c> hs = [SELECT Id FROM H__c];
    }
  }`);
  assert.deepEqual([...r.writes].sort(), ['B__c', 'C__c', 'D__c', 'E__c', 'F__c', 'G__c']);
  assert.deepEqual([...r.reads].sort(), ['G__c', 'H__c']);
  assert.deepEqual(r.limits, []);
});

test('scan names what it cannot type or follow as a limit', () => {
  const r = scan('public class A { void f(SObject o, Object p) { insert o; update p; Database.query(\'x\'); } }');
  assert.equal(r.writes.size, 0);
  assert.deepEqual(r.limits, ['insert on SObject', 'update on Object', 'dynamic Apex']);
});

test('onSave lists active rules, triggers and record-triggered flows of that object only', (t) => {
  const dir = copy(t);
  const proj = { root: dir, dirs: ['force-app'] };
  assert.deepEqual(onSave(proj, 'S4Map_Item__c', resolveCI), ['flows/S4Map_Item_Flow', RULE, 'triggers/S4Map_ItemTrigger']);
  assert.deepEqual(onSave(proj, 'SfUiProbe__c', resolveCI).filter((k) => k.startsWith('flows/') || k.startsWith('triggers/')), [], 'screen flows and other objects stay out');
  edit(dir, 'objects/S4Map_Item__c/validationRules/S4Map_Qty_Not_Negative.validationRule-meta.xml', '<active>true', '<active>false');
  edit(dir, 'triggers/S4Map_ItemTrigger.trigger-meta.xml', '<status>Active', '<status>Inactive');
  edit(dir, 'flows/S4Map_Item_Flow.flow-meta.xml', '<status>Active', '<status>Draft');
  assert.deepEqual(onSave(proj, 'S4Map_Item__c', resolveCI), []);
});

test('onSave reads the rules of every layout a package directory has, main/default and plain, each in its own case', (t) => {
  const proj = mini(t, { 'objects/Foo__c/validationRules/A.validationRule-meta.xml': RULE_ON });
  fs.mkdirSync(path.join(proj.root, 'force-app/objects/foo__c/validationRules'), { recursive: true });
  fs.writeFileSync(path.join(proj.root, 'force-app/objects/foo__c/validationRules/B.validationRule-meta.xml'), RULE_ON);
  assert.deepEqual(onSave(proj, 'Foo__c', resolveCI), ['objects/Foo__c/validationRules/A', 'objects/foo__c/validationRules/B']);
});

test('a class called one level deep adds its writes, its own calls are not followed but named as a limit, and a managed class or object is a limit', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-ns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, D, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, D, rel), body); };
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], namespace: 'ns', sourceApiVersion: '66.0' }));
  fs.writeFileSync(path.join(dir, 'checks.json'), '{"checks":[]}');
  put('lwc/panel/panel.js', "import a from '@salesforce/apex/ns.Foo.bar';\nimport b from '@salesforce/apex/other.Gone.run';");
  put('classes/Foo.cls', 'public class Foo { @AuraEnabled public static void bar() { Helper.go(); Spec.t(); insert new ns__Bar__c(); insert new other__Man__c(); } }');
  put('classes/Helper.cls', 'public class Helper { public static void go() { insert new ns__Baz__c(); Deep.go(); } }');
  put('classes/Spec.cls', '@IsTest public class Spec { static void t() { insert new Spec__c(); } }');
  put('classes/Deep.cls', 'public class Deep { public static void go() { insert new Deep__c(); } }');
  put('objects/Bar__c/validationRules/R.validationRule-meta.xml', '<active>true</active>');
  const r = await plan(dir, [`${D}lwc/panel/panel.js`]);
  assert.deepEqual(r.cascade, [
    'cascade lwc/panel > classes/ns__Foo > ns__Bar__c',
    'cascade lwc/panel > classes/ns__Foo > ns__Bar__c > objects/Bar__c/validationRules/R: GAP',
    'cascade lwc/panel > classes/ns__Foo > other__Man__c',
    'cascade lwc/panel > classes/ns__Foo > classes/Helper > ns__Baz__c',
    'cascade: 1 reachable, 1 gaps (a gap is a note, not a verdict)',
    'NOTE cascade limit: classes/Helper calls classes/Deep, not followed',
    'NOTE cascade limit: classes/other__Gone is not in this project (managed or missing), so its writes are not mapped',
    'NOTE cascade limit: other__Man__c is in a managed package, so its automation is not mapped',
  ]);
});

// Rows as the sfui-s4-map org returned them (assets/s4-static-map/mcd-rows.json), less the field links.
const MCD = [['ApexClass', 'S4Map_Controller', 'CustomObject', 'S4Map_Item'], ['ApexClass', 'SfUiProbeControllerTest', 'CustomObject', 'S4Map_Item'], ['ApexClass', 'SfUiProbeControllerTest', 'ApexClass', 'S4Map_Controller'],
  ['ApexTrigger', 'S4Map_ItemTrigger', 'CustomObject', 'S4Map_Item'], ['Flow', 'S4Map Item Flow', 'CustomObject', 'S4Map_Item'], ['LightningComponentBundle', 's4MapPanel', 'ApexClass', 'S4Map_Controller'],
  ['ValidationRule', 'S4Map_Qty_Not_Negative', 'CustomField', 'Qty']].map(([a, b, c, d]) => ({ MetadataComponentType: a, MetadataComponentName: b, RefMetadataComponentType: c, RefMetadataComponentName: d }));
const CROSS = ['NOTE cascade MetadataComponentDependency: 5 of 5 links agree'];

test('the dependency cross-check counts a rule as agreeing through its field (the table ties a rule to a CustomField, not its object) and names the link it lacks', async (t) => {
  const { cascade, crossCheck } = require('../src/cascade');
  const dir = copy(t);
  const proj = { root: dir, dirs: ['force-app'] };
  const { apexImports, classFile } = require('../src/verify');
  const m = cascade(proj, ['lwc/s4MapPanel'], { apexImports, classFile, resolveCI }, () => []);
  assert.deepEqual(crossCheck(m.edges, MCD), CROSS);
  assert.deepEqual(crossCheck(m.edges, MCD.filter((r) => r.MetadataComponentType !== 'ValidationRule')), ['NOTE cascade MetadataComponentDependency: 4 of 5 links agree', 'NOTE cascade MetadataComponentDependency has no ValidationRule S4Map_Qty_Not_Negative -> CustomField of S4Map_Item']);
  assert.ok(crossCheck(m.edges, MCD.filter((r) => r.MetadataComponentType !== 'ApexTrigger')).includes('NOTE cascade MetadataComponentDependency has no ApexTrigger S4Map_ItemTrigger -> CustomObject S4Map_Item'));
  const extra = { ...MCD[0], RefMetadataComponentName: 'Other' };
  assert.ok(crossCheck(m.edges, [...MCD, extra]).some((l) => l.includes('only: ApexClass S4Map_Controller -> CustomObject Other')));
});

// The org as the test plays it: Tooling lookups answer an id per name, and the dependency query is kept to see what it asked.
const IDS = { S4Map_Controller: '01pC', S4Map_ItemTrigger: '01qT', S4Map_Item_Flow: '301F', S4Map_Qty_Not_Negative: '03dR', s4MapPanel: '0RbL' };
const SELECT = 'SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency';
async function withOrg(t, rows) {
  const dir = copy(t);
  const out = [];
  const asked = [];
  const call = async (s, p) => {
    const q = decodeURIComponent(p.split('q=')[1]);
    asked.push(q);
    if (rows instanceof Error) throw rows;
    if (q.includes('FROM MetadataComponentDependency')) return { records: rows };
    return { records: Object.entries(IDS).filter(([n]) => q.includes(`'${n}'`)).map(([, Id]) => ({ Id })) };
  };
  await cli.main(['verify', '--org', 'x', '--checks', path.join(dir, 'checks.json'), '--since', 'main'], { log: (l) => out.push(l), warn: (l) => out.push(l), git: gitOf([`${D}lwc/s4MapPanel/s4MapPanel.js`]), connect: async () => ({ production: false, orgApiVersion: '68.0' }), api: { call }, sf: async () => '{}' });
  return { notes: out.filter((l) => l.startsWith('NOTE cascade MetadataComponentDependency')), asked };
}

test('a run with an org prints the cross-check after the chain, and a failed read is a note', async (t) => {
  assert.deepEqual((await withOrg(t, MCD)).notes, CROSS);
  assert.deepEqual((await withOrg(t, new Error('boom'))).notes, ['NOTE cascade MetadataComponentDependency could not be read: boom']);
});

test('the dependency query asks only for the components in the map, by id, because the table is cut at 2,000 rows', async (t) => {
  const { asked } = await withOrg(t, MCD);
  assert.equal(asked.at(-1), `${SELECT} WHERE MetadataComponentId IN ('01pC', '01qT', '301F', '03dR', '0RbL')`);
  assert.ok(asked.slice(0, -1).every((q) => /^SELECT Id FROM \w+ WHERE /.test(q)), asked.join('\n'));
});

test('a table cut at 2,000 rows prints no per-link "has no" line, since the row may be the cut one', async (t) => {
  const filler = Array.from({ length: 2000 }, (_, i) => ({ MetadataComponentType: 'ApexPage', MetadataComponentName: `P${i}`, RefMetadataComponentType: 'ApexClass', RefMetadataComponentName: 'X' }));
  assert.deepEqual((await withOrg(t, filler)).notes, ['NOTE cascade MetadataComponentDependency: 0 of 5 links agree (2,000 rows is its limit, so it may be cut)']);
});

test('mcdRows reports a cut only when one query hit 2,000 rows, and the cross-check follows that, not the summed row count', async (t) => {
  const { mcdRows, crossCheck } = require('../src/cascade');
  const edges = Array.from({ length: 150 }, (_, i) => ['ApexClass', `C${i}`, 'CustomObject', 'X']);
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ MetadataComponentType: 'ApexPage', MetadataComponentName: `P${i}`, RefMetadataComponentType: 'ApexClass', RefMetadataComponentName: 'X' }));
  const org = (sizes) => { let k = 0; return async (q) => (q.startsWith('SELECT Id') ? q.match(/'[^']*'/g).map((n) => ({ Id: n })) : filler(sizes[k++])); };
  const split = await mcdRows(org([1200, 900]), edges);
  assert.deepEqual([split.rows.length, split.cut], [2100, false]);
  const one = await mcdRows(org([2000, 5]), edges);
  assert.deepEqual([one.rows.length, one.cut], [2005, true]);
  const m = mapOf(mini(t, { 'classes/A.cls': 'public class A { void f() { insert new Foo__c(); } }' }), ['classes/A']);
  assert.deepEqual(crossCheck(m.edges, split.rows, split.cut), ['NOTE cascade MetadataComponentDependency: 0 of 1 links agree', 'NOTE cascade MetadataComponentDependency has no ApexClass A -> CustomObject Foo']);
  assert.deepEqual(crossCheck(m.edges, one.rows, one.cut), ['NOTE cascade MetadataComponentDependency: 0 of 1 links agree (2,000 rows is its limit, so it may be cut)']);
});

// A bare project the test writes by hand, and the map run over it with the real verify.js readers.
function mini(t, files, namespace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-mini-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], ...(namespace ? { namespace } : {}), sourceApiVersion: '66.0' }));
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, D, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, D, rel), body); }
  return { root: dir, dirs: ['force-app'], namespace };
}
const mapOf = (proj, starts) => { const v = require('../src/verify'); return require('../src/cascade').cascade(proj, starts, { apexImports: v.apexImports, classFile: v.classFile, resolveCI: v.resolveCI }, () => []); };

test('a changed class in a subfolder is an edge under its class name, not its folder path', (t) => {
  const proj = mini(t, { 'classes/svc/Foo.cls': 'public class Foo { void f() { insert new Bar__c(); } }' });
  const m = mapOf(proj, ['classes/svc/Foo']);
  assert.deepEqual(m.lines.slice(0, 1), ['cascade classes/svc/Foo > Bar__c']);
  assert.deepEqual(m.edges, [['ApexClass', 'Foo', 'CustomObject', 'Bar']]);
});

test('scan reads the type through an access mode: insert as user a is a write to a\'s type, not to User', () => {
  const r = scan('public class A { void f() { Account a = new Account(); insert as user a; update as system a; } }');
  assert.deepEqual([...r.writes], ['Account']);
  assert.deepEqual(r.limits, []);
});

test('scan counts a DML on a name as a write to every type that name has in the class', () => {
  const r = scan('public class A { void f() { Account rec = new Account(); insert rec; } void g() { Contact rec = new Contact(); insert rec; } }');
  assert.deepEqual([...r.writes].sort(), ['Account', 'Contact']);
  assert.deepEqual(r.limits, []);
});

test('scan drops a primitive or system type a reused name also had, and keeps every SObject type', () => {
  const r = scan('public class A { void f() { List<Account> recs = new List<Account>(); update recs; } void g() { List<String> recs = new List<String>(); Set<Id> ids; Date recs2; } void h() { Contact recs = new Contact(); } void i() { Decimal recs = 1; Datetime recs = null; Blob recs; Boolean recs; } }');
  assert.deepEqual([...r.writes], ['Account', 'Contact']);
  assert.deepEqual(r.limits, []);
});

test('scan treats DML on a member access as a target it cannot type, not as the wrapper class', () => {
  const r = scan('public class A { void f(Req req) { insert req.items; Database.update(req.rows, false); } }');
  assert.equal(r.writes.size, 0);
  assert.deepEqual(r.limits, ['insert on a variable the reader cannot type', 'Database.update on a variable the reader cannot type']);
});

test('scan types a method call on a collection variable as its element type, in any case, and leaves a method on anything else untyped', () => {
  const r = scan('public class A { void f(Map<Id, Account> m, List<Contact> cs, Opportunity[] os, LIST<Lead> ls, Req req, Id id) { update m.get(id); update cs.deepClone(); update m.Values(); insert os.clone(); delete ls.Clone(); update req.getItems(); } }');
  assert.deepEqual([...r.writes].sort(), ['Account', 'Contact', 'Lead', 'Opportunity']);
  assert.deepEqual(r.limits, ['update on a variable the reader cannot type']);
});

test('scan takes the outer FROM of inline SOQL, for a delete and for a read, past a semi-join or a child subquery', () => {
  const r = scan(`public class A { void f() {
    delete [SELECT Id FROM G__c WHERE Id IN (SELECT Parent__c FROM Y__c)];
    List<H__c> hs = [SELECT Id, (SELECT Id FROM Kids__r) FROM H__c WHERE Id NOT IN (SELECT Ref__c FROM Z__c)];
  } }`);
  assert.deepEqual([...r.writes], ['G__c']);
  assert.deepEqual([...r.reads].sort(), ['G__c', 'H__c']);
});

test('scan does not read FOR UPDATE in a query as an update', () => {
  const r = scan('public class A { void f() { List<Account> a = [SELECT Id FROM Account FOR UPDATE\n]; List<Contact> c = [SELECT Id FROM Contact FOR  UPDATE ]; } }');
  assert.equal(r.writes.size, 0);
  assert.deepEqual(r.limits, []);
});

test('a changed @IsTest class is not a start: its test-data writes are not what a change sets off', async (t) => {
  const r = await plan(copy(t), [`${D}classes/SfUiProbeControllerTest.cls`]);
  assert.deepEqual(r.cascade, []);
  const proj = mini(t, { 'classes/FooTest.cls': '@IsTest private class FooTest { @IsTest static void t() { insert new Baz__c(); } }' });
  assert.deepEqual(mapOf(proj, ['classes/FooTest']).lines, []);
});

test('a namespaced class that calls its own static method is not its own callee, in any case', (t) => {
  const proj = mini(t, {
    'lwc/p/p.js': "import a from '@salesforce/apex/ns.Foo.a';",
    'classes/Foo.cls': 'public class Foo { public static void a() { Foo.b(); FOO.c(); } static void b() { insert new Bar__c(); } }',
  }, 'ns');
  const m = mapOf(proj, ['lwc/p']);
  assert.deepEqual(m.lines, ['cascade lwc/p > classes/ns__Foo > Bar__c', 'cascade: 0 reachable, 0 gaps (a gap is a note, not a verdict)']);
  assert.deepEqual(m.edges, [['LightningComponentBundle', 'p', 'ApexClass', 'Foo'], ['ApexClass', 'Foo', 'CustomObject', 'Bar']]);
});

const RULE_ON = '<active>true</active>';
const FLOW_ON = (o) => `<Flow><status>Active</status><start><object>${o}</object><triggerType>RecordAfterSave</triggerType></start></Flow>`;

test('Apex names an object in any case: its rule and flow are found, keyed by the folder\'s own name', (t) => {
  const proj = mini(t, { 'classes/A.cls': 'public class A { void f() { foo__c x = new foo__c(); insert x; } }', 'objects/Foo__c/validationRules/R.validationRule-meta.xml': RULE_ON, 'flows/F.flow-meta.xml': FLOW_ON('Foo__c') });
  assert.deepEqual(mapOf(proj, ['classes/A']).lines, ['cascade classes/A > foo__c', 'cascade classes/A > foo__c > flows/F: GAP', 'cascade classes/A > foo__c > objects/Foo__c/validationRules/R: GAP', 'cascade: 2 reachable, 2 gaps (a gap is a note, not a verdict)']);
});

test('the project namespace is matched in any case: NS__Bar__c is the own object Bar__c, not a managed one', (t) => {
  const proj = mini(t, { 'classes/A.cls': 'public class A { void f() { insert new NS__Bar__c(); } }', 'objects/Bar__c/validationRules/R.validationRule-meta.xml': RULE_ON }, 'ns');
  assert.deepEqual(mapOf(proj, ['classes/A']).lines, ['cascade classes/A > NS__Bar__c', 'cascade classes/A > NS__Bar__c > objects/Bar__c/validationRules/R: GAP', 'cascade: 1 reachable, 1 gaps (a gap is a note, not a verdict)']);
});

test('a flow is named in the cross-check by its label, as the dependency table names it, and looked up by its API name', async (t) => {
  const flow = '<Flow>\n    <assignments>\n        <label>Set it</label>\n    </assignments>\n    <label>Opportunity - After Save</label>\n    <status>Active</status>\n    <start><object>Opp__c</object><triggerType>RecordAfterSave</triggerType></start>\n</Flow>';
  const proj = mini(t, { 'classes/A.cls': 'public class A { void f() { insert new Opp__c(); } }', 'flows/Opp_After_Save.flow-meta.xml': flow });
  const m = mapOf(proj, ['classes/A']);
  assert.deepEqual(m.lines.slice(0, 2), ['cascade classes/A > Opp__c', 'cascade classes/A > Opp__c > flows/Opp_After_Save: GAP']);
  const rows = [['ApexClass', 'A', 'CustomObject', 'Opp'], ['Flow', 'Opportunity - After Save', 'CustomObject', 'Opp']]
    .map(([a, b, c, d]) => ({ MetadataComponentType: a, MetadataComponentName: b, RefMetadataComponentType: c, RefMetadataComponentName: d }));
  assert.deepEqual(require('../src/cascade').crossCheck(m.edges, rows), ['NOTE cascade MetadataComponentDependency: 2 of 2 links agree']);
  const asked = [];
  await require('../src/cascade').mcdRows(async (q) => { asked.push(q); return []; }, m.edges);
  assert.ok(asked.includes("SELECT Id FROM Flow WHERE Definition.DeveloperName IN ('Opp_After_Save') AND Status = 'Active'"), asked.join('\n'));
});

test('a flow\'s label is the root-level one at whatever indent the file uses, not a nested element\'s', (t) => {
  const flow = (i, label) => ['<Flow>', `${i}<assignments>`, `${i}${i}<label>Set it</label>`, `${i}</assignments>`, `${i}<label>${label}</label>`, `${i}<status>Active</status>`, `${i}<start><object>Opp__c</object><triggerType>RecordAfterSave</triggerType></start>`, '</Flow>'].join('\n');
  const proj = mini(t, { 'flows/Two.flow-meta.xml': flow('  ', 'Two Space'), 'flows/Tab.flow-meta.xml': flow('\t', 'Tab Flow'), 'flows/Four.flow-meta.xml': flow('    ', 'Four Space') });
  const labels = new Map();
  onSave(proj, 'Opp__c', resolveCI, labels);
  assert.deepEqual([...labels].sort(), [['flows/Four', 'Four Space'], ['flows/Tab', 'Tab Flow'], ['flows/Two', 'Two Space']]);
});

test('a flow label with a numeric entity is decoded, so an apostrophe matches the table\'s name', (t) => {
  const flow = (label) => `<Flow>\n    <label>${label}</label>\n    <status>Active</status>\n    <start><object>Opp__c</object><triggerType>RecordAfterSave</triggerType></start>\n</Flow>`;
  const proj = mini(t, { 'flows/A.flow-meta.xml': flow('Tom&#39;s &#x27;Flow&#x27; &amp; Co') });
  const labels = new Map();
  onSave(proj, 'Opp__c', resolveCI, labels);
  assert.equal(labels.get('flows/A'), "Tom's 'Flow' & Co");
});

test('a helper\'s call to a class the start also calls directly is not a "not followed" limit, one to any other class is', (t) => {
  const proj = mini(t, {
    'classes/A.cls': 'public class A { void f() { Helper.go(); Deep.go(); } }',
    'classes/Helper.cls': 'public class Helper { static void go() { Deep.go(); Other.go(); } }',
    'classes/Deep.cls': 'public class Deep { static void go() { insert new D__c(); } }',
    'classes/Other.cls': 'public class Other { static void go() { insert new O__c(); } }',
  });
  const m = mapOf(proj, ['classes/A']);
  assert.deepEqual(m.lines.filter((l) => l.startsWith('NOTE')), ['NOTE cascade limit: classes/Helper calls classes/Other, not followed']);
  assert.ok(m.lines.includes('cascade classes/A > classes/Deep > D__c'), 'control: Deep was followed as a direct callee');
});

// Measured on sfui-s4-map (assets/s4-static-map/gate-probe-mcd-standardentity.json): Contact is a StandardEntity row, User is a User row.
test('a write to a standard object is an edge to a StandardEntity, and to User a User, as the dependency table types them', (t) => {
  const proj = mini(t, { 'classes/A.cls': 'public class A { void f() { insert new Contact(); insert new User(); insert new Foo__c(); } }' });
  const m = mapOf(proj, ['classes/A']);
  assert.deepEqual(m.edges, [['ApexClass', 'A', 'StandardEntity', 'Contact'], ['ApexClass', 'A', 'CustomObject', 'Foo'], ['ApexClass', 'A', 'User', 'User']]);
  const row = (c, d) => ({ MetadataComponentType: 'ApexClass', MetadataComponentName: 'A', RefMetadataComponentType: c, RefMetadataComponentName: d });
  assert.deepEqual(require('../src/cascade').crossCheck(m.edges, [row('StandardEntity', 'Contact'), row('CustomObject', 'Foo'), row('User', 'User')]), ['NOTE cascade MetadataComponentDependency: 3 of 3 links agree']);
});

test('the dependency check also names a link to a standard object or User that the source read missed', (t) => {
  const proj = mini(t, { 'classes/A.cls': 'public class A { void f() { insert new Contact(); } }' });
  const m = mapOf(proj, ['classes/A']);
  const row = (c, d) => ({ MetadataComponentType: 'ApexClass', MetadataComponentName: 'A', RefMetadataComponentType: c, RefMetadataComponentName: d });
  assert.deepEqual(require('../src/cascade').crossCheck(m.edges, [row('StandardEntity', 'Contact'), row('StandardEntity', 'Account'), row('User', 'User')]), ['NOTE cascade MetadataComponentDependency: 1 of 1 links agree',
    'NOTE cascade MetadataComponentDependency only: ApexClass A -> StandardEntity Account (a read, or a link the source reader missed)', 'NOTE cascade MetadataComponentDependency only: ApexClass A -> User User (a read, or a link the source reader missed)']);
});

test('a class name is looked up once per map, however many starts and helpers name it', (t) => {
  const proj = mini(t, {
    'classes/A.cls': 'public class A { void f() { Helper.go(); System.debug(1); } }',
    'classes/B.cls': 'public class B { void f() { Helper.go(); System.debug(1); } }',
    'classes/Helper.cls': 'public class Helper { static void go() { Other.go(); insert new X__c(); } }',
    'classes/Other.cls': 'public class Other { static void go() {} }',
  });
  const v = require('../src/verify');
  const asked = [];
  require('../src/cascade').cascade(proj, ['classes/A', 'classes/B'], { apexImports: v.apexImports, classFile: (p, n, e) => { asked.push(n); return v.classFile(p, n, e); }, resolveCI: v.resolveCI }, () => []);
  assert.ok(asked.includes('Helper'), 'control: the helper was looked up');
  assert.deepEqual(asked.filter((n, i) => asked.indexOf(n) !== i), []);
});

test('a trigger or flow file is read once per map, however many objects the map reaches', (t) => {
  const proj = mini(t, {
    'classes/A.cls': 'public class A { void f() { insert new P__c(); insert new Q__c(); insert new R__c(); } }',
    'flows/FP.flow-meta.xml': FLOW_ON('P__c'), 'flows/FQ.flow-meta.xml': FLOW_ON('q__c'),
    'triggers/TP.trigger': 'trigger TP on P__c (before insert) {}', 'triggers/TQ.trigger': 'trigger TQ on Q__c (before insert) {}',
  });
  const real = fs.readFileSync;
  const reads = [];
  t.mock.method(fs, 'readFileSync', (f, ...a) => { reads.push(String(f)); return real(f, ...a); });
  const m = mapOf(proj, ['classes/A']);
  assert.deepEqual(m.lines.filter((l) => l.includes(' > flows/') || l.includes(' > triggers/')).map((l) => l.split(' > ').slice(1).join(' > ').replace(': GAP', '')), ['P__c > flows/FP', 'P__c > triggers/TP', 'Q__c > flows/FQ', 'Q__c > triggers/TQ']);
  const hits = (ext) => reads.filter((f) => f.endsWith(ext));
  assert.equal(hits('.flow-meta.xml').length, 2, 'control: the flows were read');
  assert.deepEqual(hits('.flow-meta.xml').concat(hits('.trigger')).filter((f, i, all) => all.indexOf(f) !== i), []);
});

test('a class the branch deletes starts no map, so it prints no "not in this project" limit', async (t) => {
  const dir = copy(t);
  const changed = [`${D}classes/S4Map_Controller.cls`];
  assert.ok((await plan(dir, changed)).cascade.length > 0, 'control: the class present starts a map');
  fs.rmSync(path.join(dir, D, 'classes/S4Map_Controller.cls'));
  assert.deepEqual((await plan(dir, changed)).cascade, []);
});
