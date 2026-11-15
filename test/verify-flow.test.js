'use strict';

// kind "flow": a flow check is read, planned and generated offline; the org tests at the end need SF_TESTER_ORG.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const verify = require('../src/verify');

const D = 'force-app/main/default/';
const PERSONA = { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] };
const FLOW = (body, { type = 'AutoLaunchedFlow', status = 'Active', start = '' } = {}) => `<Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>66.0</apiVersion><processType>${type}</processType>${body}<start>${start}</start><status>${status}</status></Flow>`;
const RECORD_START = (when, trigger = 'RecordBeforeSave') => `<object>SfUiDyn__c</object><recordTriggerType>${when}</recordTriggerType><triggerType>${trigger}</triggerType>`;
const auto = (id, extra = {}) => ({ id, kind: 'flow', requirement: `req ${id}`, covers: ['flows/F_Auto'], persona: PERSONA, flow: 'F_Auto',
  cases: [{ name: 'greets', input: { in_name: 'bob' }, expect: { returns: { out_msg: 'hello bob' } } }, { name: 'no name', expect: { returns: { out_msg: 'hello ' } } }], ...extra });
const rec = (id, extra = {}) => ({ id, kind: 'flow', requirement: `req ${id}`, covers: ['flows/F_Rec'], persona: PERSONA, flow: 'F_Rec',
  cases: [{ name: 'fires', input: { Name: 'x', Hidden__c: 'S4' }, expect: { returns: { Note__c: 'flow fired' } } }, { name: 'criteria false', input: { Name: 'x', Hidden__c: 'no' }, expect: { returns: { Note__c: null } } }], ...extra });

// A project in a temp dir holding the check file and the flow files named.
function project(t, checks, flows = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-flow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  for (const [n, xml] of Object.entries(flows)) { fs.mkdirSync(path.join(dir, D, 'flows'), { recursive: true }); fs.writeFileSync(path.join(dir, D, 'flows', `${n}.flow-meta.xml`), xml); }
  const file = path.join(dir, 'checks.json');
  fs.writeFileSync(file, JSON.stringify({ checks }));
  return { dir, file };
}
const gitOf = (changed) => (args) => { if (args.includes('--name-only')) return args.includes('HEAD') && !args.some((x) => x.includes('...')) ? '' : changed.join('\n'); throw new Error(`unexpected git ${args}`); };
// calls holds every sf call the default stub saw: validate() catches a throw, so a test that expects no validate asserts it empty.
async function run(argv, more = {}) {
  const out = [];
  const calls = [];
  const code = await cli.main(argv, { log: (l) => out.push(l), warn: (l) => out.push(l), connect: async () => ({ production: false, orgApiVersion: '68.0' }), sf: async (args) => { calls.push(args); throw new Error('no validate expected'); }, ...more });
  return { code, out, calls };
}
const REPORT = (ok, bad = {}) => JSON.stringify({ status: 0, result: { status: Object.keys(bad).length ? 'Failed' : 'Succeeded', details: { runTestResult: { successes: ok.map((methodName) => ({ methodName })), failures: Object.entries(bad).map(([methodName, message]) => ({ methodName, message: `System.AssertException: Assertion Failed: ${message}` })) } } } });
// The sf stub answers the validate with an envelope and the report, and keeps the class and the payload files it was given.
function validating(answers) {
  const seen = [];
  const sf = async (args, { cwd }) => {
    if (seen.length === 0) seen.push({ args, cwd, apex: fs.readFileSync(path.join(cwd, D, 'classes/SfTesterVerifyTest.cls'), 'utf8'), files: fs.readdirSync(path.join(cwd, D), { recursive: true }).sort() }); else seen.push({ args });
    return answers[seen.length - 1];
  };
  return { seen, sf };
}
const ENVELOPE = JSON.stringify({ status: 0, result: { id: '0Af9H000009Y79xSAC' } });

test('flow BAD_CHECK: the flow name, a cover of its own flow, two cases that differ, and the shape of input and returns', () => {
  const bad = (c) => verify.badChecks({ checks: [c] })[0];
  assert.deepEqual(verify.badChecks({ checks: [auto('a'), rec('r')] }), [], 'two valid flow checks, no object needed');
  assert.match(bad(auto('a', { flow: "F'; x" })), /^a: flow must be a plain API name/);
  assert.match(bad(auto('a', { flow: undefined })), /^a: flow must be a plain API name/);
  assert.match(bad(auto('a', { covers: ['classes/X'] })), /^a: covers must include flows\/F_Auto/);
  assert.match(bad(auto('a', { cases: auto('a').cases.slice(0, 1) })), /^a: needs two or more cases/);
  assert.match(bad(auto('a', { cases: auto('a').cases.map((k) => ({ ...k, name: 'same' })) })), /^a: two cases have the same name/);
  const same = auto('a').cases[0];
  assert.match(bad(auto('a', { cases: [same, { ...same, name: 'again' }] })), /^a: needs cases that expect different things/);
  // Key order is not a difference, and cases that expect nothing but null prove nothing: a flow that never fires passes them all.
  const ab = { name: 'ab', expect: { returns: { a: 1, b: 2 } } };
  assert.match(bad(auto('a', { cases: [ab, { name: 'ba', expect: { returns: { b: 2, a: 1 } } }] })), /^a: needs cases that expect different things/);
  assert.match(bad(auto('a', { cases: [{ name: 'n1', expect: { returns: { a: null } } }, { name: 'n2', expect: { returns: { b: null } } }] })), /^a: needs a case that expects a throws or a value that is not null/);
  assert.match(bad(auto('a', { cases: [{ name: 'n1', expect: { returns: { a: null } } }, { name: 'n2', expect: { returns: { a: null, b: null } } }] })), /^a: needs a case that expects a throws or a value that is not null/);
  assert.deepEqual(verify.badChecks({ checks: [auto('a', { cases: [{ name: 'n1', expect: { returns: { a: null } } }, { name: 'n2', expect: { throws: 'x' } }] })] }), [], 'a throws case is a control');
  assert.deepEqual(verify.badChecks({ checks: [auto('a', { cases: [{ name: 'n1', expect: { returns: { a: null } } }, { name: 'n2', expect: { returns: { b: 0 } } }] })] }), [], 'a value that is not null, 0 included, is a control');
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { returns: {}, throws: 'x' } }] })), /case "n": expect needs returns and\/or record, or throws alone/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: {} }] })), /case "n": expect needs returns and\/or record/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { nope: 1 } }] })), /case "n": expect needs returns and\/or record/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { returns: 'x' } }] })), /case "n": expect.returns must be an object/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { returns: { '__reads': 1 } } }] })), /case "n": expect.returns must be an object/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { throws: '' } }] })), /case "n": expect.throws must be non-empty text/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', expect: { returns: { n: 2 ** 53 + 1 } } }] })), /case "n": expect holds an integer past the safe range/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', record: { Name: 'a' }, object: 'X__c', expect: { record: { n: { m: 2 ** 60 } } } }], object: 'X__c' })), /case "n": expect holds an integer past the safe range/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', input: { __reads: 'x' }, expect: { throws: 't' } }] })), /case "n": input must be an object of plain values under plain names, none starting with __/);
  assert.match(bad(auto('a', { cases: [same, { name: 'n', input: { a: [1] }, expect: { throws: 't' } }] })), /case "n": input must be/);
  // record: the record a flow works on, made before it starts; the check names its object.
  const withRec = { object: 'S4Fix_Item__c', cases: [{ name: 'r', record: { Name: 'a' }, expect: { record: { Result__c: 'x' } } }, { name: 'n', record: { Name: 'a' }, expect: { throws: 't' } }] };
  assert.deepEqual(verify.badChecks({ checks: [auto('a', withRec)] }), [], 'record and expect.record with the object named');
  assert.match(bad(auto('a', { ...withRec, object: undefined })), /case "r": record and expect.record go together, and the check names the object/);
  assert.match(bad(auto('a', { ...withRec, object: "X'" })), /case "r": record and expect.record go together/);
  assert.match(bad(auto('a', { ...withRec, cases: [{ name: 'r', expect: { record: { Result__c: 'x' } } }, withRec.cases[1]] })), /case "r": record and expect.record go together/);
  assert.match(bad(auto('a', { ...withRec, cases: [{ name: 'r', record: 'x', expect: { returns: { a: 1 } } }, withRec.cases[1]] })), /case "r": record must be an object of plain field values/);
  assert.match(bad(auto('a', { ...withRec, cases: [{ name: 'r', record: { Name: 'a' }, expect: { record: {} } }, withRec.cases[1]] })), /case "r": expect.record must be an object of field names/);
  assert.match(bad(auto('a', { covers: ['flows/F_Auto', 'fields/X'] })), /^a: a flow check cannot cover fields\/X; it covers flows, classes$/);
  assert.deepEqual(verify.badChecks({ checks: [auto('a', { covers: ['flows/F_Auto', 'classes/S4Fix_Action'] })] }), [], 'a flow check covers the flow and an invocable it calls');
});

test('flowPlan reads the kind from the flow file: autolaunched, record-triggered on create, or a hand-off with its reason', () => {
  assert.deepEqual(verify.flowPlan(FLOW('')), { status: 'Active', shape: 'auto' });
  assert.deepEqual(verify.flowPlan(FLOW('', { start: RECORD_START('Create') })), { status: 'Active', shape: 'record', object: 'SfUiDyn__c' });
  assert.deepEqual(verify.flowPlan(FLOW('', { start: RECORD_START('CreateAndUpdate', 'RecordAfterSave'), status: 'Draft' })), { status: 'Draft', shape: 'record', object: 'SfUiDyn__c' });
  assert.match(verify.flowPlan(FLOW('', { type: 'Flow' })).hand, /^a screen flow: Flow\.Interview\.start\(\) refuses it \("Start can't be called on a flow with the process type Screen Flow\."\)/);
  assert.match(verify.flowPlan(FLOW('', { start: RECORD_START('Update') })).hand, /^a record-triggered flow on Update only/);
  assert.match(verify.flowPlan(FLOW('', { start: RECORD_START('Delete', 'RecordBeforeDelete') })).hand, /^a AutoLaunchedFlow RecordBeforeDelete flow: verify runs autolaunched and record-triggered flows only/);
  assert.match(verify.flowPlan(FLOW('', { start: '<triggerType>Scheduled</triggerType>' })).hand, /AutoLaunchedFlow Scheduled flow/);
  assert.match(verify.flowPlan(FLOW('', { type: 'Orchestrator' })).hand, /Orchestrator flow/);
  assert.equal(verify.flowPlan(FLOW('', { type: '' })).hand, 'a flow with no process type and no trigger: verify runs autolaunched and record-triggered flows only', 'no double space, and the reason names what is missing');
  // Work on an asynchronous or scheduled path, or after a Pause, never runs inside the act: a check would FAIL a correct flow.
  assert.match(verify.flowPlan(FLOW('<waits><name>w</name></waits>', { start: RECORD_START('Create') })).hand, /^a flow with a Wait element: its work runs after the transaction/);
  assert.match(verify.flowPlan(FLOW('<waits><name>w</name></waits>')).hand, /^a flow with a Wait element/);
  assert.match(verify.flowPlan(FLOW('', { start: `${RECORD_START('Create', 'RecordAfterSave')}<scheduledPaths><pathType>AsyncAfterCommit</pathType></scheduledPaths>` })).hand, /^a flow with an asynchronous or scheduled path: /);
});

test('flowCheck generates the apex a flow needs: createInterview for an autolaunched flow, an insert and a read back for a record-triggered one', (t) => {
  const a = project(t, [], { F_Auto: FLOW(''), F_Rec: FLOW('', { start: RECORD_START('Create') }) });
  const proj = verify.loadProject(a.file);
  const got = verify.flowCheck(auto('a'), proj, new Map());
  assert.equal(got.apex.kind, 'apex');
  assert.match(got.apex.act, /Flow\.Interview\.createInterview\('F_Auto', ins\);\ni\.start\(\);/);
  assert.match(got.apex.act, /if \(o != ''\) got\.put\(o, i\.getVariableValue\(o\)\)/);
  assert.match(got.note, /system access/);
  assert.deepEqual(got.apex.cases.map((k) => k.input), [{ in_name: 'bob', __reads: 'out_msg' }, { __reads: 'out_msg' }]);
  assert.deepEqual(got.apex.cases[0].expect, { returns: { out_msg: 'hello bob' } });
  const r = verify.flowCheck(rec('r'), proj, new Map());
  assert.match(r.apex.act, /Schema\.getGlobalDescribe\(\)\.get\('SfUiDyn__c'\)\.newSObject\(\);/);
  assert.match(r.apex.act, /insert r;\nId rid = r\.Id;/);
  assert.match(r.apex.act, /'SELECT ' \+ q \+ ' FROM SfUiDyn__c WHERE Id = :rid', AccessLevel\.SYSTEM_MODE/);
  assert.equal(r.note, null, 'a record-triggered flow is not told as system access: the persona does the DML');
  // The generated class is valid for the apex generator: a returns case and a throws case compile into methods.
  const mixed = verify.flowCheck(auto('m', { cases: [...auto('m').cases, { name: 'faults', input: { in_count: -1 }, expect: { throws: 'Count cannot be negative' } }] }), proj, new Map());
  assert.deepEqual(mixed.apex.cases[2].input, { in_count: -1, __reads: '' });
  assert.match(verify.generate([mixed.apex]).apex, /act_c0\(Map<String,Object> input\)/);
});

test('flowCheck names the namespace to createInterview: the project\'s, else none; a flow name with __ is BAD_CHECK', (t) => {
  const p = project(t, [], { F_Auto: FLOW('') });
  const proj = verify.loadProject(p.file);
  const act = (c, pr) => verify.flowCheck(c, pr, new Map()).apex.act;
  assert.match(act(auto('a'), proj), /createInterview\('F_Auto', ins\);/, 'no namespace: the two-argument form');
  assert.match(act(auto('a'), { ...proj, namespace: 'pkg' }), /createInterview\('pkg', 'F_Auto', ins\);/, 'the project\'s namespace');
  assert.match(verify.badChecks({ checks: [auto('a', { flow: 'pkg__F_Auto', covers: ['flows/pkg__F_Auto'] })] })[0], /^a: flow must be the API name without a namespace/);
});

test('flowCheck with a record: made in system mode before the flow, its id is recordId, the fields are read back as record.<Field>', async (t) => {
  const p = project(t, [], { F_Auto: FLOW(''), F_Rec: FLOW('', { start: RECORD_START('Create') }) });
  const proj = verify.loadProject(p.file);
  const chk = auto('a', { object: 'S4Fix_Item__c', cases: [{ name: 'stamps', input: { text: 'a' }, record: { Name: 'i' }, expect: { record: { Result__c: 'stamped:a' } } }, { name: 'blank', input: { text: '' }, expect: { throws: 'Text is required' } }, { name: 'out too', record: { Name: 'j' }, expect: { returns: { out: 1 }, record: { Result__c: null } } }] });
  const got = verify.flowCheck(chk, proj, new Map());
  assert.deepEqual(got.apex.cases[0], { name: 'stamps', input: { text: 'a', __reads: '', __object: 'S4Fix_Item__c', '__f.Name': 'i', __rf: 'Result__c' }, expect: { returns: { 'record.Result__c': 'stamped:a' } } });
  assert.deepEqual(got.apex.cases[1], { name: 'blank', input: { text: '', __reads: '' }, expect: { throws: 'Text is required' } });
  assert.deepEqual(got.apex.cases[2].expect, { returns: { out: 1, 'record.Result__c': null } }, 'outputs and record fields are read into one map');
  assert.match(got.apex.act, /insert as system rec; ins\.put\('recordId', rec\.Id\);/);
  assert.match(got.apex.act, /got\.put\('record\.' \+ o, back\.get\(o\)\)/);
  // A record-triggered flow saves its own record, so a case with a record is BAD_CHECK at load time, and --plan says so without an org.
  const withRec = rec('r', { object: 'X__c', cases: [{ name: 'a', record: { Name: 'a' }, expect: { record: { F__c: 1 } } }, { name: 'b', expect: { throws: 't' } }] });
  assert.match(verify.badChecks({ checks: [withRec] }, proj)[0], /^r: flows\/F_Rec saves its own record: give input and expect\.returns, not record$/);
  assert.deepEqual(verify.badChecks({ checks: [withRec] }), [], 'without the project the flow cannot be read');
  assert.deepEqual(verify.badChecks({ checks: [auto('a', { object: 'X__c', cases: withRec.cases })] }, proj), [], 'an autolaunched flow takes a record');
  const recFile = path.join(path.dirname(p.file), 'rec.json');
  fs.writeFileSync(recFile, JSON.stringify({ checks: [withRec] }));
  const planned = await run(['verify', '--checks', recFile, '--plan']);
  assert.equal(planned.code, 2, planned.out.join('\n'));
  assert.match(planned.out.join('\n'), /^BAD_CHECK r: flows\/F_Rec saves its own record/m);
});

test('a trigger object that is not a plain API name is an ERROR and never reaches the generated Apex', (t) => {
  const odd = "Acc'); delete [SELECT Id FROM Account]; //";
  const p = project(t, [], { F_Rec: FLOW('', { start: RECORD_START('Create').replace('SfUiDyn__c', odd) }) });
  assert.match(verify.flowPlan(FLOW('', { start: RECORD_START('Create').replace('SfUiDyn__c', odd) })).error, /^the flow's trigger object "Acc'\); delete .* is not a plain API name/);
  const got = verify.flowCheck(rec('r'), verify.loadProject(p.file), new Map());
  assert.equal(got.status, 'error');
  assert.equal(got.apex, undefined, 'no Apex is generated');
});

test('flowCheck: a flow the project lacks, and a changed flow the branch leaves Draft, are ERRORs that run nothing', (t) => {
  const p = project(t, [], { F_Auto: FLOW('', { status: 'Draft' }) });
  const proj = verify.loadProject(p.file);
  assert.match(verify.flowCheck(rec('r'), proj, new Map()).error, /^no flows\/F_Rec\.flow-meta\.xml in the project/);
  assert.equal(verify.flowCheck(auto('a'), proj, new Map()).apex.kind, 'apex', 'a Draft flow nobody changed is not looked at: the org holds what runs');
  const changed = verify.flowCheck(auto('a'), proj, new Map([['flows/F_Auto', []]]));
  assert.equal(changed.status, 'error');
  assert.match(changed.error, /^flows\/F_Auto is Draft on the branch, so this check is stale: a validate tests an Active flow only, and the persona would run the org's version\. Update or remove the check if the branch turns the flow off on purpose$/);
  const none = project(t, [], { F_Auto: FLOW('').replace('<status>Active</status>', '') });
  assert.match(verify.flowCheck(auto('a'), verify.loadProject(none.file), new Map([['flows/F_Auto', []]])).error, /is unmarked on the branch/);
});

test('with --since a changed flow selects the checks covering it, goes in the payload, and its cases run as apex in one validate', async (t) => {
  const { file } = project(t, [auto('flow-auto'), rec('flow-rec')], { F_Auto: FLOW(''), F_Rec: FLOW('', { start: RECORD_START('Create') }) });
  const { seen, sf } = validating([ENVELOPE, REPORT(['c0_0', 'c0_1', 'c1_0', 'c1_1'])]);
  const files = [`${D}flows/F_Auto.flow-meta.xml`, `${D}flows/F_Rec.flow-meta.xml`];
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf(files), sf });
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.deepEqual(seen[0].files.filter((f) => /flow-meta\.xml$/.test(f)), ['flows/F_Auto.flow-meta.xml', 'flows/F_Rec.flow-meta.xml'], 'both changed flows are in the payload');
  assert.match(seen[0].apex, /Flow\.Interview\.createInterview\('F_Auto', ins\)/);
  assert.match(seen[0].apex, /static Object act_c1\(Map<String,Object> input\)/);
  assert.ok(r.out.includes('PASS flow-auto greets (the flow ran with system access, not the persona\'s)'), r.out.join('\n'));
  assert.ok(r.out.includes('PASS flow-rec fires'), r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 2, covered 2, uncovered 0, ran 4, passed 4, failed 0');
  assert.equal(fs.existsSync(seen[0].cwd), false, 'the temp payload folder is removed after the run');
});

test('the payload carries a changed autolaunched or on-create record-triggered flow, whether or not a check runs it; a screen or scheduled flow stays out', async (t) => {
  const { file } = project(t, [auto('flow-auto')], { F_Auto: FLOW(''), F_Uncovered: FLOW(''), F_Screen: FLOW('', { type: 'Flow' }), F_Sched: FLOW('', { start: '<triggerType>Scheduled</triggerType>' }) });
  const { seen, sf } = validating([ENVELOPE, REPORT(['c0_0', 'c0_1'])]);
  const files = ['F_Auto', 'F_Uncovered', 'F_Screen', 'F_Sched'].map((n) => `${D}flows/${n}.flow-meta.xml`);
  await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf(files), sf });
  assert.deepEqual(seen[0].files.filter((f) => /flow-meta\.xml$/.test(f)), ['flows/F_Auto.flow-meta.xml', 'flows/F_Uncovered.flow-meta.xml'], 'the autolaunched flows are in, covered or not; the screen and scheduled flows are out');
});

test('a changed on-create record flow with an async path goes in the payload beside a record check, since its immediate path runs on the insert', async (t) => {
  const RULE = 'objects/SfUiProbe__c/validationRules/SfUi_Count_Not_Negative';
  const check = { id: 'count-rule', kind: 'record', requirement: 'req', covers: [RULE], persona: PERSONA, object: 'SfUiProbe__c',
    cases: [{ name: 'rejects', fields: { Name: 'v', Count__c: -1 }, expect: { saves: false, error: 'Count cannot be negative' } }, { name: 'accepts', fields: { Name: 'v', Count__c: 0 }, expect: { saves: true } }] };
  const async = `${RECORD_START('Create', 'RecordAfterSave')}<scheduledPaths><pathType>AsyncAfterCommit</pathType></scheduledPaths>`;
  const { dir, file } = project(t, [check], { F_Async: FLOW('', { start: async }) });
  fs.mkdirSync(path.join(dir, D, 'objects/SfUiProbe__c/validationRules'), { recursive: true });
  fs.writeFileSync(path.join(dir, D, `${RULE}.validationRule-meta.xml`), '<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><active>true</active></ValidationRule>');
  const { seen, sf } = validating([ENVELOPE, REPORT(['c0_0', 'c0_1'])]);
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}flows/F_Async.flow-meta.xml`, `${D}${RULE}.validationRule-meta.xml`]), sf });
  assert.ok(seen.length, r.out.join('\n'));
  assert.deepEqual(seen[0].files.filter((f) => /flow-meta\.xml$/.test(f)), ['flows/F_Async.flow-meta.xml'], 'the flow is in the payload');
});

test('a changed flow no check covers is UNCOVERED, red; a flow check is selected only by its own flow or invocable', async (t) => {
  const { file } = project(t, [auto('flow-auto', { covers: ['flows/F_Auto', 'classes/S4Fix_Action'] })], { F_Auto: FLOW(''), F_Other: FLOW('') });
  const none = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}flows/F_Other.flow-meta.xml`]) });
  assert.equal(none.code, 1, none.out.join('\n'));
  assert.ok(none.out.includes('UNCOVERED flows/F_Other'), none.out.join('\n'));
  assert.match(none.out.at(-1), /^changed 1, covered 0, uncovered 1, ran 0, passed 0, failed 0/);
  const plan = await run(['verify', '--checks', file, '--plan', '--since', 'main'], { git: gitOf([`${D}flows/F_Auto.flow-meta.xml`, `${D}classes/S4Fix_Action.cls`]) });
  assert.ok(plan.out.includes('flows/F_Auto flow-auto'), plan.out.join('\n'));
  assert.ok(plan.out.includes('classes/S4Fix_Action flow-auto'), 'an invocable the flow calls is covered even with no @AuraEnabled method: ' + plan.out.join('\n'));
  assert.ok(plan.out.includes('would run: flow-auto'), plan.out.join('\n'));
});

test('a screen flow, and a flow of a kind verify cannot run, hand off: NEEDS BROWSER, exit 0, no validate, never PASS', async (t) => {
  const screen = auto('flow-screen', { covers: ['flows/F_Screen'], flow: 'F_Screen' });
  const upd = rec('flow-upd', { covers: ['flows/F_Upd'], flow: 'F_Upd' });
  const { file } = project(t, [screen, upd], { F_Screen: FLOW('', { type: 'Flow' }), F_Upd: FLOW('', { start: RECORD_START('Update') }) });
  const r = await run(['verify', '--org', 'o', '--checks', file]);
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.ok(r.out.some((l) => /^NEEDS BROWSER flow-screen F_Screen a screen flow: Flow\.Interview\.start\(\) refuses it \("Start can't be called on a flow with the process type Screen Flow\."\), so the browser layer owns it \(requirement: req flow-screen\)$/.test(l)), r.out.join('\n'));
  assert.ok(r.out.some((l) => /^NEEDS BROWSER flow-upd F_Upd a record-triggered flow on Update only/.test(l)), r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 2, passed 0, failed 0, needs browser 2');
  assert.deepEqual(r.calls, [], 'a run of hand-offs sends nothing to the org');
  const junit = path.join(os.tmpdir(), `flow-handoff-${process.pid}.xml`);
  t.after(() => fs.rmSync(junit, { force: true }));
  await run(['verify', '--org', 'o', '--checks', file, '--junit', junit]);
  assert.match(fs.readFileSync(junit, 'utf8'), /<skipped/, 'a hand-off is skipped in JUnit, not a pass');
});

test('a check on a flow verify hands off needs no cases; a runnable flow, or one the project lacks, still needs two', async (t) => {
  const none = (id, flow) => { const c = auto(id, { covers: [`flows/${flow}`], flow }); delete c.cases; return c; };
  const { file } = project(t, [none('flow-screen', 'F_Screen')], { F_Screen: FLOW('', { type: 'Flow' }), F_Auto: FLOW('') });
  const r = await run(['verify', '--org', 'o', '--checks', file]);
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('NEEDS BROWSER flow-screen F_Screen a screen flow')), r.out.join('\n'));
  const proj = verify.loadProject(file);
  assert.deepEqual(verify.badChecks({ checks: [{ ...none('a', 'F_Screen'), cases: [] }] }, proj), [], 'cases: [] is the same as no cases');
  assert.match(verify.badChecks({ checks: [{ ...none('a', 'F_Auto'), cases: [] }] }, proj)[0], /^a: needs two or more cases/, 'but not for a runnable flow');
  assert.match(verify.badChecks({ checks: [none('a', 'F_Auto')] }, proj)[0], /^a: needs two or more cases/, 'an autolaunched flow runs its cases');
  assert.match(verify.badChecks({ checks: [none('a', 'F_Missing')] }, proj)[0], /^a: needs two or more cases/, 'no file, no hand-off known');
  assert.match(verify.badChecks({ checks: [none('a', 'F_Screen')] })[0], /^a: needs two or more cases/, 'no project, no hand-off known');
});

test('sf_verify_checks names every flow kind verify hands off, and that the flow file must be in the project', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8').match(/tool\('sf_verify_checks', '([^\n]*)',/)[1];
  const flow = text.match(/; flow \{.*?; componentVisible \{/)[0];
  for (const words of ['whose file is in the project', 'a screen flow', 'a later path or a Wait', 'triggered only on update or delete', 'another process type']) assert.ok(flow.includes(words), `${words}: ${flow}`);
});

test('a hand-off beside a runnable flow check: the runnable one still validates, the hand-off is counted and not passed', async (t) => {
  const screen = auto('flow-screen', { covers: ['flows/F_Screen'], flow: 'F_Screen' });
  const { file } = project(t, [screen, auto('flow-auto')], { F_Screen: FLOW('', { type: 'Flow' }), F_Auto: FLOW('') });
  const { seen, sf } = validating([ENVELOPE, REPORT(['c0_0', 'c0_1'])]);
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(seen[0].apex.includes('F_Screen'), false, 'the screen flow is not in the generated class');
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 3, passed 2, failed 0, needs browser 1');
});

test('a changed flow left Draft on the branch is an ERROR with its reason and runs no validate', async (t) => {
  const { file } = project(t, [auto('flow-auto')], { F_Auto: FLOW('', { status: 'Draft' }) });
  const r = await run(['verify', '--org', 'o', '--checks', file, '--since', 'main'], { git: gitOf([`${D}flows/F_Auto.flow-meta.xml`]) });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => /^ERROR flow-auto F_Auto flows\/F_Auto is Draft on the branch, so this check is stale: a validate tests an Active flow only/.test(l)), r.out.join('\n'));
  assert.deepEqual(r.calls, [], 'a run of ERRORs that never reach a deploy sends nothing to the org');
});

test('a failing flow case reports what the flow returned against what the check expects', async (t) => {
  const { file } = project(t, [auto('flow-auto')], { F_Auto: FLOW('') });
  const { sf } = validating([ENVELOPE, REPORT(['c0_1'], { c0_0: 'expected {"out_msg":"hello bob"}, got {"out_msg":"bye bob"}' })]);
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf });
  assert.equal(r.code, 1);
  assert.ok(r.out.some((l) => l.startsWith('FAIL flow-auto greets expected {"out_msg":"hello bob"}, got {"out_msg":"bye bob"}')), r.out.join('\n'));
});

test('the system-access note goes on a PASS or FAIL of an autolaunched check, not on an ERROR where the flow never ran', async (t) => {
  const { file } = project(t, [auto('flow-auto')], { F_Auto: FLOW('') });
  const failed = validating([JSON.stringify({ name: 'DeployFailed', message: 'boom' })]);
  const r = await run(['verify', '--org', 'o', '--checks', file], { sf: failed.sf });
  const line = r.out.find((l) => l.startsWith('ERROR flow-auto greets'));
  assert.ok(line, r.out.join('\n'));
  assert.equal(line.includes('system access'), false, line);
  const setup = validating([ENVELOPE, REPORT(['c0_1'], { c0_0: 'SETUP: no such user' })]);
  const q = await run(['verify', '--org', 'o', '--checks', file], { sf: setup.sf });
  assert.equal(q.out.some((l) => l.startsWith('ERROR flow-auto greets') && l.includes('system access')), false, q.out.join('\n'));
  assert.ok(q.out.includes('PASS flow-auto no name (the flow ran with system access, not the persona\'s)'), 'a pass keeps the note: ' + q.out.join('\n'));
});

test('a flow check needs API 67.0 like an apex check: exit 2 before any deploy', async (t) => {
  const { file } = project(t, [auto('flow-auto')], { F_Auto: FLOW('') });
  const r = await run(['verify', '--org', 'o', '--checks', file], { connect: async () => ({ production: false, orgApiVersion: '66.0' }) });
  assert.equal(r.code, 2, r.out.join('\n'));
  assert.match(r.out.join('\n'), /apex checks need 67\.0 or later/);
});

test('below API 67.0 a flow check that only hands off or errors is no apex run: it reports, it does not exit 2', async (t) => {
  const old = { connect: async () => ({ production: false, orgApiVersion: '66.0' }) };
  const screen = auto('flow-screen', { covers: ['flows/F_Screen'], flow: 'F_Screen' });
  const handoff = project(t, [screen], { F_Screen: FLOW('', { type: 'Flow' }) });
  const h = await run(['verify', '--org', 'o', '--checks', handoff.file], old);
  assert.equal(h.code, 0, h.out.join('\n'));
  assert.ok(h.out.some((l) => l.startsWith('NEEDS BROWSER flow-screen')), h.out.join('\n'));
  const missing = project(t, [auto('flow-auto')], {});
  const m = await run(['verify', '--org', 'o', '--checks', missing.file], old);
  assert.equal(m.code, 1, 'an ERROR, not the 67.0 refusal: ' + m.out.join('\n'));
  assert.ok(m.out.some((l) => l.startsWith('ERROR flow-auto')), m.out.join('\n'));
});

// ---- against an org: SF_TESTER_ORG names a scratch org with test/fixture deployed; these are skipped without it ----
const ORG = process.env.SF_TESTER_ORG;
const live = { skip: !ORG && 'set SF_TESTER_ORG to a scratch org with test/fixture deployed' };
const FIXTURE_DIR = path.join(__dirname, 'fixture');
const ONLY = '^(s4-auto-flow|s4-item-flow|bump-screen-flow)$';

test('the fixture flow checks pass: autolaunched, record-triggered, and the screen flow hands off', live, async () => {
  const r = await run(['verify', '--org', ORG, '--checks', path.join(FIXTURE_DIR, 'verify-checks.json'), '--only', ONLY], { sf: undefined, connect: undefined });
  assert.equal(r.code, 0, r.out.join('\n'));
  assert.equal(r.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 5, passed 4, failed 0, needs browser 1', r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('NEEDS BROWSER bump-screen-flow')), r.out.join('\n'));
});

// A copy of the fixture as a git repo with one commit, a change applied and staged, then verify --since HEAD.
async function changed(t, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-flow-red-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true, filter: (f) => !/\/\.sf(dx)?(\/|$)/.test(f) });
  const git = (...a) => require('node:child_process').execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  edit((f) => path.join(dir, D, f));
  git('add', '-A');
  return run(['verify', '--org', ORG, '--checks', path.join(dir, 'verify-checks.json'), '--since', 'HEAD', '--only', ONLY], { sf: undefined, connect: undefined });
}
const rewrite = (f, from, to) => { const s = fs.readFileSync(f, 'utf8'); assert.ok(s.includes(from), `${from} is in ${f}`); fs.writeFileSync(f, s.replace(from, to)); };

test('red proof: the autolaunched flow stops writing the stamped text', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('flows/S4Fix_Auto_Flow.flow-meta.xml'), '<elementReference>Stamp_Text</elementReference>', '<stringValue>nope</stringValue>'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL s4-auto-flow stamps the text expected {"record.Result__c":"stamped:a"}, got {"record.Result__c":"nope"}')), r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('PASS s4-auto-flow a blank text throws')), 'the control case still passes');
});

test('red proof: the invocable the flow calls changes what it returns', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('classes/S4Fix_Stamp.cls'), "'stamped:' + t", "'changed:' + t"));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL s4-auto-flow stamps the text expected') && l.includes('changed:a')), r.out.join('\n'));
});

test('red proof: the record-triggered flow sets another status', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('flows/S4Fix_Item_Flow.flow-meta.xml'), '<stringValue>Seen</stringValue>', '<stringValue>Other</stringValue>'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('FAIL s4-item-flow sets Status to Seen expected {"Status__c":"Seen"}, got {"Status__c":"Other"}')), r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('PASS s4-item-flow leaves Result empty')), 'the control case still passes');
});

test('a changed flow left Draft is an ERROR in the org run too, not the old version passing', live, async (t) => {
  const r = await changed(t, (at) => rewrite(at('flows/S4Fix_Item_Flow.flow-meta.xml'), '<status>Active</status>', '<status>Draft</status>'));
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('ERROR s4-item-flow S4Fix_Item_Flow flows/S4Fix_Item_Flow is Draft on the branch, so this check is stale')), r.out.join('\n'));
});

test('the persona limits the DML that fires a record-triggered flow, and not an autolaunched flow', live, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-flow-denied-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true, filter: (f) => !/\/\.sf(dx)?(\/|$)/.test(f) });
  const file = path.join(dir, 'verify-checks.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8')).checks.filter((c) => /^s4-(auto|item)-flow$/.test(c.id));
  fs.writeFileSync(file, JSON.stringify({ checks: all.map((c) => ({ ...c, persona: { profile: 'Standard Platform User', permissionSets: [] } })) }));
  const r = await run(['verify', '--org', ORG, '--checks', file], { sf: undefined, connect: undefined });
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.equal(r.out.filter((l) => l.startsWith('PASS s4-auto-flow')).length, 2, 'a persona with no access still gets the flow: it runs with system access');
  assert.equal(r.out.filter((l) => /^FAIL s4-item-flow .* threw System\.SecurityException: Access to entity 'S4Fix_Item__c' denied/.test(l)).length, 2, r.out.join('\n'));
});
