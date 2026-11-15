'use strict';

// Typed check records: what a checking tool compared and with which oracle. Pure, so the server and a route share it.
const { SfUiError } = require('./errors');
const FAIL = { sf_assert_field: ['FIELD_VALUE_MISMATCH', 'FIELD_NOT_SHOWN'], sf_api: ['VALUE_MISMATCH'], sf_wait: ['TIMEOUT', 'TEXT_COVERED'], sf_verify_live: ['STALE_BUILD'], sf_measure: ['MEASURE_MISMATCH'], sf_on_top: ['MEASURE_MISMATCH'], sf_list: ['SORT_NOT_APPLIED', 'LIST_MISMATCH', 'SEARCH_NOT_APPLIED', 'SELECTION_MISMATCH', 'NOT_DELETED', 'ROW_STILL_SHOWN', 'NOT_SAVED', 'FILTER_NOT_SAVED', 'NOT_MOVED', 'RECORD_NOT_SHOWN', 'OWNER_NOT_CHANGED'] };
// sf_list actions that confirm only that a view rendered (display) or a dialog opened (mass): no check.
const LIST_UNCHECKED = ['display', 'mass'];
// Tools that check only when called with expect; without it they are readings.
const LAYOUT = ['sf_measure', 'sf_on_top'];
const NEEDS_EXPECT = ['sf_api', ...LAYOUT];
// The value at a dotted path of keys, or undefined.
const at = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

const record = (list, entry) => { list.push({ ...entry, at: new Date().toISOString() }); return list; };
// A PASS with no check behind it has no control that could have come out red.
// A check marked weak (an expect copied from a reading) is no check either.
const weak = (result, checks) => result === 'PASS' && !checks.some((c) => !c.weak);

// A ledger per session id holds its checks, open scenario and improvements, kept apart from the browser entry so a restart
// cannot lose them. checks holds only the open scenario's records; begin and finish swap in a new array, which is what names an instance.
const ledger = (ledgers, id) => ledgers.get(id) || ledgers.set(id, { open: null, checks: [], steps: [], kinds: new Map(), errors: [], readings: [], copies: new WeakSet(), dropped: 0, recorded: 0, calls: 0, reads: 0, used: Date.now() }).get(id);
// The tool errors a run met, newest 20 and a count of older ones, so sf_end can ask for each one to be accounted for.
const ERRORS_KEPT = 20;
const READINGS_KEPT = 20; // layout readings kept to tell an expect copied from one
const noteError = (led, entry) => {
  if (record(led.errors, entry).length <= ERRORS_KEPT) return;
  led.errors.shift();
  led.dropped += 1;
};
// Freed once nothing keeps it: no browser (default always counts as having one) and nothing for sf_end to hand back,
// its call count aside.
function free(ledgers, browsers, id) {
  const led = ledgers.get(id);
  if (led && !drain(led) && id !== 'default' && !browsers.has(id)) ledgers.delete(id);
}
// An abandoned ledger (no browser, the close stamp in used older than the idle window) goes, open or not;
// default and keep stay.
function sweep(ledgers, browsers, idleMs, keep, now = Date.now()) {
  for (const [id, led] of ledgers) if (id !== 'default' && id !== keep && !browsers.has(id) && now - led.used > idleMs) ledgers.delete(id);
}
function begin(led, title) {
  if (led.open === title) return; // a retried start has already been applied
  if (led.open) throw new SfUiError('BAD_ARGS', `scenario "${led.open}" is still open: end it before starting "${title}"`, { open: led.open, start: title });
  led.open = title;
  led.checks = [];
  led.readings = []; // a look from an earlier scenario is not one this scenario's expect copied
  led.used = Date.now();
}
// Ending a title that is not open is loud: another scenario open is BAD_ARGS naming it; with none open it returns
// stray records if there are any, else refuses, so an end sent to the wrong session is not read as a weak pass.
function finish(led, title, result) {
  if (led.open !== title) {
    if (led.open) throw new SfUiError('BAD_ARGS', `scenario "${led.open}" is open, not "${title}"`, { open: led.open, end: title });
    if (!led.checks.length) throw new SfUiError('BAD_ARGS', `no scenario named "${title}" is open on this session`, { end: title });
  }
  const checks = led.checks;
  Object.assign(led, { checks: [], open: null, used: Date.now() });
  const verdict = decide(checks, led.kinds.get(title), result);
  // unplanned: no plan on this session named the title (a recovered session starts with none), so it was judged as positive.
  return { checks, verdict, ...(verdict !== result && { overruled: true }), ...(!led.kinds.has(title) && { unplanned: true }), ...(weak(result, checks) && { weak: true }) };
}
// A positive scenario (also one no plan named) fails when the last record of any check is a fail, so a retried wait that passed
// stands; a negative keeps the tester's result, since an expected failure is its pass.
function decide(checks, kind, result) {
  if (kind === 'negative') return result;
  const last = new Map(checks.map((c) => [JSON.stringify([c.tool, c.oracle, c.target, c.expected]), c]));
  return [...last.values()].some((c) => c.pass === false) ? 'FAIL' : result;
}
// What sf_end hands back before the ledger goes: the records since the last scenario start or end, one still open, and
// the run's improvements. Nothing at all when none of those has anything.
function drain(led) {
  const out = {
    ...((led?.checks.length || led?.open) && { checks: led.checks, ...(led.open && { open: led.open }) }),
    ...((led?.recorded || led?.errors.length) && { improvements: { recorded: led.recorded, errors: led.errors, ...(led.dropped && { dropped: led.dropped }) } }),
  };
  return Object.keys(out).length ? out : undefined;
}

// Wraps a handler so its check lands on the session's ledger once, after the call settles. A call the client cancelled,
// or one that outlived its scenario (an end or a rerun), records nothing; it writes to the ledger it started on, so an sf_end's stays gone.
const recorded = (ledgers, idOf, tool, handler) => async (args, extra = {}) => {
  const id = idOf();
  const led = ledgers.get(id);
  const list = led?.checks;
  const readings = led?.readings; // a scenario start or a new page replaces it: a look still running then belongs to neither
  let out, err;
  try { out = await handler(args, extra); } catch (e) { err = e; }
  const rec = led && !extra.signal?.aborted && led.checks === list && map(tool, args, out, err);
  if (rec) {
    // A px number equal to an earlier reading of the same aim was copied from it. A true, a null or a share is a shape a requirement
    // states, so it is never flagged.
    const aim = LAYOUT.includes(tool) && JSON.stringify(pick(args, AIM));
    if (aim && args.expect && typeof args.expect.value === 'number' && isPx(args.expect.path) && led.readings.some((r) => r.tool === tool && r.aim === aim && at(r.out, args.expect.path) === args.expect.value)) { Object.assign(rec, { weak: true, reason: 'expect copied from a reading in this run' }); led.copies.add(args); } // copies names the call to its captured step
    record(led.checks, rec); led.used = Date.now();
  } else if (led && led.readings === readings && LAYOUT.includes(tool) && !args.expect && out && !err && !extra.signal?.aborted) { // a look the client cancelled was never seen
    led.readings.push({ tool, aim: JSON.stringify(pick(args, AIM)), out });
    if (led.readings.length > READINGS_KEPT) led.readings.shift();
  }
  if (err) throw err;
  return out;
};

// The keys a layout result gives in px; every other number (count, rendered, inView, a share) is not a measure.
const PX = ['x', 'y', 'width', 'height', 'left', 'top', 'right', 'bottom'];
const isPx = (path) => PX.includes(path.split('.').at(-1));

// A layout reading held to a value: expect.path is dotted keys into the result, and a number may differ by tolerance px.
// The value comes from the requirement or a design, or from a first reading a person approved, never from the run itself.
function expectReading(out, { path, value, tolerance = 0 }) {
  const actual = at(out, path);
  // Tolerance is for px keys. A count, a share (visible, 0 to 1), a boolean, a string or null compares exactly.
  const px = typeof value === 'number' && typeof actual === 'number' && isPx(path);
  const ok = px ? Math.abs(actual - value) <= tolerance : actual === value;
  if (!ok) throw new SfUiError('MEASURE_MISMATCH', `${path} is ${JSON.stringify(actual ?? null)}, not ${JSON.stringify(value)}${px && tolerance ? ` (tolerance ${tolerance} px)` : ''}`, { path, expected: value, tolerance, actual: actual ?? null });
  return out;
}

const AIM = ['selector', 'name', 'role', 'text', 'row', 'column', 'nth', 'recordId', 'lwcApiName', 'inModal', 'frame', 'flexiPageApiName'];
const pick = (args, keys) => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
// The record a call makes, or null: a tool that does not check, or an error that is not a check outcome.
function map(tool, args, out, err) {
  const code = err && err.code; // a raw Playwright TimeoutError has none: the thing was never looked for
  if (!(tool in FAIL) || (err && !FAIL[tool].includes(code)) || (NEEDS_EXPECT.includes(tool) && !args.expect)) return null;
  if (tool === 'sf_list' && LIST_UNCHECKED.includes(args.action)) return null;
  const pass = !err;
  const got = (err ? err.evidence : out) || {};
  const make = (oracle, expected, actual, target, extra) => ({ tool, oracle, ...(target && { target }), expected, actual, pass, ...extra });
  if (tool === 'sf_assert_field') {
    // A field the page does not show fails as ui null, with hidden saying whether a copy is in the page (2026-11-11).
    const actual = code === 'FIELD_NOT_SHOWN' ? { ui: null, notShown: true, hidden: !!got.hidden }
      : Object.fromEntries(['api', 'apiDisplay', 'ui'].filter((k) => k in got).map((k) => [k, got[k]]));
    return make(args.via || 'both', args.expected, actual, pick(args, ['recordId', 'field']));
  }
  if (tool === 'sf_api') {
    // Nothing at the path is actual null with missing true, a flag no value the API returns can imitate.
    const missing = !pass && got.actual === undefined;
    return make('api', args.expect.equals, pass ? args.expect.equals : got.actual ?? null, { path: args.path, as: args.as || 'user', at: args.expect.path }, missing && { missing: true });
  }
  if (LAYOUT.includes(tool)) {
    const { path, value, tolerance } = args.expect;
    // The aim is in the key: a pass on one element must not replace a fail on another that shares the path.
    return make('layout', value, pass ? at(out, path) ?? null : got.actual ?? null, { ...pick(args, AIM), path, ...(tolerance && { tolerance }) });
  }
  if (tool === 'sf_wait') {
    const cond = args.gone ? { text: args.text, gone: true } : args.text;
    const actual = pass ? (args.any ? got.matched ?? null : cond) : code === 'TEXT_COVERED' ? { covered: got.covered } : null; // covered: the text was there, under a layer
    // ponytail: the same text in two components can let a pass in one hide a fail in the other; key by the resolved scope if that matters.
    // A wait aimed at the wrong place and then re-aimed is one check, so it is keyed by its condition alone.
    return make('rendered', args.any || cond, actual);
  }
  if (tool === 'sf_list') {
    // The action and its aim are the target; the result, or the evidence of the signal that never came, is actual.
    const { action, ...aim } = args;
    // A failed save keeps the page's own errors, and a record's failure its id and the others', beside what the server held.
    // select and open are confirmed from the page (the status line, the record beside the pane); the rest from the server.
    const failed = got.errors || got.recordId ? { seen: got.seen ?? null, ...pick(got, ['errors', 'recordId', 'gone', 'records', 'toasts', 'dialog']) } : got.seen ?? got;
    return make(['select', 'open'].includes(action) ? 'rendered' : 'server', action, pass ? got : failed, { action, ...pick(aim, ['row', 'rows', 'column', 'direction', 'text', 'value', 'field', 'operator', 'to', 'owner']) });
  }
  return make('rendered', args.marker, pass, pick(args, ['recordId', 'lwcApiName']));
}

module.exports = { isPx, LAYOUT, NEEDS_EXPECT, LIST_UNCHECKED, at, AIM, expectReading, record, weak, ledger, noteError, free, sweep, begin, finish, drain, recorded, map, FAIL };
