'use strict';

// nav against a real scratch org: a record (loaded and missing), a list view, an object home, a related list, global search.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, nav, api } = require('..');
const { auth, env, skip, account, probe, record: own, stamp, localPage } = require('./helpers');

test('nav', { skip, timeout: 600_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const record = await account(s, t);

  await t.test('openRecord resolves the object from an id alone', async () => {
    const r = await nav.openRecord(s, record);
    assert.equal(r.objectApiName, 'Account');
    assert.equal(r.recordId, record);
  });

  await t.test('openRecord takes a 15-character id', async () => {
    const r = await nav.openRecord(s, record.slice(0, 15), { timeout: 20_000 });
    assert.equal(r.objectApiName, 'Account');
  });

  // A Task or Event page draws the Aura highlights panel, not records-highlights2.
  await t.test('openRecord opens a Task page and an Event page', async () => {
    const task = await own(s, t, 'Task', { Subject: `L11 nav task ${stamp()}` });
    const event = await own(s, t, 'Event', { Subject: `L11 nav event ${stamp()}`, StartDateTime: new Date(Date.now() + 86_400_000).toISOString(), DurationInMinutes: 30 });
    assert.equal((await nav.openRecord(s, task)).objectApiName, 'Task');
    assert.equal((await nav.openRecord(s, event)).objectApiName, 'Event');
  });

  // F-fixtures-25: SfUiC_Tpl_1__c's View override (test/fixture-components, every app) is a template with no Highlights Panel.
  await t.test('openRecord opens a record page with no Highlights Panel', async (st) => {
    if (await api.call(s, '/sobjects/SfUiC_Tpl_1__c/describe', { as: 'admin' }).then(() => false, () => true)) return st.skip('the org has no test/fixture-components object SfUiC_Tpl_1__c');
    const id = await own(s, t, 'SfUiC_Tpl_1__c', { Name: `BREAK fix tpl1 ${stamp()}` });
    const started = Date.now();
    const r = await nav.openRecord(s, id);
    assert.deepEqual([r.objectApiName, r.highlights], ['SfUiC_Tpl_1__c', false]);
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
  });

  await t.test('openRecord throws RECORD_UNAVAILABLE for an id that does not exist', async () => {
    const missing = record.slice(0, 12) + 'ZZZAA0';
    await assert.rejects(nav.openRecord(s, missing, { objectApiName: 'Account' }), { code: 'RECORD_UNAVAILABLE' });
  });

  await t.test('openList opens a list view by API name and returns its main area', async () => {
    const name = `sfui list ${stamp()}`;
    await probe(s, t, { Name: name });
    const main = await nav.openList(s, 'SfUiProbe__c', 'All');
    await main.getByRole('link', { name, exact: true }).waitFor({ timeout: 15_000 });
  });

  await t.test('openList without a list view opens the object home', async () => {
    const main = await nav.openList(s, 'SfUiProbe__c');
    assert.match(s.page.url(), /\/lightning\/o\/SfUiProbe__c\/home/);
    assert.equal(await main.getByRole('grid', { name: 'Recently Viewed', exact: true }).count(), 1);
  });

  // An empty list shows "Nothing to see here" and no grid; SF UI Typed has no record that is not deleted.
  await t.test('openList opens a list with no rows instead of waiting for a grid', async () => {
    const started = Date.now();
    const main = await nav.openList(s, 'SfUiTyped__c', undefined, { timeout: 20_000 });
    assert.equal(await main.getByRole('heading', { name: 'Nothing to see here' }).count(), 1);
    assert.ok(Date.now() - started < 15_000, `${Date.now() - started} ms`);
  });

  await t.test('openList refuses a list view that does not exist', async () => {
    await assert.rejects(nav.openList(s, 'SfUiProbe__c', 'NoSuchListView'), { code: 'LIST_UNAVAILABLE' });
  });

  await t.test('openRelatedList opens a record\'s related list, and refuses one that does not exist', async () => {
    const lastName = `sfuicontact${stamp()}`;
    await own(s, t, 'Contact', { LastName: lastName, AccountId: record });
    const main = await nav.openRelatedList(s, record, 'Contacts');
    await main.getByRole('link', { name: lastName, exact: true }).waitFor({ timeout: 15_000 });
    await assert.rejects(nav.openRelatedList(s, record, 'NoSuchRelation__r'), { code: 'LIST_UNAVAILABLE' });
  });

  // Global search reads the index, which takes a while to see a new record; SOSL reserves "-", so no hyphens.
  await t.test('search finds a record by name through the header search box', async () => {
    const name = `sfui search ${stamp()}`;
    await account(s, t, { Name: name });
    const q = `FIND {"${name}"} IN NAME FIELDS RETURNING Account(Id)`;
    for (const end = Date.now() + 120_000; ; await new Promise((r) => setTimeout(r, 3000))) {
      if ((await api.call(s, `/search/?q=${encodeURIComponent(q)}`, { as: 'admin' })).searchRecords.length) break;
      if (Date.now() > end) throw new Error(`${name} never reached the search index`);
    }
    await nav.openList(s, 'SfUiProbe__c'); // a page that cannot hold the account's name
    const started = Date.now();
    const main = await nav.search(s, name);
    assert.match(s.page.url(), /one\.app#/);
    assert.ok(Date.now() - started < 30_000, `took ${Date.now() - started} ms`);
    // F-flow-19: the main it returns already holds the row, with no wait of the caller's own.
    assert.ok(await main.getByRole('link', { name, exact: true }).count(), await main.ariaSnapshot());
  });

  await t.test('search with no match returns the settled no-results page', async () => {
    const name = `sfuinomatch${stamp()}${stamp()}`;
    await nav.openList(s, 'SfUiProbe__c');
    const main = await nav.search(s, name);
    assert.ok(await main.getByText(/didn.t find any matches/).count(), await main.ariaSnapshot());
  });

  // F-flow-20: on a results page the header button is "Search: <last term>", and a search redraws that page in place.
  await t.test('search again from a results page opens the new results page', async () => {
    const [first, second] = [`sfuinomatch${stamp()}a`, `sfuinomatch${stamp()}b`];
    await nav.openList(s, 'SfUiProbe__c');
    await nav.search(s, first);
    const main = await nav.search(s, second, { timeout: 30_000 });
    assert.ok(await main.getByText(`We searched for "${second}"`).count(), await main.ariaSnapshot());
    assert.ok(await main.getByText(/didn.t find any matches/).count(), await main.ariaSnapshot());
  });
});

// F-flow-20, no org: a stub of the header and the results page. The button is "Search", then "Search: <last term>";
// a search from a results page keeps the url and redraws main, the old rows first, the new ones 300 ms later.
test('search twice in a row returns the second results page, no org', async (t) => {
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
    <header><button aria-label="Search" onclick="q.hidden = false">x</button></header>
    <input id="q" placeholder="Search..." hidden><main></main>
    <script>
      const shows = (term) => '<p>We searched for "' + term + '".</p><table><tr><th role=rowheader>hit ' + term + '</th></tr></table>';
      q.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        const term = q.value, main = document.querySelector('main');
        q.hidden = true;
        document.querySelector('header button').setAttribute('aria-label', 'Search: ' + term);
        if (location.hash) return setTimeout(() => { main.innerHTML = shows(term); }, 300);
        location.hash = btoa(JSON.stringify({ componentDef: 'forceSearch:searchPageDesktop', term }));
        main.innerHTML = shows(term);
      };
    </script></body></html>` }));
  await page.goto('https://x.lightning.force.com/lightning/page/home');
  const main = await nav.search({ page }, 'BREAK flow clone', { timeout: 5_000 });
  assert.equal(await main.getByRole('rowheader').textContent(), 'hit BREAK flow clone');
  await nav.search({ page }, 'sf-ui probe 7805767', { timeout: 5_000 });
  assert.equal(await main.getByRole('rowheader').textContent(), 'hit sf-ui probe 7805767');
});

// No org: the tab list as UI API serves it (test/nav-items.json), in two pages with the custom tabs on page 2, so a
// missing nextPageUrl loop goes red. The page is a stub that knows which tab names exist.
const items = require('./nav-items.json').navItems;
const pages = { first: [items[2], items[3], items[4]], second: [items[0], items[1]] };

test('pickTab matches a name or a label in any case, standard pages too, leaves out sObject tabs, and lists the custom tabs', () => {
  assert.deepEqual(nav.pickTab(items, 'sf ui inputs app'), { name: 'SfUi_Inputs_App', label: 'SF UI Inputs App' });
  // A name in any case is the tab, and it wins over another tab labelled with those letters.
  assert.deepEqual(nav.pickTab(items, 'sfui_vf'), { name: 'SfUi_Vf', label: 'SF UI VF' });
  const named = [...items, { ...items[1], label: 'sfui_vf', pageReference: { ...items[1].pageReference, attributes: { apiName: 'Other_Tab' } } }];
  assert.deepEqual(nav.pickTab(named, 'SFUI_VF'), { name: 'SfUi_Vf', label: 'SF UI VF', warning: 'SFUI_VF is also the label of tab Other_Tab; opened the tab named SfUi_Vf. Pass Other_Tab to open that one' });
  const two = [...named, { ...named.at(-1), pageReference: { ...named.at(-1).pageReference, attributes: { apiName: 'Third_Tab' } } }];
  assert.match(nav.pickTab(two, 'sfui_vf').warning, /label of tabs Other_Tab, Third_Tab; .* Pass Other_Tab or Third_Tab to/, 'every other tab labelled so is named');
  assert.match(nav.pickTab([...named, named.at(-1)], 'sfui_vf').warning, /label of tab Other_Tab; /, 'a tab listed twice is named once');
  assert.deepEqual(nav.pickTab([...items, items[1]], 'sf ui vf'), { name: 'SfUi_Vf', label: 'SF UI VF' }, 'a tab listed twice opens by its label');
  const lower = { ...items[1], pageReference: { ...items[1].pageReference, attributes: { apiName: 'sfui_vf' } } };
  assert.equal(nav.pickTab([...items, lower], 'sf ui vf').name, 'SfUi_Vf', 'of a repeated entry the first is kept, as list.find would');
  const same = { ...items[1], label: 'SfUi_Vf' };
  assert.equal(nav.pickTab([same, same], 'sfui_vf').warning, undefined, 'a tab that is its own label, listed twice, is no other tab');
  assert.equal(nav.pickTab(named, 'Other_Tab').warning, undefined, 'control: no other tab is labelled so');
  // A standard page opens by its label as by its name; a miss lists the custom tabs only.
  assert.deepEqual(nav.pickTab(items, 'action hub'), { name: 'standard-ActionHub', label: 'Action Hub' });
  assert.throws(() => nav.pickTab(items, 'Nothing here'), (e) => e.code === 'TAB_UNAVAILABLE'
    && JSON.stringify(e.evidence) === JSON.stringify({ tab: 'Nothing here', tabs: [{ name: 'SfUi_Inputs_App', label: 'SF UI Inputs App' }, { name: 'SfUi_Vf', label: 'SF UI VF' }] }));
  // An sObject tab is no custom tab, and what it is and where it opens comes with the refusal.
  assert.throws(() => nav.pickTab(items, 'sf ui probes'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.objectTab === 'SfUiProbe__c' && /; it is the SfUiProbe__c object tab: open it with sf_open_list$/.test(e.message));
  const twin = [...items, { ...items[1], developerName: 'SfUi_Vf2', pageReference: { ...items[1].pageReference, attributes: { apiName: 'SfUi_Vf2' } } }];
  assert.throws(() => nav.pickTab(twin, 'sf ui vf'), (e) => e.code === 'AMBIGUOUS' && JSON.stringify(e.evidence.names) === '["SfUi_Vf","SfUi_Vf2"]');
});

// A page where only SfUi_Vf and SfUi_Inputs_App exist as tabs (less any refused, plus any also); opened lists the names it was sent to.
const stub = (refused = [], also = []) => {
  const opened = [];
  let at;
  const page = {
    url: () => at, evaluate: async () => null, goto: async (u) => { at = u; opened.push(decodeURIComponent(u.split('/lightning/n/')[1])); },
    getByRole: (role) => (role === 'main' ? { or: () => ({ first: () => ({ waitFor: async () => {} }) }) } : { waitFor: async () => {}, isVisible: async () => ![...['SfUi_Vf', 'SfUi_Inputs_App'].filter((x) => !refused.includes(x)), ...also].includes(opened.at(-1)) }),
  };
  return { s: { origin: '', page }, opened };
};

// An item with no apiName is no tab, and a null label is an empty one: neither throws on the open or in the pick.
test('a nav item with no apiName or no label does not break openTab or pickTab, no org', async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  const odd = [{ custom: true, label: 'Nameless', pageReference: { type: 'standard__navItemPage', attributes: {} } },
    { custom: true, label: null, pageReference: { type: 'standard__navItemPage', attributes: { apiName: 'SfUi_NoLabel' } } }];
  api.call = async () => ({ navItems: [...odd, ...items], nextPageUrl: null });
  assert.deepEqual((await nav.openTab(stub().s, 'SfUi_Vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual((await nav.openTab(stub([], ['SfUi_NoLabel']).s, 'SfUi_NoLabel')).tab, { name: 'SfUi_NoLabel', label: null, labelReason: 'the nav items give the tab no label' });
  assert.deepEqual(nav.pickTab([...odd, ...items], 'sf ui vf'), { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.throws(() => nav.pickTab([...odd, ...items], 'Nothing'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.map((x) => x.name).join() === 'SfUi_NoLabel,SfUi_Inputs_App,SfUi_Vf' && e.evidence.tabs[0].label === '');
});

test('openTab returns the label from a paged list and opens a label by its name, no org', async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  const served = (fail) => async (s, path) => {
    if (fail) throw new Error('list down');
    assert.match(path, /^\/ui-api\/nav-items\?formFactor=Large&(page=1&)?pageSize=100/, 'the list is read as the user, a page at a time');
    return path.includes('page=1') ? { navItems: pages.second, nextPageUrl: null } : { navItems: pages.first, nextPageUrl: '/services/data/v68.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100' };
  };
  api.call = served();
  let { s, opened } = stub();
  assert.deepEqual((await nav.openTab(s, 'SfUi_Vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' }); // on page 2 only
  assert.deepEqual(opened, ['SfUi_Vf'], 'a name that opens is not navigated twice');

  ({ s, opened } = stub());
  assert.deepEqual((await nav.openTab(s, 'sf ui vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual(opened, ['SfUi_Vf'], 'a label is opened by the name it matches, in one navigation');

  ({ s } = stub());
  await assert.rejects(nav.openTab(s, 'Nothing'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.length === 2 && e.evidence.tab === 'Nothing' && !!e.evidence.url);
  // A standard page the list holds gives its label; a page the list lacks still opens, saying why it has none.
  assert.deepEqual((await nav.openTab(stub([], ['standard-ActionHub']).s, 'standard-ActionHub')).tab, { name: 'standard-ActionHub', label: 'Action Hub' });
  assert.deepEqual((await nav.openTab(stub([], ['Unlisted_Tab']).s, 'Unlisted_Tab')).tab, { name: 'Unlisted_Tab', label: null, labelReason: "the tab is not in this user's nav items" });
  assert.equal((await nav.openTab(stub([], ['standard-Unlisted']).s, 'standard-Unlisted')).tab.name, 'standard-Unlisted', 'a hyphenated standard page name is API-shaped');
  ({ s, opened } = stub(['SfUi_Vf'])); // a listed tab whose page will not open: one navigation, and the list
  await assert.rejects(nav.openTab(s, 'SfUi_Vf'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.length === 2 && /is in this user's tabs, but its page did not open/.test(e.message));
  assert.deepEqual(opened, ['SfUi_Vf']);
  ({ s, opened } = stub(['SfUi_Vf'])); // typed in another case and refused: still listed, with the list
  await assert.rejects(nav.openTab(s, 'sfui_vf'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.length === 2 && /SfUi_Vf is in this user's tabs/.test(e.message));
  assert.deepEqual(opened, ['SfUi_Vf']);
  ({ s, opened } = stub()); // a name typed in another case opens by the listed spelling
  assert.deepEqual((await nav.openTab(s, 'sfui_vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual(opened, ['SfUi_Vf'], 'the list is read first, so the typed spelling is never navigated');
  ({ s, opened } = stub()); // an sObject tab label and an ambiguous label are refused from the list, with no navigation
  await assert.rejects(nav.openTab(s, 'SF UI Probes'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.objectTab === 'SfUiProbe__c' && /open it with sf_open_list/.test(e.message));
  assert.deepEqual(opened, []);
  await assert.rejects(nav.openTab(s, 'Nothing here'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.length === 2);
  assert.deepEqual(opened, [], 'a value that cannot be an API name is never navigated by URL');
  // An object tab labelled like an API name does not stop an unlisted custom tab of that name from opening.
  const objTab = { ...items.find((i) => i.pageReference.type === 'standard__objectPage'), label: 'Unlisted_Tab' };
  api.call = async () => ({ navItems: [...items, objTab], nextPageUrl: null });
  ({ s, opened } = stub([], ['Unlisted_Tab']));
  assert.equal((await nav.openTab(s, 'Unlisted_Tab')).tab.name, 'Unlisted_Tab');
  ({ s, opened } = stub());
  await assert.rejects(nav.openTab(s, 'Unlisted_Tab'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.objectTab === 'SfUiProbe__c' && /open it with sf_open_list/.test(e.message) && e.evidence.tabs.length === 2);
  assert.deepEqual(opened, ['Unlisted_Tab'], 'tried once by URL, then refused with the object-tab advice');
  ({ s, opened } = stub());
  const twin = { ...items[1], developerName: 'SfUi_Vf2', pageReference: { ...items[1].pageReference, attributes: { apiName: 'SfUi_Vf2' } } };
  api.call = async () => ({ navItems: [...items, twin], nextPageUrl: null });
  await assert.rejects(nav.openTab(s, 'sf ui vf'), { code: 'AMBIGUOUS' });
  assert.deepEqual(opened, [], 'AMBIGUOUS navigates nowhere');
  const plain = { ...items[1], label: 'Hand_Book', pageReference: { ...items[1].pageReference, attributes: { apiName: 'Hb_Tab' } } };
  api.call = async () => ({ navItems: [...items, plain], nextPageUrl: null });
  ({ s, opened } = stub([], ['Hb_Tab']));
  const byLabel = await nav.openTab(s, 'Hand_Book'); // looks like an API name, but is only a label
  assert.deepEqual(opened, ['Hb_Tab'], 'one navigation, to the labelled tab');
  assert.equal(byLabel.tab.warning, "Hand_Book is not a tab name in this user's nav items; opened the tab labelled Hand_Book (Hb_Tab)");
  api.call = async () => ({ navItems: [...items, { ...plain, label: 'Handbook' }], nextPageUrl: null });
  ({ s, opened } = stub([], ['Hb_Tab']));
  const word = await nav.openTab(s, 'Handbook');
  assert.deepEqual([opened, word.tab], [['Hb_Tab'], { name: 'Hb_Tab', label: 'Handbook' }], 'control: an ordinary one-word label opens with no warning');
  api.call = async () => ({ navItems: [...items, { ...plain, label: 'Hand book' }], nextPageUrl: null });
  ({ s, opened } = stub([], ['Hb_Tab']));
  assert.equal((await nav.openTab(s, 'hand book')).tab.warning, undefined, 'control: a spaced label cannot be taken for a name');
  api.call = async () => ({ navItems: [...items, { ...plain, label: 'Hand_ book' }], nextPageUrl: null });
  ({ s, opened } = stub([], ['Hb_Tab']));
  assert.equal((await nav.openTab(s, 'hand_ book')).tab.warning, undefined, 'control: a spaced label with an underscore is no API name either');
  ({ s, opened } = stub());
  const clash = { ...items[1], label: 'sfui_vf', pageReference: { ...items[1].pageReference, attributes: { apiName: 'Other_Tab' } } };
  api.call = async () => ({ navItems: [...items, clash], nextPageUrl: null });
  const won = await nav.openTab(s, 'SfUi_Vf');
  assert.match(won.tab.warning, /SfUi_Vf is also the label of tab Other_Tab/);
  assert.deepEqual(opened, ['SfUi_Vf'], 'the name that won is the one navigated to');

  // A first read that fails on a page that was not Lightning: the typed value is opened, and the list is read again on the page it lands on.
  let calls = 0;
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: items, nextPageUrl: null }; };
  ({ s, opened } = stub());
  const retried = await nav.openTab(s, 'sf ui vf');
  assert.deepEqual(retried.tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual(opened, ['sf ui vf', 'SfUi_Vf'], 'the label is resolved from the second read');
  assert.equal(calls, 2);
  calls = 0; // the typed value opens: the list is read again, so the label is real and no second navigation is made
  ({ s, opened } = stub());
  assert.deepEqual((await nav.openTab(s, 'SfUi_Vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual([opened, calls], [['SfUi_Vf'], 2]);
  calls = 0;
  const rival = { ...items[1], label: 'sfui_vf', pageReference: { ...items[1].pageReference, attributes: { apiName: 'Other_Tab' } } };
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: [...items, rival], nextPageUrl: null }; };
  ({ s, opened } = stub());
  assert.match((await nav.openTab(s, 'SfUi_Vf')).tab.warning, /SfUi_Vf is also the label of tab Other_Tab/);
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: items, nextPageUrl: null }; };
  calls = 0; // the retry reads the list, finds the value unlisted, and does not try the same URL again
  ({ s, opened } = stub());
  await assert.rejects(nav.openTab(s, 'Unlisted_Tab'), (e) => e.code === 'TAB_UNAVAILABLE' && e.evidence.tabs.length === 2 && e.evidence.tab === 'Unlisted_Tab' && !!e.evidence.url);
  assert.deepEqual(opened, ['Unlisted_Tab'], 'exactly one goto');
  calls = 0; // an ambiguous label on the second read is ignored, since the typed name opened, and so is any other error
  const dup = (n) => ({ ...items[1], label: 'Unlisted_Tab', pageReference: { ...items[1].pageReference, attributes: { apiName: n } } });
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: [...items, dup('Twin_A'), dup('Twin_B')], nextPageUrl: null }; };
  ({ s, opened } = stub([], ['Unlisted_Tab']));
  assert.deepEqual((await nav.openTab(s, 'Unlisted_Tab')).tab, { name: 'Unlisted_Tab', label: null, labelReason: "the tab is not in this user's nav items" });
  calls = 0;
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: [null], nextPageUrl: null }; };
  ({ s, opened } = stub([], ['Unlisted_Tab']));
  assert.deepEqual((await nav.openTab(s, 'Unlisted_Tab')).tab.label, null, 'any error from the pick costs the label, never the open');
  api.call = async () => { if (!calls++) throw new Error('chrome-error page'); return { navItems: items, nextPageUrl: null }; };
  calls = 0; // /lightning/n/ matches the name exactly, so a failed lower-case value is still opened by the listed spelling
  ({ s, opened } = stub());
  assert.equal((await nav.openTab(s, 'sfui_vf')).tab.name, 'SfUi_Vf');
  assert.deepEqual(opened, ['sfui_vf', 'SfUi_Vf']);
  calls = 0; // a listed name equal to the value already tried is not opened again either
  ({ s, opened } = stub(['SfUi_Vf']));
  await assert.rejects(nav.openTab(s, 'SfUi_Vf'), (e) => e.code === 'TAB_UNAVAILABLE' && /is in this user's tabs, but its page did not open/.test(e.message));
  assert.deepEqual(opened, ['SfUi_Vf'], 'exactly one goto');

  api.call = served(true); // a list that cannot be read: the open still works, with no label and the reason; a miss says why it has no tabs
  ({ s } = stub());
  assert.deepEqual((await nav.openTab(s, 'SfUi_Vf')).tab, { name: 'SfUi_Vf', label: null, labelReason: 'list down' });
  ({ s } = stub());
  await assert.rejects(nav.openTab(s, 'sf ui vf'), (e) => e.code === 'TAB_UNAVAILABLE' && !('tabs' in e.evidence) && e.evidence.tabsReason === 'list down' && e.evidence.tab === 'sf ui vf');
});

// A list whose first page lands after the race asks for no second page.
test('a nav-items read that lost the race stops paging, no org', async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  const paths = [];
  api.call = async (s, path) => { paths.push(path); await new Promise((r) => setTimeout(r, 300)); return { navItems: [], nextPageUrl: '/services/data/v68.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100' }; };
  await assert.rejects(nav.navItems(stub().s, { within: 100 }), /did not answer in 0.1 s/);
  await new Promise((r) => setTimeout(r, 500)); // the first page has landed by now
  assert.equal(paths.length, 1, paths.join());
});

// A list that never answers costs the label after 5 s, not the open.
test('openTab does not wait on a nav-items read that never answers, no org', { timeout: 20_000 }, async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  api.call = () => new Promise(() => {});
  const { s } = stub();
  const start = Date.now();
  const late = new Promise((_, no) => { setTimeout(() => no(new Error('still waiting after 10 s')), 10_000).unref(); });
  const opened = await Promise.race([nav.openTab(s, 'SfUi_Vf'), late]);
  assert.deepEqual(opened.tab, { name: 'SfUi_Vf', label: null, labelReason: 'the nav-items list did not answer in 5 s' });
  assert.ok(Date.now() - start < 6_500, `took ${Date.now() - start} ms`);
});

// A read that timed out is not repeated on a miss either: the first result stands.
test('openTab reads a list that never answers once, on a miss too, no org', { timeout: 20_000 }, async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  let calls = 0;
  api.call = () => { calls += 1; return new Promise(() => {}); };
  const start = Date.now();
  await assert.rejects(nav.openTab(stub().s, 'Nothing'), (e) => e.code === 'TAB_UNAVAILABLE' && /did not answer in 5 s/.test(e.evidence.tabsReason));
  assert.equal(calls, 1, 'one read');
  assert.ok(Date.now() - start < 6_500, `took ${Date.now() - start} ms`);
});

// A label after a read that timed out is resolved by the second read: the page is Lightning by then.
test('openTab resolves a label from a second read after the first timed out, no org', { timeout: 20_000 }, async (t) => {
  const real = api.call;
  t.after(() => { api.call = real; });
  let calls = 0;
  api.call = () => (calls++ ? Promise.resolve({ navItems: items, nextPageUrl: null }) : new Promise(() => {}));
  const { s, opened } = stub();
  assert.deepEqual((await nav.openTab(s, 'sf ui vf')).tab, { name: 'SfUi_Vf', label: 'SF UI VF' });
  assert.deepEqual(opened, ['sf ui vf', 'SfUi_Vf']);
});

// No org: the id shape setLookup and sf_form_model share: 15 or 18 letters and digits, nothing else.
test('isId takes 15 or 18 letters and digits only, no org', () => {
  assert.deepEqual(['001C100000XZ8PW', '001C100000XZ8PWIA1', '001C100000XZ8P', '001C100000XZ8PWI', '001C100000XZ8PW-'].map(nav.isId), [true, true, false, false, false]);
});

// No org: the Task and Event pages' header is the Aura highlights panel (measured on sfui-s4-flow, 2026-11-12).
test('openRecord takes the Aura highlights panel as loaded, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<header data-aura-class="forceHighlightsPanel"><h1>Task L11</h1></header>' }));
  const r = await nav.openRecord({ page, origin: 'https://x.lightning.force.com' }, '00T000000000001AAA', { objectApiName: 'Task', timeout: 3_000 });
  assert.equal(r.objectApiName, 'Task');
});

// No org: an empty split view (the Task home's Recently Viewed, measured on sfui-s4-flow) keeps its grid hidden.
test('openList takes an empty split view as loaded, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main><h1>Tasks Recently Viewed</h1>
    <ul role="grid" aria-label="Select an item from this list to open it." style="height:0;overflow:hidden"></ul>
    <p>You haven't viewed any Tasks recently.</p><p>Try switching list views.</p></main>` }));
  const main = await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Task', undefined, { timeout: 3_000 });
  assert.equal(await main.count(), 1);
});

// No org: an Event list view's grid is a <table> with no name (measured on sfui-s4-map, P1); main's title names the
// list, so the list counts as loaded under its own title and not under another list's.
test('openList takes an Event list\'s unnamed table under the list\'s title, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  let title = 'My Upcoming Events';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main><h1><span>Events</span> <span>${title}</span></h1>
    <table role="grid"><tr><td>Call</td></tr></table></main>` }));
  t.mock.method(api, 'call', async () => ({ label: 'My Upcoming Events', listReference: { listViewApiName: 'MyUpcomingEvents' } }));
  const main = await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Event', 'MyUpcomingEvents', { timeout: 3_000 });
  assert.equal(await main.count(), 1);
  title = 'Recently Viewed'; // control: a table under another list's title is not this list
  await assert.rejects(nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Event', 'MyUpcomingEvents', { timeout: 3_000 }));
});

// No org: the title must name the list whole, so "Upcoming Events" does not take the table of "My Upcoming Events".
test('openList does not take an unnamed table under a title that only ends with the list\'s label, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  let title = 'My Upcoming Events';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main><h1><span>Events</span> <span>${title}</span></h1>
    <table role="grid"><tr><td>Call</td></tr></table></main>` }));
  t.mock.method(api, 'call', async () => ({ label: 'Upcoming Events', listReference: { listViewApiName: 'UpcomingEvents' } }));
  await assert.rejects(nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Event', 'UpcomingEvents', { timeout: 2_000 }));
  title = 'upcoming events'; // a title in other case is another list's too
  await assert.rejects(nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Event', 'UpcomingEvents', { timeout: 2_000 }));
  title = 'Upcoming Events'; // control: its own title
  assert.equal(await (await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Event', 'UpcomingEvents', { timeout: 2_000 })).count(), 1);
});

// No org: an empty named split-view list (Task Delegated Tasks, measured on sfui-s4-map) hides its pane and says
// "No items to display."; it opens at once. Control: that text outside main is not the list.
test('openList takes an empty named split-view list as loaded, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  let body = `<main><h1>Tasks Delegated Tasks</h1>
    <ul role="grid" aria-label="Select an item from this list to open it." style="height:0;overflow:hidden"></ul>
    <p>No items to display.</p></main>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  t.mock.method(api, 'call', async () => ({ label: 'Delegated Tasks', listReference: { listViewApiName: 'DelegatedTasks' } }));
  const started = Date.now();
  const main = await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Task', 'DelegatedTasks', { timeout: 3_000 });
  assert.equal(await main.count(), 1);
  assert.equal(main.warning, undefined);
  assert.ok(Date.now() - started < 2_500, `took ${Date.now() - started} ms`);
  body = '<main><h1>Tasks Delegated Tasks</h1></main><aside><p>No items to display.</p></aside>';
  await assert.rejects(nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Task', 'DelegatedTasks', { timeout: 3_000 }));
});

// No org, the delta's row 7: list-info escapes column labels as it does the list's ("Start Date &amp; Time" on every
// Event list, sfui-s4-map), so a column is found by the label the page shows.
test('listInfo gives column labels as the page shows them, no org', async (t) => {
  t.mock.method(api, 'call', async () => ({ label: 'Today&#39;s Agenda', displayColumns: [{ fieldApiName: 'StartDateTime', label: 'Start Date &amp; Time' }, { fieldApiName: 'Subject', label: 'Subject' }] }));
  const info = await nav.listInfo({}, 'Event', 'TodaysAgenda');
  assert.deepEqual([info.label, info.displayColumns.map((c) => c.label), info.displayColumns[0].fieldApiName], ["Today's Agenda", ['Start Date & Time', 'Subject'], 'StartDateTime']);
});

// No org, the delta's row 2: in the SF UI App an empty split list's hidden pane and its "No items to display." sit
// outside main, which holds only "No record selected", drawn first (measured on sfui-s4-map, SfUiProbe__c Kanban_Probes).
test('openList takes an empty split list whose pane is outside main as loaded, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div><h1>SF UI Probes Kanban Probes</h1>
    <ul role="grid" aria-label="Select an item from this list to open it." style="display:block;width:374px;height:0;overflow:hidden"></ul><p id="empty"></p></div>
    <main><h2>No record selected</h2><p>Open a record from the list to get started.</p></main>
    <script>setTimeout(() => { empty.textContent = 'No items to display.'; }, 1_000)</script>` }));
  t.mock.method(api, 'call', async () => ({ label: 'Kanban Probes', listReference: { listViewApiName: 'Kanban_Probes' } }));
  const started = Date.now();
  const main = await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'SfUiProbe__c', 'Kanban_Probes', { timeout: 15_000 });
  assert.deepEqual([main.warning, await nav.displayOf(page, 'Kanban Probes')], [undefined, 'Split View']);
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
});

// No org, the delta's row 4 (measured on sfui-s4-map, Delegated Tasks, admin): a switch keeps the other display's
// "No items to display." hidden in main. Just after Table to Split View it is first and the pane is 400 x 0; just
// after Split View to Table the pane stays 0 x 0 beside a shown table. Only the first is an empty Split View.
test('an empty list just switched reads as the display it shows, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const pane = (w) => `<ul role="grid" aria-label="Select an item from this list to open it." style="display:block;width:${w}px;height:0;overflow:hidden"></ul>`;
  const hidden = '<p style="display:none">No items to display.</p>';
  await page.setContent(`<main><h1>Tasks Delegated Tasks</h1>${hidden}<table style="display:none"><tr><td>x</td></tr></table>${pane(400)}<p>No items to display.</p></main>`);
  assert.equal(await nav.displayOf(page, 'Delegated Tasks'), 'Split View', 'just switched to Split View');
  await page.setContent(`<main><h1><span>Tasks</span> <span>Delegated Tasks</span></h1>${pane(0)}${hidden}<table role="grid"><tr><th>Subject</th></tr></table><p>No items to display.</p></main>`);
  assert.deepEqual([await nav.displayOf(page, 'Delegated Tasks'), await nav.displays(page, 'Delegated Tasks')['Split View'].isVisible()], ['Table', false], 'just switched to Table');
});

// No org, the delta's row 1: a split list with rows whose records answer 5 s late shows no pane and no "No items to
// display." while it loads (measured on sfui-s4-map, Task Open Tasks, 3 of 3), so it is never read as empty.
test('a split list still loading is not read as an empty one, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const loading = '<h1>Tasks Open Tasks</h1>';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main>${loading}</main>
    <script>setTimeout(() => { document.querySelector('main').innerHTML = '<h1>Tasks Open Tasks</h1><span>2 items</span><ul role="grid" aria-label="Select an item from this list to open it."><li role="row">Call A</li><li role="row">Call B</li></ul><h2>No record selected</h2>'; }, 1_500)</script>` }));
  t.mock.method(api, 'call', async () => ({ label: 'Open Tasks', listReference: { listViewApiName: 'OpenTasks' } }));
  const list = await nav.openList({ page, origin: 'https://x.lightning.force.com' }, 'Task', 'OpenTasks', { timeout: 10_000 });
  assert.deepEqual([await list.getByRole('row').count(), list.warning], [2, undefined]);
});

// No org: an empty Event list's table also says "No items to display." (measured on sfui-s4-map, platform user); it is
// a Table, not an empty Split View, so a switch to Split View is not read as done before its click.
test('an empty Table that says "No items to display." is not an empty Split View, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main><h1><span>Events</span> <span>Today's Agenda</span></h1>
    <table role="grid"><tr><th>Subject</th></tr></table><span>No items to display.</span></main>` }));
  await page.goto('https://x.lightning.force.com/lightning/o/Event/list?filterName=TodaysAgenda');
  assert.equal(await nav.displays(page, "Today's Agenda")['Split View'].isVisible(), false);
  assert.equal(await nav.displayOf(page, "Today's Agenda"), 'Table');
});
