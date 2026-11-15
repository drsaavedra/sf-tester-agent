'use strict';

// sf_open_list and sf_list on a local page shaped like Lightning's list page, with the UI API stubbed, no org: the
// guards whose red needs a page the fixture org does not give.

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/api');
const nav = require('../src/nav');
const { localPage } = require('./helpers');

const ORIGIN = 'https://x.lightning.force.com';
const ID = 'a03000000000001AAA';
const INFO = { label: 'All', listReference: { listViewApiName: 'All', id: '00B000000000001AAA' }, displayColumns: [{ label: 'Kind', fieldApiName: 'Kind__c' }], orderedByInfo: [] };

// A session on a page that serves body at any URL of the fake origin (a script in it runs).
async function page(t, body) {
  const p = await localPage(t);
  await p.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${body}</body></html>` }));
  return { page: p, origin: ORIGIN };
}
// api.call answers answer for this test (src/ reads it off the module).
const REAL = api.call;
const stub = (t, answer = async () => INFO) => { api.call = answer; t.after(() => { api.call = REAL; }); };
const STATUS = '<div role="status" aria-label="All">1 item</div>';
const SPLIT_PANE = `<table role="grid" aria-label="${nav.SPLIT}"><tr><th role="rowheader"><a href="/lightning/r/${ID}/view">probe one</a></th></tr></table>`;
const KANBAN = '<h2>Fruit (1)</h2><ul><li>probe one</li></ul>';
const list = require('../src/list');
const c = { s: {}, objectApiName: 'SfUiProbe__c' }; // confirmField reads only api.call

test('sf_open_list opens a list shown as Split View or as Kanban, and refuses one whose URL names another list', async (t) => {
  stub(t);
  const s = await page(t, `<div role="main">${STATUS}<h3>No record selected</h3></div>${SPLIT_PANE}`);
  const pane = await nav.openList(s, 'SfUiProbe__c', 'All', { timeout: 2_000 });
  assert.equal(await pane.getAttribute('aria-label'), nav.SPLIT, 'the split pane is what the list shows');

  const late = await page(t, `<div role="main">${STATUS}<h3>No record selected</h3></div><script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(SPLIT_PANE)}), 800)</script>`);
  assert.equal(await (await nav.openList(late, 'SfUiProbe__c', 'All', { timeout: 5_000 })).getAttribute('aria-label'), nav.SPLIT, 'a pane that renders after its heading is waited for');

  const none = await page(t, `<div role="main">${STATUS}<h3>No record selected</h3></div>`);
  assert.match((await nav.openList(none, 'SfUiProbe__c', 'All', { timeout: 1_000 })).warning, /list pane did not render/, 'main, and says so');

  const k = await page(t, `<div role="main">${STATUS}${KANBAN}</div>`);
  assert.equal(await (await nav.openList(k, 'SfUiProbe__c', 'All', { timeout: 2_000 })).getAttribute('role'), 'main');

  const other = await page(t, `<script>history.replaceState(null, '', '?filterName=Recent')</script><div role="main">${STATUS}${KANBAN}</div>`);
  await assert.rejects(nav.openList(other, 'SfUiProbe__c', 'All', { timeout: 2_000 }), (e) => e.code === 'LIST_UNAVAILABLE' && e.evidence.display === 'Kanban');
});

// list-info gives a label HTML-escaped (Today&#39;s Agenda, measured on sfui-s4-map); the page shows it plain.
test('sf_open_list and an sf_list action read a list label with an apostrophe as the page shows it', async (t) => {
  stub(t, async () => ({ ...INFO, label: 'Today&#39;s Agenda', listReference: { listViewApiName: 'TodaysAgenda' } }));
  const s = await page(t, `<div role="main"><div role="status" aria-label="Today's Agenda">1 item</div><table role="grid" aria-label="Today's Agenda"><tr><td>x</td></tr></table></div>`);
  assert.equal(await (await nav.openList(s, 'Event', 'TodaysAgenda', { timeout: 2_000 })).getAttribute('role'), 'main');
  const c = await list.context(s);
  assert.equal(c.info.label, "Today's Agenda");
  assert.equal(await c.status.count(), 1);
});

test('edit confirms a number by its value and an empty cell as no value, and a value not held still fails', async (t) => {
  let field;
  stub(t, async () => ({ fields: { Count__c: field } }));
  field = { value: 8, displayValue: null };
  await list.confirmField(c, ID, 'Count__c', '08', 500);
  await list.confirmField(c, ID, 'Count__c', '8.0', 500);
  await assert.rejects(list.confirmField(c, ID, 'Count__c', '9', 500), { code: 'NOT_SAVED' });
  field = { value: null, displayValue: null };
  await list.confirmField(c, ID, 'Count__c', '', 500);
  await assert.rejects(list.confirmField(c, ID, 'Count__c', '0', 500), { code: 'NOT_SAVED' }, '0 is a value, not an empty cell');
  field = { value: 'x', displayValue: null };
  await assert.rejects(list.confirmField(c, ID, 'Count__c', '', 500), { code: 'NOT_SAVED' });
});

// A list with no rows: each display item of the menu swaps main for what that display shows when empty.
const EMPTY = `<div role="main">${STATUS}<button>Select list display</button>
<div role="menu"><div role="menuitemcheckbox" tabindex="0" onclick="show('<h3>Nothing to see here</h3>')">Table</div>
<div role="menuitemcheckbox" tabindex="0" onclick="show('<p>You don\\'t have any SF UI Probes.</p>')">Kanban</div>
<div role="menuitemcheckbox" tabindex="0" onclick="show('<h3>No record selected</h3>')">Split View</div></div>
<div id="view"><h3>Nothing to see here</h3></div></div>
<script>function show(h) { document.getElementById('view').innerHTML = h; }</script>`;

test('display confirms each display on a list with no rows', async (t) => {
  stub(t);
  const s = await page(t, EMPTY);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  for (const to of ['Kanban', 'Split View', 'Table']) assert.equal((await list.ACTIONS.display[0](s, { display: to, timeout: 2_000 })).display, to);
});

test('an action that reads the rows refuses a list shown as Kanban or Split View, and one with no rows, at once', async (t) => {
  stub(t);
  const kanban = await page(t, `<div role="main">${STATUS}${KANBAN}</div>`);
  await kanban.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const t0 = Date.now();
  await assert.rejects(list.run(kanban, 'sort', { column: 'Kind' }), (e) => e.code === 'NOT_TABLE' && e.evidence.display === 'Kanban');
  await assert.rejects(list.run(kanban, 'search', { text: 'x' }), { code: 'NOT_TABLE' });
  await assert.rejects(list.run(kanban, 'filter', { field: 'Kind', operator: 'equals', value: 'x' }), { code: 'NOT_TABLE' });
  const split = await page(t, `<div role="main">${STATUS}<h3>No record selected</h3></div>${SPLIT_PANE}`);
  await split.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.run(split, 'select', { rows: ['probe one'] }), (e) => e.code === 'NOT_TABLE' && e.evidence.display === 'Split View');
  const empty = await page(t, `<div role="main">${STATUS}<h3>Nothing to see here</h3></div>`);
  await empty.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  for (const [action, args] of [['sort', { column: 'Kind' }], ['select', { rows: ['x'] }], ['edit', { row: 'x', column: 'Kind', value: 'y' }], ['delete', { row: 'x' }]]) {
    await assert.rejects(list.run(empty, action, args), { code: 'LIST_EMPTY' }, action);
  }
  assert.ok(Date.now() - t0 < 10_000, `refused in ${Date.now() - t0} ms, not after a wait`);
});

test('an action on a list that shows Lightning\'s error card throws LIST_UNAVAILABLE within its own timeout', async (t) => {
  stub(t);
  const s = await page(t, '<h1>Something went wrong</h1>');
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 6_000 }), { code: 'LIST_UNAVAILABLE' });
  assert.ok(Date.now() - t0 < 4_500, `refused in ${Date.now() - t0} ms: a page with no main is finished once 3 s pass without one`);
  const blank = await page(t, '<div role="main"></div>');
  await blank.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const t1 = Date.now();
  await assert.rejects(list.ACTIONS.sort[0](blank, { column: 'Kind', timeout: 1_000 }), { name: 'TimeoutError' });
  assert.ok(Date.now() - t1 < 3_000, `a page that shows nothing ends at the caller's timeout, not 15 s: ${Date.now() - t1} ms`);
});

test('only the list\'s own error card is LIST_UNAVAILABLE, in main as on the org or with no main: two such headings too, and none beside a list that rendered', async (t) => {
  stub(t, LISTS);
  const s = await page(t, '<h1>Something went wrong</h1><h2>Something went wrong</h2>');
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 2_000 }), { code: 'LIST_UNAVAILABLE' });
  // The org's card (probe-inherited2: a list URL of an object the user cannot see): a level 3 heading inside main.
  const inMain = await page(t, '<div role="main"><h3>Something went wrong</h3><p>You don\'t have access to this record.</p></div>');
  await inMain.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.sort[0](inMain, { column: 'Kind', timeout: 2_000 }), { code: 'LIST_UNAVAILABLE' });
  const beside = await page(t, `<aside><h2>Something went wrong</h2><h2>Something went wrong</h2></aside>${SORTS}`);
  await beside.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.equal((await list.ACTIONS.sort[0](beside, { column: 'Kind', timeout: 2_000 })).rows, 1, 'another component\'s error card');
});

// Another component's card that shows before the list renders (gate G4): the list still opens.
test('an error card outside main that shows before the list renders does not end the wait', async (t) => {
  stub(t, LISTS);
  const s = await page(t, `<aside><h2>Something went wrong</h2></aside><div role="main" id="m"></div><script>setTimeout(() => { document.getElementById('m').outerHTML = ${JSON.stringify(TABLE())}; }, 1500)</script>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.deepEqual((await list.ACTIONS.select[0](s, { rows: ['probe one'], timeout: 5_000 })).recordIds, [ID]);
  // The same card while the page has no main yet (Lightning mounts main after its shell): still not the list's (gate N1).
  const early = await page(t, `<aside><h2>Something went wrong</h2></aside><div id="m"></div><script>setTimeout(() => { document.getElementById('m').outerHTML = ${JSON.stringify(TABLE())}; }, 1500)</script>`);
  await early.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.deepEqual((await list.ACTIONS.select[0](early, { rows: ['probe one'], timeout: 5_000 })).recordIds, [ID]);
});

test('edit carries the page\'s own reason when a save fails, at once', async (t) => {
  stub(t, async () => ({ fields: { Count__c: { value: null, displayValue: null } } }));
  const why = async () => ['Fix the errors and try saving again'];
  const t0 = Date.now();
  await assert.rejects(list.confirmField(c, ID, 'Count__c', '-1', 5_000, why), (e) => e.code === 'NOT_SAVED' && e.evidence.errors?.[0] === 'Fix the errors and try saving again');
  assert.ok(Date.now() - t0 < 1_000, `${Date.now() - t0} ms`);
});

// A Table list of one row: its checkbox counts in the status line, Change Owner opens a dialog, Refresh opens nothing,
// and Enter in the search box empties it.
const TABLE = (extra = '') => `${extra}<div role="main"><div role="status" aria-label="All" id="st">1 item</div>
<button>Refresh</button><button onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog aria-modal=true aria-label=&quot;Change Owner&quot;><input aria-label=Owner></div>')">Change Owner</button>
<input type="search" aria-label="Search this list..." onkeydown="if (event.key === 'Enter') this.value = ''">
<table role="grid" aria-label="All"><tr><th role="columnheader">Probe Name</th></tr>
<tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th>
<td><input type="checkbox" aria-label="Select item 1" onchange="document.getElementById('st').textContent = this.checked ? '1 item selected' : '1 item'"></td></tr></table></div>`;
const LISTS = async (_s, p) => (p.startsWith('/ui-api/list-records') ? { records: [{ id: ID }] } : INFO);

test('mass counts a dialog only when one more shows after the click, so an open utility panel is not the button\'s dialog', async (t) => {
  stub(t, LISTS);
  const s = await page(t, TABLE('<div role="dialog" aria-label="Utility Bar">notes</div>'));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.mass[0](s, { rows: ['probe one'], button: 'Refresh', timeout: 1_000 }), (e) => e.code === 'ACTION_NOT_OPENED' && e.evidence.dialogsBefore === 1);
  const r = await list.ACTIONS.mass[0](s, { rows: ['probe one'], button: 'Change Owner', timeout: 2_000 });
  assert.match(r.dialog, /Change Owner/);
});

// A Task list header counts its overflow ("Show 3 more actions"); mass finds the button in it as in "Show more actions".
test('mass runs a list button from an overflow menu that counts its items', async (t) => {
  stub(t, LISTS);
  const menu = '<div role="menu" id="m" hidden><button role="menuitem" onclick="document.body.insertAdjacentHTML(\'beforeend\', \'<div role=dialog aria-modal=true aria-label=Delete>sure?</div>\')">Delete</button></div>';
  const s = await page(t, TABLE().replace('<button>Refresh</button>', `<button aria-haspopup="true" onclick="document.getElementById('m').hidden=false">Show 3 more actions</button>${menu}`));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.mass[0](s, { rows: ['probe one'], button: 'Delete', timeout: 2_000 });
  assert.match(r.dialog, /sure\?/);
});

test('mass refuses before it ticks anything when a row not named is selected, and names it', async (t) => {
  stub(t, LISTS);
  const r = (n, on) => `<tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/a0300000000000${n}AAA/view">probe ${n}</a></th><td><input type="checkbox" aria-label="Select item ${n}"${on ? ' checked' : ''}></td></tr>`;
  const s = await page(t, `<div role="main"><div role="status" aria-label="All">2 items • 1 item selected</div><button>Change Owner</button>
<table role="grid" aria-label="All">${r(1, true)}${r(2, false)}</table></div>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.mass[0](s, { rows: ['probe 2'], button: 'Change Owner', timeout: 1_000 }),
    (e) => e.code === 'OTHER_ROWS_SELECTED' && JSON.stringify(e.evidence.others) === '["probe 1"]');
  assert.equal(await s.page.getByRole('checkbox', { name: 'Select item 2' }).isChecked(), false, 'the named row was not ticked');
});

test('mass refuses a ticked row not named beside a named row whose header holds two links', async (t) => {
  stub(t, LISTS);
  const r = (n, links) => `<tr><th role="rowheader">${Array(links).fill(`<a href="/lightning/r/SfUiProbe__c/a0300000000000${n}AAA/view">probe ${n}</a>`).join(' ')}</th><td><input type="checkbox" aria-label="Select item ${n}" checked></td></tr>`;
  const s = await page(t, `<div role="main"><div role="status" aria-label="All">2 items • 2 items selected</div><button onclick="window.clicked = true">Change Owner</button>
<table role="grid" aria-label="All">${r(1, 2)}${r(2, 1)}</table></div>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.mass[0](s, { rows: ['probe 1'], button: 'Change Owner', timeout: 1_000 }),
    (e) => e.code === 'OTHER_ROWS_SELECTED' && e.evidence.others.join() === 'probe 2');
  assert.equal(await s.page.evaluate(() => window.clicked), undefined, 'the button was not clicked');
});

test('search fails when the search box no longer holds the text, though the rows match', async (t) => {
  stub(t, LISTS);
  const s = await page(t, TABLE());
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.search[0](s, { text: 'probe', timeout: 1_000 }), (e) => e.code === 'SEARCH_NOT_APPLIED' && e.evidence.box === '');
});

// A Table list with no search box; its Kind header sorts on a click, at once or late (window.slow), or toggles only between
// descending and none (window.wrong).
const SORTS = `<div role="main"><div role="status" aria-label="All">1 item</div><table role="grid" aria-label="All"><thead><tr>
<th role="columnheader" aria-label="Kind" aria-sort="none" id="h"><button onclick="step()">Sort by: Kind</button>Kind</th></tr></thead>
<tbody><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th></tr></tbody></table></div>
<script>function step() { const h = document.getElementById('h'); const now = h.getAttribute('aria-sort');
const next = window.wrong ? (now === 'descending' ? 'none' : 'descending') : (now === 'ascending' ? 'descending' : 'ascending');
setTimeout(() => h.setAttribute('aria-sort', next), window.slow ? 400 : 0); }</script>`;

test('sort reads a list with no search box as not searched; search still needs the box', async (t) => {
  stub(t, LISTS);
  const s = await page(t, SORTS);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.equal((await list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 2_000 })).rows, 1);
  await assert.rejects(list.ACTIONS.search[0](s, { text: 'probe', timeout: 1_000 }));
});

test('each SORT_NOT_APPLIED check has its own red: a header that changes late is waited for, one that skips the direction is refused', async (t) => {
  stub(t, LISTS);
  const s = await page(t, SORTS);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.slow = true; });
  assert.equal((await list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 2_000 })).direction, 'ascending', 'one click, its change waited for');
  await s.page.evaluate(() => { window.slow = false; window.wrong = true; document.getElementById('h').setAttribute('aria-sort', 'none'); });
  await assert.rejects(list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 2_000 }), (e) => e.code === 'SORT_NOT_APPLIED' && e.evidence.sorted === 'none');
});

test('removeFilter reads a list with no search box as not searched', async (t) => {
  const s = await page(t, `<div role="main"><div role="status" aria-label="All">1 item</div><button aria-pressed="true">Filters</button><button>Add Filter</button>
<button onclick="window.removed = true">Remove filter: "Kind equals x"</button><button onclick="window.saved = window.removed">Save</button>
<table role="grid" aria-label="All"><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th></tr></table></div>`);
  const KIND = [{ label: 'Kind', operator: 'Equals', operandLabels: ['x'] }];
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-records') ? { records: [{ id: ID }] }
    : { ...INFO, filteredByInfo: (await s.page.evaluate(() => window.saved)) ? [] : KIND }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.deepEqual(await list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 }), { field: 'Kind', value: 'x', filters: 0, rows: 1 });
});

// On the org the grid sometimes keeps the filtered rows after the panel's Save until its Refresh (gate N6): one Refresh
// on the first mismatch; none when the rows match at once.
const STALE = (stale) => `<div role="main"><div role="status" aria-label="All">1 item</div><button aria-pressed="true">Filters</button><button>Add Filter</button>
<button onclick="window.removed = true">Remove filter: "Kind equals x"</button><button onclick="window.saved = window.removed; if (!${stale}) more()">Save</button>
<button onclick="window.refreshes = (window.refreshes || 0) + 1; if (window.saved) more()">Refresh</button>
<table role="grid" aria-label="All" id="g"><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th></tr></table></div>
<script>function more() { if (!document.getElementById('r2')) document.getElementById('g').insertAdjacentHTML('beforeend', '<tr id="r2"><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID2}/view">probe two</a></th></tr>'); }</script>`;
const staleRun = async (t, stale) => {
  const s = await page(t, STALE(stale));
  const KIND = [{ label: 'Kind', operator: 'Equals', operandLabels: ['x'] }];
  stub(t, async (_s, p) => {
    const saved = await s.page.evaluate(() => window.saved);
    return p.startsWith('/ui-api/list-records') ? { records: saved ? [{ id: ID }, { id: ID2 }] : [{ id: ID }] } : { ...INFO, filteredByInfo: saved ? [] : KIND };
  });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 });
  return [r.rows, await s.page.evaluate(() => window.refreshes || 0)];
};
test('a grid that keeps its filtered rows after the panel\'s Save is refreshed once; one that shows the rows is not', async (t) => {
  assert.deepEqual(await staleRun(t, true), [2, 1]);
  assert.deepEqual(await staleRun(t, false), [2, 0]);
});

// Just after a panel's Cancel the toggle still reads pressed while the panel closes (gate: the filter flake).
test('a Filters toggle that reads pressed with no panel is waited out, then the panel is opened', async (t) => {
  const s = await page(t, `<div role="main"><div role="status" aria-label="All">1 item</div>
<button aria-pressed="true" id="f" onclick="this.setAttribute('aria-pressed', 'true'); document.getElementById('p').hidden = false">Filters</button>
<div id="p" hidden><button>Add Filter</button><button onclick="window.removed = true">Remove filter: "Kind equals x"</button></div>
<button onclick="window.saved = window.removed">Save</button>
<table role="grid" aria-label="All"><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th></tr></table></div>
<script>setTimeout(() => document.getElementById('f').setAttribute('aria-pressed', 'false'), 300)</script>`);
  const KIND = [{ label: 'Kind', operator: 'Equals', operandLabels: ['x'] }];
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-records') ? { records: [{ id: ID }] }
    : { ...INFO, filteredByInfo: (await s.page.evaluate(() => window.saved)) ? [] : KIND }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.equal((await list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 })).filters, 0);
});

// F5: confirmSplit needs the URL, the highlights and the split pane; each condition missing alone is a red.
test('confirmSplit fails without the record\'s highlights or without the split pane, each alone', async (t) => {
  stub(t);
  const at = `${ORIGIN}/lightning/r/SfUiProbe__c/${ID}/view`;
  for (const [body, ok] of [[`<div role="main"><records-highlights2>h</records-highlights2></div>${SPLIT_PANE}`, true], [`<div role="main"></div>${SPLIT_PANE}`, false], ['<div role="main"><records-highlights2>h</records-highlights2></div>', false]]) {
    const s = await page(t, body);
    await s.page.goto(at);
    if (ok) await list.confirmSplit(s, ID, 500);
    else await assert.rejects(list.confirmSplit(s, ID, 500), { code: 'RECORD_NOT_SHOWN' }, body);
  }
});

test('a poll throws what the server answered, retries a network failure, and a slow read ends at the deadline', async (t) => {
  // A dropped network is what the real api.call throws for it: page.evaluate's raw error, no code (gate probe K1).
  const fail = (status) => (status ? Object.assign(new Error(`API_ERROR ${status}`), { code: 'API_ERROR', evidence: { status } })
    : new Error('page.evaluate: TypeError: Failed to fetch\n    at eval (eval at evaluate (:290:30), <anonymous>:2:23)'));
  let answers;
  stub(t, async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; });
  answers = [fail(401)];
  await assert.rejects(list.confirmGone(c, ID, 2_000), (e) => e.evidence.status === 401, 'a 401 is not NOT_DELETED');
  answers = [fail(), fail(503), fail(404)];
  await list.confirmGone(c, ID, 3_000); // two transient failures, then gone
  answers = [];
  const slow = Date.now();
  stub(t, () => new Promise((r) => setTimeout(() => r({ fields: { Count__c: { value: 1 } } }), 3_000)));
  await assert.rejects(list.confirmField(c, ID, 'Count__c', '2', 500), { code: 'NOT_SAVED' });
  assert.ok(Date.now() - slow < 2_000, `ended ${Date.now() - slow} ms after a 500 ms deadline`);
  stub(t, async () => { throw fail(); });
  await assert.rejects(list.confirmGone(c, ID, 600), (e) => /Failed to fetch/.test(e.message), 'a failure to the end is thrown, not NOT_DELETED');
});

test('a poll that ends leaves no deadline timer behind', async (t) => {
  stub(t, async () => { throw Object.assign(new Error('API_ERROR 404'), { code: 'API_ERROR', evidence: { status: 404 } }); });
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  await list.confirmGone(c, ID, 15_000);
  assert.equal(timers(), before);
});

test('select throws when the status line cannot be read, not a count of 0 selected', async (t) => {
  stub(t, LISTS);
  const s = await page(t, TABLE().replace('role="status" aria-label="All"', 'aria-label="no status"'));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.select[0](s, { rows: ['probe one'], timeout: 500 }), (e) => e.name === 'TimeoutError' && /status/.test(e.message));
});

test('move names no card ROW_NOT_FOUND and two cards of one name AMBIGUOUS_ROW', async (t) => {
  stub(t);
  const card = (n) => `<li><a href="/lightning/r/${ID}/view">${n}</a><button>Change column for ${n}.</button></li>`;
  const s = await page(t, `<div role="main">${STATUS}<button>Refresh</button><h2>Fruit (2)</h2><ul>${card('twin')}${card('twin')}</ul></div>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.move[0](s, { row: 'twin', to: 'Tool', timeout: 500 }), { code: 'AMBIGUOUS_ROW' });
  await assert.rejects(list.ACTIONS.move[0](s, { row: 'nobody', to: 'Tool', timeout: 500 }), { code: 'ROW_NOT_FOUND' });
});

test('open finds the split view row through act.resolve: no row ROW_NOT_FOUND, two AMBIGUOUS_ROW', async (t) => {
  stub(t);
  const r = (n) => `<tr><td><input type="checkbox" aria-label="Select item ${n}"></td><th role="rowheader"><a href="/lightning/r/${ID}/view">${n}</a></th></tr>`;
  const s = await page(t, `<div role="main">${STATUS}<h3>No record selected</h3></div><table role="grid" aria-label="${nav.SPLIT}">${r('probe 1')}${r('probe 10')}</table>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.open[0](s, { row: 'probe 1', timeout: 500 }), { code: 'AMBIGUOUS_ROW' });
  await assert.rejects(list.ACTIONS.open[0](s, { row: 'nobody', timeout: 500 }), { code: 'ROW_NOT_FOUND' });
});

// The three guards the fixture org cannot make fire (after the review's no-org page, question 19).
const GUARDS = `<div role="main"><div role="status" aria-label="All">2 items</div>
<button>Select list display</button><div role="menu"><div role="menuitemcheckbox" tabindex="0">Kanban</div></div>
<table role="grid" aria-label="All"><thead><tr><th role="columnheader" aria-label="Kind" aria-sort="none"><button>Sort by: Kind</button>Kind</th></tr></thead>
<tbody><tr><th role="rowheader" scope="row"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th><td><button>Show Actions</button></td></tr></tbody></table></div>
<div role="menu"><div role="menuitem" tabindex="0">Delete</div></div>
<div role="dialog" aria-modal="true" aria-label="Delete"><button>Delete</button></div>`;

test('SORT_NOT_APPLIED when the header never changes, DISPLAY_NOT_SHOWN when the view never renders, ROW_STILL_SHOWN when a deleted row stays', async (t) => {
  stub(t, async (_s, p) => {
    if (p.startsWith('/ui-api/list-info')) return INFO;
    throw Object.assign(new Error('API_ERROR 404'), { code: 'API_ERROR', evidence: { status: 404 } });
  });
  const s = await page(t, GUARDS);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.sort[0](s, { column: 'Kind', timeout: 1_000 }), { code: 'SORT_NOT_APPLIED' });
  await assert.rejects(list.ACTIONS.display[0](s, { display: 'Kanban', timeout: 1_000 }), { code: 'DISPLAY_NOT_SHOWN' });
  await assert.rejects(list.ACTIONS.delete[0](s, { row: 'probe one', timeout: 1_000 }), { code: 'ROW_STILL_SHOWN' });
});

// Finding 4: Kanban on a list with no Kanban grouping opens Kanban Settings; it is cancelled, never saved.
const NO_KANBAN = `<div role="main">${STATUS}<button>Select list display</button>
<div role="menu"><div role="menuitemcheckbox" tabindex="0" onclick="document.getElementById('g').hidden = true; document.body.insertAdjacentHTML('beforeend', document.getElementById('ks').innerHTML)">Kanban</div>
<div role="menuitemcheckbox" tabindex="0" onclick="document.getElementById('g').hidden = false">Table</div></div>
<table role="grid" aria-label="All" id="g"><tr><th role="rowheader">probe one</th></tr></table></div>
<template id="ks"><div role="dialog" aria-modal="true" aria-label="Kanban Settings" id="dlg"><h1>Kanban Settings</h1>
<button onclick="document.getElementById('dlg').remove()">Cancel</button><button onclick="window.saved = true">Save</button></div></template>`;

test('display Kanban and move on a list with no Kanban grouping refuse KANBAN_NOT_SET, cancel the settings dialog and show the list as before', async (t) => {
  stub(t);
  const s = await page(t, NO_KANBAN);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  for (const [action, args] of [['display', { display: 'Kanban' }], ['move', { row: 'probe one', to: 'Tool' }]]) {
    const t0 = Date.now();
    await assert.rejects(list.ACTIONS[action][0](s, { ...args, timeout: 5_000 }), { code: 'KANBAN_NOT_SET', message: /Group By .* keeps it per user/ }, action);
    assert.ok(Date.now() - t0 < 4_000, `${action} refused in ${Date.now() - t0} ms`);
    assert.equal(await s.page.getByRole('dialog').count(), 0, `${action}: the settings dialog is closed`);
    assert.equal(await s.page.getByRole('grid').isVisible(), true, `${action}: the list is a Table again`);
  }
  assert.equal(await s.page.evaluate(() => window.saved), undefined, 'never saved');
});

test('display Kanban stays KANBAN_NOT_SET when the list cannot be put back as a Table, the failure in its evidence', async (t) => {
  stub(t);
  const s = await page(t, NO_KANBAN.replace(`onclick="document.getElementById('g').hidden = false"`, ''));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.display[0](s, { display: 'Kanban', timeout: 1_000 }),
    (e) => e.code === 'KANBAN_NOT_SET' && /did not show as Table/.test(e.evidence.cleanup));
});

// Inline edit of Count on one row. A marker left by an earlier failed save is already on the page; Save adds one when
// the server keeps the old value (window.fail), and the grid's Cancel drops the draft and its markers.
const EDIT = `<div role="main"><div role="status" aria-label="All">1 item</div>
<button class="err">Row Number 1 has 1 errors</button>
<table role="grid" aria-label="All"><tr><th role="columnheader">Count</th></tr>
<tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th>
<td><button onclick="document.getElementById('ed').hidden = false">Edit Count</button></td></tr></table>
<button onclick="if (window.fail) this.insertAdjacentHTML('beforebegin', '<button class=err>Fix the errors and try saving again</button>')">Save</button>
<button onclick="document.querySelectorAll('.err').forEach((e) => e.remove()); window.cancelled = true">Cancel</button></div>
<div role="dialog" aria-label="Edit Count" id="ed" hidden><input type="number"></div>`;
const COUNT = { ...INFO, displayColumns: [{ label: 'Count', fieldApiName: 'Count__c' }] };

test('edit reports only the errors its own save raised: a marker already on the page does not fail a good save', async (t) => {
  let reads = 0;
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: (reads += 1) < 2 ? 1 : 5, displayValue: null } } }));
  const s = await page(t, EDIT);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 3_000 });
  assert.equal(r.value, '5', 'the server held 5 on its second read');
  reads = -99; // the server keeps 1 from here: this save fails and raises its own marker
  await s.page.evaluate(() => { window.fail = true; });
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 3_000 }),
    (e) => e.code === 'NOT_SAVED' && JSON.stringify(e.evidence.errors) === '["Fix the errors and try saving again"]');
  assert.ok(Date.now() - t0 < 2_500, `its own marker ended it at once, ${Date.now() - t0} ms`);
});

test('edit ends NOT_SAVED at once when its save raises a second marker of a text already on the page', async (t) => {
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: 1, displayValue: null } } }));
  const s = await page(t, EDIT.replace('Row Number 1 has 1 errors', 'Fix the errors and try saving again'));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.fail = true; });
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 3_000 }),
    (e) => e.code === 'NOT_SAVED' && JSON.stringify(e.evidence.errors) === '["Fix the errors and try saving again"]');
  assert.ok(Date.now() - t0 < 2_500, `${Date.now() - t0} ms`);
});

test('a failed edit cancels its draft, so its markers do not stay, and says so', async (t) => {
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: 1, displayValue: null } } }));
  const s = await page(t, EDIT);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.fail = true; });
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 3_000 }),
    (e) => e.code === 'NOT_SAVED' && e.evidence.draft === 'cancelled' && /draft was cancelled/.test(e.message));
  assert.deepEqual([await s.page.evaluate(() => window.cancelled), await s.page.locator('.err').count()], [true, 0]);
});

test('a failed edit stays NOT_SAVED when main shows a second Cancel, its cleanup in the evidence', async (t) => {
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: 1, displayValue: null } } }));
  const s = await page(t, EDIT.replace('<div role="main">', '<div role="main"><button>Cancel</button>'));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.fail = true; });
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 2_000 }),
    (e) => e.code === 'NOT_SAVED' && /AMBIGUOUS/.test(e.evidence.cleanup));
});

test('an edit whose reads all fail on the network still cancels its draft', async (t) => {
  stub(t, async (_s, p) => { if (p.startsWith('/ui-api/list-info')) return COUNT; throw new Error('page.evaluate: TypeError: Failed to fetch'); });
  const s = await page(t, EDIT);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 1_000 }),
    (e) => /Failed to fetch/.test(e.message) && e.evidence.draft === 'cancelled');
  assert.equal(await s.page.evaluate(() => window.cancelled), true);
});

// A Kanban card whose "Tool" menu item loses its first click (the NOT_MOVED flake's likeliest cause, gate question 1):
// window.moved is the server's Kind__c, read through the stubbed api.call.
const BOARD = `<div role="main">${STATUS}<button>Refresh</button><h2>Fruit (1)</h2><ul><li><a href="/lightning/r/${ID}/view">card</a>
<button>Change column for card.</button></li></ul></div>
<div role="menu"><div role="menuitem" tabindex="0" onclick="window.clicks = (window.clicks || 0) + 1; if (window.clicks > 1 && !window.never) window.moved = true">Tool</div></div>`;
const boardApi = (s) => async (_s, p) => {
  if (p.startsWith('/ui-api/list-info')) return INFO;
  if (p.startsWith('/ui-api/object-info')) return { fields: { Kind__c: { apiName: 'Kind__c', dataType: 'Picklist' } } };
  return { fields: { Kind__c: { value: (await s.page.evaluate(() => window.moved)) ? 'Tool' : 'Fruit', displayValue: null } } };
};

test('move clicks the column once more when neither a dialog nor a saved value follows within 3 s, and NOT_MOVED names what it saw', async (t) => {
  const s = await page(t, BOARD);
  stub(t, boardApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.move[0](s, { row: 'card', to: 'Tool', timeout: 6_000 });
  assert.deepEqual([r.field, await s.page.evaluate(() => window.clicks)], ['Kind__c', 2]);
  await s.page.evaluate(() => { window.moved = false; window.clicks = 0; window.never = true; });
  await assert.rejects(list.ACTIONS.move[0](s, { row: 'card', to: 'Tool', timeout: 5_000 }), (e) => e.code === 'NOT_MOVED'
    && JSON.stringify([e.evidence.dependencies, e.evidence.dialogShown, e.evidence.clickedAgain, e.evidence.toasts]) === '[false,false,true,[]]');
  assert.equal(await s.page.evaluate(() => window.clicks), 2, 'once more, not again and again');
});

// The retry still running when NOT_MOVED is thrown: a Tool item that hides on its click (the retry's click waits 10 s,
// then fails), or a Change column button that hides for 5 s (the retry clicks it after the throw).
const LATE = (tool, change) => `<div role="main">${STATUS}<button>Refresh</button><h2>Fruit (1)</h2><ul><li><a href="/lightning/r/${ID}/view">card</a>
<button onclick="window.changes = (window.changes || 0) + 1; ${change}">Change column for card.</button></li></ul></div>
<div role="menu"><div role="menuitem" tabindex="0" onclick="window.clicks = (window.clicks || 0) + 1; ${tool}">Tool</div></div>
<script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.esc = true; });</script>`;

test('once move has thrown NOT_MOVED, its retry clicks no menu item and presses no Escape', async (t) => {
  stub(t, async (_s, p) => {
    if (p.startsWith('/ui-api/list-info')) return INFO;
    if (p.startsWith('/ui-api/object-info')) return { fields: { Kind__c: { apiName: 'Kind__c', dataType: 'Picklist' } } };
    return { fields: { Kind__c: { value: 'Fruit', displayValue: null } } };
  });
  const run = async (body) => {
    const s = await page(t, body);
    await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
    await assert.rejects(list.ACTIONS.move[0](s, { row: 'card', to: 'Tool', timeout: 3_500 }), { code: 'NOT_MOVED' });
    await new Promise((r) => { setTimeout(r, 11_000); }); // past the retry's 10 s click wait
    return s.page.evaluate(() => [window.changes, window.clicks, !!window.esc]);
  };
  const [esc, click] = await Promise.all([run(LATE("this.style.display = 'none'", '')), run(LATE('', 'this.hidden = true; setTimeout(() => { this.hidden = false; }, 5000)'))]);
  assert.deepEqual(esc, [2, 1, false], 'no Escape after the throw');
  assert.deepEqual(click, [2, 1, false], 'no menu click after the throw');
});

// A card whose Tool item opens Edit Dependencies loading for 800 ms: a Done before its picklists show saves nothing.
const DEPS = `<div role="main">${STATUS}<button>Refresh</button><h2>Fruit (1)</h2><ul><li><a href="/lightning/r/${ID}/view">card</a>
<button>Change column for card.</button></li></ul></div>
<div role="menu"><div role="menuitem" tabindex="0" onclick="open_()">Tool</div></div>
<script>function open_() { document.body.insertAdjacentHTML('beforeend', '<div role=dialog aria-modal=true id=dd><h1>Edit Dependencies</h1><div role=status id=ld>Loading</div><button onclick=done()>Done</button></div>');
setTimeout(() => { document.getElementById('ld').outerHTML = '<input role=combobox aria-label=Detail>'; }, 800); }
function done() { if (document.querySelector('#dd [role=combobox]')) window.moved = true; else window.early = true; document.getElementById('dd').remove(); }</script>`;

test('move clicks Done only once the dependencies dialog shows its picklists', async (t) => {
  const s = await page(t, DEPS);
  stub(t, boardApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.move[0](s, { row: 'card', to: 'Tool', timeout: 5_000 });
  assert.deepEqual([r.dependencies, await s.page.evaluate(() => window.early)], [true, undefined]);
});

test('move does not choose the column again while the dependencies dialog is still loading after 3 s', async (t) => {
  const slow = DEPS.replace('}, 800); }', '}, 3800); }').replace('function open_() {', 'function open_() { if (document.getElementById(\'dd\')) return;').replace('<button>Change column for card.</button>', '<button onclick="window.changes = (window.changes || 0) + 1">Change column for card.</button>');
  const s = await page(t, slow);
  stub(t, boardApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.move[0](s, { row: 'card', to: 'Tool', timeout: 8_000 });
  assert.deepEqual([r.dependencies, await s.page.evaluate(() => window.changes)], [true, 1], 'one menu click');
});

// Two rows of Count: the editor's "Update 2 selected items" ticks only on a click on its label; Apply then Save writes
// window.saved, every row when it was ticked and only the first when not (or always, with window.firstOnly).
const ID2 = 'a03000000000002AAA';
const MASS_ROW = (id, n) => `<tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${id}/view">probe ${n}</a></th>
<td><input type="checkbox" aria-label="Select item ${n}" onchange="count()"></td><td><button onclick="window.row = '${id}'; document.getElementById('ed').hidden = false">Edit Count</button></td></tr>`;
const MASS = `<div role="main"><div role="status" aria-label="All" id="st">2 items</div>
<table role="grid" aria-label="All"><tr><th role="columnheader">Count</th></tr>${MASS_ROW(ID, 1)}${MASS_ROW(ID2, 2)}</table>
<button onclick="window.saved = window.applied">Save</button><button>Cancel</button></div>
<div role="dialog" aria-label="Edit Count" id="ed" hidden><input type="number" id="v">
<input type="checkbox" id="all" aria-label="Update 2 selected items" onclick="return false"><span onclick="document.getElementById('all').checked = true">Update 2 selected items</span>
<button onclick="window.applied = { v: document.getElementById('v').value, all: document.getElementById('all').checked && !window.firstOnly }; document.getElementById('ed').hidden = true">Apply</button></div>
<script>function count() { const n = document.querySelectorAll('[aria-label^="Select item"]:checked').length; document.getElementById('st').textContent = n ? n + ' items selected' : '2 items'; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('ed').hidden = true; }); </script>`;
const massApi = (s) => async (_s, p) => {
  if (p.startsWith('/ui-api/list-info')) return COUNT;
  const w = await s.page.evaluate(() => window.saved);
  const held = w && (p.includes(ID) || w.all) ? Number(w.v) : 1;
  return { fields: { Count__c: { value: held, displayValue: null } } };
};

test('massEdit ticks "Update N selected items" by its label and confirms every record on the server', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual([r.recordIds, r.field, await s.page.evaluate(() => window.saved.all)], [[ID, ID2], 'Count__c', true]);
});

test('massEdit fails NOT_SAVED naming the record the save left, and refuses rows not named before ticking', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.firstOnly = true; });
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'NOT_SAVED' && e.evidence.recordId === ID2);
  const other = await page(t, MASS);
  await other.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await other.page.getByRole('checkbox', { name: 'Select item 2' }).check();
  await assert.rejects(list.ACTIONS.massEdit[0](other, { rows: ['probe 1'], column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'OTHER_ROWS_SELECTED' && e.evidence.others.join() === 'probe 2');
  assert.equal(await other.page.getByRole('checkbox', { name: 'Select item 1' }).isChecked(), false);
});

// Change Owner's dialog: typing lists two users, the notification box starts ticked, Submit sets window.owner (unless
// window.ignore) and records what it sent in window.sent. Escape does not close it, its Cancel does (as on the org).
const OWNER = `<div role="main"><div role="status" aria-label="All" id="st">1 item</div>
<button onclick="document.body.insertAdjacentHTML('beforeend', document.getElementById('co').innerHTML)">Change Owner</button>
<table role="grid" aria-label="All"><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th>
<td><input type="checkbox" aria-label="Select item 1" onchange="document.getElementById('st').textContent = this.checked ? '1 item selected' : '1 item'"></td></tr></table></div>
<template id="co"><div role="dialog" aria-modal="true" aria-label="Change Owner" id="dlg">
<input role="combobox" aria-label="Select New Owner" oninput="document.getElementById('lb').hidden = false">
<div role="listbox" id="lb" hidden><div role="option" onclick="pick(this)">Probe Platform Two</div><div role="option" onclick="pick(this)">Probe Platform</div></div>
<input type="checkbox" id="mail" aria-label="Send notification email" checked>
<button onclick="document.getElementById('dlg').remove()">Cancel</button>
<button onclick="window.sent = { owner: window.picked, mail: document.getElementById('mail').checked }; if (!window.ignore) window.owner = window.picked; document.getElementById('dlg').remove()">Submit</button></div></template>
<script>function pick(o) { window.picked = o.textContent; document.getElementById('lb').hidden = true; }</script>`;
const ownerApi = (s) => async (_s, p) => {
  if (p.startsWith('/ui-api/list-info')) return INFO;
  if (p.startsWith('/ui-api/list-records')) return { records: [{ id: ID }] };
  const name = (await s.page.evaluate(() => window.owner)) || 'User User';
  return { fields: { OwnerId: { value: name === 'User User' ? '005000000000001AAA' : '005000000000002AAA' }, Owner: { value: { fields: { Name: { value: name } } } } } };
};

test('changeOwner picks the exact user, unticks the notification email unless notify, and confirms the owner on the server', async (t) => {
  const s = await page(t, OWNER);
  stub(t, ownerApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', timeout: 2_000 });
  assert.deepEqual([r.ownerId, r.notify, await s.page.evaluate(() => window.sent)], ['005000000000002AAA', false, { owner: 'Probe Platform', mail: false }]);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', notify: true, timeout: 2_000 });
  assert.equal(await s.page.evaluate(() => window.sent.mail), true, 'notify keeps the email');
});

test('changeOwner fails OWNER_NOT_CHANGED when the server keeps the old owner, and NOTIFY_NOT_SET before Submit when the email box will not change', async (t) => {
  const s = await page(t, OWNER);
  stub(t, ownerApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.ignore = true; });
  await assert.rejects(list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_NOT_CHANGED' && e.evidence.recordId === ID);
  const stuck = await page(t, OWNER.replace('checked>', 'checked onclick="return false">'));
  await stuck.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.changeOwner[0](stuck, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }), { code: 'NOTIFY_NOT_SET' });
  assert.equal(await stuck.page.evaluate(() => window.sent), undefined, 'nothing submitted');
  assert.equal(await stuck.page.locator('#dlg').count(), 0, 'the dialog is closed');
});

test('changeOwner whose dialog stays open after Submit carries the dialog\'s reason, then closes it', async (t) => {
  const s = await page(t, OWNER.replace("document.getElementById('dlg').remove()\">Submit", "if (window.ignore) document.getElementById('dlg').insertAdjacentHTML('beforeend', '<p>Error: this user cannot own the record</p>'); else document.getElementById('dlg').remove()\">Submit"));
  stub(t, ownerApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.ignore = true; });
  await assert.rejects(list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_NOT_CHANGED' && /cannot own the record/.test(e.evidence.dialog));
  assert.equal(await s.page.locator('#dlg').count(), 0, 'the dialog is closed');
});

test('massEdit on a column whose editor has no one box is EDITOR_UNSUPPORTED, its editor closed', async (t) => {
  const s = await page(t, MASS.replace('<input type="number" id="v">', ''));
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }), { code: 'EDITOR_UNSUPPORTED' });
  assert.equal(await s.page.locator('#ed').isVisible(), false, 'the editor is closed');
});

// A Level picklist cell: its editor is a combobox whose option closes the editor; Save keeps the picked option.
const PICK = `<div role="main"><div role="status" aria-label="All">1 item</div>
<table role="grid" aria-label="All"><tr><th role="columnheader">Level</th></tr>
<tr><th role="rowheader"><a href="/lightning/r/SfUiDyn__c/${ID}/view">dyn one</a></th>
<td><button onclick="document.getElementById('ed').hidden = false">Edit Level</button></td></tr></table>
<button onclick="window.saved = window.draft">Save</button><button>Cancel</button></div>
<div role="dialog" aria-label="Edit Level" id="ed" hidden><input role="combobox" aria-label="Level" onclick="document.getElementById('lb').hidden = false">
<div role="listbox" id="lb" hidden><div role="option" onclick="pick(null)">--None--</div><div role="option" onclick="pick('Low')">Low</div><div role="option" onclick="pick('High')">High</div></div></div>
<script>function pick(v) { window.draft = v; document.getElementById('lb').hidden = true; document.getElementById('ed').hidden = true; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('ed').hidden = true; }); </script>`;

const LEVEL = { fields: { Level__c: { apiName: 'Level__c', dataType: 'Picklist' } } };
test('edit picks a picklist cell\'s option, an empty value as --None--, and the server must hold it', async (t) => {
  const s = await page(t, PICK);
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? { ...INFO, displayColumns: [{ label: 'Level', fieldApiName: 'Level__c' }] }
    : p.startsWith('/ui-api/object-info') ? LEVEL : { fields: { Level__c: { value: (await s.page.evaluate(() => window.saved)) ?? null, displayValue: null } } }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiDyn__c/list?filterName=All`);
  assert.equal((await list.ACTIONS.edit[0](s, { row: 'dyn one', column: 'Level', value: 'High', timeout: 2_000 })).field, 'Level__c');
  assert.equal(await s.page.evaluate(() => window.saved), 'High');
  await list.ACTIONS.edit[0](s, { row: 'dyn one', column: 'Level', value: '', timeout: 2_000 });
  assert.equal(await s.page.evaluate(() => window.saved), null, '--None--');
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'dyn one', column: 'Level', value: 'Medium', timeout: 1_000 }), { code: 'NOT_FOUND' });
  assert.equal(await s.page.locator('#ed').isVisible(), false, 'an option not listed: the editor is closed');
});

// A lookup cell's editor is one combobox too (Opportunity Account Name, gate M4): only a Picklist field takes the option.
test('edit refuses a lookup cell EDITOR_UNSUPPORTED at once, though its editor is one combobox', async (t) => {
  const s = await page(t, PICK.replace(/Level/g, 'Account Name').replace('>High<', '>Acme<'));
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? { ...INFO, displayColumns: [{ label: 'Account Name', fieldApiName: 'Account.Name' }] }
    : p.startsWith('/ui-api/object-info') ? LEVEL : { fields: {} }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiDyn__c/list?filterName=All`);
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'dyn one', column: 'Account Name', value: 'Globex', timeout: 2_000 }), { code: 'EDITOR_UNSUPPORTED' });
  assert.ok(Date.now() - t0 < 3_000, `at once, ${Date.now() - t0} ms`);
});

// Lightning shows no "Update 1 selected items" for one row (gate M2): refused before the page is touched.
test('massEdit with one row, or one row named twice, is BAD_ARGS before any page read; two rows are not', async () => {
  for (const rows of [['probe 1'], ['probe 1', 'probe 1']]) {
    await assert.rejects(list.run({}, 'massEdit', { rows, column: 'Count', value: 5 }), (e) => e.code === 'BAD_ARGS' && /two or more different rows/.test(e.message));
  }
  assert.doesNotThrow(() => list.check({ action: 'massEdit', rows: ['probe 1', 'probe 2'], column: 'Count', value: 5 }));
});

// A row named twice beside another (gate G1): Lightning shows "Update 2 selected items", so the rows are the distinct ones.
test('massEdit with one row named twice beside another edits the two rows', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual([r.recordIds, await s.page.evaluate(() => window.saved.all)], [[ID, ID2], true]);
});

// Rows a massEdit or changeOwner ticked would make the next action on other rows OTHER_ROWS_SELECTED (gate G2).
const ticks = (s) => s.page.evaluate(() => [...document.querySelectorAll('[aria-label^="Select item"]')].map((b) => b.checked));
test('massEdit and changeOwner untick the rows they ticked, on success and on a failure; a row ticked before stays ticked', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual(await ticks(s), [false, false], 'after a save');
  await s.page.getByRole('checkbox', { name: 'Select item 1' }).check();
  await s.page.evaluate(() => { window.firstOnly = true; });
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 6, timeout: 1_000 }), { code: 'NOT_SAVED' });
  assert.deepEqual(await ticks(s), [true, false], 'after a failure: the row ticked before stays');
  const o = await page(t, OWNER2);
  stub(t, ownerApi(o));
  await o.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await list.ACTIONS.changeOwner[0](o, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 2_000 });
  assert.deepEqual(await ticks(o), [false, false], 'after a change of owner');
  await list.ACTIONS.select[0](o, { rows: ['probe 1', 'probe 2'] });
  assert.deepEqual(await ticks(o), [true, true], 'select keeps its rows');
});

// On the org Lightning clears every tick after Change Owner's Submit, the caller's row too (gate N2): the result names it.
test('changeOwner names the rows ticked before it that Lightning unticked; a massEdit that keeps them names none', async (t) => {
  const o = await page(t, OWNER2.replace('<button onclick="window.sent', '<button onclick="document.querySelectorAll(\'[aria-label^=&quot;Select item&quot;]\').forEach((b) => { b.checked = false; }); count(); window.sent'));
  stub(t, ownerApi(o));
  await o.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await o.page.getByRole('checkbox', { name: 'Select item 1' }).check();
  const r = await list.ACTIONS.changeOwner[0](o, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 2_000 });
  assert.deepEqual([r.unticked, await ticks(o)], [['probe 1'], [false, false]]);
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.getByRole('checkbox', { name: 'Select item 1' }).check();
  const m = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual([m.unticked, await ticks(s)], [undefined, [true, false]]);
});

// The first of two records deleted after it was selected (gate M3): the second is still read, saved or changed.
const { SfUiError } = require('../src/errors');
const gone = (p) => { if (p.includes(ID)) throw new SfUiError('API_ERROR', `GET ${p} as user answered 404 NOT_FOUND`, { status: 404 }); };
test('massEdit confirms every record when one is gone: NOT_SAVED names it gone and the one saved, and cancels the draft', async (t) => {
  const s = await page(t, MASS);
  const real = massApi(s);
  stub(t, async (_s, p) => { gone(p); return real(_s, p); });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'NOT_SAVED'
    && e.evidence.gone === true && e.evidence.recordId === ID && e.evidence.draft === 'cancelled' && /1 of 2 confirmed/.test(e.message)
    && JSON.stringify(e.evidence.records) === JSON.stringify([{ recordId: ID, confirmed: false, gone: true }, { recordId: ID2, confirmed: true, holds: { value: 5, displayValue: null } }]));
});

const OWNER2 = OWNER.replace(/<table[\s\S]*<\/table>/, `<table role="grid" aria-label="All">${MASS_ROW(ID, 1)}${MASS_ROW(ID2, 2)}</table>`).replace('>1 item<', '>2 items<')
  .replace('<script>', '<script>function count() { const n = document.querySelectorAll(\'[aria-label^="Select item"]:checked\').length; document.getElementById(\'st\').textContent = n ? n + \' items selected\' : \'2 items\'; } ');
test('changeOwner reads the owner of every record: one gone is OWNER_NOT_CHANGED naming it gone and the one changed', async (t) => {
  const s = await page(t, OWNER2);
  const real = ownerApi(s);
  stub(t, async (_s, p) => { gone(p); return real(_s, p); });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.changeOwner[0](s, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_NOT_CHANGED'
    && e.evidence.gone === true && e.evidence.recordId === ID && /1 of 2 confirmed/.test(e.message)
    && JSON.stringify(e.evidence.records) === JSON.stringify([{ recordId: ID, confirmed: false, gone: true }, { recordId: ID2, confirmed: true, holds: { ownerId: '005000000000002AAA', name: 'Probe Platform' } }]));
});

// Rows already owned by the target: a change to them confirms nothing.
test('changeOwner refuses before Submit when every row already has the owner, and names the rows that had it when some do', async (t) => {
  const s = await page(t, OWNER);
  stub(t, ownerApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.owner = 'Probe Platform'; });
  await assert.rejects(list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_ALREADY_SET' && e.evidence.recordIds.join() === ID);
  assert.deepEqual([await s.page.evaluate(() => window.sent), await s.page.locator('#dlg').count()], [undefined, 0], 'nothing submitted, the dialog closed');
  const two = await page(t, OWNER2);
  const real = ownerApi(two);
  stub(t, async (_s, p) => { const r = await real(_s, p); if (p.includes(ID)) r.fields.Owner.value.fields.Name.value = 'Probe Platform'; return r; });
  await two.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.changeOwner[0](two, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 1_000 });
  assert.deepEqual([r.recordIds, r.already, await two.page.evaluate(() => window.sent.owner)], [[ID, ID2], [ID], 'Probe Platform']);
});

// A picklist column in a mass edit (measured on the org, probe-pickmass P1): the option leaves the editor open, then
// "Update 2 selected items" and Apply, as for a number.
const MASS_PICK = MASS.replace('<input type="number" id="v">', '<input role="combobox" aria-label="Count" id="v" onclick="document.getElementById(\'lb\').hidden = false">'
  + '<div role="listbox" id="lb" hidden><div role="option" onclick="document.getElementById(\'v\').value = \'High\'; this.parentNode.hidden = true">High</div></div>');
test('massEdit picks a picklist column\'s option, ticks "Update N selected items" and confirms every record', async (t) => {
  const s = await page(t, MASS_PICK);
  stub(t, async (_s, p) => {
    if (p.startsWith('/ui-api/list-info')) return COUNT;
    if (p.startsWith('/ui-api/object-info')) return { fields: { Count__c: { apiName: 'Count__c', dataType: 'Picklist' } } };
    const w = await s.page.evaluate(() => window.saved);
    return { fields: { Count__c: { value: w && (p.includes(ID) || w.all) ? w.v : 'Low', displayValue: null } } };
  });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 'High', timeout: 2_000 });
  assert.deepEqual([r.recordIds, await s.page.evaluate(() => window.saved)], [[ID, ID2], { v: 'High', all: true }]);
});

// A cell that already holds the value makes no draft, so there is no Save (measured on the org, probe-pickmass Q7: text
// and picklist each ended NOT_FOUND "Save" after 11 s). One rule for every kind: refused before the editor opens.
test('edit and massEdit to the value every record already holds are VALUE_ALREADY_SET at once, with no editor opened', async (t) => {
  const s = await page(t, PICK);
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? { ...INFO, displayColumns: [{ label: 'Level', fieldApiName: 'Level__c' }] }
    : p.startsWith('/ui-api/object-info') ? LEVEL : { fields: { Level__c: { value: 'High', displayValue: 'High' } } }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiDyn__c/list?filterName=All`);
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'dyn one', column: 'Level', value: 'High', timeout: 2_000 }), (e) => e.code === 'VALUE_ALREADY_SET' && e.evidence.recordIds.join() === ID);
  assert.ok(Date.now() - t0 < 2_000, `at once, ${Date.now() - t0} ms`);
  assert.equal(await s.page.locator('#ed').isVisible(), false, 'no editor opened');
  const text = await page(t, EDIT);
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: 5, displayValue: null } } }));
  await text.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.edit[0](text, { row: 'probe one', column: 'Count', value: 5, timeout: 2_000 }), { code: 'VALUE_ALREADY_SET' });
  const mass = await page(t, MASS);
  stub(t, massApi(mass)); // both hold 1 before a save
  await mass.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](mass, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 1, timeout: 2_000 }), (e) => e.code === 'VALUE_ALREADY_SET' && e.evidence.recordIds.length === 2);
});

test('massEdit fails NOT_SAVED when "Update N selected items" will not tick, before Apply, its editor closed', async (t) => {
  const s = await page(t, MASS.replace('<span onclick="document.getElementById(\'all\').checked = true">', '<span>'));
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'NOT_SAVED' && /did not tick/.test(e.message));
  assert.deepEqual([await s.page.evaluate(() => window.applied), await s.page.locator('#ed').isVisible()], [undefined, false], 'not applied, editor closed');
});

test('changeOwner takes notify; the other actions refuse it', () => {
  assert.doesNotThrow(() => list.check({ action: 'changeOwner', rows: ['a'], owner: 'Probe Platform', notify: true }));
  assert.throws(() => list.check({ action: 'mass', rows: ['a'], button: 'Change Owner', notify: true }), { code: 'BAD_ARGS' });
});

// On the org a row header's link sits in a shadow root, where querySelector does not reach (probe-ticked: no a[href]).
const SHADOW = MASS.replace(/<a href="([^"]+)">(probe \d)<\/a>/g, '<x-link data-href="$1">$2</x-link>')
  .replace('<script>', '<script>customElements.define(\'x-link\', class extends HTMLElement { connectedCallback() { const a = document.createElement(\'a\'); a.href = this.dataset.href; a.textContent = this.textContent; this.textContent = \'\'; this.attachShadow({ mode: \'open\' }).append(a); } }); ');
test('massEdit on two named rows already ticked is not refused when their links sit in a shadow root', async (t) => {
  const s = await page(t, SHADOW);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  for (const n of [1, 2]) await s.page.getByRole('checkbox', { name: `Select item ${n}` }).check();
  const r = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual(r.recordIds, [ID, ID2]);
});

// On the org the status line can lag a ticked row for a moment (list.test.js mass, 1 run in 3: it read 0 selected).
test('mass refuses a ticked row not named while the status line does not yet count it', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { document.querySelector('[aria-label="Select item 2"]').checked = true; }); // no change event: the status still reads 2 items
  await assert.rejects(list.ACTIONS.mass[0](s, { rows: ['probe 1'], button: 'Change Owner', timeout: 1_000 }), (e) => e.code === 'OTHER_ROWS_SELECTED' && e.evidence.others.join() === 'probe 2');
});

// edit on one of two ticked rows opens the mass editor (gate G2, measured on the org: probe-measure A): its box left
// unticked, Apply then Save writes that row only.
test('edit on a row while two rows are ticked applies to that row only and leaves the other ticked row as it was', async (t) => {
  const s = await page(t, MASS);
  stub(t, async (_s, p) => {
    if (p.startsWith('/ui-api/list-info')) return COUNT;
    const { w, row } = await s.page.evaluate(() => ({ w: window.saved, row: window.row }));
    return { fields: { Count__c: { value: w && (w.all || p.includes(`/${row}?`)) ? Number(w.v) : 1, displayValue: null } } };
  });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await list.ACTIONS.select[0](s, { rows: ['probe 1', 'probe 2'] });
  const r = await list.ACTIONS.edit[0](s, { row: 'probe 2', column: 'Count', value: 7, timeout: 2_000 });
  const other = (await api.call(s, `/ui-api/records/${ID}?fields=SfUiProbe__c.Count__c`)).fields.Count__c.value;
  assert.deepEqual([r.recordId, other, await s.page.evaluate(() => window.saved.all), await s.page.locator('#ed').isVisible()], [ID2, 1, false, false]);
});

test('an edit with no Save to click closes its cell editor', async (t) => {
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-info') ? COUNT : { fields: { Count__c: { value: 1, displayValue: null } } }));
  const s = await page(t, `${EDIT.replace(/<button onclick="if \(window.fail\)[^\n]*\n/, '')}<script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('ed').hidden = true; });</script>`);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.edit[0](s, { row: 'probe one', column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'NOT_FOUND' && e.evidence.name === 'Save');
  assert.equal(await s.page.locator('#ed').isVisible(), false, 'the editor is closed');
});

// A record the session user can no longer see answers it 404, as a deleted one does (gate G3, probe-unseen): admin reads
// it once more, and that read decides between unseen and gone.
const hidden = (real, adminToo) => async (_s, p, o) => { if (p.includes(ID) && p.startsWith('/ui-api/records') && (o?.as !== 'admin' || adminToo)) gone(p); return real(_s, p); };
test('a record that answers 404 to the session user is confirmed by admin\'s read as unseen, and is gone only when admin gets 404 too', async (t) => {
  const s = await page(t, MASS);
  stub(t, hidden(massApi(s)));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const m = await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 });
  assert.deepEqual([m.recordIds, m.unseen], [[ID, ID2], [ID]]);
  const o = await page(t, OWNER2);
  stub(t, hidden(ownerApi(o)));
  await o.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.changeOwner[0](o, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 2_000 });
  assert.deepEqual([r.recordIds, r.unseen], [[ID, ID2], [ID]]);
  const g = await page(t, OWNER2);
  stub(t, hidden(ownerApi(g), true));
  await g.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.changeOwner[0](g, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_NOT_CHANGED' && e.evidence.gone === true && e.evidence.recordId === ID);
});

// The user's read answers 404 and admin's read holds the old value or owner (gate N4, N5): a failure, marked unseen.
const oldToAdmin = (real, old) => async (_s, p, o) => { if (p.includes(ID) && p.startsWith('/ui-api/records')) { if (o?.as !== 'admin') gone(p); return old; } return real(_s, p); };
const unseenFail = (code, holds) => (e) => e.code === code && e.evidence.recordId === ID && e.evidence.unseen === true && /session user's read answered 404/.test(e.message)
  && JSON.stringify(e.evidence.records[0]) === JSON.stringify({ recordId: ID, confirmed: false, holds, unseen: true });
test('a record unseen by the session user whose admin read holds the old value or owner fails, and says the value is admin\'s', async (t) => {
  const s = await page(t, MASS);
  const count = { fields: { Count__c: { value: 1, displayValue: null } } };
  stub(t, oldToAdmin(massApi(s), count));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 }), unseenFail('NOT_SAVED', count.fields.Count__c));
  const o = await page(t, OWNER2);
  stub(t, oldToAdmin(ownerApi(o), { fields: { OwnerId: { value: '005000000000001AAA' }, Owner: { value: { fields: { Name: { value: 'User User' } } } } } }));
  await o.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.changeOwner[0](o, { rows: ['probe 1', 'probe 2'], owner: 'Probe Platform', timeout: 2_000 }), unseenFail('OWNER_NOT_CHANGED', { ownerId: '005000000000001AAA', name: 'User User' }));
});

// On the org the Cancel goes before its dialog does (gate G5): one click, and no cleanup failure when it closed.
test('changeOwner closes its dialog with one Cancel though the dialog takes a moment to go, with no cleanup evidence', async (t) => {
  const s = await page(t, OWNER.replace('<button onclick="document.getElementById(\'dlg\').remove()">Cancel', '<button onclick="window.cancels = (window.cancels || 0) + 1; this.remove(); setTimeout(() => document.getElementById(\'dlg\').remove(), 300)">Cancel'));
  stub(t, ownerApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { window.owner = 'Probe Platform'; });
  const t0 = Date.now();
  await assert.rejects(list.ACTIONS.changeOwner[0](s, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }), (e) => e.code === 'OWNER_ALREADY_SET' && !e.evidence.cleanup);
  assert.ok(Date.now() - t0 < 5_000, `${Date.now() - t0} ms`);
  assert.deepEqual([await s.page.evaluate(() => window.cancels), await s.page.locator('#dlg').count()], [1, 0]);
});

// After a save that failed on a record gone, the grid's error popover stays open on the org (gate G6, probe-measure C).
test('a failed massEdit closes the grid\'s error popover with its draft', async (t) => {
  const s = await page(t, MASS.replace('<button onclick="window.saved = window.applied">Save</button>', '<button onclick="window.saved = window.applied; document.body.insertAdjacentHTML(\'beforeend\', \'<div role=dialog aria-label=&quot;Your attention, please&quot; id=pop>Item 1 has an error</div>\')">Save</button>')
    + '<script>document.addEventListener(\'keydown\', (e) => { if (e.key === \'Escape\') document.getElementById(\'pop\')?.remove(); });</script>');
  const real = massApi(s);
  stub(t, async (_s, p) => { gone(p); return real(_s, p); });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }), (e) => e.code === 'NOT_SAVED' && e.evidence.gone === true);
  assert.equal(await s.page.locator('#pop').count(), 0, 'the popover is closed');
});

// Gate 3's guards with no red test (m06, m01, m05, m14, m15, m23).
test('massEdit is not refused when only the first row already holds the value: every record is read', async (t) => {
  const s = await page(t, MASS);
  const real = massApi(s);
  stub(t, async (_s, p) => { const r = await real(_s, p); if (p.includes(ID) && r.fields && !(await s.page.evaluate(() => window.saved))) r.fields.Count__c.value = 5; return r; });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  assert.deepEqual((await list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 2_000 })).recordIds, [ID, ID2]);
});

test('a record read after one that used the whole deadline still gets its 2 s; of two failures the first is the error', async (t) => {
  const s = await page(t, MASS);
  let second = true; // the second record takes the value; false: neither does
  stub(t, async (_s, p) => {
    if (p.startsWith('/ui-api/list-info')) return COUNT;
    const w = await s.page.evaluate(() => window.saved);
    if (w && p.includes(ID2)) await new Promise((r) => setTimeout(r, 200)); // a read that takes a moment, as on the org
    return { fields: { Count__c: { value: w && second && p.includes(ID2) ? Number(w.v) : 1, displayValue: null } } };
  });
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 500 }),
    (e) => e.code === 'NOT_SAVED' && e.evidence.recordId === ID && e.evidence.records[1].confirmed === true);
  second = false;
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 6, timeout: 500 }),
    (e) => e.code === 'NOT_SAVED' && e.evidence.recordId === ID && e.evidence.records.every((r) => !r.confirmed));
});

test('a dialog that will not close is named in the cleanup evidence, and so is a close that fails', async (t) => {
  const s = await page(t, MASS.replace('<input type="number" id="v">', '').replace("if (e.key === 'Escape') document.getElementById('ed').hidden = true;", ''));
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.massEdit[0](s, { rows: ['probe 1', 'probe 2'], column: 'Count', value: 5, timeout: 1_000 }),
    (e) => e.code === 'EDITOR_UNSUPPORTED' && e.evidence.cleanup === 'still open after 3 tries to close it');
  const o = await page(t, OWNER.replace('<button onclick="document.getElementById(\'dlg\').remove()">Cancel</button>', ''));
  stub(t, ownerApi(o));
  await o.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await o.page.evaluate(() => { window.owner = 'Probe Platform'; });
  await assert.rejects(list.ACTIONS.changeOwner[0](o, { rows: ['probe one'], owner: 'Probe Platform', timeout: 1_000 }),
    (e) => e.code === 'OWNER_ALREADY_SET' && /Cancel/.test(e.evidence.cleanup));
});

test('mass refuses when the status line counts rows ticked off this page, though every ticked row on it is named', async (t) => {
  const s = await page(t, MASS);
  stub(t, massApi(s));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await s.page.evaluate(() => { document.querySelector('[aria-label="Select item 1"]').checked = true; document.getElementById('st').textContent = '3 items selected'; });
  await assert.rejects(list.ACTIONS.mass[0](s, { rows: ['probe 1'], button: 'Change Owner', timeout: 1_000 }), (e) => e.code === 'OTHER_ROWS_SELECTED' && e.evidence.selected === 3 && /none on this page/.test(e.message));
});

// On the org the Filters panel sometimes never renders on a page load though its toggle reads pressed, and a reload
// brings it (probe-lostclick). Here the first load's panel never renders; the second opens at once.
const PANEL = (delay, dead) => `<div role="main"><div role="status" aria-label="All">1 item</div>
<button aria-pressed="false" id="f" onclick="sessionStorage.clicks = +(sessionStorage.clicks || 0) + 1; this.setAttribute('aria-pressed', 'true'); if (!(${dead} && sessionStorage.loads === '1')) setTimeout(() => { document.getElementById('p').hidden = false; }, ${delay})">Filters</button>
<div id="p" hidden><button>Add Filter</button><button onclick="sessionStorage.removed = 1">Remove filter: "Kind equals x"</button>
<button onclick="sessionStorage.saved = sessionStorage.removed">Save</button></div>
<table role="grid" aria-label="All"><tr><th role="rowheader"><a href="/lightning/r/SfUiProbe__c/${ID}/view">probe one</a></th></tr></table></div>
<script>sessionStorage.loads = +(sessionStorage.loads || 0) + 1;</script>`;
const panelRun = async (t, delay, dead) => {
  const s = await page(t, PANEL(delay, dead));
  const KIND = [{ label: 'Kind', operator: 'Equals', operandLabels: ['x'] }];
  stub(t, async (_s, p) => (p.startsWith('/ui-api/list-records') ? { records: [{ id: ID }] }
    : { ...INFO, filteredByInfo: (await s.page.evaluate(() => sessionStorage.saved)) ? [] : KIND }));
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const r = await list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 });
  return [r.filters, r.reloaded, await s.page.evaluate(() => [+sessionStorage.loads, +sessionStorage.clicks])];
};
test('a Filters panel that never renders on its page load is opened after one reload, and the result says so', async (t) => {
  assert.deepEqual(await panelRun(t, 0, true), [0, true, [2, 2]]);
});
test('a Filters panel that takes 2 s to open gets one click and no reload', async (t) => {
  assert.deepEqual(await panelRun(t, 2_000, false), [0, undefined, [1, 1]]);
});
// Gate N3: no reload over ticked rows or an inline draft; a panel dead after the reload, or locked, is a coded error.
const panelFail = async (t, html) => {
  const s = await page(t, html);
  stub(t, LISTS);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  const e = await list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 }).then(() => ({}), (x) => x);
  return [e.code, e.evidence, await s.page.evaluate(() => +sessionStorage.loads)];
};
test('a Filters panel that never renders is not reloaded over ticked rows or an inline draft, and says why', async (t) => {
  assert.deepEqual(await panelFail(t, PANEL(0, true).replace('>1 item<', '>1 item selected<')), ['NOT_FOUND', { ticked: 1 }, 1]);
  assert.deepEqual(await panelFail(t, PANEL(0, true).replace('<table', '<button>Cancel</button><button>Save</button><table')), ['NOT_FOUND', { draft: true }, 1]);
});
test('a Filters panel dead after its reload, or shown with no Add Filter, is NOT_FOUND; a locked panel is not reloaded', async (t) => {
  assert.deepEqual(await panelFail(t, PANEL(0, true).replace("sessionStorage.loads === '1'", 'true')), ['NOT_FOUND', { reloaded: true }, 2]);
  assert.deepEqual(await panelFail(t, PANEL(0, false).replace('<button>Add Filter</button>', '<h2>Filters</h2><h3>Locked Filters</h3>')), ['NOT_FOUND', { locked: true }, 1]);
});
test('a Filters panel that never renders on a searched list is NOT_FOUND, not reloaded away from the search', async (t) => {
  const s = await page(t, PANEL(0, true).replace('<button aria-pressed', '<input type="search" aria-label="Search this list..." value="probe"><button aria-pressed'));
  stub(t, LISTS);
  await s.page.goto(`${ORIGIN}/lightning/o/SfUiProbe__c/list?filterName=All`);
  await assert.rejects(list.ACTIONS.removeFilter[0](s, { field: 'Kind', operator: 'equals', value: 'x', timeout: 2_000 }), (e) => e.code === 'NOT_FOUND' && e.evidence.search === 'probe');
  assert.equal(await s.page.evaluate(() => +sessionStorage.loads), 1);
});
