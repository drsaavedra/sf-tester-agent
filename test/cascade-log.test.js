'use strict';

// The cascade reader, from real ApexLogs saved off a scratch org (test/cascade-samples): one test that fires a
// before-save flow, a trigger and two validation rules, and one that fires nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseLog } = require('../src/cascade-log');

const sample = (n) => fs.readFileSync(path.join(__dirname, 'cascade-samples', n), 'utf8');

test('a log that fires a flow, a trigger and two rules lists each, per test method', () => {
  const { truncated, tests } = parseLog(sample('trigger-rule-flow.log'), 'S4Cas_ProbeTest');
  assert.equal(truncated, false);
  assert.deepEqual(Object.keys(tests), ['S4Cas_ProbeTest.fires']);
  const t = tests['S4Cas_ProbeTest.fires'];
  assert.deepEqual(t.flows, ['S4Cas Probe Flow']);
  assert.deepEqual(t.triggers, [{ name: 'S4Cas_ProbeTrigger', object: 'SfUiProbe', event: 'BeforeInsert' }]);
  assert.deepEqual(t.rules, [{ name: 'SfUi_Count_Not_Negative', result: 'FAIL' }, { name: 'SfUi_Due_Not_Before_2000', result: 'PASS' }]);
  // The trigger's own call shows, the test class's own constructor does not.
  assert.deepEqual(t.classes, ['S4Cas_Tally']);
});

test('the control: a test that fires no trigger shows no trigger, flow or rule line', () => {
  const { tests } = parseLog(sample('control.log'), 'S4Cas_ProbeTest');
  assert.deepEqual(tests['S4Cas_ProbeTest.control'], { triggers: [], flows: [], rules: [], classes: [], partial: false });
});

test('a queueable run inside a test is not a test of its own: what it fires stays with the test method', () => {
  const log = sample('trigger-rule-flow.log').replace('|CODE_UNIT_STARTED|[EXTERNAL]|Flow:', '|CODE_UNIT_STARTED|[EXTERNAL]|01pQL00001QUEUE|S4Cas_Queue.execute()\n07:33:22.6 (154078808)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:');
  const { tests } = parseLog(log, 'S4Cas_ProbeTest');
  assert.deepEqual(Object.keys(tests), ['S4Cas_ProbeTest.fires']);
  assert.deepEqual(tests['S4Cas_ProbeTest.fires'].flows, ['S4Cas Probe Flow']);
});

test('in a namespaced org a test method keys without its namespace, and the test class is still left out', () => {
  const log = sample('trigger-rule-flow.log').replaceAll('|S4Cas_ProbeTest.', '|ns.S4Cas_ProbeTest.');
  const t = parseLog(log, 'S4Cas_ProbeTest').tests['S4Cas_ProbeTest.fires'];
  assert.deepEqual(t?.flows, ['S4Cas Probe Flow']);
  assert.deepEqual(t.classes, ['S4Cas_Tally']);
});

test('a flow, trigger or rule that fires on two DMLs is listed once', () => {
  const log = sample('trigger-rule-flow.log');
  const lines = log.split('\n');
  const twice = [...lines.slice(0, 6), ...lines.slice(6, 62), ...lines.slice(6)].join('\n');
  const t = parseLog(twice, 'S4Cas_ProbeTest').tests['S4Cas_ProbeTest.fires'];
  assert.deepEqual([t.flows.length, t.triggers.length, t.rules.length, t.classes.length], [1, 1, 2, 1]);
});

test('a log cut short, or marked by the platform, is partial and never complete', () => {
  const log = sample('trigger-rule-flow.log');
  const cut = log.slice(0, log.indexOf('Validation:SfUiProbe:new'));
  assert.equal(parseLog(cut, 'S4Cas_ProbeTest').tests['S4Cas_ProbeTest.fires'].partial, true, 'no EXECUTION_FINISHED');
  assert.equal(parseLog(`${log}\n*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n`, 'T').truncated, true, 'the size marker');
  assert.equal(parseLog(`${log}\n*** Skipped 4096 bytes of detail ***\n`, 'T').truncated, true, 'the skipped-detail marker');
});

// The log a check-only validate returned for three methods (2026-11-11): one fails its assert, one runs as a persona.
const FAILLOG = sample('validate-fail.log');
const P = 'SfTesterDbgProbeTest';

test('one returned log holds every method, a failing one and a runAs one included, each complete', () => {
  const got = parseLog(FAILLOG, P);
  assert.deepEqual(Object.keys(got.tests).sort(), [`${P}.asPersona`, `${P}.probe`, `${P}.second`]);
  const flow = ['S4Map Item Flow'];
  const trigger = [{ name: 'S4Map_ItemTrigger', object: 'S4Map_Item', event: 'BeforeInsert' }];
  assert.deepEqual(got.tests[`${P}.asPersona`], { triggers: trigger, flows: flow, rules: [{ name: 'S4Map_Qty_Not_Negative', result: 'PASS' }], classes: [], partial: false });
  assert.deepEqual(got.tests[`${P}.probe`].rules, [{ name: 'S4Map_Qty_Not_Negative', result: 'PASS' }, { name: 'S4Map_Qty_Not_Negative', result: 'FAIL' }]);
  assert.equal(got.tests[`${P}.probe`].partial, false, 'a failed assert still ends its execution');
  assert.deepEqual(got.tests[`${P}.second`], { triggers: [], flows: [], rules: [], classes: [], partial: false });
  assert.equal(got.truncated, false);
});

test('a log with CRLF line ends reads the same as one with LF', () => {
  assert.deepEqual(parseLog(FAILLOG.replaceAll('\n', '\r\n'), P).tests, parseLog(FAILLOG, P).tests);
});

test('a log that stops inside a method marks that method partial, keeps the one before, and the one after is missing', () => {
  const cut = FAILLOG.slice(0, FAILLOG.indexOf('VALIDATION_FAIL'));
  const got = parseLog(cut, P);
  assert.deepEqual([got.tests[`${P}.asPersona`].partial, got.tests[`${P}.probe`].partial, got.truncated, got.tests[`${P}.second`]], [false, true, true, undefined]);
});

test('a skipped-detail mark marks only the method it is in, and the methods after it are read', () => {
  const at = FAILLOG.indexOf('\n', FAILLOG.indexOf(`${P}.probe()`));
  const got = parseLog(`${FAILLOG.slice(0, at)}\n*** Skipped 5997715 bytes of detailed log\n${FAILLOG.slice(at + 1)}`, P);
  assert.deepEqual([got.tests[`${P}.asPersona`].partial, got.tests[`${P}.probe`].partial, got.tests[`${P}.second`].partial, got.truncated], [false, true, false, true]);
});

test('a cut that drops one method\'s end and keeps the next one\'s start leaves the next method complete', () => {
  const lines = FAILLOG.split('\n');
  const end = lines.findIndex((l) => l.endsWith(`|CODE_UNIT_FINISHED|${P}.probe()`));
  const got = parseLog([...lines.slice(0, end), '*** Skipped 812 bytes of detailed log', ...lines.slice(end + 2)].join('\n'), P);
  assert.deepEqual([got.tests[`${P}.probe`].partial, got.tests[`${P}.second`].partial], [true, false]);
});

test('events after a skipped-detail mark are nobody\'s: a skip over one method\'s end and the next one\'s start gives the first nothing of the second', () => {
  const lines = FAILLOG.split('\n');
  const trig = lines.findIndex((l) => l.includes('|CODE_UNIT_FINISHED|S4Map_ItemTrigger'));
  const next = lines.findIndex((l) => l.endsWith(`|CODE_UNIT_STARTED|[EXTERNAL]|01pdh00000SgVYh|${P}.probe()`));
  const got = parseLog([...lines.slice(0, trig + 1), '*** Skipped 9000 bytes of detailed log', ...lines.slice(next + 1)].join('\n'), P);
  assert.deepEqual(got.tests[`${P}.asPersona`].rules, [], 'the rules after the mark were the next method\'s');
  assert.deepEqual([got.tests[`${P}.asPersona`].partial, got.tests[`${P}.probe`], got.tests[`${P}.second`].partial], [true, undefined, false]);
});

test('a log at the 1 MiB the validate returns is truncated even when its last method ended', () => {
  const full = `${FAILLOG}${' '.repeat(1048576 - Buffer.byteLength(FAILLOG))}`;
  assert.deepEqual([parseLog(full, P).truncated, parseLog(full.slice(0, -1), P).truncated], [true, false]);
});

// ---- --cascade through verify: one check-only validate over SOAP, its log, and nothing written ----
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const cli = require('../src/cli');
const ranlog = require('../src/cascade-log');

const RULE = 'objects/SfUiProbe__c/validationRules/SfUi_Count_Not_Negative';
const rec = { id: 'count-rule', kind: 'record', requirement: 'r', covers: [RULE], persona: { profile: 'Standard Platform User', permissionSets: ['SfUi_Probe'] }, object: 'SfUiProbe__c',
  cases: [{ name: 'rejects', fields: { Name: 'v', Count__c: -1 }, expect: { saves: false, error: 'Count cannot be negative' } }, { name: 'accepts', fields: { Name: 'v', Count__c: 0 }, expect: { saves: true } }] };
const RESULT = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'verify-samples', 'validate-report.json'), 'utf8')).result).replace('ruleRejectsNegative', 'c0_0').replace('ruleAcceptsZero', 'c0_1').replace('controlMustGoRed', 'c0_2').replace(/VerifyProbeE1Test/g, 'SfTesterVerifyTest'));
// The saved logs as one returned log: c0_0 fires a flow, a trigger and two rules, c0_1 fires nothing.
const LOG = [sample('trigger-rule-flow.log').replaceAll('S4Cas_ProbeTest.fires', 'SfTesterVerifyTest.c0_0'), sample('control.log').replaceAll('S4Cas_ProbeTest.control', 'SfTesterVerifyTest.c0_1')].join('\n').replaceAll('S4Cas_ProbeTest', 'SfTesterVerifyTest');
// A DeployResult as the Metadata API writes it: unprefixed elements, an array a repeated one, XML text escaped.
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toXml = (o) => Object.entries(o).map(([k, v]) => [].concat(v).map((x) => (x === null ? `<${k} xsi:nil="true"/>` : x && typeof x === 'object' ? `<${k}>${toXml(x)}</${k}>` : `<${k}>${esc(x)}</${k}>`)).join('')).join('');
const envelope = (body, log) => `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata">${log == null ? '' : `<soapenv:Header><DebuggingInfo><debugLog>${esc(log)}</debugLog></DebuggingInfo></soapenv:Header>`}<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

function rig(t, { result = RESULT, log = LOG, polls = 1, post, signal, checks = [rec], files = {}, convert, validate } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceApiVersion: '66.0' }));
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify({ checks }));
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
  const sfCalls = [];
  const apiCalls = [];
  const posts = [];
  const zipped = [];
  // The convert writes the payload's classes and a package.xml, as sf does in metadata format.
  const sf = async (args, { cwd }) => {
    sfCalls.push(args.join(' '));
    if (args[1] === 'convert') {
      if (convert) return convert();
      const out = path.join(cwd, args[args.indexOf('--output-dir') + 1]);
      fs.mkdirSync(path.join(out, 'classes'), { recursive: true });
      fs.writeFileSync(path.join(out, 'package.xml'), '<Package/>');
      for (const f of fs.readdirSync(path.join(cwd, 'force-app/main/default/classes'))) fs.copyFileSync(path.join(cwd, 'force-app/main/default/classes', f), path.join(out, 'classes', f.replace('.cls-meta.xml', '.cls-meta.xml')));
      return JSON.stringify({ status: 0, result: {} });
    }
    if (args[2] === 'validate' && validate) return validate();
    throw new Error(`unexpected sf ${args.join(' ')}`);
  };
  let n = 0;
  const soap = post || (async (s, body, o = {}) => {
    posts.push({ op: /<met:(\w+)>/.exec(body)[1], debug: !!o.debug, body });
    if (body.startsWith('<met:deploy>')) { zipped.push(Buffer.from(/<met:ZipFile>([^<]*)/.exec(body)[1], 'base64')); return envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>'); }
    if (++n < polls) return envelope('<checkDeployStatusResponse><result><done>false</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
    return envelope(`<checkDeployStatusResponse><result>${toXml({ ...result, done: 'true' })}</result></checkDeployStatusResponse>`, log);
  });
  const api = { PINNED_VERSION: '60.0', async call(s, p, { method = 'GET' } = {}) { apiCalls.push(`${method} ${decodeURIComponent(p)}`); throw new Error(`unexpected api ${p}`); } };
  const out = [];
  const slept = [];
  const go = async (argv = ['verify', '--org', 'o', '--checks', path.join(dir, 'checks.json'), '--cascade']) => ({ code: await cli.main(argv, { log: (l) => out.push(l), warn: (l) => out.push(l), api, sf, git: (args) => (args.includes('--name-only') ? Object.keys(files).join('\n') : ''), connect: async () => ({ production: false, orgApiVersion: '68.0', username: 'u@x' }), soap, signal, sleep: async (ms) => { slept.push(ms); } }), out });
  return { go, sfCalls, apiCalls, posts, zipped, slept, checks: path.join(dir, 'checks.json') };
}

test('--cascade is one check-only validate over SOAP, debug header on the deploy only, and prints what ran under each result', async (t) => {
  const r = rig(t);
  const got = await r.go();
  assert.equal(got.code, 0, got.out.join('\n'));
  // Nothing deploys and nothing is written: no sf deploy, no test run, no API call at all.
  assert.deepEqual(r.sfCalls, ['project convert source --source-dir force-app --output-dir mdapi --json']);
  assert.deepEqual(r.apiCalls, []);
  assert.deepEqual(r.posts.map((p) => [p.op, p.debug]), [['deploy', true], ['checkDeployStatus', false], ['checkDeployStatus', false]]);
  // Only the call after done asks for the details.
  assert.deepEqual(r.posts.slice(1).map((p) => /<met:includeDetails>(\w+)/.exec(p.body)[1]), ['false', 'true']);
  const deploy = r.posts[0].body;
  assert.match(deploy, /<met:checkOnly>true<\/met:checkOnly>/);
  assert.match(deploy, /<met:runTests>SfTesterVerifyTest<\/met:runTests><met:testLevel>RunSpecifiedTests<\/met:testLevel>/);
  const i = got.out.findIndex((l) => l === 'PASS count-rule rejects');
  assert.equal(got.out[i + 1], '  RAN flow S4Cas Probe Flow; trigger S4Cas_ProbeTrigger (SfUiProbe BeforeInsert); rule SfUi_Count_Not_Negative FAIL; rule SfUi_Due_Not_Before_2000 PASS; class S4Cas_Tally');
  assert.equal(got.out[i + 2], 'PASS count-rule accepts');
  assert.equal(got.out[i + 3], '  RAN no trigger, flow, rule or class ran');
});

test('the zip sent holds the converted payload, readable by a zip reader', async (t) => {
  const r = rig(t);
  await r.go();
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), 'p.zip');
  fs.writeFileSync(f, r.zipped[0]);
  let names;
  try { names = execFileSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist()))', f], { encoding: 'utf8' }); } catch (e) { if (e.code === 'ENOENT') return t.skip('no python3 to read the zip'); throw e; }
  assert.equal(names.trim(), "['classes/SfTesterVerifyTest.cls', 'classes/SfTesterVerifyTest.cls-meta.xml', 'package.xml']");
});

test('an error the zip writer raises rejects the zip, never crashes the run', async (t) => {
  const { yazl } = require('playwright-core/lib/zipBundle');
  t.mock.method(yazl.ZipFile.prototype, 'end', function end() { setImmediate(() => this.emit('error', new Error('zip broke'))); });
  await assert.rejects(ranlog.zip({ a: Buffer.from('x') }), { message: 'zip broke' });
});

test('an error the zip writer raises inside end() itself is heard too', async (t) => {
  const { yazl } = require('playwright-core/lib/zipBundle');
  t.mock.method(yazl.ZipFile.prototype, 'end', function end() { this.emit('error', new Error('zip broke at once')); });
  await assert.rejects(ranlog.zip({ a: Buffer.from('x') }), { message: 'zip broke at once' });
});

test('SOAP XML reads as objects: a repeated element is an array, a nil one is null, an empty one is empty text, entities are decoded', () => {
  const o = ranlog.xmlObj('<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><r><a>1</a><a>2</a><n xsi:nil="true"/><e></e><t>&lt;b&gt; &amp; c</t></r></soapenv:Body></soapenv:Envelope>');
  assert.deepEqual(o.Envelope.Body.r, { a: ['1', '2'], n: null, e: '', t: '<b> & c' });
  // An element named like an Object property is a plain value, not an array.
  assert.deepEqual(ranlog.xmlObj('<r><constructor>x</constructor><toString>y</toString></r>').r, { constructor: 'x', toString: 'y' });
  // A nil lineNumber falls through to the (line:col) of the problem text.
  assert.equal(Number(o.Envelope.Body.r.n ?? '40'), 40);
});

test('a real checkDeployStatus answer reads into the fields the verdicts use, named as in sf\'s report', () => {
  // Saved off sfui-s4-cascade on 2026-11-11: a check-only validate of three passing test methods.
  const r = ranlog.xmlObj(sample('check-deploy-status.xml')).Envelope.Body.checkDeployStatusResponse.result;
  assert.deepEqual([r.status, r.done, r.checkOnly, r.id], ['Succeeded', 'true', 'true', '0AfQL00000trsfJ0AQ']);
  const ran = r.details.runTestResult;
  assert.deepEqual(ran.successes.map((x) => x.methodName), ['a_first', 'b_big', 'c_after']);
  assert.deepEqual([ran.failures, r.details.componentFailures, ran.successes[0].namespace], [undefined, undefined, null]);
});

test('the poll waits between status calls, never before the first, until the result is done', async (t) => {
  const r = rig(t, { polls: 3 });
  await r.go();
  assert.deepEqual([r.posts.filter((p) => p.op === 'checkDeployStatus').length, r.slept], [4, [2000, 2000]]);
});

// Through verify's --cascade route, so a polls that soapReport passes itself, or a test level validate does not
// take from VALIDATE, goes red here.
test('--cascade takes its test level and time limit from VALIDATE', async (t) => {
  const was = { ...ranlog.VALIDATE };
  t.after(() => Object.assign(ranlog.VALIDATE, was));
  Object.assign(ranlog.VALIDATE, { testLevel: 'RunLocalTests', minutes: 1 });
  const bodies = [];
  const r = rig(t, { post: async (s, body) => {
    bodies.push(body);
    if (body.startsWith('<met:deploy>')) return envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>');
    if (body.startsWith('<met:cancelDeploy>')) return envelope('<cancelDeployResponse><result><done>false</done><id>0AfCASCADE</id></result></cancelDeployResponse>');
    return envelope('<checkDeployStatusResponse><result><done>false</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
  } });
  const got = await r.go();
  assert.ok(got.out.some((l) => l.includes('did not finish in 60 s')), got.out.join('\n'));
  assert.match(bodies[0], /<met:testLevel>RunLocalTests</);
});

test('a network fault on a status poll is tried again, and three in a row end the run', async (t) => {
  const { SfUiError } = require('../src/errors');
  const flaky = (fails) => {
    let left = fails;
    return async (s, body) => {
      if (body.startsWith('<met:deploy>')) return envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>');
      if (left-- > 0) throw new SfUiError('API_ERROR', 'POST /services/Soap/m/68.0: fetch failed (ECONNRESET)');
      return envelope(`<checkDeployStatusResponse><result>${toXml({ ...RESULT, done: 'true' })}</result></checkDeployStatusResponse>`, LOG);
    };
  };
  const two = rig(t, { post: flaky(2) });
  const got = await two.go();
  assert.equal(got.code, 0, got.out.join('\n'));
  assert.deepEqual(two.slept, [2000, 2000]);
  const three = await rig(t, { post: flaky(3) }).go();
  assert.ok(three.out.some((l) => l.startsWith('ERROR count-rule rejects validate did not answer: API_ERROR') && l.includes('ECONNRESET')), three.out.join('\n'));
});

test('a 502, 503 or 504 on a status poll is tried again like a network fault; a 500 is not', async (t) => {
  const answers = [];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(/<met:(\w+)>/.exec(init.body.split('<soapenv:Body>')[1])[1]);
    const [status, body] = answers.shift();
    return { ok: status === 200, status, text: async () => body };
  });
  const s = { instanceUrl: 'https://x', orgApiVersion: '68.0', accessToken: '00Dx!token' };
  const go = () => ranlog.validate({ s, files: { 'package.xml': Buffer.from('<Package/>') }, tests: ['T'], sleep: async () => {} });
  const deployed = [200, envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>')];
  const done = [200, envelope(`<checkDeployStatusResponse><result>${toXml({ ...RESULT, done: 'true' })}</result></checkDeployStatusResponse>`, LOG)];
  answers.push(deployed, [502, 'Bad Gateway'], [503, 'Service Unavailable'], done, done);
  assert.equal((await go()).done, 'true');
  assert.deepEqual(calls, ['deploy', 'checkDeployStatus', 'checkDeployStatus', 'checkDeployStatus', 'checkDeployStatus']);
  calls.length = 0;
  answers.push(deployed, [504, 'Gateway Timeout'], done, done);
  assert.equal((await go()).done, 'true');
  calls.length = 0;
  answers.push(deployed, [500, '<faultstring>UNKNOWN_EXCEPTION</faultstring>'], [200, envelope('<cancelDeployResponse/>')]);
  await assert.rejects(go(), { message: 'SOAP 500: UNKNOWN_EXCEPTION; validate 0AfCASCADE cancelled' });
  assert.deepEqual(calls, ['deploy', 'checkDeployStatus', 'cancelDeploy'], 'control: a 500 is final');
});

// The SOAP validate alone: a post that answers the deploy, then status calls as told; it records every operation.
const soapStub = (status, ops = [], seen = {}) => async (s, body, o = {}) => {
  const op = /<met:(\w+)>/.exec(body)[1];
  ops.push(op);
  seen[op] = o;
  if (op === 'deploy') return envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>');
  if (op === 'cancelDeploy') return envelope('<cancelDeployResponse><result><done>false</done><id>0AfCASCADE</id></result></cancelDeployResponse>');
  return status(o);
};
const NOT_DONE = () => envelope('<checkDeployStatusResponse><result><done>false</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
const run = (post, extra = {}) => ranlog.validate({ s: {}, files: { 'package.xml': Buffer.from('<Package/>') }, tests: ['T'], post, sleep: async () => {}, ...extra });

test('a validate that never finishes is cancelled at the limit, and the error says so', async () => {
  const ops = [];
  await assert.rejects(run(soapStub(NOT_DONE, ops), { polls: 2 }), { message: '0AfCASCADE did not finish in 4 s; validate 0AfCASCADE cancelled' });
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'checkDeployStatus', 'cancelDeploy']);
});

// A fake clock: the details read after done may use the time left of the limit, at most 290 s a try, never less than 30 s.
test('the details read after done gets the time left of the limit, at least 30 s', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const timeout = AbortSignal.timeout;
  const ms = [];
  t.mock.method(AbortSignal, 'timeout', (x) => { ms.push(x); return timeout.call(AbortSignal, x); });
  const read = async (advance) => {
    let details;
    const done = () => envelope('<checkDeployStatusResponse><result><done>true</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
    await run(async (s, body, o) => {
      if (body.includes('<met:includeDetails>true')) details = ms.at(-1);
      else if (body.includes('checkDeployStatus')) now += advance;
      return soapStub(done)(s, body, o);
    }, { polls: 900 });
    return details;
  };
  assert.equal(await read(0), 290_000, '30 min left: one try gets 290 s');
  now = 0;
  assert.equal(await read(1_700_000), 100_000, '100 s left');
  now = 0;
  assert.equal(await read(1_800_000), 30_000, 'seen done at the limit: 30 s');
});

// A fake clock: each details attempt hangs for its whole allowance and fails as a network fault, so it is tried again.
test('the details retries share one deadline, and no attempt is given more than 290 s', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const timeout = AbortSignal.timeout;
  const ms = [];
  t.mock.method(AbortSignal, 'timeout', (x) => { ms.push(x); return timeout.call(AbortSignal, x); });
  for (const doneAt of [120_000, 1_700_000, 1_800_000]) {
    now = 0;
    const given = [];
    const done = () => envelope('<checkDeployStatusResponse><result><done>true</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
    await assert.rejects(run(async (s, body, o) => {
      if (body.includes('<met:includeDetails>true')) { given.push(ms.at(-1)); now += ms.at(-1); throw Object.assign(new Error('fetch failed'), { code: 'API_ERROR' }); }
      if (body.includes('checkDeployStatus')) now = doneAt;
      return soapStub(done)(s, body, o);
    }, { polls: 900 }), { message: 'fetch failed' });
    const deadline = doneAt + Math.max(30_000, 1_800_000 - doneAt);
    assert.ok(given.every((x) => x <= 290_000), `done at ${doneAt}: ${given}`);
    assert.ok(now <= deadline, `done at ${doneAt}: the attempts ${given} end at ${now}, past ${deadline}`);
  }
});

// A fake clock: each details try in faults fails as a network fault after that many ms, and the next one answers.
test('a details retry starts with 5 s or more left, ends by the deadline, and under 5 s the real fault stands', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const timeout = AbortSignal.timeout;
  const ms = [];
  t.mock.method(AbortSignal, 'timeout', (x) => { ms.push(x); return timeout.call(AbortSignal, x); });
  const done = () => envelope('<checkDeployStatusResponse><result><done>true</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
  const read = async (doneAt, faults) => {
    now = 0;
    const given = [];
    const out = await run(async (s, body, o) => {
      if (body.includes('<met:includeDetails>true')) {
        given.push(ms.at(-1));
        if (given.length <= faults.length) { now += faults[given.length - 1]; throw Object.assign(new Error('fetch failed'), { code: 'API_ERROR' }); }
      } else if (body.includes('checkDeployStatus')) now = doneAt;
      return soapStub(done)(s, body, o);
    }, { polls: 900, sleep: async (x) => { now += x; } }).then(() => 'resolved', (e) => e.message);
    assert.ok(now <= doneAt + Math.max(30_000, 1_800_000 - doneAt), `done at ${doneAt}: tries ${given} end at ${now}, past the deadline`);
    return [out, given];
  };
  assert.deepEqual(await read(1_800_000, [1_000]), ['resolved', [30_000, 27_000]], 'done at the limit: one fast fault, then 27 s left, is retried');
  assert.deepEqual(await read(1_800_000, [1_000, 1_000]), ['resolved', [30_000, 27_000, 24_000]], 'and a second fast fault too');
  assert.deepEqual(await read(1_780_000, [24_000]), ['fetch failed', [30_000]], 'under 5 s left: the fault that ended the tries, not an abort');
});

// A fake clock: each status attempt takes 59 s and answers 504, so the second ends past the 60 s limit.
test('a status retry does not start past the time limit', async (t) => {
  const was = { ...ranlog.VALIDATE };
  t.after(() => Object.assign(ranlog.VALIDATE, was));
  ranlog.VALIDATE.minutes = 1;
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const ops = [];
  const slow504 = () => { now += 59_000; throw Object.assign(new Error('SOAP 504: Gateway Timeout'), { status: 504 }); };
  await assert.rejects(run(soapStub(slow504, ops)), { message: 'SOAP 504: Gateway Timeout; validate 0AfCASCADE cancelled' });
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'checkDeployStatus', 'cancelDeploy']);
});

// The poll count and the poll sleep are one interval: together they fill VALIDATE.minutes exactly.
test('the default poll count times the poll sleep is the time limit', async (t) => {
  const was = { ...ranlog.VALIDATE };
  t.after(() => Object.assign(ranlog.VALIDATE, was));
  ranlog.VALIDATE.minutes = 1;
  const slept = [];
  await assert.rejects(run(soapStub(NOT_DONE), { sleep: async (ms) => { slept.push(ms); } }), /did not finish in 60 s/);
  assert.equal((slept.length + 1) * slept[0], 60_000);
});

test('Ctrl-C during the poll cancels the org\'s validate; a cancel that fails is named, never swallowed', async () => {
  const ac = new AbortController();
  const ops = [];
  const status = (o) => { if (o.signal?.aborted) throw new Error('This operation was aborted'); ac.abort(); return NOT_DONE(); };
  await assert.rejects(run(soapStub(status, ops), { signal: ac.signal }), { message: 'This operation was aborted; validate 0AfCASCADE cancelled' });
  assert.equal(ops.at(-1), 'cancelDeploy');
  const ac2 = new AbortController();
  const failing = async (s, body, o = {}) => { if (body.startsWith('<met:cancelDeploy>')) throw new Error('SOAP 500: INVALID_ID_FIELD'); return soapStub((x) => { if (x.signal?.aborted) throw new Error('aborted'); ac2.abort(); return NOT_DONE(); })(s, body, o); };
  await assert.rejects(run(failing, { signal: ac2.signal }), { message: 'aborted; validate 0AfCASCADE not cancelled: SOAP 500: INVALID_ID_FIELD' });
});

// replay.js's esc: numeric references, and the control characters XML 1.0 cannot carry are dropped.
test('the session id and the test names are escaped in the SOAP XML', async (t) => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent = init.body; return { ok: true, text: async () => '<x/>' }; });
  await ranlog.soapPost({ instanceUrl: 'https://x', orgApiVersion: '68.0', accessToken: 'a&b<c' }, '<met:x/>');
  assert.match(sent, /<met:sessionId>a&#38;b&#60;c<\/met:sessionId>/);
  const bodies = [];
  await assert.rejects(run(async (s, body) => { bodies.push(body); return envelope('<deployResponse><result/></deployResponse>'); }, { tests: ['A&B\x01'] }));
  assert.match(bodies[0], /<met:runTests>A&#38;B<\/met:runTests>/);
});

test('a SOAP fault on a poll is final and cancels the validate, with the cancel under its own time limit', async () => {
  const ops = [];
  const seen = {};
  await assert.rejects(run(soapStub(() => { throw new Error('SOAP 500: INVALID_SESSION_ID'); }, ops, seen)), { message: 'SOAP 500: INVALID_SESSION_ID; validate 0AfCASCADE cancelled' });
  assert.deepEqual(ops, ['deploy', 'checkDeployStatus', 'cancelDeploy'], 'no retry of a fault that is not API_ERROR');
  assert.ok(seen.cancelDeploy.signal instanceof AbortSignal && !seen.cancelDeploy.signal.aborted);
});

test('a stop after the validate is done never cancels it', async () => {
  const ac = new AbortController();
  const ops = [];
  // The first poll says done; Ctrl-C lands during the call that fetches the details.
  const status = () => {
    if (ops.filter((x) => x === 'checkDeployStatus').length === 1) return envelope('<checkDeployStatusResponse><result><done>true</done><id>0AfCASCADE</id></result></checkDeployStatusResponse>');
    ac.abort();
    throw new Error('aborted');
  };
  await assert.rejects(run(soapStub(status, ops), { signal: ac.signal }), { message: 'aborted' });
  assert.ok(!ops.includes('cancelDeploy'), ops.join(' '));
});

test('the time limit counts elapsed time as well as polls', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => (now += 60000));
  const ops = [];
  await assert.rejects(run(soapStub(NOT_DONE, ops)), { message: '0AfCASCADE did not finish in 1800 s; validate 0AfCASCADE cancelled' });
  assert.ok(ops.filter((x) => x === 'checkDeployStatus').length < 40, `${ops.length} calls`);
});

test('a deploy that answers with no id is an error before any poll', async () => {
  const ops = [];
  await assert.rejects(run(async (s, body) => { ops.push(/<met:(\w+)>/.exec(body)[1]); return envelope('<deployResponse><result><done>false</done></result></deployResponse>'); }), { message: 'deploy answered with no id' });
  assert.deepEqual(ops, ['deploy']);
});

test('--cascade runs on a sandbox too: no org list, no scratch refusal', async (t) => {
  const r = rig(t);
  const got = await r.go(['verify', '--org', 'some-sandbox', '--checks', r.checks, '--cascade']);
  assert.equal(got.code, 0, got.out.join('\n'));
  assert.ok(!r.sfCalls.some((c) => c.startsWith('org ')), r.sfCalls.join('\n'));
  assert.ok(got.out.some((l) => l.startsWith('  RAN flow S4Cas Probe Flow')), got.out.join('\n'));
});

test('a failing check still prints what ran: the tests run once, and the log comes back with the failure', async (t) => {
  const failing = JSON.parse(JSON.stringify(RESULT));
  failing.details.runTestResult.failures = [{ methodName: 'c0_0', message: 'System.AssertException: Assertion Failed: expected the save to fail' }];
  failing.details.runTestResult.successes = failing.details.runTestResult.successes.filter((x) => x.methodName !== 'c0_0');
  const got = await rig(t, { result: failing }).go();
  const i = got.out.findIndex((l) => l.startsWith('FAIL count-rule rejects'));
  assert.ok(i >= 0 && got.out[i + 1].startsWith('  RAN flow S4Cas Probe Flow'), got.out.join('\n'));
});

test('a nil failure message or compile problem prints empty, never the word null', async (t) => {
  const failing = JSON.parse(JSON.stringify(RESULT));
  failing.details.runTestResult.failures = [{ methodName: 'c0_0', message: null }];
  failing.details.runTestResult.successes = failing.details.runTestResult.successes.filter((x) => x.methodName !== 'c0_0');
  const got = await rig(t, { result: failing }).go();
  assert.ok(got.out.some((l) => l.startsWith('FAIL count-rule rejects')) && !got.out.some((l) => /\bnull\b/.test(l)), got.out.join('\n'));
  const broken = { id: '0AfCASCADE', status: 'Failed', details: { componentFailures: { componentType: 'ApexClass', fileName: 'classes/X.cls', fullName: 'X', problem: null } } };
  const g2 = await rig(t, { result: broken, log: null }).go();
  assert.ok(g2.out.some((l) => l.startsWith('ERROR count-rule rejects X: ')) && !g2.out.some((l) => /\bnull\b/.test(l)), g2.out.join('\n'));
});

test('a validate that ran the tests and returned no log is the cascade\'s own error', async (t) => {
  const got = await rig(t, { log: null }).go();
  assert.ok(got.out.includes('ERROR cascade run the validate ran the tests and returned no debug log of them'), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.startsWith('  RAN')), 'no RAN line without a log');
  assert.equal(got.out.at(-1), 'changed 0, covered 0, uncovered 0, ran 2, passed 2, failed 0, errors 1');
});

test('an empty log while the tests ran is the cascade\'s own error, not a NO LOG under each case', async (t) => {
  const got = await rig(t, { log: '' }).go();
  assert.ok(got.out.includes('ERROR cascade run the validate ran the tests and returned no debug log of them'), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.startsWith('  RAN')), got.out.join('\n'));
});

test('a coverage failure ran its tests: a cut log says so under each case, and no log is the cascade\'s error', async (t) => {
  const covered = { ...JSON.parse(JSON.stringify(RESULT)), status: 'Failed' };
  covered.details.runTestResult.failures = [];
  covered.details.runTestResult.codeCoverageWarnings = { message: 'Test coverage of selected Apex Class is 4.762%' };
  const cut = await rig(t, { result: covered, log: 'x'.repeat(1048576) }).go();
  assert.equal(cut.out.filter((l) => l === '  RAN NO LOG for this method: the log was cut before it').length, 2, cut.out.join('\n'));
  const none = await rig(t, { result: covered, log: null }).go();
  assert.ok(none.out.includes('ERROR cascade run the validate ran the tests and returned no debug log of them'), none.out.join('\n'));
});

test('a compile failure that still returns a log prints no RAN line under its errors', async (t) => {
  const broken = { id: '0AfCASCADE', status: 'Failed', details: { componentFailures: { componentType: 'ApexClass', fileName: 'classes/SfTesterVerifyTest.cls', fullName: 'SfTesterVerifyTest', problem: 'Variable does not exist: nope (40:9)', lineNumber: 40 } } };
  const got = await rig(t, { result: broken, log: '66.0 APEX_CODE,FINE;VALIDATION,INFO;WORKFLOW,FINER\n' }).go();
  assert.ok(got.out.some((l) => l.startsWith('ERROR count-rule rejects')), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.startsWith('  RAN') || l.startsWith('ERROR cascade')), got.out.join('\n'));
  // The same with a cut log from the carried tests: no case ran, so none says its log was cut.
  const cut = await rig(t, { result: broken, log: 'x'.repeat(1048576) }).go();
  assert.ok(!cut.out.some((l) => l.startsWith('  RAN')), cut.out.join('\n'));
});

test('a validate that never runs its tests is each case\'s error, and no cascade row is added', async (t) => {
  const got = await rig(t, { post: async () => { throw new Error('SOAP 500: INVALID_SESSION_ID'); } }).go();
  assert.ok(got.out.includes('ERROR count-rule rejects validate did not answer: SOAP 500: INVALID_SESSION_ID (requirement: r)'), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.startsWith('ERROR cascade')), got.out.join('\n'));
});

test('a convert that fails is named a convert failure, never the validate', async (t) => {
  const r = rig(t, { convert: () => JSON.stringify({ status: 1, name: 'SfError', message: 'no such metadata type' }) });
  const got = await r.go();
  assert.ok(got.out.includes('ERROR count-rule rejects convert failed: SfError no such metadata type (requirement: r)'), got.out.join('\n'));
  assert.deepEqual(r.posts, [], 'nothing is sent to the org');
});

test('Ctrl-C during the convert is a stop, never a convert failure', async (t) => {
  const ac = new AbortController();
  const r = rig(t, { signal: ac.signal, convert: () => { ac.abort(); throw new Error('The operation was aborted'); } });
  const got = await r.go();
  assert.ok(got.out.some((l) => l.startsWith('ERROR count-rule rejects The operation was aborted')), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.includes('convert failed')), got.out.join('\n'));
});

test('Ctrl-C or a code bug in the validate keeps its own message, on both routes; a fault is still "did not answer"', async (t) => {
  const plain = (argv) => argv.filter((x) => x !== '--cascade');
  for (const [route, key, args] of [['soap', 'post', undefined], ['sf', 'validate', plain]]) {
    const ac = new AbortController();
    const r = rig(t, { signal: ac.signal, [key]: async () => { ac.abort(); throw new Error('The operation was aborted'); } });
    const stop = await r.go(args && args(['verify', '--org', 'o', '--checks', r.checks, '--cascade']));
    assert.ok(stop.out.some((l) => l.startsWith('ERROR count-rule rejects The operation was aborted')), `${route}\n${stop.out.join('\n')}`);
    const b = rig(t, { [key]: async () => { throw new TypeError('x is not a function'); } });
    const bug = await b.go(args && args(['verify', '--org', 'o', '--checks', b.checks, '--cascade']));
    assert.ok(bug.out.some((l) => l.startsWith('ERROR count-rule rejects x is not a function')), `${route}\n${bug.out.join('\n')}`);
    const f = rig(t, { [key]: async () => { throw new Error('SOAP 500: INVALID_SESSION_ID'); } });
    const fault = await f.go(args && args(['verify', '--org', 'o', '--checks', f.checks, '--cascade']));
    assert.ok(fault.out.some((l) => l.startsWith('ERROR count-rule rejects validate did not answer: SOAP 500')), `${route} control\n${fault.out.join('\n')}`);
  }
});

test('a code bug on a status poll, after the org gave a deploy id, keeps its own message; a fault there is still "did not answer"', async (t) => {
  const poll = (err) => rig(t, { post: async (s, body) => {
    if (body.startsWith('<met:deploy>')) return envelope('<deployResponse><result><done>false</done><id>0AfCASCADE</id></result></deployResponse>');
    if (body.startsWith('<met:checkDeployStatus>')) throw err;
    return envelope('<cancelDeployResponse><result><done>true</done></result></cancelDeployResponse>');
  } }).go();
  const bug = await poll(new TypeError('x is not a function'));
  assert.ok(bug.out.some((l) => l.startsWith('ERROR count-rule rejects x is not a function; validate 0AfCASCADE cancelled')), bug.out.join('\n'));
  for (const err of [new ReferenceError('y is not defined')]) assert.ok((await poll(err)).out.some((l) => l.startsWith('ERROR count-rule rejects y is not defined;')), err.message);
  const fault = await poll(new Error('SOAP 500: INVALID_SESSION_ID'));
  assert.ok(fault.out.some((l) => l.startsWith('ERROR count-rule rejects validate did not answer: SOAP 500: INVALID_SESSION_ID; validate 0AfCASCADE cancelled')), `control\n${fault.out.join('\n')}`);
});

test('a SOAP fault names its faultstring and never the session token', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, text: async () => '<soapenv:Fault><faultcode>sf:INVALID_SESSION_ID</faultcode><faultstring>bad TOKEN123 &amp; more</faultstring></soapenv:Fault>' }));
  await assert.rejects(ranlog.soapPost({ instanceUrl: 'https://x', orgApiVersion: '68.0', accessToken: 'TOKEN123' }, '<met:x/>'), { message: 'SOAP 500: bad <token> & more' });
});

test('a SOAP post takes the run\'s signal and the org\'s API version', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen = [url, init.signal]; return { ok: true, text: async () => '<x/>' }; });
  const sig = new AbortController().signal;
  await ranlog.soapPost({ instanceUrl: 'https://x', orgApiVersion: '68.0', apiVersion: '60.0', accessToken: 't' }, '<met:x/>', { signal: sig });
  assert.deepEqual(seen, ['https://x/services/Soap/m/68.0', sig]);
});

test('a cut log prints PARTIAL, and a method the cut log does not hold says the log was cut', async (t) => {
  const cut = LOG.slice(0, LOG.indexOf('Validation:SfUiProbe:new'));
  const got = await rig(t, { log: cut }).go();
  assert.ok(got.out.some((l) => l.startsWith('  RAN flow S4Cas Probe Flow') && l.endsWith('(PARTIAL: the log was cut, more may have run)')), got.out.join('\n'));
  assert.ok(got.out.includes('  RAN NO LOG for this method: the log was cut before it'), got.out.join('\n'));
  const whole = await rig(t, { log: sample('trigger-rule-flow.log').replaceAll('S4Cas_ProbeTest.fires', 'SfTesterVerifyTest.c0_0').replaceAll('S4Cas_ProbeTest', 'SfTesterVerifyTest') }).go();
  assert.ok(whole.out.includes('  RAN NO LOG for this method'), whole.out.join('\n'));
});

test('a log cut before a case names the carried tests that share its 1 MiB', async (t) => {
  const D = 'force-app/main/default/';
  const apex = { id: 'save', kind: 'apex', requirement: 'r', covers: ['classes/C'], persona: { profile: 'System Administrator', permissionSets: [] }, act: 'return C.go() != null;',
    cases: [{ name: 'ok', expect: { returns: true } }, { name: 'bad', expect: { throws: 'x' } }] };
  const files = {
    [`${D}classes/C.cls`]: 'public class C { @AuraEnabled public static Id go() { return null; } }',
    [`${D}classes/C.cls-meta.xml`]: '<x/>',
    [`${D}classes/CTest.cls`]: '@IsTest private class CTest { @IsTest static void t() { C.go(); } }',
    [`${D}classes/CTest.cls-meta.xml`]: '<x/>' };
  const r = rig(t, { checks: [apex], files, log: LOG.slice(0, LOG.indexOf('Validation:SfUiProbe:new')) });
  const got = await r.go(['verify', '--org', 'o', '--checks', r.checks, '--cascade', '--since', 'main']);
  assert.ok(got.out.includes('  RAN NO LOG for this method: the log was cut before it (the carried tests CTest share its 1 MiB)'), got.out.join('\n'));
  // The carried tests filled the whole log before any case started: each case still says so, and no cascade error is added.
  const full = rig(t, { checks: [apex], files, log: `${'x'.repeat(1048576)}` });
  const g2 = await full.go(['verify', '--org', 'o', '--checks', full.checks, '--cascade', '--since', 'main']);
  assert.equal(g2.out.filter((l) => l === '  RAN NO LOG for this method: the log was cut before it (the carried tests CTest share its 1 MiB)').length, 2, g2.out.join('\n'));
  assert.ok(!g2.out.some((l) => l.startsWith('ERROR cascade')), g2.out.join('\n'));
});

test('--cascade cannot go with --plan or --matrix', async (t) => {
  const r = rig(t);
  const file = r.checks;
  const got = await r.go(['verify', '--org', 'o', '--checks', file, '--cascade', '--plan']);
  assert.equal(got.code, 2);
  assert.match(got.out[0], /cannot go with --plan or --matrix/);
  assert.equal((await r.go(['verify', '--org', 'o', '--checks', file, '--cascade', '--matrix'])).code, 2);
});

test('a runner result naming no check of its group still throws; only the cascade\'s own rows are exempt', async (t) => {
  const verify = require('../src/verify');
  const r = rig(t);
  const real = verify.RUNNERS.record;
  verify.RUNNERS.record = async () => [{ check: 'nope', name: 'x', status: 'pass' }];
  t.after(() => { verify.RUNNERS.record = real; });
  await assert.rejects(r.go(), TypeError);
});

test('replay refuses --cascade, which only verify takes', async () => {
  const out = [];
  assert.equal(await cli.main(['replay', '--org', 'o', '--cascade'], { log: (l) => out.push(l), warn: (l) => out.push(l) }), 2);
  assert.match(out[0], /^--cascade is a verify option/);
});

// ---- the diff with the static map ----
const { diff } = require('../src/cascade-log');
const T = (x) => ({ triggers: [], flows: [], rules: [], classes: [], ...x });

test('the diff names what the map said could run and did not, and what ran that the map never named', () => {
  const mapped = ['objects/S4Map_Item__c/validationRules/S4Map_Qty_Not_Negative', 'triggers/S4Map_ItemTrigger', 'flows/S4Map_Item_Flow', 'triggers/S4Map_Other'];
  const ran = [T({ flows: ['S4Map Item Flow'], triggers: [{ name: 'S4Map_ItemTrigger', object: 'X', event: 'BeforeInsert' }], rules: [{ name: 'S4Map_Qty_Not_Negative', result: 'PASS' }, { name: 'SfUi_Count_Not_Negative', result: 'PASS' }] })];
  assert.deepEqual(diff(mapped, ran), { didNot: ['triggers/S4Map_Other'], unmapped: ['rule SfUi_Count_Not_Negative'] });
});

test('the diff reads across cases: a flow that ran in either case counts, and nothing mapped and nothing ran is empty', () => {
  assert.deepEqual(diff(['flows/A_Flow'], [T(), T({ flows: ['A Flow'] })]), { didNot: [], unmapped: [] });
  assert.deepEqual(diff([], [T()]), { didNot: [], unmapped: [] });
  assert.deepEqual(diff(['flows/A_Flow'], [T()]).didNot, ['flows/A_Flow']);
});

test('two mapped flows that share a label are each named when neither ran', () => {
  const labels = new Map([['flows/Acct_Update_A', 'Account Update'], ['flows/Acct_Update_B', 'Account Update']]);
  assert.deepEqual(diff(['flows/Acct_Update_A', 'flows/Acct_Update_B'], [T()], labels).didNot, ['flows/Acct_Update_A', 'flows/Acct_Update_B']);
});

test('--cascade with --since prints the diff against the static map, and without it says the map is needed', async (t) => {
  const D = 'force-app/main/default/';
  const apex = { id: 'save', kind: 'apex', requirement: 'r', covers: ['classes/C'], persona: { profile: 'System Administrator', permissionSets: [] }, act: 'return C.go() != null;',
    cases: [{ name: 'ok', expect: { returns: true } }, { name: 'bad', expect: { throws: 'x' } }] };
  const files = {
    [`${D}classes/C.cls`]: 'public class C { @AuraEnabled public static Id go() { insert new Thing__c(); return null; } }',
    [`${D}classes/C.cls-meta.xml`]: '<x/>',
    [`${D}objects/Thing__c/validationRules/R.validationRule-meta.xml`]: '<ValidationRule><active>true</active></ValidationRule>',
    [`${D}triggers/T.trigger`]: 'trigger T on Thing__c (before insert) { }',
    [`${D}triggers/T.trigger-meta.xml`]: '<ApexTrigger><status>Active</status></ApexTrigger>',
    // The flow the saved log ran, under an API name its label does not spell: it matches by the label the map read.
    [`${D}flows/Thing_Save.flow-meta.xml`]: '<Flow>\n    <apiVersion>66.0</apiVersion>\n    <label>S4Cas Probe Flow</label>\n    <start><object>Thing__c</object><triggerType>RecordBeforeSave</triggerType></start>\n    <status>Active</status>\n</Flow>\n' };
  const r = rig(t, { checks: [apex], files });
  const got = await r.go(['verify', '--org', 'o', '--checks', r.checks, '--cascade', '--since', 'main']);
  const d = got.out.find((l) => l.startsWith('cascade diff:'));
  assert.equal(d, 'cascade diff: the map named 3; could run, did not: objects/Thing__c/validationRules/R, triggers/T; ran, not on the map: trigger S4Cas_ProbeTrigger, rule SfUi_Count_Not_Negative, rule SfUi_Due_Not_Before_2000', got.out.join('\n'));
  const none = rig(t, { checks: [apex], files });
  const g2 = await none.go(['verify', '--org', 'o', '--checks', none.checks, '--cascade']);
  assert.ok(g2.out.includes('cascade diff: needs --since, which builds the static map'), g2.out.join('\n'));
  // No case with a log: the diff says it did not run, never stays silent.
  const failed = rig(t, { checks: [apex], files, post: async () => { throw new Error('boom'); } });
  const g3 = await failed.go(['verify', '--org', 'o', '--checks', failed.checks, '--cascade', '--since', 'main']);
  assert.ok(g3.out.includes("cascade diff: not run, no case has a log to compare with the map's 3"), g3.out.join('\n'));
  // A cut log: what the map named and the log lost is flagged as possibly run.
  const cut = rig(t, { checks: [apex], files, log: LOG.slice(0, LOG.indexOf('Validation:SfUiProbe:new')) });
  const g4 = await cut.go(['verify', '--org', 'o', '--checks', cut.checks, '--cascade', '--since', 'main']);
  assert.match(g4.out.find((l) => l.startsWith('cascade diff:')), /could run, did not: [^;]+ \(a log was cut, so what it lost may have run\);/, g4.out.join('\n'));
  // A cut between cases leaves every logged case complete, and still flags the diff.
  const between = rig(t, { checks: [apex], files, log: `${LOG.split('SfTesterVerifyTest.c0_1()')[0].split('\n').slice(0, -1).join('\n')}\n*** Skipped 812 bytes of detailed log\n` });
  const g5 = await between.go(['verify', '--org', 'o', '--checks', between.checks, '--cascade', '--since', 'main']);
  assert.ok(!g5.out.some((l) => l.includes('(PARTIAL')), g5.out.join('\n'));
  assert.match(g5.out.find((l) => l.startsWith('cascade diff:')), /\(a log was cut, so what it lost may have run\);/, g5.out.join('\n'));
});

test('under --only the map starts only from what a selected check covers, and says what it left out', async (t) => {
  const D = 'force-app/main/default/';
  const check = (id, cls) => ({ id, kind: 'apex', requirement: 'r', covers: [`classes/${cls}`], persona: { profile: 'System Administrator', permissionSets: [] }, act: `return ${cls}.go() != null;`,
    cases: [{ name: 'ok', expect: { returns: true } }, { name: 'bad', expect: { throws: 'x' } }] });
  const files = {
    [`${D}classes/C.cls`]: 'public class C { @AuraEnabled public static Id go() { insert new Thing__c(); return null; } }',
    [`${D}classes/C.cls-meta.xml`]: '<x/>',
    [`${D}classes/E.cls`]: 'public class E { @AuraEnabled public static Id go() { insert new Other__c(); return null; } }',
    [`${D}classes/E.cls-meta.xml`]: '<x/>',
    [`${D}triggers/T.trigger`]: 'trigger T on Thing__c (before insert) { }',
    [`${D}triggers/T.trigger-meta.xml`]: '<ApexTrigger><status>Active</status></ApexTrigger>',
    [`${D}triggers/U.trigger`]: 'trigger U on Other__c (before insert) { }',
    [`${D}triggers/U.trigger-meta.xml`]: '<ApexTrigger><status>Active</status></ApexTrigger>' };
  const checks = [check('save', 'C'), check('other', 'E')];
  const r = rig(t, { checks, files });
  const got = await r.go(['verify', '--org', 'o', '--checks', r.checks, '--cascade', '--since', 'main', '--only', '^save$']);
  assert.ok(got.out.includes('NOTE cascade --only leaves out what no selected check covers: classes/E'), got.out.join('\n'));
  assert.ok(!got.out.some((l) => l.startsWith('cascade ') && l.includes('triggers/U')), got.out.join('\n'));
  assert.match(got.out.find((l) => l.startsWith('cascade diff:')), /could run, did not: triggers\/T;/);
  // Control: with no --only the map names the other class's trigger too, and no NOTE is printed.
  const all = rig(t, { checks, files });
  const g2 = await all.go(['verify', '--org', 'o', '--checks', all.checks, '--cascade', '--since', 'main']);
  assert.ok(g2.out.some((l) => l.startsWith('cascade ') && l.includes('triggers/U')), g2.out.join('\n'));
  assert.ok(!g2.out.some((l) => l.startsWith('NOTE cascade --only')), g2.out.join('\n'));
});
