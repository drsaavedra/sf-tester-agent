'use strict';

// What a tester's tools may reach: the limits in docs/tool-guidelines.md, checked with no org.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const fs = require('node:fs');
const api = require('../src/api');
const { CLASSES, NOT_A_STEP, LOOKS } = require('../src/tool-limits');
const { combinations } = require('../src/combinations.json');

let client;
test.before(async () => {
  client = new Client({ name: 'limits', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')], stderr: 'ignore' }));
});
test.after(() => client.close());
const answer = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return JSON.parse(r.content[0].text); };

test('sf_api refuses a path that is not a read, however it is spelled', () => {
  for (const p of ['/tooling/executeAnonymous?anonymousBody=x', '/tooling/runTestsAsynchronous', '/Tooling/executeAnonymous', '/actions/custom',
    '/ui-api/../tooling/executeAnonymous?anonymousBody=x', '/sobjects/..%2ftooling/x', '/ui-api/%2e%2e/tooling/executeAnonymous', '/ui-api\\..\\tooling\\executeAnonymous',
    '/query/../tooling/executeAnonymous', '/../../apexrest/x', '/../x/query', '/../v/query', '/../../v/sobjects/x', '/ui-api/..;/tooling/executeAnonymous',
    '/ui-api/.\t./tooling/executeAnonymous', '/ui-api/%252e%252e/tooling/x', '/ui-api/..%3b/tooling/x', '/ui-api/..%00/tooling/x', '/ui-api/%c0%ae%c0%ae/tooling/x', '/ui-api/.%09./tooling/x',
    '/ui-api/%u002e%u002e/tooling/x', '/ui-api/%2e%2e/%2e%2e/x', 'query']) {
    assert.throws(() => api.assertRead(p), { code: 'PATH_REFUSED' }, p);
  }
});

test('every sf_api path the catalogue and the agent use stays open', () => {
  const used = combinations.flatMap((c) => (c.route || []).filter((s) => s.tool === 'sf_api').map((s) => s.args.path.replace(/\{\{[^}]*\}\}/g, 'a01'))); // a route fills its placeholders before the step runs
  assert.ok(used.length >= 23, `the catalogue's sf_api steps: ${used.length}`);
  for (const p of [...used, '/query?q=SELECT+Id+FROM+Account', '/tooling/query?q=SELECT+Id+FROM+Flow', '/recent', '/ui-api/object-info/Account', '/sobjects/Account/quickActions',
    '/sobjects', '/query/01g000000000001-2000', '/queryAll?q=x', '/tooling/sobjects/Flow/301', '/limits', '/sobjects/Contact/Ext__c/a b', '/sobjects/Contact/Ext__c/caf%C3%A9', '/sobjects/Contact/Ext__c/A%2FB', '/search/?q=FIND+x']) api.assertRead(p);
});

test('every GET through api.call meets the read limit, so a tool argument cannot reach a write', async () => {
  const s = { apiVersion: '68.0', instanceUrl: 'http://127.0.0.1:9', accessToken: 't' };
  for (const obj of ['../../tooling/executeAnonymous?anonymousBody=x', '..\\..\\tooling\\executeAnonymous']) {
    await assert.rejects(api.call(s, `/ui-api/object-info/${obj}`, { as: 'admin' }), { code: 'PATH_REFUSED' }, obj);
  }
  await assert.rejects(api.call(s, '/ui-api/object-info/Account', { as: 'admin' }), (e) => e.code !== 'PATH_REFUSED', 'control: a read reaches the network');
  await assert.rejects(api.call(s, '/tooling/x', { method: 'POST', as: 'admin' }), (e) => e.code !== 'PATH_REFUSED', 'the replay\'s own POST is not a GET');
});

test('a page URL takes one segment from a tool argument', async () => {
  const nav = require('../src/nav');
  const s = { page: { goto: async () => { throw new Error('reached the page'); } }, origin: 'http://x' };
  for (const id of ['../../services/data/v68.0/tooling/executeAnonymous?anonymousBody=x', '001/edit', 'a?b']) await assert.rejects(nav.openRecord(s, id), { code: 'BAD_ARGS' }, id);
  await assert.rejects(nav.openRecord(s, '001x', { objectApiName: '../x' }), { code: 'BAD_ARGS' });
  await assert.rejects(nav.openList(s, '../setup'), { code: 'BAD_ARGS' });
  await assert.rejects(nav.openTab(s, '..'), { code: 'BAD_ARGS' });
  await assert.rejects(require('../src/form').createRecord(s, 'Account/../Contact'), { code: 'BAD_ARGS' });
  await assert.rejects(nav.openRecord(s, '001000000000001'), /reached the page/, 'control: an id opens');
});

test('sf_api refuses before it needs a session, so the check cannot be skipped', async () => {
  assert.equal((await answer('sf_api', { path: '/tooling/executeAnonymous?anonymousBody=x', as: 'admin' })).code, 'PATH_REFUSED');
  assert.equal((await answer('sf_api', { path: '/query?q=x', as: 'admin' })).code, 'NO_SESSION', 'control: a read reaches the session check');
});

test('sf_verify_live refuses a blank marker before it needs a session', async () => {
  const r = await client.callTool({ name: 'sf_verify_live', arguments: { recordId: '001x', lwcApiName: 'p', marker: ' ' } });
  assert.doesNotMatch(r.content[0].text, /NO_SESSION/);
  assert.match(r.content[0].text, /marker/);
  assert.equal((await answer('sf_verify_live', { recordId: '001x', lwcApiName: 'p', marker: 'V21' })).code, 'NO_SESSION', 'control: a marker with a word reaches the session check');
});

test('sf_verify_checks takes an absolute check file and a ref that is no git option, before it reads the org', async () => {
  assert.equal((await answer('sf_verify_checks', { org: 'no-such-alias', checksFile: 'verify-checks.json' })).code, 'BAD_ARGS');
  assert.equal((await answer('sf_verify_checks', { org: 'no-such-alias', checksFile: '/nowhere/verify-checks.json', since: '--output=/tmp/x' })).code, 'BAD_ARGS');
  // verify itself answers a missing file as bad usage: the tool reached it.
  const r = await answer('sf_verify_checks', { org: 'no-such-alias', checksFile: '/nowhere/verify-checks.json' });
  assert.deepEqual([r.verdict, r.exit], ['not run', 2], 'control: an absolute path reaches verify');
  assert.match(r.problems[0], /no check file/);
  // Inline checks keep every key through the tool schema: verify accepts them, then refuses an only that names none of
  // them, which it checks after BAD_CHECK and before it needs the sf CLI or the org.
  const fixture = path.join(__dirname, 'fixture');
  const checks = JSON.parse(fs.readFileSync(path.join(fixture, 'verify-checks.json'), 'utf8')).checks.filter((c) => c.id === 'probe-count-rule');
  const inline = await answer('sf_verify_checks', { org: 'no-such-alias', checks, project: fixture, only: ['no-such-check'] });
  assert.deepEqual([inline.verdict, inline.problems], ['not run', ['only ["no-such-check"] matches no check']], JSON.stringify(inline));
});

const REPO = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(REPO, 'src', 'server.js'), 'utf8');
const tools = [...server.matchAll(/^tool\('(sf_\w+)'/gm)].map((m) => m[1]);
const testerTools = fs.readFileSync(path.join(REPO, 'agents', 'sf-tester.md'), 'utf8').match(/^tools:(.*)$/m)[1].split(',').map((t) => t.trim().replace('mcp__sf-tester__', ''));

test('every tool has exactly one class: a new tool is classed in src/tool-limits.js, per docs/tool-guidelines.md', () => {
  assert.ok(tools.length >= 49, `tools found: ${tools.length}`);
  const classed = Object.values(CLASSES).flat();
  assert.deepEqual([...classed].sort(), [...tools].sort());
});

test('a route step cannot reach a tool outside the tester\'s tools line, nor a tool that records the run', () => {
  assert.deepEqual(tools.filter((t) => !testerTools.includes(t) && !NOT_A_STEP.includes(t)), []);
  assert.deepEqual([...NOT_A_STEP].sort(), ['sf_end', 'sf_fix_improvement', 'sf_promote_route', 'sf_record_improvement', 'sf_run_route', 'sf_save_route', 'sf_scenario', 'sf_start']);
});

test('sf_run_route refuses those steps before anything runs, and lets a step through otherwise', async () => {
  for (const tool of ['sf_promote_route', 'sf_fix_improvement', 'sf_record_improvement', 'sf_save_route']) {
    const r = await answer('sf_run_route', { steps: [{ tool, args: {} }] });
    assert.equal(r.code, 'BAD_ARGS', tool);
    assert.match(r.message, /cannot be a route step/, tool);
  }
  assert.equal((await answer('sf_run_route', { steps: [{ tool: 'sf_page_snapshot' }] })).evidence.code, 'NO_SESSION', 'control: a plain step reaches the tool');
  assert.equal((await answer('sf_run_route', { steps: [{ tool: 'sf_verify_checks', args: { checksFile: '/abs/checks.json' } }] })).evidence.code, 'NO_SESSION', 'a verify step with no org reaches the tool');
  assert.equal((await answer('sf_run_route', { steps: [{ tool: 'sf_verify_checks', args: { checksFile: 'checks.json' } }] })).code, 'BAD_ARGS', 'a relative verify path is refused before the run');
  // A limit is met before step 0 runs, whichever step breaks it, and a value a run fills reads as an id.
  const plan = (step) => answer('sf_run_route', { steps: [{ tool: 'sf_page_snapshot' }, step] });
  const refused = await plan({ tool: 'sf_api', args: { path: '/tooling/executeAnonymous?anonymousBody=x' } });
  assert.equal(refused.code, 'PATH_REFUSED');
  assert.deepEqual([refused.evidence.step, refused.evidence.tool], [1, 'sf_api'], 'a refusal names its step');
  assert.equal((await plan({ tool: 'sf_open_record', args: { recordId: '001/edit' } })).code, 'BAD_ARGS');
  assert.equal((await plan({ tool: 'sf_create_record', args: { objectApiName: '../x' } })).code, 'BAD_ARGS');
  assert.equal((await plan({ tool: 'sf_screenshot', args: { path: '/tmp/a.txt' } })).code, 'BAD_ARGS');
  assert.equal((await plan({ tool: 'sf_verify_live', args: { recordId: '001x', lwcApiName: 'p', marker: ' \n ' } })).code, 'BAD_ARGS', 'a blank marker');
  assert.equal((await plan({ tool: 'sf_verify_live', args: { recordId: '001x', lwcApiName: 'p', marker: ' V21 ' } })).evidence.code, 'NO_SESSION', 'control: a marker with a word starts');
  assert.equal((await plan({ tool: 'sf_api', args: { path: '/ui-api/records/{{step0.recordId}}' } })).evidence.code, 'NO_SESSION', 'control: the route starts');
  assert.equal((await plan({ tool: 'sf_api', args: { path: '{{step0.url}}' } })).evidence.code, 'NO_SESSION', 'a value only a run can fill is left to the step');
});

test('no tool takes an HTTP method or a body, and only the replay writes through the API', async () => {
  const { tools: listed } = await client.listTools();
  assert.equal(listed.length, tools.length);
  assert.deepEqual(listed.filter((t) => ['method', 'body'].some((k) => k in (t.inputSchema.properties || {}))).map((t) => t.name), []);
  const writers = fs.readdirSync(path.join(REPO, 'src')).filter((f) => f.endsWith('.js') && /\bmethod\s*:\s*['"`]?(POST|PATCH|PUT|DELETE)\b/i.test(fs.readFileSync(path.join(REPO, 'src', f), 'utf8')));
  assert.deepEqual(writers.sort(), ['cascade-log.js', 'replay.js', 'session.js'], 'replay seeds its own records; session reads SecuritySettings over SOAP; cascade-log (verify --cascade, CLI only) sends a check-only validate over SOAP');
});

test('a tool that takes file paths runs behind the guard', async () => {
  const { tools: listed } = await client.listTools();
  const matcher = fs.readFileSync(path.join(REPO, 'agents', 'sf-tester.md'), 'utf8').match(/matcher: "([^"]*)"/)[1].split('|');
  const takesFiles = listed.filter((t) => Object.keys(t.inputSchema.properties || {}).some((k) => /path|file/i.test(k))).map((t) => t.name).sort();
  // sf_api's path is an API path, and sf_screenshot writes a file with a checked path.
  const known = ['sf_api', 'sf_screenshot'];
  assert.deepEqual(takesFiles.filter((t) => !known.includes(t) && !matcher.includes(`mcp__sf-tester__${t}`)), []);
  for (const t of ['sf_upload_file', 'sf_run_route', 'sf_save_route']) assert.ok(matcher.includes(`mcp__sf-tester__${t}`), t);
});

// Every literal no('X') reason end gives is named in sf_scenario's description; a no(code) from an error is not scanned.
test('sf_scenario names every route reason end can give', async () => {
  const { tools: listed } = await client.listTools();
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/server.js'), 'utf8');
  const reasons = [...new Set([...src.matchAll(/\bno\('([A-Z_]+)'/g)].map((m) => m[1]))];
  assert.ok(reasons.length >= 6, `read ${reasons.length} reasons`); // control: the scan found them
  assert.deepEqual(reasons.filter((r) => !listed.find((t) => t.name === 'sf_scenario').description.includes(r)), []);
});

test('the route tools\' descriptions carry the validity and persona rules', async () => {
  const { tools: listed } = await client.listTools();
  const said = (name) => listed.find((t) => t.name === name).description;
  assert.match(said('sf_combinations'), /validity/);
  assert.match(said('sf_save_route'), /persona route given promote is saved as a candidate/);
  assert.match(listed.find((t) => t.name === 'sf_save_route').inputSchema.properties.promote.description, /never for a persona route/);
  assert.match(said('sf_run_route'), /unread/);
  assert.match(said('sf_run_route'), /An sf_verify_checks step leaves out org/);
  assert.match(said('sf_run_route'), /VERIFY_NOT_RUN for not run or nothing checked/);
  assert.match(said('sf_run_route'), /counts against the session's budget as a direct call does/);
  assert.match(said('sf_start'), /a route is one call, plus one for each sf_verify_checks step/);
  assert.match(said('sf_verify_checks'), /takes no since \(a call with since is not captured\)/);
  assert.match(said('sf_scenario'), /a green verdict and no since is kept where it ran/);
  assert.match(said('sf_run_route'), /takes an absolute checksFile or project and meets the call's own argument rules \(BAD_ARGS before any step otherwise/);
  assert.match(said('sf_combinations'), /An sf_verify_checks step's checksFile or project, stored relative to the catalogue's folder, comes absolute/);
  assert.match(said('sf_scenario'), /an sf_verify_checks call with a green verdict and no since is kept where it ran, before the page opens too \(there, a call repeated with the same arguments once, the last\)/);
  assert.match(said('sf_save_route'), /An sf_verify_checks step leaves out org/);
  assert.match(said('sf_save_route'), /its checksFile or project, an absolute path, is stored relative to the catalogue's folder/);
  assert.match(said('sf_verify_checks'), /a verdict other than green fails the step; called by itself, it returns the verdict/);
  assert.match(said('sf_run_route'), /only when a login names one, or the persona read is the one the route's own validity names/);
});

test('sf_screenshot writes only an absolute .png path', async () => {
  for (const p of ['/tmp/a.txt', 'a.png', '/tmp/a.png.sh']) assert.equal((await answer('sf_screenshot', { path: p })).code, 'BAD_ARGS', p);
  assert.equal((await answer('sf_screenshot', { path: '/tmp/a.png' })).code, 'NO_SESSION', 'control: a .png reaches the session check');
});

test('sf_screenshot refuses a path where a file exists, as a call and as a route step', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sf-ui-shot-')), 'old.png');
  fs.writeFileSync(file, 'old');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true }));
  const refused = await answer('sf_screenshot', { path: file });
  assert.equal(refused.code, 'BAD_ARGS', JSON.stringify(refused));
  assert.match(refused.message, /already exists/);
  assert.match((await answer('sf_run_route', { steps: [{ tool: 'sf_screenshot', args: { path: file } }] })).message, /step 0 sf_screenshot: a file already exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old', 'the old file is untouched');
  // Two steps on one new path: the second would meet the first's file mid-route, so the plan refuses it.
  const twice = [`${file}.a.png`, path.join(path.dirname(file), '.', 'x', '..', `${path.basename(file)}.a.png`).replace(`${path.sep}old`, `${path.sep}.${path.sep}old`)].map((p) => ({ tool: 'sf_screenshot', args: { path: p } }));
  assert.match((await answer('sf_run_route', { steps: twice })).message, /step 1 sf_screenshot: step 0 already writes/);
  assert.equal((await answer('sf_screenshot', { path: `${file}.png` })).code, 'NO_SESSION', 'control: a new path reaches the session check');
});

test('a look is a tool classed read or apiRead, and none of the state steps a route never drops', () => {
  for (const tool of LOOKS) assert.ok([...CLASSES.read, ...CLASSES.apiRead].includes(tool), tool);
  for (const tool of ['sf_apex', 'sf_viewport', 'sf_modal', 'sf_cancel', 'sf_set_fields']) assert.equal(LOOKS.includes(tool), false, tool);
});
