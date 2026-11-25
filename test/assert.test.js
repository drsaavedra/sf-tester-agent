'use strict';

// assert.fieldValue reads the API and the record page; a wrong expected value must throw.

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('..');
const A = require('../src/anchors');
const { auth, env, skip, account, probe, record: rec, stamp, localPage } = require('./helpers');

// No org: a field the landing tab renders a moment after the record opens is read there, not looked for on Details.
test('assert, no org: a field that renders late is waited for before Details is tried', { timeout: 15_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(5_000); // a field never shown fails the read, not the test's clock
  await page.setContent('<button role="tab" onclick="document.querySelector(\'main\').hidden = true">Details</button><main></main>');
  await page.evaluate((tag) => setTimeout(() => { document.querySelector('main').innerHTML = `<${tag} field-label="Rating"><div>Rating</div><div>Warm</div></${tag}>`; }, 1_000), A.layoutItem);
  const nav = require('../src/nav');
  const discover = require('../src/discover');
  const [open, model] = [nav.openRecord, discover.formModel];
  t.after(() => Object.assign(nav, { openRecord: open }) && Object.assign(discover, { formModel: model }));
  nav.openRecord = async () => {};
  discover.formModel = async () => ({ objectApiName: 'Account', fields: [{ apiName: 'Rating', label: 'Rating', dataType: 'Picklist' }] });
  assert.equal((await lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' })).ui, 'Warm');
});

// No org: a field on neither the landing tab nor Details is FIELD_NOT_SHOWN with the tabs, not a raw locator timeout.
test('assert, no org: a field the page does not show is FIELD_NOT_SHOWN, and one on Details is read there', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(5_000); // a wait with no timeout of its own fails the read, not the test's clock
  const nav = require('../src/nav');
  const discover = require('../src/discover');
  t.mock.method(nav, 'openRecord', async () => {});
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Account', fields: [{ apiName: 'Rating', label: 'Rating', dataType: 'Picklist' }] }));
  const item = `<${A.layoutItem} field-label="Rating"><div>Rating</div><div>Warm</div></${A.layoutItem}>`;
  await page.setContent(`<div role="tablist"><button role="tab">Related</button></div><main></main>`);
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' }), (e) => e.code === 'FIELD_NOT_SHOWN' && e.evidence.tabs.join() === 'Related' && e.evidence.hidden === false);
  await page.setContent(`<div role="tablist"><button role="tab">Related</button></div><main><section hidden>${item}</section></main>`); // a collapsed section
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' }), (e) => e.code === 'FIELD_NOT_SHOWN' && e.evidence.hidden === true && /hidden/.test(e.message));
  await page.setContent(`<div role="tablist"><button role="tab">Related</button><button role="tab" onclick="document.querySelector('main').innerHTML = '${item.replace(/"/g, '&quot;')}'">Details</button></div><main></main>`);
  assert.equal((await lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' })).ui, 'Warm'); // control: Details holds it
  await page.setContent(`<div role="tablist"><button role="tab">Details</button></div><main></main>`);
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' }), (e) => e.code === 'FIELD_NOT_SHOWN' && e.evidence.tabs.join() === 'Details');
});

// No org: on a page with no Details tab, a field that renders at 4 s is still read, not FIELD_NOT_SHOWN at 3 s.
test('assert, no org: a slow field on a page with no Details tab is read', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(5_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Account', fields: [{ apiName: 'Rating', label: 'Rating', dataType: 'Picklist' }] }));
  await page.setContent('<div role="tablist"><button role="tab">Related</button></div><main></main>');
  await page.evaluate((tag) => setTimeout(() => { document.querySelector('main').innerHTML = `<${tag} field-label="Rating"><div>Rating</div><div>Warm</div></${tag}>`; }, 4_000), A.layoutItem);
  assert.equal((await lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' })).ui, 'Warm');
});

// No org: a Details tab a layer covers fails its click: that error, not FIELD_NOT_SHOWN, which would blame the layout.
test('assert, no org: a Details click that fails is its own error', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Account', fields: [{ apiName: 'Rating', label: 'Rating', dataType: 'Picklist' }] }));
  await page.setContent('<div role="tablist"><button role="tab">Details</button></div><div style="position:fixed;inset:0;background:#fff"></div><main></main>');
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'Rating', 'Warm', { via: 'ui' }), (e) => e.name === 'TimeoutError' && e.code !== 'FIELD_NOT_SHOWN');
});

// No org: a lookup set by a 15-char id stores the 18-char one, so the API side matches on the first 15 characters.
test('assert, no org: a lookup expected by its 15-char id matches the stored 18', async (t) => {
  const [ID, OTHER] = ['001C100000XZ8PWIA1', '001C100000XVXrE'];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Contact', fields: [{ apiName: 'AccountId', label: 'Account Name', dataType: 'Reference' }] }));
  t.mock.method(require('../src/api'), 'call', async (s, p) => (p.startsWith('/ui-api/object-info/') ? { fields: { AccountId: { relationshipName: 'Account' } } }
    : { fields: { AccountId: { value: ID }, Account: { displayValue: 'Acme' } } }));
  await lib.assert.fieldValue({}, '003x', 'AccountId', ID.slice(0, 15), { via: 'api' });
  await lib.assert.fieldValue({}, '003x', 'AccountId', ID, { via: 'api' }); // control: the 18 matches as before
  await assert.rejects(lib.assert.fieldValue({}, '003x', 'AccountId', OTHER, { via: 'api' }), { code: 'FIELD_VALUE_MISMATCH' });
});

// No org: the API stores a datetime and a time with milliseconds; the same instant typed without them matches.
test('assert, no org: a datetime or time matches as an instant, not as a string', async (t) => {
  const model = { objectApiName: 'SfUiProbe__c', fields: [{ apiName: 'At__c', label: 'At', dataType: 'DateTime' }, { apiName: 'Start__c', label: 'Start', dataType: 'Time' }, { apiName: 'Code__c', label: 'Code', dataType: 'String' }] };
  t.mock.method(require('../src/discover'), 'formModel', async () => model);
  t.mock.method(require('../src/api'), 'call', async () => ({ fields: { At__c: { value: '2026-12-31T17:30:00.000Z' }, Start__c: { value: '14:30:00.000Z' }, Code__c: { value: '14:30:00.000Z' } } }));
  const check = (f, v) => lib.assert.fieldValue({}, 'a0x', f, v, { via: 'api' });
  await check('At__c', '2026-12-31T17:30:00Z');
  await check('At__c', '2026-12-31T18:30:00+01:00');
  await check('At__c', '2026-12-31T17:30:00.000+0000'); // as SOQL and REST print it
  await check('At__c', '2026-12-31T18:30:00+0100');
  await assert.rejects(check('At__c', '2026-12-31T17:30:00.000+0100'), { code: 'FIELD_VALUE_MISMATCH' });
  await check('Start__c', '14:30');
  await check('Start__c', '14:30:00Z');
  await check('At__c', '2026-12-31T17:30:00.000Z'); // control: the stored string matched before and still does
  await assert.rejects(check('At__c', '2026-12-31T17:31:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  const tz = process.env.TZ;
  process.env.TZ = 'UTC'; // the zone where a zoneless value would read as the stored instant
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  await assert.rejects(check('At__c', '2026-12-31T17:30:00'), { code: 'FIELD_VALUE_MISMATCH' }); // no zone: the machine's own would decide
  await assert.rejects(check('Start__c', '14:31'), { code: 'FIELD_VALUE_MISMATCH' });
  await assert.rejects(check('Code__c', '14:30'), { code: 'FIELD_VALUE_MISMATCH' }); // a text field still compares whole
});

// F-tz-3: a datetime not on the calendar is not the instant Date.parse rolls it to (Feb 30 is Mar 2, T24:00 the next day).
test('assert, no org: a datetime not on the calendar does not match the instant it rolls to', async (t) => {
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiProbe__c', fields: [{ apiName: 'At__c', label: 'At', dataType: 'DateTime' }] }));
  let held;
  t.mock.method(require('../src/api'), 'call', async () => ({ fields: { At__c: { value: held } } }));
  const check = (v) => lib.assert.fieldValue({}, 'a0x', 'At__c', v, { via: 'api' });
  held = '2027-03-02T10:00:00.000+0000';
  await assert.rejects(check('2027-02-30T10:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  await check('2027-03-02T10:00:00Z'); // control: the day it rolls to
  held = '2027-03-02T00:00:00.000+0000';
  await assert.rejects(check('2027-03-01T24:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  await check('2027-03-02T00:00:00Z'); // control
});

// No org: the record page shows a time with seconds (2:30:00 PM), its API display value without (2:30 PM).
test('assert, no org: a time on the page matches its display value without the seconds', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const field = { apiName: 'Start__c', label: 'Start', dataType: 'Time' };
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiProbe__c', fields: [field] }));
  t.mock.method(require('../src/api'), 'call', async () => ({ fields: { Start__c: { value: '14:30:00.000Z', displayValue: '2:30 PM' } } }));
  const show = (text) => page.setContent(`<${A.layoutItem} field-label="Start"><div>Start</div><div>${text}</div></${A.layoutItem}>`);
  await show('2:30:00 PM');
  assert.equal((await lib.assert.fieldValue({ page }, 'a0x', 'Start__c', '14:30')).ui, '2:30:00 PM');
  await show('2:30 PM'); // control: a page that matches the display value as it is
  await lib.assert.fieldValue({ page }, 'a0x', 'Start__c', '14:30');
  await show('2:31:00 PM');
  await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Start__c', '14:30'), { code: 'FIELD_VALUE_MISMATCH' });
  field.dataType = 'String'; // a text field keeps its seconds
  await show('2:30:00 PM');
  await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Start__c', '14:30:00.000Z'), { code: 'FIELD_VALUE_MISMATCH' });
});

// F-tz-6, no org: an all-day Event's page shows Start as a date (6/1/2027), its API display value as a time in the
// user's zone (5/31/2027, 5:00 PM); ActivityDate's display value bridges them.
test('assert, no org: an all-day Event\'s Start on the page matches its ActivityDate display value', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Event', fields: [{ apiName: 'StartDateTime', label: 'Start', dataType: 'DateTime' }] }));
  let allDay = true;
  const paths = [];
  t.mock.method(require('../src/api'), 'call', async (s, p) => {
    paths.push(p);
    return { fields: { StartDateTime: { value: '2027-06-01T00:00:00.000Z', displayValue: '5/31/2027, 5:00 PM' },
      IsAllDayEvent: { value: allDay, displayValue: null }, ActivityDate: { value: '2027-06-01', displayValue: '6/1/2027' } } };
  });
  const show = (text) => page.setContent(`<${A.layoutItem} field-label="Start"><div>Start</div><div>${text}</div></${A.layoutItem}>`);
  const check = (want) => lib.assert.fieldValue({ page }, '00Ux', 'StartDateTime', want);
  await show('6/1/2027');
  assert.equal((await check('2027-06-01T00:00:00Z')).ui, '6/1/2027');
  assert.match(paths[0], /optionalFields=.*Event\.IsAllDayEvent.*Event\.ActivityDate/);
  await show('6/2/2027'); // a page showing another day still fails
  await assert.rejects(check('2027-06-01T00:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  allDay = false; // a timed Event's page shows the time, so the date alone is not its value
  await show('6/1/2027');
  await assert.rejects(check('2027-06-01T00:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
});

// F-tz-1, no org: via ui, a date or time expected as its ISO value is bridged to the page by the UI API display value.
test('assert, no org: via ui, a Date, DateTime or Time given as ISO matches the page through the API display value', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Due__c', label: 'Due', dataType: 'Date' }, { apiName: 'At__c', label: 'At', dataType: 'DateTime' },
    { apiName: 'Start__c', label: 'Start', dataType: 'Time' }, { apiName: 'Code__c', label: 'Code', dataType: 'String' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiProbe__c', fields }));
  const stored = { Due__c: { value: '2027-06-01', displayValue: '6/1/2027' }, At__c: { value: '2027-06-01T03:00:00.000Z', displayValue: '5/31/2027, 8:00 PM' },
    Start__c: { value: '14:30:00.000Z', displayValue: '2:30 PM' }, Code__c: { value: 'x', displayValue: '6/1/2027' } };
  const paths = [];
  t.mock.method(require('../src/api'), 'call', async (s, p) => { paths.push(p); return { fields: stored }; });
  const check = async (f, label, text, want) => {
    await page.setContent(`<${A.layoutItem} field-label="${label}"><div>${label}</div><div>${text}</div></${A.layoutItem}>`);
    return lib.assert.fieldValue({ page }, 'a0x', f, want, { via: 'ui' });
  };
  assert.deepEqual(await check('Due__c', 'Due', '6/1/2027', '2027-06-01'), { ui: '6/1/2027' }); // via ui still returns the page only
  await check('At__c', 'At', '5/31/2027, 8:00 PM', '2027-06-01T03:00:00Z');
  await check('Start__c', 'Start', '2:30:00 PM', '14:30');
  await assert.rejects(check('Due__c', 'Due', '6/2/2027', '2027-06-01'), { code: 'FIELD_VALUE_MISMATCH' }); // the page shows another day
  await assert.rejects(check('Due__c', 'Due', '6/1/2027', '2027-06-02'), { code: 'FIELD_VALUE_MISMATCH' }); // the record holds another day
  await assert.rejects(check('At__c', 'At', '5/31/2027, 8:00 PM', '2027-06-01T04:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  paths.length = 0; // control: a text field via ui reads no API and compares the page whole
  await assert.rejects(check('Code__c', 'Code', '6/1/2027', 'x'), { code: 'FIELD_VALUE_MISMATCH' });
  assert.equal(paths.length, 0);
});

// F-cascade-2, no org: the API holds a Text Area with CRLF line ends; the page shows its blank line and a tab as a space.
test('assert, no org: a Text Area of several lines matches as typed, via api, ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Memo__c', label: 'Memo', dataType: 'TextArea' }, { apiName: 'Long__c', label: 'Long', dataType: 'TextArea' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiC_Field__c', fields }));
  const stored = { Memo__c: 'line one\r\n\r\nline three', Long__c: 'lead\ttab\r\nsecond' };
  t.mock.method(require('../src/api'), 'call', async (s, p) => ({ fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  const item = (label, text) => `<${A.layoutItem} field-label="${label}"><div>${label}</div><div style="white-space: pre-line">${text}</div><div>Edit ${label}</div></${A.layoutItem}>`;
  await page.setContent(item('Memo', 'line one\n\nline three') + item('Long', 'lead\ttab\nsecond'));
  for (const via of ['api', 'ui', 'both']) {
    await lib.assert.fieldValue({ page }, 'a0x', 'Memo__c', 'line one\n\nline three', { via });
    await lib.assert.fieldValue({ page }, 'a0x', 'Long__c', 'lead\ttab\nsecond', { via });
    await lib.assert.fieldValue({ page }, 'a0x', 'Memo__c', stored.Memo__c, { via }); // expected as the API stores it
    // Control: a lost blank line, or a line break typed as a space, is still red.
    await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Memo__c', 'line one\nline three', { via }), { code: 'FIELD_VALUE_MISMATCH' });
    await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Long__c', 'lead\ttab second', { via }), { code: 'FIELD_VALUE_MISMATCH' });
  }
});

// F-cascade-5, F-flow-15, no org: the page groups a Number's digits (12,345) and adds a Percent's sign (25%); the
// API gives no display value for either. The number, typed either way, matches via api, ui and both.
test('assert, no org: a Number of 1,000 or more and a Percent match as the number, via api, ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Count__c', label: 'Count', dataType: 'Double' }, { apiName: 'F_Pct__c', label: 'F Pct', dataType: 'Percent' },
    { apiName: 'Code__c', label: 'Code', dataType: 'String' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiC_Field__c', fields }));
  const stored = { Count__c: 12345, F_Pct__c: 25, Code__c: '12345' };
  t.mock.method(require('../src/api'), 'call', async (s, p) => ({ fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  const item = (label, text) => `<${A.layoutItem} field-label="${label}"><div>${label}</div><div>${text}</div><div>Edit ${label}</div></${A.layoutItem}>`;
  await page.setContent(item('Count', '12,345') + item('F Pct', '25%') + item('Code', '12,345'));
  const red = (f, v, via) => assert.rejects(lib.assert.fieldValue({ page }, 'a0x', f, v, { via }), { code: 'FIELD_VALUE_MISMATCH' });
  for (const via of ['api', 'ui', 'both']) {
    for (const v of [12345, '12345', '12,345']) await lib.assert.fieldValue({ page }, 'a0x', 'Count__c', v, { via });
    for (const v of [25, '25', '25%']) await lib.assert.fieldValue({ page }, 'a0x', 'F_Pct__c', v, { via });
    // Control: another number is still red.
    await red('Count__c', 12346, via);
    await red('F_Pct__c', 26, via);
  }
  for (const v of ['1,2345', '12345%', '']) await red('Count__c', v, 'api'); // digits grouped wrong, a % on a Number, empty
  await red('Code__c', 12345, 'ui'); // a text field compares the page text whole
});

// F-cascade-21, no org: a checkbox expected as the text the page shows ("False") passes, via api, ui and both.
test('assert, no org: a checkbox matches as the page shows it, True or False, via api, ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Done__c', label: 'Done', dataType: 'Boolean' }, { apiName: 'Open__c', label: 'Open', dataType: 'Boolean' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiC_Field__c', fields }));
  const stored = { Done__c: false, Open__c: true };
  t.mock.method(require('../src/api'), 'call', async (s, p) => ({ fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  const item = (label, text) => `<${A.layoutItem} field-label="${label}"><div>${label}</div><div>${text}</div><div>Edit ${label}</div></${A.layoutItem}>`;
  await page.setContent(item('Done', 'False') + item('Open', 'True'));
  const red = (f, v, via) => assert.rejects(lib.assert.fieldValue({ page }, 'a0x', f, v, { via }), { code: 'FIELD_VALUE_MISMATCH' });
  for (const via of ['api', 'ui', 'both']) {
    for (const v of ['False', 'false', false]) await lib.assert.fieldValue({ page }, 'a0x', 'Done__c', v, { via });
    for (const v of ['True', 'true', true]) await lib.assert.fieldValue({ page }, 'a0x', 'Open__c', v, { via });
    // Control: the other value is still red.
    for (const v of ['True', true]) await red('Done__c', v, via);
    for (const v of ['False', false]) await red('Open__c', v, via);
  }
});

// F-cascade-24, no org: the org stores and shows a multi-select in picklist order, which need not be the order typed.
test('assert, no org: a multi-select matches as a set, in any order, via api, ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Tags__c', label: 'Tags', dataType: 'MultiPicklist' }, { apiName: 'Kinds__c', label: 'Kinds', dataType: 'MultiPicklist' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiProbe__c', fields }));
  // Kinds__c's picklist puts Gamma before Alpha, so its stored order is not the sorted one.
  const stored = { Tags__c: 'Beta;Gamma', Kinds__c: 'Gamma;Alpha' };
  t.mock.method(require('../src/api'), 'call', async (s, p) => { const k = p.split('.').pop(); return { fields: { [k]: { value: stored[k], displayValue: stored[k] } } }; });
  const item = (label, text) => `<${A.layoutItem} field-label="${label}"><div>${label}</div><div>${text}</div><div>Edit ${label}</div></${A.layoutItem}>`;
  await page.setContent(item('Tags', 'Beta;Gamma') + item('Kinds', 'Gamma;Alpha'));
  const red = (f, v, via) => assert.rejects(lib.assert.fieldValue({ page }, 'a0x', f, v, { via }), { code: 'FIELD_VALUE_MISMATCH' });
  for (const via of ['api', 'ui', 'both']) {
    for (const v of ['Gamma;Beta', 'Beta;Gamma']) await lib.assert.fieldValue({ page }, 'a0x', 'Tags__c', v, { via });
    for (const v of ['Alpha;Gamma', 'Gamma;Alpha']) await lib.assert.fieldValue({ page }, 'a0x', 'Kinds__c', v, { via });
    // Control: another set is still red, a subset and a superset included.
    for (const v of ['Gamma', 'Alpha;Beta', 'Alpha;Beta;Gamma']) await red('Tags__c', v, via);
    await red('Kinds__c', 'Alpha', via);
  }
});

// No org: a field only a Dynamic Forms page places is not in the layout's View model; the page is still read.
// F-cascade-6, no org: a field with help text carries a lightning-helptext whose text ("Help <label>") innerText reads.
test('assert, no org: a field with help text is read without its help button, via ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'Email__c', label: 'Email', dataType: 'Email' }, { apiName: 'Note__c', label: 'Note', dataType: 'String' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiC_Field__c', fields }));
  const stored = { Email__c: 'a@b.example', Note__c: 'Help Note' };
  t.mock.method(require('../src/api'), 'call', async (s, p) => ({ fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  const help = (label) => `<${A.helptext}><button><span>Help ${label}</span></button></${A.helptext}>`;
  const item = (label, text, h = '') => `<${A.layoutItem} field-label="${label}"><div>${label}</div>${h}<div>${text}</div><div>Edit ${label}</div></${A.layoutItem}>`;
  await page.setContent(item('Email', 'a@b.example', help('Email')) + item('Note', 'Help Note'));
  for (const via of ['ui', 'both']) {
    assert.equal((await lib.assert.fieldValue({ page }, 'a0x', 'Email__c', 'a@b.example', { via })).ui, 'a@b.example');
    // Control: with no help button, a value that reads like one is the value.
    assert.equal((await lib.assert.fieldValue({ page }, 'a0x', 'Note__c', 'Help Note', { via })).ui, 'Help Note');
    await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Email__c', 'c@d.example', { via }), { code: 'FIELD_VALUE_MISMATCH' });
  }
});

// F-cascade-7, no org: an Owner item also holds the Change Owner button, a Created By item the date and the page label
// "Created By" (object-info: "Created By ID"); a polymorphic Owner has a display value only when its Name is asked for.
test('assert, no org: Owner and Created By are read as the user\'s name, by name and by id, via ui and both', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const fields = [{ apiName: 'OwnerId', label: 'Owner', itemLabel: 'Owner', dataType: 'Reference' },
    { apiName: 'CreatedById', label: 'Created By ID', itemLabel: 'Created By', dataType: 'Reference' },
    { apiName: 'Code__c', label: 'Code', itemLabel: 'Site Code', dataType: 'String' }];
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiC_Field__c', fields }));
  const ID = '005HE000005QFbmYAG';
  const info = { fields: { OwnerId: { relationshipName: 'Owner' }, CreatedById: { relationshipName: 'CreatedBy' } } };
  t.mock.method(require('../src/api'), 'call', async (s, p) => {
    if (p.startsWith('/ui-api/object-info/')) return info;
    const name = (rel) => (p.includes(`.${rel}.Name`) ? 'User User' : null); // Owner, polymorphic, needs its Name asked
    return { fields: { OwnerId: { value: ID }, CreatedById: { value: ID }, Owner: { displayValue: name('Owner') }, CreatedBy: { displayValue: 'User User' } } };
  });
  const link = '<force-lookup><records-hoverable-link><div><a>User User</a></div><div>Preview</div></records-hoverable-link></force-lookup>';
  await page.setContent(`<${A.layoutItem} field-label="Owner"><div>Owner</div>${link}<div><button>Change Owner</button></div></${A.layoutItem}>`
    + `<${A.layoutItem} field-label="Created By"><div>Created By</div>${link}<div>, 11/25/2026, 8:07 PM</div></${A.layoutItem}>`
    + `<${A.layoutItem} field-label="Site Code"><div>Site Code</div><div>C-1</div><div>Edit Site Code</div></${A.layoutItem}>`);
  for (const f of ['OwnerId', 'CreatedById']) {
    assert.equal((await lib.assert.fieldValue({ page }, 'a0x', f, 'User User', { via: 'ui' })).ui, 'User User');
    for (const want of ['User User', ID, ID.slice(0, 15)]) await lib.assert.fieldValue({ page }, 'a0x', f, want, { via: 'both' });
    // Control: another user's name is still red.
    for (const via of ['ui', 'both']) await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', f, 'Other User', { via }), { code: 'FIELD_VALUE_MISMATCH' });
  }
  // A field that is no lookup, found by its page label, is read without that label and its pencil.
  assert.equal((await lib.assert.fieldValue({ page }, 'a0x', 'Code__c', 'C-1', { via: 'ui' })).ui, 'C-1');
});

test('assert, no org: a field off the layout is read from the Dynamic Forms page by its object-info label', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'SfUiDyn__c', fields: [] }));
  t.mock.method(require('../src/api'), 'call', async () => ({ fields: { Note__c: { apiName: 'Note__c', label: 'Note', dataType: 'TextArea' } } }));
  await page.setContent('<div role="tablist"><button role="tab">Details</button></div><div data-target-selection-name="sfdc:RecordField.SfUiDyn__c.Note__c"><div>Note</div><div>dyn note</div><div>Edit Note</div></div>');
  assert.equal((await lib.assert.fieldValue({ page }, 'a0x', 'Note__c', 'dyn note', { via: 'ui' })).ui, 'dyn note');
  await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Note__c', 'other', { via: 'ui' }), { code: 'FIELD_VALUE_MISMATCH' });
  // Control: a field this user cannot see at all is still FIELD_NOT_ON_FORM.
  await assert.rejects(lib.assert.fieldValue({ page }, 'a0x', 'Secret__c', 'x', { via: 'ui' }), { code: 'FIELD_NOT_ON_FORM' });
});

// F-cascade-11, no org: an address part shows inside its compound's one item ("Billing Address", or a Dynamic Forms
// Site__c), as measured on sfui-pool-2; the part is matched inside that text.
test('assert, no org: a part of a standard or custom Address is matched inside the Address the page shows', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  const models = {
    '001x': { objectApiName: 'Account', fields: ['Street', 'City', 'State'].map((p) => ({ apiName: `Billing${p}`, label: `Billing ${p}`, itemLabel: 'Billing Address', dataType: 'String' })) },
    a0x: { objectApiName: 'SfUiC_Place__c', fields: [] }, // Site__c is placed by the Dynamic Forms page only
  };
  t.mock.method(require('../src/discover'), 'formModel', async (s, id) => models[id]);
  const part = (apiName, label, whole) => ({ apiName, label, dataType: 'String', compoundFieldName: whole });
  const info = {
    Account: { BillingAddress: { apiName: 'BillingAddress', label: 'Billing Address', dataType: 'Address' }, BillingStreet: part('BillingStreet', 'Billing Street', 'BillingAddress'),
      BillingCity: part('BillingCity', 'Billing City', 'BillingAddress'), BillingState: part('BillingState', 'Billing State', 'BillingAddress') },
    SfUiC_Place__c: { Site__c: { apiName: 'Site__c', label: 'Site', dataType: 'Address' }, Site__City__s: part('Site__City__s', 'Site (City)', 'Site__c') },
  };
  const stored = { BillingStreet: '2 Break St\r\nSuite 9', BillingCity: 'Oakland', BillingState: 'CA', Site__City__s: 'Oakland' };
  t.mock.method(require('../src/api'), 'call', async (s, p) => (p.startsWith('/ui-api/object-info/') ? { fields: info[p.split('/').pop()] }
    : { fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  await page.setContent(`<div role="tablist"><button role="tab">Details</button></div><${A.layoutItem} field-label="Billing Address"><div>Billing Address</div>`
    + `<a href="#"><div>2 Break St</div><div>Suite 9, Oakland</div><div>94607 CA</div><div>USA</div></a><button>Edit Billing Address</button></${A.layoutItem}>`
    + '<div data-target-selection-name="sfdc:RecordField.SfUiC_Place__c.Site__c"><div>Site</div><div>2 Break Street, Oakland</div><div>Edit Site</div></div>');
  for (const via of ['ui', 'both']) {
    await lib.assert.fieldValue({ page }, '001x', 'BillingCity', 'Oakland', { via });
    await lib.assert.fieldValue({ page }, '001x', 'BillingStreet', '2 Break St\nSuite 9', { via });
    await lib.assert.fieldValue({ page }, '001x', 'BillingState', 'CA', { via });
    await lib.assert.fieldValue({ page }, 'a0x', 'Site__City__s', 'Oakland', { via });
    // Control: a value the Address does not hold, or only a piece of a word in it, is red and carries the page's text.
    for (const [id, f, want] of [['001x', 'BillingCity', 'Berkeley'], ['001x', 'BillingCity', 'Oak'], ['a0x', 'Site__City__s', 'Berkeley']]) {
      await assert.rejects(lib.assert.fieldValue({ page }, id, f, want, { via }), (e) => e.code === 'FIELD_VALUE_MISMATCH' && /Oakland/.test(e.evidence.ui));
    }
  }
});

// R1, no org: an empty part (BillingState null) has no text in the Address to find, so via both it passes on the stored value.
test('assert, no org: an empty part of an Address expected null passes via both when the stored part is empty', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  page.setDefaultTimeout(2_000);
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Account',
    fields: ['City', 'State'].map((p) => ({ apiName: `Billing${p}`, label: `Billing ${p}`, itemLabel: 'Billing Address', dataType: 'String' })) }));
  const part = (apiName) => ({ apiName, label: apiName, dataType: 'String', compoundFieldName: 'BillingAddress' });
  const info = { BillingAddress: { apiName: 'BillingAddress', label: 'Billing Address', dataType: 'Address' }, BillingCity: part('BillingCity'), BillingState: part('BillingState') };
  const stored = { BillingCity: 'Oakland', BillingState: null };
  t.mock.method(require('../src/api'), 'call', async (s, p) => (p.startsWith('/ui-api/object-info/') ? { fields: info }
    : { fields: { [p.split('.').pop()]: { value: stored[p.split('.').pop()], displayValue: null } } }));
  await page.setContent(`<div role="tablist"><button role="tab">Details</button></div><${A.layoutItem} field-label="Billing Address"><div>Billing Address</div>`
    + `<a href="#"><div>2 Break St</div><div>Oakland</div><div>USA</div></a><button>Edit Billing Address</button></${A.layoutItem}>`);
  await lib.assert.fieldValue({ page }, '001x', 'BillingState', null, { via: 'both' });
  await lib.assert.fieldValue({ page }, '001x', 'BillingCity', 'Oakland', { via: 'both' });
  // Control: a value the stored part does not hold is still red.
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'BillingState', 'CA', { via: 'both' }), { code: 'FIELD_VALUE_MISMATCH' });
  stored.BillingState = 'CA';
  await assert.rejects(lib.assert.fieldValue({ page }, '001x', 'BillingState', null, { via: 'both' }), { code: 'FIELD_VALUE_MISMATCH' });
});

// No org: a lookup only a Dynamic Forms page places is not in the View model; object-info says it is a lookup.
test('assert, no org: an off-layout lookup expected by its 15-char id matches the stored 18', async (t) => {
  const ID = 'a0BC1000004XyZ9MAK';
  const model = { objectApiName: 'SfUiDyn__c', fields: [] };
  t.mock.method(require('../src/discover'), 'formModel', async () => model);
  const info = { fields: { Probe__c: { label: 'Probe', dataType: 'Reference', relationshipName: 'Probe__r' }, Code__c: { label: 'Code', dataType: 'String' }, Note__c: { label: 'Note', dataType: 'String' } } };
  t.mock.method(require('../src/api'), 'call', async (s, p) => (p.startsWith('/ui-api/object-info/') ? info
    : { fields: { Probe__c: { value: ID }, Code__c: { value: ID }, Note__c: { value: ID } } }));
  await lib.assert.fieldValue({}, 'a0x', 'Probe__c', ID.slice(0, 15), { via: 'api' });
  // Control: an off-layout text field that holds an id compares whole.
  await assert.rejects(lib.assert.fieldValue({}, 'a0x', 'Note__c', ID.slice(0, 15), { via: 'api' }), { code: 'FIELD_VALUE_MISMATCH' });
  // Control: a field on the layout that is no lookup compares whole, even when it holds an id-shaped value.
  model.fields = [{ apiName: 'Code__c', label: 'Code', dataType: 'String' }];
  await assert.rejects(lib.assert.fieldValue({}, 'a0x', 'Code__c', ID.slice(0, 15), { via: 'api' }), { code: 'FIELD_VALUE_MISMATCH' });
});

test('assert', { skip, timeout: 480_000 }, async (t) => {
  const s = await lib.session.start(await auth(env.org));
  t.after(() => lib.session.end(s));
  const record = await account(s, t, { Rating: 'Warm' });

  await t.test('assert.fieldValue passes when API and page agree with the expected value', async () => {
    const r = await lib.assert.fieldValue(s, record, 'Rating', 'Warm');
    assert.equal(r.api, 'Warm');
    assert.equal(r.ui, 'Warm');
  });

  await t.test('assert.fieldValue throws FIELD_VALUE_MISMATCH on a wrong value, page side included', async () => {
    await assert.rejects(lib.assert.fieldValue(s, record, 'Rating', 'Not A Rating', { via: 'ui' }), (e) => e.code === 'FIELD_VALUE_MISMATCH' && e.evidence.ui !== undefined);
  });

  // The page shows a date as the user reads it (3/4/2026), the API as stored; both agree through the display value.
  await t.test('assert.fieldValue accepts the page showing the API display value', async () => {
    const id = await probe(s, t, { Due__c: '2026-03-04' });
    const r = await lib.assert.fieldValue(s, id, 'Due__c', '2026-03-04');
    assert.equal(r.api, '2026-03-04');
    assert.notEqual(r.ui, r.api, 'the page shows the date formatted');
    assert.equal(r.ui, r.apiDisplay);
  });

  // A checkbox is true in the API and "True" on the page, with no display value to bridge them.
  await t.test('assert.fieldValue matches a checkbox through both, and still fails a wrong one', async () => {
    const id = await probe(s, t, { Done__c: true });
    const r = await lib.assert.fieldValue(s, id, 'Done__c', true);
    assert.deepEqual([r.api, r.ui], [true, 'True']);
    await assert.rejects(lib.assert.fieldValue(s, id, 'Done__c', false), { code: 'FIELD_VALUE_MISMATCH' });
  });

  // F-cascade-21: a checkbox expected as the text the page shows ("False") passes, via ui and both.
  await t.test('assert.fieldValue passes a checkbox expected as the page text, False or True, via ui and both', async () => {
    const id = await probe(s, t, { Done__c: false });
    for (const via of ['ui', 'both']) {
      const r = await lib.assert.fieldValue(s, id, 'Done__c', 'False', { via });
      assert.equal(r.ui, 'False');
      await assert.rejects(lib.assert.fieldValue(s, id, 'Done__c', 'True', { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
  });

  // The API stores ...00.000Z; a datetime or time typed without milliseconds is the same value, page side included.
  await t.test('assert.fieldValue matches a datetime and a time typed without milliseconds', async () => {
    const id = await probe(s, t, { Name: `SWB at ${stamp()}`, At__c: '2026-12-31T17:30:00Z', Start__c: '14:30:00Z' });
    const at = await lib.assert.fieldValue(s, id, 'At__c', '2026-12-31T17:30:00Z');
    assert.equal(at.api, '2026-12-31T17:30:00.000Z');
    await lib.assert.fieldValue(s, id, 'Start__c', '14:30');
    await assert.rejects(lib.assert.fieldValue(s, id, 'At__c', '2026-12-31T17:31:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
  });

  // F-tz-6: an all-day Event's page shows Start and End as the day; via both is green on the value it holds.
  await t.test('assert.fieldValue via both passes an all-day Event\'s Start and End, with a timed Event as the control', async () => {
    const event = (f) => rec(s, t, 'Event', { Subject: `BREAK fix allday ${stamp()}`, ...f });
    const day = await event({ IsAllDayEvent: true, ActivityDate: '2027-06-01', DurationInMinutes: 1440 });
    const { fields } = await lib.api.call(s, `/ui-api/records/${day}?fields=Event.StartDateTime,Event.EndDateTime`);
    for (const f of ['StartDateTime', 'EndDateTime']) {
      const r = await lib.assert.fieldValue(s, day, f, fields[f].value);
      assert.notEqual(r.ui, r.apiDisplay, 'the page shows the day, not the display value\'s time');
      await assert.rejects(lib.assert.fieldValue(s, day, f, '2027-06-02T00:00:00Z'), { code: 'FIELD_VALUE_MISMATCH' });
    }
    const timed = await event({ StartDateTime: '2027-06-01T15:00:00Z', EndDateTime: '2027-06-01T16:00:00Z' });
    await lib.assert.fieldValue(s, timed, 'StartDateTime', '2027-06-01T15:00:00Z');
    await lib.assert.fieldValue(s, timed, 'EndDateTime', '2027-06-01T16:00:00Z');
  });

  // F-tz-1: via ui, a date, datetime or time given as its ISO value is green, as via both is, and a wrong one is red.
  await t.test('assert.fieldValue via ui passes a Date, DateTime and Time given as the ISO value', async () => {
    const id = await probe(s, t, { Name: `BREAK fix tz1 ${stamp()}`, Due__c: '2027-06-01', At__c: '2027-06-01T03:00:00Z', Start__c: '14:30:00Z' });
    for (const [f, want, wrong] of [['Due__c', '2027-06-01', '2027-06-02'], ['At__c', '2027-06-01T03:00:00Z', '2027-06-01T04:00:00Z'], ['Start__c', '14:30', '14:31']]) {
      const r = await lib.assert.fieldValue(s, id, f, want, { via: 'ui' });
      assert.notEqual(r.ui, want, 'the page shows the value formatted, not as ISO');
      await assert.rejects(lib.assert.fieldValue(s, id, f, wrong, { via: 'ui' }), { code: 'FIELD_VALUE_MISMATCH' });
    }
  });

  // A lookup shows the record's name with a visually hidden "Preview" control the page reads as a second line.
  await t.test('assert.fieldValue reads a lookup on the page as the record name alone', async () => {
    const id = await probe(s, t, { Account__c: record });
    const { fields } = await lib.api.call(s, `/ui-api/records/${record}?fields=Account.Name`);
    const r = await lib.assert.fieldValue(s, id, 'Account__c', fields.Name.value, { via: 'ui' });
    assert.equal(r.ui, fields.Name.value);
  });

  // A route sets a lookup by record name, so the API side must accept that name, not only the stored Id.
  await t.test('assert.fieldValue accepts a lookup by record name through the API', async () => {
    const id = await probe(s, t, { Account__c: record });
    const { fields } = await lib.api.call(s, `/ui-api/records/${record}?fields=Account.Name`);
    const r = await lib.assert.fieldValue(s, id, 'Account__c', fields.Name.value, { via: 'api' });
    assert.equal(r.api, record);
    await assert.rejects(lib.assert.fieldValue(s, id, 'Account__c', 'Not That Account', { via: 'api' }), (e) => e.code === 'FIELD_VALUE_MISMATCH');
  });

  // A Dynamic Forms page has no layout items; each field sits in an element named by its API name.
  await t.test('assert.fieldValue reads a field on a Dynamic Forms page', async () => {
    const id = await rec(s, t, 'SfUiDyn__c', { Name: `sf-ui dyn ${stamp()}`, Note__c: 'dyn note' });
    const r = await lib.assert.fieldValue(s, id, 'Note__c', 'dyn note', { via: 'ui' });
    assert.equal(r.ui, 'dyn note');
  });

  // Probe__c is on the Dynamic Forms page and not on the page layout, so the View model lacks it.
  await t.test('assert.fieldValue reads a Dynamic Forms field the page layout lacks', async () => {
    const name = `SWB probe ${stamp()}`;
    const target = await probe(s, t, { Name: name });
    const id = await rec(s, t, 'SfUiDyn__c', { Name: `SWB dyn ${stamp()}`, Probe__c: target });
    const r = await lib.assert.fieldValue(s, id, 'Probe__c', name);
    assert.deepEqual([r.api, r.ui], [target, name]);
    await assert.rejects(lib.assert.fieldValue(s, id, 'Probe__c', 'Not That Probe', { via: 'ui' }), { code: 'FIELD_VALUE_MISMATCH' });
  });

  // F-cascade-32: the first load after the user collapses a section shows it open, then closes it a moment later.
  await t.test('assert.fieldValue via ui is FIELD_NOT_SHOWN on the first load after the user collapses the section', async (st) => {
    const id = await rec(s, t, 'SfUiC_Field__c', { Name: `BREAK fix collapse ${stamp()}`, Memo__c: 'BREAK fix memo' })
      .catch((e) => { if (e.evidence?.status === 404) return null; throw e; });
    if (!id) return st.skip('the org has no test/fixture-components object SfUiC_Field__c');
    const memo = () => lib.assert.fieldValue(s, id, 'Memo__c', 'BREAK fix memo', { via: 'ui' });
    const toggle = s.page.locator('records-record-layout-section').filter({ has: s.page.locator(`${A.layoutItem}[field-label="Memo"]`) })
      .locator('button[aria-expanded]').first();
    // A first load after a toggle can still flip the section, and the click saves a moment later (both measured).
    const click = async (to) => {
      await s.page.waitForTimeout(1_000);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), to);
      await s.page.waitForTimeout(3_000);
    };
    // The admin's preference outlives the test: open the section on a settled page, before and after.
    const open = async () => {
      await lib.nav.openRecord(s, id);
      await toggle.waitFor();
      await s.page.waitForTimeout(1_000);
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await click('true');
    };
    await open();
    assert.equal((await memo()).ui, 'BREAK fix memo'); // control: the section is open
    // The browser caches the open section some seconds after a session's first loads; only then does the next load
    // show it stale. Measured: a collapse 3.5 s after the second load did not reproduce, 8 s did (3 of 3).
    await s.page.waitForTimeout(8_000);
    await click('false');
    try {
      await assert.rejects(memo(), (e) => e.code === 'FIELD_NOT_SHOWN' && e.evidence.hidden === true);
    } finally {
      await open();
    }
    assert.equal((await memo()).ui, 'BREAK fix memo'); // control: open again, read again
  });

  // F-cascade-5, F-flow-15: the page shows 12,345 and 25%; the API holds 12345 and 25 with no display value.
  await t.test('assert.fieldValue passes a Number of 1,000 or more and a Percent as the number, via api, ui and both', async (st) => {
    const id = await probe(s, t, { Name: `BREAK fix number ${stamp()}`, Count__c: 12345 });
    for (const via of ['api', 'ui', 'both']) {
      for (const v of [12345, '12,345']) await lib.assert.fieldValue(s, id, 'Count__c', v, { via });
      await assert.rejects(lib.assert.fieldValue(s, id, 'Count__c', 12346, { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
    assert.equal((await lib.assert.fieldValue(s, id, 'Count__c', 12345)).ui, '12,345', 'the page groups the digits');
    const pct = await rec(s, t, 'SfUiC_Field__c', { Name: `BREAK fix pct ${stamp()}` })
      .catch((e) => { if (e.evidence?.status === 404) return null; throw e; });
    if (!pct) return st.skip('the org has no test/fixture-components object SfUiC_Field__c');
    for (const via of ['api', 'ui', 'both']) {
      for (const v of [25, '25%']) await lib.assert.fieldValue(s, pct, 'F_Pct__c', v, { via });
      await assert.rejects(lib.assert.fieldValue(s, pct, 'F_Pct__c', 26, { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
  });

  // F-cascade-2: a UI save stores a Text Area with CRLF line ends; the page shows its blank line and a tab as a space.
  await t.test('assert.fieldValue passes a Text Area of several lines as typed, via api, ui and both', async (st) => {
    const id = await rec(s, t, 'SfUiC_Field__c', { Name: `BREAK fix lines ${stamp()}`, Memo__c: 'line one\r\n\r\nline three', Long__c: 'lead\ttab\r\nsecond' })
      .catch((e) => { if (e.evidence?.status === 404) return null; throw e; });
    if (!id) return st.skip('the org has no test/fixture-components object SfUiC_Field__c');
    for (const via of ['api', 'ui', 'both']) {
      await lib.assert.fieldValue(s, id, 'Memo__c', 'line one\n\nline three', { via });
      await lib.assert.fieldValue(s, id, 'Long__c', 'lead\ttab\nsecond', { via });
      // Control: a lost blank line, or a line break typed as a space, is still red.
      await assert.rejects(lib.assert.fieldValue(s, id, 'Memo__c', 'line one\nline three', { via }), { code: 'FIELD_VALUE_MISMATCH' });
      await assert.rejects(lib.assert.fieldValue(s, id, 'Long__c', 'lead\ttab second', { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
  });

  // F-cascade-6: a field with help text shows a "Help <label>" button; the page side read it as part of the value.
  await t.test('assert.fieldValue reads a field with help text without its help button, via ui and both', async (st) => {
    const email = `break.fix.${stamp()}@sfuic.example`.toLowerCase();
    const id = await rec(s, t, 'SfUiC_Field__c', { Name: `BREAK fix help ${stamp()}`, Email__c: email, Flagged__c: true, Tone__c: 'Calm' })
      .catch((e) => { if (e.evidence?.status === 404) return null; throw e; });
    if (!id) return st.skip('the org has no test/fixture-components object SfUiC_Field__c');
    const ref = (await lib.assert.fieldValue(s, id, 'Ref__c', 'x', { via: 'api' }).catch((e) => e.evidence)).api;
    for (const via of ['ui', 'both']) {
      assert.equal((await lib.assert.fieldValue(s, id, 'Email__c', email, { via })).ui, email);
      await lib.assert.fieldValue(s, id, 'Flagged__c', true, { via });
      await lib.assert.fieldValue(s, id, 'Tone__c', 'Calm', { via });
      await lib.assert.fieldValue(s, id, 'Ref__c', ref, { via });
      // Control: a wrong value is still red.
      await assert.rejects(lib.assert.fieldValue(s, id, 'Tone__c', 'Bright', { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
  });

  // F-cascade-7: the Owner item also holds Change Owner, the Created By item a date; a custom object's Owner is
  // polymorphic and had no API display value. The Account is the standard-object shape of the same finding.
  await t.test('assert.fieldValue reads Owner and Created By as the user\'s name, by name and by id, via ui and both', async (st) => {
    const custom = await rec(s, t, 'SfUiC_Field__c', { Name: `BREAK fix owner ${stamp()}` })
      .catch((e) => { if (e.evidence?.status === 404) return null; throw e; });
    if (!custom) return st.skip('the org has no test/fixture-components object SfUiC_Field__c');
    for (const [obj, id, fields] of [['SfUiC_Field__c', custom, ['OwnerId', 'CreatedById']], ['Account', record, ['OwnerId']]]) {
      const q = `SELECT OwnerId, Owner.Name, CreatedById, CreatedBy.Name FROM ${obj} WHERE Id = '${id}'`;
      const [row] = (await lib.api.call(s, `/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records;
      for (const f of fields) {
        const [uid, name] = f === 'OwnerId' ? [row.OwnerId, row.Owner.Name] : [row.CreatedById, row.CreatedBy.Name];
        assert.equal((await lib.assert.fieldValue(s, id, f, name, { via: 'ui' })).ui, name, `${obj}.${f}`);
        for (const want of [name, uid]) await lib.assert.fieldValue(s, id, f, want, { via: 'both' });
        // Control: another name is still red on the page.
        await assert.rejects(lib.assert.fieldValue(s, id, f, 'Not That User', { via: 'ui' }), { code: 'FIELD_VALUE_MISMATCH' });
      }
    }
  });

  // F-cascade-11: a part of the standard Billing Address, and of the custom Address Site__c that SfUiC_App's Dynamic
  // Forms page places, is read inside the one Address item the page shows. Last: it leaves SfUiC_App open.
  await t.test('assert.fieldValue reads a part of a standard and a custom Address, via ui and both', async (st) => {
    const acct = await account(s, t, { Name: `BREAK fix address ${stamp()}`, BillingStreet: '2 Break St\nSuite 9', BillingCity: 'Oakland', BillingState: 'CA', BillingPostalCode: '94607' });
    const app = await lib.session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
    const place = app && await rec(s, t, 'SfUiC_Place__c', { Name: `BREAK fix place ${stamp()}`, Site__Street__s: '2 Break Street', Site__City__s: 'Oakland' });
    for (const via of ['ui', 'both']) {
      await lib.assert.fieldValue(s, acct, 'BillingCity', 'Oakland', { via });
      await lib.assert.fieldValue(s, acct, 'BillingStreet', '2 Break St\nSuite 9', { via });
      await lib.assert.fieldValue(s, acct, 'BillingPostalCode', '94607', { via });
      // Control: a city the Address does not hold is red, with the Address text as the page side.
      await assert.rejects(lib.assert.fieldValue(s, acct, 'BillingCity', 'Berkeley', { via }), (e) => e.code === 'FIELD_VALUE_MISMATCH' && /Oakland/.test(e.evidence.ui));
      if (!place) continue;
      await lib.assert.fieldValue(s, place, 'Site__City__s', 'Oakland', { via });
      await assert.rejects(lib.assert.fieldValue(s, place, 'Site__City__s', 'Berkeley', { via }), { code: 'FIELD_VALUE_MISMATCH' });
    }
    if (!place) st.skip('the org has no test/fixture-components app SfUiC_App: the custom Address half did not run');
  });
});
