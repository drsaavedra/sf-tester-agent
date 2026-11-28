'use strict';

// Navigation by URL; each function returns only once the page shows its loaded or its error state.
const { SfUiError } = require('./errors');
const { requireEnglish, nameWins, fold, distinct } = require('./session');
const api = require('./api');
const A = require('./anchors');
const { unxml } = require('./xml');

// A tool argument that goes into a page URL is one path segment: a slash or a ? would open another page.
const segment = (...values) => { for (const v of values) if (v !== undefined && !/^\w+$/.test(v)) throw new SfUiError('BAD_ARGS', `not an id or an API name: ${v}`, { value: v }); };

// Loaded = the highlights panel renders, or the record home draws and no panel follows within PANEL_MS (a template
// with none: highlights false); failed = the flexipage error card, which comes with the record home.
const PANEL_MS = 5_000; // the panel came 0 to 0.3 s after the record home, cold page included (measured on sfui-pool-2)
async function openRecord(s, recordId, { objectApiName, timeout = 60_000 } = {}) {
  segment(recordId, objectApiName);
  const path = `/lightning/r/${objectApiName ? `${objectApiName}/` : ''}${recordId}/view`;
  await s.page.goto(s.origin + path);
  const loaded = s.page.locator(`${A.highlights}, ${A.pageError}`).first();
  const home = s.page.locator(`${A.recordHome} > *`).locator('visible=true').first();
  await loaded.or(home).first().waitFor({ state: 'visible', timeout }).catch((e) => {
    if (e.name !== 'TimeoutError') throw e;
    throw new SfUiError('NO_HIGHLIGHTS', `${recordId}'s page drew no record page and no error card within ${timeout} ms: a slow page, or an object the user cannot read`, { recordId, url: s.page.url() });
  });
  const highlights = await loaded.waitFor({ state: 'visible', timeout: PANEL_MS }).then(() => true, (e) => { if (e.name !== 'TimeoutError') throw e; return false; });
  if (await s.page.locator(A.pageError).first().isVisible()) {
    const text = (await s.page.locator(A.pageError).first().innerText()).slice(0, 200);
    throw new SfUiError('RECORD_UNAVAILABLE', `${recordId} did not load`, { recordId, text });
  }
  // Lightning shows a 15-character id as its 18-character form.
  await s.page.waitForURL(new RegExp(`/lightning/r/[^/]+/${recordId}\\w{0,3}/view`), { timeout });
  await requireEnglish(s); // every record-page tool comes through here
  const [, object] = new URL(s.page.url()).pathname.match(/\/lightning\/r\/([^/]+)\//);
  return { recordId, objectApiName: object, url: s.page.url(), ...(!highlights && { highlights: false }) };
}

const SPLIT = 'Select an item from this list to open it.'; // the split view's list pane: in main (Sales), not (SF UI App)
const splitPane = (page, { includeHidden } = {}) => page.getByRole('grid', { name: SPLIT, exact: true, includeHidden });
// What a list shows in each display, with rows or none: its grid, a Kanban column "Fruit (1)", or the split pane.
function displays(page, gridName) {
  const main = page.getByRole('main');
  // An Event list's <table> grid has no name (measured on sfui-s4-map): main's title "Events My Upcoming Events" names
  // it, by a part of the title that is the label whole (not "Upcoming Events" inside "My Upcoming Events").
  const titled = gridName && main.filter({ has: page.getByRole('heading', { level: 1 }).getByText(gridName, { exact: true }) }).locator('table[role=grid]:not([aria-label])');
  const grid = main.getByRole('grid', gridName ? { name: gridName, exact: true } : {});
  return {
    Table: (titled ? grid.or(titled) : grid).filter({ visible: true }).or(main.getByRole('heading', { name: 'Nothing to see here' })).first(),
    Kanban: main.getByRole('heading', { level: 2, name: /\(\d+\+?\)$/ }).or(main.getByText(/^You don't have any /)).first(),
    // An empty split view hides its pane and says so: Recently Viewed (sfui-s4-flow), a named list (sfui-s4-map).
    'Split View': splitPane(page).filter({ visible: true }).or(main.getByRole('heading', { name: 'No record selected' }))
      .or(emptySplit(main)).first(),
  };
}
// "No items to display." also shows under an empty Event table: it is the split view's only beside its hidden pane,
// in main or, in the SF UI App, outside it with the pane (measured). A switch keeps the other display's text hidden,
// and a hidden pane beside a shown table (measured): the shown text, with no table shown in main.
const emptySplit = (main) => main.getByText(/^You haven't viewed any .+ recently\.$/)
  .or(main.page().locator('body').filter({ has: splitPane(main.page(), { includeHidden: true }) })
    .filter({ hasNot: main.locator('table').filter({ visible: true }) }).getByText('No items to display.', { exact: true }).filter({ visible: true })).first();
// The display a list page shows now, or undefined while none has rendered.
async function displayOf(page, gridName) {
  for (const [name, at] of Object.entries(displays(page, gridName))) if (await at.isVisible()) return name;
  return undefined;
}

// The list in any display, or the list's own error card, which ends the wait as LIST_UNAVAILABLE. That card stands in
// place of the list: inside main on the org, or a page with no main; one elsewhere or beside a rendered list is not it.
async function listShown(s, what, timeout, gridName) {
  const end = Date.now() + timeout;
  const main = s.page.getByRole('main');
  const inMain = main.getByRole('heading', { name: 'Something went wrong' }).first();
  const failed = inMain.or(s.page.locator('body:not(:has(main, [role=main]))').getByRole('heading', { name: 'Something went wrong' })).first();
  const shown = Object.values(displays(s.page, gridName)).reduce((a, b) => a.or(b)).first();
  await shown.or(failed).first().waitFor({ timeout });
  // A card on a page with no main counts once the page has finished loading: no main 3 s on (Lightning mounts it late).
  if (!(await shown.or(inMain).first().isVisible()) && (await main.first().waitFor({ timeout: Math.max(1, Math.min(3_000, end - Date.now())) }).then(() => true, () => false))) {
    await shown.or(inMain).first().waitFor({ timeout: Math.max(1, end - Date.now()) });
  }
  if ((await failed.isVisible()) && !(await shown.isVisible())) throw new SfUiError('LIST_UNAVAILABLE', `${what} did not load`, { what, url: s.page.url() });
}

// A list page has loaded when it shows the list in any display; Lightning's error card means it never will. Kanban and
// Split View do not carry the list's label, so for them the URL must name the list (listViews: the names it may take).
async function listLoaded(s, what, timeout, gridName, listViews) {
  const main = s.page.getByRole('main');
  const failed = s.page.getByRole('heading', { name: 'Something went wrong' });
  await main.or(failed).first().waitFor({ timeout }); // the error card has no main
  await requireEnglish(s); // Aura is up once either renders
  await listShown(s, what, timeout, gridName);
  const shown = await displayOf(s.page, gridName);
  if (shown === 'Table' || !listViews) return main;
  const at = new URL(s.page.url()).searchParams.get('filterName');
  if (!listViews.includes(at)) throw new SfUiError('LIST_UNAVAILABLE', `${what} did not load: the page shows ${at} as ${shown}`, { what, display: shown, url: s.page.url() });
  if (shown !== 'Split View' || await emptySplit(main).isVisible()) return main;
  // "No record selected" renders before the pane, or an empty list's text (SF UI App, measured): wait for either, else
  // the caller's snapshot holds no rows (main as before).
  const pane = splitPane(s.page);
  return pane.or(emptySplit(main)).filter({ visible: true }).first().waitFor({ timeout: Math.min(timeout, 10_000) }).then(async () => ((await pane.isVisible()) ? pane : main),
    () => Object.assign(main, { warning: 'the list shows as Split View but its list pane did not render: the snapshot is the main area, not rows' }));
}

// A list view's list-info, its labels as the page shows them: list-info escapes the list's and its columns' (Today&#39;s
// Agenda, Start Date &amp; Time, sfui-s4-map).
async function listInfo(s, objectApiName, listViewApiName) {
  const info = await api.call(s, `/ui-api/list-info/${objectApiName}/${encodeURIComponent(listViewApiName)}`);
  return { ...info, label: info.label && unxml(info.label), ...(info.displayColumns && { displayColumns: info.displayColumns.map((c) => ({ ...c, label: c.label && unxml(c.label) })) }) };
}

// An object's list view by its API name (DeveloperName), or the object's home page when none is given.
// The list view is looked up first, so an unknown name fails at once and the grid must carry its label.
async function openList(s, objectApiName, listViewApiName, { timeout = 60_000 } = {}) {
  segment(objectApiName);
  const info = listViewApiName && await listInfo(s, objectApiName, listViewApiName).catch((e) => {
    throw new SfUiError('LIST_UNAVAILABLE', `${objectApiName} has no list view ${listViewApiName} for this user`, { objectApiName, listViewApiName, status: e.evidence && e.evidence.status });
  });
  await s.page.goto(`${s.origin}/lightning/o/${objectApiName}/${listViewApiName ? `list?filterName=${encodeURIComponent(listViewApiName)}` : 'home'}`);
  return listLoaded(s, `${objectApiName} ${listViewApiName || 'home'}`, timeout, info && info.label, info && [listViewApiName, info.listReference?.listViewApiName, info.listReference?.id]);
}

// A record's related list by relationship name (Contacts, Opportunities, Things__r); the record page names the object.
async function openRelatedList(s, recordId, relationshipApiName, { timeout = 60_000 } = {}) {
  const { objectApiName } = await openRecord(s, recordId, { timeout });
  // An unknown relationship can render an empty page rather than the error card, so it is checked first.
  const { childRelationships = [] } = await api.call(s, `/ui-api/object-info/${objectApiName}`);
  if (!childRelationships.some((r) => r.relationshipName === relationshipApiName)) {
    throw new SfUiError('LIST_UNAVAILABLE', `${objectApiName} has no related list ${relationshipApiName}`, { objectApiName, relationshipApiName, url: s.page.url() });
  }
  await s.page.goto(`${s.origin}/lightning/r/${objectApiName}/${recordId}/related/${encodeURIComponent(relationshipApiName)}/view`);
  return listLoaded(s, `${relationshipApiName} of ${recordId}`, timeout);
}

// The pages a nav-items list opens at /lightning/n/<name> as { name, label } (an sObject tab opens elsewhere): every one
// a name or label can pick, and the custom ones a miss lists.
const navPages = (items) => items.filter((i) => i.pageReference?.type === 'standard__navItemPage' && i.pageReference.attributes?.apiName);
const asTab = (i) => ({ name: i.pageReference.attributes.apiName, label: i.label ?? '' });
const pagesOf = (items) => navPages(items).map(asTab);
const tabsOf = (items) => navPages(items).filter((i) => i.custom === true).map(asTab);

// Every nav item this user can open, read as the user, 100 per page: nextPageUrl is a full /services/data/vXX.X path, and
// api.call adds that prefix itself. The whole read gives up after within ms, since openTab waits on it before every open.
async function navItems(s, { within = 5_000 } = {}) {
  let over = false; // a read that lost the race asks for no further page
  const read = async () => {
    const items = [];
    for (let path = '/ui-api/nav-items?formFactor=Large&pageSize=100'; path && !over;) {
      const page = await api.call(s, path);
      items.push(...page.navItems);
      path = page.nextPageUrl && page.nextPageUrl.replace(/^\/services\/data\/v[\d.]+/, '');
    }
    return items;
  };
  let timer;
  try {
    return await Promise.race([read(), new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error(`the nav-items list did not answer in ${within / 1000} s`), { slow: true })), within); })]);
  } finally {
    clearTimeout(timer);
    over = true;
  }
}

// A tab typed as its API name or its label, any case, the name first: two labels are AMBIGUOUS, none is TAB_UNAVAILABLE
// with the tabs to pick from.
const API_NAME = /^[A-Za-z][\w-]*$/; // a value that can be a tab's API name, standard-ActionHub included
const named = (list, tab) => list.find((t) => fold(t.name) === fold(tab));
function pickTab(items, tab) {
  const list = tabsOf(items);
  const pages = pagesOf(items);
  const byName = named(pages, tab);
  const byLabel = distinct(pages.filter((t) => fold(t.label) === fold(tab)), 'name');
  if (byName) return nameWins(byName, byLabel, tab, 'tab', 'name');
  if (byLabel.length > 1) throw new SfUiError('AMBIGUOUS', `${byLabel.length} tabs are labelled ${tab}: name one by its API name`, { tab, names: byLabel.map((t) => t.name) });
  if (!byLabel.length) {
    // The label of an sObject tab: not a custom tab, but the object's list opens through sf_open_list.
    const object = items.find((i) => i.pageReference?.type === 'standard__objectPage' && fold(i.label) === fold(tab))?.pageReference.attributes?.objectApiName;
    throw new SfUiError('TAB_UNAVAILABLE', `${tab} is not a tab this user can open${object ? `; it is the ${object} object tab: open it with sf_open_list` : ''}`, { tab, tabs: list, ...(object && { objectTab: object }) });
  }
  return byLabel[0];
}

// A custom tab by its API name or label, read from the list first: one navigation, or two when the first list read fails.
// Returns main and { name, label } (label null, with labelReason, when the list fails or lacks it); a VF tab is an iframe.
async function openTab(s, tab, { timeout = 60_000 } = {}) {
  if (/^\.+$/.test(tab)) throw new SfUiError('BAD_ARGS', `not a tab: ${tab}`, { tab }); // the URL parser would read it as a step up
  const go = async (name) => {
    await s.page.goto(`${s.origin}/lightning/n/${encodeURIComponent(name)}`);
    const main = s.page.getByRole('main');
    const missing = s.page.getByRole('heading', { name: "Page doesn't exist" });
    await main.or(missing).first().waitFor({ timeout });
    await requireEnglish(s);
    // A missing tab also shows a main first, and its error heading about 0.3 s later. ponytail: a fixed 3 s settle;
    // a per-kind loaded signal (the VF iframe, the component) would end it sooner.
    await missing.waitFor({ timeout: 3_000 }).catch(() => {});
    if (await missing.isVisible()) throw new SfUiError('TAB_UNAVAILABLE', `${name} is not a tab this user can open`, { tab: name, url: s.page.url() });
    return main;
  };
  const read = () => navItems(s).then((items) => ({ items }), (e) => ({ reason: e.message, slow: e.slow })); // a list that cannot be read costs the label, not the open
  const fromList = async (items, tried) => { // tried: the TAB_UNAVAILABLE of the typed value's own navigation, when it was made
    let hit;
    try { hit = pickTab(items, tab); } catch (miss) {
      // A miss may still open by URL, but only a value that can be an API name and was not already tried; an ambiguous label never does.
      if (tried) miss.evidence = { ...tried.evidence, ...miss.evidence };
      if (miss.code !== 'TAB_UNAVAILABLE' || !API_NAME.test(tab) || tried) throw miss;
      const main = await go(tab).catch((e) => { throw e.code === 'TAB_UNAVAILABLE' ? Object.assign(miss, { evidence: { ...e.evidence, ...miss.evidence } }) : e; });
      return { main, tab: unlisted("the tab is not in this user's nav items") };
    }
    // A listed tab whose page does not open.
    const listed = (x) => new SfUiError('TAB_UNAVAILABLE', `${hit.name} is in this user's tabs, but its page did not open`, { ...x.evidence, tabs: tabsOf(items) });
    if (tried && hit.name === tab) throw listed(tried); // the same URL already failed, and the URL is case-sensitive
    const main = await go(hit.name).catch((x) => { throw x.code === 'TAB_UNAVAILABLE' ? listed(x) : x; });
    return { main, tab: shape(hit) };
  };
  const unlisted = (labelReason) => ({ name: tab, label: null, labelReason }); // opened by URL, with no label to give
  const shape = (hit) => {
    const { name, label } = hit;
    // A value with an underscore looks like an API name, not a word: opened by label, the pick says so.
    const warning = hit.warning || (fold(name) !== fold(tab) && API_NAME.test(tab) && tab.includes('_') ? `${tab} is not a tab name in this user's nav items; opened the tab labelled ${tab} (${name})` : undefined);
    return { name, label: label || null, ...(warning && { warning }), ...(!label && { labelReason: 'the nav items give the tab no label' }) };
  };
  const first = await read();
  if (first.items) return fromList(first.items);
  // No list: the page may not have been Lightning yet. Open the typed value; a miss there is on Lightning, so read once more.
  let main;
  try { main = await go(tab); } catch (e) {
    if (e.code !== 'TAB_UNAVAILABLE') throw e;
    const again = first.slow && API_NAME.test(tab) ? first : await read(); // a timed-out read stands for a name; a label needs the list
    if (again.items) return fromList(again.items, e);
    throw Object.assign(e, { evidence: { ...e.evidence, tabsReason: again.reason } });
  }
  if (first.slow) return { main, tab: unlisted(first.reason) }; // a read that timed out is not read again
  // The page is Lightning now: read the list again for the real label, with no second navigation.
  const again = await read();
  if (!again.items) return { main, tab: unlisted(again.reason) };
  let hit;
  try { hit = pickTab(again.items, tab); } catch { hit = null; } // any pick error costs the label, never the open
  return { main, tab: hit && fold(hit.name) === fold(tab) ? shape(hit) : unlisted("the tab is not in this user's nav items") };
}

// Global search from the header box, as a user types it; returns the results page's main area.
// The header's Search button opens the box only once the header has loaded, so it is pressed until the box shows.
// On a results page that button is named "Search: <last term>" (F-flow-20).
// One deadline for the whole call (D9): MCP SDK clients give up at 60 s, Claude Code's stdio default is 1e8 ms.
async function search(s, text, { timeout = 60_000 } = {}) {
  const end = Date.now() + timeout;
  const left = () => Math.max(100, end - Date.now()); // a floor, as lwc.locate has: 1 ms is under one protocol round trip
  await requireEnglish(s);
  const box = s.page.locator('input[placeholder="Search..."]').locator('visible=true');
  const button = s.page.getByRole('button', { name: /^Search(: .*)?$/ });
  for (const boxEnd = Math.min(Date.now() + 20_000, end); !(await box.count()); await s.page.waitForTimeout(1_000)) {
    if (Date.now() > boxEnd) throw new SfUiError('ACTION_NOT_AVAILABLE', 'the header search box did not open', { url: s.page.url() });
    await button.click({ timeout: Math.min(1_000, left()) }).catch(() => {}); // a button not there yet, or covered: the loop tries again
  }
  // Results open at /one/one.app#<base64 of {"componentDef":"forceSearch:searchPageDesktop",...}>.
  const isSearch = (u) => Buffer.from(u.hash.slice(1), 'base64').toString().includes('forceSearch');
  const before = s.page.url();
  const main = s.page.getByRole('main');
  // main shows before its results: wait for a result row or the no-match text (F-flow-19).
  // A natural-language term with no rows prints only the heading "No matching records" (step 68).
  const settled = main.getByRole('rowheader').or(main.getByText(/find any matches/))
    .or(main.getByRole('heading', { name: 'No matching records', exact: true })).first();
  const again = isSearch(new URL(before));
  // On a results page the old rows already match settled: mark them, and wait for the redraw to drop them (R10).
  // The mark's value is this call's own: form.js marks Aura errors with the same attribute, empty (D1).
  const id = `search-${crypto.randomUUID()}`;
  const marked = main.locator(`[data-sf-tester-old="${id}"]`);
  // Why a results page went unmarked goes on a SEARCH_FAILED, since the call then waits as from another page (D10).
  let notMarked = again && !(await settled.count()) && 'no result row or no-match text before Enter';
  const old = again && !notMarked && await settled.evaluate((e, v) => e.setAttribute('data-sf-tester-old', v), id)
    .then(() => true, (e) => { notMarked = `the mark failed: ${e.message.split('\n')[0]}`; return false; });
  const failed = (message) => new SfUiError('SEARCH_FAILED', message, { text, url: s.page.url(), ...(notMarked && { notMarked }) });
  try {
    await box.first().fill(String(text), { timeout: left() });
    await box.first().press('Enter', { timeout: left() });
    // A search from a results page redraws it in place (F-flow-20): the marked old results leaving is the redraw (R10).
    // Measured on new terms sharing a record, standard and console app: the mark left 35-208 ms after it was set (D2).
    if (old) await marked.waitFor({ state: 'detached', timeout: left() }).catch(() => {
      throw failed(`the results page for "${text}" was not redrawn: the old results are still on it`);
    });
  } finally {
    // A throw leaves the old results on the page: unmark them. A failed unmark means the page, and the mark, are gone.
    if (old) await marked.evaluateAll((els) => els.forEach((e) => e.removeAttribute('data-sf-tester-old'))).catch(() => {});
  }
  // Only unmarked does it wait for "We searched for", which a natural-language results page never prints.
  if (!old) await (again
    ? main.getByText(`We searched for "${text}"`).first().waitFor({ timeout: left() })
    : s.page.waitForURL((u) => u.href !== before && isSearch(u), { timeout: left() })
  ).catch(() => {
    throw failed(`searching for "${text}" did not open the results page`);
  });
  await settled.waitFor({ timeout: left() }).catch(() => {
    throw failed(`the results page for "${text}" never showed a result row or "no matches"`);
  });
  return main;
}

// A 15- or 18-character record id's shape; a name of that shape passes too.
const isId = (v) => /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(String(v));

// Whether a Lightning URL is that record's page (first 15 characters of the id).
const showsRecord = (url, recordId) => new RegExp(`/lightning/r/[^/]+/${String(recordId).slice(0, 15)}\\w*/view`).test(url);

// The record a Lightning URL shows, or undefined off a record page.
// tail: what may follow the id; a record's edit dialog ends in edit.
const recordIdOf = (url, tail = 'view') => (new RegExp(`/lightning/r/(?:\\w+/)?(\\w{18})/${tail}`).exec(url) || [])[1];

module.exports = { SPLIT, splitPane, listInfo, displays, displayOf, listShown, segment, openRecord, openList, openRelatedList, openTab, pickTab, navItems, search, recordIdOf, isId, showsRecord };
