'use strict';

// verify with no org: selection, the check file's rules and the report run offline; the org tests at the end need SF_TESTER_ORG.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const verify = require('../src/verify');
const { SfUiError } = require('../src/errors');

const RULE = 'objects/SfUiProbe__c/validationRules/SfUi_Count_Not_Negative';
const LAYOUT = 'layouts/SfUiTyped__c-SF UI Typed Layout';
// Field keys any record or pageRequired check may cover, for tests about something else.
const [F_X, F_Y, F_K] = ['X', 'Y', 'K'].map((f) => `objects/SfUiProbe__c/fields/${f}__c`);
const rec = (id, covers, extra = {}) => ({ id, kind: 'record', requirement: `req ${id}`, covers, persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] }, object: 'SfUiProbe__c',
  cases: [{ name: 'rejects', fields: { Name: 'v', Count__c: -1 }, expect: { saves: false, error: 'Count cannot be negative' } }, { name: 'accepts', fields: { Name: 'v', Count__c: 0 }, expect: { saves: true } }], ...extra });
const page = (id, covers) => ({ id, kind: 'pageRequired', covers, persona: { profile: 'Standard Platform User', permissionSets: [] }, object: 'SfUiTyped__c', recordType: 'Beta_Type', field: 'Size__c', expect: { required: true } });

// A project in a temp dir with a check file; git answers from a table of args to stdout.
function project(t, checks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  const file = path.join(dir, 'checks.json');
  fs.writeFileSync(file, typeof checks === 'string' ? checks : JSON.stringify({ checks }));
  return { dir, file };
}
// The changed files exist on disk unless a test means them deleted.
const touch = (dir, files) => files.forEach((f) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), '<x/>'); });
const gitOf = (changed, head = []) => (args) => {
  if (args.includes('--name-only')) return (args.includes('HEAD') && !args.some((x) => x.includes('...')) ? head : changed).join('\n');
  throw new Error(`unexpected git ${args}`);
};
const D = 'force-app/main/default/';
// The default sf answers like a CLI with no job: every record case is an ERROR.
const NOJOB = async () => JSON.stringify({ status: 1, name: 'NoJob', message: 'no validate' });
async function run(argv, more = {}) {
  const out = [];
  const code = await cli.main(argv, { log: (l) => out.push(l), warn: (l) => out.push(l), connect: async () => ({ production: false, orgApiVersion: '68.0' }), sf: NOJOB, ...more });
  return { code, out };
}

test('an item key is the path inside its package directory, less main/default and the meta suffix', () => {
  const proj = { dirs: ['force-app', 'other/pkg'] };
  assert.equal(verify.itemOf(`${D}${RULE}.validationRule-meta.xml`, proj).key, RULE);
  assert.equal(verify.itemOf(`${D}${LAYOUT}.layout-meta.xml`, proj).key, LAYOUT);
  assert.equal(verify.itemOf(`${D}objects/SfUiProbe__c/fields/Tags__c.field-meta.xml`, proj).key, 'objects/SfUiProbe__c/fields/Tags__c');
  assert.equal(verify.itemOf(`${D}flexipages/SfUi_Dyn_Record_Page.flexipage-meta.xml`, proj).key, 'flexipages/SfUi_Dyn_Record_Page');
  assert.equal(verify.itemOf('other/pkg/layouts/A-B.layout-meta.xml', proj).key, 'layouts/A-B', 'no main/default');
  assert.equal(verify.itemOf('README.md', proj), null, 'outside a package directory');
  assert.equal(verify.itemOf(`${D}objects/SfUiProbe__c/SfUiProbe__c.object-meta.xml`, proj).type, 'objects');
});

test('a class is one item for its source and meta file, an lwc file is its bundle, and only an Apex-calling bundle is checkable', (t) => {
  const proj = { dirs: ['force-app'] };
  for (const f of ['classes/SfUiProbeController.cls', 'classes/SfUiProbeController.cls-meta.xml']) assert.equal(verify.itemOf(`${D}${f}`, proj).key, 'classes/SfUiProbeController', f);
  const lwc = verify.itemOf(`${D}lwc/sfUiProbe/sfUiProbe.js`, proj);
  assert.deepEqual([lwc.key, lwc.type], ['lwc/sfUiProbe', 'lwc']);
  for (const f of ['classes/services/Foo.cls', 'classes/services/Foo.cls-meta.xml']) assert.equal(verify.itemOf(`${D}${f}`, proj).key, 'classes/services/Foo', f);
  assert.equal(verify.itemOf(`${D}lwc/sfUiProbe/__tests__/a.test.js`, proj).key, 'lwc/sfUiProbe');
  const { dir } = project(t, []);
  touch(dir, [`${D}lwc/plain/plain.js`, `${D}lwc/plain/plain.html`]);
  fs.writeFileSync(path.join(dir, D, 'lwc/plain/plain.js'), "import { LightningElement } from 'lwc';");
  touch(dir, [`${D}lwc/calls/calls.js`, `${D}lwc/calls/calls.html`, `${D}classes/A.cls`]);
  touch(dir, [`${D}classes/Plain.cls`, `${D}classes/Plain.cls-meta.xml`]);
  fs.writeFileSync(path.join(dir, D, 'classes/Plain.cls'), 'public class Plain { public static void go() {} }');
  fs.writeFileSync(path.join(dir, D, 'classes/A.cls'), 'public class A { @auraenabled public static void go() {} }');
  fs.writeFileSync(path.join(dir, D, 'lwc/calls/calls.js'), "import go from '@salesforce/apex/A.go';");
  const p = { root: dir, dirs: ['force-app'] };
  touch(dir, [`${D}lwc/jsconfig.json`]);
  const loose = verify.changes([`${D}lwc/jsconfig.json`, `${D}lwc/.eslintrc.json`], p, new Set());
  assert.deepEqual([[...loose.items.keys()], loose.other.sort()], [[], ['lwc/.eslintrc.json', 'lwc/jsconfig.json']], 'a loose file under lwc/ is not a bundle: not checkable, no crash');
  const got = verify.changes([`${D}lwc/plain/plain.js`, `${D}lwc/calls/calls.css`, `${D}classes/A.cls`, `${D}classes/Plain.cls-meta.xml`, `${D}permissionsets/S.permissionset-meta.xml`, `${D}lwc/gone/gone.js`, `${D}lwc/ui/ui.js`], p, new Set(['lwc/gone']));
  assert.deepEqual([...got.items.keys()].sort(), ['classes/A', 'lwc/calls', 'lwc/gone', 'permissionsets/S'], 'a deleted bundle a check covers is an item, so its checks fail');
  assert.deepEqual(got.other.sort(), ['classes/Plain', 'lwc/plain', 'lwc/ui'], 'no Apex import, no @AuraEnabled, or deleted and uncovered: not checkable yet');
  assert.ok(got.items.get('lwc/calls').every((x) => !x.deleted), 'one deleted file does not delete the bundle');
  assert.deepEqual([...got.gone].sort(), ['lwc/gone', 'permissionsets/S'], 'changes() returns the gone keys (S is not on disk)');
  assert.deepEqual([...verify.changes([`${D}lwc/gone/gone.js`], p).other], ['lwc/gone'], 'covers defaults to none');
  const own = verify.changes([`${D}lwc/gone/gone.js`, `${D}classes/Old.cls`], p, new Set(['lwc/gone']));
  assert.deepEqual([[...own.items.keys()], own.other], [['lwc/gone'], ['classes/Old']], 'a deleted class no check covers is not checkable');
});

test('BAD_CHECK names the check and the reason, exit 2, for each rule', async (t) => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.match(bad({ ...rec('a', [F_X]), kind: 'nope' }), /^a: unknown kind/);
  assert.match(bad({ ...rec('a', [F_X]), id: '' }), /no id/);
  assert.match(bad({ ...rec('a', [F_X]), persona: undefined }), /no persona/);
  assert.match(bad({ ...rec('a', [F_X]), object: undefined }), /no object/);
  assert.match(bad({ ...rec('a', []) }), /no covers/);
  assert.match(verify.badChecks({ checks: [rec('a', [F_X]), rec('a', [F_Y])] })[0], /^a: duplicate id/);
  const one = (saves) => rec('a', [F_X]).cases.filter((c) => c.expect.saves === saves);
  assert.match(bad(rec('a', [F_X], { cases: one(true) })), /case that saves and a case that does not/);
  assert.match(bad(rec('a', [F_X], { cases: one(false) })), /case that saves and a case that does not/);
  assert.match(bad({ ...page('p', [F_X]), field: undefined }), /field must be a plain API name/);
  assert.match(bad({ ...page('p', [F_X]), field: "A' OR Id != '" }), /^p: field must be a plain API name/);
  assert.match(bad({ ...page('p', [F_X]), field: '../x' }), /field must be a plain API name/);
  assert.match(bad({ ...page('p', [F_X]), expect: { required: 'yes' } }), /expect.required/);
  assert.match(bad(rec('a', [F_X], { cases: [...rec('a', [F_X]).cases, { name: 'd', fields: { Due__c: { date: '31/01/2026' } }, expect: { saves: true } }] })), /bad field Due__c/, 'a date needs { date }');
  const noText = rec('a', [F_X]);
  delete noText.cases[0].expect.error;
  assert.match(bad(noText), /^a: case "rejects": a case that does not save needs expect.error/);
  assert.deepEqual(verify.badChecks({ checks: [rec('a', [F_X]), page('p', [F_Y])] }), []);
  const { file } = project(t, [rec('a', [F_X], { cases: one(true) })]);
  const r = await run(['verify', '--org', 'o', '--checks', file]);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^BAD_CHECK a: /);
});

test('BAD_CHECK for a check id verify keeps for its own rows', () => {
  for (const id of ['carried', 'cascade']) assert.deepEqual(verify.badChecks({ checks: [rec(id, [RULE])] }), [`${id}: the id ${id} is reserved for verify's own rows`], id);
  assert.deepEqual(verify.badChecks({ checks: [rec('Carried-rule', [RULE])] }), [], 'control: another id');
});

test('BAD_CHECK for a cover key of a type the kind cannot test', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.match(bad(rec('a', [RULE, 'permissionsets/X'])), /^a: a record check cannot cover permissionsets\/X; it covers fields, validationRules$/);
  assert.match(bad(page('p', [LAYOUT, 'classes/C'])), /^p: a pageRequired check cannot cover classes\/C/);
  assert.match(bad(klass('k', { covers: ['classes/SfUiProbeController', F_X, 'objects/SfUiProbe__c'] })), /^k: a classAccess check cannot cover objects\/SfUiProbe__c\/fields\/X__c, objects\/SfUiProbe__c;/);
  assert.match(bad(rec('a', ['x'])), /cannot cover x;/, 'a key with no type folder');
  assert.deepEqual(verify.badChecks({ checks: [rec('a', [RULE, F_X]), page('p', [LAYOUT, 'flexipages/F', F_X, 'permissionsets/S']), klass('k', { covers: ['classes/C', 'permissionsets/S', 'lwc/b'] })] }), [], 'each allowed type passes');
});

test('usage: no check file, no org, a bad ref and a production org all exit 2', async (t) => {
  const { file } = project(t, [rec('a', [RULE])]);
  assert.equal((await run(['verify', '--org', 'o'])).code, 2);
  assert.equal((await run(['verify', '--checks', file])).code, 2);
  assert.equal((await run(['verify', '--org', 'o', '--checks', file, '--only', '('])).code, 2);
  const ref = await run(['verify', '--org', 'o', '--checks', file, '--since', 'nope'], { git: () => { throw Object.assign(new Error('x'), { stderr: 'fatal: bad revision' }); } });
  assert.equal(ref.code, 2);
  assert.match(ref.out[0], /bad revision/);
  const prod = await run(['verify', '--org', 'o', '--checks', file], { connect: async () => ({ production: true }), sf: async () => assert.fail('ran on production') });
  assert.equal(prod.code, 2);
  assert.match(prod.out[0], /^o is a production org: verify runs on a scratch org, a sandbox, a trial or a Developer Edition org\n/);
  const noAuth = await run(['verify', '--org', 'o', '--checks', file], { connect: async () => { throw Object.assign(new Error('no auth'), { code: 'NO_AUTH' }); } });
  assert.equal(noAuth.code, 2);
  const unread = await run(['verify', '--org', 'o', '--checks', file], { connect: async () => { throw new SfUiError('API_ERROR', '/services/data/ listed no API version'); } });
  assert.equal(unread.code, 2);
  assert.match(unread.out[0], /^o could not be read: .*listed no API version/);
  assert.ok(!unread.out.join('\n').includes('usage:'), 'an org fault is not a usage error');
});

test('an apex check below API 67.0 exits 2 before any deploy; a record check still runs there', async (t) => {
  const { file } = project(t, [apex('probe-ping'), rec('a', [RULE])]);
  const old = await run(['verify', '--org', 'o', '--checks', file], { connect: async () => ({ production: false, orgApiVersion: '66.0' }), sf: async () => assert.fail('ran below 67.0') });
  assert.equal(old.code, 2, old.out.join('\n'));
  assert.match(old.out.join('\n'), /^o reports API 66\.0: apex checks need 67\.0 or later/m);
  let ran = false;
  const recOnly = project(t, [rec('a', [RULE])]);
  await run(['verify', '--org', 'o', '--checks', recOnly.file], { connect: async () => ({ production: false, orgApiVersion: '66.0' }), sf: async () => { ran = true; return NOJOB(); } });
  assert.ok(ran, 'a record check deploys on a 66.0 org');
  ran = false;
  await run(['verify', '--org', 'o', '--checks', file, '--only', '^a$'], { connect: async () => ({ production: false, orgApiVersion: '66.0' }), sf: async () => { ran = true; return NOJOB(); } });
  assert.ok(ran, '--only leaving the apex check out runs the record check');
});

test('defaultConnect takes the last version /services/data/ lists, keeps the pinned version for reads and keeps the skew', async (t) => {
  const session = require('../src/session');
  const asked = [];
  t.mock.method(session, 'fromAlias', async () => ({ instanceUrl: 'https://x', accessToken: 't', username: 'u@o' }));
  t.mock.method(session, 'aliasUsername', async () => assert.fail('a second alias lookup'));
  t.mock.method(globalThis, 'fetch', async (url) => { asked.push(url); return { ok: true, headers: new Headers({ date: new Date().toUTCString() }), json: async () => [{ version: '20.0' }, { version: '67.0' }, { version: '68.0' }] }; });
  const api = { PINNED_VERSION: '60.0', call: async (s) => { asked.push(`query at ${s.apiVersion}`); return { records: [{ IsSandbox: true }] }; } };
  const s = await verify.defaultConnect('o', api);
  assert.deepEqual([s.orgApiVersion, s.apiVersion, s.production, s.username], ['68.0', '60.0', false, 'u@o']);
  assert.equal(typeof s.serverSkewMs, 'number', 'the skew the version read measures stays on s');
  assert.deepEqual(asked.sort(), ['https://x/services/data/', 'query at 60.0']);
});

test('through defaultConnect, an org answering /services/data/ with no JSON exits 2 and deploys nothing', async (t) => {
  const session = require('../src/session');
  const { file } = project(t, [rec('a', [RULE])]);
  t.mock.method(session, 'fromAlias', async () => ({ instanceUrl: 'https://x', accessToken: 't' }));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  const api = { PINNED_VERSION: '60.0', call: async () => ({ records: [{ IsSandbox: true }] }) };
  const r = await run(['verify', '--org', 'o', '--checks', file], { connect: undefined, api, sf: async () => assert.fail('deployed') });
  assert.equal(r.code, 2, r.out.join('\n'));
  assert.match(r.out[0], /^o could not be read: API_ERROR: \/services\/data\/ answered 200, not JSON/);
});

test('defaultConnect is an API_ERROR, not a TypeError, when the Organization query returns no row', async (t) => {
  const session = require('../src/session');
  t.mock.method(session, 'fromAlias', async () => ({ instanceUrl: 'https://x', accessToken: 't' }));
  t.mock.method(session, 'latestVersion', async () => '68.0');
  for (const answer of [null, { records: [] }]) {
    await assert.rejects(verify.defaultConnect('o', { PINNED_VERSION: '60.0', call: async () => answer }), { code: 'API_ERROR' }, JSON.stringify(answer));
  }
});

test('latestVersion is an API_ERROR, not a TypeError, when /services/data/ lists no version', async (t) => {
  const session = require('../src/session');
  for (const body of [[], {}, [{}], undefined, 'not json']) {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { if (body === 'not json') throw new SyntaxError('Unexpected end of JSON input'); return body; } }));
    await assert.rejects(session.latestVersion({ instanceUrl: 'https://x', accessToken: 't' }), { code: 'API_ERROR' }, JSON.stringify(body));
    t.mock.restoreAll();
  }
});

test('--plan lists each changed item with the checks that cover it, or UNCOVERED, and runs nothing', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE]), page('size', [LAYOUT])]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/validationRules/SfUi_Other.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/SfUiProbe__c.object-meta.xml`, 'README.md']);
  const r = await run(['verify', '--plan', '--checks', file, '--since', 'main'], { git });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(1), [`not checkable yet: objects/SfUiProbe__c/SfUiProbe__c`, `${RULE} count-rule`, 'objects/SfUiProbe__c/validationRules/SfUi_Other UNCOVERED', 'would run: count-rule']);
  assert.ok(dir);
});

test('--since runs the checks a changed item reaches; an uncovered item is red; the last line counts', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE]), rec('other', ['objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000'])]);
  touch(dir, [`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`], [`${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git });
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('UNCOVERED objects/SfUiProbe__c/fields/Gone__c'));
  assert.ok(r.out.some((l) => l.startsWith('ERROR count-rule rejects')), 'a selected check reached its runner, the other did not');
  assert.ok(!r.out.some((l) => /other/.test(l)));
  assert.equal(r.out.at(-1), 'changed 2, covered 1, uncovered 1, ran 2, passed 0, failed 0, errors 2');
});

test('nothing ran is never green; a change with no supported item is', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE])]);
  const none = await run(['verify', '--org', 'o', '--checks', project(t, []).file]);
  assert.equal(none.code, 2);
  assert.match(none.out.at(-1), /^no check ran/);
  const git = gitOf([`${D}triggers/T.trigger-meta.xml`]);
  const green = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git });
  assert.equal(green.code, 0);
  assert.ok(green.out.includes('no checkable change since main'));
  assert.ok(green.out.includes('not checkable yet: triggers/T'));
});

test('--only narrows what runs, not what counts as covered; --junit writes UNCOVERED as a failed case', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE]), rec('other', [RULE])]);
  const out = path.join(dir, 'v.xml');
  touch(dir, [`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main', '--only', '^other$', '--junit', out], { git });
  assert.match(r.out.at(-1), /^changed 2, covered 1, uncovered 1, ran 2/);
  const xml = fs.readFileSync(out, 'utf8');
  assert.match(xml, /name="uncovered\/objects\/SfUiProbe__c\/fields\/Gone__c"[^>]*><failure message="UNCOVERED"/);
  assert.match(xml, /<testsuite name="sf-tester verify" tests="3" failures="1" errors="2"/);
  assert.match(xml, /<testcase classname="sf-tester.verify" name="other\/rejects" time="0.000"><error message="NoJob: no validate"\/>/);
  assert.match(xml, /name="other\/accepts"/, 'each error case has its own name');
});

test('a profile in the diff prints the layout-assignment limit once', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE])]);
  const r = await run(['verify', '--plan', '--checks', file, '--since', 'main'], { git: gitOf([`${D}profiles/A.profile-meta.xml`, `${D}profiles/B.profile-meta.xml`]) });
  assert.equal(r.out.filter((l) => /layoutAssignments/.test(l)).length, 1);
  assert.ok(r.out.some((l) => /class access are read from the org.*classAccesses/.test(l)), r.out.join('\n'));
});

// ---- record checks: the generated Apex, the payload, the validate and its report ----
const sample = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'verify-samples', name), 'utf8'));
const THREE = rec('count-rule', [RULE], { cases: [
  { name: 'rejects negative', fields: { Name: 'v', Count__c: -1 }, expect: { saves: false, error: 'Count cannot be negative' } },
  { name: 'accepts zero', fields: { Name: 'v', Count__c: 0 }, expect: { saves: true } },
  { name: 'wrong expectation', fields: { Name: 'v', Count__c: -1 }, expect: { saves: true } }] });
// The sample report's real method names, renamed to the generated c0_0, c0_1, c0_2.
const REPORT = JSON.stringify(sample('validate-report.json')).replace('ruleRejectsNegative', 'c0_0').replace('ruleAcceptsZero', 'c0_1').replace('controlMustGoRed', 'c0_2').replace(/VerifyProbeE1Test/g, 'SfTesterVerifyTest');
const OK_ENVELOPE = JSON.stringify({ status: 0, result: { id: '0Af9H000009Y79xSAC' } });

test('the generator emits a method per case with the persona, the put, the insert as it and the asserts', () => {
  const { apex, methods } = verify.generate([{ ...THREE, persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] } }]);
  assert.deepEqual([...methods.keys()], ['c0_0', 'c0_1', 'c0_2']);
  assert.deepEqual(methods.get('c0_1'), { check: 'count-rule', name: 'accepts zero' });
  assert.match(apex, /@IsTest static void c0_0\(\) \{\n        User u = persona\('Standard Platform User', new List<String>\{'SfUi_Probe'\}\);/);
  assert.match(apex, /rec\.put\('Count__c', -1\);/);
  assert.match(apex, /System\.runAs\(u\) \{ res = Database\.insert\(rec, false, AccessLevel\.USER_MODE\); \}/);
  assert.match(apex, /e\.getMessage\(\)\.equals\('Count cannot be negative'\)/);
  assert.match(apex, /System\.assert\(res\.isSuccess\(\), 'expected a save, got: ' \+ msgs\);/);
  assert.match(apex, /System\.runAs\(new User\(Id = UserInfo\.getUserId\(\)\)\) \{\n            try \{ insert as system usr; \} catch \(DmlException e\) \{ System\.assert\(false, 'SETUP: '/);
});

test('persona() setup runs every query and insert in system mode, as the class deploys at the org\'s version', () => {
  const { apex } = verify.generate([rec('g', [F_K], { persona: { profile: 'P', permissionSets: ['Plain'] } })]);
  const setup = apex.slice(apex.indexOf('static User persona('), apex.indexOf('return usr;'));
  const inline = setup.match(/\[SELECT[^\]]*\]/g) || [];
  const dynamic = setup.match(/Database\.query\(.*?\)(?=;|\.isEmpty)/g) || [];
  const dml = setup.match(/\binsert\b[^;]*;/g) || [];
  assert.deepEqual([inline.length, dynamic.length, dml.length], [4, 2, 2], 'denominator: every statement was found');
  assert.ok(inline.every((q) => q.includes('WITH SYSTEM_MODE')), inline.join('\n'));
  assert.ok(dynamic.every((q) => q.endsWith('AccessLevel.SYSTEM_MODE)')), dynamic.join('\n'));
  assert.ok(dml.every((d) => d.startsWith('insert as system ')), dml.join('\n'));
});

test('the generator escapes a quote and a newline, and types a date, a datetime, a boolean and a null', () => {
  const c = rec('x', [F_K], { cases: [{ name: 'q', fields: { Name: "it's\nhere\\", Due__c: { date: '2026-01-31' }, At__c: { datetime: '2026-01-31T10:00:00Z' }, Done__c: true, Detail__c: null }, expect: { saves: true } },
    { name: 'r', fields: {}, expect: { saves: false, error: 'No' } }], persona: { profile: "O'Brien", permissionSets: [] } });
  const { apex } = verify.generate([c]);
  assert.match(apex, /rec\.put\('Name', 'it\\'s\\nhere\\\\'\);/);
  assert.match(apex, /Date\.valueOf\('2026-01-31'\)/);
  assert.match(apex, /JSON\.deserialize\('"2026-01-31T10:00:00Z"', Datetime\.class\)/);
  assert.match(apex, /rec\.put\('Done__c', true\);/);
  assert.match(apex, /rec\.put\('Detail__c', null\);/);
  assert.match(apex, /persona\('O\\'Brien', new List<String>\{\}\)/);
});

test('a permission set name is a set first, else a group, else a named failure; a group assigns by PermissionSetGroupId', () => {
  const { apex } = verify.generate([rec('g', [F_K], { persona: { profile: 'P', permissionSets: ['ns__Grp', 'Plain'] } })]);
  // A null prefix for an unprefixed name, or null or the project's own, the unprefixed row first, as the JS lookups do.
  assert.ok(apex.includes("String projNs = null;"));
  assert.ok(apex.includes("String nsFilter = ns != null ? ' AND NamespacePrefix = :ns' : projNs == null ? ' AND NamespacePrefix = null' : ' AND (NamespacePrefix = null OR NamespacePrefix = :projNs)';"));
  assert.ok(verify.generate([rec('g', [F_K])], "o'ns").apex.includes("String projNs = 'o\\'ns';"), 'the project namespace is passed in, escaped');
  assert.ok(apex.includes("'SELECT Id FROM PermissionSet WHERE Name = :nm' + nsFilter + ' AND IsOwnedByProfile = false ORDER BY NamespacePrefix NULLS FIRST LIMIT 1'"));
  assert.ok(apex.includes("'SELECT Id FROM PermissionSetGroup WHERE DeveloperName = :nm' + nsFilter + ' ORDER BY NamespacePrefix NULLS FIRST LIMIT 1'"));
  assert.doesNotMatch(apex, /NamespacePrefix = :ns AND/);
  assert.match(apex, /PermissionSetGroupId = groups\[0\]\.Id/);
  assert.match(apex, /new List<String>\{'ns__Grp', 'Plain'\}/);
  assert.match(apex, /'SETUP: permission set or group not found: ' \+ full/);
});

function selecting(t, extra = {}) {
  const { dir, file } = project(t, [THREE]);
  const seen = [];
  const sf = async (args, { cwd }) => {
    seen.push({ args, cwd, files: fs.existsSync(cwd) ? fs.readdirSync(path.join(cwd, 'force-app/main/default'), { recursive: true }).sort() : [] });
    return (extra.answers || [OK_ENVELOPE, REPORT])[seen.length - 1];
  };
  return { dir, file, seen, sf };
}

// A change to ranlog.VALIDATE reaches the sf route; cascade-log.test.js checks the SOAP route through --cascade.
test('the sf route takes the test level and time limit from VALIDATE', async (t) => {
  const ranlog = require('../src/cascade-log');
  const was = { ...ranlog.VALIDATE };
  t.after(() => Object.assign(ranlog.VALIDATE, was));
  Object.assign(ranlog.VALIDATE, { testLevel: 'RunLocalTests', minutes: 1 });
  const { file, seen, sf } = selecting(t);
  await run(['verify', '--org', 'o', '--checks', file], { sf });
  const a = seen[0].args;
  assert.deepEqual([a[a.indexOf('--test-level') + 1], a[a.indexOf('--wait') + 1]], ['RunLocalTests', '1']);
});

test('a validate report maps each method: pass, fail with its message, and a method in neither is ERROR', async (t) => {
  const { file, seen, sf } = selecting(t);
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.deepEqual(r.out.slice(0, 3), ['PASS count-rule rejects negative', 'PASS count-rule accepts zero', 'FAIL count-rule wrong expectation E1 CONTROL: Count cannot be negative (requirement: req count-rule)']);
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 3, passed 2, failed 1');
  assert.equal(r.code, 1);
  assert.deepEqual(seen[0].args, ['project', 'deploy', 'validate', '--source-dir', 'force-app', '--test-level', 'RunSpecifiedTests', '--tests', 'SfTesterVerifyTest', '-o', 'o', '--wait', '30', '--json']);
  assert.deepEqual(seen[1].args, ['project', 'deploy', 'report', '--job-id', '0Af9H000009Y79xSAC', '-o', 'o', '--json']);
  assert.equal(fs.existsSync(seen[0].cwd), false, 'the temp project is removed');
  const missing = selecting(t, { answers: [OK_ENVELOPE, REPORT.replace('"c0_1"', '"c0_9"')] });
  const m = await run(['verify', '--org', 'o', '--checks', missing.file], { sf: missing.sf });
  assert.ok(m.out.some((l) => l.startsWith('ERROR count-rule accepts zero no result for c0_1')), m.out.join('\n'));
  assert.match(m.out.at(-1), /passed 1, failed 1, errors 1$/);
});

test('a run prints its time per stage before the counts, and splits the validate by the deploy result\'s own dates', async (t) => {
  const dated = JSON.parse(REPORT);
  Object.assign(dated.result, { createdDate: '2026-11-25T00:00:00.000Z', startDate: '2026-11-25T00:00:02.000Z', completedDate: '2026-11-25T00:00:09.000Z' });
  dated.result.details.runTestResult.totalTime = '4000.0';
  const { file, sf } = selecting(t, { answers: [OK_ENVELOPE, JSON.stringify(dated)] });
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.match(r.out.at(-2), /^time: connect \d+ ms, generate \d+ ms, validate \d+ ms \(queue 2000 ms, deploy 3000 ms, tests 4000 ms\), report \d+ ms, total \d+ ms$/);
  assert.match(r.out.at(-1), /^changed 0, /, 'the counts stay the last line');
  // A report with no dates prints the validate with no split.
  const plain = selecting(t);
  const p = await run(['verify', '--org', 'o', '--checks', plain.file], { sf: plain.sf });
  assert.match(p.out.at(-2), /^time: connect \d+ ms, generate \d+ ms, validate \d+ ms, report \d+ ms, total \d+ ms$/);
  // With --since, the diff has a stage of its own.
  const since = selecting(t);
  touch(since.dir, [`${D}${RULE}.validationRule-meta.xml`]);
  const d = await run(['verify', '--org', 'o', '--checks', since.file, '--since', 'main'], { sf: since.sf, git: gitOf([`${D}${RULE}.validationRule-meta.xml`]) });
  assert.match(d.out.at(-2), /^time: connect \d+ ms, diff \d+ ms, generate \d+ ms, /, d.out.join('\n'));
});

test('a compile error or refused metadata makes every record case ERROR with the problem; an envelope with no job id too', async (t) => {
  const failed = sample('validate-report.json');
  failed.result.details = { componentFailures: [{ fullName: 'SfTesterVerifyTest', problem: 'Invalid type: Schema.Nope (33:25)' }] };
  const a = selecting(t, { answers: [JSON.stringify(sample('validate-compile-error.json')), JSON.stringify(failed)] });
  const r = await run(['verify', '--org', 'o', '--checks', a.file], { sf: a.sf });
  assert.equal(r.out.filter((l) => l.startsWith('ERROR count-rule') && /SfTesterVerifyTest: Invalid type: Schema\.Nope/.test(l)).length, 3);
  assert.equal(r.code, 1);
  // No deployId anywhere: the envelope's own name and message.
  const b = selecting(t, { answers: [`Update available\n${JSON.stringify({ status: 1, name: 'NoDefaultEnvError', message: 'no org' })}`] });
  const n = await run(['verify', '--org', 'o', '--checks', b.file], { sf: b.sf });
  assert.equal(n.out.filter((l) => /ERROR count-rule .* NoDefaultEnvError: no org/.test(l)).length, 3);
});

test('with --since the payload carries every changed rule and field, covered or not, and no layout, page or other type', async (t) => {
  const { dir, file, seen, sf } = selecting(t);
  const files = [`${D}${RULE}.validationRule-meta.xml`, `${D}layouts/Unrelated-L.layout-meta.xml`, `${D}objects/SfUiProbe__c/fields/New__c.field-meta.xml`, `${D}triggers/T.trigger-meta.xml`];
  touch(dir, files);
  await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf(files), sf });
  assert.deepEqual(seen[0].files.filter((f) => /\.xml$|\.cls$/.test(f)), ['classes/SfTesterVerifyTest.cls', 'classes/SfTesterVerifyTest.cls-meta.xml', 'objects/SfUiProbe__c/fields/New__c.field-meta.xml', 'objects/SfUiProbe__c/validationRules/SfUi_Count_Not_Negative.validationRule-meta.xml']);
});

test('a covered item the branch deletes fails its checks, which do not run', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE]), rec('other', ['objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000'])]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git, sf: async () => assert.fail('a deleted item runs no validate') });
  assert.equal(r.code, 1);
  assert.equal(r.out[1], `FAIL count-rule ${RULE} deleted on the branch: ${RULE} (requirement: req count-rule)`);
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 0, failed 1');
});

// ---- pageRequired checks: metadata reads, no DML ----
const read = (f) => fs.readFileSync(path.join(__dirname, 'fixture/force-app/main/default', f), 'utf8');
const LAYOUT_XML = (behavior) => `<Layout><layoutSections><layoutColumns><layoutItems><behavior>Required</behavior><field>Name</field></layoutItems><layoutItems><behavior>${behavior}</behavior><field>Size__c</field></layoutItems></layoutColumns></layoutSections></Layout>`;
const FLEXI_XML = (v) => `<FlexiPage><flexiPageRegions><itemInstances><fieldInstance><fieldInstanceProperties><name>uiBehavior</name><value>${v}</value></fieldInstanceProperties><fieldItem>Record.Size__c</fieldItem></fieldInstance></itemInstances><itemInstances><componentInstance><componentName>x</componentName></componentInstance></itemInstances><itemInstances><fieldInstance><fieldItem>Record.Name</fieldItem></fieldInstance></itemInstances></flexiPageRegions></FlexiPage>`;

test('layout and FlexiPage XML read to field maps, entities decoded; the fixture layouts say what the checks expect', () => {
  assert.deepEqual(verify.layoutXml(LAYOUT_XML('Edit').replace('Size__c', 'A&amp;B__c')), { Name: 'Required', 'A&B__c': 'Edit' });
  assert.deepEqual(verify.pageXml(FLEXI_XML('required')), { Size__c: 'required', Name: 'none' });
  assert.equal(verify.layoutXml(read('layouts/SfUiTyped__c-SF UI Typed Layout.layout-meta.xml')).Size__c, 'Required');
  assert.equal(verify.layoutXml(read('layouts/SfUiTyped__c-SF UI Typed Alpha Layout.layout-meta.xml')).Size__c, 'Edit');
});

// The app the org's Tooling API gives by default: it sends the gate and dynamic objects to the pages the componentVisible tests read.
const view = (content, object) => ({ actionName: 'View', type: 'Flexipage', content, formFactor: 'Large', pageOrSobjectType: object });
const APP_MD = { actionOverrides: [view('SfUi_Dyn_Gated_Page', 'SfUiDyn__c'), view('SfUi_Gate_Record_Page', 'SfUiGate__c')], profileActionOverrides: [] };
// The org: Tooling rows by the SOQL's shape; the queries it was asked are kept.
function org({ layout = 'SF UI Typed Layout', rows, md, describe = { name: 'Size__c', nillable: true, createable: true, defaultedOnCreate: false }, flexi, readable = true, setFound = true, objectName, noProfile = false, noObject = false, apexClass, grantedBy = [], authorApex = [], managed = { sets: [], groups: [] }, mutingSet = false, objectReadable = true, objectRows = true, typed = false, profileFullName = 'StandardAul', appMd = APP_MD, fieldDefs = [], typeActive = true, allData = null, groupSet = false, members = [] } = {}) {
  const asked = [];
  const call = async (s, p) => {
    const q = decodeURIComponent(p.split('q=')[1] || '');
    asked.push(p.startsWith('/sobjects') ? p : q);
    if (/FROM CustomField/.test(q)) return { records: fieldDefs.map((n) => ({ DeveloperName: n.replace(/__c$/i, ''), NamespacePrefix: null })) };
    if (/FROM Profile WHERE Name/.test(q)) return { records: profileFullName ? [{ FullName: profileFullName }] : [] };
    if (/FROM CustomApplication/.test(q)) return { records: appMd ? [{ Metadata: appMd }] : [] };
    // objectReadable: the persona's sets hold a read grant; objectRows: any set holds a row for the object at all.
    if (/FROM ObjectPermissions/.test(q)) return { records: (/ParentId IN/.test(q) ? objectReadable : objectRows) ? [{ Id: '0o' }] : [] };
    // readable: true, false, or the list of fields the persona can read.
    if (/FROM FieldPermissions/.test(q)) return { records: readable === true || (Array.isArray(readable) && readable.some((f) => q.includes(`.${f}'`))) ? [{ Id: '01k' }] : [] };
    if (/FROM ApexClass/.test(q)) return { records: apexClass ? [apexClass] : [] };
    if (/FROM SetupEntityAccess/.test(q)) return { records: q.match(/ParentId IN \(([^)]*)\)/)[1].split(',').some((x) => grantedBy.includes(x.replace(/'/g, ''))) ? [{ Id: '0Jx' }] : [] };
    if (/FROM MutingPermissionSet WHERE DeveloperName/.test(q)) return { records: mutingSet ? [{ Id: '0QMm' }] : [] };
    if (/NamespacePrefix != null/.test(q)) return { records: (/FROM PermissionSetGroup /.test(q) ? managed.groups : managed.sets).map((NamespacePrefix) => ({ NamespacePrefix })) };
    if (/PermissionsAuthorApex = true/.test(q)) return { records: q.match(/Id IN \(([^)]*)\)/)[1].split(',').some((x) => authorApex.includes(x.replace(/'/g, ''))) ? [{ Id: '0PS' }] : [] };
    // members: a group's components as [group, set name] pairs, a null set name for a muting set (named by a third item, else Mute); asked by PermissionSet.Name.
    if (/FROM MutingPermissionSet WHERE Id IN/.test(q)) return { records: members.flatMap(([, n, m], i) => (n ? [] : [{ Id: `0QMm${i}`, DeveloperName: m ?? 'Mute' }])) };
    if (/FROM PermissionSetGroupComponent/.test(q) && /PermissionSet\.Name/.test(q)) return { records: members.flatMap(([g, n], i) => (!q.includes(`'${g}'`) ? [] : [{ PermissionSetGroup: { DeveloperName: g, NamespacePrefix: null }, PermissionSetId: n ? `0PSm${i}` : `0QMm${i}`, PermissionSet: n && { Name: n, NamespacePrefix: null } }])) };
    // allData: the profile's set holds 'view' (View All Data) or 'modify' (Modify All Data).
    if (/FROM PermissionSet WHERE Profile.Name/.test(q)) return { records: noProfile ? [] : [{ Id: '0PSprofile', PermissionsViewAllData: allData === 'view', PermissionsModifyAllData: allData === 'modify' }] };
    // groupSet: the name is a group, found as its own set of Type Group.
    if (/FROM PermissionSet WHERE Name/.test(q)) return { records: setFound ? [{ Id: '0PSnamed', Type: groupSet ? 'Group' : 'Regular' }] : [] };
    if (/FROM CustomObject/.test(q)) return { records: noObject ? [] : [{ Id: '01I9H000000abcd', Metadata: { actionOverrides: [] } }] };
    // typed: the object has record types (Beta_Type, or the names listed), active unless typeActive is false. Master has no RecordType row.
    if (/FROM RecordType/.test(q)) return { records: typed ? [].concat(typed === true ? 'Beta_Type' : typed).map((DeveloperName) => ({ Id: '0129H000000beta', DeveloperName, NamespacePrefix: null, IsActive: typeActive })) : [] };
    if (/FROM ProfileLayout/.test(q)) return { records: rows || [{ LayoutId: '00hDEFAULT', Layout: { Name: 'Default Layout' }, RecordTypeId: null }, { LayoutId: '00hBETA', Layout: { Name: layout }, RecordTypeId: '0129H000000betaQAA' }, { LayoutId: '00hOTHER', Layout: { Name: 'Other' }, RecordTypeId: '0129H000000zzzzQAA' }] };
    if (/FROM Layout/.test(q)) return { records: md ? [{ Metadata: md }] : [] };
    if (/FROM FlexiPage/.test(q)) return { records: flexi ? [{ Metadata: flexi }] : [] };
    if (p.startsWith('/sobjects/')) return { name: objectName, fields: [].concat(describe) };
    throw new Error(`unexpected ${p}`);
  };
  return { api: { call, PINNED_VERSION: '60.0' }, asked };
}
const ORG_MD = (b) => ({ layoutSections: [{ layoutColumns: [{ layoutItems: [{ field: 'Name', behavior: 'Required' }, { field: 'Size__c', behavior: b }] }] }] });
const pageProject = (t, layoutXml, fieldXml) => {
  const p = project(t, [page('size', [LAYOUT])]);
  const put = (rel, text) => { const f = path.join(p.dir, D, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  if (layoutXml) put('layouts/SfUiTyped__c-SF UI Typed Layout.layout-meta.xml', layoutXml);
  if (fieldXml) put('objects/SfUiTyped__c/fields/Size__c.field-meta.xml', fieldXml);
  return p;
};
// A page check names the record type its object has: an org with none listed gets Beta_Type, as the old per-check query found it.
const BETA = { Id: '0129H000000beta', DeveloperName: 'Beta_Type', NamespacePrefix: null, IsActive: true };
const go = (p, o, extra = []) => {
  const call = o.api.call;
  // beta: false leaves an empty RecordType result empty, for a test of the missing-type error.
  o.api.call = async (s, q) => { const r = await call(s, q); return o.beta !== false && /FROM RecordType/.test(decodeURIComponent(q)) && !r.records.length ? { records: [BETA] } : r; };
  return run(['verify', '--org', 'x', '--checks', p.file, ...extra], { api: o.api, sf: async () => assert.fail('a page check runs no sf') });
};

test('pageRequired takes the layout from the branch first, the org otherwise, and says which', async (t) => {
  const p = pageProject(t, LAYOUT_XML('Required'));
  const branch = await go(p, org({ md: ORG_MD('Edit') }));
  assert.equal(branch.code, 0);
  assert.equal(branch.out[0], 'PASS size Size__c (layout SF UI Typed Layout from branch file: Required; readable from org)');
  const q = pageProject(t);
  const fromOrg = await go(q, org({ md: ORG_MD('Required') }));
  assert.equal(fromOrg.out[0], 'PASS size Size__c (layout SF UI Typed Layout from org: Required; readable from org)');
  const weak = await go(pageProject(t, LAYOUT_XML('Edit')), org({ md: ORG_MD('Required'), describe: { name: 'Size__c', nillable: true, createable: true, defaultedOnCreate: true } }));
  assert.equal(weak.code, 1);
  assert.match(weak.out[0], /^FAIL size Size__c required is false, the requirement says true \(layout SF UI Typed Layout from branch file: Edit; readable from org; field required false from org\)/);
  assert.equal(weak.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 1, passed 0, failed 1');
});

test('pageRequired picks the record type row, else the default row, and escapes every value in a query', async (t) => {
  const o = org({ md: ORG_MD('Required') });
  const p = pageProject(t);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona.profile = "O'Brien";
  fs.writeFileSync(p.file, JSON.stringify(c));
  await go(p, o);
  assert.ok(o.asked.some((q) => q.includes("Profile.Name = 'O\\'Brien'") && q.includes("TableEnumOrId = '01I9H000000abcd'")), o.asked.join('\n'));
  assert.ok(o.asked.some((q) => q.includes("FROM Layout WHERE Id = '00hBETA'")), 'the record-type row\'s layout by id, not the default row');
  const noRt = org({ md: ORG_MD('Required'), rows: [{ LayoutId: '00hDEFAULT', Layout: { Name: 'Default Layout' }, RecordTypeId: null }] });
  c.checks[0].recordType = undefined;
  fs.writeFileSync(p.file, JSON.stringify(c));
  await go(p, noRt);
  assert.ok(noRt.asked.some((q) => q.includes("FROM Layout WHERE Id = '00hDEFAULT'")), 'the null row without a record type');
  assert.ok(!noRt.asked.some((q) => /FROM RecordType/.test(q)));
  const named = await go(p, org({ md: ORG_MD('Required') }));
  assert.match(named.out[0], /^ERROR size Size__c name a recordType: SfUiTyped__c has record types/);
  c.checks[0].recordType = 'Beta_Type';
  fs.writeFileSync(p.file, JSON.stringify(c));
  const miss = await go(p, org({ md: ORG_MD('Required'), rows: [{ Layout: { Name: 'Default Layout' }, RecordTypeId: null }, { Layout: { Name: 'Other' }, RecordTypeId: '0129H000000zzzzQAA' }] }));
  assert.match(miss.out[0], /^ERROR size Size__c no layout row for record type Beta_Type on SfUiTyped__c/);
});

test('pageRequired on an object whose record types are all inactive does not ask for one to be named', async (t) => {
  const p = pageProject(t);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].recordType = undefined;
  fs.writeFileSync(p.file, JSON.stringify(c));
  const idle = await go(p, org({ md: ORG_MD('Required'), typed: true, typeActive: false }));
  assert.match(idle.out[0], /^PASS size Size__c \(layout Default Layout from org: Required/, idle.out.join('\n'));
  const live = await go(p, org({ md: ORG_MD('Required'), typed: true }));
  assert.match(live.out[0], /^ERROR size Size__c name a recordType: SfUiTyped__c has record types/, 'the control: an active type still has to be named');
});

test('pageRequired errors on a record type the object lacks, or one that is inactive', async (t) => {
  const p = pageProject(t);
  const run1 = async (o) => { o.beta = false; return (await go(p, o)).out[0]; };
  assert.match(await run1(org({ md: ORG_MD('Required') })), /^ERROR size Size__c no record type Beta_Type on SfUiTyped__c$/, 'the object has no record type at all');
  assert.match(await run1(org({ md: ORG_MD('Required'), typed: ['Other'] })), /^ERROR size Size__c no record type Beta_Type on SfUiTyped__c$/, 'only another one');
  assert.match(await run1(org({ md: ORG_MD('Required'), typed: true, typeActive: false })), /^ERROR size Size__c no active record type Beta_Type on SfUiTyped__c$/);
  assert.match(await run1(org({ md: ORG_MD('Required'), typed: true })), /^PASS size Size__c /, 'the control: an active one passes');
});

test('pageRequired takes Master as no record type, and shares one RecordType query per object with the other checks', async (t) => {
  const p = pageProject(t);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  const named = (id, recordType) => ({ ...c.checks[0], id, recordType });
  c.checks = [named('a', 'Beta_Type'), named('b', 'Beta_Type'), named('m', 'Master')];
  fs.writeFileSync(p.file, JSON.stringify(c));
  const o = org({ md: ORG_MD('Required'), typed: true });
  const r = await go(p, o);
  assert.match(r.out[2], /^PASS m Size__c \(layout Default Layout from org: Required/, r.out.join('\n'));
  assert.equal(o.asked.filter((q) => /FROM RecordType/.test(q)).length, 1, o.asked.join('\n'));
});

test('a record type name that several rows match takes the active one, then the local one over the own namespace', async (t) => {
  const row = (Id, NamespacePrefix, IsActive) => ({ Id: `0129H000000${Id}`, DeveloperName: 'Beta_Type', NamespacePrefix, IsActive });
  const layoutRow = (id) => ({ LayoutId: `00h${id}`, Layout: { Name: id }, RecordTypeId: `0129H000000${id}QAA` });
  const pick = async (types) => {
    const p = pageProject(t);
    fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'pk', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
    const o = org({ md: ORG_MD('Required'), rows: [layoutRow('local'), layoutRow('own'), layoutRow('idle')] });
    const call = o.api.call;
    o.api.call = async (s, q) => (/FROM RecordType/.test(decodeURIComponent(q)) ? { records: types } : call(s, q));
    const r = await go(p, o);
    return { r, layout: o.asked.find((q) => /FROM Layout WHERE Id/.test(q)) };
  };
  const a = await pick([row('idle', null, false), row('own', 'pk', true), row('local', null, true)]);
  assert.match(a.layout, /Id = '00hlocal'/, `${a.layout} ${a.r.out}`);
  const b = await pick([row('own', 'pk', true), row('local', null, true)]);
  assert.match(b.layout, /Id = '00hlocal'/, `${b.layout} ${b.r.out}`);
});

test('a field not on the layout is FAIL whatever the expectation says; field-level required counts', async (t) => {
  const o = org({ md: { layoutSections: [{ layoutColumns: [{ layoutItems: [{ field: 'Name', behavior: 'Required' }] }] }] } });
  const gone = await go(pageProject(t), o);
  assert.match(gone.out[0], /^FAIL size Size__c not on layout SF UI Typed Layout \(layout SF UI Typed Layout from org\)/);
  const p = pageProject(t, LAYOUT_XML('Edit'), '<CustomField><required>true</required></CustomField>');
  const fieldLevel = await go(p, org());
  assert.match(fieldLevel.out[0], /^PASS size Size__c \(layout SF UI Typed Layout from branch file: Edit; field required true from branch file\)/);
  const describe = await go(pageProject(t, LAYOUT_XML('Edit')), org({ describe: { name: 'Size__c', nillable: false, createable: true, defaultedOnCreate: false } }));
  assert.match(describe.out[0], /field required true from org/);
  const nothing = await go(pageProject(t, LAYOUT_XML('Edit')), org({ describe: { name: 'Other__c' } }));
  assert.match(nothing.out[0], /^ERROR size Size__c no field Size__c on SfUiTyped__c/);
  assert.equal(nothing.code, 1);
});

test('a check that names a flexiPage reads that page: its uiBehavior on the branch, else in the org', async (t) => {
  const p = project(t, [{ ...page('dyn', ['flexipages/SfUi_Dyn_Typed']), flexiPage: 'SfUi_Dyn_Typed', recordType: undefined }]);
  const org1 = org({ flexi: { flexiPageRegions: [{ itemInstances: [{ fieldInstance: { fieldItem: 'Record.Size__c', fieldInstanceProperties: [{ name: 'uiBehavior', value: 'required' }] } }] }] } });
  const r = await go(p, org1);
  assert.equal(r.out[0], 'PASS dyn Size__c (page SfUi_Dyn_Typed from org: required; readable from org)');
  const f = path.join(p.dir, D, 'flexipages/SfUi_Dyn_Typed.flexipage-meta.xml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, FLEXI_XML('readonly'));
  const b = await go(p, org1);
  assert.match(b.out[0], /^FAIL dyn Size__c required is false, the requirement says true \(page SfUi_Dyn_Typed from branch file: readonly; readable from org; field required false from org\)/);
});

test('a flexiPage check that names a record type the object lacks, or one inactive, is an ERROR; a real one or Master passes', async (t) => {
  const flexi = { flexiPageRegions: [{ itemInstances: [{ fieldInstance: { fieldItem: 'Record.Size__c', fieldInstanceProperties: [{ name: 'uiBehavior', value: 'required' }] } }] }] };
  const once = (recordType, o = {}) => go(project(t, [{ ...page('dyn', ['flexipages/SfUi_Dyn_Typed']), flexiPage: 'SfUi_Dyn_Typed', recordType }]), org({ flexi, typed: true, ...o }));
  const none = await once('No_Such_Type');
  assert.equal(none.code, 1, none.out.join('\n'));
  assert.match(none.out[0], /^ERROR dyn Size__c no record type No_Such_Type on SfUiTyped__c/);
  assert.match((await once('Beta_Type', { typeActive: false })).out[0], /^ERROR dyn Size__c no active record type Beta_Type/);
  for (const rt of ['Beta_Type', 'Master']) assert.match((await once(rt)).out[0], /^PASS dyn Size__c \(page SfUi_Dyn_Typed from org/, rt);

  // A record type only the branch adds is read from its file: active passes, inactive is an ERROR, whatever the org lacks.
  const branchRt = async (active) => {
    const p = project(t, [{ ...page('dyn', ['flexipages/SfUi_Dyn_Typed']), flexiPage: 'SfUi_Dyn_Typed', recordType: 'New_RT' }]);
    put(p, 'objects/SfUiTyped__c/recordTypes/New_RT.recordType-meta.xml', `<RecordType><active>${active}</active><label>New</label></RecordType>`);
    return (await go(p, org({ flexi, typed: true }))).out[0];
  };
  assert.match(await branchRt(true), /^PASS dyn Size__c \(page SfUi_Dyn_Typed from org/);
  assert.match(await branchRt(false), /^ERROR dyn Size__c no active record type New_RT on SfUiTyped__c/);
});

test('a page check that names its flexiPage with the own namespace prefix reads the unprefixed branch file', async (t) => {
  const p = project(t, [{ ...page('dyn', ['flexipages/SfUi_Dyn_Typed']), flexiPage: 'ns__SfUi_Dyn_Typed', recordType: undefined }]);
  inNamespace(p, 'ns');
  const f = path.join(p.dir, D, 'flexipages/SfUi_Dyn_Typed.flexipage-meta.xml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, FLEXI_XML('required'));
  assert.match((await go(p, org({}))).out[0], /^PASS dyn Size__c \(page ns__SfUi_Dyn_Typed from branch file: required;/);
});

test('the fixture check file is valid and every item it covers is a file in the fixture', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture/verify-checks.json'), 'utf8'));
  // With its project, as main reads it: a screen-flow check there gives no cases.
  assert.deepEqual(verify.badChecks(file, verify.loadProject(path.join(__dirname, 'fixture/verify-checks.json'))), []);
  const proj = { dirs: ['force-app'] };
  const keys = new Set(fs.readdirSync(path.join(__dirname, 'fixture/force-app'), { recursive: true }).map((f) => verify.itemOf(`force-app/${f}`, proj)?.key));
  const covers = file.checks.flatMap((c) => c.covers);
  assert.equal(covers.length, 27);
  assert.deepEqual(covers.filter((k) => !keys.has(k)), []);
});

// ---- against an org: SF_TESTER_ORG names a scratch org with test/fixture deployed; these are skipped without it ----
const ORG = process.env.SF_TESTER_ORG;
const live = { skip: !ORG && 'set SF_TESTER_ORG to a scratch org with test/fixture deployed' };
const FIXTURE_DIR = path.join(__dirname, 'fixture');

test('verify on the fixture with no --since is all green', live, async () => {
  const r = await run(['verify', '--org', ORG, '--checks', path.join(FIXTURE_DIR, 'verify-checks.json')], { sf: undefined, connect: undefined });
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 36, passed 35, failed 0, needs browser 1');
});

test('an unprefixed name of a managed set is an ERROR that names the set back, from the org and from the generated Apex', live, async (t) => {
  const dir = fixtureCopy(t, 'verify-hint-');
  const persona = { profile: 'Standard Platform User', permissionSets: ['SalesConsoleUser'] };
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'verify-checks.json'), 'utf8')).checks;
  const checks = ['probe-count-rule', 'typed-size-required'].map((id) => ({ ...base.find((c) => c.id === id), persona }));
  fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks }));
  const r = await run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => /^ERROR typed-size-required .*not found: SalesConsoleUser; did you mean force__SalesConsoleUser\? \(requirement/.test(l)), r.out.join('\n'));
  assert.ok(r.out.some((l) => /^ERROR probe-count-rule .*not found: SalesConsoleUser; did you mean force__SalesConsoleUser\?/.test(l)), r.out.join('\n'));
});

test('a persona that names a muting set is an ERROR that says so, from the generated Apex', live, async (t) => {
  const dir = fixtureCopy(t, 'verify-mute-hint-');
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'verify-checks.json'), 'utf8')).checks;
  const checks = [{ ...base.find((c) => c.id === 'probe-count-rule'), persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe_Mute'] } }];
  fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks }));
  const r = await run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => /^ERROR probe-count-rule .*not found: SfUi_Probe_Mute; it is a muting set, name its group/.test(l)), r.out.join('\n'));
});

// The fixture in a temp dir, less its .sf and .sfdx state, removed when the test ends.
function fixtureCopy(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true, filter: (f) => !/\/\.sf(dx)?(\/|$)/.test(f) });
  return dir;
}

// A copy of the fixture as a git repo with one commit, a change applied and staged, then verify --since HEAD.
async function changed(t, edit, extra = [], checks) {
  const dir = fixtureCopy(t, 'verify-red-');
  if (checks) fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks }));
  const git = (...a) => require('node:child_process').execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  edit((f) => path.join(dir, D, f));
  git('add', '-A');
  return run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json'), '--since', 'HEAD', ...extra], { sf: undefined, connect: undefined });
}
const rewrite = (f, from, to) => { const s = fs.readFileSync(f, 'utf8'); assert.ok(s.includes(from), `${from} is in ${f}`); fs.writeFileSync(f, s.replace(from, to)); };

test('red proof: weakening SfUi_Count_Not_Negative goes red', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(`${RULE}.validationRule-meta.xml`), 'Count__c &lt; 0', 'Count__c &lt; -100'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL probe-count-rule rejects negative')), r.out.join('\n'));
});

test('red proof: a carried repo test that fails turns verify red and is named in a row of its own, beside a case that fails or passes', live, async (t) => {
  const cls = (n, src) => (at) => { fs.writeFileSync(at(`classes/${n}.cls`), src); fs.writeFileSync(at(`classes/${n}.cls-meta.xml`), '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>66.0</apiVersion><status>Active</status></ApexClass>\n'); };
  const carry = (at) => {
    cls('SfUiCarried', 'public class SfUiCarried { public static Integer one() { return 1; } }')(at);
    cls('SfUiCarriedTest', "@IsTest private class SfUiCarriedTest { @IsTest static void t() { System.assertEquals(2, SfUiCarried.one(), 'carried test fails on purpose'); } }")(at);
  };
  const named = (r) => r.out.some((l) => /^ERROR carried SfUiCarriedTest\.t carried test failed: .*carried test fails on purpose/.test(l));
  const r = await changed(t, (at) => { rewrite(at(`${RULE}.validationRule-meta.xml`), 'A business rule', 'A carried-test business rule'); carry(at); }, ['--only', '^probe-count-rule$']);
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(named(r), r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('PASS probe-count-rule rejects negative')), r.out.join('\n'));
  // A weakened rule beside it: the case FAIL stands, and the carried test is still named.
  const mixed = await changed(t, (at) => { rewrite(at(`${RULE}.validationRule-meta.xml`), 'Count__c &lt; 0', 'Count__c &lt; -5'); carry(at); }, ['--only', '^probe-count-rule$']);
  assert.ok(mixed.out.some((l) => l.startsWith('FAIL probe-count-rule rejects negative')), mixed.out.join('\n'));
  assert.ok(named(mixed), mixed.out.join('\n'));
});

test('red proof: Size__c back to Edit on SF UI Typed Layout goes red', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('layouts/SfUiTyped__c-SF UI Typed Layout.layout-meta.xml'), '<behavior>Required</behavior><field>Size__c', '<behavior>Edit</behavior><field>Size__c'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL typed-size-required Size__c required is false')), r.out.join('\n'));
});

test('green proof: a description edit on the rule and a help text edit on Size__c stay green', live, async (t) => {
  const r = await changed(t, (at) => {
    rewrite(at(`${RULE}.validationRule-meta.xml`), '<description>A business rule', '<description>An edited business rule');
    rewrite(at('objects/SfUiTyped__c/fields/Size__c.field-meta.xml'), '<label>Size</label>', '<inlineHelpText>How many</inlineHelpText>\n    <label>Size</label>');
  });
  assert.equal(r.code, 0, r.out.join('\n'));
  // The rule and Size__c are changed and covered; their three checks run four cases and all pass.
  assert.equal(r.out.at(-1), 'changed 2, covered 2, uncovered 0, ran 4, passed 4, failed 0', r.out.join('\n'));
});

const GATED_FILE = 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml';

test('red proof: a rule that hides the component from every user goes red', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(GATED_FILE), '<rightValue>High</rightValue>', '<rightValue>Nobody</rightValue>'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL dyn-more-gated shown when High and open')), r.out.join('\n'));
});

test('red proof: stripping the custom permission from SfUi_Probe hides the component and goes red', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('permissionsets/SfUi_Probe.permissionset-meta.xml'), '    <customPermissions><enabled>true</enabled><name>SfUi_See_More</name></customPermissions>\n', ''));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL dyn-more-gated shown when High and open')), r.out.join('\n'));
});

test('green proof: a label edit on the gated page stays green', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(GATED_FILE), '<masterLabel>SF UI Dyn Gated Page</masterLabel>', '<masterLabel>SF UI Dyn Gated Page Renamed</masterLabel>'));
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 5, passed 5, failed 0', r.out.join('\n'));
});

const GATE_FILE = 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml';

test('red proof: a dynamic action rule that hides Delete from every persona, administrator included, goes red', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(GATE_FILE), '<rightValue>High</rightValue>', '<rightValue>Nobody</rightValue>'));
  assert.equal(r.code, 1, r.out.join('\n'));
  for (const id of ['gate-delete-action', 'gate-delete-action-user']) assert.ok(r.out.some((l) => l.startsWith(`FAIL ${id} offered when High`)), r.out.join('\n'));
});

test('green proof: a label edit on the gate page stays green', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(GATE_FILE), '<masterLabel>SF UI Gate Record Page</masterLabel>', '<masterLabel>SF UI Gate Record Page Renamed</masterLabel>'));
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 7, passed 7, failed 0', r.out.join('\n'));
});

test('red proof: stripping the class grant from SfUi_Probe goes red and names the class API version', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('permissionsets/SfUi_Probe.permissionset-meta.xml'), '    <classAccesses><apexClass>SfUiProbeController</apexClass><enabled>true</enabled></classAccesses>\n', ''));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL probe-class-access SfUiProbeController') && l.includes('class API 66.0')), r.out.join('\n'));
});

test('green proof: a description edit on SfUi_Probe keeps the class check green', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('permissionsets/SfUi_Probe.permissionset-meta.xml'), '<label>SF UI Probe</label>', '<description>An edited probe set</description>\n    <label>SF UI Probe</label>'));
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('PASS probe-class-access SfUiProbeController')), r.out.join('\n'));
});

// A check whose persona names a fixture group holding SfUi_Probe; it covers SfUi_Probe, which no persona names.
const groupClass = (group) => [{ id: 'group-class-access', kind: 'classAccess', requirement: 'A group user can call the probe controller', covers: ['classes/SfUiProbeController', 'permissionsets/SfUi_Probe'], persona: { profile: 'Standard Platform User', permissionSets: [group] }, class: 'SfUiProbeController', expect: { access: true } }];
const SET_FILE = 'permissionsets/SfUi_Probe.permissionset-meta.xml';
const CLASS_GRANT = '    <classAccesses><apexClass>SfUiProbeController</apexClass><enabled>true</enabled></classAccesses>\n';

test('red and green proof: a group member set is covered and read from the branch; a muted group\'s muting set takes its grant away', live, async (t) => {
  const green = await changed(t, (at) => rewrite(at(SET_FILE), '<label>SF UI Probe</label>', '<description>An edited probe set</description>\n    <label>SF UI Probe</label>'), [], groupClass('SfUi_Probe_Group'));
  assert.equal(green.code, 0, green.out.join('\n'));
  assert.ok(green.out.includes('PASS group-class-access SfUiProbeController (branch permission set SfUi_Probe in group SfUi_Probe_Group; class API 66.0 from branch)'), green.out.join('\n'));
  const red = await changed(t, (at) => rewrite(at(SET_FILE), CLASS_GRANT, ''), [], groupClass('SfUi_Probe_Group'));
  assert.equal(red.code, 1, red.out.join('\n'));
  assert.ok(red.out.some((l) => l.startsWith('FAIL group-class-access SfUiProbeController Standard Platform User + SfUi_Probe_Group cannot call')), red.out.join('\n'));
  assert.equal(red.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 0, failed 1', red.out.join('\n'));
  // SfUi_Probe_Mute mutes the class SfUi_Probe grants: the muted group cannot call it, and dropping that row on the branch lets it.
  const describe = (at) => rewrite(at(SET_FILE), '<label>SF UI Probe</label>', '<description>An edited probe set</description>\n    <label>SF UI Probe</label>');
  const muted = await changed(t, describe, [], groupClass('SfUi_Probe_Muted_Group'));
  assert.equal(muted.code, 1, muted.out.join('\n'));
  assert.ok(muted.out.some((l) => l.startsWith('FAIL group-class-access SfUiProbeController Standard Platform User + SfUi_Probe_Muted_Group cannot call')), muted.out.join('\n'));
  const deny = groupClass('SfUi_Probe_Muted_Group').map((c) => ({ ...c, expect: { access: false } }));
  const denied = await changed(t, describe, [], deny);
  assert.equal(denied.code, 0, denied.out.join('\n'));
  const unmuted = await changed(t, (at) => { describe(at); rewrite(at('mutingpermissionsets/SfUi_Probe_Mute.mutingpermissionset-meta.xml'), CLASS_GRANT, ''); }, [], groupClass('SfUi_Probe_Muted_Group'));
  assert.ok(unmuted.out.includes('PASS group-class-access SfUiProbeController (branch permission set SfUi_Probe in group SfUi_Probe_Muted_Group; class API 66.0 from branch)'), unmuted.out.join('\n'));
});

// SfUi_Probe_Mute mutes Grade__c and SfUiDyn__c, which SfUi_Probe grants and no live check reads through the muted group.
test('the org holds a muting set\'s field and object rows under its 0QM id, and its group\'s own set lacks them', live, async () => {
  const api = require('../src/api');
  const rest = async (q) => (await api.call(s, `/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records;
  const s = await verify.defaultConnect(ORG, api);
  const [mute] = await rest("SELECT Id FROM MutingPermissionSet WHERE DeveloperName = 'SfUi_Probe_Mute'");
  assert.match(mute.Id, /^0QM/);
  const field = (id) => rest(`SELECT Id FROM FieldPermissions WHERE Field = 'SfUiTyped__c.Grade__c' AND PermissionsRead = true AND ParentId = '${id}'`);
  const object = (id) => rest(`SELECT Id FROM ObjectPermissions WHERE SobjectType = 'SfUiDyn__c' AND PermissionsRead = true AND ParentId = '${id}'`);
  assert.equal((await field(mute.Id)).length, 1, 'the muted field row, by the 0QM id');
  assert.equal((await object(mute.Id)).length, 1, 'the muted object row, by the 0QM id');
  const own = async (g) => (await rest(`SELECT Id FROM PermissionSet WHERE Name = '${g}' AND Type = 'Group'`))[0].Id;
  const [muted, plain] = [await own('SfUi_Probe_Muted_Group'), await own('SfUi_Probe_Group')];
  assert.deepEqual([(await field(muted)).length, (await object(muted)).length], [0, 0], 'the muted group\'s own set has the grants less the muting');
  assert.deepEqual([(await field(plain)).length, (await object(plain)).length], [1, 1], 'control: the group with no muting keeps them');
});

test('verify reads an org-only muting set\'s field row by its 0QM id: the muted group cannot read Grade__c', live, async (t) => {
  const grade = (group) => [{ id: 'muted-grade', kind: 'pageRequired', requirement: 'Grade is optional on the Beta form', covers: ['objects/SfUiTyped__c/fields/Grade__c'], persona: { profile: 'Standard Platform User', permissionSets: [group] }, object: 'SfUiTyped__c', recordType: 'Beta_Type', field: 'Grade__c', expect: { required: false } }];
  // The member and muting files go, so the group file's names are read from the org by id.
  const runIt = async (group) => {
    const dir = fixtureCopy(t, 'verify-mute-');
    fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks: grade(group) }));
    for (const f of [SET_FILE, 'mutingpermissionsets/SfUi_Probe_Mute.mutingpermissionset-meta.xml']) fs.rmSync(path.join(dir, D, f));
    return run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  };
  const muted = await runIt('SfUi_Probe_Muted_Group');
  assert.ok(muted.out.some((l) => l.startsWith('FAIL muted-grade Grade__c Standard Platform User + SfUi_Probe_Muted_Group cannot read Grade__c')), muted.out.join('\n'));
  const plain = await runIt('SfUi_Probe_Group');
  assert.ok(plain.out.some((l) => l.startsWith('PASS muted-grade Grade__c') && l.includes('readable from org member of branch group SfUi_Probe_Group')), plain.out.join('\n'));
});

test('red proof: a group file that takes SfUi_Probe out of the group leaves it uncovered, and its grant no longer counts', live, async (t) => {
  const swap = (at) => { rewrite(at(SET_FILE), '<label>SF UI Probe</label>', '<description>An edited probe set</description>\n    <label>SF UI Probe</label>'); rewrite(at('permissionsetgroups/SfUi_Probe_Group.permissionsetgroup-meta.xml'), '<permissionSets>SfUi_Probe</permissionSets>', '<permissionSets>SfUi_Gate_NoteOnly</permissionSets>'); };
  const r = await changed(t, swap, [], groupClass('SfUi_Probe_Group'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.includes('UNCOVERED permissionsets/SfUi_Probe: group-class-access cover it but do not read it'), r.out.join('\n'));
  // With no --since the check runs, and the group is judged from its file's members.
  const dir = fixtureCopy(t, 'verify-group-');
  fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks: groupClass('SfUi_Probe_Group') }));
  swap((f) => path.join(dir, D, f));
  const all = await run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  assert.ok(all.out.some((l) => l.startsWith('FAIL group-class-access SfUiProbeController Standard Platform User + SfUi_Probe_Group cannot call')), all.out.join('\n'));
});

test('red proof: a changed validation rule no check covers is UNCOVERED', live, async (t) => {
  const r = await changed(t, (at) => {
    const rule = fs.readFileSync(at(`${RULE}.validationRule-meta.xml`), 'utf8').replace('SfUi_Count_Not_Negative', 'SfUi_Brand_New');
    fs.writeFileSync(at('objects/SfUiProbe__c/validationRules/SfUi_Brand_New.validationRule-meta.xml'), rule);
  });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.includes('UNCOVERED objects/SfUiProbe__c/validationRules/SfUi_Brand_New'), r.out.join('\n'));
});

test('an UNCOVERED item alone makes the run red, with every selected check passing', async (t) => {
  const two = rec('count-rule', [RULE], { cases: THREE.cases.slice(0, 2) });
  const { dir, file } = project(t, [two]);
  const sf = async (args) => (args[2] === 'validate' ? OK_ENVELOPE : REPORT);
  touch(dir, [`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`, `${D}objects/SfUiProbe__c/fields/Gone__c.field-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git, sf });
  assert.equal(r.out.at(-1), 'changed 2, covered 1, uncovered 1, ran 2, passed 2, failed 0');
  assert.equal(r.code, 1);
});

test('a package path written ./force-app, force-app/ or with a backslash still matches git paths', (t) => {
  for (const written of ['./force-app', 'force-app/', 'force-app\\', '.\\force-app\\', './force-app//']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: written }], sourceApiVersion: '66.0' }));
    fs.writeFileSync(path.join(dir, 'checks.json'), '{}');
    const proj = verify.loadProject(path.join(dir, 'checks.json'));
    assert.equal(verify.itemOf(`${D}${RULE}.validationRule-meta.xml`, proj)?.key, RULE, written);
  }
});

test('an sfdx-project.json of the wrong shape is bad usage; one with no packageDirectories has none', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sfdx-project.json');
  for (const json of ['null', '[]', '{"packageDirectories":{}}', '{"packageDirectories":[{"package":"x"}]}']) {
    fs.writeFileSync(file, json);
    assert.throws(() => verify.loadProject(path.join(dir, 'checks.json')), (e) => e instanceof verify.Usage && /has no valid packageDirectories/.test(e.message), json);
  }
  fs.writeFileSync(file, '{}');
  assert.deepEqual(verify.readProject(file).dirs, [], 'control: no key');
});

test('--only that filters out every check covering a changed item prints NOT RUN for it and counts it, not red', async (t) => {
  const due = 'objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000';
  const { dir, file } = project(t, [rec('count-rule', [RULE], { cases: THREE.cases.slice(0, 2) }), rec('due-rule', [due], { cases: THREE.cases.slice(0, 2) })]);
  const files = [`${D}${RULE}.validationRule-meta.xml`, `${D}${due}.validationRule-meta.xml`];
  touch(dir, files);
  const sf = async (args) => (args[2] === 'validate' ? OK_ENVELOPE : REPORT);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main', '--only', '^count-rule$'], { git: gitOf(files), sf });
  assert.ok(r.out.includes(`NOT RUN ${due} (--only)`), r.out.join('\n'));
  assert.ok(!r.out.includes(`NOT RUN ${RULE} (--only)`));
  assert.equal(r.out.at(-1), 'changed 2, covered 2, uncovered 0, ran 2, passed 2, failed 0, not run 1');
  assert.equal(r.code, 0);
});

test('pageRequired fails a field the persona cannot read, from the profile set, named sets and a group\'s own set', async (t) => {
  const p = pageProject(t, LAYOUT_XML('Required'));
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] };
  fs.writeFileSync(p.file, JSON.stringify(c));
  const o = org({ readable: false });
  const r = await go(p, o);
  assert.match(r.out[0], /^FAIL size Size__c Standard Platform User \+ SfUi_Probe cannot read Size__c/);
  assert.equal(r.code, 1);
  const fls = o.asked.find((q) => /FROM FieldPermissions/.test(q));
  assert.match(fls, /Field = 'SfUiTyped__c\.Size__c' AND PermissionsRead = true AND ParentId IN \('0PSprofile','0PSnamed'\)/);
  // An org group with no member on the branch is read through its own set of Type Group, which holds its members' grants less its muting.
  const grp = org({ groupSet: true, members: [['SfUi_Probe', 'A'], ['SfUi_Probe', 'B']] });
  assert.equal((await go(p, grp)).code, 0);
  assert.match(grp.asked.find((q) => /FROM FieldPermissions/.test(q)), /IN \('0PSprofile','0PSnamed'\)/);
  const gone = await go(p, org({ setFound: false }));
  assert.match(gone.out[0], /^ERROR size Size__c permission set or group not found: SfUi_Probe$/);
  const hint = await go(p, org({ setFound: false, managed: { sets: ['pkg'], groups: ['pkg', 'other'] } }));
  assert.match(hint.out[0], /^ERROR size Size__c permission set or group not found: SfUi_Probe; did you mean pkg__SfUi_Probe or other__SfUi_Probe\?$/, 'named back, never taken');
  const mute = await go(p, org({ setFound: false, mutingSet: true, managed: { sets: ['pkg'], groups: [] } }));
  assert.match(mute.out[0], /not found: SfUi_Probe; it is a muting set, name its group$/, 'a muting set named directly is named as one, not as a typo');
  const down = org({ setFound: false });
  const call = down.api.call;
  down.api.call = async (x, q) => (/NamespacePrefix != null/.test(decodeURIComponent(q)) ? Promise.reject(new Error('HTTP 503')) : call(x, q));
  assert.match((await go(p, down)).out[0], /not found: SfUi_Probe; the hint lookup failed: HTTP 503$/, 'a failed hint keeps the cause');
  const named = project(t, [{ ...page('size', [LAYOUT]), persona: { profile: 'Standard Platform User', permissionSets: ['zz__SfUi_Probe'] } }]);
  const pre = org({ setFound: false, managed: { sets: ['pkg'], groups: [] } });
  assert.match((await go(named, pre)).out[0], /not found: zz__SfUi_Probe$/, 'a prefixed name gets no hint');
  assert.ok(!pre.asked.some((q) => /NamespacePrefix != null/.test(q)), 'and asks nothing more');
  const asked = org({ setFound: false });
  await go(p, asked);
  assert.ok(asked.asked.some((q) => /FROM PermissionSet WHERE Name = 'SfUi_Probe' AND NamespacePrefix != null AND IsOwnedByProfile = false$/.test(q)), 'no dead Type filter: ' + asked.asked.join('\n'));
});

test('a field with no permissions to set is always readable, and a branch-added required field too', async (t) => {
  const p = pageProject(t, LAYOUT_XML('Required'));
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: [] };
  fs.writeFileSync(p.file, JSON.stringify(c));
  const o = org({ readable: false, describe: { name: 'Size__c', permissionable: false, nillable: false, createable: true } });
  assert.equal((await go(p, o)).code, 0);
  assert.ok(!o.asked.some((q) => /FROM FieldPermissions/.test(q)));
  const added = pageProject(t, LAYOUT_XML('Required'), '<CustomField><required>true</required></CustomField>');
  assert.equal((await go(added, org({ readable: false, describe: { name: 'Other__c' } }))).code, 0);
});

test('a namespaced custom object is looked up by DeveloperName and NamespacePrefix, a plain one with a null prefix', async (t) => {
  const p = pageProject(t);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  for (const [object, want] of [['ns__My_Obj__c', "DeveloperName = 'My_Obj' AND NamespacePrefix = 'ns' ORDER BY NamespacePrefix NULLS FIRST LIMIT 1"], ['SfUiTyped__c', "DeveloperName = 'SfUiTyped' AND NamespacePrefix = null ORDER BY NamespacePrefix NULLS FIRST LIMIT 1"]]) {
    c.checks[0].object = object;
    fs.writeFileSync(p.file, JSON.stringify(c));
    const o = org({ md: ORG_MD('Required') });
    await go(p, o);
    assert.ok(o.asked.some((q) => q.includes(`FROM CustomObject WHERE ${want}`)), o.asked.join('\n'));
  }
});

test('an item moved between package directories is not deleted: only an item with every changed path deleted is', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE], { cases: THREE.cases.slice(0, 2) })]);
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }, { path: 'other' }], sourceApiVersion: '66.0' }));
  touch(dir, [`${D}${RULE}.validationRule-meta.xml`]);
  const git = gitOf([`other/main/default/${RULE}.validationRule-meta.xml`, `${D}${RULE}.validationRule-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git, sf: async (args) => (args[2] === 'validate' ? OK_ENVELOPE : REPORT) });
  assert.ok(!r.out.some((l) => /deleted on the branch/.test(l)), r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 2, passed 2, failed 0');
});

test('a branch field file of type MasterDetail counts as required on the form', async (t) => {
  const p = pageProject(t, LAYOUT_XML('Edit'), '<CustomField><type>MasterDetail</type></CustomField>');
  const r = await go(p, org());
  assert.match(r.out[0], /^PASS size Size__c \(.*field required true from branch file\)/);
});

test('a JSON integer is an Integer literal, a larger safe one a Long, anything else a Decimal', () => {
  const c = rec('n', [F_K], { cases: [{ name: 'a', fields: { A__c: 5, B__c: 2147483647, C__c: 2147483648, D__c: -3000000000, E__c: 1.5, F__c: 5.0, G__c: -2147483648, H__c: -2147483649 }, expect: { saves: true } }, { name: 'b', fields: {}, expect: { saves: false, error: 'x' } }] });
  const { apex } = verify.generate([c]);
  for (const want of ["'A__c', 5)", "'B__c', 2147483647)", "'C__c', 2147483648L)", "'D__c', -3000000000L)", "'E__c', Decimal.valueOf('1.5'))", "'F__c', 5)", "'G__c', Integer.valueOf('-2147483648'))", "'H__c', -2147483649L)"]) assert.ok(apex.includes(`rec.put(${want}`), want);
});

test('BAD_CHECK for a date that does not round-trip, a datetime on one, and an integer past the safe range', () => {
  const bad = (v) => verify.badChecks({ checks: [rec('a', [F_X], { cases: [...rec('a', [F_X]).cases, { name: 'd', fields: { F__c: v }, expect: { saves: true } }] })] })[0];
  assert.match(bad({ date: '2026-13-45' }), /^a: case "d": bad field F__c/);
  assert.match(bad({ date: '2026-02-30' }), /bad field/);
  assert.match(bad({ datetime: '2026-02-30T10:00:00Z' }), /bad field/);
  for (const t of ['2026-01-01T24:00:00Z', '2026-01-01T10:60:00Z', '2026-01-01T10:00:60Z', '2026-01-01T25:00Z']) assert.match(bad({ datetime: t }), /bad field/, t);
  assert.match(bad(9007199254740993), /bad field/);
  assert.match(bad(1e21), /bad field/);
  for (const ok of [{ date: '2024-02-29' }, { datetime: '2026-01-31T10:00:00Z' }, { datetime: '2026-01-31T10:00+01:00' }, { datetime: '2026-01-31T23:59:59.999Z' }, 9007199254740991, 1.5, 0, -7]) assert.equal(bad(ok), undefined, JSON.stringify(ok));
});

test('a field matches a layout or page item in any case, and a layout item with no behavior reads as Edit', async (t) => {
  const lower = await go(pageProject(t, LAYOUT_XML('Required').replace('Size__c', 'size__C')), org());
  assert.equal(lower.out[0], 'PASS size Size__c (layout SF UI Typed Layout from branch file: Required; readable from org)');
  const none = '<Layout><layoutSections><layoutColumns><layoutItems><field>Size__c</field></layoutItems></layoutColumns></layoutSections></Layout>';
  assert.deepEqual(verify.layoutXml(none), { Size__c: 'Edit' });
  const edit = await go(pageProject(t, none), org());
  assert.match(edit.out[0], /^FAIL size Size__c required is false.*branch file: Edit/);
  const fromOrg = await go(pageProject(t), org({ md: { layoutSections: [{ layoutColumns: [{ layoutItems: [{ field: 'SIZE__C' }] }] }] } }));
  assert.match(fromOrg.out[0], /^FAIL size Size__c required is false.*org: Edit/);
});

test('a malformed sfdx-project.json is bad usage, exit 2, not a crash', async (t) => {
  const { dir, file } = project(t, [rec('a', [RULE])]);
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), '{ "packageDirectories": [');
  const r = await run(['verify', '--org', 'o', '--checks', file]);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /sfdx-project\.json is not JSON/);
});

test('BAD_CHECK for two cases with one name, and for a recordType or flexiPage that is not a plain API name', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  const same = rec('a', [F_X]);
  same.cases[1].name = same.cases[0].name;
  assert.match(bad(same), /^a: two cases have the same name/);
  assert.match(bad({ ...page('p', [F_X]), recordType: '../x' }), /^p: recordType must be a plain API name/);
  assert.match(bad({ ...page('p', [F_X]), flexiPage: "A' OR Id != '" }), /flexiPage must be a plain API name/);
  assert.match(bad({ ...page('p', [F_X]), flexiPage: 5 }), /flexiPage must be/);
  assert.equal(bad({ ...page('p', [F_X]), flexiPage: 'SfUi_Dyn_Record_Page', recordType: 'Beta_Type' }), undefined);
});

test('two deleted items of one check have different case names, and replay.junit keeps its own suite and error name', async (t) => {
  const due = 'objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000';
  const { file } = project(t, [rec('both', [RULE, due])]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}${RULE}.validationRule-meta.xml`, `${D}${due}.validationRule-meta.xml`]), sf: async () => assert.fail('no validate') });
  assert.deepEqual(r.out.filter((l) => l.startsWith('FAIL')).map((l) => l.split(' ')[2]), [RULE, due]);
  const xml = require('../src/replay').junit([], ['boom']);
  assert.match(xml, /<testsuite name="sf-tester replay" tests="1"/);
  assert.match(xml, /<testcase classname="sf-tester.replay" name="replay" time="0.000"><error message="boom"\/>/);
});

test('a parse error on verify prints the verify usage, and on replay the replay usage', async () => {
  const v = await run(['verify', '--nope']);
  assert.equal(v.code, 2);
  assert.match(v.out.at(-1), /\nusage: sf-tester verify /);
  const r = await run(['replay', '--nope']);
  assert.match(r.out.at(-1), /\nusage: sf-tester replay /);
});

test('the stop signal reaches sf, and a stopped validate removes the temp folder', async (t) => {
  const ac = new AbortController();
  const { file } = project(t, [THREE]);
  let got;
  const sf = async (args, { cwd, signal }) => { got = { cwd, signal }; return NOJOB(); };
  await run(['verify', '--org', 'o', '--checks', file], { sf, signal: ac.signal });
  assert.equal(got.signal, ac.signal);
  assert.equal(fs.existsSync(got.cwd), false);
  // The real runner: an aborted sf child ends at once instead of running out its 30 minutes.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-sf-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, 'sf'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const was = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${was}`;
  t.after(() => { process.env.PATH = was; });
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 150);
  const t0 = Date.now();
  await assert.rejects(verify.execSf(['x'], { cwd: bin, signal: stop.signal }), { name: 'AbortError' });
  assert.ok(Date.now() - t0 < 5000);
});

test('a FlexiPage check does not look up the custom object, which only a layout needs', async (t) => {
  const p = project(t, [{ ...page('dyn', ['flexipages/SfUi_Dyn_Typed']), flexiPage: 'SfUi_Dyn_Typed', recordType: undefined }]);
  const o = org({ flexi: { flexiPageRegions: [{ itemInstances: [{ fieldInstance: { fieldItem: 'Record.Size__c', fieldInstanceProperties: [{ name: 'uiBehavior', value: 'required' }] } }] }] } });
  assert.equal((await go(p, o)).code, 0);
  assert.ok(!o.asked.some((q) => /FROM CustomObject/.test(q)), o.asked.join('\n'));
});

test('BAD_CHECK for an expect.error that is not a string, on a case that saves or not', () => {
  const bad = (i, error) => { const c = rec('a', [F_X]); c.cases[i].expect.error = error; return verify.badChecks({ checks: [c] })[0]; };
  assert.match(bad(0, 5), /^a: case "rejects": expect.error must be a string/);
  assert.match(bad(1, ['x']), /^a: case "accepts": expect.error must be a string/);
  assert.equal(bad(1, undefined), undefined);
});

test('a persona or object that cannot be built is ERROR, not a failed requirement', async (t) => {
  const { apex } = verify.generate([{ ...THREE, persona: { profile: 'P', permissionSets: ['S'] } }]);
  assert.match(apex, /if \(ns == null && groups\.isEmpty\(\)\) \{\s*Set<String> named = new Set<String>\(\);\s*for \(PermissionSet m : \[SELECT NamespacePrefix FROM PermissionSet WHERE Name = :nm AND NamespacePrefix != null AND IsOwnedByProfile = false WITH SYSTEM_MODE\]\) named\.add\(m\.NamespacePrefix \+ '__' \+ nm\);\s*for \(PermissionSetGroup m : \[SELECT NamespacePrefix FROM PermissionSetGroup WHERE DeveloperName = :nm AND NamespacePrefix != null WITH SYSTEM_MODE\]\) named\.add/, 'the generated persona names each managed set or group back once');
  assert.match(apex, /if \(groups\.isEmpty\(\)\) System\.assert\(\[SELECT Id FROM MutingPermissionSet WHERE DeveloperName = :nm WITH SYSTEM_MODE LIMIT 1\]\.isEmpty\(\), .*it is a muting set, name its group'\);/, 'the generated persona names a muting set as one');
  for (const want of ["'SETUP: profile not found: '", "'SETUP: permission set or group not found: ' + full", "'SETUP: object not found: '", "try { insert as system a; } catch (DmlException e) { System.assert(false, 'SETUP: '"]) assert.ok(apex.includes(want), want);
  const { file } = project(t, [THREE]);
  const failing = REPORT.replace('E1 CONTROL: Count cannot be negative', 'SETUP: profile not found: P');
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf: async (args) => (args[2] === 'validate' ? OK_ENVELOPE : failing) });
  assert.ok(r.out.some((l) => l.startsWith('ERROR count-rule wrong expectation SETUP: profile not found: P')), r.out.join('\n'));
  assert.ok(!r.out.some((l) => l.startsWith('FAIL')));
});

test('--only that leaves a single changed item with nothing to run is green with NOT RUN, not exit 2', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE]), rec('zzz', ['objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000'])]);
  const files = [`${D}${RULE}.validationRule-meta.xml`];
  touch(dir, files);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main', '--only', '^zzz$'], { git: gitOf(files), sf: async () => assert.fail('nothing runs') });
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.ok(r.out.includes(`NOT RUN ${RULE} (--only)`));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 0, passed 0, failed 0, not run 1');
});

test('a check that covers a deleted item and a live one is dropped; the live item is NOT RUN unless another check covers it', async (t) => {
  const due = 'objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000';
  const both = rec('both', [RULE, due], { cases: THREE.cases.slice(0, 2) });
  const { dir, file } = project(t, [both, rec('rule-only', [RULE], { cases: THREE.cases.slice(0, 2) })]);
  touch(dir, [`${D}${RULE}.validationRule-meta.xml`]);
  const git = gitOf([`${D}${RULE}.validationRule-meta.xml`, `${D}${due}.validationRule-meta.xml`]);
  const sf = async (args) => (args[2] === 'validate' ? OK_ENVELOPE : REPORT);
  const covered = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git, sf });
  assert.ok(!covered.out.some((l) => l.startsWith('NOT RUN')), 'rule-only still runs the live item');
  const alone = project(t, [both]);
  touch(alone.dir, [`${D}${RULE}.validationRule-meta.xml`]);
  const r = await run(['verify', '--org', 'o', '--checks', alone.file, '--since', 'main'], { git, sf: async () => assert.fail('both is dropped') });
  assert.ok(r.out.includes(`NOT RUN ${RULE} (a covering check covers or selects a deleted item)`), r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 2, covered 2, uncovered 0, ran 1, passed 0, failed 1, not run 1');
  assert.equal(r.code, 1);
});

test('a describe 404: a FlexiPage check carries on from the branch, a layout check needs the object deployed, a wrong name is ERROR', async (t) => {
  const o404 = (extra = {}) => { const o = org({ noObject: true, ...extra }); const was = o.api.call; o.api.call = async (s, p) => { if (p.startsWith('/sobjects/')) throw Object.assign(new Error('GET describe answered 404'), { evidence: { status: 404 } }); return was(s, p); }; return o; };
  const fx = project(t, [{ ...page('dyn', ['flexipages/X']), flexiPage: 'SfUi_Dyn_Typed', recordType: undefined }]);
  const put = (p, rel, text) => { const f = path.join(p.dir, D, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put(fx, 'flexipages/SfUi_Dyn_Typed.flexipage-meta.xml', FLEXI_XML('required'));
  put(fx, 'objects/SfUiTyped__c/fields/Size__c.field-meta.xml', '<CustomField><required>true</required></CustomField>');
  const ok = await go(fx, o404());
  assert.match(ok.out[0], /^PASS dyn Size__c/, ok.out.join('\n'));
  const added = pageProject(t, LAYOUT_XML('Required'), '<CustomField><required>true</required></CustomField>');
  const layout = await go(added, o404());
  assert.match(layout.out[0], /^ERROR size Size__c no custom object SfUiTyped__c in the org: a layout check needs the object deployed/, layout.out.join('\n'));
  const c = JSON.parse(fs.readFileSync(added.file, 'utf8'));
  c.checks[0].object = 'Acount';
  fs.writeFileSync(added.file, JSON.stringify(c));
  const wrong = await go(added, o404());
  assert.match(wrong.out[0], /^ERROR size Size__c no object Acount: check the name/);
  const other = org({});
  other.api.call = async (s, p) => { if (p.startsWith('/sobjects/')) throw Object.assign(new Error('boom'), { evidence: { status: 500 } }); return {}; };
  assert.match((await go(pageProject(t, LAYOUT_XML('Required')), other)).out[0], /^ERROR size Size__c boom/);
});

// A permission set file as a branch holds it, granting Size__c or not.
const SET_XML = (grant) => `<PermissionSet>${grant ? '<fieldPermissions><editable>false</editable><field>SfUiTyped__c.Size__c</field><readable>true</readable></fieldPermissions>' : '<fieldPermissions><editable>true</editable><field>SfUiTyped__c.Grade__c</field><readable>true</readable></fieldPermissions>'}</PermissionSet>`;
function flsProject(t, grant) {
  const p = pageProject(t, LAYOUT_XML('Required'), '<CustomField><type>Number</type></CustomField>');
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] };
  fs.writeFileSync(p.file, JSON.stringify(c));
  touch(p.dir, [`${D}permissionsets/SfUi_Probe.permissionset-meta.xml`]);
  fs.writeFileSync(path.join(p.dir, D, 'permissionsets/SfUi_Probe.permissionset-meta.xml'), SET_XML(grant));
  return p;
}

test('a branch permission set decides for itself: a field the branch adds and grants is readable, one it drops is not', async (t) => {
  const granted = org({ readable: false, describe: { name: 'Other__c' } });
  const ok = await go(flsProject(t, true), granted);
  assert.match(ok.out[0], /^PASS size Size__c \(.*readable from branch permission set SfUi_Probe\)/);
  assert.ok(!granted.asked.some((q) => /FROM FieldPermissions/.test(q)), 'the org is not asked');
  const dropped = org({ readable: false, describe: { name: 'Size__c', nillable: true, createable: true, defaultedOnCreate: false } });
  const no = await go(flsProject(t, false), dropped);
  assert.match(no.out[0], /^FAIL size Size__c Standard Platform User \+ SfUi_Probe cannot read Size__c \(field-level security from org\)/);
  assert.match(dropped.asked.find((q) => /FROM FieldPermissions/.test(q)), /ParentId IN \('0PSprofile'\)/, 'the branch set is not in the org list');
  assert.ok(!dropped.asked.some((q) => /FROM PermissionSet WHERE Name/.test(q)), 'the set is not looked up in the org');
});

test('the branch field file decides whether FLS applies: required exempts it, dropping required does not, whatever the describe says', async (t) => {
  const exemptByBranch = org({ readable: false, describe: { name: 'Size__c', permissionable: true } });
  const yes = await go(pageProject(t, LAYOUT_XML('Required'), '<CustomField><required>true</required></CustomField>'), exemptByBranch);
  assert.equal(yes.code, 0, yes.out.join('\n'));
  assert.ok(!exemptByBranch.asked.some((q) => /FROM FieldPermissions/.test(q)));
  const dropped = org({ readable: false, describe: { name: 'Size__c', permissionable: false } });
  const no = await go(pageProject(t, LAYOUT_XML('Required'), '<CustomField><type>Number</type></CustomField>'), dropped);
  assert.match(no.out[0], /cannot read Size__c/);
});

test('an unprefixed name filters on a null prefix, or null or the project namespace, and takes the unprefixed row first; a prefixed one filters on its prefix', async (t) => {
  const p = pageProject(t, undefined, undefined);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe', 'pk__Grp'] };
  c.checks[0].recordType = 'ns__Beta_Type';
  fs.writeFileSync(p.file, JSON.stringify(c));
  const o = org({ md: ORG_MD('Required'), describe: { name: 'Size__c', nillable: true, createable: true, defaultedOnCreate: false } });
  await go(p, o);
  const has = (re) => o.asked.some((q) => re.test(q));
  assert.ok(has(/FROM PermissionSet WHERE Name = 'SfUi_Probe' AND NamespacePrefix = null AND IsOwnedByProfile = false ORDER BY NamespacePrefix NULLS FIRST LIMIT 1/), o.asked.join('\n'));
  assert.ok(has(/FROM PermissionSet WHERE Name = 'Grp' AND NamespacePrefix = 'pk' AND IsOwnedByProfile/));
  assert.ok(has(/FROM RecordType WHERE SobjectType = 'SfUiTyped__c'$/), o.asked.join('\n'));
  const plain = org({ groupSet: true });
  c.checks[0].persona.permissionSets = ['G'];
  c.checks[0].recordType = 'Beta_Type';
  fs.writeFileSync(p.file, JSON.stringify(c));
  await go(p, plain);
  assert.ok(plain.asked.some((q) => /WHERE PermissionSetGroup.DeveloperName IN \('G'\)$/.test(q)), plain.asked.join('\n'));
  fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'pk', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  const own = org({ groupSet: true });
  await go(p, own);
  assert.ok(own.asked.some((q) => /FROM CustomObject WHERE DeveloperName = 'SfUiTyped' AND \(NamespacePrefix = null OR NamespacePrefix = 'pk'\) ORDER BY/.test(q)), own.asked.join('\n'));
});

test('a group\'s component rows follow the name rule: an unprefixed name takes no prefix or the project\'s, never another package\'s', async (t) => {
  const rowsAs = (ns, ownNs) => {
    const p = grpCheck(t, true);
    if (ownNs) inNamespace(p, ownNs);
    const o = org({ apexClass: CLS, groupSet: true });
    const call = o.api.call;
    o.api.call = async (x, q) => (/FROM PermissionSetGroupComponent/.test(decodeURIComponent(q)) ? { records: [{ PermissionSetGroup: { DeveloperName: 'Grp', NamespacePrefix: ns }, PermissionSetId: '0PSa', PermissionSet: { Name: 'SfUi_Probe', NamespacePrefix: null } }] } : call(x, q));
    return since(p, o);
  };
  assert.ok((await rowsAs('zz')).out.includes('UNCOVERED permissionsets/SfUi_Probe: g cover it but do not read it'), 'another package\'s group');
  assert.ok((await rowsAs('zz', 'pk')).out.includes('UNCOVERED permissionsets/SfUi_Probe: g cover it but do not read it'), 'another package\'s group, in a namespaced project');
  assert.ok(!(await rowsAs(null)).out.some((l) => l.startsWith('UNCOVERED')), 'control: the unprefixed group');
  assert.ok(!(await rowsAs('pk', 'pk')).out.some((l) => l.startsWith('UNCOVERED')), 'control: the project\'s own group');
});

test('coverage reads member names only: a group file\'s from the file, every org name in one component query, no id lookup', async (t) => {
  const p = project(t, [klass('g', { covers: ['classes/SfUiProbeController', 'permissionsets/SfUi_Probe'], persona: { profile: 'Standard Platform User', permissionSets: ['A', 'B', 'C', 'D', 'Grp'] } })]);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController', true));
  put(p, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['M1', 'M2', 'M3', 'M4', 'M5']));
  const o = org({ apexClass: CLS, members: [] });
  const call = o.api.call;
  // A member id lookup fails: coverage never needs one, so it is never asked and the run does not exit 2.
  o.api.call = async (x, q) => (/FROM PermissionSet WHERE Name = 'M\d'/.test(decodeURIComponent(q)) ? Promise.reject(new SfUiError('API_ERROR', 'GET /query answered 503')) : call(x, q));
  const r = await since(p, o);
  assert.ok(r.out.includes('UNCOVERED permissionsets/SfUi_Probe: g cover it but do not read it'), r.out.join('\n'));
  assert.equal(r.code, 1, r.out.join('\n'));
  const comp = o.asked.filter((q) => /PermissionSetGroupComponent/.test(q));
  assert.deepEqual(comp.length, 1, comp.join('\n'));
  assert.match(comp[0], /DeveloperName IN \('A','B','C','D'\)$/);
  assert.equal(o.asked.filter((q) => /FROM PermissionSet WHERE Name = 'M\d'/.test(q)).length, 0, o.asked.join('\n'));
});

// ---- classAccess ----
const CLS = { Id: '01pCLASS', ApiVersion: 66 };
const klass = (id, extra = {}) => ({ id, kind: 'classAccess', requirement: `req ${id}`, covers: ['classes/SfUiProbeController'], persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] }, class: 'SfUiProbeController', expect: { access: true }, ...extra });
const SET_CLS = (cls, enabled = true) => `<PermissionSet><classAccesses><apexClass>${cls}</apexClass><enabled>${enabled}</enabled></classAccesses></PermissionSet>`;
const put = (p, rel, text) => { const f = path.join(p.dir, D, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const goc = (p, o) => run(['verify', '--org', 'x', '--checks', p.file], { api: o.api, sf: async () => assert.fail('a class check runs no sf') });

test('classAccess: a branch permission set that grants the class passes without asking the org', async (t) => {
  const p = project(t, [klass('c')]);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('sfuiprobecontroller'));
  const o = org({ apexClass: CLS });
  const r = await goc(p, o);
  assert.equal(r.out[0], 'PASS c SfUiProbeController (branch permission set SfUi_Probe; class API 66.0 from org)');
  assert.ok(!o.asked.some((q) => /FROM SetupEntityAccess/.test(q)), 'the org is not asked');
});

test('classAccess: a branch set present without the grant fails although the org grants it (the stripped-grants defect)', async (t) => {
  const p = project(t, [klass('c')]);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
  const o = org({ apexClass: CLS, grantedBy: ['0PSnamed'] });
  const r = await goc(p, o);
  assert.equal(r.code, 1);
  assert.match(r.out[0], /^FAIL c SfUiProbeController Standard Platform User \+ SfUi_Probe cannot call SfUiProbeController \(org; class API 66.0 from org\)/);
  const off = project(t, [klass('d')]);
  put(off, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController', false));
  assert.match((await goc(off, o)).out[0], /^FAIL d .* cannot call/, 'enabled false is no grant');
  assert.ok(!o.asked.some((q) => /FROM PermissionSet WHERE Name/.test(q)), 'the set is not looked up in the org');
});

test('classAccess: the profile grants in the org; an org group grants through its own set, muting applied; a direct set beside it still grants', async (t) => {
  const prof = await goc(project(t, [klass('c', { persona: { profile: 'System Administrator', permissionSets: [] } })]), org({ apexClass: CLS, grantedBy: ['0PSprofile'] }));
  assert.match(prof.out[0], /^PASS c SfUiProbeController \(org; class API 66.0 from org\)/);
  const grp = (sets, o) => goc(project(t, [klass('g', { persona: { profile: 'Standard Platform User', permissionSets: sets } })]), o);
  // The org writes a group's grants, less its muting, onto the group's own set, so that set answers.
  assert.match((await grp(['Grp'], org({ apexClass: CLS, groupSet: true, grantedBy: ['0PSnamed'] }))).out[0], /^PASS g SfUiProbeController \(org; /);
  const muted = await grp(['Grp'], org({ apexClass: CLS, groupSet: true, members: [['Grp', 'Other'], ['Grp', null]], grantedBy: ['0PSm0'] }));
  assert.match(muted.out[0], /^FAIL g SfUiProbeController .* cannot call/, 'the member grants, but the group\'s own set, muted, does not: ' + muted.out.join('\n'));
  // A direct set still grants when a group mutes it: muting is per group.
  const o = org({ apexClass: CLS, grantedBy: ['0PSdirect'] });
  const call = o.api.call;
  o.api.call = async (s, q) => { const d = decodeURIComponent(q); return /FROM PermissionSet WHERE Name = 'Direct'/.test(d) ? { records: [{ Id: '0PSdirect', Type: 'Regular' }] } : /FROM PermissionSet WHERE Name = 'Grp'/.test(d) ? { records: [{ Id: '0PSgrp', Type: 'Group' }] } : call(s, q); };
  assert.match((await grp(['Direct', 'Grp'], o)).out[0], /^PASS g /, 'the direct set grants although the group is muted');
});

// A check whose persona names group Grp, covering a member set's key; the member's branch file grants the class or not.
const MEMBER = `${D}permissionsets/SfUi_Probe.permissionset-meta.xml`;
const grpCheck = (t, grant, extra = {}) => {
  const p = project(t, [klass('g', { covers: ['classes/SfUiProbeController', 'permissionsets/SfUi_Probe'], persona: { profile: 'Standard Platform User', permissionSets: ['Grp'] }, ...extra })]);
  if (grant != null) put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController', grant));
  return p;
};
const since = (p, o, extra = []) => run(['verify', '--org', 'x', '--checks', p.file, '--since', 'main', ...extra], { api: o.api, git: gitOf([MEMBER]), sf: async () => assert.fail('a class check runs no sf') });

test('a member set of a group the persona names is covered, and judged from its branch file, not the group\'s org set', async (t) => {
  // The org's copy grants, through the group's own set and the member's: the branch's drop decides.
  const o = org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe'], ['Grp', 'Other']], grantedBy: ['0PSnamed', '0PSm0'] });
  const r = await since(grpCheck(t, false), o);
  assert.match(r.out.find((l) => / g /.test(l)), /^FAIL g SfUiProbeController Standard Platform User \+ Grp cannot call/, r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 0, failed 1');
  assert.ok(o.asked.some((q) => /FROM SetupEntityAccess .* ParentId IN \('0PSm1'\)/.test(q)), 'the other member from the org, not the group set: ' + o.asked.join('\n'));
  assert.ok(!o.asked.some((q) => /'0PSnamed'/.test(q)), 'the group set is not asked');
  const ok = await since(grpCheck(t, true), org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe']] }));
  assert.match(ok.out.find((l) => / g /.test(l)), /^PASS g SfUiProbeController \(branch permission set SfUi_Probe in group Grp; /, ok.out.join('\n'));
  // Control: no member file, so the group's own set answers, muting and all.
  const orgSet = org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe']], grantedBy: ['0PSnamed'] });
  assert.match((await goc(grpCheck(t, null), orgSet)).out[0], /^PASS g SfUiProbeController \(org; /);
});

test('a set in a group the persona does not name stays uncovered; a failed member read is exit 2', async (t) => {
  const r = await since(grpCheck(t, true), org({ apexClass: CLS, groupSet: true, members: [['Other', 'SfUi_Probe']] }));
  assert.ok(r.out.includes('UNCOVERED permissionsets/SfUi_Probe: g cover it but do not read it'), r.out.join('\n'));
  // The same reason in JUnit; a key no check names in covers has none.
  const xml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-junit-')), 'out.xml');
  t.after(() => fs.rmSync(path.dirname(xml), { recursive: true, force: true }));
  await since(grpCheck(t, true), org({ apexClass: CLS, groupSet: true, members: [['Other', 'SfUi_Probe']] }), ['--junit', xml]);
  assert.match(fs.readFileSync(xml, 'utf8'), /UNCOVERED: g cover it but do not read it/);
  const bare = await since(grpCheck(t, true, { covers: ['classes/SfUiProbeController'] }), org({ apexClass: CLS }));
  assert.ok(bare.out.includes('UNCOVERED permissionsets/SfUi_Probe'), bare.out.join('\n'));
  const o = org({ apexClass: CLS });
  const call = o.api.call;
  o.api.call = async (x, q) => (/PermissionSet\.Name/.test(decodeURIComponent(q)) ? Promise.reject(new SfUiError('API_ERROR', 'GET /query answered 503')) : call(x, q));
  const down = await since(grpCheck(t, true), o);
  assert.deepEqual([down.code, down.out[0]], [2, 'x could not be read: API_ERROR: GET /query answered 503']);
});

test('a group\'s muting set takes away its members\' grant: from its branch file, else the org by its 0QM id; per reason', async (t) => {
  const MUTE = 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml';
  const grp = (members, grantedBy, extra = {}) => org({ apexClass: CLS, groupSet: true, members, grantedBy, ...extra });
  // The org's muting set mutes the class the branch member grants.
  const o = grp([['Grp', 'SfUi_Probe'], ['Grp', null]], ['0QMm1']);
  const r = await since(grpCheck(t, true), o);
  assert.match(r.out.find((l) => / g /.test(l)), /^FAIL g SfUiProbeController Standard Platform User \+ Grp cannot call/, r.out.join('\n'));
  assert.ok(o.asked.some((q) => /FROM SetupEntityAccess .* ParentId IN \('0QMm1'\)/.test(q)), o.asked.join('\n'));
  assert.ok(o.asked.some((q) => /FROM MutingPermissionSet WHERE Id IN \('0QMm1'\) AND PermissionsAuthorApex = true/.test(q)), 'Author Apex from the muting set\'s own column: ' + o.asked.join('\n'));
  // Control: the muting set does not hold the class.
  const ok = await since(grpCheck(t, true), grp([['Grp', 'SfUi_Probe'], ['Grp', null]], []));
  assert.match(ok.out.find((l) => / g /.test(l)), /^PASS g SfUiProbeController \(branch permission set SfUi_Probe in group Grp; /, ok.out.join('\n'));
  // The muting set's branch file decides over the org: it mutes an org member's grant, and its drop unmutes it.
  const filed = grpCheck(t, null);
  put(filed, MUTE, SET_CLS('SfUiProbeController'));
  const m = await goc(filed, grp([['Grp', 'Other'], ['Grp', null]], ['0PSm0']));
  assert.match(m.out[0], /^FAIL g SfUiProbeController .* cannot call/, m.out.join('\n'));
  const dropped = grpCheck(t, null);
  put(dropped, MUTE, '<MutingPermissionSet><label>x</label></MutingPermissionSet>');
  assert.match((await goc(dropped, grp([['Grp', 'Other'], ['Grp', null]], ['0PSm0', '0QMm1']))).out[0], /^PASS g SfUiProbeController \(org group Grp; /);
  // Muting is per reason: a muted class grant leaves the member's Author Apex.
  const both = grpCheck(t, null);
  put(both, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><classAccesses><apexClass>SfUiProbeController</apexClass><enabled>true</enabled></classAccesses><userPermissions><enabled>true</enabled><name>AuthorApex</name></userPermissions></PermissionSet>');
  put(both, MUTE, SET_CLS('SfUiProbeController'));
  assert.match((await goc(both, grp([['Grp', 'SfUi_Probe'], ['Grp', null]], []))).out[0], /^PASS g SfUiProbeController \(branch permission set SfUi_Probe in group Grp, Author Apex; /);
});

test('group members are asked only for a check covering a changed permission set: no --since, or another change, asks nothing', async (t) => {
  const o = org({ apexClass: CLS, grantedBy: ['0PSnamed'] });
  const call = o.api.call;
  o.api.call = async (x, q) => (/PermissionSetGroupComponent/.test(decodeURIComponent(q)) ? Promise.reject(new SfUiError('API_ERROR', 'GET /query answered 503')) : call(x, q));
  const p = grpCheck(t, null);
  const all = await goc(p, o);
  assert.match(all.out[0], /^PASS g SfUiProbeController/, all.out.join('\n'));
  const cls = `${D}classes/SfUiProbeController.cls`;
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static void go() {} }');
  const other = await run(['verify', '--org', 'x', '--checks', p.file, '--since', 'main'], { api: o.api, git: gitOf([cls]), sf: async () => assert.fail('no sf') });
  assert.equal(other.code, 0, other.out.join('\n'));
  assert.equal(other.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 1, failed 0');
});

// A group file on the branch, holding the named sets and muting sets.
const GROUP_FILE = (sets, mutes = []) => `<PermissionSetGroup>${sets.map((n) => `<permissionSets>${n}</permissionSets>`).join('')}${mutes.map((n) => `<mutingPermissionSets>${n}</mutingPermissionSets>`).join('')}<label>G</label></PermissionSetGroup>`;

test('a group file on the branch decides the group\'s members and muting, over the org\'s components', async (t) => {
  // The branch takes SfUi_Probe out of the group the org has it in: no longer covered, and its grant no longer counts.
  const out = grpCheck(t, true);
  put(out, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['Other']));
  const o = org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe']] });
  const r = await since(out, o);
  assert.ok(r.out.includes('UNCOVERED permissionsets/SfUi_Probe: g cover it but do not read it'), r.out.join('\n'));
  const all = await goc(out, org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe']] }));
  assert.match(all.out[0], /^FAIL g SfUiProbeController Standard Platform User \+ Grp cannot call/, all.out.join('\n'));
  assert.ok(!o.asked.some((q) => /FROM PermissionSetGroupComponent/.test(q)), 'the org\'s components are not read: ' + o.asked.join('\n'));
  // The branch adds SfUi_Probe to a group the org does not have it in: covered and read from its file.
  const added = grpCheck(t, true);
  put(added, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['SfUi_Probe']));
  const a = await since(added, org({ apexClass: CLS, groupSet: true, members: [] }));
  assert.match(a.out.find((l) => / g /.test(l)), /^PASS g SfUiProbeController \(branch permission set SfUi_Probe in group Grp; /, a.out.join('\n'));
  // An org member of the branch group grants by its id; the group's muting set on the branch mutes it.
  const viaOrg = grpCheck(t, null);
  put(viaOrg, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['Other']));
  assert.match((await goc(viaOrg, org({ apexClass: CLS, grantedBy: ['0PSnamed'] }))).out[0], /^PASS g SfUiProbeController \(org member of branch group Grp; /);
  const muted = grpCheck(t, null);
  put(muted, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['Other'], ['Mute']));
  put(muted, 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml', SET_CLS('SfUiProbeController'));
  assert.match((await goc(muted, org({ apexClass: CLS, grantedBy: ['0PSnamed'] }))).out[0], /^FAIL g SfUiProbeController .* cannot call/);
  // A set the group file names that neither the branch nor the org holds is an ERROR, not a quiet no-grant.
  const gone = grpCheck(t, null);
  put(gone, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', GROUP_FILE(['Nowhere']));
  assert.match((await goc(gone, org({ apexClass: CLS, setFound: false }))).out[0], /^ERROR g SfUiProbeController group Grp on the branch holds Nowhere, which is neither on the branch nor in the org/);
});

test('coverage and grants read a group\'s members once, by one name rule: the unprefixed group before the project namespace\'s', async (t) => {
  const p = grpCheck(t, true, { covers: ['classes/SfUiProbeController', 'permissionsets/SfUi_Probe', 'permissionsets/B'] });
  inNamespace(p, 'pk');
  put(p, 'permissionsets/B.permissionset-meta.xml', SET_CLS('Nothing'));
  const o = org({ apexClass: CLS, groupSet: true });
  const call = o.api.call;
  // Two groups answer for Grp: the local one holds SfUi_Probe, pk__Grp holds B.
  o.api.call = async (x, q) => (/FROM PermissionSetGroupComponent/.test(decodeURIComponent(q)) ? (o.asked.push(decodeURIComponent(q)), { records: [
    { PermissionSetGroup: { DeveloperName: 'Grp', NamespacePrefix: 'pk' }, PermissionSetId: '0PSb', PermissionSet: { Name: 'B', NamespacePrefix: 'pk' } },
    { PermissionSetGroup: { DeveloperName: 'Grp', NamespacePrefix: null }, PermissionSetId: '0PSa', PermissionSet: { Name: 'SfUi_Probe', NamespacePrefix: null } }] }) : call(x, q));
  const r = await run(['verify', '--org', 'x', '--checks', p.file, '--since', 'main'], { api: o.api, git: gitOf([MEMBER, `${D}permissionsets/B.permissionset-meta.xml`]), sf: async () => assert.fail('no sf') });
  assert.ok(r.out.includes('UNCOVERED permissionsets/B: g cover it but do not read it'), r.out.join('\n'));
  assert.match(r.out.find((l) => /^(PASS|FAIL|ERROR) g /.test(l)), /^PASS g SfUiProbeController \(branch permission set SfUi_Probe in group Grp; /, r.out.join('\n'));
  const reads = o.asked.filter((q) => /FROM PermissionSetGroupComponent/.test(q));
  assert.equal(reads.length, 1, reads.join('\n'));
  assert.match(reads[0], /WHERE PermissionSetGroup\.DeveloperName IN \('Grp'\)$/);
});

test('a failed component query is not kept: a later read of the same group asks the org again', async (t) => {
  const p = project(t, ['g1', 'g2'].map((id) => klass(id, { persona: { profile: 'Standard Platform User', permissionSets: ['Grp'] } })));
  const o = org({ apexClass: CLS, groupSet: true, members: [['Grp', 'SfUi_Probe']], grantedBy: ['0PSnamed'] });
  const call = o.api.call;
  let n = 0;
  o.api.call = async (x, q) => (/FROM PermissionSetGroupComponent/.test(decodeURIComponent(q)) && n++ === 0 ? Promise.reject(new SfUiError('API_ERROR', 'GET /query answered 503')) : call(x, q));
  const r = await goc(p, o);
  assert.match(r.out[0], /^ERROR g1 /, r.out.join('\n'));
  assert.match(r.out[1], /^PASS g2 SfUiProbeController/, r.out.join('\n'));
  assert.equal(n, 2, 'the second read asks again');
});

test('--plan names a group member key as dropped, and says it reads no org', async (t) => {
  const r = await run(['verify', '--plan', '--checks', grpCheck(t, true).file]);
  assert.ok(r.out.includes('NOTE g: covers permissionsets/SfUi_Probe, which it does not read, so it covers nothing (--plan reads no org, so a member of a permission set group the persona names is not known)'), r.out.join('\n'));
});

test('classAccess: Author Apex on the profile, an org set or a branch set reaches the class without a class grant', async (t) => {
  const prof = await goc(project(t, [klass('c')]), org({ apexClass: CLS, authorApex: ['0PSprofile'] }));
  assert.equal(prof.out[0], 'PASS c SfUiProbeController (org, Author Apex; class API 66.0 from org)');
  assert.match((await goc(project(t, [klass('c')]), org({ apexClass: CLS, authorApex: ['0PSnamed'] }))).out[0], /^PASS c .*\(org, Author Apex;/);
  assert.match((await goc(project(t, [klass('c')]), org({ apexClass: CLS }))).out[0], /^FAIL c .* cannot call/, 'control: neither grant fails');
  const p = project(t, [klass('c')]);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><userPermissions><enabled>true</enabled><name>AuthorApex</name></userPermissions></PermissionSet>');
  assert.equal((await goc(p, org({ apexClass: CLS }))).out[0], 'PASS c SfUiProbeController (branch permission set SfUi_Probe, Author Apex; class API 66.0 from org)');
  const off = project(t, [klass('c')]);
  put(off, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><userPermissions><enabled>false</enabled><name>AuthorApex</name></userPermissions></PermissionSet>');
  assert.match((await goc(off, org({ apexClass: CLS }))).out[0], /^FAIL c .* cannot call/, 'enabled false is no grant');
  const not = await goc(project(t, [klass('n', { expect: { access: false } })]), org({ apexClass: CLS, authorApex: ['0PSprofile'] }));
  assert.match(not.out[0], /^FAIL n SfUiProbeController .* can call SfUiProbeController, the requirement says not \(org, Author Apex;/);
});

test('classAccess asks for Author Apex only when class access does not grant, outside a group', async (t) => {
  const authorAsked = async (grantedBy) => {
    const o = org({ apexClass: CLS, grantedBy, authorApex: ['0PSprofile'] });
    const r = await goc(project(t, [klass('g', { persona: { profile: 'Standard Platform User', permissionSets: [] } })]), o);
    assert.match(r.out[0], /^PASS g /, r.out.join('\n'));
    return o.asked.filter((q) => /PermissionsAuthorApex/.test(q)).length;
  };
  assert.equal(await authorAsked(['0PSprofile']), 0, 'class access grants');
  assert.equal(await authorAsked([]), 1, 'control: no class access, so Author Apex decides');
});

test('classAccess: a misspelt set after a granting group or branch set is still an ERROR', async (t) => {
  const two = (sets) => project(t, [klass('c', { persona: { profile: 'Standard Platform User', permissionSets: sets } })]);
  const typo = (o) => { const call = o.api.call; o.api.call = async (x, q) => (/FROM PermissionSet WHERE Name = 'Typo'/.test(decodeURIComponent(q)) ? { records: [] } : call(x, q)); return o; };
  const grp = await goc(two(['Grp', 'Typo']), typo(org({ apexClass: CLS, groupSet: true, grantedBy: ['0PSnamed'] })));
  assert.match(grp.out[0], /^ERROR c SfUiProbeController permission set or group not found: Typo/, grp.out.join('\n'));
  const p = two(['SfUi_Probe', 'Typo']);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController'));
  const file = await goc(p, typo(org({ apexClass: CLS, setFound: false })));
  assert.match(file.out[0], /^ERROR c SfUiProbeController permission set or group not found: Typo/, file.out.join('\n'));
  assert.match((await goc(two(['Grp']), org({ apexClass: CLS, groupSet: true, grantedBy: ['0PSnamed'] }))).out[0], /^PASS c SfUiProbeController \(org;/, 'control: the group alone grants');
});

test('classAccess: a class in neither the org nor the branch is an ERROR; a misspelt profile is an ERROR; a class only the branch holds can be granted by a branch set', async (t) => {
  const none = await goc(project(t, [klass('c')]), org({}));
  assert.match(none.out[0], /^ERROR c SfUiProbeController no Apex class SfUiProbeController/);
  assert.equal(none.code, 1);
  const bad = await goc(project(t, [klass('c')]), org({ apexClass: CLS, noProfile: true }));
  assert.match(bad.out[0], /^ERROR c SfUiProbeController no profile Standard Platform User in the org/);
  const p = project(t, [klass('c')]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController {}');
  put(p, 'classes/SfUiProbeController.cls-meta.xml', '<ApexClass><apiVersion>67.0</apiVersion></ApexClass>');
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController'));
  assert.match((await goc(p, org({}))).out[0], /^PASS c SfUiProbeController \(branch permission set SfUi_Probe; class API 67.0 from branch\)/);
});

test('classAccess walks the classes folder once per file kind for a class with no own prefix', async (t) => {
  const p = project(t, [klass('c')]);
  put(p, 'classes/Other.cls', 'public class Other {}');
  const walks = [];
  const real = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (dir, ...rest) => { if (String(dir).endsWith('/classes')) walks.push(dir); return real(dir, ...rest); });
  const r = await goc(p, org({}));
  assert.match(r.out[0], /^ERROR c SfUiProbeController no Apex class/, r.out.join('\n'));
  assert.equal(walks.length, 2, walks.join('\n'));
});

test('classAccess finds a nested class and its API version on the branch', async (t) => {
  const p = project(t, [klass('c')]);
  put(p, 'classes/services/SfUiProbeController.cls', 'public class SfUiProbeController {}');
  put(p, 'classes/services/SfUiProbeController.cls-meta.xml', '<ApexClass><apiVersion>68.0</apiVersion></ApexClass>');
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController'));
  assert.match((await goc(p, org({}))).out[0], /^PASS c SfUiProbeController \(branch permission set SfUi_Probe; class API 68.0 from branch\)/);
});

test('classAccess takes the exact-case class file over a differently cased one, found at any depth', async (t) => {
  const p = project(t, [klass('c')]);
  put(p, 'classes/a/sfuiprobecontroller.cls-meta.xml', '<ApexClass><apiVersion>50.0</apiVersion></ApexClass>');
  put(p, 'classes/b/c/SfUiProbeController.cls-meta.xml', '<ApexClass><apiVersion>69.0</apiVersion></ApexClass>');
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('SfUiProbeController'));
  assert.match((await goc(p, org({}))).out[0], /class API 69.0 from branch\)/);
});

test('classAccess: expect.access false is a requirement, and a grant fails it; the detail always carries the API version', async (t) => {
  const p = project(t, [klass('c', { expect: { access: false }, persona: { profile: 'Standard Platform User', permissionSets: [] } })]);
  const denied = await goc(p, org({ apexClass: CLS }));
  assert.match(denied.out[0], /^PASS c .*class API 66.0 from org\)/);
  const granted = await goc(p, org({ apexClass: CLS, grantedBy: ['0PSprofile'] }));
  assert.equal(granted.code, 1);
  assert.match(granted.out[0], /^FAIL c SfUiProbeController Standard Platform User can call SfUiProbeController, the requirement says not \(org; class API 66.0 from org\)/);
  assert.match(granted.out[0], /\(requirement: req c\)$/);
});

test('classAccess without a class takes the entry classes the covered bundles import, ns.Class.method as ns__Class', async (t) => {
  const p = project(t, [klass('c', { class: undefined, covers: ['lwc/a'] }), klass('d', { class: undefined, covers: ['lwc/b'] })]);
  put(p, 'lwc/b/b.js', "import q from '@salesforce/apex/Fourth.go';");
  put(p, 'lwc/a/a.js', "import x from '@salesforce/apex/First.go';\nimport y from '@salesforce/apex/pk.Second.go';\nimport z from '@salesforce/apex/First.other';");
  put(p, 'lwc/a/a.html', '<template></template>');
  const o = org({ apexClass: CLS, grantedBy: ['0PSprofile'] });
  const r = await goc(p, o);
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' ').slice(0, 3).join(' ')), ['PASS c First', 'PASS c pk__Second']);
  assert.ok(o.asked.some((q) => /FROM ApexClass WHERE Name = 'Second' AND NamespacePrefix = 'pk'/.test(q)), o.asked.join('\n'));
  assert.ok(o.asked.some((q) => /FROM ApexClass WHERE Name = 'First' AND NamespacePrefix = null ORDER BY/.test(q)));
});

test('classAccess reads .ts files and apexContinuation imports, and skips commented-out ones', async (t) => {
  const p = project(t, [klass('c', { class: undefined, covers: ['lwc/a'] })]);
  put(p, 'lwc/a/a.ts', "import x from '@salesforce/apex/FromTs.go';\n  // import o from '@salesforce/apex/Old.go';");
  put(p, 'lwc/a/a.js', "import y from '@salesforce/apexContinuation/Cont.go';");
  const o = org({ apexClass: CLS });
  const r = await goc(p, o);
  assert.deepEqual(r.out.filter((l) => /^(PASS|FAIL|ERROR) c /.test(l)).map((l) => l.split(' ')[2]).sort(), ['Cont', 'FromTs']);
  assert.equal(o.asked.filter((q) => /PermissionsAuthorApex/.test(q)).length, 1, 'two classes, one Author Apex query');
  const flaky = org({ apexClass: CLS });
  const call = flaky.api.call;
  let failed = 0;
  flaky.api.call = async (x, q) => (/PermissionsAuthorApex/.test(decodeURIComponent(q)) && !failed++ ? Promise.reject(new Error('HTTP 503')) : call(x, q));
  const out = (await goc(p, flaky)).out.filter((l) => /^(PASS|FAIL|ERROR) c /.test(l)).map((l) => l.split(' ')[0]);
  assert.deepEqual(out.sort(), ['ERROR', 'FAIL'], 'one 503 errors one class, not the next, in either order');
});

test('an unprefixed class is looked up with no prefix, or the project namespace when it has one', async (t) => {
  const o = org({ apexClass: CLS });
  await goc(project(t, [klass('c')]), o);
  assert.ok(o.asked.some((q) => /FROM ApexClass WHERE Name = 'SfUiProbeController' AND NamespacePrefix = null ORDER BY/.test(q)), o.asked.join('\n'));
  const p = project(t, [klass('c')]);
  fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'ns', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  const o2 = org({ apexClass: CLS });
  await goc(p, o2);
  assert.ok(o2.asked.some((q) => /Name = 'SfUiProbeController' AND \(NamespacePrefix = null OR NamespacePrefix = 'ns'\) ORDER BY/.test(q)), o2.asked.join('\n'));
});

test('a project in namespace ns reads a branch set granting Cls as granting ns__Cls', async (t) => {
  const p = project(t, [klass('c', { class: 'ns__Cls' })]);
  fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'ns', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('Cls'));
  assert.match((await goc(p, org({ apexClass: CLS }))).out[0], /^PASS c ns__Cls \(branch permission set SfUi_Probe/);
  const other = project(t, [klass('c', { class: 'other__Cls' })]);
  fs.writeFileSync(path.join(other.dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'ns', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  put(other, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CLS('Cls'));
  assert.match((await goc(other, org({ apexClass: CLS }))).out[0], /^FAIL c other__Cls/, 'the unprefixed name stands for ns__ only in the project namespace');
});

test('a stop partway through a classless check lists the unrun classes as skipped stopped/<check>/<class> cases', async (t) => {
  const ac = new AbortController();
  const p = project(t, [klass('c', { class: undefined, covers: ['lwc/a'] }), klass('d', { class: undefined, covers: ['lwc/b'] }), klass('e', { class: undefined, covers: ['lwc/none'] })]);
  put(p, 'lwc/b/b.js', "import q from '@salesforce/apex/Fourth.go';");
  put(p, 'lwc/a/a.js', "import x from '@salesforce/apex/First.go';\nimport y from '@salesforce/apex/Second.go';\nimport z from '@salesforce/apex/Third.go';");
  const o = org({ apexClass: CLS, grantedBy: ['0PSprofile'] });
  const call = o.api.call;
  o.api.call = async (...a) => { ac.abort(); return call(...a); };
  const out = path.join(p.dir, 'v.xml');
  const r = await run(['verify', '--org', 'x', '--checks', p.file, '--junit', out], { api: o.api, signal: ac.signal });
  assert.ok(!r.out.some((l) => /^ERROR e/.test(l)), 'a check after the stop is not visited: no ERROR from its missing import');
  for (const l of ['STOPPED c Second', 'STOPPED c Third', 'STOPPED d ', 'STOPPED e ']) assert.ok(r.out.some((x) => x.startsWith(l)), `${l}: ${r.out.join('\n')}`);
  assert.match(r.out.at(-1), /, stopped 4$/);
  const xml = fs.readFileSync(out, 'utf8');
  assert.ok(xml.includes('name="stopped/c/Second"') && xml.includes('name="stopped/c/Third"'), xml);
  assert.ok(!xml.includes('stopped/c/First') && !xml.includes('name="stopped/c"'), 'First ran, and the check has results');
  assert.ok(xml.includes('name="stopped/d"') && !xml.includes('stopped/d/'), 'a check with no result is reported whole, not per class');
  assert.ok(xml.includes('name="stopped/e"'));
  assert.match(xml, /skipped="4"/);
});

test('--since runs a covered class with no @AuraEnabled and a covered bundle that lost its last import, and does not exit 0 on nothing', async (t) => {
  const p = project(t, [klass('c', { covers: ['classes/Rest'], class: 'Rest' })]);
  put(p, 'classes/Rest.cls', '@RestResource(urlMapping=\'/x\') global class Rest { @HttpGet global static String get() { return \'\'; } }');
  const git = gitOf([`${D}classes/Rest.cls`]);
  const rest = await run(['verify', '--org', 'x', '--checks', p.file, '--since', 'main'], { git, api: org({ apexClass: CLS }).api });
  assert.equal(rest.code, 1, rest.out.join('\n'));
  assert.ok(rest.out.some((l) => l.startsWith('FAIL c Rest ')), rest.out.join('\n'));
  assert.ok(!rest.out.some((l) => /no checkable change/.test(l)));
  const b = project(t, [klass('d', { class: undefined, covers: ['lwc/a'] })]);
  put(b, 'lwc/a/a.js', "import { LightningElement } from 'lwc';");
  const lost = await run(['verify', '--org', 'x', '--checks', b.file, '--since', 'main'], { git: gitOf([`${D}lwc/a/a.js`]), api: org({ apexClass: CLS }).api });
  assert.equal(lost.code, 1, lost.out.join('\n'));
  assert.ok(lost.out.some((l) => /^ERROR d d no class, and no covered lwc bundle imports Apex/.test(l)), lost.out.join('\n'));
});

test('a class moved into a subfolder is not deleted, and a bundle with no .js, .ts or .html left is gone', (t) => {
  const { dir } = project(t, []);
  const p = { root: dir, dirs: ['force-app'] };
  put({ dir }, 'classes/services/Moved.cls', 'public class Moved { @AuraEnabled public static void go() {} }');
  put({ dir }, 'lwc/cssonly/cssonly.css', '.a {}');
  put({ dir }, 'lwc/live/live.html', '<template></template>');
  const covers = new Set(['classes/Moved', 'classes/Gone', 'lwc/cssonly', 'lwc/live']);
  const got = verify.changes([`${D}classes/Moved.cls`, `${D}classes/services/Moved.cls`, `${D}classes/Gone.cls`, `${D}lwc/cssonly/cssonly.js`, `${D}lwc/live/live.js`], p, covers);
  const del = (k) => got.items.get(k)?.every((x) => x.deleted);
  assert.deepEqual([del('classes/Moved'), del('classes/services/Moved')], [false, false], 'neither path of a moved class is deleted: its name is on the branch');
  assert.equal(del('classes/Gone'), true);
  assert.equal(del('lwc/cssonly'), true, 'a css-only bundle is gone');
  assert.equal(del('lwc/live'), false);
});

test('a bundle is gone only when no package directory holds it with code: an earlier code-less folder does not hide the live one', (t) => {
  const { dir } = project(t, []);
  const p = { root: dir, dirs: ['first', 'force-app'] };
  fs.mkdirSync(path.join(dir, 'first/main/default/lwc/x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'first/main/default/lwc/x/x.css'), '.a {}');
  put({ dir }, 'lwc/x/x.js', "import go from '@salesforce/apex/A.go';");
  const got = verify.changes(['first/main/default/lwc/x/x.css', `${D}lwc/x/x.js`], p, new Set());
  assert.deepEqual([[...got.items.keys()], [...got.gone]], [['lwc/x'], []], 'the bundle is live in the later directory');
});

test('a class is live-checkable only with an @AuraEnabled method: not a DTO property, not a commented-out annotation', (t) => {
  const { dir } = project(t, []);
  const p = { root: dir, dirs: ['force-app'] };
  const src = { Method: 'public with sharing class A { @AuraEnabled(cacheable=true) public static String go() { return null; } }', Dto: 'public class D { @AuraEnabled public String name; @AuraEnabled public Integer n { get; set; } }',
    Stacked: "public class S { @AuraEnabled(cacheable=true)\n @SuppressWarnings('PMD.X')\n @Deprecated\n public static String go() { return null; } }", Slashes: 'public class P { // handles /api/* paths\n @AuraEnabled public static void go() {} /* end */ }',
    DtoThenMethod: 'public class T { @AuraEnabled public String name; public static void other() {} }',
    Line: 'public class L { // @AuraEnabled public static void go() {}\n public static void other() {} }', Block: 'public class B { /* @AuraEnabled\n public static void go() {} */ }', Lower: 'public class W { @auraenabled\n global static void go() {} }' };
  for (const [n, c] of Object.entries(src)) touch(dir, [`${D}classes/${n}.cls`]) || fs.writeFileSync(path.join(dir, D, `classes/${n}.cls`), c);
  const got = verify.changes(Object.keys(src).map((n) => `${D}classes/${n}.cls`), p, new Set());
  assert.deepEqual([...got.items.keys()].sort(), ['classes/Lower', 'classes/Method', 'classes/Slashes', 'classes/Stacked']);
  assert.deepEqual(got.other.sort(), ['classes/Block', 'classes/Dto', 'classes/DtoThenMethod', 'classes/Line']);
});

test('classAccess BAD_CHECK is shape only: no class and no lwc key, a non-boolean expect.access, a bad class name, no object needed', async (t) => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.match(bad(klass('a', { class: undefined, covers: ['classes/X'] })), /^a: no class, and covers names no lwc bundle/);
  assert.equal(bad(klass('a', { class: undefined, covers: ['lwc/plain'] })), undefined, 'a bundle the branch may have changed is not a shape error');
  assert.match(bad(klass('a', { expect: { access: 'yes' } })), /^a: expect.access must be true or false/);
  assert.match(bad(klass('a', { expect: {} })), /expect.access/);
  assert.match(bad(klass('a', { class: "X'; DROP" })), /^a: class must be a plain API name/);
  assert.match(bad(klass('a', { class: 5 })), /class must be a plain API name/);
  assert.equal(bad(klass('a', { class: 'ns__Name' })), undefined, 'ns__Name is a plain name, and no object is needed');
  const r = await run(['verify', '--org', 'o', '--checks', project(t, [klass('z', { class: undefined, covers: ['classes/X'] })]).file]);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^BAD_CHECK z: no class, and covers names no lwc bundle/);
});

test('--plan notes a classless check whose bundles import no Apex, and exits 0', async (t) => {
  const p = project(t, [klass('c', { class: undefined, covers: ['lwc/a'] }), klass('d', { class: undefined, covers: ['lwc/b'] }), klass('e', { covers: ['lwc/b'] }), klass('f', { class: undefined, covers: ['lwc/b', 'lwc/gone'] })]);
  put(p, 'lwc/a/a.js', "import x from '@salesforce/apex/First.go';");
  put(p, 'lwc/b/b.js', "import { LightningElement } from 'lwc';");
  const r = await run(['verify', '--plan', '--checks', p.file, '--since', 'main'], { git: gitOf([`${D}lwc/gone/gone.js`, `${D}lwc/b/b.js`]) });
  assert.equal(r.code, 0);
  assert.ok(r.out.some((l) => l.startsWith('NOTE d: no covered lwc bundle imports Apex on the branch, so it will be an ERROR at run time')), r.out.join('\n'));
  assert.ok(!r.out.some((l) => /^NOTE [cef]: no covered lwc bundle/.test(l)), 'c imports Apex, e names its class, f covers a deleted bundle and FAILs as deleted');
});

test('a classless check whose bundle is deleted or has no Apex import is an ERROR result, not exit 2', async (t) => {
  const p = project(t, [klass('c', { class: undefined, covers: ['lwc/plain'] })]);
  const r = await goc(p, org({}));
  assert.equal(r.code, 1);
  assert.match(r.out[0], /^ERROR c c no class, and no covered lwc bundle imports Apex/, r.out.join('\n'));
  put(p, 'lwc/plain/plain.js', "import { LightningElement } from 'lwc';");
  assert.match((await goc(p, org({}))).out[0], /^ERROR c c no class/);
});

test('classAccess puts every SOQL value through sq', async (t) => {
  const p = project(t, [klass('c', { class: 'ns__Cls', persona: { profile: "O'Brien\\", permissionSets: ["Se'x"] } })]);
  const o = org({ apexClass: CLS });
  await goc(p, o);
  const q = o.asked.join('\n');
  assert.match(q, /Profile.Name = 'O\\'Brien\\\\'/);
  assert.match(q, /Name = 'Se\\'x'/);
  assert.match(q, /FROM ApexClass WHERE Name = 'Cls' AND NamespacePrefix = 'ns'/);
});

test('selecting on a changed class or set runs the classAccess check that covers it', async (t) => {
  const { file, dir } = project(t, [klass('c')]);
  touch(dir, [`${D}classes/SfUiProbeController.cls-meta.xml`]);
  put({ dir }, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static void ping() {} }');
  const r = await run(['verify', '--org', 'x', '--checks', file, '--since', 'main'], { git: gitOf([`${D}classes/SfUiProbeController.cls-meta.xml`]), api: org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api });
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 1, failed 0', r.out.join('\n'));
});

test('the generated class deploys at the org\'s latest API version, whatever the project\'s', async (t) => {
  for (const [written, orgApiVersion] of [['50.0', '68.0'], ['66.0', '68.0'], ['69.0', '68.0'], [undefined, '68.0'], ['66.0', '69.0']]) {
    const { dir, file } = project(t, [THREE]);
    fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: written }));
    let seen;
    await run(['verify', '--org', 'o', '--checks', file], { connect: async () => ({ production: false, orgApiVersion }), sf: async (args, { cwd }) => { seen ??= [fs.readFileSync(path.join(cwd, 'sfdx-project.json'), 'utf8'), fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls-meta.xml'), 'utf8')]; return NOJOB(); } });
    assert.ok(seen[0].includes(`"sourceApiVersion":"${orgApiVersion}"`) && seen[1].includes(`<apiVersion>${orgApiVersion}</apiVersion>`), `${written} on ${orgApiVersion}: ${seen.join('\n')}`);
  }
});

test('the deployed persona() carries the project namespace', async (t) => {
  const { dir, file } = project(t, [THREE]);
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ namespace: 'pk', packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  let seen;
  await run(['verify', '--org', 'o', '--checks', file], { sf: async (args, { cwd }) => { seen ??= fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls'), 'utf8'); return NOJOB(); } });
  assert.ok(seen.includes("String projNs = 'pk';"), seen);
});

test('a deleted covered item fails its checks whatever --only filters out', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE]), rec('other', ['objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000'])]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main', '--only', '^other$'], { git: gitOf([`${D}${RULE}.validationRule-meta.xml`]), sf: async () => assert.fail('nothing runs') });
  assert.ok(r.out.some((l) => l.startsWith(`FAIL count-rule ${RULE} deleted on the branch`)), r.out.join('\n'));
  assert.ok(!r.out.some((l) => l.startsWith('NOT RUN')));
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 1, passed 0, failed 1');
  assert.equal(r.code, 1);
});

test('an --only that matches no check id in the file is a typo, exit 2; one that matches checks no change reaches is not', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE])]);
  const typo = await run(['verify', '--org', 'o', '--checks', file, '--only', 'cuont']);
  assert.equal(typo.code, 2);
  assert.match(typo.out[0], /^--only cuont matches no check/);
  const plan = await run(['verify', '--plan', '--checks', file, '--only', 'cuont']);
  assert.equal(plan.code, 2);
});

test('after a stop signal the next kind of check and the next page check do not start', async (t) => {
  const ac = new AbortController();
  const two = [page('p1', [F_X]), page('p2', [F_Y])];
  const { file } = project(t, [THREE, ...two]);
  const sf = async () => { ac.abort(); return NOJOB(); };
  const o = org();
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf, signal: ac.signal, api: o.api });
  assert.equal(o.asked.length, 0, 'no page check after the validate was stopped');
  assert.ok(r.out.some((l) => l.startsWith('ERROR count-rule')));
  const ac2 = new AbortController();
  const { file: f2 } = project(t, two);
  const o2 = org({ md: ORG_MD('Required') });
  const call = o2.api.call;
  o2.api.call = async (...a) => { ac2.abort(); return call(...a); };
  const r2 = await run(['verify', '--org', 'o', '--checks', f2], { signal: ac2.signal, api: o2.api });
  assert.equal(r2.out.filter((l) => /^(PASS|FAIL|ERROR) p\d/.test(l)).length, 1, r2.out.join('\n'));
});

test('a signal already aborted starts no validate', async (t) => {
  const ac = new AbortController();
  ac.abort();
  const { file } = project(t, [THREE]);
  let called = false;
  await run(['verify', '--org', 'o', '--checks', file], { signal: ac.signal, sf: async () => { called = true; return NOJOB(); } });
  assert.equal(called, false);
});

test('--junit writes each NOT RUN item as a skipped case named notrun/<key>', async (t) => {
  const due = 'objects/SfUiProbe__c/validationRules/SfUi_Due_Not_Before_2000';
  const { dir, file } = project(t, [rec('count-rule', [RULE], { cases: THREE.cases.slice(0, 2) }), rec('due-rule', [due], { cases: THREE.cases.slice(0, 2) })]);
  const files = [`${D}${RULE}.validationRule-meta.xml`, `${D}${due}.validationRule-meta.xml`];
  touch(dir, files);
  const out = path.join(dir, 'v.xml');
  await run(['verify', '--org', 'o', '--checks', file, '--since', 'main', '--only', '^count-rule$', '--junit', out], { git: gitOf(files), sf: async (args) => (args[2] === 'validate' ? OK_ENVELOPE : REPORT) });
  const xml = fs.readFileSync(out, 'utf8');
  assert.ok(xml.includes(`name="notrun/${due}"`) && xml.includes('<skipped message="--only"/>'), xml);
  assert.match(xml, /skipped="1"/);
});

test('a parse error with verify after the options prints the verify usage', async () => {
  const v = await run(['--org', 'x', 'verify', '--bogus']);
  assert.equal(v.code, 2);
  assert.match(v.out.at(-1), /\nusage: sf-tester verify /);
});

test('a branch field file is found in any case', async (t) => {
  const p = pageProject(t, LAYOUT_XML('Edit'));
  const f = path.join(p.dir, D, 'objects/SfUiTyped__c/fields/size__C.field-meta.xml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '<CustomField><required>true</required></CustomField>');
  const r = await go(p, org({ describe: { name: 'Size__c', permissionable: true, nillable: true, createable: true, defaultedOnCreate: true } }));
  assert.match(r.out[0], /^PASS size Size__c \(.*field required true from branch file\)/, r.out.join('\n'));
});

test('a standard field with a file on the branch keeps its exemption and its required state from the org', async (t) => {
  const LAYOUT_NAME = '<Layout><layoutSections><layoutColumns><layoutItems><behavior>Edit</behavior><field>Name</field></layoutItems></layoutColumns></layoutSections></Layout>';
  const p = pageProject(t, LAYOUT_NAME);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].field = 'Name';
  fs.writeFileSync(p.file, JSON.stringify(c));
  const f = path.join(p.dir, D, 'objects/SfUiTyped__c/fields/Name.field-meta.xml');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '<CustomField><fullName>Name</fullName><label>Name</label></CustomField>');
  const o = org({ readable: false, describe: { name: 'Name', permissionable: false, nillable: false, createable: true, defaultedOnCreate: false } });
  const r = await go(p, o);
  assert.match(r.out[0], /^PASS size Name \(.*field required true from org\)/, r.out.join('\n'));
  assert.ok(!o.asked.some((q) => /FROM FieldPermissions/.test(q)));
});

test('in a namespaced org the FieldPermissions and RecordType queries use the describe\'s prefixed names', async (t) => {
  const p = pageProject(t);
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: [] };
  fs.writeFileSync(p.file, JSON.stringify(c));
  const o = org({ md: ORG_MD('Required'), objectName: 'ns__SfUiTyped__c', describe: { name: 'ns__Size__c', nillable: true, createable: true, defaultedOnCreate: false } });
  await go(p, o);
  assert.ok(o.asked.some((q) => q.includes("FROM FieldPermissions WHERE SobjectType = 'ns__SfUiTyped__c' AND Field = 'ns__SfUiTyped__c.ns__Size__c'")), o.asked.join('\n'));
  assert.ok(o.asked.some((q) => q.includes("FROM RecordType WHERE SobjectType = 'ns__SfUiTyped__c'")));
});

test('a misspelt profile is ERROR even when a branch permission set grants the field', async (t) => {
  const r = await go(flsProject(t, true), org({ noProfile: true, describe: { name: 'Other__c' } }));
  assert.match(r.out[0], /^ERROR size Size__c no profile Standard Platform User in the org/);
});

test('a field the org lacks that no branch permission set grants is ERROR, not a failed read', async (t) => {
  const o = org({ readable: false, describe: { name: 'Other__c' } });
  const r = await go(flsProject(t, false), o);
  assert.match(r.out[0], /^ERROR size Size__c read access to Size__c is not checkable: the org lacks the field and no permission set on the branch grants it/);
  assert.equal(r.code, 1);
});

test('an unprefixed permission set file stands for ns__Name only in the project\'s own namespace', async (t) => {
  const asNamed = (namespace) => {
    const p = flsProject(t, true);
    const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    c.checks[0].persona.permissionSets = ['pk__SfUi_Probe'];
    fs.writeFileSync(p.file, JSON.stringify(c));
    fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0', namespace }));
    return p;
  };
  const own = await go(asNamed('pk'), org({ readable: false, describe: { name: 'Other__c' } }));
  assert.match(own.out[0], /^PASS size Size__c \(.*readable from branch permission set pk__SfUi_Probe\)/, own.out.join('\n'));
  const other = await go(asNamed('zz'), org({ readable: false, describe: { name: 'Other__c' } }));
  assert.match(other.out[0], /^ERROR size Size__c read access to Size__c is not checkable/, other.out.join('\n'));
});

test('an option value of verify does not pick the verify usage for a replay call', async () => {
  const r = await run(['replay', '--only', 'verify', '--bogus']);
  assert.equal(r.code, 2);
  assert.match(r.out.at(-1), /\nusage: sf-tester replay /);
});

test('every branch lookup matches its path in any case: layout, permission set, FlexiPage, field folder and object folder', async (t) => {
  const put = (p, rel, text) => { const f = path.join(p.dir, D, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const p = project(t, [page('size', [LAYOUT])]);
  put(p, 'LAYOUTS/sfuityped__c-sf ui typed layout.layout-meta.xml', LAYOUT_XML('Required'));
  put(p, 'PermissionSets/SFUI_PROBE.permissionset-meta.xml', SET_XML(true));
  put(p, 'OBJECTS/sfuityped__C/FIELDS/SIZE__c.field-meta.xml', '<CustomField><type>Number</type></CustomField>');
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] };
  fs.writeFileSync(p.file, JSON.stringify(c));
  const r = await go(p, org({ readable: false, describe: { name: 'Other__c' } }));
  assert.match(r.out[0], /^PASS size Size__c \(layout SF UI Typed Layout from branch file: Required; readable from branch permission set SfUi_Probe\)/, r.out.join('\n'));
  const fx = project(t, [{ ...page('dyn', ['flexipages/X']), flexiPage: 'SfUi_Dyn_Typed', recordType: undefined }]);
  put(fx, 'FlexiPages/SFUI_DYN_TYPED.flexipage-meta.xml', FLEXI_XML('required'));
  const o = org({ describe: { name: 'Size__c', permissionable: false } });
  const rx = await go(fx, o);
  assert.match(rx.out[0], /^PASS dyn Size__c \(page SfUi_Dyn_Typed from branch file: required\)/, rx.out.join('\n'));
  assert.ok(!o.asked.some((q) => /FROM FlexiPage/.test(q)));
});

test('after a stop the JUnit file lists each runnable check with no result as a skipped stopped/<id> case', async (t) => {
  const ac = new AbortController();
  const { dir, file } = project(t, [THREE, page('p1', [F_X]), page('p2', [F_Y])]);
  const out = path.join(dir, 'v.xml');
  await run(['verify', '--org', 'o', '--checks', file, '--junit', out], { sf: async () => { ac.abort(); return NOJOB(); }, signal: ac.signal, api: org().api });
  const xml = fs.readFileSync(out, 'utf8');
  assert.ok(xml.includes('name="stopped/p1"') && xml.includes('name="stopped/p2"'), xml);
  assert.ok(!xml.includes('stopped/count-rule'), 'the record check has results');
  assert.match(xml, /skipped="2"/);
});

// ---- apex checks: an act snippet, cases that return or throw, the asserts generated ----
const ACT = "return SfUiProbeController.ping((Id) input.get('recordId'));";
const apex = (id, extra = {}) => ({ id, kind: 'apex', requirement: `req ${id}`, covers: ['classes/SfUiProbeController'], persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] }, act: ACT,
  cases: [{ name: 'returns pong', expect: { returns: 'pong null' } }, { name: 'a bad id throws', input: { recordId: 'not-an-id' }, expect: { throws: 'Invalid id' } }], ...extra });

test('apex BAD_CHECK: no act, an assert or Test call, no return, no pass-and-fail pair, a bad expect or input; no object needed', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.deepEqual(verify.badChecks({ checks: [apex('a')] }), [], 'a valid apex check, no object');
  assert.match(bad(apex('a', { act: '  ' })), /^a: no act/);
  assert.match(bad(apex('a', { act: undefined })), /^a: no act/);
  for (const act of ["System.assertEquals(1, 1); return 1;", 'system . assert(true); return 1;', 'Assert.isTrue(true); return 1;', 'Test.startTest(); return 1;', 'System.Test.setMock(HttpCalloutMock.class, m); return 1;']) assert.match(bad(apex('a', { act })), /^a: act must not assert/, act);
  assert.deepEqual(verify.badChecks({ checks: [apex('a', { act: "String latest = 'x'; return latest;" })] }), [], 'a name ending in Test is not Test.');
  for (const act of ['// return later\nInteger x = 1;', 'Integer x = 1; // return x;', "String s = 'return 1;';", 'return 1; Integer x = 2;', '/* return 1; */']) assert.match(bad(apex('a', { act })), /act must end in a return statement/, act);
  // Comments and strings are not code, a field named test is not the Test class, and a local test with no call on it is fine.
  for (const act of ["Account test = [SELECT Name FROM Account LIMIT 1];\nreturn test.Name;", "return Foo.get((String) input.get('test.key'));", "// Test.startTest() is not called\nreturn 'System.assert(x)';", "String url = 'http://x//y'; /* Assert.isTrue(1) */ return url;", "return Foo.go('it\\'s;');",
    'return wrapper.test.size();', 'return wrapper.Test.size();', 'return MyTest.run();',
    // The one Test call allowed: the standard price book's id, for a PricebookEntry.
    'Id p = Test.getStandardPricebookId(); return p;', 'return System.Test.getStandardPricebookId();', 'return Test . getStandardPricebookId ( );', 'Id p = Test.GetStandardPricebookId(); return p;']) assert.deepEqual(verify.badChecks({ checks: [apex('a', { act })] }), [], act);
  // A call on a local named test is refused with a rename hint: a regex cannot tell when the local shadows the class.
  for (const act of ['Foo test = new Foo(); return test.run();', "Map<String,Object> test = input; return test.get('k');", 'List<Integer> test = new List<Integer>(); test.add(1); return test.size();',
    'Test.startTest(); Integer test = 0; return test;', 'if (input == null) { Integer test = 0; } Test.startTest(); return 1;', 'for (Integer test = 0; test < 1; test++) {} Test.startTest(); return 1;',
    'Object o = 1; Boolean isT = o instanceof Test; Test.startTest(); return isT;']) assert.match(bad(apex('a', { act })), /a call on a local named test counts too, as verify cannot tell it from the Test class: rename the local/, act);
  for (const act of ['System.assert(true); return 1;', 'System.assert(true); Test.startTest(); return 1;']) assert.doesNotMatch(bad(apex('a', { act })), /rename/, `an assert gets no rename hint: ${act}`);
  for (const act of ['Test.setMock(HttpCalloutMock.class, m); return 1;', 'Test.loadData(Account.sObjectType, \'r\'); return 1;', 'Test.isRunningTest(); return 1;', 'System.assert(true); return 1;', 'Test.startTest(); Id p = Test.getStandardPricebookId(); return p;', 'Test . enableChangeDataCapture(); return 1;', 'Test.getStandardPricebookIdX(); return 1;']) assert.match(bad(apex('a', { act })), /act must not assert/, act);
  // Apex names are case-insensitive, so every case of Test reaches the class.
  for (const act of ['test.startTest(); return 1;', 'TEST.stopTest(); return 1;', 'system.Test.startTest(); return 1;', 'System.test.startTest(); return 1;', 'test.isRunningTest(); return 1;', 'test.setMock(HttpCalloutMock.class, m); return 1;']) assert.match(bad(apex('a', { act })), /act must not assert/, act);
  assert.match(bad(apex('a', { act: 'Integer x = 1;' })), /^a: act must end in a return statement/);
  const [pass, fail] = apex('a').cases;
  assert.match(bad(apex('a', { cases: [pass] })), /needs a case that returns and a case that throws/);
  assert.match(bad(apex('a', { cases: [fail] })), /needs a case that returns and a case that throws/);
  assert.match(bad(apex('a', { cases: [] })), /each case needs a name and expect/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, name: pass.name }] })), /two cases have the same name/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, expect: { returns: 1, throws: 'x' } }] })), /case "a bad id throws": expect needs exactly one/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, expect: {} }] })), /expect needs exactly one/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, expect: { throws: '' } }] })), /expect.throws must be non-empty text/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, input: { recordId: { nested: 1 } } }] })), /input must be an object of plain values/);
  assert.match(bad(apex('a', { cases: [pass, { ...fail, input: [1] }] })), /input must be an object/);
  assert.deepEqual(verify.badChecks({ checks: [apex('a', { cases: [{ name: 'null', expect: { returns: null } }, fail] })] }), [], 'returns takes any JSON value, null too');
  for (const returns of [9007199254740993, [1, { n: 9007199254740993 }]]) assert.match(bad(apex('a', { cases: [{ name: 'big', expect: { returns } }, fail] })), /expect.returns holds an integer past the safe range/);
  assert.deepEqual(verify.badChecks({ checks: [apex('a', { cases: [{ name: 'ok', expect: { returns: [9007199254740991, 1.5, 'x'] } }, fail] })] }), [], 'a safe integer and a decimal pass');
});

test('the apex generator emits act_c<i>, the runAs call, the try/catch and both assert shapes, act as code and expect as literals', () => {
  const act = "String s = 'it\\'s';\n// a \"note\"\nreturn s + (String) input.get('k');";
  const c = apex('ap', { act, cases: [{ name: 'q', input: { k: "a'b\nc", n: 5, d: { date: '2026-01-31' } }, expect: { returns: { say: "it's\n\"x\"" } } }, { name: 'r', expect: { throws: "can't\nfind" } }] });
  const { apex: src, methods } = verify.generate([rec('r0', ['k']), c]);
  assert.deepEqual([...methods.keys()], ['c0_0', 'c0_1', 'c1_0', 'c1_1'], 'one class, unique method names');
  assert.deepEqual(methods.get('c1_1'), { check: 'ap', name: 'r' });
  assert.ok(src.includes(`static Object act_c1(Map<String,Object> input) {\n${act}\n    }`), 'act verbatim: quote, newline and comment untouched');
  assert.equal(src.split('static Object act_c1').length, 2, 'act_c1 once, not per case');
  assert.match(src, /@IsTest static void c1_0\(\) \{\n        User u = persona\('Standard Platform User', new List<String>\{'SfUi_Probe'\}\);/);
  assert.match(src, /new Map<String,Object>\{'k' => 'a\\'b\\nc', 'n' => 5, 'd' => Date\.valueOf\('2026-01-31'\)\}/);
  assert.match(src, /System\.runAs\(u\) \{\n            try \{ got = act_c1\(input\); \} catch \(Exception e\) \{ threw = e\.getTypeName\(\) \+ ': ' \+ e\.getMessage\(\); \}\n        \}/);
  assert.ok(src.includes("System.assert(threw == null, 'expected a return, but it threw ' + threw);"));
  assert.ok(src.includes('JSON.deserializeUntyped(\'{"say":"it\\\'s\\\\n\\\\"x\\\\""}\')'), 'expected JSON as an escaped string literal');
  // A return JSON cannot serialize is a FAIL that says so, not a raw JSONException.
  assert.ok(src.includes("Object have;\n        try { have = JSON.deserializeUntyped(JSON.serialize(got)); } catch (Exception ex) { System.assert(false, 'returned a value JSON cannot serialize: ' + ex.getMessage()); }"));
  // The message is built only on failure, so an unserializable value cannot hide the verdict.
  assert.ok(src.includes("if (!same(have, want)) System.assert(false, 'expected ' + JSON.serialize(want) + ', got ' + JSON.serialize(have));"));
  // One by-value helper: numbers as Decimals, maps by key set, lists by index, the rest by equals.
  assert.equal(src.split('static Boolean same(Object a, Object b)').length, 2, 'one helper');
  for (const part of ['dec(a) - dec(b) == 0', 'x.keySet().equals(y.keySet())', 'if (x.size() != y.size()) return false;', 'return a.equals(b);', 'same(x.get(k), y.get(k))', 'same(x[i], y[i])']) assert.ok(src.includes(part), part);
  assert.ok(!verify.generate([rec('r0', ['k'])]).apex.includes('same('), 'a record-only class has no helper');
  assert.ok(src.includes("if (threw == null) System.assert(false, 'expected a throw, but it returned ' + String.valueOf(got));"));
  assert.ok(src.includes("if (!threw.contains('can\\'t\\nfind')) System.assert(false, 'expected an error containing ' + 'can\\'t\\nfind' + ', got: ' + threw);"));
  assert.equal(verify.generate([apex('x', { cases: apex('x').cases.map((k) => ({ name: k.name, expect: k.expect })) })]).apex.includes('new Map<String,Object>{}'), true, 'no input is an empty map');
});

const REPORT_OF = (ok, bad) => JSON.stringify({ status: 0, result: { status: Object.keys(bad).length ? 'Failed' : 'Succeeded', details: { runTestResult: { successes: ok.map((methodName) => ({ methodName })), failures: Object.entries(bad).map(([methodName, message]) => ({ methodName, message: `System.AssertException: Assertion Failed: ${message}` })) } } } });

test('record and apex checks share one class and one validate, and each apex case maps back with its own verdict', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE]), apex('probe-ping')]);
  const seen = [];
  const sf = async (args, { cwd }) => {
    seen.push({ args, src: fs.existsSync(cwd) ? fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls'), 'utf8') : '' });
    return seen.length === 1 ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1', 'c1_0'], { c1_1: "expected an error containing Invalid id, got: System.StringException: nope" });
  };
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.equal(seen.filter((s) => s.args[1] === 'deploy' && s.args[2] === 'validate').length, 1, 'one validate');
  assert.ok(/act_c1/.test(seen[0].src) && /void c0_0/.test(seen[0].src) && /void c1_1/.test(seen[0].src), 'both kinds in the one class');
  assert.deepEqual(r.out.slice(0, 4), ['PASS count-rule rejects', 'PASS count-rule accepts', 'PASS probe-ping returns pong',
    'FAIL probe-ping a bad id throws expected an error containing Invalid id, got: System.StringException: nope (requirement: req probe-ping)']);
  assert.equal(r.code, 1);
  assert.match(r.out.at(-1), /ran 4, passed 3, failed 1/);
  // A persona that cannot be built is the setup failing, not the requirement.
  const s2 = await run(['verify', '--org', 'o', '--checks', file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1', 'c1_0'], { c1_1: 'SETUP: profile not found: X' })) });
  assert.ok(s2.out.some((l) => l.startsWith('ERROR probe-ping a bad id throws SETUP: profile not found: X')), s2.out.join('\n'));
  // An apex check alone still runs the validate.
  const only = project(t, [apex('probe-ping')]);
  const o = await run(['verify', '--org', 'o', '--checks', only.file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {})) });
  assert.equal(o.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 2, passed 2, failed 0');
});

test('with --since the payload carries every changed class and the branch tests that name one, and --tests lists them', async (t) => {
  const { dir, file } = project(t, [apex('probe-ping'), rec('count-rule', [RULE])]);
  const files = [`${D}classes/SfUiProbeController.cls`, `${D}classes/Other.cls`, `${D}${RULE}.validationRule-meta.xml`, `${D}classes/Gone.cls`, `${D}classes/ChangedTest.cls`];
  touch(dir, [...files.slice(0, 3), `${D}classes/SfUiProbeController.cls-meta.xml`, `${D}classes/Other.cls-meta.xml`]);
  const w = (n, src) => { put({ dir }, `classes/${n}.cls`, src); put({ dir }, `classes/${n}.cls-meta.xml`, '<x/>'); };
  w('SfUiProbeController', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  w('Other', 'public class Other { public static void go() {} }');
  w('OtherTest', '@isTest private class OtherTest { @isTest static void t() { Other.go(); } }');
  w('PingTest', '@IsTest\nprivate class PingTest { @IsTest static void t() { SfUiProbeController.ping(null); } }');
  w('UnrelatedTest', '@IsTest private class UnrelatedTest { @IsTest static void t() { Integer other2 = 1; } }');
  w('CommentTest', '@IsTest private class CommentTest { // Other is not called\n @IsTest static void t() { /* SfUiProbeController */ } }');
  w('ChangedTest', '@IsTest private class ChangedTest { @IsTest static void t() { Integer x = 1; } }');
  w('Helper', 'public class Helper { Other o; }');
  const seen = [];
  const sf = async (args, { cwd }) => { seen.push({ args, files: fs.readdirSync(path.join(cwd, 'force-app/main/default'), { recursive: true }).filter((f) => /\.cls$/.test(f)).sort() }); return NOJOB(); };
  await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf(files), sf });
  assert.deepEqual(seen[0].files, ['classes/ChangedTest.cls', 'classes/Other.cls', 'classes/OtherTest.cls', 'classes/PingTest.cls', 'classes/SfTesterVerifyTest.cls', 'classes/SfUiProbeController.cls'], 'changed classes (a changed test too), the tests naming them; a deleted class, a test that names none, a comment mention and a plain referencer are not');
  assert.ok(fs.existsSync(path.join(dir, D, 'classes/Other.cls-meta.xml')));
  assert.deepEqual(seen[0].args.slice(seen[0].args.indexOf('--tests')).slice(0, 8), ['--tests', 'SfTesterVerifyTest', '--tests', 'ChangedTest', '--tests', 'OtherTest', '--tests', 'PingTest']);
  // A record check alone carries them too: its verdict does not depend on which apex checks run.
  const rc = project(t, [rec('count-rule', [RULE])]);
  for (const f of ['Other', 'OtherTest']) put(rc, `classes/${f}.cls`, f === 'Other' ? 'public class Other {}' : '@IsTest class OtherTest { static void t() { Other.x(); } }');
  touch(rc.dir, [`${D}${RULE}.validationRule-meta.xml`]);
  const rec1 = [];
  await run(['verify', '--org', 'o', '--checks', rc.file, '--since', 'main'], { git: gitOf([`${D}classes/Other.cls`, `${D}${RULE}.validationRule-meta.xml`]), sf: async (a, { cwd }) => { rec1.push(fs.readdirSync(path.join(cwd, 'force-app/main/default/classes')).sort()); return NOJOB(); } });
  assert.ok(rec1[0]?.includes('Other.cls') && rec1[0].includes('OtherTest.cls'), String(rec1[0]));
  // Without --since nothing extra goes in and the validate names one test.
  const plain = [];
  await run(['verify', '--org', 'o', '--checks', file], { sf: async (a, { cwd }) => { plain.push([fs.readdirSync(path.join(cwd, 'force-app/main/default/classes')).sort(), a]); return NOJOB(); } });
  assert.deepEqual(plain[0][0], ['SfTesterVerifyTest.cls', 'SfTesterVerifyTest.cls-meta.xml']);
  assert.equal(plain[0][1].filter((x) => x === '--tests').length, 1);
});

test('an apex check that covers an @AuraEnabled class also gets a generated classAccess check; a plain class gets none', async (t) => {
  const sf = async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {}));
  const once = async (checks, src) => {
    const p = project(t, checks);
    put(p, 'classes/SfUiProbeController.cls', src);
    put(p, 'classes/SfUiProbeController.cls-meta.xml', '<x/>');
    const o = org({ apexClass: CLS, grantedBy: ['0PSnamed'] });
    return run(['verify', '--org', 'x', '--checks', p.file], { api: o.api, sf });
  };
  const AURA = 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }';
  const r = await once([apex('probe-ping')], AURA);
  assert.deepEqual(r.out.slice(0, 3), ['PASS probe-ping returns pong', 'PASS probe-ping a bad id throws', 'PASS probe-ping/classAccess SfUiProbeController (org; class API 66.0 from org)']);
  assert.match(r.out.at(-1), /ran 3, passed 3, failed 0/);
  // A persona the class is not granted to fails the generated check, naming the check and the requirement.
  const p = project(t, [apex('probe-ping')]);
  put(p, 'classes/SfUiProbeController.cls', AURA);
  const denied = await run(['verify', '--org', 'x', '--checks', p.file], { api: org({ apexClass: CLS }).api, sf });
  assert.ok(denied.out.some((l) => /^FAIL probe-ping\/classAccess SfUiProbeController .* cannot call SfUiProbeController \(.*\(requirement: req probe-ping\)$/.test(l)), denied.out.join('\n'));
  assert.equal(denied.code, 1);
  assert.equal((await once([apex('probe-ping')], 'public class SfUiProbeController { public static String ping(Id i) { return null; } }')).out.at(-1), 'changed 0, covered 0, uncovered 0, ran 2, passed 2, failed 0', 'a plain class: none');
});

const PING = 'classes/SfUiProbeController.cls';
test('red proof: ping returning pang goes red on the returns case', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(PING), "'pong ' + recordId", "'pang ' + recordId"));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL probe-ping returns pong')), r.out.join('\n'));
});

test('red proof: ping throwing for a null id fails the returns case and names the exception', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(PING), 'return', "if (recordId == null) throw new AuraHandledException('no id');\n        return"));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => /^FAIL probe-ping returns pong .*AuraHandledException/.test(l)), r.out.join('\n'));
});

test('red proof: stamping with another prefix goes red on the stamps case', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('classes/S4Fix_Stamp.cls'), "'stamped:'", "'marked:'"));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL s4fix-stamp stamps the text')), r.out.join('\n'));
});

test('same() in the org: a Decimal equals a whole JSON number, a map at any key order, a list by item; a wrong value fails', live, async (t) => {
  const dir = fixtureCopy(t, 'verify-same-');
  const value = (id, ret, want) => apex(id, { act: `if (input.get('t') == true) throw new IllegalArgumentException('control'); ${ret}`,
    cases: [{ name: 'returns', expect: { returns: want } }, { name: 'throws', input: { t: true }, expect: { throws: 'control' } }] });
  const map = "Map<String, Object> m = new Map<String, Object>(); m.put('b', 2); m.put('a', 1.0); return m;";
  const checks = [value('scale', 'return 2.0;', 2), value('order', map, { a: 1, b: 2 }), value('list', "return new List<Object>{ 1, 'x' };", [1, 'x']), value('wrong', 'return 1.50;', 1.6)];
  fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks }));
  const r = await run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  const verdict = (id) => r.out.find((l) => l.startsWith(`PASS ${id} returns`) || l.startsWith(`FAIL ${id} returns`) || l.startsWith(`ERROR ${id} returns`))?.split(' ')[0];
  assert.deepEqual(['scale', 'order', 'list', 'wrong'].map(verdict), ['PASS', 'PASS', 'PASS', 'FAIL'], r.out.join('\n'));
});

test('red proof: a plain insert in an act is refused for a persona without create; with create, or set up with insert as system, it passes', live, async (t) => {
  const dir = fixtureCopy(t, 'verify-crud-');
  // No field the read-only set cannot edit, so only object create can refuse the insert.
  const rec = "new SfUiProbe__c(Name = 'verify crud', Tags__c = 'Alpha')";
  const check = (id, sets, body, want) => apex(id, { persona: { profile: 'Standard Platform User', permissionSets: sets },
    act: `if (input.get('t') == true) throw new IllegalArgumentException('control'); ${body}`,
    cases: [{ name: 'returns', expect: { returns: want } }, { name: 'throws', input: { t: true }, expect: { throws: 'control' } }] });
  const checks = [check('denied', ['SfUi_Probe_Read'], `insert ${rec}; return 'inserted';`, 'inserted'),
    check('granted', ['SfUi_Probe'], `insert ${rec}; return 'inserted';`, 'inserted'),
    check('setup', ['SfUi_Probe_Read'], `insert as system ${rec}; return [SELECT COUNT() FROM SfUiProbe__c WHERE Name = 'verify crud'];`, 1)];
  fs.writeFileSync(path.join(dir, 'verify-checks.json'), JSON.stringify({ checks }));
  const r = await run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json')], { sf: undefined, connect: undefined });
  const verdict = (id) => r.out.find((l) => /^(PASS|FAIL|ERROR) /.test(l) && l.split(' ')[1] === id && l.split(' ')[2] === 'returns')?.split(' ')[0];
  assert.ok(r.out.some((l) => /^FAIL denied returns .*DML operation INSERT not allowed on SfUiProbe__c/.test(l)), r.out.join('\n'));
  assert.deepEqual(['denied', 'granted', 'setup'].map(verdict), ['FAIL', 'PASS', 'PASS'], r.out.join('\n'));
});

test('green control: a comment edit in SfUiProbeController stays green', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at(PING), 'return', '// an edited comment\n        return'));
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('PASS probe-ping returns pong')), r.out.join('\n'));
});

test('a validate that ended Failed with every method passed is ERROR, naming the status and the coverage warning', async (t) => {
  const { file } = project(t, [apex('probe-ping')]);
  const cov = JSON.stringify(sample('validate-coverage-warning.json'));
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : cov) });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.replace(/ \(requirement.*/, '')), ['ERROR probe-ping returns pong validate 0Af9H000009Y79xSAC ended Failed: Test coverage of selected Apex Class is 4.762%, at least 75% test coverage is required', 'ERROR probe-ping a bad id throws validate 0Af9H000009Y79xSAC ended Failed: Test coverage of selected Apex Class is 4.762%, at least 75% test coverage is required']);
  assert.match(r.out.at(-1), /passed 0, failed 0, errors 2$/);
  // No warning text: the status names the reason. A Succeeded deploy still passes.
  const bare = JSON.parse(cov);
  delete bare.result.details.runTestResult.codeCoverageWarnings;
  const b = await run(['verify', '--org', 'o', '--checks', file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : JSON.stringify(bare)) });
  assert.ok(b.out[0].startsWith('ERROR probe-ping returns pong validate 0Af9H000009Y79xSAC ended Failed'), b.out.join('\n'));
  bare.result.status = 'Succeeded';
  const ok = await run(['verify', '--org', 'o', '--checks', file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : JSON.stringify(bare)) });
  assert.equal(ok.code, 0, ok.out.join('\n'));
});

test('--since reads a change under <package>/<folder>/main/default/: the item, the payload and the branch file', async (t) => {
  const { dir, file } = project(t, [rec('count-rule', [RULE])]);
  const f = `force-app/sales/main/default/${RULE}.validationRule-meta.xml`;
  touch(dir, [f]);
  assert.equal(verify.itemOf(f, { dirs: ['force-app'] }).key, RULE);
  // Main/Default is no root for rootsOf, so itemOf does not strip it either: the two agree on every file system.
  assert.equal(verify.itemOf(`force-app/sales/Main/Default/${RULE}.validationRule-meta.xml`, { dirs: ['force-app'] }).key, `sales/Main/Default/${RULE}`);
  assert.equal(verify.resolveCI(verify.loadProject(file), `${RULE}.validationRule-meta.xml`), path.join(dir, f), 'the branch file is read, not the org\'s');
  const seen = [];
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([f]), sf: async (a, { cwd }) => { seen.push(fs.existsSync(path.join(cwd, D, `${RULE}.validationRule-meta.xml`))); return a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {}); } });
  assert.equal(r.out.at(-1), 'changed 1, covered 1, uncovered 0, ran 2, passed 2, failed 0', r.out.join('\n'));
  assert.deepEqual(seen.slice(0, 1), [true], 'the changed rule is in the validate payload');
});

test('a record check on a rule whose formula reads ISNEW, ISCHANGED or PRIORVALUE says it is insert only; text outside the formula and a plain rule get no note', async (t) => {
  const sf = async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {}));
  const once = async (formula, around = '') => {
    const p = project(t, [rec('count-rule', [RULE])]);
    put(p, `${RULE}.validationRule-meta.xml`, `<ValidationRule>${around}<errorConditionFormula>${formula}</errorConditionFormula></ValidationRule>`);
    return (await run(['verify', '--org', 'o', '--checks', p.file], { sf })).out.slice(0, 2);
  };
  assert.deepEqual(await once('AND(ischanged(Count__c), Count__c &lt; 0)'), ['PASS count-rule rejects (insert only: the rule reads ISCHANGED, which an update would exercise and this check does not)', 'PASS count-rule accepts (insert only: the rule reads ISCHANGED, which an update would exercise and this check does not)']);
  assert.match((await once('PRIORVALUE(Count__c) &gt; Count__c'))[0], /reads PRIORVALUE,/);
  // An insert makes ISNEW() true, so a NOT(ISNEW()) rule never fires on one; a description that names ISCHANGED( is no formula.
  assert.match((await once('AND(NOT(ISNEW()), Count__c &lt; 0)'))[0], /^PASS count-rule rejects \(insert only: the rule reads ISNEW, which an update would exercise/);
  assert.deepEqual(await once('Count__c &lt; 0', '<description>Unlike ISCHANGED(Count__c), a business rule</description><errorMessage>PRIORVALUE( is not read</errorMessage>'), ['PASS count-rule rejects', 'PASS count-rule accepts']);
  assert.deepEqual(await once('Count__c &lt; 0'), ['PASS count-rule rejects', 'PASS count-rule accepts'], 'control: a plain rule');
});

test('the report step keeps a stop\'s or a code bug\'s own message; only the org or the CLI failing there is "did not answer"', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE])]);
  const once = async (err, ac) => (await run(['verify', '--org', 'o', '--checks', file], { signal: ac?.signal, sf: async (a) => { if (a[2] === 'validate') return OK_ENVELOPE; ac?.abort(); throw err; } })).out[0];
  assert.match(await once(new TypeError('x is not a function')), /^ERROR count-rule rejects x is not a function \(/);
  assert.match(await once(new Error('The operation was aborted'), new AbortController()), /^ERROR count-rule rejects The operation was aborted \(/);
  assert.match(await once(new Error('sf: socket hang up')), /^ERROR count-rule rejects report 0Af9H000009Y79xSAC did not answer: sf: socket hang up/, 'control: a fault');
});

test('a carried repo test that fails is a row of its own beside the case rows, which stand; a Failed validate is never green', async (t) => {
  const { file } = project(t, [rec('count-rule', [RULE])]);
  // As the org answered on sfui-s4-cascade: Failed, the generated methods in successes, the carried test in failures.
  const rep = (failures, successes = ['c0_0', 'c0_1'], status = failures.length ? 'Failed' : 'Succeeded') => JSON.stringify({ status: 0, result: { status, details: { runTestResult: { numTestsRun: 3, successes: successes.map((methodName) => ({ name: 'SfTesterVerifyTest', methodName })), failures } } } });
  const go2 = (body) => run(['verify', '--org', 'o', '--checks', file], { sf: async (a) => (a[2] === 'validate' ? OK_ENVELOPE : body) });
  const bad = [{ name: 'OtherTest', methodName: 't', message: 'System.AssertException: Assertion Failed: nope' }];
  const r = await go2(rep(bad));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.deepEqual(r.out.slice(0, 3).map((l) => l.replace(/ \(requirement.*/, '')), ['PASS count-rule rejects', 'PASS count-rule accepts', 'ERROR carried OtherTest.t carried test failed: System.AssertException: Assertion Failed: nope']);
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 2, passed 2, failed 0, errors 1');
  // A case that fails beside it: both are named.
  const mixed = await go2(rep([...bad, { name: 'SfTesterVerifyTest', methodName: 'c0_0', message: 'System.AssertException: Assertion Failed: expected a rejection, but it saved' }], ['c0_1']));
  assert.deepEqual(mixed.out.slice(0, 3).map((l) => l.replace(/ \(requirement.*/, '')), ['FAIL count-rule rejects expected a rejection, but it saved', 'PASS count-rule accepts', 'ERROR carried OtherTest.t carried test failed: System.AssertException: Assertion Failed: nope']);
  // A carried test method that shares a generated method's name is the carried row's, never that case's FAIL.
  const twin = await go2(rep([{ name: 'RepoTest', methodName: 'c0_0', message: 'repo boom' }]));
  assert.deepEqual(twin.out.slice(0, 3).map((l) => l.replace(/ \(requirement.*/, '')), ['PASS count-rule rejects', 'PASS count-rule accepts', 'ERROR carried RepoTest.c0_0 carried test failed: repo boom']);
  const passTwin = JSON.parse(rep([], ['c0_1']));
  passTwin.result.details.runTestResult.successes.push({ name: 'RepoTest', methodName: 'c0_0' });
  assert.match((await go2(JSON.stringify(passTwin))).out[0], /^ERROR count-rule rejects no result for c0_0/, 'a carried success is not our pass');
  // A failure row with no name is the generated class's only by one of its methods; any other is carried and red.
  const nameless = await go2(rep([{ methodName: 'x', message: 'boom' }]));
  assert.equal(nameless.code, 1, nameless.out.join('\n'));
  assert.ok(nameless.out.includes('ERROR carried a test with no name.x carried test failed: boom'), nameless.out.join('\n'));
  const ownNameless = await go2(rep([{ methodName: 'c0_0', message: 'System.AssertException: Assertion Failed: expected a rejection, but it saved' }], ['c0_1']));
  assert.match(ownNameless.out[0], /^FAIL count-rule rejects expected a rejection/, ownNameless.out.join('\n'));
  assert.ok(!ownNameless.out.some((l) => l.startsWith('ERROR carried')), `no carried row for a nameless row of ours: ${ownNameless.out.join('\n')}`);
  // Failed with a carried failure and coverage warnings: the warnings are a row of their own too.
  const warned = JSON.parse(rep(bad));
  warned.result.details.runTestResult.codeCoverageWarnings = [{ message: 'Average test coverage across all Apex Classes and Triggers is 70%' }];
  const cw = await go2(JSON.stringify(warned));
  assert.ok(cw.out.some((l) => l.startsWith('ERROR carried coverage validate 0Af9H000009Y79xSAC ended Failed: Average test coverage')), cw.out.join('\n'));
  // Failed with no test failing, a coverage failure: every case ERROR, as before.
  const cover = await go2(rep([], ['c0_0', 'c0_1'], 'Failed'));
  assert.equal(cover.out.filter((l) => /^ERROR count-rule .* ended Failed/.test(l)).length, 2, cover.out.join('\n'));
  const ok = await go2(rep([]));
  assert.equal(ok.code, 0, `control: no carried failure is green: ${ok.out.join('\n')}`);
});

test('red proof: eight uncovered methods leave SfUiProbeController under 75% and every probe-ping case ERROR, never PASS', live, async (t) => {
  const more = Array.from({ length: 8 }, (_, i) => `    public static Integer extra${i}() { Integer x = ${i}; x++; return x; }`).join('\n');
  const r = await changed(t, (at) => rewrite(at(PING), '    @AuraEnabled', `${more}\n    @AuraEnabled`), ['--only', '^probe-ping$']);
  const out = r.out.join('\n');
  assert.equal(r.code, 1, out);
  const mine = r.out.filter((l) => /^(PASS|FAIL|ERROR) probe-ping (returns pong|a bad id throws)/.test(l));
  assert.equal(mine.length, 2, out);
  assert.ok(mine.every((l) => l.startsWith('ERROR ') && /ended Failed: .*coverage/i.test(l)), out);
});

test('a compile error in one act names that check; the others say the class did not compile because of it', async (t) => {
  const bad = apex('broken', { act: 'Integer x = 1;\nreturn Nope.call(); // BROKEN\n' });
  const { file } = project(t, [rec('count-rule', [RULE]), apex('fine'), bad]);
  let src = '';
  const sf = async (args, { cwd }) => {
    if (args[2] === 'validate') { src = fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls'), 'utf8'); return OK_ENVELOPE; }
    const lineNumber = src.split('\n').findIndex((l) => l.includes('// BROKEN')) + 1;
    return JSON.stringify({ status: 1, result: { status: 'Failed', details: { componentFailures: [{ fullName: 'SfTesterVerifyTest', lineNumber, problem: 'Variable does not exist: Nope' }] } } });
  };
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.ok(r.out.some((l) => /^ERROR broken returns pong .*SfTesterVerifyTest: Variable does not exist: Nope/.test(l)), r.out.join('\n'));
  assert.equal(r.out.filter((l) => /^ERROR (count-rule|fine) .*did not compile because of check broken/.test(l)).length, 4, r.out.join('\n'));
  assert.ok(!r.out.some((l) => /^ERROR (count-rule|fine) .*Variable does not exist/.test(l)), 'the compiler message stays on the check that caused it');
});

test('a generated classAccess check needs the act to name the class, and yields to an identical check of the user', async (t) => {
  const AURA = (n) => `public class ${n} { @AuraEnabled public static String ping(Id i) { return null; } }`;
  const sf = async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {}));
  const generated = async (checks) => {
    const p = project(t, checks);
    for (const n of ['SfUiProbeController', 'OrderController']) put(p, `classes/${n}.cls`, AURA(n));
    const r = await run(['verify', '--org', 'x', '--checks', p.file], { api: org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api, sf });
    return r.out.filter((l) => /^(PASS|FAIL|ERROR) \S+\/classAccess /.test(l)).map((l) => l.split(' ').slice(1, 3).join(' '));
  };
  const both = ['classes/SfUiProbeController', 'classes/OrderController'];
  // OrderController is covered but named only in a comment and a string: no check for it.
  const act = "// OrderController is not called\nString s = 'OrderController';\nreturn SfUiProbeController.ping((Id) input.get('recordId'));";
  assert.deepEqual(await generated([apex('probe-ping', { covers: both, act })]), ['probe-ping/classAccess SfUiProbeController']);
  const both2 = "return OrderController.ping(null) + SfUiProbeController.ping(null);";
  assert.deepEqual((await generated([apex('probe-ping', { covers: both, act: both2 })])).sort(), ['probe-ping/classAccess OrderController', 'probe-ping/classAccess SfUiProbeController']);
  // The user's own check for the same class, persona and access true stands in; one that expects false does not.
  assert.deepEqual(await generated([apex('probe-ping'), klass('mine')]), []);
  assert.deepEqual(await generated([apex('probe-ping'), klass('mine', { expect: { access: false } })]), ['probe-ping/classAccess SfUiProbeController']);
  // A class in a subfolder is read at its cover key.
  const nested = project(t, [apex('probe-ping', { covers: ['classes/services/Nested'], act: 'return Nested.ping(null);' })]);
  put(nested, 'classes/services/Nested.cls', AURA('Nested'));
  const nr = await run(['verify', '--org', 'x', '--checks', nested.file], { api: org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api, sf });
  assert.ok(nr.out.some((l) => /^PASS probe-ping\/classAccess Nested /.test(l)), nr.out.join('\n'));
  // Its id could collide with the generated one.
  assert.match(verify.badChecks({ checks: [klass('probe-ping/classAccess')] })[0], /^probe-ping\/classAccess: an id cannot hold a slash/);
});

test('generated classAccess checks are STOPPED and skipped in JUnit after a stop, and --plan lists them and the carried classes', async (t) => {
  const ac = new AbortController();
  const p = project(t, [apex('probe-ping')]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  put(p, 'classes/SfUiProbeController.cls-meta.xml', '<x/>');
  const out = path.join(p.dir, 'v.xml');
  const sf = async (a) => { if (a[2] === 'validate') return OK_ENVELOPE; ac.abort(); return REPORT_OF(['c0_0', 'c0_1'], {}); };
  const r = await run(['verify', '--org', 'x', '--checks', p.file, '--junit', out], { api: org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api, sf, signal: ac.signal });
  assert.ok(r.out.includes('STOPPED probe-ping/classAccess SfUiProbeController (stopped by a signal)'), r.out.join('\n'));
  assert.match(r.out.at(-1), /, stopped 1$/);
  assert.ok(fs.readFileSync(out, 'utf8').includes('name="stopped/probe-ping/classAccess/SfUiProbeController"'));
  const files = [`${D}classes/SfUiProbeController.cls`];
  const plan = await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf(files) });
  assert.ok(plan.out.includes('would run: probe-ping, probe-ping/classAccess SfUiProbeController'), plan.out.join('\n'));
  assert.ok(plan.out.includes('would carry: SfUiProbeController'), plan.out.join('\n'));
});

test('one runner per kind, for every kind a check can have, drives the run loop', () => {
  assert.deepEqual(Object.keys(verify.RUNNERS).sort(), ['apex', 'classAccess', 'componentVisible', 'flow', 'pageRequired', 'record']);
  assert.equal(verify.RUNNERS.apex, verify.RUNNERS.record, 'apex rides in the record validate');
  assert.equal(verify.RUNNERS.flow, verify.RUNNERS.record, 'a flow check is generated as apex, in the same validate');
});

// Runs three checks, then answers the report with componentFailures built from the line of the broken act.
async function compileRun(t, failures) {
  const { file } = project(t, [rec('count-rule', [RULE]), apex('fine'), apex('broken', { act: 'Integer x = 1;\nreturn Nope.call(); // BROKEN\n' })]);
  let src = '';
  const sf = async (args, { cwd }) => {
    if (args[2] === 'validate') { src = fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls'), 'utf8'); return OK_ENVELOPE; }
    const at = src.split('\n').findIndex((l) => l.includes('// BROKEN')) + 1;
    return JSON.stringify({ status: 1, result: { status: 'Failed', details: { componentFailures: failures(at) } } });
  };
  return run(['verify', '--org', 'o', '--checks', file], { sf });
}

test('a compile failure in another component is never blamed on an act, even on a line inside one', async (t) => {
  const r = await compileRun(t, (at) => [{ fullName: 'OrderController', componentType: 'ApexClass', lineNumber: at, problem: 'Nope in a carried class' }]);
  assert.equal(r.out.filter((l) => /^ERROR \S+ .*OrderController: Nope in a carried class/.test(l)).length, 6, r.out.join('\n'));
  assert.ok(!r.out.some((l) => /did not compile because of check/.test(l)), r.out.join('\n'));
});

test('two compile errors in one act, or one with only a (line:col) in its text, still name that act', async (t) => {
  const two = await compileRun(t, (at) => [{ fullName: 'SfTesterVerifyTest', lineNumber: at, problem: 'First' }, { fullName: 'SfTesterVerifyTest', lineNumber: at, problem: 'Second' }]);
  assert.ok(two.out.some((l) => /^ERROR broken returns pong .*First; SfTesterVerifyTest: Second/.test(l)), two.out.join('\n'));
  assert.equal(two.out.filter((l) => /^ERROR (count-rule|fine) .*did not compile because of check broken$/.test(l.replace(/ \(requirement.*/, ''))).length, 4, two.out.join('\n'));
  const text = await compileRun(t, (at) => [{ fullName: 'SfTesterVerifyTest', problem: `Variable does not exist: Nope (${at}:5)` }]);
  assert.ok(text.out.some((l) => /^ERROR broken returns pong .*Variable does not exist: Nope/.test(l)), text.out.join('\n'));
  assert.ok(text.out.some((l) => /^ERROR fine returns pong .*did not compile because of check broken/.test(l)), text.out.join('\n'));
});

test('an act line range is recorded while the class is built, even when an act holds a line that looks like another act header', () => {
  const header = '    static Object act_c1(Map<String,Object> input) {';
  const { apex: src, acts } = verify.generate([apex('a', { act: `${header}\nreturn 1;` }), apex('b', { act: 'Integer x = 1;\nreturn x;' })]);
  const lines = src.split('\n');
  const real = (n) => lines.lastIndexOf(`    static Object act_c${n}(Map<String,Object> input) {`) + 1;
  assert.deepEqual(acts, [{ check: 'a', from: real(0), to: real(0) + 3 }, { check: 'b', from: real(1), to: real(1) + 3 }]);
  assert.equal(lines[acts[1].from - 1], header);
  assert.equal(lines[acts[1].to - 1], '    }', 'the range ends on the closing brace');
});

test('the generated classAccess check yields only to a user check that runs, in a run and in --plan', async (t) => {
  const p = project(t, [apex('probe-ping'), klass('mine')]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  const sf = async (a) => (a[2] === 'validate' ? OK_ENVELOPE : REPORT_OF(['c0_0', 'c0_1'], {}));
  const api = () => org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api;
  const only = await run(['verify', '--org', 'x', '--checks', p.file, '--only', 'probe-ping'], { api: api(), sf });
  assert.ok(only.out.some((l) => /^PASS probe-ping\/classAccess SfUiProbeController/.test(l)), only.out.join('\n'));
  const plan = await run(['verify', '--checks', p.file, '--plan', '--only', 'probe-ping']);
  assert.ok(plan.out.includes('would run: probe-ping, probe-ping/classAccess SfUiProbeController'), plan.out.join('\n'));
  const all = await run(['verify', '--org', 'x', '--checks', p.file], { api: api(), sf });
  assert.ok(!all.out.some((l) => /probe-ping\/classAccess/.test(l)), 'both selected: the user check stands in');
});

test('the classAccess dedupe compares class names in any case', async (t) => {
  const p = project(t, [apex('probe-ping'), klass('mine', { class: 'sfUiProbeController' })]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  const plan = await run(['verify', '--checks', p.file, '--plan']);
  assert.equal(plan.out.at(-1), 'would run: probe-ping, mine', plan.out.join('\n'));
});

test('a slash in any check id, or in a record or apex case name, is BAD_CHECK', () => {
  for (const c of [rec('a/classAccess', [F_X]), page('a/classes', [F_Y]), apex('a/classAccess'), klass('a/b')]) assert.match(verify.badChecks({ checks: [c] })[0], /: an id cannot hold a slash/, c.kind);
  const r = rec('r', [F_X]);
  r.cases[0].name = 'y/z';
  assert.match(verify.badChecks({ checks: [r] })[0], /^r: case "y\/z": a case name cannot hold a slash/);
});

test('a classes/ cover key must end in a plain API name, so no pattern text reaches a RegExp', () => {
  for (const key of ['classes/Foo(Bar', 'classes/Foo.Bar', 'classes/']) assert.match(verify.badChecks({ checks: [apex('a', { covers: [key] })] })[0], /^a: .*plain API name/, key);
  assert.match(verify.badChecks({ checks: [klass('k', { covers: ['classes/Foo*'] })] })[0], /plain API name/);
  assert.deepEqual(verify.badChecks({ checks: [apex('a', { covers: ['classes/sub/ns__Foo_1'] })] }), []);
});

test('a covered class in a subfolder still gets its generated classAccess check', async (t) => {
  const p = project(t, [apex('probe-ping')]);
  put(p, 'classes/controllers/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  const plan = await run(['verify', '--checks', p.file, '--plan']);
  assert.equal(plan.out.at(-1), 'would run: probe-ping, probe-ping/classAccess SfUiProbeController', plan.out.join('\n'));
});

test('--plan carries classes only for a runnable record or apex check, leaves out deleted ones, and lists no generated check for a check that will not run', async (t) => {
  const AURA = 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }';
  const files = [`${D}classes/SfUiProbeController.cls`, `${D}classes/Gone.cls`];
  const plan = async (checks) => { const p = project(t, checks); put(p, 'classes/SfUiProbeController.cls', AURA); return (await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf(files) })).out; };
  // Only a classAccess check: the run never calls runRecords, so nothing is carried.
  assert.ok(!(await plan([klass('k')])).some((l) => l.startsWith('would carry')));
  // An apex check carries the live class and not the deleted one.
  assert.ok((await plan([apex('probe-ping')])).includes('would carry: SfUiProbeController'));
  // An apex check that covers a deleted class FAILs as deleted: no generated check, no carry.
  const gone = await plan([apex('probe-ping', { covers: ['classes/SfUiProbeController', 'classes/Gone'] })]);
  assert.ok(gone.includes('would run: probe-ping'), gone.join('\n'));
  assert.ok(!gone.some((l) => l.startsWith('would carry')), gone.join('\n'));
});

test('a changed class no check covers and no test names is carried all the same: a covered class may call it', async (t) => {
  const p = project(t, [apex('probe-ping')]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return Helper.same(); } }');
  put(p, 'classes/Helper.cls', 'public class Helper { public static String same() { return null; } }');
  const files = [`${D}classes/SfUiProbeController.cls`, `${D}classes/Helper.cls`];
  const plan = await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf(files) });
  assert.ok(plan.out.includes('would carry: SfUiProbeController, Helper'), plan.out.join('\n'));
  assert.ok(!plan.out.some((l) => /left out of the validate/.test(l)), plan.out.join('\n'));
});

test('a deleted class pulls in no test: the run and --plan carry the same classes', async (t) => {
  const p = project(t, [apex('probe-ping')]);
  put(p, 'classes/SfUiProbeController.cls', 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }');
  put(p, 'classes/GoneTest.cls', '@IsTest private class GoneTest { @IsTest static void t() { Gone.go(); } }');
  const files = [`${D}classes/SfUiProbeController.cls`, `${D}classes/Gone.cls`];
  const plan = await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf(files) });
  assert.ok(plan.out.includes('would carry: SfUiProbeController'), plan.out.join('\n'));
  const seen = [];
  await run(['verify', '--org', 'x', '--checks', p.file, '--since', 'main'], { git: gitOf(files), api: org({ apexClass: CLS, grantedBy: ['0PSnamed'] }).api, sf: async (a) => { seen.push(a); return NOJOB(); } });
  assert.ok(seen[0].includes('--tests') && !seen[0].includes('GoneTest'), seen[0].join(' '));
  // Every changed class deleted: nothing to carry, so no line.
  const none = await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf([`${D}classes/Gone.cls`]) });
  assert.ok(!none.out.some((l) => l.startsWith('would carry')), none.out.join('\n'));
});

test('the generated classAccess check also yields to a classless user check whose bundle imports the class, and to a persona that differs only in profile case', async (t) => {
  const AURA = 'public class SfUiProbeController { @AuraEnabled public static String ping(Id i) { return null; } }';
  const plan = async (user) => {
    const p = project(t, [apex('probe-ping'), user]);
    put(p, 'classes/SfUiProbeController.cls', AURA);
    put(p, 'lwc/probe/probe.js', "import ping from '@salesforce/apex/SfUiProbeController.ping';");
    return (await run(['verify', '--checks', p.file, '--plan'])).out.at(-1);
  };
  assert.equal(await plan(klass('mine', { class: undefined, covers: ['lwc/probe'] })), 'would run: probe-ping, mine');
  // The bundle imports another class: the generated check stays.
  assert.equal(await plan(klass('mine', { class: undefined, covers: ['lwc/other'] })), 'would run: probe-ping, mine, probe-ping/classAccess SfUiProbeController');
  assert.equal(await plan(klass('mine', { persona: { profile: 'standard platform user', permissionSets: ['SfUi_Probe'] } })), 'would run: probe-ping, mine');
  assert.equal(await plan(klass('mine', { persona: { profile: 'Standard Platform User', permissionSets: [] } })), 'would run: probe-ping, mine, probe-ping/classAccess SfUiProbeController', 'a different set list is another persona');
  assert.equal(await plan(klass('mine', { persona: { profile: 'Standard Platform User', permissionSets: ['sfui_probe'] } })), 'would run: probe-ping, mine', 'set names in any case');
  assert.equal(await plan(klass('mine', { class: 'pk__SfUiProbeController' })), 'would run: probe-ping, mine', 'a namespaced class is the same class');
  const ns = project(t, [apex('probe-ping'), klass('mine', { class: undefined, covers: ['lwc/probe'] })]);
  put(ns, 'classes/SfUiProbeController.cls', AURA);
  put(ns, 'lwc/probe/probe.js', "import ping from '@salesforce/apex/pk.SfUiProbeController.ping';");
  assert.equal((await run(['verify', '--checks', ns.file, '--plan'])).out.at(-1), 'would run: probe-ping, mine', 'a namespaced bundle import');
});

test('a compile failure names the generated class by a namespaced fullName or by fileName alone', async (t) => {
  for (const named of [{ fullName: 'ns__SfTesterVerifyTest' }, { fileName: 'classes/SfTesterVerifyTest.cls', componentType: 'ApexClass' }, { fileName: 'force-app\\main\\default\\classes\\SfTesterVerifyTest.cls', componentType: 'ApexClass' }]) {
    const r = await compileRun(t, (at) => [{ ...named, lineNumber: at, problem: 'Variable does not exist: Nope' }]);
    assert.ok(r.out.some((l) => /^ERROR fine returns pong .*did not compile because of check broken/.test(l)), `${JSON.stringify(named)}\n${r.out.join('\n')}`);
  }
  const other = await compileRun(t, (at) => [{ fullName: 'OrderControllerSfTesterVerifyTest', lineNumber: at, problem: 'p' }]);
  assert.ok(!other.out.some((l) => /did not compile because of check/.test(l)), 'a class that only ends in the name is another class');
});

test('an apex case name with a slash is BAD_CHECK, so a result id cannot match a generated or deleted-item id', () => {
  const [pass, fail] = apex('a').cases;
  assert.match(verify.badChecks({ checks: [apex('a', { cases: [{ ...pass, name: 'classAccess/SfUiProbeController' }, fail] })] })[0], /^a: case "classAccess\/SfUiProbeController": a case name cannot hold a slash/);
  assert.deepEqual(verify.badChecks({ checks: [apex('a')] }), []);
});

// ---- componentVisible ----
const GATED = fs.readFileSync(path.join(__dirname, 'fixture', D, 'flexipages', 'SfUi_Dyn_Gated_Page.flexipage-meta.xml'), 'utf8');
const vis = (id, extra = {}) => ({ id, kind: 'componentVisible', requirement: `req ${id}`, covers: ['flexipages/SfUi_Dyn_Gated_Page'], persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] }, object: 'SfUiDyn__c', flexiPage: 'SfUi_Dyn_Gated_Page', component: 'c:sfUiMore', app: 'SfUi_App',
  cases: [{ name: 'shown', record: { Level__c: 'High', Note__c: 'open' }, expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low', Note__c: 'open' }, expect: { visible: false } }], ...extra });
test('a FlexiPage, a layout or a class key the check does not read covers nothing: --plan names it UNCOVERED', async (t) => {
  const fp = (n) => `flexipages/${n}`;
  const p = project(t, [vis('v', { covers: [fp('SfUi_Dyn_Gated_Page'), fp('Other_Page')] }),
    { ...page('pr', [fp('P_Page'), LAYOUT, fp('Q_Page')]), flexiPage: 'P_Page' }, page('lay', [LAYOUT, fp('R_Page')]),
    klass('k', { class: undefined, covers: ['lwc/a', 'classes/First', 'classes/Other'] })]);
  const AURA = (n) => `public class ${n} { @AuraEnabled public static void go() {} }`;
  put(p, 'lwc/a/a.js', "import x from '@salesforce/apex/First.go';");
  put(p, 'classes/First.cls', AURA('First'));
  put(p, 'classes/Other.cls', AURA('Other'));
  const pages = ['SfUi_Dyn_Gated_Page', 'Other_Page', 'P_Page', 'Q_Page', 'R_Page'].map((n) => `${D}${fp(n)}.flexipage-meta.xml`);
  touch(p.dir, [...pages, `${D}${LAYOUT}.layout-meta.xml`]);
  const r = await run(['verify', '--plan', '--checks', p.file, '--since', 'main'], { git: gitOf([...pages, `${D}${LAYOUT}.layout-meta.xml`, `${D}lwc/a/a.js`, `${D}classes/First.cls`, `${D}classes/Other.cls`]) });
  const plan = Object.fromEntries(r.out.filter((l) => /^(flexipages|layouts|classes|lwc)\//.test(l)).map((l) => [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)]));
  assert.deepEqual(plan, { [fp('SfUi_Dyn_Gated_Page')]: 'v', [fp('Other_Page')]: 'UNCOVERED', [fp('P_Page')]: 'pr', [fp('Q_Page')]: 'UNCOVERED', [fp('R_Page')]: 'UNCOVERED',
    [LAYOUT]: 'lay', 'lwc/a': 'k', 'classes/First': 'k', 'classes/Other': 'UNCOVERED' }, r.out.join('\n'));
  assert.deepEqual(r.out.filter((l) => l.startsWith('NOTE ')), ['NOTE v: covers flexipages/Other_Page, which it does not read, so it covers nothing', 'NOTE pr: covers layouts/SfUiTyped__c-SF UI Typed Layout, which it does not read, so it covers nothing',
    'NOTE pr: covers flexipages/Q_Page, which it does not read, so it covers nothing', 'NOTE lay: covers flexipages/R_Page, which it does not read, so it covers nothing', 'NOTE k: covers classes/Other, which it does not read, so it covers nothing'], 'one NOTE per dropped key, none for a key read');
  const only = await run(['verify', '--plan', '--checks', p.file, '--only', '^k$']);
  assert.deepEqual(only.out.filter((l) => l.startsWith('NOTE ')), ['NOTE k: covers classes/Other, which it does not read, so it covers nothing'], 'under --only, the selected checks only');
});

const SET_CP = (name, enabled = true) => `<PermissionSet><customPermissions><enabled>${enabled}</enabled><name>${name}</name></customPermissions></PermissionSet>`;
const gov = (p, o = org({ grantedBy: [] }), extra = [], more = {}) => {
  const call = o.api.call;
  o.api.call = async (s, q) => (/FROM CustomPermission/.test(decodeURIComponent(q)) ? (o.asked.push(decodeURIComponent(q).split('q=')[1]), { records: [{ Id: '01qCP' }] }) : /FROM PermissionSet WHERE Id IN .*Permissions\w+ = true/.test(decodeURIComponent(q)) ? { records: o.std ? [{ Id: '0PS' }] : [] } : call(s, q));
  return run(['verify', '--org', 'x', '--checks', p.file, ...extra], { api: o.api, sf: async () => assert.fail('a visibility check runs no sf'), ...more });
};

test('componentVisible: BAD_CHECK without both arms, a plain page name, a boolean expectation', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  const [shown, hidden] = vis('a').cases;
  assert.deepEqual(verify.badChecks({ checks: [vis('a')] }), []);
  assert.match(bad(vis('a', { cases: [shown] })), /^a: needs a case where it shows and a case where it does not/);
  assert.match(bad(vis('a', { cases: [hidden] })), /^a: needs a case where it shows/);
  assert.match(bad(vis('a', { flexiPage: '../x' })), /^a: flexiPage must be a plain API name/);
  assert.match(bad(vis('a', { component: '' })), /^a: no component/);
  assert.match(bad(vis('a', { cases: [shown, { name: 'h', expect: { visible: 'no' } }] })), /^a: each case needs a name and expect.visible/);
  assert.match(bad(vis('a', { cases: [shown, { ...hidden, record: [] }] })), /^a: record, user/);
  assert.match(bad(vis('a', { covers: ['classes/X'] })), /^a: a componentVisible check cannot cover classes\/X/);
});

test('componentVisible: the component and its tab rule decide, and a granted custom permission is read from the branch set', async (t) => {
  const p = project(t, [vis('v')]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  const r = await gov(p);
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS v shown', 'PASS v hidden'], r.out.join('\n'));
  assert.match(r.out[0], /branch file; c_sfUiMore: .*gatedTab: \{!Record.Note__c\} NE closed/);
  const closed = project(t, [vis('c', { cases: [{ name: 'tab hides it', record: { Level__c: 'High', Note__c: 'closed' }, expect: { visible: true } }, { name: 'open', record: { Level__c: 'Low', Note__c: 'open' }, expect: { visible: false } }] })]);
  put(closed, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(closed, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  const c = await gov(closed);
  assert.equal(c.code, 1);
  assert.match(c.out[0], /^FAIL c tab hides it .*\(requirement:/);
  assert.match(c.out[0], /c:sfUiMore is hidden, the requirement says shown/);
});

test('componentVisible: a set without the custom permission hides the component, and enabled false is no grant', async (t) => {
  for (const set of ['<PermissionSet><label>x</label></PermissionSet>', SET_CP('SfUi_See_More', false)]) {
    const p = project(t, [vis('n')]);
    put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', set);
    const r = await gov(p);
    assert.equal(r.code, 1, r.out.join('\n'));
    assert.match(r.out[0], /^FAIL n shown .*c:sfUiMore is hidden, the requirement says shown/);
  }
});

test('componentVisible: a case may grant a custom permission the persona lacks, as a what-if', async (t) => {
  const p = project(t, [vis('w', { cases: [{ name: 'granted', record: { Level__c: 'High', Note__c: 'open' }, customPermissions: { SfUi_See_More: true }, expect: { visible: true } }, { name: 'not granted', record: { Level__c: 'High', Note__c: 'open' }, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
  const r = await gov(p);
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS w granted', 'PASS w not granted'], r.out.join('\n'));
});

test('componentVisible: a null what-if is no what-if', async (t) => {
  const p = project(t, [vis('v', { cases: [{ name: 'shown', record: { Level__c: 'High', Note__c: 'open' }, customPermissions: null, standardPermissions: null, expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low', Note__c: 'open' }, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  const r = await gov(p);
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS v shown', 'PASS v hidden'], r.out.join('\n'));
});

test('componentVisible: a what-if names a permission in any case', async (t) => {
  const open = { Level__c: 'High', Note__c: 'open' };
  const p = project(t, [vis('w', { cases: [{ name: 'lower', record: open, customPermissions: { sfui_see_more: true }, expect: { visible: true } }, { name: 'none', record: open, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
  const r = await gov(p);
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS w lower', 'PASS w none'], r.out.join('\n'));
});

test('componentVisible: an input the case leaves out is a NEEDS BROWSER hand-off: exit 0, never a pass', async (t) => {
  const p = project(t, [vis('u', { cases: [{ name: 'no record', expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  const r = await gov(p);
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.match(r.out[0], /^NEEDS BROWSER u no record .*UNKNOWN/);
  assert.match(r.out.at(-1), /ran 2, passed 1, failed 0, needs browser 1$/);
  const owned = project(t, [vis('o', { handoff: 'route sfui-more-card', cases: [{ name: 'no record', expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  put(owned, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(owned, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  assert.match((await gov(owned)).out[0], /owner: route sfui-more-card/);
  const junit = path.join(p.dir, 'out.xml');
  await gov(p, undefined, ['--junit', junit]);
  assert.match(fs.readFileSync(junit, 'utf8'), /<skipped/);
  // A real failure beside a hand-off still exits 1.
  const mixed = project(t, [vis('x', { cases: [{ name: 'no record', expect: { visible: true } }, { name: 'wrong', record: { Level__c: 'Low' }, expect: { visible: true } }, { name: 'right', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  put(mixed, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(mixed, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  assert.equal((await gov(mixed)).code, 1);
  // Level Low settles the AND whatever the tab rule would read.
  assert.match(r.out[1], /^PASS u hidden/);
});

test('componentVisible: a custom permission the branch adds is read from the branch set, though the org has no row for it', async (t) => {
  const NEW = GATED.replace('SfUi_See_More', 'New_Perm');
  const mk = (set) => {
    const p = project(t, [vis('n')]);
    put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', NEW);
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', set);
    return p;
  };
  const noRow = (p) => {
    const o = org({ grantedBy: [] });
    const call = o.api.call;
    o.api.call = async (s, q) => (/FROM CustomPermission/.test(decodeURIComponent(q)) ? { records: [] } : call(s, q));
    return run(['verify', '--org', 'x', '--checks', p.file], { api: o.api, sf: async () => assert.fail('a visibility check runs no sf') });
  };
  const granted = await noRow(mk(SET_CP('New_Perm')));
  assert.deepEqual(granted.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS n shown', 'PASS n hidden'], granted.out.join('\n'));
  const bare = mk('<PermissionSet><label>x</label></PermissionSet>');
  assert.match((await noRow(bare)).out[0], /^ERROR n n no custom permission New_Perm in the org/, 'unknown to the branch and the org: a misspelling');
  put(bare, 'customPermissions/New_Perm.customPermission-meta.xml', '<CustomPermission><label>n</label></CustomPermission>');
  assert.match((await noRow(bare)).out[0], /^FAIL n shown /, 'on the branch, in no set: the org cannot grant it yet');
});

// The project's own namespace, as sfdx-project.json holds it.
const inNamespace = (p, namespace) => fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0', namespace }));

test('componentVisible: in the project\'s own namespace, a permission or app file on the branch is found without its prefix', async (t) => {
  const p = project(t, [vis('n', { app: 'ns__SfUi_App' })]);
  inNamespace(p, 'ns');
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED.replace('SfUi_See_More', 'ns__New_Perm'));
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
  put(p, 'customPermissions/New_Perm.customPermission-meta.xml', '<CustomPermission><label>n</label></CustomPermission>');
  put(p, 'applications/SfUi_App.app-meta.xml', '<CustomApplication><actionOverrides><actionName>View</actionName><content>SfUi_Dyn_Gated_Page</content><formFactor>Large</formFactor><pageOrSobjectType>SfUiDyn__c</pageOrSobjectType><type>Flexipage</type></actionOverrides></CustomApplication>');
  const o = org({ grantedBy: [], appMd: null });
  const call = o.api.call;
  o.api.call = async (s, q) => (/FROM CustomPermission/.test(decodeURIComponent(q)) ? { records: [] } : call(s, q));
  const r = await run(['verify', '--org', 'x', '--checks', p.file], { api: o.api, sf: async () => assert.fail('a visibility check runs no sf') });
  assert.match(r.out[0], /^FAIL n shown /, `on the branch, in no set: not held, not an ERROR: ${r.out.join('\n')}`);
});

test('componentVisible: in the project\'s own namespace, a branch set that grants the permission by its unprefixed name is read as a grant', async (t) => {
  const p = project(t, [vis('n')]);
  inNamespace(p, 'ns');
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED.replace('SfUi_See_More', 'ns__SfUi_See_More'));
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  const r = await gov(p);
  assert.match(r.out[0], /^PASS n shown /, r.out.join('\n'));
});

test('componentVisible: a component not placed, or placed twice, is an ERROR', async (t) => {
  const missing = project(t, [vis('m', { component: 'c:nope' })]);
  put(missing, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  assert.match((await gov(missing)).out[0], /^ERROR m m c:nope is not placed on SfUi_Dyn_Gated_Page/);
  const twice = project(t, [vis('d')]);
  put(twice, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED.replace('</FlexiPage>', '').replace(/(<flexiPageRegions>[\s\S]*?<name>gatedTabContent<\/name>[\s\S]*?<\/flexiPageRegions>)/, '$1$1') + '</FlexiPage>');
  assert.match((await gov(twice)).out[0], /^ERROR d d c:sfUiMore is placed 2 times/);
});

test('componentVisible: a standard permission is read from the set\'s column, and a name that is not one is refused', async (t) => {
  const rule = (name) => GATED.replace('{!$Permission.CustomPermission.SfUi_See_More}', `{!$Permission.StandardPermission.${name}}`);
  const cases = [{ name: 'shown', record: { Level__c: 'High', Note__c: 'open' }, expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low', Note__c: 'open' }, expect: { visible: false } }];
  const run1 = async (name, std) => {
    const p = project(t, [vis('s', { cases })]);
    put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', rule(name));
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
    const o = org({}); o.std = std;
    return gov(p, o);
  };
  assert.match((await run1('ViewSetup', true)).out[0], /^PASS s shown/);
  assert.match((await run1('ViewSetup', false)).out[0], /^FAIL s shown/);
  assert.match((await run1('View_Setup', true)).out[0], /^ERROR s s .*not a standard permission name/);
});

test('componentVisible and pageRequired: a group\'s muting set takes away a standard permission and a field read its member grants', async (t) => {
  const rule = GATED.replace('{!$Permission.CustomPermission.SfUi_See_More}', '{!$Permission.StandardPermission.ViewSetup}');
  const cases = [{ name: 'shown', record: { Level__c: 'High', Note__c: 'open' }, expect: { visible: true } }, { name: 'hidden', record: { Level__c: 'Low', Note__c: 'open' }, expect: { visible: false } }];
  const std = async (muted) => {
    const p = project(t, [vis('s', { cases, persona: { profile: 'Standard Platform User', permissionSets: ['Grp'] } })]);
    put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', rule);
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><userPermissions><enabled>true</enabled><name>ViewSetup</name></userPermissions></PermissionSet>');
    const o = org({ groupSet: true, members: [['Grp', 'SfUi_Probe'], ['Grp', null]] });
    const call = o.api.call;
    // The org's muting set holds ViewSetup when muted; its column is read from MutingPermissionSet, not PermissionSet.
    o.api.call = async (x, q) => (/FROM MutingPermissionSet WHERE Id IN \('0QMm1'\) AND PermissionsViewSetup = true/.test(decodeURIComponent(q)) ? { records: muted ? [{ Id: '0QMm1' }] : [] } : call(x, q));
    return gov(p, o);
  };
  assert.match((await std(true)).out[0], /^FAIL s shown/, 'muted');
  assert.match((await std(false)).out[0], /^PASS s shown/, 'control: not muted');
  const page = (muteXml) => {
    const p = pageProject(t, LAYOUT_XML('Required'));
    const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['Grp'] };
    fs.writeFileSync(p.file, JSON.stringify(c));
    const fls = '<fieldPermissions><editable>false</editable><field>SfUiTyped__c.Size__c</field><readable>true</readable></fieldPermissions>';
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', `<PermissionSet>${fls}</PermissionSet>`);
    put(p, 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml', muteXml(fls));
    return go(p, org({ readable: false, groupSet: true, members: [['Grp', 'SfUi_Probe'], ['Grp', null]] }));
  };
  assert.match((await page((f) => `<MutingPermissionSet>${f}</MutingPermissionSet>`)).out[0], /^FAIL size Size__c Standard Platform User \+ Grp cannot read Size__c/);
  assert.match((await page(() => '<MutingPermissionSet/>')).out[0], /^PASS size Size__c .*readable from branch permission set SfUi_Probe in group Grp\)/, 'control: nothing muted');
});

test('a muting set takes away Read only by its read flag: muted Edit, View All or Modify All leaves Read, and its row alone decides nothing', async (t) => {
  const FLS = (edit, read) => `<fieldPermissions><editable>${edit}</editable><field>SfUiTyped__c.Size__c</field><readable>${read}</readable></fieldPermissions>`;
  const field = (mute) => {
    const p = pageProject(t, LAYOUT_XML('Required'));
    const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    c.checks[0].persona = { profile: 'Standard Platform User', permissionSets: ['Grp'] };
    fs.writeFileSync(p.file, JSON.stringify(c));
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', `<PermissionSet>${FLS(true, true)}</PermissionSet>`);
    put(p, 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml', `<MutingPermissionSet>${mute}</MutingPermissionSet>`);
    return go(p, org({ readable: false, groupSet: true, members: [['Grp', 'SfUi_Probe'], ['Grp', null]] }));
  };
  assert.match((await field(FLS(true, false))).out[0], /^PASS size Size__c .*readable from branch permission set SfUi_Probe in group Grp/, 'Edit muted: Read stays');
  assert.match((await field(FLS(true, true))).out[0], /^FAIL size Size__c Standard Platform User \+ Grp cannot read Size__c/, 'control: Read muted');
  assert.match((await field('')).out[0], /^PASS size Size__c /, 'control: nothing muted');
  const OBJ = (flags) => `<objectPermissions>${flags}<object>SfUiGate__c</object></objectPermissions>`;
  const object = async (mute) => {
    const p = project(t, [gateCheck('o', { persona: { profile: 'System Administrator', permissionSets: ['Grp'] } })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
    put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', `<PermissionSet>${OBJ('<allowRead>true</allowRead><modifyAllRecords>true</modifyAllRecords><viewAllRecords>true</viewAllRecords>')}</PermissionSet>`);
    put(p, 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml', `<MutingPermissionSet>${mute}</MutingPermissionSet>`);
    return (await gov(p, org({ objectReadable: false, readable: true, describe: GATE_FIELDS, groupSet: true, members: [['Grp', 'SfUi_Probe'], ['Grp', null]] }))).out[0];
  };
  assert.match(await object(OBJ('<allowRead>false</allowRead><modifyAllRecords>true</modifyAllRecords>')), /^PASS o high/, 'Modify All muted: Read stays');
  assert.match(await object(OBJ('<allowRead>false</allowRead><viewAllRecords>true</viewAllRecords>')), /^PASS o high/, 'View All muted: Read stays');
  assert.match(await object(OBJ('<allowRead>true</allowRead>')), /^FAIL o high .*cannot read SfUiGate__c/, 'control: Read muted');
  assert.match(await object(''), /^PASS o high/, 'control: nothing muted');
  // Members org-only and granting nothing: a muting file's row for a branch object must not turn UNKNOWN into hidden.
  const unknown = async (mute) => {
    const p = project(t, [gateCheck('t', { persona: { profile: 'Standard User', permissionSets: ['Grp'] } })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
    put(p, 'objects/SfUiGate__c/SfUiGate__c.object-meta.xml', FX('objects/SfUiGate__c/SfUiGate__c.object-meta.xml'));
    put(p, 'mutingpermissionsets/Mute.mutingpermissionset-meta.xml', mute);
    return (await gov(p, org({ objectReadable: false, objectRows: false, groupSet: true, members: [['Grp', 'OrgOnly'], ['Grp', null]] }))).out[0];
  };
  assert.match(await unknown(`<MutingPermissionSet>${OBJ('<allowRead>false</allowRead><allowEdit>true</allowEdit>')}</MutingPermissionSet>`), /^NEEDS BROWSER t high UNKNOWN/, 'a muting row alone');
  assert.match(await unknown('<MutingPermissionSet/>'), /^NEEDS BROWSER t high UNKNOWN/, 'control: empty muting file');
});

test('a record type only the branch adds: a FlexiPage and a componentVisible check agree, a layout check says why it cannot', async (t) => {
  const RT = (active) => `<RecordType><active>${active}</active><label>New</label></RecordType>`;
  const vis = async (active) => {
    const p = project(t, [gateCheck('r', { recordType: 'New_RT' })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
    if (active != null) put(p, 'objects/SfUiGate__c/recordTypes/New_RT.recordType-meta.xml', RT(active));
    return (await gov(p, org({ typed: ['Beta_Type'] }))).out[0];
  };
  assert.match(await vis(true), /^PASS r high/, 'componentVisible, active branch file');
  assert.match(await vis(false), /^ERROR r r no active record type New_RT on SfUiGate__c/, 'control: inactive branch file');
  assert.match(await vis(null), /^ERROR r r no record type New_RT on SfUiGate__c/, 'control: no file, no org row');
  const p = pageProject(t, LAYOUT_XML('Required'));
  const c = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  c.checks[0].recordType = 'New_RT';
  fs.writeFileSync(p.file, JSON.stringify(c));
  put(p, 'objects/SfUiTyped__c/recordTypes/New_RT.recordType-meta.xml', RT(true));
  assert.match((await go(p, org({ typed: true }))).out[0], /^ERROR size Size__c New_RT is on the branch only; the layout assignment is read from the org's profile/);
});

test('a group with no members grants nothing and is no ERROR, from the org or from a branch group file', async (t) => {
  const empty = await goc(grpCheck(t, null), org({ apexClass: CLS, groupSet: true, members: [] }));
  assert.match(empty.out[0], /^FAIL g SfUiProbeController Standard Platform User \+ Grp cannot call/, empty.out.join('\n'));
  assert.match((await goc(grpCheck(t, null), org({ apexClass: CLS, groupSet: true, members: [], grantedBy: ['0PSnamed'] }))).out[0], /^PASS g /, 'control: its own set grants');
  assert.match((await goc(grpCheck(t, null), org({ apexClass: CLS, setFound: false, members: [] }))).out[0], /^ERROR g .*not found: Grp/, 'control: no set or group of that name');
  const filed = grpCheck(t, null);
  put(filed, 'permissionsetgroups/Grp.permissionsetgroup-meta.xml', '<PermissionSetGroup><label>G</label></PermissionSetGroup>');
  assert.match((await goc(filed, org({ apexClass: CLS, groupSet: true, members: [], grantedBy: ['0PSnamed'] }))).out[0], /^FAIL g SfUiProbeController .* cannot call/, 'the branch file decides, over the org set that would grant');
});

test('componentVisible: a permission the second placement of a field reads is fetched for it', async (t) => {
  const second = '<itemInstances>\n            <fieldInstance>\n                <fieldItem>Record.Note__c</fieldItem>\n                <identifier>RecordNoteField2</identifier>\n                <visibilityRule><criteria><leftValue>{!$Permission.StandardPermission.ViewSetup}</leftValue><operator>EQUAL</operator><rightValue>true</rightValue></criteria></visibilityRule>\n            </fieldInstance>\n        </itemInstances>\n        <name>Facet-gate-col1</name>';
  const cases = [{ name: 'low', record: { Level__c: 'Low', Note__c: 'n' }, expect: { visible: true } }, { name: 'section', record: { Level__c: 'High', Note__c: 'y' }, expect: { visible: false } }];
  const once = async (held) => {
    const p = project(t, [gateCheck('f', { component: undefined, action: undefined, field: 'Note__c', cases })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE.replace('<name>Facet-gate-col1</name>', second));
    const o = org({ readable: ['Level__c', 'Note__c'], describe: GATE_FIELDS });
    o.std = held;
    return (await gov(p, o)).out[0];
  };
  assert.match(await once(true), /^PASS f low/, 'shown by the second placement, as the persona holds ViewSetup');
  assert.match(await once(false), /^FAIL f low Note__c is hidden/, 'control: not held');
});

// ---- matrix ----
const mat = (p, o = org({ grantedBy: [] })) => {
  const call = o.api.call;
  o.api.call = async (s, q) => (/FROM CustomPermission/.test(decodeURIComponent(q)) ? { records: [{ Id: '01qCP' }] } : call(s, q));
  return run(['verify', '--org', 'x', '--checks', p.file, '--matrix'], { api: o.api, sf: async () => assert.fail('a matrix runs no sf') });
};
const matrixProject = (t, checks, bundle) => {
  const p = project(t, checks);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', SET_CP('SfUi_See_More'));
  put(p, 'permissionsets/SfUi_Probe_Read.permissionset-meta.xml', '<PermissionSet><label>x</label></PermissionSet>');
  if (bundle) { put(p, 'lwc/sfUiMore/sfUiMore.js', bundle.js); put(p, 'lwc/sfUiMore/sfUiMore.html', bundle.html); }
  return p;
};
const readPersona = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe_Read'] };

test('matrix: every persona of the checks against every state, whatever each expects', async (t) => {
  const p = matrixProject(t, [vis('a'), vis('b', { persona: readPersona })]);
  const r = await mat(p);
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.deepEqual(r.out, [
    'matrix SfUi_App SfUi_Dyn_Gated_Page c:sfUiMore: shown | hidden',
    'Standard Platform User + SfUi_Probe: shown | hidden',
    'Standard Platform User + SfUi_Probe_Read: hidden | hidden',
    'matrix 1 component(s), 4 cells, 0 UNKNOWN',
  ]);
});

test('matrix: checks that differ in app or recordType are separate groups, each resolved in its own app', async (t) => {
  const r = await matx(matrixProject(t, [vis('a', { recordType: 'Beta_Type' }), vis('b', { app: 'SfUi_B', recordType: 'Beta_Type' }), vis('c', { recordType: 'Alpha_Type' })]), [], {}, { typed: ['Beta_Type', 'Alpha_Type'] });
  assert.match(r.out.at(-1), /^matrix 3 component\(s\), 6 cells/, r.out.join('\n'));
  assert.equal(r.out.filter((l) => /^matrix SfUi/.test(l)).length, 3, r.out.join('\n'));
});

test('matrix: a state the rule cannot settle is UNKNOWN and counted, and no componentVisible check is bad usage', async (t) => {
  const p = matrixProject(t, [vis('a', { cases: [{ name: 'no record', expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  const r = await mat(p);
  assert.deepEqual(r.out.slice(1), ['Standard Platform User + SfUi_Probe: UNKNOWN | hidden', 'matrix 1 component(s), 2 cells, 1 UNKNOWN']);
  const none = await mat(project(t, [rec('r', [F_X])]));
  assert.equal(none.code, 2);
  assert.match(none.out[0], /^no componentVisible check to build a matrix from/);
});

test('matrix: a static customPermission gate in the bundle is added per persona, a mixed one is NOT_STATIC', async (t) => {
  const js = (body) => ({ js: `import has from '@salesforce/customPermission/SfUi_See_More';\nexport default class C {\n${body}\n}`, html: '<template><p lwc:if={show}></p></template>' });
  const plain = await mat(matrixProject(t, [vis('a'), vis('b', { persona: readPersona })], js('get show() { return has; }')));
  assert.equal(plain.out.at(-2), 'lwc gate SfUi_See_More: Standard Platform User + SfUi_Probe shown | Standard Platform User + SfUi_Probe_Read hidden', plain.out.join('\n'));
  const mixed = await mat(matrixProject(t, [vis('a')], js('get show() { return has && this.x; }')));
  assert.match(mixed.out.at(-2), /^NOT_STATIC lwc gate SfUi_See_More: .*mixes/, mixed.out.join('\n'));
});

test('matrix: two states with one name but different records are two columns, and a negated gate flips shown and hidden', async (t) => {
  const other = vis('b', { cases: [{ name: 'shown', record: { Level__c: 'Mid', Note__c: 'open' }, expect: { visible: false } }, { name: 'x', record: { Level__c: 'High', Note__c: 'open' }, expect: { visible: true } }] });
  const r = await mat(matrixProject(t, [vis('a'), other]));
  assert.equal(r.out[0], 'matrix SfUi_App SfUi_Dyn_Gated_Page c:sfUiMore: shown | hidden | shown (2)');
  assert.equal(r.out[1], 'Standard Platform User + SfUi_Probe: shown | hidden | hidden');
  const js = "import has from '@salesforce/customPermission/SfUi_See_More';\nexport default class C {\nget show() { return has; }\n}";
  const neg = await mat(matrixProject(t, [vis('a')], { js, html: '<template><p lwc:if={!show}></p></template>' }));
  assert.equal(neg.out.at(-2), 'lwc gate SfUi_See_More: Standard Platform User + SfUi_Probe hidden');
});

// ---- componentVisible: dynamic actions and fields ----
const GATE = fs.readFileSync(path.join(__dirname, 'fixture', D, 'flexipages', 'SfUi_Gate_Record_Page.flexipage-meta.xml'), 'utf8');
const gateCheck = (id, extra = {}) => ({ id, kind: 'componentVisible', requirement: `req ${id}`, covers: ['flexipages/SfUi_Gate_Record_Page'], persona: { profile: 'System Administrator', permissionSets: [] }, object: 'SfUiGate__c', app: 'SfUi_App', flexiPage: 'SfUi_Gate_Record_Page', component: 'force:highlightsPanel', action: 'Delete',
  cases: [{ name: 'high', record: { Level__c: 'High' }, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low' }, expect: { visible: false } }], ...extra });
const gateRun = async (t, c, page = GATE) => {
  const p = project(t, [c]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', page);
  return gov(p);
};

test('componentVisible: a dynamic action follows its own rule, an action with no rule shows, an action not in the list is an ERROR', async (t) => {
  const r = await gateRun(t, gateCheck('a'));
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS a high', 'PASS a low'], r.out.join('\n'));
  assert.match(r.out[0], /action Delete: \{!Record.Level__c\} EQUAL High/);
  const edit = await gateRun(t, gateCheck('e', { action: 'Edit', cases: [{ name: 'low', record: { Level__c: 'Low' }, expect: { visible: true } }, { name: 'never', record: {}, expect: { visible: false } }] }));
  assert.deepEqual(edit.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS e low', 'FAIL e never Edit on force:highlightsPanel is shown, the requirement says hidden'], edit.out.join('\n'));
  assert.match((await gateRun(t, gateCheck('m', { action: 'Nope' }))).out[0], /^ERROR m m Nope is not one of the dynamic actions/);
});

test('componentVisible: an action hidden from every persona is red whichever way the expectation is read', async (t) => {
  const never = GATE.replace('<rightValue>High</rightValue>', '<rightValue>Nobody</rightValue>');
  const r = await gateRun(t, gateCheck('n'), never);
  assert.equal(r.code, 1);
  assert.match(r.out[0], /^FAIL n high .*Delete on force:highlightsPanel is hidden, the requirement says shown/);
});

test('componentVisible: a field instance follows its rule and its containers\' rules; a blank right value reads as null', async (t) => {
  const f = (id, field, cases) => gateRun(t, gateCheck(id, { component: undefined, action: undefined, field, cases }));
  const note = await f('f', 'Note__c', [{ name: 'high', record: { Level__c: 'High', Note__c: null }, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low', Note__c: null }, expect: { visible: false } }, { name: 'section rule', record: { Level__c: 'High', Note__c: 'y' }, expect: { visible: false } }]);
  assert.deepEqual(note.out.slice(0, 3).map((l) => l.split(' (')[0]), ['PASS f high', 'PASS f low', 'PASS f section rule'], note.out.join('\n'));
  assert.match(note.out[2], /flexipage_fieldSection: \{!Record.Note__c\} NE y/);
  const clone = await gateRun(t, gateCheck('c', { action: 'Clone', cases: [{ name: 'empty', record: { Note__c: null }, expect: { visible: true } }, { name: 'set', record: { Note__c: 'x' }, expect: { visible: false } }] }));
  assert.deepEqual(clone.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS c empty', 'PASS c set'], clone.out.join('\n'));
});

test('componentVisible: BAD_CHECK for a field with a component or action, or a bad field name', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.deepEqual(verify.badChecks({ checks: [gateCheck('a')] }), []);
  assert.deepEqual(verify.badChecks({ checks: [gateCheck('a', { component: undefined, action: undefined, field: 'Note__c' })] }), []);
  assert.match(bad(gateCheck('a', { field: 'Note__c' })), /^a: a field check names no component or action/);
  assert.match(bad(gateCheck('a', { component: undefined, action: undefined, field: 'No te' })), /^a: field must be a plain API name/);
  assert.match(bad(gateCheck('a', { action: '' })), /^a: action must be an action name/);
});

// ---- componentVisible: object access and field-level security ----
const flsRun = async (t, c, o) => {
  const p = project(t, [c]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  return gov(p, o);
};
const HIGH_NOTE = { Level__c: 'High', Note__c: null };
// The org's describe of SfUiGate__c: both fields are permissionable.
const GATE_FIELDS = ['Level__c', 'Note__c'].map((name) => ({ name, permissionable: true }));

test('componentVisible: a persona with no read on the object sees nothing of the page, whatever the rules say', async (t) => {
  const r = await flsRun(t, gateCheck('o', { cases: [{ name: 'high', record: HIGH_NOTE, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low', Note__c: null }, expect: { visible: false } }] }), org({ objectReadable: false }));
  assert.match(r.out[0], /^FAIL o high .*Delete on force:highlightsPanel is hidden, the requirement says shown.*persona cannot read SfUiGate__c/, r.out.join('\n'));
  assert.match(r.out[1], /^PASS o low/);
});

test('componentVisible: an object no permission set holds a row for (Task, Event, User) is UNKNOWN, not hidden', async (t) => {
  const r = await flsRun(t, gateCheck('t'), org({ objectReadable: false, objectRows: false }));
  assert.match(r.out[0], /^NEEDS BROWSER t high /, r.out.join('\n'));
  assert.equal(r.code, 0);
});

test('componentVisible: a branch set row that grants no read does not decide an object the org holds no row for', async (t) => {
  const p = project(t, [gateCheck('t', { persona: { profile: 'System Administrator', permissionSets: ['SfUi_Probe'] } })]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', '<PermissionSet><objectPermissions><allowCreate>false</allowCreate><allowRead>false</allowRead><object>SfUiGate__c</object></objectPermissions></PermissionSet>');
  const r = await gov(p, org({ objectReadable: false, objectRows: false }));
  assert.match(r.out[0], /^NEEDS BROWSER t high /, r.out.join('\n'));
});

const DENY_NEW = '<PermissionSet><objectPermissions><allowCreate>false</allowCreate><allowRead>false</allowRead><object>SfUiGate__c</object></objectPermissions></PermissionSet>';
const newObject = (t, profile) => {
  const p = project(t, [gateCheck('t', { persona: { profile, permissionSets: ['SfUi_Probe'] } })]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  put(p, 'objects/SfUiGate__c/SfUiGate__c.object-meta.xml', FX('objects/SfUiGate__c/SfUiGate__c.object-meta.xml'));
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', DENY_NEW);
  return p;
};

test('componentVisible: a branch set row that denies read decides an object the branch defines, though the org holds no row for it', async (t) => {
  const r = await gov(newObject(t, 'Standard User'), org({ objectReadable: false, objectRows: false }));
  assert.match(r.out[0], /^FAIL t high .*persona cannot read SfUiGate__c/, r.out.join('\n'));
});

test('componentVisible: a profile with View All Data or Modify All Data is not hidden from a new object by a set row that denies read', async (t) => {
  for (const allData of ['view', 'modify']) {
    const r = await gov(newObject(t, 'System Administrator'), org({ objectReadable: false, objectRows: false, allData }));
    assert.match(r.out[0], /^NEEDS BROWSER t high /, `${allData}: ${r.out.join('\n')}`);
  }
});

// An own-namespace gate check: the object is named with its prefix, the app and the branch files without.
const nsGate = (t, set, o) => {
  const p = project(t, [gateCheck('t', { object: 'ns__SfUiGate__c', persona: { profile: 'System Administrator', permissionSets: ['SfUi_Probe'] } })]);
  inNamespace(p, 'ns');
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  put(p, 'permissionsets/SfUi_Probe.permissionset-meta.xml', set);
  return gov(p, o);
};
const NS_APP = { actionOverrides: [view('SfUi_Gate_Record_Page', 'ns__SfUiGate__c')], profileActionOverrides: [] };

test('componentVisible: in the project\'s own namespace, a branch set that grants read by the unprefixed object name is a grant', async (t) => {
  const grant = '<PermissionSet><objectPermissions><allowRead>true</allowRead><object>SfUiGate__c</object></objectPermissions></PermissionSet>';
  const r = await nsGate(t, grant, org({ objectReadable: false, readable: true, describe: GATE_FIELDS, objectName: 'ns__SfUiGate__c', appMd: NS_APP }));
  assert.match(r.out[0], /^PASS t high /, r.out.join('\n'));
});

test('componentVisible: in the project\'s own namespace, a branch set that grants a field by its unprefixed object name is a grant', async (t) => {
  const grant = '<PermissionSet><objectPermissions><allowRead>true</allowRead><object>SfUiGate__c</object></objectPermissions><fieldPermissions><editable>false</editable><field>SfUiGate__c.Level__c</field><readable>true</readable></fieldPermissions></PermissionSet>';
  const r = await nsGate(t, grant, org({ objectReadable: false, readable: false, describe: GATE_FIELDS, objectName: 'ns__SfUiGate__c', appMd: NS_APP }));
  assert.match(r.out[0], /^PASS t high /, r.out.join('\n'));
});

test('componentVisible: the object grant is asked of the describe\'s name, which a namespaced org prefixes', async (t) => {
  const o = org({ readable: true, describe: GATE_FIELDS, objectName: 'ns__SfUiGate__c' });
  const r = await flsRun(t, gateCheck('n'), o);
  assert.match(r.out[0], /^PASS n high/, r.out.join('\n'));
  assert.ok(o.asked.some((q) => q.includes("FROM ObjectPermissions WHERE SobjectType = 'ns__SfUiGate__c'")), o.asked.join('\n'));
});

test('componentVisible: the object is described once per verdict, not once for the page and again for access', async (t) => {
  const o = org({ readable: true, describe: GATE_FIELDS });
  const r = await flsRun(t, gateCheck('d'), o);
  assert.match(r.out[0], /^PASS d high/, r.out.join('\n'));
  assert.equal(o.asked.filter((q) => q.startsWith('/sobjects/')).length, 1, o.asked.join('\n'));
});

test('componentVisible: an administrator with no FLS on the rule\'s field loses the action', async (t) => {
  const cases = [{ name: 'high', record: HIGH_NOTE, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low', Note__c: null }, expect: { visible: false } }];
  const withFls = await flsRun(t, gateCheck('a', { cases }), org({ readable: true, describe: GATE_FIELDS }));
  assert.deepEqual(withFls.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS a high', 'PASS a low'], withFls.out.join('\n'));
  const without = await flsRun(t, gateCheck('a', { cases }), org({ readable: ['Note__c'], describe: GATE_FIELDS }));
  assert.match(without.out[0], /^FAIL a high .*Delete on force:highlightsPanel is hidden, the requirement says shown.*persona cannot read level__c/i, without.out.join('\n'));
  assert.equal(without.code, 1);
});

test('componentVisible: a field with no FLS for the persona is hidden, and a path across objects is UNKNOWN', async (t) => {
  const f = (readable, cases) => flsRun(t, gateCheck('f', { component: undefined, action: undefined, field: 'Note__c', cases }), org({ readable, describe: GATE_FIELDS }));
  const cases = [{ name: 'high', record: HIGH_NOTE, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low', Note__c: null }, expect: { visible: false } }];
  assert.match((await f(['Level__c'], cases)).out[0], /^FAIL f high Note__c is hidden, the requirement says shown/);
  assert.match((await f(['Level__c', 'Note__c'], cases)).out[0], /^PASS f high/);
  const cross = GATE.replace('{!Record.Level__c}</leftValue>\n                            <operator>NE</operator>', '{!Record.Owner.Name}</leftValue>\n                            <operator>NE</operator>');
  const p = project(t, [gateCheck('x', { component: undefined, action: undefined, field: 'Note__c', cases: [{ name: 'a', record: { ...HIGH_NOTE, Owner: { Name: 'x' } }, expect: { visible: true } }, { name: 'b', record: { ...HIGH_NOTE, Owner: { Name: 'x' } }, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', cross);
  assert.match((await gov(p)).out[0], /^NEEDS BROWSER x a /);
});

test('componentVisible: a field placed twice shows where either placement shows, and a component placed twice stays an ERROR', async (t) => {
  // The second Note__c placement shows on Note__c = z, where the first (Level__c NE Low) hides it.
  const second = '<itemInstances>\n            <fieldInstance>\n                <fieldItem>Record.Note__c</fieldItem>\n                <identifier>RecordNoteField2</identifier>\n                <visibilityRule><criteria><leftValue>{!Record.Note__c}</leftValue><operator>EQUAL</operator><rightValue>z</rightValue></criteria></visibilityRule>\n            </fieldInstance>\n        </itemInstances>\n        <name>Facet-gate-col1</name>';
  const twice = GATE.replace('<name>Facet-gate-col1</name>', second);
  assert.notEqual(twice, GATE);
  const cases = [{ name: 'second', record: { Level__c: 'Low', Note__c: 'z' }, expect: { visible: true } }, { name: 'neither', record: { Level__c: 'Low', Note__c: 'n' }, expect: { visible: false } }];
  const p = project(t, [gateCheck('f', { component: undefined, action: undefined, field: 'Note__c', cases })]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', twice);
  const r = await gov(p, org({ readable: ['Level__c', 'Note__c'], describe: GATE_FIELDS }));
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS f second', 'PASS f neither'], r.out.join('\n'));
  assert.match(r.out[0], /placed 2 times, shown where any placement is: RecordNoteField: \{!Record\.Level__c\} NE Low \| RecordNoteField2: \{!Record\.Note__c\} EQUAL z; /, r.out.join('\n'));
  // A second placement with no rule of its own in the same section: said so, and the section's rule once.
  const bare = GATE.replace('<name>Facet-gate-col1</name>', second.replace(/<visibilityRule>.*<\/visibilityRule>\n\s*/, ''));
  assert.ok(!bare.includes('RecordNoteField2</identifier>\n                <visibilityRule>'));
  const pb = project(t, [gateCheck('f', { component: undefined, action: undefined, field: 'Note__c', cases })]);
  put(pb, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', bare);
  const line = (await gov(pb, org({ readable: ['Level__c', 'Note__c'], describe: GATE_FIELDS }))).out[0];
  assert.match(line, /placed 2 times, shown where any placement is: RecordNoteField: \{!Record\.Level__c\} NE Low \| no rule of its own; on every placement: flexipage_fieldSection: \{!Record\.Note__c\} NE y\)/, line);
  assert.equal(line.split('flexipage_fieldSection').length, 2, `the section rule once: ${line}`);
  const comp = project(t, [gateCheck('c', { action: undefined, component: 'force:highlightsPanel' })]);
  put(comp, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE.replace(/(<itemInstances>\s*<componentInstance>[\s\S]*?force:highlightsPanel[\s\S]*?<\/itemInstances>)/, '$1$1'));
  assert.match((await gov(comp)).out[0], /^ERROR c c force:highlightsPanel is placed 2 times .*name its identifier/);
});

test('componentVisible: a field the org lacks and no set grants is UNKNOWN, never read as hidden', async (t) => {
  const r = await flsRun(t, gateCheck('n'), org({ readable: false }));
  assert.match(r.out[0], /^NEEDS BROWSER n high /, r.out.join('\n'));
  assert.equal(r.code, 0);
});

// ---- componentVisible: the page the persona resolves to ----
const FX = (rel) => fs.readFileSync(path.join(__dirname, 'fixture', D, rel), 'utf8');
const withApp = (t, c, { app = FX('applications/SfUi_App.app-meta.xml'), object = 'SfUiGate__c' } = {}) => {
  const p = project(t, [c]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  if (app) put(p, 'applications/SfUi_App.app-meta.xml', app);
  put(p, `objects/${object}/${object}.object-meta.xml`, FX(`objects/${object}/${object}.object-meta.xml`));
  return p;
};
const landing = (extra) => gateCheck('p', { app: 'SfUi_App', persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Gate_Access'] }, ...extra });

test('componentVisible: with an app named, the persona\'s resolved page is the one the check reads', async (t) => {
  const r = await gov(withApp(t, landing()), org({ readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from org; branch file;/, r.out.join('\n'));
  const other = await gov(withApp(t, landing({ flexiPage: 'SfUi_Dyn_Gated_Page' })));
  assert.match(other.out[0], /^ERROR p p .*gets SfUi_Gate_Record_Page \(org\) for SfUiGate__c in SfUi_App, not SfUi_Dyn_Gated_Page/, other.out.join('\n'));
  assert.equal(other.code, 1);
});

test('componentVisible: in the project\'s own namespace, the object file is found for an object the check names with its prefix', async (t) => {
  const p = withApp(t, landing({ object: 'ns__SfUiGate__c' }));
  inNamespace(p, 'ns');
  const r = await gov(p, org({ readable: true, describe: GATE_FIELDS, objectName: 'ns__SfUiGate__c' }));
  assert.match(r.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from org; branch file;/, r.out.join('\n'));
});

test('componentVisible: the resolved page matches the check\'s page in another case or with the own namespace prefix', async (t) => {
  for (const content of ['ns__SfUi_Gate_Record_Page', 'sfui_gate_record_page']) {
    const p = project(t, [gateCheck('p')]);
    inNamespace(p, 'ns');
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
    const appMd = { actionOverrides: [view(content, 'SfUiGate__c')], profileActionOverrides: [] };
    const r = await gov(p, org({ appMd, readable: true, describe: GATE_FIELDS }));
    assert.match(r.out[0], /^PASS p high /, `${content}: ${r.out.join('\n')}`);
  }
});

test('componentVisible: a check that names its page with the own namespace prefix loads the unprefixed branch file, or asks the org for the bare name', async (t) => {
  const check = () => gateCheck('p', { flexiPage: 'ns__SfUi_Gate_Record_Page' });
  const appMd = { actionOverrides: [view('SfUi_Gate_Record_Page', 'SfUiGate__c')], profileActionOverrides: [] };
  const onBranch = project(t, [check()]);
  inNamespace(onBranch, 'ns');
  put(onBranch, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  assert.match((await gov(onBranch, org({ appMd, readable: true, describe: GATE_FIELDS }))).out[0], /^PASS p high /, 'the branch file');
  const inOrg = project(t, [check()]);
  inNamespace(inOrg, 'ns');
  const o = org({ appMd, readable: true, describe: GATE_FIELDS, flexi: { flexiPageRegions: [] } });
  const r = await gov(inOrg, o);
  assert.match(r.out[0], /is not placed on ns__SfUi_Gate_Record_Page/, r.out.join('\n'));
  assert.ok(o.asked.some((q) => q.includes("FROM FlexiPage WHERE DeveloperName = 'SfUi_Gate_Record_Page' AND NamespacePrefix = 'ns'")), o.asked.join('\n'));
});

test('componentVisible: in the project\'s own namespace, a profile row for a prefixed record type decides for the check\'s bare name', async (t) => {
  const p = project(t, [gateCheck('p', { object: 'ns__SfUiGate__c', recordType: 'Beta_Type' })]);
  inNamespace(p, 'ns');
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
  const appMd = { actionOverrides: [], profileActionOverrides: [{ ...view('SfUi_Gate_Record_Page', 'ns__SfUiGate__c'), profile: 'StandardAul', recordType: 'ns__SfUiGate__c.ns__Beta_Type' }] };
  const r = await gov(p, org({ appMd, typed: true, readable: true, describe: GATE_FIELDS, objectName: 'ns__SfUiGate__c' }));
  assert.match(r.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from appProfile;/, r.out.join('\n'));
});

test('componentVisible: the persona\'s Profile comes from the org, so a standard profile picks its own row', async (t) => {
  const typed = (profileFullName) => gov(withApp(t, landing({ object: 'SfUiTyped__c', recordType: 'Beta_Type', flexiPage: 'SfUi_Typed_App_Page' }), { object: 'SfUiTyped__c' }), org({ profileFullName, typed: true }));
  const r = await typed('StandardAul');
  assert.match(r.out[0], /^ERROR p p .*\(profile StandardAul\) gets SfUi_Typed_AppRtProfile_Page \(appProfile\) for SfUiTyped__c Beta_Type in SfUi_App, not SfUi_Typed_App_Page/, r.out.join('\n'));
  assert.match((await typed(null)).out[0], /^ERROR p p no profile Standard Platform User in the org/);
});

test('componentVisible: the app\'s assignments come from the org when the branch has no app file, as Tooling JSON', async (t) => {
  const appMd = { actionOverrides: [{ actionName: 'View', type: 'Flexipage', content: 'SfUi_Dyn_Gated_Page', formFactor: 'Large', pageOrSobjectType: 'SfUiGate__c' }], profileActionOverrides: [] };
  const r = await gov(withApp(t, landing(), { app: null }), org({ appMd, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^ERROR p p .*gets SfUi_Dyn_Gated_Page \(app\) for SfUiGate__c in SfUi_App, not SfUi_Gate_Record_Page/, r.out.join('\n'));
  assert.match((await gov(withApp(t, landing(), { app: null }), org({ appMd: null }))).out[0], /^ERROR p p no app SfUi_App on the branch or in the org/);
});

test('componentVisible: a standard object needs no object file when the app decides the page; it does when the app does not', async (t) => {
  const appXml = (rows) => `<CustomApplication>${rows}</CustomApplication>`;
  const row = '<actionOverrides><actionName>View</actionName><content>SfUi_Gate_Record_Page</content><formFactor>Large</formFactor><pageOrSobjectType>Account</pageOrSobjectType><type>Flexipage</type></actionOverrides>';
  const account = (app) => {
    const p = project(t, [landing({ object: 'Account' })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', GATE);
    put(p, 'applications/SfUi_App.app-meta.xml', appXml(app));
    return p;
  };
  const o = () => org({ readable: true, describe: GATE_FIELDS });
  assert.match((await gov(account(row), o())).out[0], /^PASS p high \(page SfUi_Gate_Record_Page from app;/, 'the app row decides, with no Account object file');
  assert.match((await gov(account(''), o())).out[0], /^ERROR p p the page assignment of Account is not readable/, 'no app row and no object file');
});

test('componentVisible: an app row spelled with the namespace, or in another case, still matches the check\'s object and profile', async (t) => {
  const row = { actionName: 'View', type: 'Flexipage', content: 'SfUi_Gate_Record_Page', formFactor: 'Large', pageOrSobjectType: 'ns__SfUiGate__c' };
  const appMd = { actionOverrides: [row], profileActionOverrides: [] };
  const r = await gov(withApp(t, landing(), { app: null }), org({ appMd, objectName: 'ns__SfUiGate__c', readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from app;/, r.out.join('\n'));
  const lower = await gov(withApp(t, landing(), { app: null }), org({ appMd: { ...appMd, actionOverrides: [{ ...row, pageOrSobjectType: 'sfuigate__c' }] }, readable: true, describe: GATE_FIELDS }));
  assert.match(lower.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from app;/, lower.out.join('\n'));
});

test('componentVisible: the org lookups of an app and a FlexiPage take the unprefixed row first', async (t) => {
  const p = project(t, [landing()]);
  inNamespace(p, 'ns');
  const appMd = { actionOverrides: [view('SfUi_Gate_Record_Page', 'SfUiGate__c')], profileActionOverrides: [] };
  const o = org({ appMd, flexi: { flexiPageRegions: [] }, readable: true, describe: GATE_FIELDS });
  await gov(p, o);
  const has = (re) => o.asked.some((q) => re.test(q));
  assert.ok(has(/FROM CustomApplication WHERE DeveloperName = 'SfUi_App' AND \(NamespacePrefix = null OR NamespacePrefix = 'ns'\) ORDER BY NamespacePrefix NULLS FIRST LIMIT 1$/), o.asked.join('\n'));
  assert.ok(has(/FROM FlexiPage WHERE DeveloperName = 'SfUi_Gate_Record_Page' AND \(NamespacePrefix = null OR NamespacePrefix = 'ns'\) ORDER BY NamespacePrefix NULLS FIRST LIMIT 1$/), o.asked.join('\n'));
});

test('componentVisible: the org lookup of an object\'s page assignment takes the unprefixed row first', async (t) => {
  const p = project(t, [vis('d')]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  const o = org({ grantedBy: [], appMd: { actionOverrides: [], profileActionOverrides: [] } });
  await gov(p, o);
  assert.ok(o.asked.some((q) => /SELECT Metadata FROM CustomObject WHERE DeveloperName = 'SfUiDyn' AND NamespacePrefix = null ORDER BY NamespacePrefix NULLS FIRST LIMIT 1$/.test(q)), o.asked.join('\n'));
});

test('componentVisible: the org lookup of a custom permission takes the unprefixed row first', async (t) => {
  const p = project(t, [vis('d')]);
  put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED);
  const o = org({ grantedBy: [] });
  await gov(p, o);
  assert.ok(o.asked.some((q) => /FROM CustomPermission WHERE DeveloperName = 'SfUi_See_More' AND NamespacePrefix = null ORDER BY NamespacePrefix NULLS FIRST LIMIT 1$/.test(q)), o.asked.join('\n'));
});

test('componentVisible: an object with record types needs a recordType, as a layout check does', async (t) => {
  const r = await gov(withApp(t, landing()), org({ typed: true }));
  assert.match(r.out[0], /^ERROR p p name a recordType: SfUiGate__c has record types/, r.out.join('\n'));
  assert.match((await gov(withApp(t, landing({ recordType: 'Beta_Type' })), org({ typed: true, readable: true, describe: GATE_FIELDS }))).out[0], /^PASS p high/, 'a named recordType passes the guard');
  assert.match((await gov(withApp(t, landing()), org({ readable: true, describe: GATE_FIELDS }))).out[0], /^PASS p high/, 'an object without record types needs none');
});

test('componentVisible: a recordType the object does not have is an ERROR, not a fall-through to the app default', async (t) => {
  const r = await gov(withApp(t, landing({ recordType: 'Beta_Typo' })), org({ typed: true, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^ERROR p p no record type Beta_Typo on SfUiGate__c/, r.out.join('\n'));
  assert.equal(r.code, 1);
});

test('componentVisible: a recordType that exists but is inactive is an ERROR', async (t) => {
  const r = await gov(withApp(t, landing({ recordType: 'Beta_Type' })), org({ typed: true, typeActive: false, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^ERROR p p no active record type Beta_Type on SfUiGate__c/, r.out.join('\n'));
});

test('componentVisible: Master is a valid recordType although it has no RecordType row', async (t) => {
  const r = await gov(withApp(t, landing({ recordType: 'Master' })), org({ typed: true, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^PASS p high /, r.out.join('\n'));
});

test('componentVisible: Master finds the profile row that has no record type, on an object that has one', async (t) => {
  const appMd = { actionOverrides: [], profileActionOverrides: [{ ...view('SfUi_Gate_Record_Page', 'SfUiTyped__c'), profile: 'StandardAul' }] };
  const p = withApp(t, landing({ object: 'SfUiTyped__c', recordType: 'Master', app: 'SfUi_App' }), { app: null, object: 'SfUiTyped__c' });
  const r = await gov(p, org({ appMd, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^PASS p high \(page SfUi_Gate_Record_Page from appProfile;/, r.out.join('\n'));
});

test('componentVisible: both record type guards share one query per object across the verdicts of a run', async (t) => {
  const p = withApp(t, landing({ recordType: 'Beta_Type' }));
  const file = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  file.checks.push({ ...file.checks[0], id: 'q' });
  fs.writeFileSync(p.file, JSON.stringify(file));
  const o = org({ typed: true, readable: true, describe: GATE_FIELDS });
  const r = await gov(p, o);
  assert.match(r.out[0], /^PASS p high /, r.out.join('\n'));
  assert.equal(o.asked.filter((q) => /FROM RecordType/.test(q)).length, 1, o.asked.join('\n'));
});

test('componentVisible: a failed record type query is not kept, so the next check asks again', async (t) => {
  const p = withApp(t, landing({ recordType: 'Beta_Type' }));
  const file = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  file.checks.push({ ...file.checks[0], id: 'q' });
  fs.writeFileSync(p.file, JSON.stringify(file));
  const o = org({ typed: true, readable: true, describe: GATE_FIELDS });
  const call = o.api.call;
  let failed = false;
  o.api.call = async (s, q) => { if (/FROM RecordType/.test(decodeURIComponent(q)) && !failed) { failed = true; throw new Error('boom'); } return call(s, q); };
  const r = await gov(p, o);
  assert.match(r.out[0], /^ERROR p p boom/, r.out.join('\n'));
  assert.match(r.out[1], /^PASS q high /, r.out.join('\n'));
});

test('componentVisible: an object whose record types are all inactive needs no recordType named', async (t) => {
  const r = await gov(withApp(t, landing()), org({ typed: true, typeActive: false, readable: true, describe: GATE_FIELDS }));
  assert.match(r.out[0], /^PASS p high/, r.out.join('\n'));
});

test('componentVisible: app and recordType must be plain API names', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.deepEqual(verify.badChecks({ checks: [landing({ recordType: 'Beta_Type' })] }), []);
  assert.match(bad(landing({ app: '../x' })), /^p: app must be a plain API name/);
  assert.match(bad(landing({ app: undefined })), /^p: app must be a plain API name/, 'the app is required');
  assert.match(bad(landing({ recordType: "A' OR" })), /^p: recordType must be a plain API name/);
});

test('componentVisible: handoff is text on a component check, a field check and a single case', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  const field = (extra) => gateCheck('h', { component: undefined, action: undefined, field: 'Note__c', ...extra });
  assert.deepEqual(verify.badChecks({ checks: [field({ handoff: 'route note-card' })] }), []);
  assert.match(bad(field({ handoff: {} })), /^h: handoff must be text/);
  assert.match(bad(gateCheck('h', { handoff: 42 })), /^h: handoff must be text/);
  assert.match(bad(field({ cases: [{ name: 'a', handoff: 42, expect: { visible: true } }, { name: 'b', expect: { visible: false } }] })), /^h: a case handoff must be text/);
  assert.deepEqual(verify.badChecks({ checks: [field({ cases: [{ name: 'a', handoff: 'jest', expect: { visible: true } }, { name: 'b', expect: { visible: false } }] })] }), []);
});

// ---- matrix: usage, API gate, junit, stop, gates ----
const matx = (p, extra = [], more = {}, orgOpts = {}) => {
  const o = org({ grantedBy: [], ...orgOpts });
  const call = o.api.call;
  o.api.call = async (s, q) => (/FROM CustomPermission/.test(decodeURIComponent(q)) ? { records: [{ Id: '01qCP' }] } : call(s, q));
  return run(['verify', '--org', 'x', '--checks', p.file, '--matrix', ...extra], { api: o.api, sf: async () => assert.fail('a matrix runs no sf'), ...more });
};

test('matrix: --plan with --matrix is bad usage, and an apex check below API 67.0 leaves the matrix alone with a note', async (t) => {
  const p = matrixProject(t, [vis('a'), apex('x')]);
  const both = await matx(p, ['--plan']);
  assert.equal(both.code, 2);
  assert.match(both.out[0], /^--plan and --matrix are mutually exclusive/);
  const low = await matx(p, [], { connect: async () => ({ production: false, orgApiVersion: '66.0' }) });
  assert.equal(low.code, 0, low.out.join('\n'));
  assert.match(low.out[0], /^note: apex checks are left out of a matrix \(they need API 67.0, x reports 66.0\)/);
  assert.equal(low.out.at(-1), 'matrix 1 component(s), 2 cells, 0 UNKNOWN');
  const plain = await run(['verify', '--org', 'x', '--checks', p.file], { connect: async () => ({ production: false, orgApiVersion: '66.0' }) });
  assert.equal(plain.code, 2, 'the same file without --matrix is still refused below 67.0');
});

test('matrix: two states with one name get two cell ids, so a report keeps both verdicts', async (t) => {
  const other = vis('b', { cases: [{ name: 'shown', record: { Level__c: 'Mid', Note__c: 'open' }, expect: { visible: false } }, { name: 'other', record: { Level__c: 'Mid', Note__c: 'x' }, expect: { visible: true } }] });
  const p = matrixProject(t, [vis('a'), other]);
  const out = path.join(p.dir, 'm.xml');
  await matx(p, ['--junit', out]);
  const names = [...fs.readFileSync(out, 'utf8').matchAll(/<testcase [^>]*name="([^"]+)"/g)].map((m) => m[1].split('/').at(-1));
  assert.deepEqual(names, ['shown', 'hidden', 'shown (2)', 'other']);
  assert.equal(new Set(names).size, names.length);
});

test('matrix: a numbered state name never repeats a name an author typed or an earlier state took', async (t) => {
  const state = (name, Level__c, Note__c, visible) => ({ name, record: { Level__c, Note__c }, expect: { visible } });
  const b = vis('b', { cases: [state('shown', 'Mid', 'open', false), state('b on', 'Mid', 'x', true)] });
  const c = vis('c', { cases: [state('shown (2)', 'Mid', 'y', true), state('c off', 'Low', 'y', false)] });
  const p = matrixProject(t, [vis('a'), b, c]);
  const out = path.join(p.dir, 'm.xml');
  const r = await matx(p, ['--junit', out]);
  assert.ok(fs.existsSync(out), r.out.join('\n'));
  const names = [...fs.readFileSync(out, 'utf8').matchAll(/<testcase [^>]*name="([^"]+)"/g)].map((m) => m[1].split('/').at(-1));
  assert.equal(names.length, 6, names.join(' | '));
  assert.equal(new Set(names).size, names.length, names.join(' | '));
});

test('matrix: --junit writes a case per cell, UNKNOWN skipped, and a stop signal ends the matrix red', async (t) => {
  const p = matrixProject(t, [vis('a', { cases: [{ name: 'no record', expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  const out = path.join(p.dir, 'm.xml');
  const r = await matx(p, ['--junit', out]);
  assert.equal(r.code, 0, r.out.join('\n'));
  const xml = fs.readFileSync(out, 'utf8');
  assert.match(xml, /tests="2" failures="0" errors="0" skipped="1"/);
  assert.match(xml, /name="matrix\/SfUi_App SfUi_Dyn_Gated_Page c:sfUiMore\/Standard Platform User \+ SfUi_Probe\/no record"/);
  const ac = new AbortController();
  ac.abort();
  const stopped = await matx(p, [], { signal: ac.signal });
  assert.equal(stopped.code, 1);
  assert.match(stopped.out.at(-1), /, stopped by a signal$/);
  assert.ok(!stopped.out.some((l) => /^Standard Platform User/.test(l)), 'no persona was read after the stop');
});

test('matrix: a persona the org cannot read is an ERROR line and the matrix goes on, red', async (t) => {
  const p = matrixProject(t, [vis('a'), vis('b', { persona: { profile: 'No Such Profile', permissionSets: [] } })]);
  const o = org({ grantedBy: [] });
  const call = o.api.call;
  o.api.call = async (s, q) => { const d = decodeURIComponent(q); return /FROM CustomPermission/.test(d) ? { records: [{ Id: '01qCP' }] } : /Profile\.Name = 'No Such Profile'/.test(d) ? { records: [] } : call(s, q); };
  const r = await run(['verify', '--org', 'x', '--checks', p.file, '--matrix'], { api: o.api, sf: async () => assert.fail('no sf') });
  assert.ok(r.out.includes('Standard Platform User + SfUi_Probe: shown | hidden'), r.out.join('\n'));
  assert.ok(r.out.includes('No Such Profile: ERROR no profile No Such Profile in the org'), r.out.join('\n'));
  assert.match(r.out.at(-1), /2 cells, 0 UNKNOWN, 1 ERROR$/);
  assert.equal(r.code, 1);
});

test('matrix: blocks that read a permission both ways get one line each, and a component named by identifier says the scan was skipped', async (t) => {
  const both = { js: "import has from '@salesforce/customPermission/SfUi_See_More';\nexport default class C {\nget show() { return has; }\nget hide() { return !has; }\n}", html: '<template><p lwc:if={show}></p><p lwc:if={hide}></p></template>' };
  const r = await matx(matrixProject(t, [vis('a')], both));
  assert.deepEqual(r.out.slice(-3), ['lwc gate SfUi_See_More (blocks shown when held): Standard Platform User + SfUi_Probe shown', 'lwc gate SfUi_See_More (blocks shown when not held): Standard Platform User + SfUi_Probe hidden', 'matrix 1 component(s), 2 cells, 0 UNKNOWN'], r.out.join('\n'));
  const byId = await matx(matrixProject(t, [vis('a', { component: 'c_sfUiMore' })], both));
  assert.ok(byId.out.some((l) => /^lwc gate scan skipped: c_sfUiMore is named by identifier/.test(l)), byId.out.join('\n'));
  assert.ok(!byId.out.some((l) => /^lwc gate SfUi_See_More/.test(l)));
});

test('componentVisible: a field the describe leaves out but Tooling lists is one the persona cannot read, not one the org lacks', async (t) => {
  const r = await flsRun(t, gateCheck('d'), org({ readable: ['Note__c'], describe: [{ name: 'Note__c', permissionable: true }], fieldDefs: ['level__C', 'Note__c'] }));
  assert.match(r.out[0], /^FAIL d high .*Delete on force:highlightsPanel is hidden.*persona cannot read Level__c/i, r.out.join('\n'));
});

test('componentVisible: the field definitions are asked of the describe\'s object name, which a namespaced org prefixes', async (t) => {
  const o = org({ readable: ['Note__c'], describe: [{ name: 'Note__c', permissionable: true }], fieldDefs: ['level__C', 'Note__c'], objectName: 'ns__SfUiGate__c' });
  const r = await flsRun(t, gateCheck('d'), o);
  assert.match(r.out[0], /^FAIL d high .*persona cannot read Level__c/i, r.out.join('\n'));
  assert.ok(o.asked.some((q) => q.includes("FROM CustomField WHERE EntityDefinition.QualifiedApiName = 'ns__SfUiGate__c'")), o.asked.join('\n'));
});

// ---- --since reaches the bundle a componentVisible check names and the custom permissions it imports ----
const GATE_JS = "import has from '@salesforce/customPermission/SfUi_See_More';\nexport default class C {\nget show() { return has; }\n}";
const sinceProject = (t, extra = {}) => {
  const p = matrixProject(t, [vis('a', extra)], { js: GATE_JS, html: '<template><p lwc:if={show}></p></template>' });
  put(p, 'customPermissions/SfUi_See_More.customPermission-meta.xml', '<CustomPermission><label>x</label></CustomPermission>');
  return p;
};

test('a standard or foreign component is not scanned as the local bundle that shares its bare name', async (t) => {
  const gates = (component, namespace) => {
    const p = matrixProject(t, [vis('a', { component })], { js: GATE_JS, html: '<template><p lwc:if={show}></p></template>' });
    put(p, 'flexipages/SfUi_Dyn_Gated_Page.flexipage-meta.xml', GATED.replace('c:sfUiMore', component));
    if (namespace) inNamespace(p, namespace);
    return gov(p);
  };
  assert.match((await gates('c:sfUiMore')).out[0], /lwc gates: SfUi_See_More static/, 'c: is the local bundle');
  assert.match((await gates('ns:sfUiMore', 'ns')).out[0], /lwc gates: SfUi_See_More static/, 'so is the project\'s own namespace');
  assert.doesNotMatch((await gates('force:sfUiMore')).out[0], /lwc gates/, 'a standard component');
  assert.doesNotMatch((await gates('other:sfUiMore', 'ns')).out[0], /lwc gates/, 'another package\'s');
});

test('--since: a change to the bundle of a componentVisible check, or to a permission the bundle imports, selects that check', async (t) => {
  const p = sinceProject(t);
  touch(p.dir, [`${D}lwc/other/other.js`]);
  const since = (...changed) => gov(p, undefined, ['--since', 'main'], { git: gitOf(changed.map((f) => `${D}${f}`)) });
  for (const f of ['lwc/sfUiMore/sfUiMore.html', 'customPermissions/SfUi_See_More.customPermission-meta.xml']) {
    const r = await since(f);
    assert.match(r.out.join('\n'), /^PASS a shown .*lwc gates: SfUi_See_More static/m, `${f}: ${r.out.join('\n')}`);
    assert.ok(!r.out.some((l) => /UNCOVERED|not checkable/.test(l)), r.out.join('\n'));
    assert.match(r.out.at(-1), /^changed 1, covered 1, uncovered 0, ran 2/);
  }
  const unrelated = await since('lwc/other/other.js', 'customPermissions/Other.customPermission-meta.xml');
  assert.deepEqual(unrelated.out, ['since main, 2 files changed', 'not checkable yet: lwc/other, customPermissions/Other', 'no checkable change since main']);
});

test('--since: deleting the custom permission a covered bundle imports fails the check that selects it', async (t) => {
  const p = sinceProject(t);
  const gone = 'customPermissions/SfUi_See_More.customPermission-meta.xml';
  fs.rmSync(path.join(p.dir, D, gone));
  const r = await gov(p, undefined, ['--since', 'main'], { git: gitOf([`${D}${gone}`]) });
  assert.ok(r.out.some((l) => l.startsWith('FAIL a customPermissions/SfUi_See_More deleted on the branch')), r.out.join('\n'));
  assert.equal(r.code, 1);
});

test('--since: the Apex imports of a bundle are read once per run, however many checks ask', async (t) => {
  const p = matrixProject(t, ['a', 'b', 'c'].map((id) => vis(id)), { js: GATE_JS, html: '<template><p lwc:if={show}></p></template>' });
  put(p, 'customPermissions/SfUi_See_More.customPermission-meta.xml', '<CustomPermission><label>x</label></CustomPermission>');
  // Only the Apex scan reads every .js file of a bundle, so a helper file counts its scans.
  const helper = path.join(p.dir, D, 'lwc/sfUiMore/helper.js');
  fs.writeFileSync(helper, 'export const x = 1;');
  let scans = 0;
  const real = fs.readFileSync;
  const spy = t.mock.method(fs, 'readFileSync', (f, ...rest) => { if (path.resolve(String(f)) === helper) scans++; return real(f, ...rest); });
  const r = await gov(p, undefined, ['--since', 'main'], { git: gitOf([`${D}lwc/sfUiMore/sfUiMore.html`]) });
  spy.mock.restore();
  assert.match(r.out.at(-1), /^changed 1, covered 1, uncovered 0, ran 6/, r.out.join('\n'));
  assert.equal(scans, 1);
});

test('--since: an own-namespace permission the bundle imports with its prefix is selected by its unprefixed file', async (t) => {
  const p = matrixProject(t, [vis('a')], { js: GATE_JS.replace('customPermission/SfUi_See_More', 'customPermission/ns__SfUi_See_More'), html: '<template><p lwc:if={show}></p></template>' });
  inNamespace(p, 'ns');
  put(p, 'customPermissions/SfUi_See_More.customPermission-meta.xml', '<CustomPermission><label>x</label></CustomPermission>');
  const r = await gov(p, undefined, ['--since', 'main'], { git: gitOf([`${D}customPermissions/SfUi_See_More.customPermission-meta.xml`]) });
  assert.ok(!r.out.some((l) => /not checkable/.test(l)), r.out.join('\n'));
  assert.match(r.out.at(-1), /^changed 1, covered 1, uncovered 0, ran 2/, r.out.join('\n'));
});

test('--since: a componentVisible check selects a bundle that imports Apex, but does not cover its class-access gap', async (t) => {
  const js = `import go from '@salesforce/apex/SfUiProbeController.ping';\n${GATE_JS}`;
  const p = matrixProject(t, [vis('a')], { js, html: '<template><p lwc:if={show}></p></template>' });
  put(p, 'customPermissions/SfUi_See_More.customPermission-meta.xml', '<CustomPermission><label>x</label></CustomPermission>');
  const r = await gov(p, undefined, ['--since', 'main'], { git: gitOf([`${D}lwc/sfUiMore/sfUiMore.js`]) });
  assert.match(r.out.join('\n'), /^PASS a shown /m, 'the check still runs');
  assert.ok(r.out.includes('UNCOVERED lwc/sfUiMore'), r.out.join('\n'));
  assert.equal(r.code, 1);
  assert.match(r.out.at(-1), /^changed 1, covered 0, uncovered 1, ran 2/);
  // Under --only that check does not keep the bundle in the cascade map either: selecting is not covering.
  const only = await gov(p, undefined, ['--since', 'main', '--only', '^a$'], { git: gitOf([`${D}lwc/sfUiMore/sfUiMore.js`]) });
  assert.ok(only.out.includes('NOTE cascade --only leaves out what no selected check covers: lwc/sfUiMore'), only.out.join('\n'));
});

test('componentVisible: a field the persona cannot read counts as null in the kinds of rule calibrated, and is UNKNOWN in any other', async (t) => {
  const cases = [{ name: 'high', record: HIGH_NOTE, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low', Note__c: null }, expect: { visible: false } }];
  // Note__c unreadable: the tab's rule reads it, and so does the component's rule, both calibrated kinds.
  const noNote = org({ readable: ['Level__c'], describe: GATE_FIELDS });
  const p = matrixProject(t, [vis('c', { cases: [{ name: 'high', record: { Level__c: 'High' }, expect: { visible: true } }, { name: 'low', record: { Level__c: 'Low' }, expect: { visible: false } }] })]);
  const calibrated = await gov(p, noNote);
  assert.deepEqual(calibrated.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS c high', 'PASS c low'], calibrated.out.join('\n'));
  // The gate page's section rule reads Level__c for a field target: a container of a field is not calibrated.
  const section = GATE.replace('{!Record.Note__c}</leftValue>\n                            <operator>NE</operator>\n                            <rightValue>y', '{!Record.Level__c}</leftValue>\n                            <operator>NE</operator>\n                            <rightValue>y');
  const q = project(t, [gateCheck('f', { component: undefined, action: undefined, field: 'Note__c', cases })]);
  put(q, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', section);
  const unknown = await gov(q, org({ readable: ['Note__c'], describe: GATE_FIELDS }));
  assert.match(unknown.out[0], /^NEEDS BROWSER f high /, unknown.out.join('\n'));
  // With Level__c readable the same page decides.
  assert.match((await gov(q, org({ readable: true, describe: GATE_FIELDS }))).out[0], /^PASS f high /);
});

test('componentVisible: a tab\'s rule on an unreadable field is null whether the tab holds a component or an action, and a section\'s stays UNKNOWN', async (t) => {
  const rule = '<visibilityRule><criteria><leftValue>{!Record.Note__c}</leftValue><operator>NE</operator><rightValue>closed</rightValue></criteria></visibilityRule>';
  const panel = '<componentInstance><componentInstanceProperties><name>actionNames</name><valueList><valueListItems><value>Delete</value></valueListItems></valueList></componentInstanceProperties><componentName>force:highlightsPanel</componentName><identifier>panel</identifier></componentInstance>';
  const page = (container) => `<FlexiPage><flexiPageRegions><itemInstances>${panel}</itemInstances><name>body</name><type>Facet</type></flexiPageRegions><flexiPageRegions><itemInstances><componentInstance><componentInstanceProperties><name>body</name><value>body</value></componentInstanceProperties><componentName>${container}</componentName><identifier>box</identifier>${rule}</componentInstance></itemInstances><name>main</name><type>Region</type></flexiPageRegions></FlexiPage>`;
  const cases = [{ name: 'open', record: { Note__c: 'open' }, expect: { visible: true } }, { name: 'closed', record: { Note__c: 'closed' }, expect: { visible: false } }];
  // Note__c unreadable, Level__c readable: the tab's rule reads it as null, which is NE closed, so the action shows.
  const run1 = async (container) => {
    const p = project(t, [gateCheck('a', { cases })]);
    put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', page(container));
    return gov(p, org({ readable: ['Level__c'], describe: GATE_FIELDS }));
  };
  const tab = await run1('flexipage:tab');
  // Unreadable counts as null, which is NE closed, so both states show the action: the second case, expected hidden, fails.
  assert.deepEqual(tab.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS a open', 'FAIL a closed Delete on force:highlightsPanel is shown, the requirement says hidden'], `a tab holding an action is calibrated: ${tab.out.join('\n')}`);
  assert.match((await run1('flexipage:fieldSection')).out[0], /^NEEDS BROWSER a open /, 'a section was never measured');
});

test('componentVisible: a field target the org lacks is UNKNOWN, and a field with no FLS to set (Name) is always readable', async (t) => {
  const f = await flsRun(t, gateCheck('u', { component: undefined, action: undefined, field: 'Level__c', cases: [{ name: 'high', record: HIGH_NOTE, expect: { visible: true } }, { name: 'low', record: HIGH_NOTE, expect: { visible: false } }] }), org({ readable: ['Note__c'], describe: [{ name: 'Note__c', permissionable: true }] }));
  assert.match(f.out[0], /^NEEDS BROWSER u high /, 'a field the page lists, the org lacks and no set grants');
  const byName = GATE.replace(/\{!Record\.Level__c\}/g, '{!Record.Name}');
  const p = project(t, [gateCheck('n', { cases: [{ name: 'high', record: { Name: 'High', Note__c: null }, expect: { visible: true } }, { name: 'low', record: { Name: 'Low', Note__c: null }, expect: { visible: false } }] })]);
  put(p, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml', byName);
  const r = await gov(p, org({ readable: false, describe: [{ name: 'Name', permissionable: false }] }));
  assert.deepEqual(r.out.slice(0, 2).map((l) => l.split(' (')[0]), ['PASS n high', 'PASS n low'], r.out.join('\n'));
});

test('matrix: a stop between groups, or between personas, reads nothing more', async (t) => {
  const other = vis('b', { component: 'c:nope' });
  const stopAfterFirstQuery = (p) => {
    const ac = new AbortController();
    const o = org({ grantedBy: [] });
    const call = o.api.call;
    o.api.call = async (s, q) => { ac.abort(); return /FROM CustomPermission/.test(decodeURIComponent(q)) ? { records: [{ Id: '01qCP' }] } : call(s, q); };
    return run(['verify', '--org', 'x', '--checks', p.file, '--matrix'], { api: o.api, sf: async () => assert.fail('no sf'), signal: ac.signal });
  };
  const groups = await stopAfterFirstQuery(matrixProject(t, [vis('a'), other]));
  assert.ok(!groups.out.some((l) => /c:nope/.test(l)), groups.out.join('\n'));
  assert.equal(groups.code, 1);
  const personas = await stopAfterFirstQuery(matrixProject(t, [vis('a'), vis('b', { persona: readPersona })]));
  assert.ok(personas.out.some((l) => /^Standard Platform User \+ SfUi_Probe:/.test(l)) && !personas.out.some((l) => /SfUi_Probe_Read:/.test(l)), personas.out.join('\n'));
});

// A cover key counts only where the check reads that item; --plan prints UNCOVERED for the item otherwise.
async function coverPlan(t, checks, changed, ns) {
  const p = project(t, checks);
  if (ns) fs.writeFileSync(path.join(p.dir, 'sfdx-project.json'), JSON.stringify({ namespace: ns, packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  touch(p.dir, changed.map((k) => `${D}${k}`));
  for (const k of changed.filter((f) => f.endsWith('.js'))) fs.writeFileSync(path.join(p.dir, D, k), "import x from '@salesforce/apex/First.go';"); // a bundle that calls Apex stays an item
  for (const k of changed.filter((f) => f.endsWith('.cls'))) fs.writeFileSync(path.join(p.dir, D, k), 'public class C { @AuraEnabled public static String ping(Id i) { return null; } }'); // a class with @AuraEnabled stays an item
  return (await run(['verify', '--checks', p.file, '--plan', '--since', 'main'], { git: gitOf(changed.map((k) => `${D}${k}`)) })).out;
}
const SIZE = 'objects/SfUiTyped__c/fields/Size__c';

test('a pageRequired check covers the field it reads, not another, and matches a namespaced name', async (t) => {
  const other = await coverPlan(t, [{ ...page('p', [SIZE]), field: 'Other__c' }], [`${SIZE}.field-meta.xml`]);
  assert.ok(other.includes(`${SIZE} UNCOVERED`), other.join('\n'));
  const own = await coverPlan(t, [page('p', [SIZE])], [`${SIZE}.field-meta.xml`]);
  assert.ok(own.includes(`${SIZE} p`), own.join('\n'));
  const ns = await coverPlan(t, [{ ...page('p', [SIZE]), object: 'ns__SfUiTyped__c', field: 'ns__Size__c' }], [`${SIZE}.field-meta.xml`], 'ns');
  assert.ok(ns.includes(`${SIZE} p`), ns.join('\n'));
});

test('a check covers a permission set its persona holds, not another, and matches a namespaced name', async (t) => {
  const PS = 'permissionsets/SfUi_Probe';
  const none = { profile: 'Standard Platform User', permissionSets: ['SfUi_Other'] };
  const other = await coverPlan(t, [klass('k', { covers: ['classes/SfUiProbeController', PS], persona: none })], [`${PS}.permissionset-meta.xml`]);
  assert.ok(other.includes(`${PS} UNCOVERED`), other.join('\n'));
  const own = await coverPlan(t, [klass('k', { covers: ['classes/SfUiProbeController', PS] })], [`${PS}.permissionset-meta.xml`]);
  assert.ok(own.includes(`${PS} k`), own.join('\n'));
  const ns = await coverPlan(t, [klass('k', { covers: ['classes/SfUiProbeController', PS], persona: { profile: 'Standard Platform User', permissionSets: ['ns__SfUi_Probe'] } })], [`${PS}.permissionset-meta.xml`], 'ns');
  assert.ok(ns.includes(`${PS} k`), ns.join('\n'));
});

test('a classAccess check naming its class covers that class, not another or a bundle of another class, and matches a namespaced name', async (t) => {
  const other = await coverPlan(t, [klass('k', { class: 'Elsewhere', covers: ['classes/SfUiProbeController'] })], ['classes/SfUiProbeController.cls']);
  assert.ok(other.includes('classes/SfUiProbeController UNCOVERED'), other.join('\n'));
  const bundle = await coverPlan(t, [klass('k', { covers: ['classes/SfUiProbeController', 'lwc/probe'] })], ['lwc/probe/probe.js']);
  assert.ok(bundle.includes('lwc/probe UNCOVERED'), bundle.join('\n'));
  const own = await coverPlan(t, [klass('k')], ['classes/SfUiProbeController.cls']);
  assert.ok(own.includes('classes/SfUiProbeController k'), own.join('\n'));
  const ns = await coverPlan(t, [klass('k', { class: 'ns__SfUiProbeController' })], ['classes/SfUiProbeController.cls'], 'ns');
  assert.ok(ns.includes('classes/SfUiProbeController k'), ns.join('\n'));
});

test('a cover key with no item name is read as nothing, not a crash', async (t) => {
  const p = project(t, [page('p', ['objects/SfUiTyped__c/fields']), klass('k', { covers: ['classes/SfUiProbeController', 'permissionsets'] })]);
  const r = await run(['verify', '--checks', p.file, '--plan']);
  assert.equal(r.code, 0, r.out.join('\n'));
});

test('a classAccess check naming its class still covers a bundle whose Apex imports are all that class', async (t) => {
  const dir = fixtureCopy(t, 'verify-bundle-');
  const git = (...a) => require('node:child_process').execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const js = path.join(dir, D, 'lwc/sfUiProbe/sfUiProbe.js');
  fs.appendFileSync(js, '\n// edit\n');
  const plan = async () => (await run(['verify', '--checks', path.join(dir, 'verify-checks.json'), '--plan', '--since', 'HEAD'])).out;
  const own = await plan();
  assert.ok(own.includes('lwc/sfUiProbe probe-class-access'), own.join('\n'));
  assert.ok(own.includes('would run: probe-class-access'), own.join('\n'));
  // Another class beside it in the bundle's imports leaves the check not reading the whole gap.
  fs.appendFileSync(js, "import other from '@salesforce/apex/Other.go';\n");
  const mixed = await plan();
  assert.ok(mixed.includes('lwc/sfUiProbe UNCOVERED'), mixed.join('\n'));
});

test('a field named after the project namespace is matched whole, as the permission read does', async (t) => {
  const key = 'objects/SfUiTyped__c/fields/Region__c';
  const out = await coverPlan(t, [{ ...page('p', [key]), field: 'region__Region__c' }], [`${key}.field-meta.xml`], 'region');
  assert.ok(out.includes(`${key} p`), out.join('\n'));
});

test('a field cover key must name the check\'s object as well as its field', async (t) => {
  const out = await coverPlan(t, [{ ...page('p', [SIZE]), object: 'Other__c' }], [`${SIZE}.field-meta.xml`]);
  assert.ok(out.includes(`${SIZE} UNCOVERED`), out.join('\n'));
});

test('--since selects a check by the keys it reads, so a key it does not read selects nothing', async (t) => {
  const stray = await coverPlan(t, [{ ...page('p', [SIZE]), field: 'Other__c' }], [`${SIZE}.field-meta.xml`]);
  assert.ok(stray.includes('would run: nothing'), stray.join('\n'));
  const own = await coverPlan(t, [page('p', [SIZE])], [`${SIZE}.field-meta.xml`]);
  assert.ok(own.includes('would run: p'), own.join('\n'));
});

test('a deleted item fails the check that reads it, and one it does not read is not checkable', async (t) => {
  const key = 'classes/SfUiProbeController';
  const deleted = async (checks) => {
    const { file } = project(t, checks);
    return run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}${key}.cls`]), sf: async () => assert.fail('a deleted item runs no validate') });
  };
  const own = await deleted([klass('k')]);
  assert.ok(own.out.some((l) => l.startsWith(`FAIL k ${key} deleted on the branch`)), own.out.join('\n'));
  const other = await deleted([klass('k', { class: 'Elsewhere' })]);
  assert.ok(!other.out.some((l) => /deleted on the branch/.test(l)), other.out.join('\n'));
});

test('a deleted bundle still fails a classAccess check that names its class', async (t) => {
  const { file } = project(t, [klass('k', { covers: ['lwc/sfUiProbe'] })]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}lwc/sfUiProbe/sfUiProbe.js`]), sf: async () => assert.fail('a deleted item runs no validate') });
  assert.ok(r.out.some((l) => l.startsWith('FAIL k lwc/sfUiProbe deleted on the branch')), r.out.join('\n'));
});

test('a classless classAccess check and a record check still cover by type', async (t) => {
  const bundle = await coverPlan(t, [klass('k', { class: undefined, covers: ['lwc/probe'] })], ['lwc/probe/probe.js']);
  assert.ok(bundle.includes('lwc/probe k'), bundle.join('\n'));
  const field = await coverPlan(t, [rec('r', [F_X])], [`${F_X}.field-meta.xml`]);
  assert.ok(field.includes(`${F_X} r`), field.join('\n'));
  // A record check's field keys are not matched against its object.
  const foreign = 'objects/Elsewhere__c/fields/X__c';
  const typed = await coverPlan(t, [rec('r', [foreign])], [`${foreign}.field-meta.xml`]);
  assert.ok(typed.includes(`${foreign} r`), typed.join('\n'));
});
