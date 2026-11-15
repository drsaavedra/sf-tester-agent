'use strict';

// session.start, assertIs, loginAsEnabled, loginAs against a real scratch org.
// Each guard has a positive test and one that must fail when its precondition is removed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { session } = require('..');
const { auth, env, skip, localPage } = require('./helpers');

test('a login marks the session once it has proved the user, and a failed one clears the last', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => '<enableAdminLoginAsAnyUser>true</enableAdminLoginAsAnyUser>' }));
  const page = { goto: async () => {}, waitForURL: async () => {}, waitForFunction: async () => {}, evaluate: async () => '005someoneelse' };
  const s = { instanceUrl: 'https://x', apiVersion: '60.0', orgId: '00D', loggedInAs: '005earlier', page };
  await assert.rejects(session.loginAs(s, '005new'), /WRONG_USER/);
  assert.equal(s.loggedInAs, 'unknown', 'not the alias user, and not the last one');
  page.evaluate = async () => '005new';
  await session.loginAs(s, '005new');
  assert.equal(s.loggedInAs, '005new');
});

// No org: the key-prefix map discover reads record ids by is the last user's object list, so a new user gets none.
test('a login drops the last user\'s key-prefix map, whether or not it proves the user', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => '<enableAdminLoginAsAnyUser>true</enableAdminLoginAsAnyUser>' }));
  const page = { goto: async () => {}, waitForURL: async () => {}, waitForFunction: async () => {}, evaluate: async () => '005new' };
  const s = { instanceUrl: 'https://x', apiVersion: '60.0', orgId: '00D', page, keyPrefixes: { a01: 'Admin_Only__c' } };
  await session.loginAs(s, '005new');
  assert.equal(s.keyPrefixes, undefined);
  s.keyPrefixes = { a01: 'Admin_Only__c' };
  await assert.rejects(session.loginAs(s, '005other'), /WRONG_USER/);
  assert.equal(s.keyPrefixes, undefined);
  await session.loginAs(s, '005new'); // control: a session with no map yet logs in as before
  assert.equal(s.loggedInAs, '005new');
});

const userId = async ({ instanceUrl, accessToken }) =>
  (await (await fetch(`${instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } })).json()).user_id;

test('session', { skip, timeout: 300_000 }, async (t) => {
  const admin = await auth(env.org);
  const adminId = await userId(admin);
  const targetId = await userId(await auth(env.user));
  const s = await session.start(admin);
  t.after(() => session.end(s));

  await t.test('start lands in Lightning as the token owner', async () => {
    assert.equal(await session.whoAmI(s), adminId);
  });

  await t.test('assertIs throws WRONG_USER for anyone else', async () => {
    await assert.rejects(session.assertIs(s, targetId), { code: 'WRONG_USER' });
  });

  await t.test('loginAsEnabled reads the Login Access Policy', async () => {
    const policy = await session.loginAsEnabled(s);
    assert.equal(policy.loginAs, true);
  });

  // A component that crashes may show nothing on screen; the session keeps what the page threw or logged as an error.
  await t.test('pageErrors returns uncaught errors and console errors once, then clears', async () => {
    await s.page.evaluate(() => {
      setTimeout(() => { throw new Error('sf-ui boom'); });
      console.error('sf-ui console error');
    });
    await s.page.waitForTimeout(500);
    const { errors: seen } = session.pageErrors(s);
    assert.ok(seen.some((e) => /Uncaught Error: sf-ui boom/.test(e.message)), JSON.stringify(seen));
    assert.ok(seen.some((e) => /sf-ui console error/.test(e.message)), JSON.stringify(seen));
    assert.equal(session.pageErrors(s).errors.filter((e) => /sf-ui/.test(e.message)).length, 0, 'read once, then cleared');
  });

  await t.test('pageErrors keeps the newest 50 and counts the ones it dropped', async () => {
    session.pageErrors(s);
    await s.page.evaluate(() => { for (let i = 0; i < 60; i += 1) console.error(`sf-ui flood ${i}`); });
    await s.page.waitForTimeout(500);
    const { errors, dropped } = session.pageErrors(s);
    assert.equal(errors.length, 50);
    assert.ok(dropped >= 10, `dropped ${dropped}`);
    assert.match(errors.at(-1).message, /sf-ui flood 59/);
  });

  // Lightning reroutes uncaught errors only in windows running Aura; an iframe's (Visualforce, a vendor widget) do not.
  await t.test('pageErrors keeps an uncaught error thrown inside an iframe', async () => {
    // The page's CSP blocks an inline script in the frame, so the throw is evaluated in the frame directly.
    const handle = await s.page.evaluateHandle(() => document.body.appendChild(document.createElement('iframe')));
    const frame = await handle.asElement().contentFrame();
    await frame.evaluate(() => setTimeout(() => { throw new Error('sf-ui frame boom'); }));
    await s.page.waitForTimeout(1000);
    assert.ok(session.pageErrors(s).errors.some((e) => /sf-ui frame boom/.test(e.message)));
  });

  // Measured 2026-10-15: a close 30 s after start never resolved once Chrome had woken its updater.
  // The updater it wakes holds Chrome's stdout and stderr; end lets them go, or this file's process waits minutes.
  await t.test('end returns within 10 s for a session left open 30 s, and holds none of its pipes', async () => {
    const pipes = () => process.getActiveResourcesInfo().filter((r) => r === 'PipeWrap').length;
    const before = pipes();
    const idle = await session.start(admin);
    await new Promise((r) => setTimeout(r, 30_000));
    const outcome = await Promise.race([session.end(idle).then(() => 'ended'), new Promise((r) => setTimeout(r, 10_000, 'hung'))]);
    await new Promise(setImmediate);
    assert.deepEqual([outcome, pipes()], ['ended', before]);
  });

  await t.test('loginAs switches the whole session to the target user', async () => {
    await session.loginAs(s, targetId);
    assert.equal(s.loggedInAs, targetId, 'a route read after this says who it ran as');
    assert.equal(await session.whoAmI(s), targetId);
  });
});

// No org: a start that fails before login (here recordToasts, through the context's exposeFunction) closes its browser.
test('a start that fails before login closes its browser', { timeout: 30_000 }, async (t) => {
  const { chromium } = require('playwright-core');
  const launch = chromium.launch;
  let browser;
  t.mock.method(chromium, 'launch', async (...a) => {
    browser = await launch.apply(chromium, a);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o) => Object.assign(await newContext(o), { exposeFunction: async () => { throw new Error('stub recordToasts'); } });
    return browser;
  });
  t.after(() => browser?.close());
  await assert.rejects(session.start({ instanceUrl: 'https://sf-ui.invalid', accessToken: 'x' }), /stub recordToasts/);
  assert.equal(browser.isConnected(), false);
});

// No org: Chrome starts a process that keeps its stdout and stderr, as the GoogleUpdater does, so close() never ends;
// end lets the pipes go once Chrome has exited, and leaves a browser process still running to show as a leak.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('end releases the pipes of an exited Chrome that a process it started still holds', { skip: !fs.existsSync(CHROME) && `needs ${CHROME}`, timeout: 60_000 }, async (t) => {
  const { chromium } = require('playwright-core');
  const launch = chromium.launch;
  const pipes = () => process.getActiveResourcesInfo().filter((r) => r === 'PipeWrap').length;
  const run = async (script) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-'));
    fs.writeFileSync(path.join(dir, 'chrome.sh'), `#!/bin/sh\ncd '${dir}'\n${script.replace('CHROME', `'${CHROME}' "$@"`)}\n`, { mode: 0o755 });
    t.after(() => process.kill(Number(fs.readFileSync(path.join(dir, 'held'), 'utf8')), 'SIGKILL'));
    const mocked = t.mock.method(chromium, 'launch', (o) => launch.call(chromium, { ...o, executablePath: path.join(dir, 'chrome.sh') }));
    const before = pipes();
    const t0 = Date.now();
    await assert.rejects(session.start({ instanceUrl: 'https://sf-ui.invalid', accessToken: 'x' }), /fetch failed/);
    mocked.mock.restore();
    await new Promise(setImmediate);
    return [pipes() - before, Date.now() - t0 < 15_000];
  };
  assert.deepEqual(await run('sleep 120 & echo $! > held; exec CHROME'), [0, true], 'Chrome exited, a process it started holds the pipes');
  assert.deepEqual((await run('echo $$ > held; CHROME; exec sleep 120'))[0] > 0, true, 'the browser process is still running');
});

test('isProduction is every org but a sandbox, a scratch org and a Developer Edition org', () => {
  assert.equal(session.isProduction({ IsSandbox: false, TrialExpirationDate: null, OrganizationType: 'Enterprise Edition' }), true);
  for (const org of [{ IsSandbox: false, TrialExpirationDate: '2026-11-20T00:00:00.000+0000' }, { IsSandbox: true, TrialExpirationDate: null }, { IsSandbox: false, TrialExpirationDate: null, OrganizationType: 'Developer Edition' }]) {
    assert.equal(session.isProduction(org), false, JSON.stringify(org));
  }
});

// No org: a stub fetch answers the REST calls and a local page plays Lightning, so start runs through to the end.
test('start logs in on a production org and keeps that it is one', { timeout: 60_000 }, async (t) => {
  const page = http.createServer((req, res) => res.setHeader('Content-Type', 'text/html').end("<script>window.$A = { get: () => '005stub' };</script>"));
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  t.after(() => page.close());
  t.mock.method(require('../src/wait'), 'lightning', async () => {});
  for (const [org, production] of [[{ IsSandbox: false, TrialExpirationDate: null, OrganizationType: 'Enterprise Edition' }, true], [{ IsSandbox: true, TrialExpirationDate: null }, false]]) {
    const stub = t.mock.method(globalThis, 'fetch', async (url) => {
      const body = url.endsWith('/userinfo') ? { organization_id: '00Dstub', user_id: '005stub' } : url.endsWith('/services/data/') ? [{ version: '60.0' }] : { records: [org] };
      return new Response(JSON.stringify(body), { headers: { date: new Date().toUTCString() } });
    });
    const s = await session.start({ instanceUrl: `http://127.0.0.1:${page.address().port}`, accessToken: 'x' });
    await session.end(s);
    stub.mock.restore(); // a second mock on top of a live one is not undone with the test, and the next test would read this fetch
    assert.equal(s.production, production);
  }
});

// No org: a stand-in sf answers the Organization query, so the helpers decide on its row alone.
test('the org tests stop on a production org before any test runs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-sf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = (row) => {
    fs.writeFileSync(path.join(dir, 'sf'), `#!/bin/sh\necho '${JSON.stringify({ result: { records: [row] } })}'\n`, { mode: 0o755 });
    return spawnSync(process.execPath, ['-e', 'require("./test/helpers")'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, SF_TESTER_ORG: 'x', SF_TESTER_USER: 'y' } });
  };
  const stopped = load({ IsSandbox: false, TrialExpirationDate: null, OrganizationType: 'Enterprise Edition' });
  assert.deepEqual([stopped.status, /x is a production org/.test(stopped.stderr)], [1, true], stopped.stderr);
  assert.equal(load({ IsSandbox: true, TrialExpirationDate: null }).status, 0, 'control: a sandbox loads');
  fs.writeFileSync(path.join(dir, 'sf'), `#!/bin/sh\necho '{"message":"no auth"}'\nexit 1\n`, { mode: 0o755 });
  const noAuth = spawnSync(process.execPath, ['-e', 'require("./test/helpers")'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, SF_TESTER_ORG: 'x', SF_TESTER_USER: 'y' } });
  assert.deepEqual([noAuth.status, /could not read the org behind x: .*no auth/.test(noAuth.stderr)], [1, true], noAuth.stderr);
});

// A local page with no Aura (a Classic or Visualforce page): no app, read at once instead of after 15 s.
test('currentApp answers no app at once on a page without Aura', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto('data:text/html,<p>no aura</p>');
  const t0 = Date.now();
  const app = await session.currentApp({ page }, []);
  assert.deepEqual(app, { label: undefined, developerName: undefined, id: '' });
  assert.ok(Date.now() - t0 < 3_000, `took ${Date.now() - t0} ms`);
});

// A local server as the org: app A names itself at once and reaches its first page 800 ms later; app B's page
// stays in another app. The UI API and the admin query answer from the same server.
test('openApp returns once the app\'s first page has loaded, and an app that never opens is APP_NOT_OPENED', { timeout: 30_000 }, async (t) => {
  const page = (ctx, delay) => `<script>window.$A = { get: (k) => ({ '$Global.appContextId': '${ctx}', '$SObjectType.CurrentUser.Id': '005x' })[k] };
    setTimeout(() => history.replaceState(null, '', '/lightning/page/home'), ${delay});</script>`;
  const http = require('node:http');
  const srv = http.createServer((req, res) => {
    const json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/services/data/v60.0/ui-api/apps')) return json({ apps: ['A', 'B', 'C', 'D'].map((n) => ({ appId: `06m${n}`, type: 'Lightning', label: n === 'C' ? 'A' : n, developerName: n })) }); // C is labelled A
    if (req.url.startsWith('/services/data/v60.0/query')) return json({ records: [] });
    if (req.url === '/hang') return; // never answers: the app page's load event never fires
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/lightning/app/06mD') return res.end('<img src="/hang">');
    res.end(req.url === '/lightning/app/06mA' ? page('06mA', 800) : req.url === '/lightning/app/06mB' ? page('06mOTHER', 0) : '<p>org</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const s = { page: await localPage(t), origin, instanceUrl: origin, apiVersion: '60.0', accessToken: 'x' };
  await s.page.goto(origin);
  assert.deepEqual(await session.openApp(s, 'a'), { label: 'A', developerName: 'A', id: '06mA', warning: 'a is also the label of app C; opened the app named A. Pass C to open that one' });
  assert.equal(new URL(s.page.url()).pathname, '/lightning/page/home', 'returned before the first page loaded');
  await assert.rejects(session.openApp(s, 'B', { timeout: 1_000 }), (e) => e.code === 'APP_NOT_OPENED' && e.evidence.appContextId === '06mOTHER');
  const t0 = Date.now();
  await assert.rejects(session.openApp(s, 'D', { timeout: 1_000 }), (e) => e.code === 'APP_NOT_OPENED');
  assert.ok(Date.now() - t0 < 3_000, `a page that never loads ended APP_NOT_OPENED in the caller's timeout, took ${Date.now() - t0} ms`);
});

test('pickApp matches a label or a developer name in any case, and an unknown one lists what the user can open', () => {
  const list = [{ label: 'SF UI App', developerName: 'SfUi_App', id: '06m1', console: false }, { label: 'Service Console', developerName: 'LightningService', id: '06m2', console: true }];
  assert.equal(session.pickApp(list, 'sf ui app').id, '06m1');
  assert.equal(session.pickApp(list, 'LIGHTNINGSERVICE').id, '06m2');
  assert.throws(() => session.pickApp(list, 'Service'), (e) => e.code === 'APP_UNAVAILABLE'
    && JSON.stringify(e.evidence) === JSON.stringify({ app: 'Service', apps: [{ label: 'SF UI App', developerName: 'SfUi_App', console: false }, { label: 'Service Console', developerName: 'LightningService', console: true }] }));
});

test('pickApp takes a developer name before an earlier label, and refuses a label two apps share', () => {
  const list = [{ label: 'Sales', developerName: 'LightningSales', id: '06m1' }, { label: 'Sales (Custom)', developerName: 'Sales', id: '06m2' }, { label: 'Ops', developerName: 'OpsA', id: '06m3' }, { label: 'ops', developerName: 'OpsB', id: '06m4' }];
  assert.equal(session.pickApp(list, 'sales').id, '06m2', 'the developer name Sales, not the label of the app listed first');
  assert.equal(session.pickApp(list, 'sales').warning, 'sales is also the label of app LightningSales; opened the app named Sales. Pass LightningSales to open that one');
  assert.equal(session.pickApp(list, 'Sales (Custom)').warning, undefined, 'control: a label pick warns of nothing');
  assert.equal(session.pickApp([...list, list[1]], 'Sales').warning?.startsWith('Sales is also the label of app LightningSales;'), true, 'a repeated entry is no other app');
  assert.match(session.pickApp([...list, list[0]], 'sales').warning, /label of app LightningSales; /, 'an app listed twice is named once');
  assert.equal(session.pickApp([list[2], { ...list[2] }], 'OPS').id, '06m3', 'an app listed twice opens by its label');
  assert.equal(session.pickApp([{ label: null, developerName: 'Nolabel', id: '06m9' }, list[0]], 'sales').id, '06m1', 'an app with no label does not break the pick');
  const pkg = [{ label: 'Pkg', developerName: 'Same', id: '06mA' }, { label: 'Pkg', developerName: 'Same', id: '06mB' }];
  assert.throws(() => session.pickApp(pkg, 'pkg'), (e) => e.code === 'AMBIGUOUS', 'two packages shipping one developerName stay ambiguous');
  const own = { label: 'Own', developerName: 'Own', id: '06m5' };
  assert.equal(session.pickApp([own, { ...own }], 'own').warning, undefined, 'an app that is its own label, listed twice, is no other app');
  assert.equal(session.pickApp(list, 'Sales (Custom)').id, '06m2', 'control: a label still picks');
  assert.throws(() => session.pickApp(list, 'Ops'), (e) => e.code === 'AMBIGUOUS' && JSON.stringify(e.evidence.developerNames) === '["OpsA","OpsB"]');
  assert.equal(session.pickApp(list, 'OpsB').id, '06m4', 'control: its developer name picks it');
});

// A local server as the org: it answers the bearer reads, and the frontdoor page never finishes loading.
test('start has one deadline: a page that never loads ends START_TIMEOUT within it', { timeout: 30_000 }, async () => {
  const http = require('node:http');
  const srv = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    const json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/services/oauth2/userinfo')) return json({ organization_id: '00D', user_id: '005' });
    if (req.url === '/services/data/') return json([{ version: '60.0' }]);
    if (req.url.startsWith('/services/data/v60.0/query')) return json({ records: [{ IsSandbox: true }] });
    res.setHeader('Content-Type', 'text/html');
    res.end('<img src="/hang">');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const origin = `http://127.0.0.1:${srv.address().port}`;
    const t0 = Date.now();
    await assert.rejects(session.start({ instanceUrl: origin, accessToken: 'x' }, { deadline: Date.now() + 2_000 }), (e) => e.code === 'START_TIMEOUT' && e.evidence.deadlineMs > 1_500 && e.evidence.deadlineMs <= 2_000);
    assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0} ms`);
  } finally { srv.closeAllConnections(); srv.close(); }
});

// No org: Playwright's headed launch error on a host with no display is NO_DISPLAY; a headless one is not retyped.
test('a headed launch with no display is NO_DISPLAY', async (t) => {
  const { chromium } = require('playwright-core');
  const raw = new Error('browserType.launch: Looks like you launched a headed browser without having a XServer running.\nSet either \'headless: true\' or use \'xvfb-run <your-playwright-app>\' before running Playwright.');
  t.mock.method(chromium, 'launch', async () => { throw raw; });
  await assert.rejects(session.start({ instanceUrl: 'https://sf-ui.invalid', accessToken: 'x' }, { headless: false }), { code: 'NO_DISPLAY' });
  await assert.rejects(session.start({ instanceUrl: 'https://sf-ui.invalid', accessToken: 'x' }), (e) => e === raw, 'headless keeps the raw error');
});

// No org: the launch gets the time left, and its own timeout is START_TIMEOUT, not Playwright's 180 s default or a raw error.
test('a launch that outlasts the deadline is START_TIMEOUT', async (t) => {
  const { chromium } = require('playwright-core');
  let given;
  t.mock.method(chromium, 'launch', async (o) => { given = o; throw Object.assign(new Error('browserType.launch: Timeout 2000ms exceeded.'), { name: 'TimeoutError' }); });
  await assert.rejects(session.start({ instanceUrl: 'https://sf-ui.invalid', accessToken: 'x' }, { deadline: Date.now() + 2_000 }), (e) => e.code === 'START_TIMEOUT' && e.evidence.deadlineMs <= 2_000);
  assert.ok(given.timeout > 0 && given.timeout <= 2_000, `launch timeout ${given.timeout}`);
});

// A local server as the org whose userinfo never answers: the bearer reads carry the deadline too.
test('start ends START_TIMEOUT at its deadline when the org never answers a bearer read', { timeout: 20_000 }, async () => { // 8 s: the launch fits, then the hung read is cut at the deadline
  const http = require('node:http');
  const srv = http.createServer(() => {}); // answers nothing
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const t0 = Date.now();
    await assert.rejects(session.start({ instanceUrl: `http://127.0.0.1:${srv.address().port}`, accessToken: 'x' }, { deadline: Date.now() + 8_000 }), { code: 'START_TIMEOUT' });
    assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0} ms`);
  } finally { srv.closeAllConnections(); srv.close(); }
});

// A local server that sends the headers and stalls the body: the signal's TimeoutError is not "not JSON".
test('a bearer read whose body stalls past the signal ends as a TimeoutError, not API_ERROR', { timeout: 20_000 }, async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('['); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const s = { instanceUrl: `http://127.0.0.1:${srv.address().port}`, accessToken: 'x' };
    await assert.rejects(session.latestVersion(s, AbortSignal.timeout(500)), (e) => e.name === 'TimeoutError', 'the stalled body is the deadline');
  } finally { srv.closeAllConnections(); srv.close(); }
});

// A local server that sends half a body and resets: the coded body-read error (the reset) is kept, not "not JSON".
test('a bearer read whose body is reset keeps the coded reset, not "not JSON"', { timeout: 20_000 }, async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' }); res.write('['); setTimeout(() => req.socket.destroy(), 50); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const s = { instanceUrl: `http://127.0.0.1:${srv.address().port}`, accessToken: 'x' };
    await assert.rejects(session.latestVersion(s), (e) => e.code === 'API_ERROR' && !/not JSON/.test(e.message) && !!e.evidence.cause, 'the reset is the error');
  } finally { srv.closeAllConnections(); srv.close(); }
});

// A local server whose Metadata API never answers: loginAsEnabled stops at the signal it is given.
test('loginAsEnabled ends at the signal it is given', { timeout: 20_000 }, async () => {
  const http = require('node:http');
  const srv = http.createServer(() => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const s = { instanceUrl: `http://127.0.0.1:${srv.address().port}`, accessToken: 'x', apiVersion: '60.0' };
    await assert.rejects(session.loginAsEnabled(s, { signal: AbortSignal.timeout(500) }), { name: 'TimeoutError' });
  } finally { srv.closeAllConnections(); srv.close(); }
});
