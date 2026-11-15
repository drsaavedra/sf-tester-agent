'use strict';

// Session lifecycle: log in from a token, prove who the page runs as, switch user with Login As.
const { SfUiError, fetchCoded } = require('./errors');
const api = require('./api');
const wait = require('./wait');
const { recordToasts } = require('./act');
const { setTimeout: sleep } = require('node:timers/promises');

// The core throws at load on a Node it does not support (below 22.10: webidl.util.markAsUncloneable), so say which
// Node, and blame it only below 22.10; above, the load error is the cause (a dependency missing from the CLI).
function loadCore(dir) {
  try { return require(dir); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && /'@salesforce\/core'/.test(e.message)) throw e;
    const node = process.versions.node;
    const [major, minor] = node.split('.').map(Number);
    const next = major < 22 || (major === 22 && minor < 10) ? 'sf-tester needs Node 22.10 or later' : 'reinstall the sf CLI (npm install -g @salesforce/cli): this Node is new enough';
    throw Object.assign(new SfUiError('SF_CORE_LOAD_FAILED', `the sf CLI's @salesforce/core did not load on Node v${node}: ${e.message}. ${next}`, { node: `v${node}`, cause: e.message }), { cause: e });
  }
}
// The sf CLI's own @salesforce/core, found on PATH with no shell, so it reads auth the way that CLI wrote it;
// an installed @salesforce/core is the fallback.
function sfCore(env = process.env) {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of ['sf', 'sf.cmd']) {
      const bin = path.join(dir, name);
      if (!fs.existsSync(bin)) continue;
      // ponytail: npm's bin link (macOS, Linux) and npm's Windows shim dir; the .pkg and .exe installers are unverified.
      const cores = [path.join(path.dirname(fs.realpathSync(bin)), '..'), path.join(dir, 'node_modules', '@salesforce', 'cli')].map((p) => path.join(p, 'node_modules', '@salesforce', 'core'));
      const core = cores.find((c) => fs.existsSync(c));
      if (core) return loadCore(core);
    }
  }
  try { return loadCore('@salesforce/core'); } catch (e) {
    if (e.code === 'SF_CORE_LOAD_FAILED') throw e;
    throw new SfUiError('NO_SF_CLI', 'no sf CLI found on PATH: install it (npm install -g @salesforce/cli) and log in to the org, or npm install @salesforce/core beside sf-tester', {});
  }
}

// The browser Playwright drives: installed Google Chrome by default; SF_TESTER_BROWSER=chromium for Playwright's own
// Chromium (npx playwright-core install chromium here, for the pinned build), or another channel such as msedge.
const browserChannel = (env = process.env) => (env.SF_TESTER_BROWSER === 'chromium' ? undefined : env.SF_TESTER_BROWSER || 'chrome');

// A live token for an sf CLI alias, taken from the CLI's own @salesforce/core and never printed.
async function fromAlias(alias) {
  const { Org, StateAggregator } = sfCore();
  // The library reads alias.json once per process; this server outlives that, so reread it like each sf command does.
  StateAggregator.clearInstance();
  const org = await Org.create({ aliasOrUsername: alias }).catch(async (e) => {
    if (e.name !== 'NamedOrgNotFoundError') throw e;
    // Core reports an auth file it could not read (keychain locked, EACCES) as not found too; tell the two apart.
    const state = await StateAggregator.getInstance();
    const username = state.aliases.resolveUsername(alias);
    if (await state.orgs.hasFile(username)) {
      throw new SfUiError('AUTH_UNREADABLE', `${alias} has auth, but it could not be read (keychain or file access); try sf org display -o ${alias}`, { alias, username, cause: e.message });
    }
    throw new SfUiError('NO_AUTH', `no sf CLI alias or username ${alias} has auth here; check sf alias list`, { alias, cause: e.message });
  });
  const conn = org.getConnection();
  await conn.refreshAuth();
  return { instanceUrl: conn.instanceUrl, accessToken: conn.accessToken, username: org.getUsername() };
}

// An sf CLI alias's username; anything that is not an alias comes back as given.
async function aliasUsername(alias) {
  const { StateAggregator } = sfCore();
  StateAggregator.clearInstance();
  return (await StateAggregator.getInstance()).aliases.resolveUsername(alias);
}

// Org clock minus this one: the Date header counts whole seconds, so take its mid-second; good to about 1 s.
function skewFrom(res, sent, got) {
  const date = Date.parse(res.headers.get('date'));
  return date ? date + 500 - Math.round((sent + got) / 2) : undefined;
}

async function bearer(s, path, signal) {
  const sent = Date.now();
  const res = await fetchCoded(s.instanceUrl + path, { headers: { Authorization: `Bearer ${s.accessToken}` }, signal });
  s.serverSkewMs = skewFrom(res, sent, Date.now()) ?? s.serverSkewMs;
  if (!res.ok) throw new SfUiError('API_ERROR', `${path} answered ${res.status}`, { status: res.status });
  // An empty body or an HTML page (a proxy, a login interstitial) is not JSON: a coded error, as api.call gives. The signal's own
  // abort is not, and a body read that failed (a reset) keeps its own coded error.
  try { return await res.json(); } catch (e) { if (e instanceof SfUiError || ['TimeoutError', 'AbortError'].includes(e?.name)) throw e; throw new SfUiError('API_ERROR', `${path} answered ${res.status}, not JSON`, { status: res.status }); }
}

// The org's latest API version: the last entry /services/data/ lists.
async function latestVersion(s, signal) {
  const list = await bearer(s, '/services/data/', signal);
  const version = Array.isArray(list) ? list.at(-1)?.version : undefined;
  if (!version) throw new SfUiError('API_ERROR', '/services/data/ listed no API version', { body: (JSON.stringify(list) ?? '').slice(0, 200) });
  return version;
}

// Each browser's Chrome process, read at launch: once Chrome has gone, Playwright no longer hands it out.
const chromes = new WeakMap();

// The default screen of a 13-inch MacBook Air (13.6", 2560x1664 at its default scaling), in CSS px.
const VIEWPORT = { width: 1470, height: 956 };

// Not a sandbox, no trial expiry (a scratch org has one) and not a Developer Edition org is production. It runs like any
// other org, and sf_start says so: the developer chose it, and what a tester may do there is the agent file's rule.
const ORG_QUERY = 'SELECT IsSandbox, TrialExpirationDate, OrganizationType FROM Organization';
const isProduction = (org) => !org.IsSandbox && !org.TrialExpirationDate && org.OrganizationType !== 'Developer Edition';

// One deadline for sf_start's launch, login and app open, under CI replay's 180 s sf_start ceiling.
const START_MS = 150_000;

const startTimeout = (e, ms) => new SfUiError('START_TIMEOUT', `the browser did not reach Lightning in time: ${e.message.split('\n')[0]}`, { deadlineMs: ms });

async function start({ instanceUrl, accessToken }, { headless = true, channel = browserChannel(), deadline = Date.now() + START_MS } = {}) {
  const budget = deadline - Date.now(); // what this start was given, for START_TIMEOUT's evidence
  const { chromium } = require('playwright-core');
  // The server's own exit kills Chrome; Playwright's signal handlers would wait on the updater's pipe instead.
  const browser = await chromium.launch({ channel, headless, timeout: wait.left(deadline), handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false }).catch((e) => {
    // Playwright's text for a headed launch on a host with no display (Linux: no XServer or $DISPLAY).
    if (!headless && /without having a XServer|Missing X server|\$DISPLAY|cannot open display/i.test(e.message)) throw new SfUiError('NO_DISPLAY', 'headed: true needs a display, and this host has none; start without headed, or run where a window can open', { headed: true });
    throw e.name === 'TimeoutError' ? startTimeout(e, budget) : e; // a launch that outlasts the deadline
  });
  try {
    // ponytail: in-process internals, as Playwright's Electron client reads them; launchServer().process() is public.
    try { chromes.set(browser, browser._connection?.toImpl?.(browser)?.options?.browserProcess?.process); } catch { /* no handle: plain bounded close */ }
    const context = await browser.newContext({ viewport: VIEWPORT });
    // Lightning's load event can pass Playwright's 30 s default with several browsers starting; 60 s matches its wait.
    context.setDefaultNavigationTimeout(60_000);
    const toasts = await recordToasts(context); // on from the first document, so every path's toasts are heard
    const page = await context.newPage();
    const s = { browser, context, page, instanceUrl, accessToken, toasts, errors: [], dropped: 0 };
    // Errors, newest 50, for pageErrors: a crash may show nothing on screen. Aura windows log their uncaught
    // errors as console "Uncaught Error: ..."; an iframe without Aura (Visualforce, a widget) raises pageerror.
    const keep = (message) => {
      s.errors.push({ message: String(message).slice(0, 500), at: new Date().toISOString() });
      if (s.errors.length > 50) { s.errors.shift(); s.dropped += 1; }
    };
    page.on('console', (m) => { if (m.type() === 'error') keep(m.text()); });
    page.on('pageerror', (e) => keep(`Uncaught ${e.name}: ${e.message}`));
    const signal = AbortSignal.timeout(wait.left(deadline)); // a hung org answer ends the start at the deadline, as a TimeoutError
    const me = await bearer(s, '/services/oauth2/userinfo', signal);
    s.orgId = me.organization_id;
    s.tokenUserId = me.user_id;
    s.apiVersion = await latestVersion(s, signal);
    const [org] = (await bearer(s, `/services/data/v${s.apiVersion}/query?q=${encodeURIComponent(ORG_QUERY)}`, signal)).records;
    s.production = isProduction(org);
    await page.goto(`${instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(accessToken)}&retURL=${encodeURIComponent('/lightning/page/home')}`, { timeout: wait.left(deadline, 60_000) });
    await wait.lightning(page, { timeout: wait.left(deadline, 60_000) });
    s.origin = new URL(page.url()).origin;
    await assertIs(s, s.tokenUserId);
    return s;
  } catch (e) {
    await end({ browser }); // any failure after the launch closes it; past the updater's wake, within 5 s
    if (e.name === 'TimeoutError') throw startTimeout(e, budget);
    throw e;
  }
}

function whoAmI(s) {
  return s.page.evaluate(() => $A.get('$SObjectType.CurrentUser.Id'));
}

async function assertIs(s, userId) {
  const actual = await whoAmI(s);
  if (actual.slice(0, 15) !== userId.slice(0, 15)) {
    throw new SfUiError('WRONG_USER', `page runs as ${actual}, expected ${userId}`, { actual, expected: userId });
  }
  return true;
}

// Login Access Policies, read from SecuritySettings with the token owner's session.
async function loginAsEnabled(s, { signal } = {}) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata"><soapenv:Header><met:SessionHeader><met:sessionId>${s.accessToken}</met:sessionId></met:SessionHeader></soapenv:Header><soapenv:Body><met:readMetadata><met:type>SecuritySettings</met:type><met:fullNames>Security</met:fullNames></met:readMetadata></soapenv:Body></soapenv:Envelope>`;
  const res = await fetchCoded(`${s.instanceUrl}/services/Soap/m/${s.apiVersion}`, { method: 'POST', headers: { 'Content-Type': 'text/xml', SOAPAction: '""' }, body: xml, signal });
  const body = await res.text();
  if (!res.ok) throw new SfUiError('API_ERROR', `readMetadata SecuritySettings answered ${res.status}`, { status: res.status });
  const flag = (name) => new RegExp(`<${name}>true</${name}>`).test(body);
  return { loginAs: flag('enableAdminLoginAsAnyUser'), forceRelogin: flag('forceRelogin') };
}

// Admin session becomes the target user for the whole browser context, then proves it.
// Browsers from one alias share one Salesforce session, so the others may fail their next record open.
async function loginAs(s, userId) {
  if (!(await loginAsEnabled(s)).loginAs) {
    throw new SfUiError('LOGIN_AS_DISABLED', 'tick "Administrators Can Log in as Any User" in Setup > Login Access Policies');
  }
  const back = encodeURIComponent('/lightning/page/home');
  s.loggedInAs = 'unknown'; // a login that fails can leave the page on anyone
  delete s.keyPrefixes; // the objects the last user could see (discover.objectOf), not this one's
  await s.page.goto(`${s.instanceUrl}/servlet/servlet.su?oid=${s.orgId}&suorgadminid=${userId}&retURL=${back}&targetURL=${back}`);
  await wait.lightning(s.page);
  await assertIs(s, userId);
  s.loggedInAs = userId; // sf_start makes a new session, so this ends with it
  return s;
}

// The Lightning apps the page's user can open (UI API as that user); console from AppDefinition, which UI API lacks.
// ponytail: Lightning apps only; a Classic app is not offered.
async function apps(s) {
  const list = (await api.call(s, '/ui-api/apps?formFactor=Large')).apps.filter((a) => a.appId && a.type === 'Lightning');
  const consoles = (await api.call(s, `/query?q=${encodeURIComponent("SELECT DurableId FROM AppDefinition WHERE NavType = 'Console'")}`, { as: 'admin' })).records.map((r) => r.DurableId);
  return list.map((a) => ({ label: a.label, developerName: a.developerName, id: a.appId, console: consoles.includes(a.appId) }));
}

const fold = (x) => String(x ?? '').toLowerCase();
const distinct = (list, key) => list.filter((x, i) => list.findIndex((y) => fold(y[key]) === fold(x[key])) === i); // a repeated entry once, its first

// The name-wins warning: hit, plus the other entries (by name, not reference, each once) whose label is the typed value.
function nameWins(hit, byLabel, typed, kind, key) {
  const others = byLabel.filter((x) => fold(x[key]) !== fold(hit[key]));
  if (!others.length) return hit;
  const names = distinct(others, key).map((x) => x[key]);
  return { ...hit, warning: `${typed} is also the label of ${kind}${names.length > 1 ? 's' : ''} ${names.join(', ')}; opened the ${kind} named ${hit[key]}. Pass ${names.join(' or ')} to open that one` };
}

// An app by developer name, else by label, any case: labels are not unique, so two label matches are AMBIGUOUS.
// APP_UNAVAILABLE lists the apps this user can open.
function pickApp(list, name) {
  const byName = list.find((a) => fold(a.developerName) === fold(name));
  const byLabel = distinct(list.filter((a) => fold(a.label) === fold(name)), 'id');
  if (byName) return nameWins(byName, byLabel, name, 'app', 'developerName');
  if (byLabel.length > 1) throw new SfUiError('AMBIGUOUS', `${byLabel.length} apps are labelled ${name}: name one by developerName`, { app: name, developerNames: byLabel.map((a) => a.developerName) });
  if (!byLabel.length) throw new SfUiError('APP_UNAVAILABLE', `${name} is not a Lightning app this user can open`, { app: name, apps: list.map(({ id, ...a }) => a) });
  return byLabel[0];
}

// The app the page is in: Lightning keeps it per browser as $Global.appContextId. /ui-api/apps/selected is the
// user's last-used app, which only the App Launcher saves, so it does not follow an app opened by URL.
async function currentApp(s, list) {
  // Empty for a few seconds after a page load: waited for up to 15 s, but not on a page with no Aura (no app there).
  await s.page.waitForFunction(() => !window.$A || $A.get('$Global.appContextId'), null, { timeout: 15_000 }).catch(() => {}); // then read what is there
  const id = await s.page.evaluate(() => (window.$A ? $A.get('$Global.appContextId') : ''));
  const { label, developerName } = (list || await apps(s)).find((a) => a.id === id) || {};
  return { label, developerName, id };
}

// Opens an app in this browser by its URL, leaving the user's last-used app in the org as it was; kept as s.app.
async function openApp(s, name, { timeout = 60_000 } = {}) {
  const list = await apps(s);
  const { id, warning } = pickApp(list, name);
  const end = Date.now() + timeout; // goto and the wait share the caller's timeout
  const notOpened = async () => {
    const seen = await s.page.evaluate(() => (window.$A ? $A.get('$Global.appContextId') : null)).catch(() => null);
    return new SfUiError('APP_NOT_OPENED', `${name} did not open in ${timeout / 1000} s: the page shows app ${seen || 'none'} at ${s.page.url()}`, { app: name, id, appContextId: seen, url: s.page.url() });
  };
  await s.page.goto(`${s.origin}/lightning/app/${id}`, { timeout: wait.left(end) }).catch(async (e) => { throw e.name === 'TimeoutError' ? await notOpened() : e; });
  // Loaded once the URL has left /lightning/app/ for the app's first page and Lightning names the app; a console
  // app stays on /lightning with no slash after it, which wait.lightning's URL test never matches.
  const loaded = (want) => !location.pathname.startsWith('/lightning/app/') && window.$A && $A.get && $A.get('$SObjectType.CurrentUser.Id') && $A.get('$Global.appContextId') === want;
  await s.page.waitForFunction(loaded, id, { timeout: wait.left(end) }).catch(async (e) => {
    if (e.name !== 'TimeoutError') throw e;
    throw await notOpened();
  });
  s.app = await currentApp(s, list);
  return warning ? { ...s.app, warning } : s.app;
}

// sf-tester finds Lightning's own controls by their English names (Edit, Save, Upload Files, Done, Close...).
// ponytail: English UI only; another language throws here instead of a misleading NOT_FOUND further on.
async function requireEnglish(s) {
  const lang = await s.page.evaluate(() => (window.$A ? $A.get('$Locale.langLocale') : null));
  if (lang && !/^en/.test(lang)) throw new SfUiError('UNSUPPORTED_LANGUAGE', `the user's language is ${lang}; sf-tester finds Lightning's own controls by their English names`, { lang });
}

// The errors kept since the last call, oldest first, and how many older ones the cap dropped; reading clears both.
function pageErrors(s) {
  const out = { errors: s.errors.splice(0), dropped: s.dropped };
  s.dropped = 0;
  return out;
}

// Chrome exits, but the GoogleUpdater it woke (its own process group) holds Chrome's stdout and stderr, so close()
// waits until the updater quits, minutes later, and keeps this process alive. Give it 5 s first.
// A real resize: the page reflows to it, so a breakpoint or a narrower window can be measured. Height defaults to now.
async function resize(s, { width, height }) {
  await s.page.setViewportSize({ width, height: height ?? s.page.viewportSize().height });
  return s.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
}

// The size the page has now: a resize holds for the whole session, so a route saved later must set this one, not the default.
const viewportOf = (s) => s.page.viewportSize();

async function end(s) {
  const closed = s.browser.close();
  if (await Promise.race([closed.then(() => true), sleep(5_000)])) return;
  // Then release the pipes of a Chrome that has exited, so Playwright's cleanup runs; a live Chrome is left to show.
  const proc = chromes.get(s.browser);
  if (!proc || (proc.exitCode === null && proc.signalCode === null)) return;
  for (const pipe of proc.stdio || []) pipe?.destroy();
  await Promise.race([closed, sleep(5_000)]);
}

module.exports = { START_MS, startTimeout, left: wait.left, sfCore, browserChannel, fromAlias, aliasUsername, latestVersion, ORG_QUERY, isProduction, start, whoAmI, assertIs, loginAsEnabled, loginAs, apps, pickApp, nameWins, fold, distinct, currentApp, openApp, requireEnglish, pageErrors, resize, viewportOf, end, skewFrom, VIEWPORT };
