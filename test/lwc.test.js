'use strict';

// LWC navigation from FlexiPage metadata, on the fixture's probe record page: a sidebar component, a component
// inside a non-default tab (reached only by opening the tab the metadata names), a child only another component
// renders, a component the page does not place, and a button that opens a LightningModal.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, nav, discover, lwc, modal, act } = require('..');
const { auth, env, skip, probe, account, localPage, record, stamp } = require('./helpers');

test('lwc', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await probe(s, t);

  await t.test('renderedPage names the FlexiPage the user got', async () => {
    await nav.openRecord(s, id);
    assert.equal(await discover.renderedPage(s), 'SfUi_Probe_Record_Page');
  });

  await t.test('lwcOnPage gives region, tag and the tabs to open', async () => {
    const side = await discover.lwcOnPage(s, 'SfUi_Probe_Record_Page', 'sfUiProbe');
    assert.equal(side.region, 'sidebar');
    assert.deepEqual(side.tabs, []);
    assert.equal(side.tag, 'c-sf-ui-probe');
    const tabbed = await discover.lwcOnPage(s, 'SfUi_Probe_Record_Page', 'sfUiTabbed');
    assert.deepEqual([tabbed.tabs, tabbed.tabsets], [['Probe'], ['flexipage_tabset']]);
  });

  await t.test('lwc.scope opens the tab path before looking for the component', async () => {
    await nav.openRecord(s, id);
    assert.equal(await s.page.locator('c-sf-ui-tabbed').locator('visible=true').count(), 0, 'Probe is not the default tab');
    await s.page.getByRole('tab', { name: 'Notes', exact: true }).waitFor();
    assert.equal(await s.page.getByRole('tab', { name: 'Probe', exact: true }).count(), 2, 'the sidebar tabset has a Probe tab too');
    const host = await lwc.scope(s, id, 'sfUiTabbed');
    assert.equal(await host.isVisible(), true);
  });

  // A reload would wipe the mark, and with it anything an earlier click had opened on the page.
  await t.test('lwc.scope reuses the record page already open instead of reloading it', async () => {
    await lwc.scope(s, id, 'sfUiProbe');
    await s.page.evaluate(() => { window.__sfUiMark = 'kept'; });
    await lwc.scope(s, id, 'sfUiTabbed');
    assert.equal(await s.page.evaluate(() => window.__sfUiMark), 'kept');
  });

  await t.test('lwc.locate finds a child only its parent renders through shadow roots, and says how', async () => {
    assert.equal((await lwc.locate(s, id, 'sfUiProbe')).foundBy.via, 'flexiPage');
    const { host, foundBy } = await lwc.locate(s, id, 'sfUiProbeHelp');
    assert.deepEqual([foundBy.via, foundBy.tag, foundBy.inside[0]], ['shadowRoots', 'c-sf-ui-probe-help', 'c-sf-ui-probe']);
    await host.getByText('Nested help').waitFor({ timeout: 5_000 });
  });

  // Re-pressing an already selected tab takes focus and closes what the component had open, here a button menu.
  await t.test('a second scoped call on a non-default tab keeps the component state', async () => {
    await act.click(await lwc.scope(s, id, 'sfUiMore'), { name: 'Extra actions' });
    await act.click(await lwc.scope(s, id, 'sfUiMore'), { role: 'menuitem', name: 'Restore', timeout: 5_000 });
    await s.page.getByText('Menu chose: restore').waitFor({ timeout: 5_000 });
  });

  // A placed flowruntime:interview renders as flowruntime-flow, not the tag its name spells.
  await t.test('lwc.locate finds a flow placed on a page tab by its placed name', async () => {
    const { host, foundBy } = await lwc.locate(s, id, 'interview');
    assert.deepEqual([foundBy.via, foundBy.tabs], ['flexiPage', ['Flow']]);
    await host.getByText('Page flow: set the count').waitFor({ timeout: 15_000 });
  });

  await t.test('lwc.scope throws NOT_ON_PAGE for a component neither placed on the page nor rendered on it', async () => {
    await assert.rejects(lwc.scope(s, id, 'sfUiNowhere'), (e) => e.code === 'NOT_ON_PAGE' && e.evidence.reason === 'notOnFlexiPage' && /closed tab/.test(e.message)
      && /not placed on SfUi_Probe_Record_Page and no component showing now renders it/.test(e.message));
  });

  // A standard record page has no FlexiPage to read placements from; that is not the same as "not placed".
  await t.test('lwc.scope on a page with no FlexiPage says so, not that the component is unplaced', async () => {
    const acct = await account(s, t);
    await assert.rejects(lwc.scope(s, acct, 'sfUiProbe'), (e) => e.code === 'NOT_ON_PAGE' && e.evidence.reason === 'noFlexiPage');
  });

  // A related-list URL also starts /lightning/r/<object>/<id>/, but it is not the record page to reuse.
  await t.test('lwc.scope reopens the record after its related-list page, rather than reusing it', async () => {
    await s.page.goto(`${s.origin}/lightning/r/SfUiProbe__c/${id}/related/Histories/view`);
    assert.match(s.page.url(), /\/related\//);
    assert.equal(await (await lwc.scope(s, id, 'sfUiProbe')).isVisible(), true);
  });

  await t.test('a click on a button the component lacks is NOT_FOUND with a snapshot', async () => {
    await assert.rejects(act.click(await lwc.scope(s, id, 'sfUiProbe'), { name: 'No Such Button' }), (e) => e.code === 'NOT_FOUND' && /Ping/.test(e.evidence.snapshot));
  });

  await t.test('a click presses a component button and modal.find gets the modal it opens', async () => {
    await lwc.scope(s, id, 'sfUiProbe');
    assert.equal(await s.page.getByRole('dialog').locator('visible=true').count(), 0, 'no dialog before the click');
    await act.click(await lwc.scope(s, id, 'sfUiProbe'), { name: 'Open dialog' });
    const m = await modal.find(s);
    await m.getByRole('heading', { name: 'SF UI Probe Dialog' }).waitFor({ timeout: 15_000 });
    await modal.close(m);
    assert.equal(await m.isVisible(), false);
  });
});

// An Aura component renders no tag of its name, so locate says at once it cannot scope one, not "did not render" in 30 s.
test('lwc.locate refuses an Aura component on a record page at once', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  const id = await record(s, t, 'SfUiC_Aura__c', { Name: `BREAK fix 41 aura ${stamp()}` });
  await nav.openRecord(s, id);
  assert.equal(await discover.renderedPage(s), 'SfUiC_Aura_Record_Page');
  await s.page.getByText('SFUIC Aura Record').first().waitFor({ timeout: 30_000 }); // control: the component shows
  const started = Date.now();
  await assert.rejects(lwc.locate(s, id, 'sfUiCAuraRecord'), (e) => e.code === 'BAD_ARGS' && e.evidence.reason === 'auraComponent' && /Aura component/.test(e.message));
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
});

// No org: a host that paints late makes no Tooling call; one that never paints asks Tooling, and for c only the org's own bundles.
test('lwc.locate asks Tooling only for a host still hidden after 2 s, no org', async (t) => {
  const page = await localPage(t);
  const { api } = require('..');
  const qs = [];
  t.mock.method(api, 'call', async (s, path) => { qs.push(decodeURIComponent(path)); return { records: [{}] }; });
  t.mock.method(nav, 'showsRecord', () => false);
  t.mock.method(nav, 'openRecord', async () => {});
  t.mock.method(discover, 'renderedPage', async () => 'Some_Page');
  let place = { tag: 'c-record-banner', componentName: 'c:recordBanner', tabs: [] };
  t.mock.method(discover, 'lwcOnPage', async () => place);
  const id = '001000000000001AAA';
  await page.setContent('<main></main>');
  await page.evaluate(() => setTimeout(() => { document.querySelector('main').innerHTML = '<c-record-banner>Banner</c-record-banner>'; }, 500));
  const { host } = await lwc.locate({ page }, id, 'recordBanner', { timeout: 5_000 });
  assert.equal(await host.textContent(), 'Banner');
  assert.deepEqual(qs, []);
  await page.setContent('<main></main>'); // never paints: Tooling says Aura
  await assert.rejects(lwc.locate({ page }, id, 'recordBanner', { timeout: 5_000 }), (e) => e.code === 'BAD_ARGS' && e.evidence.reason === 'auraComponent');
  assert.match(qs[0], /DeveloperName = 'recordBanner' AND \(NamespacePrefix = null OR ManageableState NOT IN \('installed', 'installedEditable'/);
  place = { ...place, componentName: 'acme:recordBanner' }; // control: a named namespace keeps its own filter
  await assert.rejects(lwc.locate({ page }, id, 'recordBanner', { timeout: 5_000 }), (e) => e.code === 'BAD_ARGS');
  assert.match(qs[1], /DeveloperName = 'recordBanner' AND NamespacePrefix = 'acme' LIMIT 1$/);
  assert.equal(qs.length, 2);
});

// No org: the 2 s look, the Tooling call and the render wait share one timeout; a Tooling error does not fail the call.
test('lwc.locate keeps one deadline and survives a Tooling error, no org', async (t) => {
  const page = await localPage(t);
  const { api } = require('..');
  let tooling = async () => { throw new Error('INVALID_SESSION_ID'); };
  t.mock.method(api, 'call', async (s, path, opts) => tooling(opts));
  t.mock.method(nav, 'showsRecord', () => false);
  t.mock.method(nav, 'openRecord', async () => {});
  t.mock.method(discover, 'renderedPage', async () => 'Some_Page');
  t.mock.method(discover, 'lwcOnPage', async () => ({ tag: 'c-record-banner', componentName: 'c:recordBanner', tabs: [] }));
  const id = '001000000000001AAA';
  await page.setContent('<main></main>');
  await page.evaluate(() => setTimeout(() => { document.querySelector('main').innerHTML = '<c-record-banner>Banner</c-record-banner>'; }, 2_500));
  const { host } = await lwc.locate({ page }, id, 'recordBanner', { timeout: 5_000 }); // paints after the Tooling error
  assert.equal(await host.textContent(), 'Banner');
  await page.setContent('<main></main>'); // never paints: the Tooling error is evidence on NOT_ON_PAGE
  await assert.rejects(lwc.locate({ page }, id, 'recordBanner', { timeout: 4_000 }), (e) => e.code === 'NOT_ON_PAGE' && e.evidence.auraCheckFailed === 'INVALID_SESSION_ID');
  tooling = async () => { await new Promise((r) => setTimeout(r, 1_000)); return { records: [] }; }; // a slow "not Aura"
  const started = Date.now();
  await assert.rejects(lwc.locate({ page }, id, 'recordBanner', { timeout: 4_000 }), (e) => e.code === 'NOT_ON_PAGE' && !('auraCheckFailed' in e.evidence));
  const took = Date.now() - started;
  assert.ok(took < 4_800, `took ${took} ms on a 4000 ms timeout`); // two budgets: 2000 + 1000 + 4000
  // A Tooling call that never answers is cut at the same deadline (its signal), not left to the transport's own limit.
  tooling = ({ signal } = {}) => new Promise((_, reject) => {
    if (signal) signal.addEventListener('abort', () => reject(new Error('cut at the deadline')));
    setTimeout(() => reject(new Error('never cut')), 8_000);
  });
  const hung = Date.now();
  await assert.rejects(lwc.locate({ page }, id, 'recordBanner', { timeout: 4_000 }), (e) => e.code === 'NOT_ON_PAGE' && e.evidence.auraCheckFailed === 'cut at the deadline');
  assert.ok(Date.now() - hung < 4_800, `took ${Date.now() - hung} ms on a 4000 ms timeout`);
});

// A managed package renders its components as <namespace>-<name> inside native shadow roots; the fixture org has
// neither, so a local page builds that shape, with a decoy whose tag only ends the same way.
test('lwc nested host in a namespace, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<x-page></x-page>');
  await page.evaluate(() => {
    const outer = document.querySelector('x-page').attachShadow({ mode: 'open' });
    outer.innerHTML = '<c-other-file-scan>decoy</c-other-file-scan><acme-file-scan></acme-file-scan>';
    outer.querySelector('acme-file-scan').attachShadow({ mode: 'open' }).innerHTML = '<p>File scan</p>';
  });
  const { host, foundBy } = await lwc.nested({ page }, 'Some_Page', 'fileScan', { timeout: 2_000 });
  assert.deepEqual([foundBy.tag, foundBy.inside], ['acme-file-scan', ['x-page']]);
  assert.equal(await host.getByText('File scan').count(), 1);
  await assert.rejects(lwc.nested({ page }, 'Some_Page', 'notRendered', { timeout: 1_000 }), (e) => e.code === 'NOT_ON_PAGE');
});

// No org: a tab Lightning never rendered names the rule that hides it, or says it was not rendered; a present tab resolves.
test('openTabs names why a tab is missing, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<div role="tablist"><button role="tab" aria-selected="true">Notes</button></div>');
  const place = { tabs: ['Inputs'] };
  const miss = (extra) => lwc.openTabs({ page }, { ...place, ...extra }, { timeout: 500 }).then(() => null, (e) => e);
  // The shape discover.placements passes on for a component visibility rule.
  const rule = { booleanFilter: null, criteria: [{ leftValue: '{!Record.Count__c}', operator: 'GE', rightValue: '100' }] };
  const hidden = await miss({ visibilityRule: rule });
  assert.deepEqual([hidden?.code, hidden?.evidence.reason, hidden?.evidence.visibilityRule], ['NOT_ON_PAGE', 'tabNotRendered', rule], String(hidden));
  assert.equal(hidden.evidence.likelyCause, 'visibilityRule');
  assert.match(hidden.message, /\{!Record\.Count__c\} GE 100$/);
  const either = await miss({ visibilityRule: { booleanFilter: '1 OR 2', criteria: [{ leftValue: 'a', operator: 'EQUAL', rightValue: 'x' }, { leftValue: 'b', operator: 'NE' }, { leftValue: 'c', operator: 'EQUAL', rightValue: '' }] } });
  assert.match(either.message, /1: a EQUAL x, 2: b NE, 3: c EQUAL "" \(1 OR 2\)$/);
  const empty = await miss({ visibilityRule: { booleanFilter: null, criteria: [] } }); // a rule with no criteria adds nothing
  assert.match(empty.message, /is not on the page$/);
  assert.equal('likelyCause' in empty.evidence, false);
  const bare = await miss({});
  assert.deepEqual([bare?.code, bare?.evidence.reason], ['NOT_ON_PAGE', 'tabNotRendered'], String(bare));
  assert.equal('likelyCause' in bare.evidence, false);
  await lwc.openTabs({ page }, { tabs: ['Notes'], visibilityRule: rule }, { timeout: 500 }); // control: a tab that is there resolves
  const boom = new Error('boom'); // any error but the wait's TimeoutError passes through unchanged
  const fake = { getByRole: () => ({ getAttribute: async () => { throw boom; } }) };
  await assert.rejects(lwc.openTabs({ page: fake }, { tabs: ['Inputs'], visibilityRule: rule }), (e) => e === boom);
});

// locate's not-rendered error has no no-org test of its own; the helper both sites use is the shared shape.
test('why: reason names what was seen, likelyCause the suspected rule, no org', () => {
  const rule = { criteria: [{ leftValue: 'a', operator: 'EQUAL', rightValue: 'x' }] };
  assert.deepEqual(lwc.why('notRendered', rule), { reason: 'notRendered', likelyCause: 'visibilityRule' });
  assert.deepEqual(lwc.why('notRendered', { criteria: [] }), { reason: 'notRendered' });
  assert.deepEqual(lwc.why('notRendered'), { reason: 'notRendered' });
});
