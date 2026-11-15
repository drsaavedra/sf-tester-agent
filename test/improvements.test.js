'use strict';

// The improvements log the tester agent keeps: entries persist, a repeat counts up instead of duplicating, and a
// bad entry is refused; a fix hides an entry until it is recorded again. Plain files only, so this runs without a scratch org.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { improvements } = require('..');

test('improvements', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'improvements.jsonl');
  const entry = { area: 'lookup', kind: 'broken', what: 'Lookup search shows no results for a name with an apostrophe', tried: 'sf_set_fields', evidence: 'VALUE_NOT_FOUND options []' };

  await t.test('record keeps an entry that list returns', () => {
    const saved = improvements.record(entry, { file });
    assert.equal(saved.seen, 1);
    assert.deepEqual(improvements.list({ file }).map((e) => e.what), [entry.what]);
  });

  await t.test('the same area and what counts up instead of adding a second entry', () => {
    const saved = improvements.record({ ...entry, what: entry.what.toUpperCase(), evidence: 'seen again' }, { file });
    assert.equal(saved.seen, 2);
    const all = improvements.list({ file });
    assert.equal(all.length, 1);
    assert.equal(all[0].evidence, 'seen again', 'the latest evidence is kept');
  });

  await t.test('a reworded repeat counts up when sameAs names the listed entry, and an unknown sameAs is refused', () => {
    const saved = improvements.record({ area: 'lookup', kind: 'broken', what: 'Apostrophe names find nothing in a lookup (again)', sameAs: entry.what }, { file });
    assert.equal(saved.seen, 3);
    assert.equal(saved.what, entry.what, 'the first wording is kept');
    assert.equal(improvements.list({ file, area: 'lookup' }).length, 1);
    assert.throws(() => improvements.record({ area: 'lookup', kind: 'broken', what: 'x', sameAs: 'no such entry' }, { file }), { code: 'NOT_FOUND' });
    assert.equal(improvements.list({ file, area: 'lookup' }).length, 1, 'a refused sameAs adds nothing');
  });

  await t.test('list filters by area and puts the most seen first', () => {
    improvements.record({ area: 'navigation', kind: 'missing', what: 'No tool opens an app from the App Launcher' }, { file });
    assert.deepEqual(improvements.list({ file, area: 'navigation' }).map((e) => e.area), ['navigation']);
    assert.equal(improvements.list({ file })[0].area, 'lookup');
  });

  await t.test('an entry without an area, a known kind or what happened is refused', () => {
    assert.throws(() => improvements.record({ kind: 'broken', what: 'x' }, { file }), { code: 'BAD_ARGS' });
    assert.throws(() => improvements.record({ area: 'x', kind: 'nice-to-have', what: 'x' }, { file }), { code: 'BAD_ARGS' });
    assert.throws(() => improvements.record({ area: 'x', kind: 'broken' }, { file }), { code: 'BAD_ARGS' });
  });

  await t.test('a fixed entry leaves the default list, stays in all, and reopens when recorded again', () => {
    const nav = { area: 'navigation', what: 'No tool opens an app from the App Launcher' };
    const fixed = improvements.fix({ ...nav, fixedBy: 'abc1234' }, { file });
    assert.equal(fixed.fixed.by, 'abc1234');
    assert.deepEqual(improvements.list({ file, area: 'navigation' }), []);
    assert.equal(improvements.list({ file, area: 'navigation', all: true })[0].fixed.by, 'abc1234');
    const again = improvements.record({ ...nav, kind: 'broken' }, { file });
    assert.equal(again.fixed, undefined);
    assert.equal(again.reopened.by, 'abc1234', 'a regression keeps the fix it undid');
    assert.equal(improvements.list({ file, area: 'navigation' }).length, 1);
  });

  await t.test('fixing an entry that is not in the log, or without a commit, is refused', () => {
    assert.throws(() => improvements.fix({ area: 'lookup', what: 'nothing like this', fixedBy: 'abc1234' }, { file }), { code: 'NOT_FOUND' });
    assert.throws(() => improvements.fix({ area: 'lookup', what: entry.what }, { file }), { code: 'BAD_ARGS' });
  });

  await t.test('an area matches in any case or spacing, in list and in the known and open lists of a refusal', () => {
    const f = path.join(path.dirname(file), 'case.jsonl');
    improvements.record({ area: 'Form', kind: 'broken', what: 'a' }, { file: f });
    assert.deepEqual(improvements.list({ file: f, area: ' form ' }).map((e) => e.what), ['a']);
    assert.deepEqual(improvements.list({ file: f, area: 'lookup' }), [], 'control: another area matches nothing');
    assert.throws(() => improvements.record({ area: 'FORM', kind: 'broken', what: 'b', sameAs: 'x' }, { file: f }), (e) => e.code === 'NOT_FOUND' && e.evidence.known.join() === 'a');
    assert.throws(() => improvements.fix({ area: 'form', what: 'x', fixedBy: 'abc1234' }, { file: f }), (e) => e.code === 'NOT_FOUND' && e.evidence.open.join() === 'a');
  });

  await t.test('a line that does not parse is skipped and counted, and a write keeps it', () => {
    const bad = path.join(path.dirname(file), 'bad.jsonl');
    const cut = '{"area":"form","kind":"bro';
    fs.writeFileSync(bad, `${JSON.stringify({ area: 'form', kind: 'broken', what: 'a', seen: 1 })}\n${cut}\nnull\n`);
    const listed = improvements.list({ file: bad });
    assert.deepEqual([listed.map((e) => e.what), listed.skipped], [['a'], 2]);
    assert.equal(improvements.record({ area: 'form', kind: 'broken', what: 'b' }, { file: bad }).seen, 1);
    improvements.fix({ area: 'form', what: 'a', fixedBy: 'abc1234' }, { file: bad });
    const lines = fs.readFileSync(bad, 'utf8').split('\n');
    assert.ok(lines.includes(cut) && lines.includes('null'), 'the bad lines survive both writes');
    assert.deepEqual(improvements.list({ file: bad, all: true }).map((e) => e.what).sort(), ['a', 'b']);
  });

  await t.test('list on a log that does not exist yet is empty', () => {
    assert.deepEqual(improvements.list({ file: path.join(path.dirname(file), 'none.jsonl') }), []);
  });
});
