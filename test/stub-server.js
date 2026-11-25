'use strict';

// Preloaded into server.js (node -r) for tests that need no org or Chrome: a fake launch, and a locate whose
// component "slow" answers only after "fast" has been read, so the two calls overlap in a known order.
const lib = require('..');

// The session's token, and a Playwright timeout whose call log carries it as frontdoor's sid=; alias "leak" starts so.
const TOKEN = '00Dstub!tok-secret';
const timeout = (url) => Object.assign(new Error(`page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "${url}"`), { name: 'TimeoutError' });
const frontdoor = `https://x/secur/frontdoor.jsp?sid=${TOKEN}&retURL=%2F`;
if (process.env.STUB_START_MS) lib.session.START_MS = Number(process.env.STUB_START_MS); // a short start deadline
lib.session.fromAlias = async (alias) => ({ alias, ...(alias === 'bare' && { accessToken: TOKEN }) }); // bare: a start that fails with the bare token
let n = 0;
// alias toasts: a page with a toast list; sf_press arms as the real press does, and key Toast raises a "Saved" toast.
let raiseToast = () => {};
const realPress = lib.act.press;
lib.act.press = async (page, opts) => {
  if (!page.toasts) return realPress(page, opts);
  await lib.act.armToasts(page);
  if (opts.key === 'Toast') raiseToast({ type: 'success', title: 'Saved' });
  return {};
};
lib.session.start = async ({ alias }, opts = {}) => {
  if (alias === 'leak') throw timeout(frontdoor);
  if (alias === 'bare') throw new Error(`stub: launch failed holding ${TOKEN}`);
  if (alias === 'toasts') {
    const context = { exposeFunction: async (n, fn) => { raiseToast = fn; }, addInitScript: async () => {} };
    await lib.act.recordToasts(context);
    return { alias, browser: {}, tokenUserId: '005stubt', apiVersion: '60.0', accessToken: TOKEN, page: { toasts: true, isClosed: () => false, url: () => frontdoor, context: () => context, ariaSnapshot: async () => 'page', evaluate: async () => ({ covered: [] }) } };
  }
  if (alias === 'launch') throw new lib.SfUiError('STUB_LAUNCH', 'stub', { headless: opts.headless }); // the launch options sf_start passed
  return { alias, noApp: alias === 'noapp', production: alias === 'prod', browser: alias === 'closed' ? { isConnected: () => false } : alias === 'dies' ? { alive: true, isConnected() { return this.alive; } } : alias === 'noquit' ? { isConnected: () => false } : {}, tokenUserId: `005stub${(n += 1)}`, apiVersion: '60.0', accessToken: TOKEN, page: { isClosed: () => alias === 'shut', url: () => frontdoor, screenshot: async ({ path: file } = {}) => { if (file) require('node:fs').writeFileSync(file, 'stub png'); return Buffer.from('stub png'); } } };
};
lib.session.loginAsEnabled = async (s) => { if (s.alias === 'slowlogin') throw timeout(frontdoor); return { loginAs: true }; }; // slowlogin: the policy read runs past the deadline
let reads = 0;
let polls = 0;
// STUB_READ_PERSONA: a read names a logged-in user, as the real one does, and asking personaOf again is an error.
// reads counts the reads that include the page.
lib.validity.read = async (s, limit, alias, withPage = true) => {
  if (withPage) reads += 1;
  const named = process.env.STUB_READ_PERSONA && s.loggedInAs && { profile: 'Read Only', permissionSets: ['Probe_Read'] };
  // STUB_READ_FILE: a JSON file whose keys replace the read's, so a test changes what the page and persona read as between runs.
  const over = process.env.STUB_READ_FILE && require('node:fs').existsSync(process.env.STUB_READ_FILE) ? JSON.parse(require('node:fs').readFileSync(process.env.STUB_READ_FILE, 'utf8')) : {};
  return { ...(alias && { persona: { profile: 'Alias', permissionSets: [] } }), ...(named && { persona: named }), ...(withPage && { page: { object: 'Stub__c', formHash: 'now' } }), ...over };
};
// STUB_READ_UNREAD: a read whose part threw.
lib.validity.readParts = async (s, limit, alias, withPage) => ({ read: await lib.validity.read(s, limit, alias, withPage), unread: JSON.parse(process.env.STUB_READ_UNREAD || '[]') });
const readParts = lib.validity.readParts;
lib.validity.readParts = async (...a) => { const out = await readParts(...a); return { ...out, read: Object.keys(out.read || {}).length ? out.read : null }; }; // as the real read: null when empty
lib.session.end = async (s) => { if (s.alias === 'noquit') throw new Error('stub: Chrome would not quit'); if (s.browser?.alive) s.browser.alive = false; }; // alias dies: ending its browser disconnects it
// sf_verify_checks with no org: a check file named red.json is red, notrun.json not run, none.json nothing checked, and the line names the org and path it was given.
// slow.json answers after 1 s, so a test can end and restart the session meanwhile.
require('../src/access').run = async ({ org, checksFile, project }) => {
  if (/slow\.json$/.test(checksFile ?? '')) await new Promise((r) => setTimeout(r, 1000));
  if (/notrun\.json$/.test(checksFile ?? '')) return { verdict: 'not run', exit: 2, lines: [], problems: ['stub: git diffs past 60 s'] };
  if (/timed\.json$/.test(checksFile ?? '')) return { verdict: 'not run', exit: 2, lines: ['time: connect 1 ms, total 2 ms', 'changed 0, covered 0'], problems: ['no check ran'] };
  if (/none\.json$/.test(checksFile ?? '')) return { verdict: 'nothing checked', exit: 0, lines: [] };
  const red = /red\.json$/.test(checksFile ?? '');
  return { verdict: red ? 'red' : 'green', exit: Number(red), lines: [`${red ? 'FAIL' : 'PASS'} ${org} ${checksFile ?? project}`] };
};
// A build check that fails, so a test can record a failed check with no org.
lib.deploy.verifyLive = async (s, recordId, lwcApiName, marker) => { throw new lib.SfUiError('STALE_BUILD', 'stub', { recordId, lwcApiName, marker }); };

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const slowFound = deferred();
const fastRead = deferred();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const none = async () => ({ covered: [] }); // a covered pass that ran and found nothing
lib.lwc.locate = async (s, recordId, lwcApiName) => {
  if (lwcApiName === 'long') return { host: { ariaSnapshot: async () => 'x'.repeat(7000), evaluate: none }, foundBy: { via: 'long' } };
  if (lwcApiName === 'late') { await sleep(1500); return { host: { ariaSnapshot: async () => 'late', evaluate: none }, foundBy: { via: 'late' } }; }
  // A component whose covered pass finds the T1 overlay, and one whose covered pass never answers.
  if (lwcApiName === 'covered') return { host: { ariaSnapshot: async () => 'covered', evaluate: async () => ({ covered: [{ text: 'Size chosen: Large', top: { tag: 'span', label: '' } }], checked: 1, stopped: false }) }, foundBy: { via: 'covered' } };
  if (lwcApiName === 'stuck') return { host: { ariaSnapshot: async () => 'stuck', evaluate: () => new Promise(() => {}) }, foundBy: { via: 'stuck' } };
  if (lwcApiName === 'slow') {
    slowFound.resolve();
    return { host: { ariaSnapshot: async () => { await fastRead.promise; return 'slow'; }, evaluate: none }, foundBy: { via: 'slow' } };
  }
  await slowFound.promise;
  await new Promise(setImmediate); // after the slow call has stored its foundBy
  return { host: { ariaSnapshot: async () => { fastRead.resolve(); return 'fast'; }, evaluate: none }, foundBy: { via: 'fast' } };
};

// A click answers with its moment only, a fill with nothing.
let moves = 0;
// A click on the text "navigate" moves the page to a new URL, as a link does.
lib.act.click = async (page, args) => { if (args?.name === 'Nowhere') throw new lib.SfUiError('NOT_FOUND', 'stub: no such target'); if (args?.text === 'navigate') { const to = `https://x/lightning/r/Stub__c/001STUB0000000A/view?n=${(moves += 1)}`; page.url = () => to; } return { [lib.AT]: { clicked: new Date().toISOString() } }; };
lib.act.fill = async () => {};

// sf_api answers that would collide with the wrapper's at (one with its own at, ones that are not objects),
// and a failure that carries the moments a tool reached before it threw.
const answers = { '/created': { recordId: '001STUB' }, '/created-at': { at: 'x', recordId: '001ATBOX' }, '/created-mixed': { recordId: 5, result: { recordId: '001MIX' } }, '/own-at': { at: 'x', n: 1 }, '/string': 'abc', '/number': 0, '/list': [1, 2], '/null': null, '/empty': {}, '/slow': { n: 1 } };
lib.api.assertRead = () => {}; // the paths below are fake answers, not org paths
lib.api.call = async (s, path) => {
  if (path === '/reads') return { reads };
  if (path === '/polls') return { polls: (polls += 1) }; // counts each poll
  if (path === '/polled') return { polls };
  if (path.startsWith('/echo/')) return { echo: path }; // a path that carries a record id, to assert on
  if (path.startsWith('/chain/')) return { recordId: '001CHAIN' }; // a read that takes one id and answers another
  if (path === '/fails') throw Object.assign(new lib.SfUiError('API_ERROR', 'stub'), { [lib.AT]: { fileSet: '2000-01-01T00:00:00.000Z' } });
  if (path === '/slow') await sleep(2000);
  if (path === '/slow-fails') { await sleep(1000); throw new lib.SfUiError('API_ERROR', 'stub late'); }
  // The user's tabs in two pages with the custom tabs on page 2, so openTab below must follow nextPageUrl to label one.
  if (path.startsWith('/ui-api/nav-items')) {
    const items = require('./nav-items.json').navItems;
    return path.includes('page=1') ? { navItems: items.slice(0, 2), nextPageUrl: null } : { navItems: items.slice(2), nextPageUrl: '/services/data/v60.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100' };
  }
  // The token in a timeout, in evidence, in an answer, and at the end of a message long enough to be cut.
  if (path === '/leak-timeout') throw timeout(frontdoor);
  if (path === '/coded-timeout') throw new lib.SfUiError('TIMEOUT', 'stub');
  if (path === '/leak-bearer') throw new lib.SfUiError('API_ERROR', 'stub', { cause: `Bearer ${TOKEN}` });
  if (path === '/leak-ok') return { seen: `Bearer ${TOKEN}` };
  if (path.startsWith('/cut/')) throw new Error(`${'x'.repeat(Number(path.slice(5)))} ${TOKEN}`);
  return answers[path];
};

// Apps: a page lands in Sales; openApp picks as the real one does and keeps the app on the session.
// Login As lands the new user's page in Sales again, as a user whose last-used app is Sales.
const APPS = [{ label: 'SF UI App', developerName: 'SfUi_App', id: '06m1', console: false }, { label: 'SF UI Console', developerName: 'SfUi_Console', id: '06m2', console: true }];
// Alias noapp: the app lookup fails, as a UI API error would.
lib.session.apps = async (s) => { if (s.noApp) throw new Error('UI API down'); return APPS; };
lib.session.currentApp = async (s) => {
  if (s.noApp) throw new Error('UI API down');
  return s.pageApp || { label: 'Sales', developerName: 'LightningSales', id: '06m0' };
};
lib.session.openApp = async (s, name) => {
  if (name === 'crash') throw new Error('stub: not an SfUiError');
  const { console: _, ...app } = lib.session.pickApp(s.user === '005noapps' ? [] : APPS, name);
  s.app = s.pageApp = app;
  return app.developerName === 'SfUi_Console' ? { ...app, warning: 'stub warning' } : app; // as openApp returns a name that is also a label
};
// Tabs: openTab runs for real against a page where only SfUi_Vf exists; the page's url shows which name it navigated to.
const realOpenTab = lib.nav.openTab;
lib.nav.openTab = (s, tab, opts) => {
  const main = { or: () => ({ first: () => ({ waitFor: async () => {} }) }), ariaSnapshot: async () => 'tab main' };
  let at;
  const page = {
    url: () => at,
    evaluate: async () => null,
    goto: async (u) => { at = u; s.page.url = () => u; },
    getByRole: (role) => (role === 'main' ? main : { waitFor: async () => {}, isVisible: async () => !at.endsWith('/lightning/n/SfUi_Vf') }),
  };
  return realOpenTab({ ...s, origin: '', page }, tab, opts);
};
lib.form.createRecord = async () => ({ missing: [], model: { fields: [] } }); // the New dialog opens
lib.session.pageErrors = async () => ({ errors: [] }); // sf_page_errors finds none
const realVerifyLive = lib.deploy.verifyLive; // sf_verify_live finds the marker live, any other is STALE_BUILD as before
lib.deploy.verifyLive = async (s, recordId, lwcApiName, marker, o) => marker === 'live' || realVerifyLive(s, recordId, lwcApiName, marker, o);
lib.discover.actions = async () => []; // the real one opens the record page; the stub opens none
lib.assert.fieldValue = async () => ({}); // sf_assert_field passes
lib.discover.formModel = async () => ({ fields: [] }); // the New form: the layout, no page
// sf_form_model with a recordId, or a scoped tool given only one, opens the record page: an id moves the page to it.
lib.nav.openRecord = async (s, recordId) => { if (lib.nav.isId(recordId)) { const to = `https://x/lightning/r/Stub__c/${recordId}/view`; s.page.url = () => to; } };
lib.discover.renderedPage = async () => undefined;
lib.session.resize = async (s, { width, height = 956 }) => (s.size = { width, height });
lib.session.viewportOf = (s) => s.size ?? { width: 1470, height: 956 }; // sf_viewport reflows nothing
// sf_measure and sf_on_top read a fixed layout: a 200 px tall box, half in view.
lib.layer.measure = async () => ({ count: 1, elements: [{ rect: { y: 40, height: 200 }, visible: 0.5 }] });
lib.layer.onTop = async () => ({ onTop: true, visible: 0.5, box: { y: 40 } });
lib.navmap.build = async () => ({ seconds: 0, rounds: 0, pages: {}, components: {} }); // sf_map_feature maps nothing
lib.navmap.route = async () => ({ steps: [] });
// The pre-run check: a saved FlexiPage named Stale_Page has changed in the org, any other saved part has not.
const realCheck = lib.validity.check;
lib.validity.check = async (s, saved) => {
  if (saved?.page?.flexiPage === 'Api_Error_Page') throw new lib.SfUiError('API_ERROR', 'stub: the org refused the check');
  if (saved?.page?.flexiPage === 'Bug_Page') throw new TypeError('stub: a bug in the check');
  return checked(s, saved);
};
const checked = async (s, saved) => (saved?.page?.flexiPage === 'Stale_Page' ? { state: 'stale', stale: ['FlexiPage Stale_Page'] }
  : saved?.page || saved?.app || saved?.persona ? { state: 'valid' } : realCheck(s, saved));
// STUB_SNAP_ID: sf_page_snapshot reads a record page with this id, as a page left open by an earlier scenario would.
lib.act.mainOf = async () => ({ ariaSnapshot: async () => 'main', evaluate: async () => ({ covered: [] }) });
const realRecordIdOf = lib.nav.recordIdOf;
lib.nav.recordIdOf = (url, tail) => process.env.STUB_SNAP_ID || realRecordIdOf(url, tail);
lib.discover.userId = async (s, user) => user;
lib.session.loginAs = async (s, userId) => {
  if (userId === '005fail') { s.loggedInAs = 'unknown'; throw new lib.SfUiError('WRONG_USER', 'stub: the page runs as someone else'); }
  s.user = userId; s.pageApp = undefined; s.loggedInAs = userId;
};
lib.validity.personaOf = async (s) => process.env.STUB_READ_PERSONA ? Promise.reject(new Error('personaOf asked again')) : s?.loggedInAs && { profile: 'Read Only', permissionSets: ['Probe_Read'] };
lib.session.whoAmI = async (s) => s.user || s.tokenUserId;
// Action Toast_Only opens no dialog and raises a toast, as a headless quick action does.
lib.action.launch = async (s, recordId, apiName) => (apiName === 'Toast_Only' ? { toasts: [{ type: 'success', title: 'Bumped' }] } : null);
