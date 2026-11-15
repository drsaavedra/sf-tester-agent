'use strict';

// Actions on the open list view. Each one confirms its effect with a second signal read apart from its click, from the
// server (UI API) where it can, and throws a coded error when that signal does not come.
const { SfUiError, AT } = require('./errors');
const api = require('./api');
const act = require('./act');
const modal = require('./modal');
const nav = require('./nav');
const { MORE } = require('./action');
const A = require('./anchors');

// The list the page shows, from its URL (a split view record keeps the list in its sv parameter).
function listOf(url) {
  let u = new URL(url);
  if (u.searchParams.get('sv')) u = new URL(u.searchParams.get('sv'), u.origin);
  const m = /^\/lightning\/o\/(\w+)\/list$/.exec(u.pathname);
  const listView = u.searchParams.get('filterName');
  if (!m || !listView || !/^\w+$/.test(listView)) throw new SfUiError('NOT_ON_LIST', 'no list view is open: open one with sf_open_list first', { url });
  return { objectApiName: m[1], listView };
}

// The status line: "4 items • Sorted by Probe Name •", "50+ items", or "2 items selected" while rows are selected.
function counts(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const sel = /(\d+) items? selected/.exec(t);
  const all = /^(\d+)(\+)? items?\b(?! selected)/.exec(t.trim());
  return { selected: sel ? Number(sel[1]) : 0, items: all ? Number(all[1]) : null, more: !!(all && all[2]) };
}

// The open list's names, its list-info and its parts on the page.
async function context(s) {
  const { objectApiName, listView } = listOf(s.page.url());
  const info = await nav.listInfo(s, objectApiName, listView);
  const main = s.page.getByRole('main');
  return {
    s, objectApiName, listView, info, main,
    status: s.page.getByRole('status', { name: info.label, exact: true }),
    grid: main.getByRole('grid', { name: info.label, exact: true }),
  };
}

// The list shown as a Table, with rows when the action needs one: NOT_TABLE names the display it shows instead, at once.
async function table(c, { rows = true, timeout = 15_000 } = {}) {
  await nav.listShown(c.s, `the list ${c.info.label}`, timeout, c.info.label);
  const display = await nav.displayOf(c.s.page, c.info.label);
  if (display !== 'Table') throw new SfUiError('NOT_TABLE', `the list shows as ${display}, not as a Table: show it with sf_list display Table first`, { display });
  if (rows && !(await c.grid.isVisible())) throw new SfUiError('LIST_EMPTY', `the list ${c.info.label} has no rows`, { listView: c.listView });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A read that may pass on the next try: a server error, or the page's fetch failing on the network (no answer at all).
const transient = (e) => (e.code === 'API_ERROR' ? !(e.evidence?.status < 500) : /\bFailed to fetch\b/.test(e.message));
// Polls read until ok(value), or throws code with the last value read: the second signal never came. A read that runs
// past the deadline ends the poll; a transient failure is read again, and is thrown when it is the last thing read.
async function until(read, ok, { timeout, code, message }) {
  const end = Date.now() + timeout;
  let last;
  let failed;
  for (;;) {
    const late = Symbol('late');
    let timer; // cleared once the read wins, so a finished poll does not keep the process alive until the deadline
    const got = await Promise.race([read().then((v) => ({ v }), (e) => ({ e })), new Promise((r) => { timer = setTimeout(() => r(late), Math.max(0, end - Date.now())); })]);
    clearTimeout(timer);
    if (got === late) { if (failed) throw failed; throw new SfUiError(code, last === undefined ? `no read came back within ${timeout} ms` : message(last), { seen: last }); }
    if (got.e && !transient(got.e)) throw got.e;
    [last, failed] = got.e ? [last, got.e] : [got.v, undefined];
    if (!got.e && ok(last)) return last;
    if (Date.now() > end) { if (failed) throw failed; throw new SfUiError(code, message(last), { seen: last }); }
    await sleep(250);
  }
}

const statusOf = async (c) => counts(await c.status.innerText({ timeout: 10_000 }));
const idOf = (href) => nav.recordIdOf(href || '');
// The record ids of the grid's rows, in page order (the first 50 a page loads).
async function gridIds(c) {
  const links = c.grid.getByRole('rowheader').getByRole('link');
  return (await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).map(idOf).slice(0, 50);
}
// The ids the server lists for this list view, sorted and searched as given, first page.
async function serverIds(c, { sortBy, searchTerm } = {}) {
  const q = new URLSearchParams({ pageSize: '50', ...(sortBy && { sortBy }), ...(searchTerm && { searchTerm }) });
  const r = await api.call(c.s, `/ui-api/list-records/${c.objectApiName}/${c.listView}?${q}`);
  return r.records.map((x) => x.id);
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const searchOf = (c) => c.main.getByRole('searchbox', { name: 'Search this list...' }).inputValue({ timeout: 2_000 });
// The search term the rows are under: a list with no search box is not searched (search itself still needs the box).
const termOf = async (c) => ((await c.main.getByRole('searchbox', { name: 'Search this list...' }).count()) ? searchOf(c) : undefined);
const sortOf = (c) => (c.info.orderedByInfo || []).map((o) => `${o.isAscending ? '' : '-'}${o.fieldApiName}`).join(',') || undefined;

// The grid shows what the server lists for that sort and search, row for row: LIST_MISMATCH when it never does.
async function confirmRows(c, { sortBy, searchTerm, timeout = 15_000, code = 'LIST_MISMATCH', what = 'the list' }) {
  let want = await serverIds(c, { sortBy, searchTerm });
  let reads = 0;
  return until(async () => {
    if ((reads += 1) % 8 === 0) want = await serverIds(c, { sortBy, searchTerm }); // a search index can lag a new record
    return { grid: await gridIds(c), server: want };
  }, (x) => same(x.grid, x.server), { timeout, code, message: (x) => `${what} does not show what the server lists (${x.grid.length} rows on the page, ${x.server.length} from the server)` });
}

// A column of the list by its header label: its field and its header cell.
function columnOf(c, label) {
  const col = (c.info.displayColumns || []).find((d) => d.label === label);
  if (!col) throw new SfUiError('COLUMN_NOT_FOUND', `the list has no column ${label}`, { column: label, columns: (c.info.displayColumns || []).map((d) => d.label) });
  return { field: col.fieldApiName, header: c.grid.getByRole('columnheader', { name: label, exact: true }) };
}

async function sort(s, { column, direction = 'ascending', timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  const { field, header } = columnOf(c, column);
  // The header button toggles ascending and descending; two presses at most reach either.
  for (let i = 0; i < 2 && (await header.getAttribute('aria-sort')) !== direction; i += 1) {
    const before = await header.getAttribute('aria-sort');
    await act.click(c.grid, { name: `Sort by: ${column}` });
    await until(() => header.getAttribute('aria-sort'), (v) => v !== before, { timeout, code: 'SORT_NOT_APPLIED', message: (v) => `the ${column} header stayed ${v}` });
  }
  const sorted = await header.getAttribute('aria-sort');
  if (sorted !== direction) throw new SfUiError('SORT_NOT_APPLIED', `the ${column} header shows ${sorted}, not ${direction}`, { column, direction, sorted });
  const sortBy = `${direction === 'descending' ? '-' : ''}${field}`;
  const { grid } = await confirmRows(c, { sortBy, searchTerm: await termOf(c), timeout, what: `the list sorted by ${column} ${direction}` });
  return { column, field, direction, rows: grid.length };
}

async function search(s, { text, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { rows: false, timeout });
  // Refresh first: without it a search can run over rows loaded before a record was made (catalogue route list-search@list-view).
  await act.click(c.main, { name: 'Refresh' });
  await act.fill(c.main, { role: 'searchbox', name: 'Search this list...', value: text });
  await act.press(s.page, { key: 'Enter' });
  const { grid } = await confirmRows(c, { sortBy: sortOf(c), searchTerm: text, timeout, code: 'SEARCH_NOT_APPLIED', what: `the list searched for "${text}"` });
  const box = await searchOf(c);
  if (box !== String(text)) throw new SfUiError('SEARCH_NOT_APPLIED', `the search box holds "${box}", not "${text}"`, { text, box });
  const { items, more } = await statusOf(c);
  return { text, items, ...(more && { more }), rows: grid.length };
}

// The one row holding the text, its record id and its checkbox.
async function rowOf(c, row) {
  const at = await act.resolve(c.grid, { row, role: 'rowheader', timeout: 10_000 });
  const recordId = idOf(await at.getByRole('link').first().getAttribute('href'));
  return { recordId, line: c.grid.getByRole('row').filter({ hasText: row }) }; // the one row act.resolve found
}

// Selects (never clears) each row; the status line must count each one this call selected on top of those before.
async function select(s, { rows, timeout = 10_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  const ids = [];
  let { selected: n } = await statusOf(c);
  for (const row of rows) {
    const { recordId, line } = await rowOf(c, row);
    if (!(await line.getByRole('checkbox').isChecked())) {
      await act.click(c.grid, { row, role: 'checkbox' });
      n += 1;
    }
    if (!ids.includes(recordId)) ids.push(recordId); // a row named twice is one row: ticked, counted and edited once
  }
  const { selected } = await confirmSelected(c, n, timeout);
  return { selected, recordIds: ids };
}
// The status line's count of selected rows, apart from the checkboxes the clicks set.
const confirmSelected = (c, n, timeout) => until(() => statusOf(c), (x) => x.selected === n, { timeout, code: 'SELECTION_MISMATCH', message: (x) => `the status line counts ${x.selected} selected, not ${n}` });

// Deletes the row's record from its row menu; the server must no longer return it and the row must leave the list.
async function remove(s, { row, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  const { recordId } = await rowOf(c, row);
  await act.click(c.grid, { row, name: 'Show Actions' });
  await act.click(s.page, { role: 'menuitem', name: 'Delete' }); // the row menu renders outside main
  await act.click(await modal.find(s, { timeout: 10_000 }), { name: 'Delete' });
  await confirmGone(c, recordId, timeout);
  const { grid } = await until(async () => ({ grid: await gridIds(c) }), (x) => !x.grid.includes(recordId), { timeout, code: 'ROW_STILL_SHOWN', message: () => `${recordId} is deleted but its row is still in the list` });
  return { deleted: recordId, rows: grid.length };
}
// The record is gone when the server answers 404 for it.
const confirmGone = (c, recordId, timeout) => until(
  () => api.call(c.s, `/ui-api/records/${recordId}?fields=${c.objectApiName}.Id`).then(() => 200, (e) => { if (e.evidence?.status === 404) return 404; throw e; }),
  (st) => st === 404, { timeout, code: 'NOT_DELETED', message: (st) => `${recordId} still answers ${st}` });

// The grid's own words when a save fails ("Row Number 1 has 1 errors", "Fix the errors and try saving again") and its
// popover's ("Item 1 has errors in these fields: Count.").
const saveErrors = async (c) => [
  ...(await c.main.getByRole('button', { name: /has \d+ errors?$|^Fix the errors/ }).allInnerTexts()),
  ...(await c.s.page.getByRole('dialog').getByText(/has errors in these fields/).allInnerTexts()),
].map((t) => t.trim()).filter(Boolean);

// The cell editor from the row's pencil, given the value: one text or number box takes it typed, a Picklist field's
// combobox the option of that label (--None-- for ''). For one row Enter or the option closes it; for n rows "Update n
// selected items" is ticked and Apply closes it. Closed again on a failure.
const editorOf = (c, column) => c.s.page.getByRole('dialog', { name: `Edit ${column}`, exact: true });
async function fillCell(c, { row, column, field, value, n = 1 }) {
  const editor = editorOf(c, column);
  await closing(c.s, editor, async () => {
    await act.click(c.grid, { row, name: `Edit ${column}` });
    await editor.waitFor({ timeout: 10_000 });
    const box = editor.getByRole('textbox').or(editor.getByRole('spinbutton'));
    const pick = editor.getByRole('combobox');
    const typed = (await box.count()) === 1;
    if (typed) await box.fill(String(value), { timeout: 10_000 });
    else if ((await pick.count()) === 1 && (await picklistsOf(c)).includes(field)) { // a lookup's editor is one combobox too
      await pick.click({ timeout: 10_000 }); // disabled until its values load
      await act.click(editor, { role: 'option', name: String(value) === '' ? '--None--' : String(value) });
    } else throw new SfUiError('EDITOR_UNSUPPORTED', `the ${column} cell editor has no one text, number or picklist box`, { column, snapshot: await act.snapshot(editor) });
    // One row while other rows are ticked opens the mass editor: its box left unticked, Apply edits this row only.
    const mass = (await editor.getByRole('checkbox', { name: /^Update \d+ selected items$/ }).count()) > 0;
    if (n === 1 && !mass) { if (typed) await act.press(c.s.page, { key: 'Enter' }); return; }
    // The box ticks only on a click on its label (check() leaves it as it was); unticked, Apply edits the first row only.
    const all = `Update ${n} selected items`;
    const tick = editor.getByRole('checkbox', { name: all, exact: true });
    if (n > 1 && !(await tick.isChecked({ timeout: 10_000 }))) await editor.getByText(all, { exact: true }).click({ timeout: 10_000 });
    if (n > 1 && !(await tick.isChecked())) throw new SfUiError('NOT_SAVED', `"${all}" did not tick`, { column, snapshot: await act.snapshot(editor) });
    await act.click(editor, { name: 'Apply' });
  });
}

// Inline edit of one cell (fillCell), then the Save under the grid; the server must then hold the value.
async function edit(s, { row, column, value, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  const { field } = columnOf(c, column);
  const { recordId } = await rowOf(c, row);
  await refuseHeld(c, [recordId], field, value);
  await fillCell(c, { row, column, field, value });
  const unseen = await saveAll(c, [recordId], field, value, timeout, column);
  return { recordId, field, value: String(value), ...(unseen.length && { unseen }) };
}
// A failure before Save or Submit closes the editor or dialog it opened (Escape by default; an open option list closes
// first), so the next call meets the page as this one found it; a cleanup that fails is in the evidence.
async function closing(s, dialog, steps, close = () => act.press(s.page, { key: 'Escape' })) {
  try { return await steps(); } catch (e) {
    try {
      for (let i = 0; i < 3 && (await dialog.isVisible()); i += 1) { // a dialog still closing is waited for, not closed again
        await close();
        await dialog.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {}); // still open: the loop's next read says so
      }
      if (await dialog.isVisible()) e.evidence = { ...e.evidence, cleanup: 'still open after 3 tries to close it' };
    } catch (undo) { e.evidence = { ...e.evidence, cleanup: undo.message }; }
    throw e;
  }
}
// The Save under the grid; then each record must hold the value. A failed save leaves the draft and its markers: the
// grid's Cancel drops them (a cleanup that fails is in the evidence). Returns the records the session user no longer sees.
async function saveAll(c, recordIds, field, value, timeout, column) {
  const stale = await saveErrors(c); // a marker an earlier failed save left is not this save's reason
  // This save's errors: each text shown more times than before the Save click (a stale marker can share its text).
  const fresh = async () => { const left = [...stale]; return (await saveErrors(c)).filter((t) => { const i = left.indexOf(t); if (i >= 0) left.splice(i, 1); return i < 0; }).filter((t, i, all) => all.indexOf(t) === i); };
  await closing(c.s, editorOf(c, column), () => act.click(c.main, { name: 'Save' })); // no Save: the editor is closed
  try {
    return unseenOf(await confirmEach(recordIds, 'NOT_SAVED', timeout, (id, t) => confirmField(c, id, field, value, t, fresh), (id) => confirmField(c, id, field, value, 2_000, undefined, 'admin')));
  } catch (e) {
    const cancel = c.main.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.count()) { // two Cancels: act.click's AMBIGUOUS goes to the evidence
      await act.click(c.main, { name: 'Cancel' }).then(() => { e.message += '; the draft was cancelled'; e.evidence = { ...e.evidence, draft: 'cancelled' }; }, (undo) => { e.evidence = { ...e.evidence, cleanup: undo.message }; });
    }
    // The grid's "Item N has an error" popover outlives the draft; Escape closes it (as on the org).
    const pop = c.s.page.getByRole('dialog', { name: 'Your attention, please', exact: true });
    if (await pop.isVisible()) await act.press(c.s.page, { key: 'Escape' }).catch((undo) => { e.evidence = { ...e.evidence, popover: undo.message }; });
    throw e;
  }
}

// Confirms every record, not only up to the first that fails: the failure names each one, what the server holds for it,
// and a record deleted since as gone. One deadline for all, with 2 s at least for each record. A 404 to the session user
// is read once more by admin (the org's own identity): there, the record is unseen by the user, not gone.
async function confirmEach(recordIds, code, timeout, confirm, admin) {
  const end = Date.now() + timeout;
  const records = [];
  let failed;
  for (const recordId of recordIds) {
    try { records.push({ recordId, confirmed: true, holds: await confirm(recordId, Math.max(2_000, end - Date.now())) }); } catch (first) {
      let e = first;
      let gone = e.code === 'API_ERROR' && e.evidence?.status === 404;
      let unseen = false; // the user's read answered 404 and the value below is admin's
      if (gone && admin) {
        try { records.push({ recordId, confirmed: true, unseen: true, holds: await admin(recordId) }); continue; } catch (x) { e = x; gone = x.code === 'API_ERROR' && x.evidence?.status === 404; unseen = !gone; }
      }
      records.push({ recordId, confirmed: false, ...(gone ? { gone } : { holds: e.evidence?.seen ?? null }), ...(unseen && { unseen }) });
      if (unseen && !failed) e.message += ` (the session user's read answered 404: this is the org's own read)`;
      failed ??= gone ? new SfUiError(code, `${recordId} is gone: the server answers 404 for it`, { recordId, gone }) : Object.assign(e, { evidence: { ...e.evidence, recordId, ...(unseen && { unseen }) } });
    }
  }
  if (!failed) return records;
  const ok = records.filter((r) => r.confirmed).map((r) => r.recordId);
  if (records.length > 1) failed.message += `; ${ok.length} of ${records.length} confirmed${ok.length ? ` (${ok.join(', ')})` : ''}`;
  failed.evidence = { ...failed.evidence, records };
  throw failed;
}

// Mass inline edit: the rows selected, the first row's cell editor (fillCell) applied to all, Save; each record must then
// hold the value on the server. Refused when rows not named are selected (OTHER_ROWS_SELECTED).
async function massEdit(s, { rows, column, value, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  const { field } = columnOf(c, column);
  return unticking(c, rows, async () => {
    await refuseOthers(c, rows, `editing ${column}`);
    const { recordIds } = await select(s, { rows, timeout });
    await refuseHeld(c, recordIds, field, value);
    await fillCell(c, { row: rows[0], column, field, value, n: recordIds.length });
    const unseen = await saveAll(c, recordIds, field, value, timeout, column);
    return { recordIds, field, value: String(value), ...(unseen.length && { unseen }) };
  });
}
// steps, then the named rows that were not ticked before it are unticked, on a failure too (select alone keeps its
// rows ticked); a row no longer in the list is passed over.
async function unticking(c, rows, steps) {
  const boxOf = (row) => c.grid.getByRole('row').filter({ hasText: row }).getByRole('checkbox');
  const before = (await statusOf(c)).selected;
  const [fresh, held] = [[], []];
  for (const row of new Set(rows)) if ((await boxOf(row).count()) === 1) ((await boxOf(row).isChecked()) ? held : fresh).push(row);
  const untick = async () => {
    for (const row of fresh) if ((await boxOf(row).count()) === 1 && (await boxOf(row).isChecked())) await act.click(c.grid, { row, role: 'checkbox' });
    await until(() => statusOf(c), (x) => x.selected <= before, { timeout: 10_000, code: 'SELECTION_MISMATCH', message: (x) => `the status line counts ${x.selected} selected after the rows were unticked, not ${before}` });
  };
  let out;
  try { out = await steps(); } catch (e) {
    await untick().catch((undo) => { e.evidence = { ...e.evidence, untick: undo.message }; });
    throw e;
  }
  await untick();
  // Lightning clears every tick after a Change Owner, the caller's too (probe-g2 D1): those rows are named.
  const lost = [];
  for (const row of held) if ((await boxOf(row).count()) === 1 && !(await boxOf(row).isChecked())) lost.push(row);
  return { ...out, ...(lost.length && { unticked: lost }) };
}
// The server holds the typed value: empty as no value, a number as that number, else as stored or as displayed.
const holds = (f, value) => {
  const typed = String(value).trim();
  if (typed === '') return f.value == null;
  return (typeof f.value === 'number' && Number(typed) === f.value) || [f.value, f.displayValue].some((v) => v != null && String(v) === String(value));
};
const fieldOf = async (c, recordId, field, as = 'user') => (await api.call(c.s, `/ui-api/records/${recordId}?fields=${c.objectApiName}.${field}`, { as })).fields[field];
const unseenOf = (records) => records.filter((r) => r.unseen).map((r) => r.recordId);
// Every record already holds the value: Lightning makes no draft, so there is no Save and nothing a save could confirm.
// A read that fails refuses nothing: the reads after Save report that record.
async function refuseHeld(c, recordIds, field, value) {
  for (const id of recordIds) {
    const f = await fieldOf(c, id, field).catch(() => null);
    if (!f || !holds(f, value)) return;
  }
  throw new SfUiError('VALUE_ALREADY_SET', `${recordIds.join(', ')} already ${recordIds.length > 1 ? 'hold' : 'holds'} ${JSON.stringify(String(value))} in ${field}: there is no change to save`, { recordIds, field, value: String(value) });
}
// errors: the page's own reasons a save failed; when it gives one, NOT_SAVED carries it at once.
const confirmField = (c, recordId, field, value, timeout, errors = async () => [], as = 'user') => until(
  async () => {
    const f = await fieldOf(c, recordId, field, as);
    const why = holds(f, value) ? [] : await errors();
    if (why.length) throw new SfUiError('NOT_SAVED', `${field} was not saved: ${why.join('; ')}`, { seen: f, errors: why });
    return f;
  },
  (f) => holds(f, value),
  { timeout, code: 'NOT_SAVED', message: (f) => `${field} holds ${JSON.stringify(f.value)}, not ${JSON.stringify(String(value))}` });

// A list button or a mass edit acts on every selected row: refuse before ticking any when rows not named are selected
// (others: those on the page).
async function refuseOthers(c, rows, what) {
  const named = [];
  for (const row of rows) named.push((await rowOf(c, row)).recordId);
  const ticked = c.grid.getByRole('row').filter({ has: c.s.page.getByRole('checkbox', { checked: true }) }).getByRole('rowheader');
  // One text and one id per ticked row, its first link as rowOf reads it: on the org the link is in a shadow root.
  const pairs = [];
  for (let i = 0, n = await ticked.count(); i < n; i += 1) {
    const th = ticked.nth(i);
    const link = th.getByRole('link').first();
    pairs.push([(await th.innerText()).trim(), (await link.count()) ? await link.getAttribute('href') : null]);
  }
  const checked = pairs.map(([t]) => t);
  const checkedIds = pairs.map(([, h]) => idOf(h));
  // A ticked row counts though the status line lags it; the status line counts rows ticked off this page.
  const already = Math.max((await statusOf(c)).selected, pairs.length);
  if (already > checkedIds.filter((id) => named.includes(id)).length) {
    const others = checked.filter((_, i) => !named.includes(checkedIds[i]));
    throw new SfUiError('OTHER_ROWS_SELECTED', `${already} rows are selected that are not all named (${others.join(', ') || 'none on this page'}): clear them before ${what}`, { selected: already, recordIds: named, checked, others });
  }
}

// A list button run on the selected rows: each row selected (confirmed by the status line), then the button, from the
// list's buttons or its Show more actions menu. It must open a dialog or a page; the caller completes and checks it.
async function mass(s, { rows, button, timeout = 10_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  await refuseOthers(c, rows, button);
  const { selected, recordIds } = await select(s, { rows, timeout });
  const before = s.page.url();
  const dialogs = () => s.page.getByRole('dialog').locator('visible=true').count();
  const had = await dialogs();
  const direct = c.main.getByRole('button', { name: button, exact: true });
  if (await direct.count()) await act.click(c.main, { name: button });
  else {
    await act.click(c.main, { name: MORE });
    await act.click(s.page, { role: 'menuitem', name: button });
  }
  const opened = await until(async () => ({ dialogs: await dialogs(), url: s.page.url() }), (x) => x.dialogs > had || x.url !== before,
    { timeout, code: 'ACTION_NOT_OPENED', message: () => `${button} opened no dialog and no page` }).catch((e) => {
    throw Object.assign(e, { evidence: { button, url: s.page.url(), toasts: act.raised(s.page), dialogsBefore: had } });
  });
  if (opened.dialogs > had) return { selected, recordIds, button, dialog: await act.snapshot(await modal.find(s, { timeout, body: true })) };
  return { selected, recordIds, button, url: opened.url };
}

// Change Owner on the selected rows, through the dialog mass opens: the owner picked by its exact name, the notification
// email unticked unless notify, Submit; each record's owner must then be that user on the server. Changes sharing.
async function changeOwner(s, { rows, owner, notify = false, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { timeout });
  return unticking(c, rows, () => submitOwner(s, { rows, owner, notify, timeout }));
}
async function submitOwner(s, { rows, owner, notify, timeout }) {
  const { recordIds } = await mass(s, { rows, button: 'Change Owner', timeout });
  const { objectApiName } = listOf(s.page.url());
  const dlg = s.page.getByRole('dialog', { name: 'Change Owner', exact: true });
  const ownerOf = async (id, as = 'user') => { const f = (await api.call(s, `/ui-api/records/${id}?fields=${objectApiName}.OwnerId,${objectApiName}.Owner.Name`, { as })).fields; return { ownerId: f.OwnerId.value, name: f.Owner?.value?.fields?.Name?.value }; };
  const owned = (id, timeout, as) => until(() => ownerOf(id, as), (x) => x.name === owner, { timeout, code: 'OWNER_NOT_CHANGED', message: (x) => `${id} is owned by ${x.name}, not ${owner}` });
  return closing(s, dlg, async () => {
    const already = [];
    // A record gone already is read again after Submit, where it is named gone.
    for (const id of recordIds) if ((await ownerOf(id).catch((e) => { if (e.evidence?.status === 404) return {}; throw e; })).name === owner) already.push(id);
    if (already.length === recordIds.length) throw new SfUiError('OWNER_ALREADY_SET', `every row is already owned by ${owner}, so no change could be confirmed; nothing was submitted`, { recordIds, owner });
    await act.fill(dlg, { role: 'combobox', name: 'Select New Owner', value: owner });
    await act.click(dlg, { role: 'option', name: owner });
    const mail = dlg.getByRole('checkbox', { name: 'Send notification email', exact: true });
    if ((await mail.isChecked({ timeout: 10_000 })) !== notify) await act.click(dlg, { role: 'checkbox', name: 'Send notification email' });
    if ((await mail.isChecked()) !== notify) throw new SfUiError('NOTIFY_NOT_SET', `"Send notification email" stayed ${notify ? 'unticked' : 'ticked'}; nothing was submitted`, { notify });
    await act.click(dlg, { name: 'Submit' });
    const records = await confirmEach(recordIds, 'OWNER_NOT_CHANGED', timeout, (id, t) => owned(id, t), (id) => owned(id, 2_000, 'admin'))
      .catch(async (e) => { // a dialog still open after Submit shows its own reason
        e.evidence = { ...e.evidence, toasts: act.raised(s.page), ...((await dlg.isVisible()) && { dialog: act.cut((await dlg.innerText()).trim(), 500) }) };
        throw e;
      });
    const unseen = unseenOf(records);
    return { recordIds, owner, ownerId: records[0].holds.ownerId, notify, ...(already.length && { already }), ...(unseen.length && { unseen }) };
  }, () => act.click(dlg, { name: 'Cancel' })); // Escape does not close this dialog
}

// The panel's operator ("starts with") as list-info names it (StartsWith); two read differently.
const OPERATORS = { 'not equal to': 'NotEqual', 'does not contain': 'NotContain' };
const operatorOf = (o) => (OPERATORS[o.toLowerCase()] || o).replace(/\s+/g, '').toLowerCase();
// Saved filters naming that field (its label), operator and value, from the server's list-info.
const filtersOn = (info, field, operator, value) => (info.filteredByInfo || []).filter((f) => f.label === field && String(f.operator).toLowerCase() === operatorOf(operator) && (f.operandLabels || []).includes(String(value))).length;
// The server's list-info until it holds n such filters: a filter added or removed in the panel is saved only by its Save.
const confirmFilters = (c, field, operator, value, n, timeout) => until(
  () => nav.listInfo(c.s, c.objectApiName, c.listView), (info) => filtersOn(info, field, operator, value) === n,
  { timeout, code: 'FILTER_NOT_SAVED', message: (info) => `the list view holds ${filtersOn(info, field, operator, value)} filters "${field} ${operator} ${value}", not ${n}` });

// The Filters panel, opened once (its button toggles it). Its body decides, not the toggle: just after a Cancel the
// toggle can still read pressed while the panel closes (list.test.js filter, 1 red in 6).
async function filtersPanel(c) {
  const button = c.main.getByRole('button', { name: 'Filters', exact: true });
  const body = c.main.getByRole('button', { name: 'Add Filter', exact: true });
  // The panel's heading shows with no Add Filter on a list view this user cannot edit (probe n3: "Locked Filters").
  const panel = c.main.getByRole('heading', { name: 'Filters', level: 2, exact: true });
  const locked = async () => { if ((await panel.isVisible()) && !(await body.isVisible())) throw new SfUiError('NOT_FOUND', 'the Filters panel shows no Add Filter: this user cannot edit this list view\'s filters', { locked: true }); };
  const state = await until(async () => ((await body.isVisible()) ? 'open' : button.getAttribute('aria-pressed', { timeout: 10_000 })), (v) => v !== 'true',
    { timeout: 10_000, code: 'NOT_FOUND', message: () => 'the Filters button reads pressed but its panel shows no Add Filter' });
  if (state === 'open') return false;
  await act.click(c.main, { name: 'Filters' });
  // On the org the panel shows at once or, on about 1 page load in 8, never: the toggle reads pressed with no panel and a
  // second click does not bring it; a reload does (probe-lostclick). Reloaded once: true when it was.
  if (await body.waitFor({ timeout: 4_000 }).then(() => true, () => false)) return false;
  await locked();
  // A reload drops a search, ticked rows and an inline draft (the grid's Save): none of them is reloaded away.
  const keep = (await termOf(c)) ? { search: await termOf(c) } : (await statusOf(c)).selected ? { ticked: (await statusOf(c)).selected } : (await c.main.getByRole('button', { name: 'Save', exact: true }).isVisible()) ? { draft: true } : undefined;
  if (keep) throw new SfUiError('NOT_FOUND', `the Filters panel did not render, and a reload would drop the ${{ search: 'search', ticked: 'ticked rows', draft: 'inline draft' }[Object.keys(keep)[0]]}`, keep);
  try { // a panel that never renders is NOT_FOUND, not Playwright's TimeoutError
    await c.s.page.reload();
    await nav.listShown(c.s, `the list ${c.info.label}`, 30_000, c.info.label);
    if ((await button.getAttribute('aria-pressed', { timeout: 10_000 })) !== 'true') await act.click(c.main, { name: 'Filters' });
    await body.or(panel).first().waitFor({ timeout: 10_000 });
  } catch (e) { throw e.name === 'TimeoutError' ? new SfUiError('NOT_FOUND', 'the Filters panel did not render, before or after one reload', { reloaded: true }) : e; }
  await locked();
  return true;
}

// The panel steps up to its Save; on a failure the popover and the panel's unsaved change are cancelled, so the next call
// meets the list as this one found it (a cleanup that fails too is in the evidence).
async function inPanel(c, steps) {
  try { await steps(); } catch (e) {
    const pop = c.s.page.getByRole('dialog').filter({ has: c.s.page.getByRole('combobox', { name: 'Field' }) });
    try {
      // Escape closes an open option list first, then the popover (an open list covers its Cancel).
      for (let i = 0; i < 3 && (await pop.isVisible()); i += 1) await act.press(c.s.page, { key: 'Escape' });
      if (await c.main.getByRole('button', { name: 'Cancel', exact: true }).isVisible()) await act.click(c.main, { name: 'Cancel' });
    } catch (undo) { e.evidence = { ...e.evidence, cleanup: undo.message }; }
    throw e;
  }
}

// Adds a filter in the Filters panel and saves it, which keeps it on the list view for every user; removeFilter takes it off.
async function filter(s, { field, operator, value, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { rows: false, timeout });
  const before = filtersOn(c.info, field, operator, value);
  let reloaded;
  await inPanel(c, async () => {
    reloaded = await filtersPanel(c);
    await act.click(c.main, { name: 'Add Filter' });
    const pop = await modal.find(s, { timeout: 10_000 });
    await act.click(pop, { role: 'combobox', name: 'Field' });
    await act.click(pop, { role: 'option', name: field });
    await act.click(pop, { role: 'combobox', name: 'Operator' });
    await act.click(pop, { role: 'option', name: operator });
    await act.fill(pop, { name: 'Value', value });
    await act.click(pop, { name: 'Save' });
  });
  await act.click(c.main, { name: 'Save' });
  return { ...(await filtered(c, field, operator, value, before + 1, timeout)), ...(reloaded && { reloaded }) };
}

async function removeFilter(s, { field, operator, value, timeout = 15_000 }) {
  const c = await context(s);
  await table(c, { rows: false, timeout });
  const before = filtersOn(c.info, field, operator, value);
  let reloaded;
  await inPanel(c, async () => {
    reloaded = await filtersPanel(c);
    await act.click(c.main, { name: `Remove filter: "${field} ${operator} ${value}"` });
  });
  await act.click(c.main, { name: 'Save' });
  return { ...(await filtered(c, field, operator, value, before - 1, timeout)), ...(reloaded && { reloaded }) };
}

// Second signals for a filter change: the saved list-info, then the rows the server lists under it.
async function filtered(c, field, operator, value, n, timeout) {
  const info = await confirmFilters(c, field, operator, value, n, timeout);
  const want = { sortBy: sortOf(c), searchTerm: await termOf(c) };
  // The grid can keep its old rows after the panel's Save until its Refresh (replay 1 in 6): one Refresh on a mismatch.
  if (!same(await gridIds(c), await serverIds(c, want))) await act.click(c.main, { name: 'Refresh' });
  const { grid } = await confirmRows({ ...c, info }, { ...want, timeout, what: 'the filtered list' });
  return { field, value, filters: (info.filteredByInfo || []).length, rows: grid.length };
}

// What each display shows once it renders, with rows or none (nav.displays).
const shown = (c) => nav.displays(c.s.page, c.info.label);
async function display(s, { display: to, timeout = 15_000 }) {
  const c = await context(s);
  if (!(await shown(c)[to].isVisible())) {
    const from = await nav.displayOf(s.page, c.info.label);
    await act.click(s.page, { name: 'Select list display' });
    await act.click(s.page, { role: 'menuitemcheckbox', name: to });
    // A list with no Kanban grouping asks for one: cancelled (a save changes the list view), then the display put back.
    const settings = s.page.getByRole('dialog', { name: 'Kanban Settings', exact: true });
    await shown(c)[to].or(settings).first().waitFor({ timeout }).catch(() => {
      throw new SfUiError('DISPLAY_NOT_SHOWN', `the list did not show as ${to}`, { display: to, url: s.page.url() });
    });
    if (await settings.isVisible()) {
      const e = new SfUiError('KANBAN_NOT_SET', 'this list has no Kanban grouping for this user: set a Group By in the list\'s Kanban Settings (Salesforce asks for it the first time a user shows the list as Kanban, and keeps it per user)', { listView: c.listView });
      try {
        await act.click(settings, { name: 'Cancel' });
        await settings.waitFor({ state: 'hidden', timeout: 10_000 });
        if (from) await display(s, { display: from, timeout }); // else a reload opens the settings again
      } catch (undo) { e.evidence.cleanup = undo.message; }
      throw e;
    }
  }
  return { display: to };
}

// A picklist's stored value, or its label as a Kanban column shows it.
const valueOf = (f) => [f?.value, f?.displayValue].filter((v) => v != null).map(String);
const picklistsOf = async (c) => Object.values((await api.call(c.s, `/ui-api/object-info/${c.objectApiName}`)).fields).filter((f) => f.dataType === 'Picklist').map((f) => f.apiName);
const readPicklists = async (c, recordId, picklists) => (await api.call(c.s, `/ui-api/records/${recordId}?optionalFields=${picklists.map((f) => `${c.objectApiName}.${f}`).join(',')}`)).fields;
// The picklist that now holds the column's value and did not before, read from the server; NOT_MOVED when none does.
// each runs before every read (move closes a dependent picklist's dialog there, whenever it shows).
async function confirmMoved(c, recordId, picklists, before, to, timeout, each = async () => {}) {
  const moved = (now) => picklists.find((f) => !valueOf(before[f]).includes(to) && valueOf(now[f]).includes(to));
  return moved(await until(async () => { await each(); return readPicklists(c, recordId, picklists); }, moved, { timeout, code: 'NOT_MOVED', message: () => `no picklist of ${recordId} took the value ${to}` }));
}

// Moves a Kanban card to another column through its "Change column for" menu, as the keyboard does (no drag). The
// server must then hold the column's value in the picklist that changed; a dependent picklist's dialog is closed with Done.
async function move(s, { row, to, timeout = 15_000 }) {
  await display(s, { display: 'Kanban', timeout });
  const c = await context(s);
  const change = `Change column for ${row}.`;
  const card = c.main.getByRole('listitem').filter({ has: s.page.getByRole('button', { name: change, exact: true }) });
  // Refresh first: a board shown earlier in the session keeps its old cards across a reload (a new record is missing).
  await act.click(c.main, { name: 'Refresh' });
  await card.first().waitFor({ timeout }).catch(() => {}); // a miss is counted below
  const n = await card.count();
  if (n !== 1) throw new SfUiError(n ? 'AMBIGUOUS_ROW' : 'ROW_NOT_FOUND', `${n} Kanban cards are named "${row}" (a card is named in full)`, { row, snapshot: await act.snapshot(c.main) });
  const recordId = idOf(await card.getByRole('link').first().getAttribute('href'));
  const picklists = await picklistsOf(c);
  const before = await readPicklists(c, recordId, picklists);
  let over = false; // NOT_MOVED thrown: a retry still running clicks and presses nothing more
  const choose = async () => { await act.click(c.main, { name: change }); if (!over) await act.click(s.page, { role: 'menuitem', name: to }); };
  await choose();
  const chosen = Date.now();
  const deps = s.page.getByRole('dialog').filter({ hasText: 'Edit Dependencies' });
  let [dependencies, dialogShown, clickedAgain] = [false, false, false];
  const field = await confirmMoved(c, recordId, picklists, before, to, timeout, async () => {
    if (await deps.isVisible()) dialogShown = true;
    // Once only: a dialog closing after its Done still shows for a moment, and a second click waits on it.
    // Done only once the dialog shows its picklists: a Done while it still loads can save nothing (1 NOT_MOVED in 3, step 2).
    if (!dependencies && (await deps.getByRole('button', { name: 'Done', exact: true }).isVisible()) && (await deps.getByRole('combobox').first().isVisible())) { await act.click(deps, { name: 'Done' }); dependencies = true; }
    // Neither the dialog nor a saved value 3 s after the menu click: that click was lost, so it is chosen once more.
    else if (!dialogShown && !clickedAgain && Date.now() - chosen > 3_000) {
      clickedAgain = true; // a card already moved may not offer the column again: that is kept, and the reads go on
      await choose().catch(async (err) => { clickedAgain = `failed: ${err.message}`; if (!over) await act.press(s.page, { key: 'Escape' }); });
    }
  }).catch((e) => {
    over = true;
    if (e.code === 'NOT_MOVED') e.evidence = { ...e.evidence, dependencies, dialogShown, clickedAgain, toasts: act.raised(s.page) };
    throw e;
  });
  return { recordId, field, from: before[field].displayValue ?? before[field].value, to, ...(dependencies && { dependencies }) };
}

// Opens a record from the split view's list pane; the record page must show it beside the pane.
async function open(s, { row, timeout = 30_000 }) {
  await display(s, { display: 'Split View', timeout });
  const pane = nav.splitPane(s.page); // in main or not by app
  const recordId = idOf(await (await act.resolve(pane, { row, role: 'link', timeout: 10_000 })).getAttribute('href'));
  await act.click(pane, { row, role: 'link', timeout: 10_000 });
  await confirmSplit(s, recordId, timeout);
  return { recordId, url: s.page.url() };
}
// The record page shows that record, its highlights loaded, with the split view's list still beside it.
const confirmSplit = (s, recordId, timeout) => until(async () => nav.showsRecord(s.page.url(), recordId)
  && (await s.page.getByRole('main').locator(A.highlights).first().isVisible()) && (await nav.splitPane(s.page).isVisible()),
Boolean, { timeout, code: 'RECORD_NOT_SHOWN', message: () => `${recordId} is not open beside the split view list` });

// Each action: its function, the arguments it needs and the ones it may take; any other is BAD_ARGS, never ignored.
const ACTIONS = {
  sort: [sort, ['column'], ['direction']],
  search: [search, ['text']],
  select: [select, ['rows']],
  delete: [remove, ['row']],
  edit: [edit, ['row', 'column', 'value']],
  massEdit: [massEdit, ['rows', 'column', 'value']],
  mass: [mass, ['rows', 'button']],
  changeOwner: [changeOwner, ['rows', 'owner'], ['notify']],
  filter: [filter, ['field', 'operator', 'value']],
  removeFilter: [removeFilter, ['field', 'operator', 'value']],
  display: [display, ['display']],
  move: [move, ['row', 'to']],
  open: [open, ['row']],
};
// An sf_list call's arguments, action among them; sf_run_route checks each sf_list step with it before any step runs.
function check({ action, ...args }) {
  const [, needs, takes = []] = ACTIONS[action];
  const given = Object.keys(args).filter((k) => args[k] !== undefined);
  const missing = needs.filter((k) => !given.includes(k));
  const extra = given.filter((k) => !needs.includes(k) && !takes.includes(k));
  if (missing.length || extra.length) throw new SfUiError('BAD_ARGS', `${action} needs ${needs.join(', ')}${takes.length ? ` and may take ${takes.join(', ')}` : ''}${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; not for ${action}: ${extra.join(', ')}` : ''}`, { action, missing, extra });
  // Lightning offers no "Update 1 selected items" for one row.
  if (action === 'massEdit' && new Set(args.rows).size < 2) throw new SfUiError('BAD_ARGS', 'massEdit needs two or more different rows; edit is for one', { action, rows: args.rows });
}
async function run(s, action, args) {
  check({ action, ...args });
  const out = await ACTIONS[action][0](s, args);
  return { action, ...out, [AT]: { confirmed: new Date().toISOString() } };
}

module.exports = { run, check, ACTIONS, listOf, counts, context, confirmRows, confirmSelected, confirmGone, confirmField, confirmFilters, confirmMoved, confirmSplit, picklistsOf, readPicklists };
