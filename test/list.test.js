'use strict';

// sf_list's actions on a list view of the fixture org, each with the second signal it confirms, and that signal's red.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, nav, modal, api } = require('..');
const list = require('../src/list');
const { auth, env, skip, probe, record, stamp } = require('./helpers');

const plain = (r) => JSON.parse(JSON.stringify(r)); // a result as its JSON shows it, without its at moments

test('listOf reads the list from a list URL or a split view record, and refuses any other page, no org', () => {
  const o = 'https://x.lightning.force.com';
  assert.deepEqual(list.listOf(`${o}/lightning/o/SfUiProbe__c/list?filterName=All`), { objectApiName: 'SfUiProbe__c', listView: 'All' });
  assert.deepEqual(list.listOf(`${o}/lightning/r/SfUiProbe__c/a03000000000001AAA/view?sv=%2Flightning%2Fo%2FSfUiProbe__c%2Flist%3FfilterName%3DKanban_Probes`), { objectApiName: 'SfUiProbe__c', listView: 'Kanban_Probes' });
  for (const u of [`${o}/lightning/o/SfUiProbe__c/home`, `${o}/lightning/r/SfUiProbe__c/a03000000000001AAA/view`, `${o}/lightning/o/SfUiProbe__c/list?filterName=a%2Fb`]) {
    assert.throws(() => list.listOf(u), { code: 'NOT_ON_LIST' }, u);
  }
});

test('counts reads items and selected rows from the status line, no org', () => {
  assert.deepEqual(list.counts('4 items • Sorted by Probe Name • '), { selected: 0, items: 4, more: false });
  assert.deepEqual(list.counts('1 item • Sorted by Kind'), { selected: 0, items: 1, more: false });
  assert.deepEqual(list.counts('50+ items • Sorted by Name'), { selected: 0, items: 50, more: true });
  assert.deepEqual(list.counts('2 items selected'), { selected: 2, items: null, more: false });
});

test('run refuses a missing argument and one the action does not take, before any page read, no org', async () => {
  await assert.rejects(list.run({}, 'sort', {}), (e) => e.code === 'BAD_ARGS' && e.evidence.missing[0] === 'column');
  await assert.rejects(list.run({}, 'delete', { row: 'x', column: 'Kind' }), (e) => e.code === 'BAD_ARGS' && e.evidence.extra[0] === 'column');
});

test('list', { skip, timeout: 600_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const p = `sfuicombo lane8 ${stamp()}`; // sfuicombo: the Kanban Probes list holds only those names
  const [a, b, c] = [await probe(s, t, { Name: `${p} a`, Kind__c: 'Fruit' }), await probe(s, t, { Name: `${p} b`, Kind__c: 'Tool' }), await probe(s, t, { Name: `${p} c`, Kind__c: 'Fruit' })];
  await nav.openList(s, 'SfUiProbe__c', 'All');

  await t.test('search shows the server\'s matches, and a list not searched fails the check', async () => {
    const ctx = await list.context(s);
    await assert.rejects(list.confirmRows(ctx, { searchTerm: p, timeout: 1_000 }), { code: 'LIST_MISMATCH' }, 'the unsearched list holds more than the probes');
    const r = await list.run(s, 'search', { text: p });
    assert.equal(r.rows, 3);
    assert.equal(r.items, 3);
  });

  await t.test('sort orders the rows as the server does, and the old order fails the check', async () => {
    const ctx = await list.context(s);
    await assert.rejects(list.confirmRows(ctx, { sortBy: 'Kind__c', searchTerm: p, timeout: 1_000 }), { code: 'LIST_MISMATCH' }, 'sorted by name, the rows are not in Kind order');
    try {
      assert.deepEqual(plain(await list.run(s, 'sort', { column: 'Kind' })), { action: 'sort', column: 'Kind', field: 'Kind__c', direction: 'ascending', rows: 3 });
      assert.equal((await list.run(s, 'sort', { column: 'Kind', direction: 'descending' })).direction, 'descending');
    } finally {
      await list.run(s, 'sort', { column: 'Probe Name' }); // the sort is kept per user, and the catalogue's routes expect Probe Name
    }
  });

  await t.test('select counts each row selected, and a count the status line does not show fails the check', async () => {
    const r = await list.run(s, 'select', { rows: [`${p} a`, `${p} c`] });
    assert.equal(r.selected, 2);
    assert.deepEqual(r.recordIds.sort(), [a, c].sort());
    await assert.rejects(list.confirmSelected(await list.context(s), 3, 1_000), { code: 'SELECTION_MISMATCH' });
    assert.equal((await list.run(s, 'select', { rows: [`${p} a`, `${p} b`] })).selected, 3, 'a row already selected is not counted twice');
  });

  await t.test('mass runs a list button on the selected rows and returns its dialog, and a button that opens nothing fails', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'All');
    await list.run(s, 'search', { text: p });
    await list.run(s, 'select', { rows: [`${p} c`] });
    await assert.rejects(list.run(s, 'mass', { rows: [`${p} a`], button: 'Change Owner' }), (e) => e.code === 'OTHER_ROWS_SELECTED' && e.evidence.others.join() === `${p} c` && e.evidence.checked.join() === `${p} c`, 'c is selected but not named, and a is not ticked');
    assert.equal(await s.page.getByRole('dialog').locator('visible=true').count(), 0, 'refused before the button');
    await nav.openList(s, 'SfUiProbe__c', 'All'); // a reload clears the selection
    await list.run(s, 'search', { text: p });
    const r = await list.run(s, 'mass', { rows: [`${p} a`, `${p} b`], button: 'Change Owner' });
    assert.equal(r.selected, 2);
    assert.match(r.dialog, /dialog "Change Owner"/);
    await modal.close(await modal.find(s)); // nothing is changed
    await assert.rejects(list.ACTIONS.mass[0](s, { rows: [`${p} a`, `${p} b`], button: 'Refresh', timeout: 2_000 }), { code: 'ACTION_NOT_OPENED' });
  });

  await t.test('changeOwner hands the rows to another user and back, each owner confirmed on the server', async () => {
    const was = (await api.call(s, `/ui-api/records/${a}?fields=SfUiProbe__c.OwnerId,SfUiProbe__c.Owner.Name`)).fields;
    const [wasId, wasName] = [was.OwnerId.value, was.Owner.value.fields.Name.value];
    await nav.openList(s, 'SfUiProbe__c', 'All');
    await list.run(s, 'search', { text: p });
    try {
      const r = plain(await list.run(s, 'changeOwner', { rows: [`${p} a`], owner: 'Probe Platform' }));
      assert.deepEqual([r.recordIds, r.owner, r.notify, r.ownerId === wasId], [[a], 'Probe Platform', false, false]);
      await nav.openList(s, 'SfUiProbe__c', 'All'); // a reload clears the selection
      await list.run(s, 'search', { text: p });
      assert.equal((await list.run(s, 'changeOwner', { rows: [`${p} a`], owner: wasName })).ownerId, wasId, 'the undo is a second Change Owner');
    } finally {
      await api.call(s, `/sobjects/SfUiProbe__c/${a}`, { method: 'PATCH', as: 'admin', body: { OwnerId: wasId } }); // put back whatever failed
    }
  });

  await t.test('edit saves a text and a number cell on the server, and a value the server does not hold fails the check', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'All');
    await list.run(s, 'search', { text: p });
    assert.deepEqual(plain(await list.run(s, 'edit', { row: `${p} b`, column: 'Probe Name', value: `${p} b edited` })), { action: 'edit', recordId: b, field: 'Name', value: `${p} b edited` });
    await assert.rejects(list.confirmField(await list.context(s), b, 'Name', `${p} b`, 1_000), { code: 'NOT_SAVED' });
    await nav.openList(s, 'SfUiProbe__c', 'Kanban_Probes');
    await list.run(s, 'search', { text: p });
    assert.equal((await list.run(s, 'edit', { row: `${p} a`, column: 'Count', value: '07' })).field, 'Count__c'); // saved as 7
    assert.equal((await list.run(s, 'edit', { row: `${p} a`, column: 'Count', value: '' })).value, '', 'a cleared cell is no value');
    const t0 = Date.now(); // SfUi_Count_Not_Negative refuses -1: the page's own reason comes back, without the wait
    await assert.rejects(list.run(s, 'edit', { row: `${p} a`, column: 'Count', value: -1 }), (e) => e.code === 'NOT_SAVED' && e.evidence.errors?.some((x) => /Fix the errors/.test(x)));
    assert.ok(Date.now() - t0 < 12_000, `${Date.now() - t0} ms`);
  });

  await t.test('edit picks a picklist cell\'s option on the server, and a value the server does not hold fails the check', async () => {
    const d = await record(s, t, 'SfUiDyn__c', { Name: `${p} level`, Level__c: 'Low' }); // Level Dyns lists sfuicombo names
    await nav.openList(s, 'SfUiDyn__c', 'Level_Dyns'); // no search: the index lags a record made seconds ago
    assert.deepEqual(plain(await list.run(s, 'edit', { row: `${p} level`, column: 'Level', value: 'High' })), { action: 'edit', recordId: d, field: 'Level__c', value: 'High' });
    await assert.rejects(list.confirmField(await list.context(s), d, 'Level__c', 'Low', 1_000), { code: 'NOT_SAVED' });
    assert.equal((await list.run(s, 'edit', { row: `${p} level`, column: 'Level', value: '' })).value, '', '--None-- is no value');
  });

  await t.test('massEdit saves one cell value on every selected row, each confirmed on the server', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'Kanban_Probes'); // a reload clears the selection
    await list.run(s, 'search', { text: p });
    assert.deepEqual(plain(await list.run(s, 'massEdit', { rows: [`${p} a`, `${p} b`], column: 'Count', value: 3 })), { action: 'massEdit', recordIds: [a, b], field: 'Count__c', value: '3' });
    await assert.rejects(list.confirmField(await list.context(s), b, 'Count__c', 4, 1_000), { code: 'NOT_SAVED' });
  });

  await t.test('filter saves a filter on the list view and removeFilter takes it off, each confirmed on the server', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'Filter_Probes');
    const f = { field: 'Probe Name', operator: 'contains', value: p };
    await assert.rejects(list.confirmFilters(await list.context(s), f.field, f.operator, f.value, 1, 1_000), { code: 'FILTER_NOT_SAVED' });
    await assert.rejects(list.run(s, 'filter', { ...f, operator: 'no such operator' }), { code: 'NOT_FOUND' });
    assert.equal(await s.page.getByRole('dialog').locator('visible=true').count(), 0, 'the failed filter closed its popover');
    try {
      assert.deepEqual(plain(await list.run(s, 'filter', f)), { action: 'filter', field: 'Probe Name', value: p, filters: 1, rows: 3 });
      await assert.rejects(list.confirmFilters(await list.context(s), f.field, 'equals', f.value, 1, 1_000), { code: 'FILTER_NOT_SAVED' }, 'saved as contains, not equals');
    } finally {
      // Saved for every user: an interrupted run would leave Filter_Probes filtered (catalogue route add-filter@list-view-filters).
      // Only a filter that is there is taken off, so a filter that failed keeps its own error.
      if ((await list.context(s)).info.filteredByInfo?.length) {
        const r = await list.run(s, 'removeFilter', f);
        assert.equal(r.filters, 0);
        assert.ok(r.rows > 3, 'the whole list is back');
      }
    }
  });

  await t.test('move puts a Kanban card in another column and the server holds that value, and a card not moved fails the check', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'Kanban_Probes');
    const ctx = await list.context(s);
    const picklists = await list.picklistsOf(ctx);
    await assert.rejects(list.confirmMoved(ctx, c, picklists, await list.readPicklists(ctx, c, picklists), 'Tool', 1_000), { code: 'NOT_MOVED' });
    let moved = false;
    try {
      assert.deepEqual(plain(await list.run(s, 'move', { row: `${p} a`, to: 'Tool' })), { action: 'move', recordId: a, field: 'Kind__c', from: 'Fruit', to: 'Tool', dependencies: true });
      moved = true;
    } finally {
      // A failed move keeps its own error: the reset's failure is thrown only after a move that passed.
      await list.run(s, 'display', { display: 'Table' }).then((r) => assert.deepEqual(plain(r), { action: 'display', display: 'Table' }), (e) => { if (moved) throw e; });
    }
  });

  await t.test('delete removes the record on the server and its row, and a record still there fails the check', async () => {
    await nav.openList(s, 'SfUiProbe__c', 'All');
    await list.run(s, 'search', { text: p });
    const ctx = await list.context(s);
    await assert.rejects(list.confirmGone(ctx, a, 1_000), { code: 'NOT_DELETED' });
    const r = await list.run(s, 'delete', { row: `${p} c` });
    assert.deepEqual(plain(r), { action: 'delete', deleted: c, rows: 2 });
  });

  await t.test('open shows a record beside the split view list, and a record not open fails the check', async () => {
    await session.openApp(s, 'SfUi_App'); // the fixture app that offers Split View
    await nav.openList(s, 'SfUiProbe__c', 'Kanban_Probes');
    try {
      const r = await list.run(s, 'open', { row: `${p} b` });
      assert.equal(r.recordId, b);
      await assert.rejects(list.confirmSplit(s, a, 1_000), { code: 'RECORD_NOT_SHOWN' });
    } finally {
      await list.run(s, 'display', { display: 'Table' }); // kept for the user: Split View would stop sf_open_list on this list
    }
    await nav.openList(s, 'SfUiProbe__c', 'Kanban_Probes', { timeout: 20_000 });
  });
});
