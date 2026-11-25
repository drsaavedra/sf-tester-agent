'use strict';

// Parallel sessions in one server, as N tester subagents share one sf-ui process: ids, the cap, the idle close.
// Each server here is its own process, so the cap and idle settings are its environment.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { auth, env, skip } = require('./helpers');

async function serve(t, extraEnv = {}, preload = []) {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  const improvementsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'improvements.jsonl');
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [...preload, path.join(__dirname, '..', 'src', 'server.js')], env: { ...process.env, SF_TESTER_IMPROVEMENTS: improvementsFile, ...extraEnv } }));
  t.after(() => client.close()); // the server's browsers go with its process
  return async (name, args = {}, timeout = 180_000) => {
    // Three browsers starting at once can pass the client's 60 s default on a busy machine.
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    return { isError: !!r.isError, body: JSON.parse(r.content[0].text), content: r.content };
  };
}

test('sessions', { skip, timeout: 300_000 }, async (t) => {
  const admin = await auth(env.org);
  const adminId = (await (await fetch(`${admin.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${admin.accessToken}` } })).json()).user_id;
  const rest = (p, init = {}) => fetch(`${admin.instanceUrl}/services/data/v60.0${p}`, { ...init, headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' } });
  const { id: probe } = await (await rest('/sobjects/SfUiProbe__c', { method: 'POST', body: JSON.stringify({ Name: `sf-ui sessions ${Date.now()}`, Tags__c: 'Alpha' }) })).json();
  t.after(() => rest(`/sobjects/SfUiProbe__c/${probe}`, { method: 'DELETE' }));
  const call = await serve(t);

  await t.test('no session input is the one default session, as before', async () => {
    const started = await call('sf_start', { org: env.org });
    assert.equal(started.body.session, 'default', JSON.stringify(started.body));
    assert.equal((await call('sf_whoami')).body.userId, started.body.userId);
  });

  await t.test('a second session runs its own browser, and ending it leaves the default working', async () => {
    const { body } = await call('sf_start', { org: env.org, session: 'new' });
    assert.notEqual(body.session, 'default', JSON.stringify(body));
    await call('sf_open_record', { recordId: probe, session: body.session });
    assert.match((await call('sf_page_snapshot', { session: body.session })).body.url, new RegExp(probe));
    assert.doesNotMatch((await call('sf_page_snapshot')).body.url, new RegExp(probe), 'the default page did not move');
    assert.equal((await call('sf_end', { session: body.session })).isError, false);
    const gone = await call('sf_whoami', { session: body.session });
    assert.deepEqual([gone.body.code, gone.body.evidence.session], ['NO_SESSION', body.session]);
    assert.equal((await call('sf_whoami')).body.userId, adminId);
  });

  // F-flow-11, F-cascade-16, F-fixtures-17: sf_list took session as one of its action's arguments (BAD_ARGS).
  await t.test('sf_list runs in a minted session', async (st) => {
    const { body } = await call('sf_start', { org: env.org, session: 'new' });
    st.after(() => call('sf_end', { session: body.session }));
    assert.equal((await call('sf_open_list', { objectApiName: 'SfUiProbe__c', listView: 'All', session: body.session })).isError, false);
    const sorted = await call('sf_list', { action: 'sort', column: 'Kind', session: body.session });
    assert.equal(sorted.isError, false, JSON.stringify(sorted.body));
  });

  await t.test('an unknown session id is NO_SESSION naming it, on any tool', async () => {
    for (const [name, args] of [['sf_whoami', {}], ['sf_end', {}], ['sf_start', { org: env.org }]]) {
      const r = await call(name, { ...args, session: 'nope' });
      assert.deepEqual([r.isError, r.body.code, r.body.evidence?.session], [true, 'NO_SESSION', 'nope'], `${name} ${JSON.stringify(r.body)}`);
    }
  });

  // Siblings share one Salesforce session per alias and Login As rotates it, so their user after it is unknown;
  // sf_whoami reads the page's cached user and could not show it. Only the Login As session is asserted.
  await t.test('three sessions read a component at once, and Login As in one moves that session to the persona', async (st) => {
    const ids = (await Promise.all([0, 1, 2].map(() => call('sf_start', { org: env.org, session: 'new' })))).map((r) => r.body.session);
    st.after(() => Promise.all(ids.map((session) => call('sf_end', { session }))));
    const reads = await Promise.all(ids.map((session) => call('sf_lwc_read', { recordId: probe, lwcApiName: 'sfUiProbe', session })));
    assert.deepEqual(reads.map((r) => r.isError), [false, false, false], JSON.stringify(reads.map((r) => r.body.code)));
    const persona = await auth(env.user);
    const me = await (await fetch(`${persona.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${persona.accessToken}` } })).json();
    assert.equal((await call('sf_login_as', { user: me.preferred_username, session: ids[0] })).isError, false);
    const who = await call('sf_whoami', { session: ids[0] });
    assert.equal(who.isError ? who.body.code : who.body.userId.slice(0, 15), me.user_id.slice(0, 15));
  });

  await t.test('over the cap sf_start throws TOO_MANY_SESSIONS naming the open sessions', async () => {
    const capped = await serve(t, { SF_TESTER_MAX_SESSIONS: '1' });
    assert.equal((await capped('sf_start', { org: env.org })).isError, false);
    const over = await capped('sf_start', { org: env.org, session: 'new' });
    assert.deepEqual([over.body.code, over.body.evidence?.open.map((o) => o.session)], ['TOO_MANY_SESSIONS', ['default']], JSON.stringify(over.body));
    assert.equal((await capped('sf_start', { org: env.org })).isError, false, 'restarting the default adds no browser');
  });

  // A launch takes seconds, so a 1 s client timeout cancels sf_start mid-launch, as an interrupt in Claude Code does.
  await t.test('an sf_start the caller cancelled frees its slot once the launch ends', async () => {
    const capped = await serve(t, { SF_TESTER_MAX_SESSIONS: '1' });
    await assert.rejects(capped('sf_start', { org: env.org, session: 'new' }, 1000), /timed out/);
    let next;
    for (const until = Date.now() + 60_000; Date.now() < until; await new Promise((r) => setTimeout(r, 2000))) {
      next = await capped('sf_start', { org: env.org, session: 'new' });
      if (next.body.code !== 'TOO_MANY_SESSIONS') break;
    }
    assert.equal(next.isError, false, JSON.stringify(next.body));
  });

  // Every call stamps its session as used, so a tester that keeps calling outlives the idle close.
  await t.test('a call keeps its session open past the idle time, and an untouched one closes', async () => {
    const idleMs = 6000;
    const quick = await serve(t, { SF_TESTER_IDLE_MS: String(idleMs) });
    const kept = (await quick('sf_start', { org: env.org, session: 'new' })).body.session;
    await quick('sf_whoami', { session: kept });
    const left = (await quick('sf_start', { org: env.org, session: 'new' })).body.session;
    await new Promise((r) => setTimeout(r, idleMs + 1000));
    await quick('sf_whoami', { session: kept });
    assert.equal((await quick('sf_start', { org: env.org, session: 'new' })).isError, false);
    assert.deepEqual([(await quick('sf_whoami', { session: kept })).isError, (await quick('sf_whoami', { session: left })).body.code], [false, 'NO_SESSION']);
  });

  await t.test('a session left idle is closed at the next sf_start; the default one is not', async () => {
    const quick = await serve(t, { SF_TESTER_IDLE_MS: '1' });
    await quick('sf_start', { org: env.org });
    const first = (await quick('sf_start', { org: env.org, session: 'new' })).body.session;
    const second = (await quick('sf_start', { org: env.org, session: 'new' })).body.session;
    assert.equal((await quick('sf_whoami', { session: first })).body.code, 'NO_SESSION');
    assert.equal((await quick('sf_whoami', { session: second })).isError, false);
    assert.equal((await quick('sf_whoami')).isError, false);
  });
});

// No org: stub-server.js holds the slow read's snapshot until the fast read has located and answered.
test('a read that ends while another is open still reports its own foundBy', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const ids = [];
  for (const _ of [0, 1]) ids.push((await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session);
  const reads = await Promise.all([['slow', ids[0]], ['fast', ids[1]]].map(([lwcApiName, session]) => call('sf_lwc_read', { recordId: 'a', lwcApiName, session }, 10_000)));
  assert.deepEqual(reads.map((r) => [r.body.snapshot, r.body.foundBy?.via]), [['slow', 'slow'], ['fast', 'fast']], JSON.stringify(reads));
});

// No org: the form tools ask for the session before the form, so an unknown id is not NO_FORM or a quiet ok.
test('the form tools answer NO_SESSION for an unknown session id', async (t) => {
  const call = await serve(t);
  for (const [name, args] of [['sf_set_fields', { values: { Phone: '1' } }], ['sf_save', {}], ['sf_cancel', {}]]) {
    const r = await call(name, { ...args, session: 'nope' }, 10_000);
    assert.deepEqual([r.isError, r.body.code, r.body.evidence?.session], [true, 'NO_SESSION', 'nope'], `${name} ${JSON.stringify(r.body)}`);
  }
});

// No org: with a session and no form open, setting fields or saving is NO_FORM.
test('the form tools answer NO_FORM before any form is open', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  for (const [name, args] of [['sf_set_fields', { values: { Phone: '1' } }], ['sf_save', {}], ['sf_cancel', {}]]) {
    const r = await call(name, args, 10_000);
    assert.deepEqual([r.isError, r.body.code], [true, 'NO_FORM'], `${name} ${JSON.stringify(r.body)}`);
  }
  // sf_form_model refuses a recordId that is not id-shaped before it opens anything (nav.isId).
  const bad = await call('sf_form_model', { recordId: '001C100000XZ8PW-' }, 10_000);
  assert.deepEqual([bad.isError, bad.body.code], [true, 'BAD_ARGS'], JSON.stringify(bad.body));
});

// No org: sf_start launches headless unless asked for headed, which a person watching the run asks for.
test('sf_start launches headless unless headed is true', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const launched = [];
  for (const args of [{}, { headed: false }, { headed: true }]) launched.push((await call('sf_start', { org: 'launch', ...args }, 10_000)).body.evidence?.headless);
  assert.deepEqual(launched, [true, true, false]);
});

// No org: a tester needs to know it is on production, so sf_start says so; on any other org the key is not there.
test('sf_start names a production org', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await call('sf_start', { org: 'prod' }, 10_000)).body.production, true);
  assert.equal('production' in (await call('sf_start', { org: 'stub' }, 10_000)).body, false);
});

// No org: the server keeps the count, because prose alone left 4 agents recording 0 gaps on a real run.
test('sf_end lists the session\'s tool errors and recorded gaps, then drops them', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body;
  const other = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session;
  await call('sf_api', { path: '/fails', session }, 10_000);
  await call('sf_api', { path: '/cut/190', session }, 10_000); // a token across the 200-character cut
  await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/fails' } }], session }, 10_000);
  await call('sf_api', { path: '/own-at', session }, 10_000); // control: a call that worked lists nothing
  await call('sf_api', { path: '/fails', session: other }, 10_000); // another session's error stays on its own ledger
  await call('sf_start', { org: 'stub', session }, 10_000); // a persona's restart keeps the run's list
  await call('sf_record_improvement', { area: 'form', kind: 'broken', what: 'a gap', session }, 10_000);
  const refused = await call('sf_record_improvement', { area: 'form', kind: 'broken', what: 'another', sameAs: 'no such gap', session }, 10_000);
  assert.equal(refused.body.code, 'NOT_FOUND');
  await call('sf_record_improvement', { area: 'form', kind: 'broken', what: 'no ledger', session: 'ghost' }, 10_000);
  assert.equal((await call('sf_end', { session: 'ghost' }, 10_000)).body.code, 'NO_SESSION', 'recording makes no ledger for an id nobody started');
  const { improvements } = (await call('sf_end', { session }, 10_000)).body;
  assert.equal(improvements.recorded, 1, 'the refused one is not counted');
  assert.deepEqual(improvements.errors.map((e) => [e.tool, e.code]), [['sf_api', 'API_ERROR'], ['sf_api', 'UNEXPECTED'], ['sf_run_route', 'API_ERROR'], ['sf_record_improvement', 'NOT_FOUND']]);
  assert.match(improvements.errors[0].at, /^\d{4}-/);
  assert.ok(improvements.errors[1].message.length <= 200, 'first 200 characters');
  assert.doesNotMatch(JSON.stringify(improvements), /00Dstub/, 'no prefix of the token');
  assert.deepEqual((await call('sf_end', { session: other }, 10_000)).body.improvements.errors.length, 1);
  await call('sf_start', { org: 'stub', session: 'default' }, 10_000);
  assert.equal((await call('sf_end', {}, 10_000)).body.improvements, undefined, 'omitted when both are empty');
});

// No org: a cap close takes the browser, not the list: the tester's sf_end still reads what its run met.
test('a session the cap closed still lists its errors at sf_end', async (t) => {
  const call = await serve(t, { SF_TESTER_MAX_SESSIONS: '1', SF_TESTER_CAP_IDLE_MS: '100' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body;
  await call('sf_api', { path: '/fails', session }, 10_000);
  await new Promise((r) => setTimeout(r, 300));
  const next = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session;
  assert.equal((await call('sf_whoami', { session }, 10_000)).body.code, 'NO_SESSION', 'control: the cap closed it');
  assert.deepEqual((await call('sf_end', { session }, 10_000)).body.improvements.errors.map((e) => e.code), ['API_ERROR', 'NO_SESSION']);
  await call('sf_end', { session: next }, 10_000);
});

// No org: as for a check, a call the client gave up on leaves no record: the tester never saw this error.
test('a cancelled call lists no error', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body;
  await assert.rejects(call('sf_api', { path: '/slow-fails', session }, 200), /timed out/i);
  await new Promise((r) => setTimeout(r, 1200)); // past the stub's failure
  assert.equal((await call('sf_end', { session }, 10_000)).body.improvements, undefined);
});

// No org: a call still running when its session ends cannot land on the run that takes the id next.
test('an error from a call that outlived sf_end stays off the next run\'s list', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const late = call('sf_api', { path: '/slow-fails' }, 10_000);
  await new Promise((r) => setTimeout(r, 200)); // the stub holds it 1 s: past its session check, not yet failed
  await call('sf_end', {}, 10_000);
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.equal((await late).body.code, 'API_ERROR', 'control: it failed after the restart, not at its session check');
  assert.equal((await call('sf_end', {}, 10_000)).body.improvements, undefined);
});

// No org: a restart that leaves headed out keeps the window a watched run asked for, until sf_end frees the id.
test('a restart without headed keeps the session headed, and sf_start says which it launched', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const id = (await call('sf_start', { org: 'stub', session: 'new', headed: true }, 10_000)).body;
  const restarted = (await call('sf_start', { org: 'stub', session: id.session }, 10_000)).body;
  const off = (await call('sf_start', { org: 'stub', session: id.session, headed: false }, 10_000)).body;
  await call('sf_start', { org: 'stub', headed: true }, 10_000);
  await call('sf_end', {}, 10_000);
  const fresh = (await call('sf_start', { org: 'stub' }, 10_000)).body;
  assert.deepEqual([id.headed, restarted.headed, off.headed, fresh.headed], [true, true, false, false]);
  // The launch itself, not only the answer: a restart without headed launches with a window.
  const watched = (await call('sf_start', { org: 'stub', session: 'new', headed: true }, 10_000)).body.session;
  assert.equal((await call('sf_start', { org: 'launch', session: watched }, 10_000)).body.evidence?.headless, false);
  // A start refused before any browser ran leaves the last choice standing.
  assert.equal((await call('sf_start', { org: 'launch', session: watched, headed: false }, 10_000)).body.evidence?.headless, true);
  assert.equal((await call('sf_start', { org: 'stub', session: watched }, 10_000)).body.headed, true);
});

// No org: a read the client cancelled keeps running and locates its component 1.5 s in, during the next call.
test('a cancelled read does not put its foundBy on the next call', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  await assert.rejects(call('sf_lwc_read', { recordId: 'a', lwcApiName: 'late' }, 500), /timed out/);
  const { body } = await call('sf_api', { path: '/slow' }, 10_000);
  assert.deepEqual([body.n, body.foundBy], [1, undefined], JSON.stringify(body));
});

// No org: a tool's snapshot past its 6000 characters says it was cut and how long it was.
test('a long tool snapshot is marked where it was cut', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const { body } = await call('sf_lwc_read', { recordId: 'a', lwcApiName: 'long' }, 10_000);
  assert.equal(body.snapshot, `${'x'.repeat(6000)}\n[cut at 6000 of 7000 characters]`, JSON.stringify(body).slice(-200));
});

// No org: the snapshot the tools return marks covered text, and a covered pass that never answers costs 2 s, not the call,
// and says it did not run.
test('a tool snapshot marks covered text and outlives a stuck covered pass', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.equal((await call('sf_lwc_read', { recordId: 'a', lwcApiName: 'covered' }, 10_000)).body.snapshot, 'covered\n- covered: "Size chosen: Large" under span');
  const t0 = Date.now();
  assert.equal((await call('sf_lwc_read', { recordId: 'a', lwcApiName: 'stuck' }, 10_000)).body.snapshot, 'stuck\n- covered check not run: ran past 2 s');
  assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`);
});

// No org: an sf_api answer that has its own at, or is not an object, comes back whole beside the wrapper's at.
test('an sf_api answer keeps its own at and its shape', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const got = {};
  for (const p of ['/own-at', '/string', '/number', '/list', '/null', '/empty']) {
    const { body: { at, ...rest } } = await call('sf_api', { path: p }, 10_000);
    assert.deepEqual(Object.keys(at), ['start', 'end'], JSON.stringify(at));
    got[p] = rest;
  }
  assert.deepEqual(got, { '/own-at': { result: { at: 'x', n: 1 } }, '/string': { result: 'abc' }, '/number': { result: 0 }, '/list': { result: [1, 2] }, '/null': { result: null }, '/empty': { result: {} } });
});

// No org: the three calls a run spends most of its tool time in say where the time went.
test('sf_start, sf_login_as and sf_run_route return timings, in milliseconds per stage', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const whole = (ms) => Object.values(ms).every((n) => Number.isInteger(n) && n >= 0);
  const started = await call('sf_start', { org: 'stub' }, 10_000);
  assert.deepEqual([Object.keys(started.body.timings), whole(started.body.timings)], [['close', 'auth', 'browser', 'app', 'policy'], true], JSON.stringify(started.body));
  const login = await call('sf_login_as', { user: '005other' }, 10_000);
  assert.deepEqual([Object.keys(login.body.timings), whole(login.body.timings)], [['user', 'login', 'whoami', 'app'], true], JSON.stringify(login.body));
  // With an app asked for, the login returns by its other path.
  const inApp = await call('sf_login_as', { user: '005other', app: 'SfUi_Console' }, 10_000);
  assert.deepEqual([inApp.body.appKept, Object.keys(inApp.body.timings)], [undefined, ['user', 'login', 'whoami', 'app']], JSON.stringify(inApp.body));
  const steps = [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_api', args: { path: '/list' } }];
  const { body } = await call('sf_run_route', { steps }, 10_000);
  const { stepMs, ...stages } = body.timings;
  assert.deepEqual([Object.keys(stages), whole(stages), stepMs.length, whole(stepMs)], [['check', 'steps', 'end'], true, 2, true], JSON.stringify(body));
});

// No org: a call that fails is the one whose time is asked about, so its evidence carries the stages it reached.
test('a failed sf_start, sf_login_as or sf_run_route carries timings in its evidence, with the stage that threw as failed', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const slow = await call('sf_start', { org: 'slowlogin' }, 10_000);
  assert.deepEqual([slow.body.code, Object.keys(slow.body.evidence.timings ?? {})], ['START_TIMEOUT', ['close', 'auth', 'browser', 'app', 'failed']], JSON.stringify(slow.body));
  await call('sf_start', { org: 'stub' }, 10_000);
  const route = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/list' } }, { tool: 'sf_api', args: { path: '/fails' } }] }, 10_000);
  assert.deepEqual([route.body.code, Object.keys(route.body.evidence.timings ?? {}), route.body.evidence.timings?.stepMs.length], ['ROUTE_STEP_FAILED', ['check', 'steps', 'end', 'stepMs'], 2], JSON.stringify(route.body));
  const gap = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/list' } }, { tool: 'sf_api', args: { path: '{{step0.nope}}' } }] }, 10_000);
  assert.deepEqual([gap.body.code, gap.body.evidence.timings?.stepMs.length], ['BAD_ARGS', 1], JSON.stringify(gap.body));
  const wrong = await call('sf_login_as', { user: '005fail' }, 10_000);
  assert.deepEqual([wrong.body.code, Object.keys(wrong.body.evidence.timings ?? {})], ['WRONG_USER', ['user', 'failed']], JSON.stringify(wrong.body));
  await call('sf_start', { org: 'stub' }, 10_000); // the failed login left the session with no known user
  const login = await call('sf_login_as', { user: '005noapps', app: 'SfUi_Console' }, 10_000);
  assert.deepEqual([login.isError, Object.keys(login.body.evidence.timings ?? {})], [true, ['user', 'login', 'whoami', 'failed']], JSON.stringify(login.body));
});

// No org: a route says what it ended on, and what changed when it is given what it was saved against.
test('sf_run_route returns its validity, and stale on a green or a red when the saved one differs', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const list = [{ tool: 'sf_api', args: { path: '/list' } }];
  const open = { tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } };
  const green = [open, ...list];
  const red = [{ tool: 'sf_api', args: { path: '/leak-timeout' } }];
  const saved = { page: { object: 'Stub__c', formHash: 'then' } };
  const plain = await call('sf_run_route', { steps: green }, 10_000);
  assert.deepEqual([plain.body.validity, plain.body.stale], [{ page: { object: 'Stub__c', formHash: 'now' } }, undefined]);
  assert.deepEqual((await call('sf_run_route', { steps: green, validity: saved }, 10_000)).body.stale, ['form of Stub__c']);
  const persona = await call('sf_run_route', { steps: green, validity: { persona: { profile: 'Read Only', permissionSets: ['Probe_Read'] } } }, 10_000);
  assert.deepEqual(persona.body.stale, ['persona: saved as Read Only + Probe_Read'], 'a persona route run as the alias user says so, with no app or page to read');
  assert.equal(persona.body.validity.persona, undefined, 'read to compare, not to keep: a save must not make this a persona route');
  assert.equal(persona.body.validity.page.formHash, 'now', 'control: the rest of the read is returned');
  assert.equal((await call('sf_run_route', { steps: green, validity: { page: { object: 'Stub__c', formHash: 'now' } } }, 10_000)).body.stale, undefined, 'control: an unchanged page');
  for (const broken of [{ page: { object: 'Stub__c', formHash: null } }, [], 'x']) {
    const ran = await call('sf_run_route', { steps: green, validity: broken }, 10_000);
    assert.deepEqual([ran.isError, ran.body.stale], [false, undefined], `a hand-edited baseline runs the route: ${JSON.stringify(broken)}`);
  }
  const reads = async () => (await call('sf_api', { path: '/reads' }, 10_000)).body.reads;
  const before = await reads();
  assert.equal((await call('sf_run_route', { steps: red }, 10_000)).body.code, 'ROUTE_STEP_FAILED');
  assert.equal(await reads(), before, 'a red with no baseline does no read');
  const failed = await call('sf_run_route', { steps: [open, ...red], validity: saved }, 10_000);
  assert.equal(failed.body.code, 'ROUTE_STEP_FAILED', 'stale is said beside the red, never for it');
  assert.deepEqual([failed.body.evidence.stale, failed.body.evidence.validity], [['form of Stub__c'], undefined], 'a red gives no read to save as a baseline');
  const empty = await call('sf_run_route', { steps: [...green, { tool: 'sf_api', args: { path: '/n{{step1.nothing}}' } }], validity: saved }, 10_000);
  assert.equal(empty.body.code, 'BAD_ARGS', JSON.stringify(empty.body));
  assert.deepEqual([empty.body.evidence.stale, empty.body.evidence.validity], [['form of Stub__c'], undefined], 'a step value the changed page emptied');
  // Before its first page opens a route has read nothing of its own: the page on screen is the last route's.
  const early = await reads();
  const before1 = await call('sf_run_route', { steps: red, validity: saved }, 10_000);
  assert.equal(before1.body.code, 'ROUTE_STEP_FAILED');
  assert.deepEqual([before1.body.evidence.stale, await reads()], [undefined, early], 'a red before the first page opens reads no page and names no change');
  assert.deepEqual(before1.body.evidence.unread, ['page: the route opened no page'], 'and says so');
  const gap = await call('sf_run_route', { steps: [...list, { tool: 'sf_api', args: { path: '/n{{step0.nothing}}' } }], validity: saved }, 10_000);
  assert.deepEqual([gap.body.code, gap.body.evidence.stale], ['BAD_ARGS', undefined], 'the same for a step value that is missing');
  // A green that opened no page has no page of its own to return as a validity, so it reads nothing, as a red does.
  const before2 = await reads();
  const entryless = await call('sf_run_route', { steps: list, validity: saved }, 10_000);
  assert.deepEqual([entryless.body.validity, entryless.body.stale, await reads()], [undefined, undefined, before2], 'an entry-less green with a baseline reads no page');
  assert.deepEqual(entryless.body.unread, ['page: the route opened no page'], 'and says so');
  assert.equal((await call('sf_run_route', { steps: list }, 10_000)).body.validity.page.formHash, 'now', 'control: with no baseline the read stays');
  // A step that is no entry tool but moves the page still opened one; one that stays on the start URL did not.
  const moved = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { text: 'navigate' } }], validity: saved }, 10_000);
  assert.deepEqual([moved.body.stale, moved.body.unread], [['form of Stub__c'], undefined], 'a click that navigated reads the page');
  const stayed = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { text: 'stay' } }], validity: saved }, 10_000);
  assert.deepEqual([stayed.body.stale, stayed.body.unread], [undefined, ['page: the route opened no page']], 'control: a click that stayed on the page reads none');
  // A step given the record the page already shows reuses that page, so it is the route's page and is read.
  await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { text: 'navigate' } }] }, 10_000);
  const reused = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { recordId: '001STUB0000000A', lwcApiName: 'covered', text: 'stay' } }], validity: saved }, 10_000);
  assert.deepEqual([reused.isError, reused.body.stale, reused.body.unread], [false, ['form of Stub__c'], undefined], JSON.stringify(reused.body));
  // A look or an API-only assert names the open record without using its page.
  const look = await call('sf_run_route', { steps: [{ tool: 'sf_whoami', args: {} }], validity: saved }, 10_000);
  assert.deepEqual([look.body.stale, look.body.unread], [undefined, ['page: the route opened no page']], 'sf_whoami reads no page');
  const viaApi = await call('sf_run_route', { steps: [{ tool: 'sf_assert_field', args: { recordId: '001STUB0000000A', field: 'Name', expected: 'x', via: 'api' } }], validity: saved }, 10_000);
  assert.deepEqual([viaApi.isError, viaApi.body.stale, viaApi.body.unread], [false, undefined, ['page: the route opened no page']], 'an assert via api reads no page');
  // A recordId alone that is not an id is refused before any page opens; another record's id opens that record.
  const other = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { recordId: '001OTHER', text: 'stay' } }], validity: saved }, 10_000);
  assert.deepEqual([other.body.evidence?.code, other.body.evidence?.stale, other.body.evidence?.unread], ['BAD_ARGS', undefined, ['page: the route opened no page']], JSON.stringify(other.body));
  const another = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { recordId: '001STUB0000000B', text: 'stay' } }], validity: saved }, 10_000);
  assert.deepEqual([another.isError, another.body.stale, another.body.unread], [false, ['form of Stub__c'], undefined], 'the opened record is the route\'s page, so it is read');
  await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { text: 'navigate' } }] }, 10_000); // back on 001STUB0000000A
  // A recordId that is only the start of the page's id (not an id) reuses nothing either.
  const prefix = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { recordId: '001STUB', lwcApiName: 'covered', text: 'stay' } }], validity: saved }, 10_000);
  assert.deepEqual(prefix.body.unread, ['page: the route opened no page'], 'a prefix of the id reuses no page');
  const redReused = await call('sf_run_route', { steps: [{ tool: 'sf_click', args: { recordId: '001STUB0000000A', lwcApiName: 'covered', name: 'Nowhere' } }], validity: saved }, 10_000);
  assert.deepEqual([redReused.body.code, redReused.body.evidence.stale], ['ROUTE_STEP_FAILED', ['form of Stub__c']], 'a red on the reused page reads it too');
  // An entry step that navigates and then throws opened a page; one that throws before it navigates did not.
  const navigated = await call('sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: 'Nope_Tab' } }], validity: saved }, 10_000);
  assert.deepEqual([navigated.body.evidence.code, navigated.body.evidence.stale], ['TAB_UNAVAILABLE', ['form of Stub__c']], 'a tab that did not open still left its page');
  const refused = await call('sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: '..' } }], validity: saved }, 10_000);
  assert.deepEqual([refused.body.evidence.code, refused.body.evidence.stale], ['BAD_ARGS', undefined], 'control: a step that never navigated opened nothing');
});

// No org: with no session open there is no page, so a route run past its pre-run check opened none.
test('sf_run_route with no session reads no page', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const r = await call('sf_run_route', { steps: [{ tool: 'sf_improvements' }], validity: { page: { object: 'Stub__c', formHash: 'then' } }, onStale: 'run' }, 10_000);
  assert.deepEqual([r.body.stale, r.body.unread], [undefined, ['page: the route opened no page']], JSON.stringify(r.body));
});

test('sf_run_route says which part of its read threw, on a green and on a red', async (t) => {
  const call = await serve(t, { STUB_READ_UNREAD: '["page: boom"]' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const saved = { page: { object: 'Stub__c', formHash: 'now' } };
  const green = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/list' } }] }, 10_000);
  assert.deepEqual(green.body.unread, ['page: boom']);
  const red = await call('sf_run_route', { steps: [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_api', args: { path: '/fails' } }], validity: saved }, 10_000);
  assert.equal(red.body.code, 'ROUTE_STEP_FAILED');
  assert.deepEqual(red.body.evidence.unread, ['page: boom'], 'a red is not left to read as a verdict on a page nobody read');
});

// No org: a route step reads an earlier step's result as the tool returns it, { result } wrap included.
test('a route reference reads the result shape the tool returns', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const r = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/list' } }, { tool: 'sf_api', args: { path: '/n{{step0.result.1}}' } }] }, 10_000);
  assert.equal(r.isError, false, JSON.stringify(r.body));
  assert.deepEqual(r.body.last, { ok: true }, 'the last step answered nothing, which its own result shows as ok');
  const bare = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/list' } }, { tool: 'sf_api', args: { path: '/n{{step0.1}}' } }] }, 10_000);
  assert.equal(bare.body.code, 'BAD_ARGS', JSON.stringify(bare.body));
});

// No org: sf_api's expect.path reads the same { result } shape as a route reference, not the raw list.
test('sf_api expect.path reads the result shape the tool returns', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const r = await call('sf_api', { path: '/list', expect: { path: 'result.1', equals: 2 } }, 10_000);
  assert.deepEqual([r.isError, r.body.result], [false, [1, 2]], JSON.stringify(r.body));
});

// No org: no result carries an access token, whether a frontdoor sid= in Playwright's call log or the session's own
// token; the cut at ERROR_CHARS, in a tool and in a route step, falls just inside the token, so a prefix is caught too.
test('no tool result carries an access token', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const results = [await call('sf_start', { org: 'leak' }, 10_000)];
  await call('sf_start', { org: 'stub' }, 10_000);
  for (const p of ['/leak-timeout', '/leak-bearer', '/leak-ok', '/cut/1990']) results.push(await call('sf_api', { path: p }, 10_000));
  results.push(await call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/cut/1990' } }] }, 10_000));
  const seen = results.map((r) => JSON.stringify(r.body));
  assert.deepEqual(seen.map((s) => /00Dstub|sid=(?!<redacted>)/.test(s)), seen.map(() => false), seen.join('\n'));
  assert.ok(seen.every((s) => s.includes('<redact')), `each stub put the token in its result: ${seen.join('\n')}`);
});

// No org: a first sf_start that fails holding the bare token, before any session exists, redacts it too.
test('a first sf_start that fails with the bare token redacts it', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const seen = JSON.stringify((await call('sf_start', { org: 'bare' }, 10_000)).body);
  assert.ok(!seen.includes('00Dstub') && seen.includes('holding <redacted>'), seen);
});

// No org: a raw TimeoutError is LOCATOR_TIMEOUT in the wrapper and in a route step; sf_wait's coded TIMEOUT stays (the control).
test('a raw timeout is LOCATOR_TIMEOUT and a coded TIMEOUT stays TIMEOUT, in a tool and in a route step', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const step = (path) => ({ steps: [{ tool: 'sf_api', args: { path } }] });
  const raw = await call('sf_api', { path: '/leak-timeout' }, 10_000);
  const coded = await call('sf_api', { path: '/coded-timeout' }, 10_000);
  const rawRoute = await call('sf_run_route', step('/leak-timeout'), 10_000);
  const codedRoute = await call('sf_run_route', step('/coded-timeout'), 10_000);
  assert.deepEqual([raw.body.code, coded.body.code], ['LOCATOR_TIMEOUT', 'TIMEOUT'], JSON.stringify([raw.body, coded.body]));
  assert.deepEqual([rawRoute.body.evidence.code, codedRoute.body.evidence.code], ['LOCATOR_TIMEOUT', 'TIMEOUT'], JSON.stringify([rawRoute.body, codedRoute.body]));
  assert.ok(raw.body.evidence.url, 'the page url stays on LOCATOR_TIMEOUT');
  // The call log travels once, whole, in evidence.error; the route's message keeps its first line.
  assert.deepEqual([rawRoute.body.message.includes('\n'), /Call log/.test(rawRoute.body.evidence.error)], [false, true], JSON.stringify(rawRoute.body));
  const long = 'x'.repeat(1500); // past the old cuts at 500 and 300
  const direct = await call('sf_api', { path: '/cut/1500' }, 10_000);
  const routed = await call('sf_run_route', step('/cut/1500'), 10_000);
  assert.deepEqual([direct.body.message.includes(long), routed.body.evidence.error.includes(long)], [true, true]);
  const over = await call('sf_api', { path: '/cut/3000' }, 10_000);
  const overRouted = await call('sf_run_route', step('/cut/3000'), 10_000);
  assert.deepEqual([over.body.message.length, overRouted.body.evidence.error.length], [2000, 2000]); // pins the limit from above
  const plain = await call('sf_api', { path: '/cut/1' }, 10_000); // control: any other error is UNEXPECTED, with no page
  assert.deepEqual([plain.body.code, plain.body.evidence], ['UNEXPECTED', undefined], JSON.stringify(plain.body));
});

// No org: sf_measure's frame is measure's own (look inside it, rects in page px), not the scope iframe of where.
test('sf_measure describes its own frame to the client', async (t) => {
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'server.js')] }));
  t.after(() => client.close());
  const measure = (await client.listTools()).tools.find((x) => x.name === 'sf_measure');
  assert.match(measure.inputSchema.properties.frame.description, /rects in page px/);
});

// No org: a measurement screenshot comes back in the result and leaves no file; a path keeps one on purpose.
test('a screenshot without a path is returned inline and written nowhere', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const inline = await call('sf_screenshot', {}, 10_000);
  assert.deepEqual([inline.isError, inline.body.kept, inline.content[1]], [false, false, { type: 'image', data: Buffer.from('stub png').toString('base64'), mimeType: 'image/png' }], JSON.stringify(inline));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-shot-')), 'kept.png');
  const kept = await call('sf_screenshot', { path: file }, 10_000);
  assert.deepEqual([kept.body.kept, kept.body.path, fs.readFileSync(file, 'utf8'), kept.content.length], [true, file, 'stub png', 1], JSON.stringify(kept));
});

// No org: a tool that answers with moments only, and one that answers nothing, both say ok.
test('a click and a fill both answer ok with their at', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const click = (await call('sf_click', { name: 'x' }, 10_000)).body;
  const fill = (await call('sf_fill', { name: 'x', value: 'y' }, 10_000)).body;
  assert.deepEqual([click.ok, Object.keys(click.at), fill.ok, Object.keys(fill.at)], [true, ['start', 'clicked', 'end'], true, ['start', 'end']], JSON.stringify({ click, fill }));
});

// No org: a tool that fails after a moment (an upload whose Done times out) still reports that moment.
test('an error keeps the moments its tool reached before it threw', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const r = await call('sf_api', { path: '/fails' }, 10_000);
  assert.equal(r.body.code, 'API_ERROR', JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.at), ['start', 'fileSet', 'end'], JSON.stringify(r.body));
  assert.equal(r.body.at.fileSet, '2000-01-01T00:00:00.000Z');
});

// One tester that ends without sf_end must not hold a slot for the whole idle time: at the cap, sf_start first
// closes the session idle longest past SF_TESTER_CAP_IDLE_MS; with every session used just now it still refuses.
test('at the cap sf_start frees a session idle past the cap idle time, and refuses while all are busy', async (t) => {
  const call = await serve(t, { SF_TESTER_MAX_SESSIONS: '2', SF_TESTER_CAP_IDLE_MS: '1500' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const start = () => call('sf_start', { org: 'stub', session: 'new' }, 10_000);
  const read = (session) => call('sf_lwc_read', { recordId: 'r', lwcApiName: 'long', session }, 10_000);
  const a = (await start()).body.session;
  const b = (await start()).body.session;
  assert.equal((await start()).body.code, 'TOO_MANY_SESSIONS', 'both were used just now');
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await read(b)).isError, false, 'b stays busy');
  const c = await start();
  assert.equal(c.isError, false, JSON.stringify(c.body));
  assert.deepEqual([(await read(a)).body.code, (await read(b)).isError], ['NO_SESSION', false]);
});

// A call in work is not idle: at the cap, a session whose 2 s call started past the cap idle time is not closed under it,
// and once the call ends its idle time starts then.
test('at the cap sf_start does not close a session with a call still in work', async (t) => {
  const call = await serve(t, { SF_TESTER_MAX_SESSIONS: '2', SF_TESTER_CAP_IDLE_MS: '1500' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const start = () => call('sf_start', { org: 'stub', session: 'new' }, 10_000);
  const a = (await start()).body.session;
  const b = (await start()).body.session;
  const slow = call('sf_api', { path: '/slow', session: a }, 10_000); // answers after 2 s
  await new Promise((r) => setTimeout(r, 1600));
  await call('sf_whoami', { session: b }, 10_000); // b used just now
  const over = (await start()).body;
  assert.equal(over.code, 'TOO_MANY_SESSIONS', 'a is busy, not idle');
  assert.deepEqual(over.evidence.open.find((o) => o.session === a), { session: a, busy: true }, 'a busy session reports no idle time');
  assert.equal((await slow).isError, false);
  assert.equal((await start()).body.code, 'TOO_MANY_SESSIONS', 'a ended its call just now: idle counts from the end');
  assert.equal((await call('sf_whoami', { session: a }, 10_000)).isError, false, 'a is still open');
});

// sf_api's expect polls 500 ms apart: its timeoutMs has a cap a route meets first, and a cancelled call stops polling.
test('sf_api expect.timeoutMs is capped, and a cancelled poll stops', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const long = { path: '/polls', expect: { path: 'polls', equals: -1, timeoutMs: 3_600_000 } };
  const r = await call('sf_run_route', { steps: [{ tool: 'sf_api', args: long }] }, 10_000);
  assert.equal(r.body.code, 'BAD_ARGS', JSON.stringify(r.body));
  await assert.rejects(call('sf_api', { ...long, expect: { ...long.expect, timeoutMs: 60_000 } }, 1_200), /timed out/i);
  const polled = async () => (await call('sf_api', { path: '/polled' }, 10_000)).body.polls;
  await new Promise((r) => setTimeout(r, 600));
  const after = await polled();
  await new Promise((r) => setTimeout(r, 1_500));
  assert.equal(await polled(), after, 'no poll after the cancel');
});

test('a persona route run after a failed login says the run has no known user', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.equal((await call('sf_login_as', { user: '005fail' }, 10_000)).body.code, 'WRONG_USER');
  const steps = [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Vf' } }, { tool: 'sf_api', args: { path: '/list' } }];
  const validity = { persona: { profile: 'Read Only', permissionSets: [] } };
  const ran = await call('sf_run_route', { steps, validity }, 10_000);
  assert.ok(ran.body.stale.includes('persona: a login failed, so this run has no known user'), JSON.stringify(ran.body.stale));
  assert.equal((await call('sf_run_route', { steps }, 10_000)).body.stale, undefined, 'control: a route with no persona has nothing to say');
  // The same with no entry step: no page is read, but the failed login is still said.
  const bare = await call('sf_run_route', { steps: steps.slice(1), validity }, 10_000);
  assert.ok(bare.body.stale.includes('persona: a login failed, so this run has no known user'), JSON.stringify(bare.body));
  assert.deepEqual([bare.body.validity?.page, bare.body.unread], [undefined, ['page: the route opened no page']]);
});

test('sf_save_route keeps who the session logged in as, on the id too, and refuses a login step', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'combinations.json');
  const call = await serve(t, { SF_TESTER_COMBINATIONS: file }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const route = [{ tool: 'sf_wait', args: { text: 'x' } }];
  const entry = { component: 'c', container: 'x', interaction: 'i', task: 't', requirement: 'r', route };
  const persona = { profile: 'Read Only', permissionSets: ['Probe_Read'] };
  const id = 'c@x~read-only~probe-read';
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.equal((await call('sf_save_route', { ...entry, id: 'c@owner' }, 10_000)).body.saved.validity, undefined, 'the alias user adds nothing');
  await call('sf_login_as', { user: '005qa' }, 10_000);
  const saved = (await call('sf_save_route', { ...entry, id: 'c@x' }, 10_000)).body.saved;
  assert.deepEqual([saved.id, saved.validity], [id, { persona }], 'a route saved with no validity still keeps its persona');
  assert.equal((await call('sf_save_route', { ...entry, id: 'c@x' }, 10_000)).body.code, 'DUPLICATE_ID', 'once per persona');
  assert.equal((await call('sf_save_route', { ...entry, id }, 10_000)).body.code, 'DUPLICATE_ID', 'an id that holds the persona gets it once');
  const other = { profile: 'Sales: EMEA', permissionSets: ['ns__A_B', 'C'] };
  const second = (await call('sf_save_route', { ...entry, id: 'c@x', validity: { persona: other } }, 10_000)).body.saved;
  assert.equal(second.id, 'c@x~sales-emea~ns-a-b~c', 'a second persona on one route, and a replay\'s own persona stands');
  const earlier = { page: { object: 'Stub__c', formHash: 'someone else' }, app: { name: 'A', hash: 'h' } };
  const mixed = (await call('sf_save_route', { ...entry, id: 'c@z', validity: earlier }, 10_000)).body.saved;
  assert.deepEqual(mixed.validity, { app: earlier.app, persona }, 'a page read as another user is not kept under this persona');
  const started = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session;
  await call('sf_login_as', { user: '005qb', session: started }, 10_000);
  assert.deepEqual((await call('sf_save_route', { ...entry, id: 'c@named', session: started }, 10_000)).body.saved.validity, { persona }, 'a session of its own, named');
  assert.equal((await call('sf_save_route', { ...entry, id: 'c@gone', session: 'nope' }, 10_000)).body.code, 'NO_SESSION');
  assert.ok((await call('sf_save_route', { ...entry, id: 'c@kept', session: 'nope', validity: { persona } }, 10_000)).body.saved, 'a route that holds its persona needs no session');
  assert.equal((await call('sf_save_route', { ...entry, id: 'c@bare' }, 10_000)).body.code, 'BAD_ARGS', 'no session with a named one open could lose the persona');
  const step = await call('sf_save_route', { ...entry, id: 'c@y', route: [{ tool: 'sf_login_as', args: { user: 'a@b.c' } }, ...route] }, 10_000);
  assert.equal(step.body.code, 'BAD_ARGS');
  assert.match(step.body.message, /sf_login_as/);
});

test('sf_save_route saves a persona route given promote as a candidate with a note, and says it has no baseline', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'combinations.json');
  const call = await serve(t, { SF_TESTER_COMBINATIONS: file }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const entry = { component: 'c', container: 'x', interaction: 'i', task: 't', requirement: 'r', route: [{ tool: 'sf_wait', args: { text: 'x' } }] };
  await call('sf_start', { org: 'stub' }, 10_000);
  const owner = await call('sf_save_route', { ...entry, id: 'c@owner', promote: true }, 10_000);
  assert.deepEqual([owner.body.promoted, owner.body.note], [true, undefined], 'control: the alias user\'s route promotes');
  await call('sf_login_as', { user: '005qa' }, 10_000);
  const held = await call('sf_save_route', { ...entry, id: 'c@x', promote: true }, 10_000);
  assert.ok(!held.isError, JSON.stringify(held.body));
  assert.equal(held.body.promoted, false);
  assert.match(held.body.note, /not promoted by the tester: saved as a candidate.*; .*no baseline/, JSON.stringify(held.body));
  const kept = await call('sf_save_route', { ...entry, id: 'c@z' }, 10_000);
  assert.match(kept.body.note, /no baseline/, JSON.stringify(kept.body));
  assert.doesNotMatch(kept.body.note, /not promoted/, 'no promote asked, so no promote note');
  const given = await call('sf_save_route', { ...entry, id: 'c@y', validity: { persona: { profile: 'P', permissionSets: [] }, page: { object: 'O', formHash: 'h' } }, promote: true }, 10_000);
  assert.deepEqual([given.body.promoted, given.body.note], [false, 'a persona route is not promoted by the tester: saved as a candidate, which a person promotes with sf_promote_route'], 'a persona a replay returned is held too');
  const saved = Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))).flat().filter((x) => /^c@[xy]/.test(x?.id));
  assert.deepEqual(saved.map((x) => x.status), ['candidate', 'candidate'], 'both kept in the file as candidates');
});

// No org: an app given to sf_start is opened again after each Login As that names none, and the result says so.
test('sf_login_as re-opens the session\'s app unless it names one, and says when it kept it', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const started = (await call('sf_start', { org: 'stub', app: 'sfui_console' }, 10_000)).body;
  assert.deepEqual(started.app, { label: 'SF UI Console', developerName: 'SfUi_Console', id: '06m2', warning: 'stub warning' }, JSON.stringify(started));
  const kept = (await call('sf_login_as', { user: '005qa' }, 10_000)).body;
  assert.deepEqual([kept.userId, kept.app.developerName, kept.appKept], ['005qa', 'SfUi_Console', true], JSON.stringify(kept));
  assert.equal(kept.app.warning, undefined, 'a kept app carries no warning: the caller never typed that value');
  assert.equal((await call('sf_login_as', { user: '005qa', app: 'sfui_console' }, 10_000)).body.app.warning, 'stub warning', 'an app that was named keeps its warning');
  const named = (await call('sf_login_as', { user: '005qb', app: 'SF UI App' }, 10_000)).body;
  assert.deepEqual([named.app.developerName, named.appKept], ['SfUi_App', undefined], JSON.stringify(named));
  assert.equal((await call('sf_login_as', { user: '005qc' }, 10_000)).body.app.developerName, 'SfUi_App', 'the app named last is kept');
  // Control: a session started with no app stays in the persona's own app after Login As.
  await call('sf_start', { org: 'stub' }, 10_000);
  const none = (await call('sf_login_as', { user: '005qd' }, 10_000)).body;
  assert.deepEqual([none.app.developerName, none.appKept], ['LightningSales', undefined], JSON.stringify(none));
});

// No org: with no app asked for, the app is information only, so a lookup that fails never fails the call.
test('sf_start and sf_whoami answer app null with a reason when the app lookup fails', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const started = await call('sf_start', { org: 'noapp' }, 10_000);
  assert.deepEqual([started.isError, started.body.app, started.body.appReason], [false, null, 'UI API down'], JSON.stringify(started.body));
  const me = await call('sf_whoami', {}, 10_000);
  assert.deepEqual([me.isError, me.body.userId, me.body.app, me.body.apps, me.body.appReason], [false, started.body.userId, null, null, 'UI API down'], JSON.stringify(me.body));
});

// No org: Login As has happened when the app fails, so the error names the user the session now runs as.
test('sf_login_as to a user who cannot open the session\'s app says it is logged in as that user', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', app: 'SF UI App' }, 10_000);
  const { isError, body } = await call('sf_login_as', { user: '005noapps' }, 10_000);
  assert.deepEqual([isError, body.code, body.evidence?.userId, body.evidence?.apps], [true, 'APP_UNAVAILABLE', '005noapps', []], JSON.stringify(body));
  assert.match(body.message, /^APP_UNAVAILABLE: logged in as 005noapps, but SfUi_App is not .*; sf_start to return/, body.message);
});

// No org: an app this user cannot open is a coded error listing the ones it can; sf_whoami lists them too.
test('an unknown app is APP_UNAVAILABLE with the apps the user can open, and sf_whoami names the current app', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const bad = await call('sf_start', { org: 'stub', app: 'Nope' }, 10_000);
  assert.deepEqual([bad.isError, bad.body.code, bad.body.evidence?.apps?.map((a) => a.developerName)], [true, 'APP_UNAVAILABLE', ['SfUi_App', 'SfUi_Console']], JSON.stringify(bad.body));
  await call('sf_start', { org: 'stub', app: 'SF UI App' }, 10_000);
  const me = (await call('sf_whoami', {}, 10_000)).body;
  assert.deepEqual([me.app.developerName, me.apps], ['SfUi_App', [{ label: 'SF UI App', developerName: 'SfUi_App', console: false }, { label: 'SF UI Console', developerName: 'SfUi_Console', console: true }]], JSON.stringify(me));
});

// No org: a plan or scenario start with no session while a named session has a browser would mark the wrong ledger.
test('sf_scenario without a session is BAD_ARGS while a named session is open, with no default browser', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  // control: with no browser anywhere there is no other ledger to miss, so the default one is taken
  assert.equal((await call('sf_scenario', { start: 'y' }, 10_000)).isError, false);
  const named = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session;
  const plan = await call('sf_scenario', { plan: [{ title: 'a', kind: 'positive' }] }, 10_000); // refused: its plan would land on the default ledger, not the named session's
  const planned = await call('sf_scenario', { plan: [{ title: 'a', kind: 'positive' }], session: named }, 10_000); // control: a plan naming the session is accepted
  const refused = await call('sf_scenario', { start: 'a' }, 10_000);
  const explicit = await call('sf_scenario', { start: 'a', session: named }, 10_000); // control: a start naming the session is accepted
  assert.deepEqual([plan.body.code, planned.isError, refused.body.code, explicit.isError], ['BAD_ARGS', false, 'BAD_ARGS', false], JSON.stringify([plan.body, planned.body, refused.body, explicit.body]));
  assert.deepEqual(refused.body.evidence.open, [named]);
  assert.match(refused.body.message, /or "default" for a plan or scenario for it/); // the advice names a plan as well as a scenario
  // y was started on default before s1 opened: ending it without a session is refused, and the advice closes it.
  assert.equal((await call('sf_scenario', { end: 'y', result: 'PASS' }, 10_000)).body.code, 'BAD_ARGS');
  const y = await call('sf_scenario', { end: 'y', result: 'PASS', session: 'default' }, 10_000);
  assert.deepEqual([y.isError, y.body.end], [false, 'y'], JSON.stringify(y.body));
});

// No org: the main agent holds the default browser and a parallel tester omits session, so its mark would land on the default ledger.
test('sf_scenario without a session is BAD_ARGS while a named session is open, even with a default browser', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.equal((await call('sf_scenario', { start: 'a' }, 10_000)).isError, false); // control: no named session open, default is taken
  assert.equal((await call('sf_scenario', { end: 'a', result: 'PASS' }, 10_000)).isError, false);
  const named = (await call('sf_start', { org: 'stub', session: 'new' }, 10_000)).body.session;
  const refused = await call('sf_scenario', { start: 'b' }, 10_000);
  assert.deepEqual([refused.isError, refused.body.code, refused.body.evidence.open], [true, 'BAD_ARGS', [named]], JSON.stringify(refused.body));
  const explicit = await call('sf_scenario', { start: 'b', session: 'default' }, 10_000);
  assert.equal(explicit.isError, false, JSON.stringify(explicit.body));
});

// No org: stub-server.js serves the user's tabs in two pages, the custom ones on page 2, and runs openTab for real.
test('sf_open_tab returns the label the user sees and opens a label by its API name', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub' }, 10_000);
  const byName = await call('sf_open_tab', { tab: 'SfUi_Vf' }, 10_000);
  assert.deepEqual([byName.isError, byName.body.tab], [false, { name: 'SfUi_Vf', label: 'SF UI VF' }], JSON.stringify(byName.body));
  const byLabel = await call('sf_open_tab', { tab: 'sf ui vf' }, 10_000);
  assert.deepEqual([byLabel.isError, byLabel.body.tab], [false, { name: 'SfUi_Vf', label: 'SF UI VF' }], JSON.stringify(byLabel.body));
  assert.match(byLabel.body.url, /\/lightning\/n\/SfUi_Vf$/, 'the label reached navigation as the name');
  const miss = await call('sf_open_tab', { tab: 'Nothing' }, 10_000);
  assert.deepEqual([miss.isError, miss.body.code, miss.body.evidence.tabs.map((x) => x.name)], [true, 'TAB_UNAVAILABLE', ['SfUi_Inputs_App', 'SfUi_Vf']], JSON.stringify(miss.body));
});

// No org: a run's tool calls are capped per session, so a runaway tester stops and reports what it has.
const whoami = (call, session) => call('sf_whoami', session ? { session } : {}, 10_000);

test('a call past the budget is BUDGET_SPENT, while sf_scenario and sf_end still work', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 2 }, 10_000);
  await call('sf_scenario', { plan: [{ title: 's', kind: 'positive' }], start: 's', session: 'default' }, 10_000); // never counted
  assert.deepEqual([(await whoami(call)).isError, (await whoami(call)).isError], [false, false]);
  const spent = await whoami(call);
  assert.deepEqual([spent.body.code, spent.body.evidence], ['BUDGET_SPENT', { used: 2, budget: 2 }], JSON.stringify(spent.body));
  assert.match(spent.body.message, /not tested:/);
  assert.equal((await call('sf_scenario', { end: 's', result: 'FAIL', reason: 'not tested: budget spent', session: 'default' }, 10_000)).isError, false);
  const end = await call('sf_end', {}, 10_000);
  assert.deepEqual([end.isError, end.body.calls, 'improvements' in end.body], [false, { used: 2, budget: 2 }, false], JSON.stringify(end.body));
});

test('a restart keeps the budget, counts as a call and is refused once it is spent', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new', budget: 3 }, 10_000)).body;
  await whoami(call, session);
  assert.equal((await call('sf_start', { org: 'stub', session }, 10_000)).isError, false); // the second call
  await whoami(call, session); // the third
  const refused = await call('sf_start', { org: 'stub', session }, 10_000);
  assert.deepEqual([refused.body.code, refused.body.evidence], ['BUDGET_SPENT', { used: 3, budget: 3 }], JSON.stringify(refused.body));
  assert.deepEqual((await call('sf_end', { session }, 10_000)).body.calls, { used: 3, budget: 3 });
});

test('budget 0 is no limit, and a session with none set has no limit either', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 0 }, 10_000);
  for (let i = 0; i < 5; i += 1) assert.equal((await whoami(call)).isError, false);
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 5, budget: 0 });
  // Past the old default of 60: calls per run differ by org, so only a stated budget caps a run.
  await call('sf_start', { org: 'stub' }, 10_000);
  for (let i = 0; i < 61; i += 1) assert.equal((await whoami(call)).isError, false, `call ${i + 1}`);
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 61, budget: 0 });
});

test('a route counts as one call, and a run after sf_end starts at 0', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 2 }, 10_000);
  const steps = [1, 2, 3, 4].map(() => ({ tool: 'sf_whoami', args: {} }));
  const route = await call('sf_run_route', { steps }, 10_000);
  assert.deepEqual([route.isError, route.body.steps.length], [false, 4], JSON.stringify(route.body));
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 1, budget: 2 });
  await call('sf_start', { org: 'stub', budget: 2 }, 10_000);
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 0, budget: 2 });
});

test('budget must be a whole number of 0 or more', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  for (const budget of [-1, 1.5]) await assert.rejects(call('sf_start', { org: 'stub', budget }, 10_000), /MCP error/, `budget ${budget}`); // the SDK refuses it, so the answer is not our JSON
});

test('past the budget the record and catalogue tools still answer, called on the default session with no session id', async (t) => {
  const call = await serve(t, { SF_TESTER_COMBINATIONS: '' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 1 }, 10_000);
  await whoami(call);
  assert.equal((await whoami(call)).body.code, 'BUDGET_SPENT', 'control: the default ledger is spent, so the gate runs on these calls');
  const refused = [];
  for (const [name, args] of [['sf_record_improvement', { area: 'budget', kind: 'missing', what: 'ran out' }], ['sf_improvements', {}], ['sf_combinations', {}], ['sf_scenario', { plan: [{ title: 't', kind: 'positive' }], start: 't' }], ['sf_save_route', { id: 'a@b', component: 'a', container: 'b', interaction: 'c', task: 'd', requirement: 'e', route: [{ tool: 'sf_whoami' }] }]]) {
    if ((await call(name, args, 10_000)).body.code === 'BUDGET_SPENT') refused.push(name);
  }
  assert.deepEqual(refused, []);
  // It needs no session but runs a validate, so a stated budget caps it.
  assert.equal((await call('sf_verify_checks', { org: 'stub', checksFile: 'relative.json' }, 10_000)).body.code, 'BUDGET_SPENT');
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 1, budget: 1 }, 'the exempt calls were not counted');
});

test('past the budget only an admin /queryAll sf_api read is let through', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new', budget: 1 }, 10_000)).body;
  await whoami(call, session);
  const codes = {};
  for (const [key, args] of [['queryAll', { path: '/queryAll?q=SELECT+Id+FROM+Account', as: 'admin' }], ['query', { path: '/query?q=SELECT+Id+FROM+Account', as: 'admin' }], ['user', { path: '/queryAll?q=SELECT+Id+FROM+Account', as: 'user' }], ['none', { path: '/queryAll?q=SELECT+Id+FROM+Account' }]]) codes[key] = (await call('sf_api', { ...args, session }, 10_000)).body.code;
  assert.deepEqual(Object.entries(codes).filter(([, c]) => c === 'BUDGET_SPENT').map(([k]) => k), ['query', 'user', 'none']);
  assert.deepEqual((await call('sf_end', { session }, 10_000)).body.calls, { used: 2, budget: 1 }, 'the read is counted');
});

test('a spent session cannot lift its budget with an sf_start that passes one', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 1 }, 10_000);
  await whoami(call);
  for (const budget of [0, 10]) {
    const r = await call('sf_start', { org: 'stub', budget }, 10_000);
    assert.deepEqual([r.body.code, r.body.evidence], ['BUDGET_SPENT', { used: 1, budget: 1 }], `budget ${budget}`);
  }
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 1, budget: 1 });
});

test('a scenario started before the first sf_start leaves that start uncounted', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await call('sf_scenario', { plan: [{ title: 's', kind: 'positive' }], start: 's', session: 'default' }, 10_000)).isError, false);
  await call('sf_start', { org: 'stub' }, 10_000);
  assert.deepEqual((await call('sf_end', {}, 10_000)).body.calls, { used: 0, budget: 0 });
});

test('past the budget the admin /queryAll read stops at five and a path that leaves /queryAll is refused', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new', budget: 1 }, 10_000)).body;
  await whoami(call, session);
  const read = (p) => call('sf_api', { path: p, as: 'admin', session }, 10_000).then((r) => r.body.code);
  assert.equal(await read('/queryAll/../sobjects/Account/describe'), 'BUDGET_SPENT');
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push(await read('/queryAll?q=SELECT+Id+FROM+Account'));
  assert.deepEqual(codes.map((c) => c === 'BUDGET_SPENT'), [false, false, false, false, false, true]);
  assert.deepEqual((await call('sf_end', { session }, 10_000)).body.calls, { used: 6, budget: 1 });
});

test('the five reads past the budget count on their own, so a restart that lowers the budget keeps them', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'stub', budget: 0 }, 10_000);
  for (let i = 0; i < 50; i += 1) await whoami(call);
  assert.equal((await call('sf_start', { org: 'stub', budget: 40 }, 10_000)).isError, false, '0 is no limit, so the restart is allowed');
  assert.equal((await whoami(call)).body.code, 'BUDGET_SPENT', 'control: 52 calls on 40 is spent');
  const refused = [];
  for (let i = 0; i < 6; i += 1) refused.push((await call('sf_api', { path: '/queryAll?q=SELECT+Id+FROM+Account', as: 'admin' }, 10_000)).body.code === 'BUDGET_SPENT');
  assert.deepEqual(refused, [false, false, false, false, false, true]);
});

test('past the budget a path assertRead refuses is not a record read and uses up none of the five', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const { session } = (await call('sf_start', { org: 'stub', session: 'new', budget: 1 }, 10_000)).body;
  await whoami(call, session);
  const read = (p) => call('sf_api', { path: p, as: 'admin', session }, 10_000).then((r) => r.body.code === 'BUDGET_SPENT');
  assert.deepEqual([await read('queryAll?q=x'), await read('//host/queryAll'), await read('/queryAll/%2e%5c')], [true, true, true], 'none counts as a read');
  const real = [];
  for (let i = 0; i < 5; i += 1) real.push(await read('/queryAll?q=x'));
  assert.deepEqual(real, [false, false, false, false, false], 'the five are all still there');
});

// No org: a person closes the headed window; the next call is NO_SESSION, and sf_start on the same id works again.
test('a closed browser turns the next call into NO_SESSION', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await call('sf_start', { org: 'closed' }, 10_000)).isError, false);
  const r = await call('sf_page_errors', {}, 10_000);
  assert.deepEqual([r.isError, r.body.code], [true, 'NO_SESSION']);
  assert.match(r.body.message, /closed/);
  assert.equal((await call('sf_start', { org: 'x' }, 10_000)).isError, false);
  assert.equal((await call('sf_page_errors', {}, 10_000)).isError, false);
});

// No org: a call still running on a browser that sf_start replaced must not close the new session on its next step.
test('a stale call that finds its browser gone leaves the session sf_start made, no org', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await call('sf_start', { org: 'dies' }, 10_000)).isError, false);
  const route = call('sf_run_route', { steps: [{ tool: 'sf_api', args: { path: '/slow' } }, { tool: 'sf_page_errors' }] }, 10_000); // 2 s, then the next step needs a session
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal((await call('sf_start', { org: 'x' }, 10_000)).isError, false); // ends the old browser, registers the new entry
  assert.equal((await route).isError, true, 'the stale route stops on its dead browser');
  assert.equal((await call('sf_page_errors', {}, 10_000)).isError, false, 'the new session is still there');
});

// No org: the last window of a headed Chrome is closed and Chrome stays running, so the browser is connected and the page closed.
test('a closed page with a connected browser is NO_SESSION, no org', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await call('sf_start', { org: 'shut' }, 10_000)).isError, false);
  const r = await call('sf_page_errors', {}, 10_000);
  assert.deepEqual([r.isError, r.body.code], [true, 'NO_SESSION']);
  assert.equal((await call('sf_start', { org: 'x' }, 10_000)).isError, false);
  assert.equal((await call('sf_page_errors', {}, 10_000)).isError, false, 'control: a start on a live page works');
});

// No org: closing a dead browser fails; the failure goes to stderr and the caller still gets NO_SESSION.
test('a failed cleanup of a dead session is logged, no org', async (t) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['-r', path.join(__dirname, 'stub-server.js'), path.join(__dirname, '..', 'src', 'server.js')], stderr: 'pipe' });
  let logged = '';
  transport.stderr.on('data', (d) => { logged += d; });
  const client = new Client({ name: 'sf-ui-test', version: '0' });
  await client.connect(transport);
  t.after(() => client.close());
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, body: JSON.parse(r.content[0].text) }; };
  assert.equal((await call('sf_start', { org: 'noquit' })).isError, false);
  assert.equal((await call('sf_page_errors')).body.code, 'NO_SESSION');
  await new Promise((ok) => setTimeout(ok, 200));
  assert.match(logged, /closing session default failed: stub: Chrome would not quit/);
});

// No org: the policy read after the start runs past the deadline; sf_start answers START_TIMEOUT, not a raw timeout.
test('sf_start reports a policy read that outlasts the deadline as START_TIMEOUT, no org', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  const r = await call('sf_start', { org: 'slowlogin' }, 10_000);
  assert.deepEqual([r.isError, r.body.code], [true, 'START_TIMEOUT']);
  assert.equal((await call('sf_start', { org: 'x' }, 10_000)).isError, false, 'control: a policy read in time starts');
});

// No org: the start deadline leaves under 5 s, so the app is not tried, and START_TIMEOUT says why.
test('sf_start with an app and too little deadline left is START_TIMEOUT, no org', async (t) => {
  const call = await serve(t, { STUB_START_MS: '4000' }, ['-r', path.join(__dirname, 'stub-server.js')]);
  const r = await call('sf_start', { org: 'x', app: 'SfUi_App' }, 10_000);
  assert.deepEqual([r.isError, r.body.code], [true, 'START_TIMEOUT'], JSON.stringify(r.body));
  assert.equal((await call('sf_start', { org: 'x' }, 10_000)).isError, false, 'control: no app to open, no time needed');
  const roomy = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  assert.equal((await roomy('sf_start', { org: 'x', app: 'SfUi_App' }, 10_000)).isError, false, 'control: the full deadline opens the app');
});

// No org: a toast from before a page open is not matched after it; with no page open between, it is.
test('a toast raised before a page open does not match a wait after it', async (t) => {
  const call = await serve(t, {}, ['-r', path.join(__dirname, 'stub-server.js')]);
  await call('sf_start', { org: 'toasts' }, 10_000);
  const wait = () => call('sf_wait', { any: [{ toast: 'Saved' }], timeoutMs: 300 }, 10_000);
  await call('sf_press', { key: 'Toast' }, 10_000);
  assert.equal((await wait()).body.matched?.toast, 'Saved', 'control: the press\'s own toast matches');
  const opened = await call('sf_open_record', { recordId: '001x' }, 10_000);
  assert.ok(!opened.isError, JSON.stringify(opened.body));
  const stale = await wait();
  assert.equal(stale.body.code, 'TIMEOUT', JSON.stringify(stale.body));
  // An action that fails before it reaches its target still clears: no leftover toast can match after it.
  await call('sf_press', { key: 'Toast' }, 10_000);
  assert.ok((await call('sf_click', { name: 'Nowhere' }, 10_000)).isError, 'the click failed');
  const left = await wait();
  assert.equal(left.body.code, 'TIMEOUT', JSON.stringify(left.body));
  // A fill clears too; a look between an action and its wait does not.
  await call('sf_press', { key: 'Toast' }, 10_000);
  await call('sf_toasts', {}, 10_000);
  assert.equal((await wait()).body.matched?.toast, 'Saved', 'control: a look keeps the toast');
  await call('sf_fill', { name: 'Box', value: 'x' }, 10_000);
  assert.equal((await wait()).body.code, 'TIMEOUT', 'the fill cleared it');
  // sf_assert_field clears when it opens the record, not when it reads only the API.
  await call('sf_press', { key: 'Toast' }, 10_000);
  await call('sf_assert_field', { recordId: '001x', field: 'Name', expected: 'x', via: 'api' }, 10_000);
  assert.equal((await wait()).body.matched?.toast, 'Saved', 'an API read keeps the toast');
  await call('sf_assert_field', { recordId: '001x', field: 'Name', expected: 'x' }, 10_000);
  assert.equal((await wait()).body.code, 'TIMEOUT', 'opening the record cleared it');
});
