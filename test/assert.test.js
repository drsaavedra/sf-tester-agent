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

// No org: a field only a Dynamic Forms page places is not in the layout's View model; the page is still read.
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

test('assert', { skip, timeout: 300_000 }, async (t) => {
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
});
