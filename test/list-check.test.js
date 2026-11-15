'use strict';

// A confirmed sf_list action is a check (the owner's ruling D3), except display and mass, which confirm only that a view
// rendered or a dialog opened. No org.

const test = require('node:test');
const assert = require('node:assert/strict');
const checks = require('../src/checks');

const fail = (code, evidence) => Object.assign(new Error(code), { code, evidence });
const sort = { action: 'sort', column: 'Kind', direction: 'ascending' };

test('a confirmed sf_list action is a check that passes, and its signal failing is a check that fails', () => {
  const ok = checks.map('sf_list', sort, { action: 'sort', column: 'Kind', field: 'Kind__c', direction: 'ascending', rows: 3 });
  assert.deepEqual([ok.tool, ok.oracle, ok.expected, ok.pass, ok.target], ['sf_list', 'server', 'sort', true, { action: 'sort', column: 'Kind', direction: 'ascending' }]);
  const bad = checks.map('sf_list', sort, null, fail('LIST_MISMATCH', { seen: { grid: ['a'], server: ['b'] } }));
  assert.deepEqual([bad.pass, bad.actual], [false, { grid: ['a'], server: ['b'] }]);
  assert.equal(checks.map('sf_list', sort, null, fail('NOT_TABLE', { display: 'Kanban' })), null, 'a refusal is no check outcome');
  const edit = { action: 'edit', row: 'a', column: 'Count', value: '-1' };
  const why = checks.map('sf_list', edit, null, fail('NOT_SAVED', { seen: { value: null }, errors: ['Fix the errors and try saving again'] }));
  assert.deepEqual(why.actual, { seen: { value: null }, errors: ['Fix the errors and try saving again'] }, 'the page\'s reason stays in the ledger');
});

test('select and open are rendered checks, confirmed from the page; the others are server checks', () => {
  assert.equal(checks.map('sf_list', { action: 'select', rows: ['a'] }, { selected: 1 }).oracle, 'rendered');
  assert.equal(checks.map('sf_list', { action: 'open', row: 'a' }, { recordId: 'x' }).oracle, 'rendered');
  assert.equal(checks.map('sf_list', { action: 'delete', row: 'a' }, { deleted: 'x' }).oracle, 'server');
  assert.equal(checks.map('sf_list', { action: 'massEdit', rows: ['a'], column: 'Count', value: 3 }, { recordIds: ['x'] }).oracle, 'server');
  const owner = checks.map('sf_list', { action: 'changeOwner', rows: ['a'], owner: 'Probe Platform' }, null, fail('OWNER_NOT_CHANGED', { seen: { OwnerId: { value: 'y' } }, recordId: 'x' }));
  assert.deepEqual([owner.oracle, owner.pass, owner.target.owner], ['server', false, 'Probe Platform'], 'a changeOwner the server did not hold is a failed check');
  assert.deepEqual(owner.actual, { seen: { OwnerId: { value: 'y' } }, recordId: 'x' }, 'the failed record\'s id stays in the ledger');
  const mass = checks.map('sf_list', { action: 'massEdit', rows: ['a', 'b'], column: 'Count', value: 3 }, null, fail('NOT_SAVED', { recordId: 'x', gone: true, records: [{ recordId: 'x', confirmed: false, gone: true }] }));
  assert.deepEqual(mass.actual, { seen: null, recordId: 'x', gone: true, records: [{ recordId: 'x', confirmed: false, gone: true }] });
});

test('display and mass are no check', () => {
  assert.equal(checks.map('sf_list', { action: 'display', display: 'Table' }, { action: 'display', display: 'Table' }), null);
  assert.equal(checks.map('sf_list', { action: 'mass', rows: ['a'], button: 'Change Owner' }, { selected: 1 }), null);
});

test('a scenario whose only check is an sf_list action is not weak, so its route saves; its failure makes it FAIL', () => {
  const led = checks.ledger(new Map(), 'x');
  checks.begin(led, 's');
  checks.record(led.checks, checks.map('sf_list', sort, { rows: 3 }));
  assert.equal(checks.finish(led, 's', 'PASS').weak, undefined, 'one sf_list check: not weak (NO_CHECK before D3)');
  checks.begin(led, 't');
  checks.record(led.checks, checks.map('sf_list', sort, null, fail('SORT_NOT_APPLIED', { column: 'Kind' })));
  assert.equal(checks.finish(led, 't', 'PASS').verdict, 'FAIL');
  checks.begin(led, 'u');
  const shown = checks.map('sf_list', { action: 'display', display: 'Table' }, {});
  if (shown) checks.record(led.checks, shown);
  assert.equal(checks.finish(led, 'u', 'PASS').weak, true, 'display alone: still no check');
});
