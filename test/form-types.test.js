'use strict';

// form.setFields on every control type the fixture's probe object carries: each value is read back through the
// API, so a fill that the form ignored or reformatted comes out red. Records are created here and deleted after.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, form, api, nav, discover } = require('..');
const { auth, env, skip, record, account, probe, stamp } = require('./helpers');
const A = require('../src/anchors');

// No org: a page whose fetches answer a tick later, so the test sees which UI API calls were in flight together.
test('formModel, no org: object-info waits alone only for a New form with no type chosen', async () => {
  const model = async (recordId, opts) => {
    const seen = [];
    let open = 0;
    const answer = { records: { recordTypeId: '012A' }, layout: { id: 'L', sections: [] }, 'object-info': { fields: {}, recordTypeInfos: { a: { available: true, master: false, recordTypeId: '012ONLY' } } } };
    const page = { evaluate: async (_, { url }) => {
      const kind = url.split('/')[5].split('?')[0];
      open += 1;
      seen.push(`${kind}${open > 1 ? ' with another' : ''}`);
      await new Promise((r) => setImmediate(r));
      open -= 1;
      return { status: 200, text: JSON.stringify(answer[kind]) };
    } };
    const out = await discover.formModel({ apiVersion: '60.0', keyPrefixes: { a01: 'X__c' }, page }, recordId, opts);
    return { seen, recordTypeId: out.recordTypeId };
  };
  assert.deepEqual(await model('a01000000000001', { mode: 'Edit' }), { seen: ['records', 'layout', 'object-info with another'], recordTypeId: '012A' });
  assert.deepEqual(await model(null, { mode: 'Create', objectApiName: 'X__c', recordTypeId: '012B' }), { seen: ['layout', 'object-info with another'], recordTypeId: '012B' });
  assert.deepEqual(await model(null, { mode: 'Create', objectApiName: 'X__c' }), { seen: ['object-info', 'layout'], recordTypeId: '012ONLY' }, 'object-info once, first');
});

// F-tz-2: save's read-back compares the whole instant, so a value stored a few seconds short is not "checked".
test('stored, no org: a datetime compares to the millisecond', () => {
  assert.equal(form.stored('DateTime', '2027-12-31T23:59:59Z', { value: '2027-12-31T23:59:00.000+0000' }), false);
  assert.equal(form.stored('DateTime', '2027-12-31T23:59:00Z', { value: '2027-12-31T23:59:00.000+0000' }), true);
});

// F-tz-3: Date.parse rolls a day past a month's end (Feb 30 is Mar 2) and T24:00 to the next day; neither is typed.
test('wallTime and isoDate, no org: a date not on the calendar is refused, not rolled', () => {
  const field = { apiName: 'At__c' };
  for (const v of ['2027-02-30T10:00:00Z', '2027-04-31T10:00:00Z', '2027-01-01T24:00:00Z', '2027-02-29T08:00:00+08:00']) {
    assert.throws(() => form.wallTime(field, v, 'UTC'), { code: 'INVALID_VALUE' }, v);
  }
  for (const v of ['2027-02-30', '2027-04-31', '2027-13-01']) assert.throws(() => form.isoDate(field, v), { code: 'INVALID_VALUE' }, v);
  // control: a leap day, 23:59 and an offset still read
  assert.deepEqual(form.wallTime(field, '2028-02-29T23:59:00Z', 'UTC'), { y: 2028, m: 2, d: 29, H: 23, min: 59 });
  assert.deepEqual(form.wallTime(field, '2027-03-01T08:30:00+08:00', 'UTC'), { y: 2027, m: 3, d: 1, H: 0, min: 30 });
  assert.deepEqual(form.isoDate(field, '2028-02-29'), { y: 2028, m: 2, d: 29 });
});

test('stored, no org: a datetime not on the calendar is not the instant it rolls to', () => {
  assert.equal(form.stored('DateTime', '2027-02-30T10:00:00Z', { value: '2027-03-02T10:00:00.000+0000' }), false);
  assert.equal(form.stored('DateTime', '2027-03-02T10:00:00Z', { value: '2027-03-02T10:00:00.000+0000' }), true); // control
});

// F-tz-5: an instant on an all-day Event saves the wall date, a day early west of UTC, so it is refused unopened.
test('setFields, no org: an all-day Event refuses Start or End as an instant', async () => {
  const closed = {}; // no page: anything that reaches the form fails some other way
  for (const k of ['StartDateTime', 'EndDateTime']) {
    await assert.rejects(form.setFields(closed, { [k]: '2027-06-01T00:00:00Z', IsAllDayEvent: true }), { code: 'INVALID_VALUE' }, k);
  }
  await assert.rejects(form.setFields(closed, { IsAllDayEvent: 'true', StartDateTime: '2027-06-01T00:00:00Z' }), { code: 'INVALID_VALUE' });
  // control: a timed Event is not refused here, it reaches the form
  await assert.rejects(form.setFields(closed, { StartDateTime: '2027-06-01T00:00:00Z', IsAllDayEvent: false }), (e) => e.code !== 'INVALID_VALUE');
});

test('form types',{ skip, timeout: 600_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const read = async (id, ...fields) => {
    const r = (await api.call(s, `/ui-api/records/${id}?fields=${fields.map((f) => `SfUiProbe__c.${f}`).join(',')}`)).fields;
    return fields.map((f) => r[f].value);
  };
  const id = await probe(s, t, { Kind__c: 'Fruit', Detail__c: 'Apple' });
  const save = async (values) => {
    const f = await form.editRecord(s, id);
    await form.setFields(f, values);
    assert.equal((await form.save(f)).outcome, 'saved');
  };

  // A lookup searches the index, which takes a while to see a new record; SOSL reserves "-", so no hyphens.
  const names = [`sfui parent ${stamp()}a`, `sfui parent ${stamp()}b`];
  const parents = [await account(s, t, { Name: names[0] }), await account(s, t, { Name: names[1] })];
  const indexed = async (name) => {
    const q = `FIND {"${name}"} IN NAME FIELDS RETURNING Account(Id)`;
    for (const end = Date.now() + 120_000; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
      if ((await api.call(s, `/search/?q=${encodeURIComponent(q)}`, { as: 'admin' })).searchRecords.length) return;
    }
    throw new Error(`${name} never reached the search index`);
  };

  // The fixture layout orders Edit fourth, so the highlights panel puts it under "Show more actions".
  await t.test('editRecord opens the form when Edit sits in the overflow menu', async () => {
    await nav.openRecord(s, id);
    await s.page.locator(A.highlights).getByRole('button', { name: 'Show more actions' }).waitFor();
    assert.equal(await s.page.locator(A.highlights).getByRole('button', { name: 'Edit', exact: true }).count(), 0, 'Edit is not a visible button');
    const f = await form.editRecord(s, id);
    assert.equal(await f.scope.isVisible(), true);
    await form.cancel(f);
  });

  await t.test('the edit form shows every editable field, the grouped controls included', async () => {
    const f = await form.editRecord(s, id);
    assert.deepEqual(f.missing, []);
    await form.cancel(f);
  });

  await t.test('a lookup is set by record name, replaced, and cleared', async () => {
    for (const name of names) await indexed(name);
    for (const [i, name] of names.entries()) {
      await save({ Account__c: name });
      assert.deepEqual(await read(id, 'Account__c'), [parents[i]]);
    }
    await save({ Account__c: '' });
    assert.deepEqual(await read(id, 'Account__c'), [null]);
  });

  await t.test('a lookup with no matching record fails with the options it saw', async () => {
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { Account__c: 'zz no such account zz' }), { code: 'VALUE_NOT_FOUND' });
    await form.cancel(f);
  });

  // Day 4 of month 3, so a day/month swap reads back as April 3.
  await t.test('a date is given as ISO and typed in the user\'s date format', async () => {
    await save({ Due__c: '2026-03-04' });
    assert.deepEqual(await read(id, 'Due__c'), ['2026-03-04']);
  });

  await t.test('an empty date clears the field', async () => {
    await save({ Due__c: '2026-03-04' });
    await save({ Due__c: '' });
    assert.deepEqual(await read(id, 'Due__c'), [null]);
  });

  await t.test('a date that is not ISO is refused before typing', async () => {
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { Due__c: '3/4/2026' }), { code: 'INVALID_VALUE' });
    await form.cancel(f);
  });

  // Only discriminating when the user's wall clock is not UTC at that instant, so that is checked first.
  await t.test('a datetime is given as an ISO instant and typed as the user\'s wall time', async () => {
    const tz = await s.page.evaluate(() => $A.get('$Locale.timezone'));
    const wall = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric' }).format(Date.parse('2026-11-02T06:37:00Z'));
    assert.notEqual(Number(wall), 6, `the user timezone ${tz} shows 06:37Z as 06:37, so this test could not go red`);
    await save({ At__c: '2026-11-02T06:37:00.000Z' });
    assert.equal(new Date((await read(id, 'At__c'))[0]).toISOString(), '2026-11-02T06:37:00.000Z');
  });

  await t.test('a datetime without a zone is refused before typing', async () => {
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { At__c: '2026-11-02T06:37' }), { code: 'INVALID_VALUE' });
    await form.cancel(f);
  });

  // F-cascade-27: the wall time of the hour a zone repeats names two instants, and the form saves the later one.
  await t.test('a datetime in the first pass of a repeated hour is VALUE_NOT_SET before typing; its twin is typed', async (st) => {
    const f = await form.editRecord(s, id);
    const tz = await s.page.evaluate(() => $A.get('$Locale.timezone'));
    const offset = (t) => {
      const w = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t).map((x) => [x.type, +x.value]));
      return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - t;
    };
    let end = Date.UTC(2027, 0, 1); // the first minute after the clocks go back in 2027
    while (end < Date.UTC(2028, 0, 1) && offset(end) >= offset(end - 3_600_000)) end += 3_600_000;
    if (end >= Date.UTC(2028, 0, 1)) { await form.cancel(f); return st.skip(`the user timezone ${tz} repeats no hour in 2027`); }
    for (let m = end - 3_600_000; m < end; m += 60_000) if (offset(m) < offset(end - 3_600_000)) { end = m; break; }
    const back = offset(end - 60_000) - offset(end), iso = (t) => new Date(t).toISOString();
    await assert.rejects(form.setFields(f, { At__c: iso(end - back / 2) }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.saves === iso(end + back / 2), `${tz} at ${iso(end - back / 2)}`);
    await form.setFields(f, { At__c: iso(end + back / 2) }); // controls: the twin, and the minute before the hour
    await form.setFields(f, { At__c: iso(end - back - 60_000) });
    await form.cancel(f);
  });

  // F-tz-2: the form keeps minutes, so seconds are refused rather than saved short, on an edit and on a create.
  await t.test('a datetime with seconds is refused before typing, on an edit and on a create', async () => {
    for (const open of [() => form.editRecord(s, id), () => form.createRecord(s, 'SfUiProbe__c')]) {
      const f = await open();
      await assert.rejects(form.setFields(f, { At__c: '2027-12-31T23:59:59Z' }), { code: 'INVALID_VALUE' });
      await form.cancel(f);
    }
  });

  // A Time field is wall-clock time with no zone: 14:37 is typed as the user reads it and stored as 14:37.
  await t.test('a time is given as HH:mm and typed in the user\'s time format', async () => {
    await save({ Start__c: '14:37' });
    assert.deepEqual(await read(id, 'Start__c'), ['14:37:00.000Z']);
  });

  await t.test('a morning time is stored as given, and an empty time clears the field', async () => {
    await save({ Start__c: '09:05' });
    assert.deepEqual(await read(id, 'Start__c'), ['09:05:00.000Z']);
    await save({ Start__c: '' });
    assert.deepEqual(await read(id, 'Start__c'), [null]);
  });

  await t.test('a time that is not HH:mm, or out of range, is refused before typing', async () => {
    const f = await form.editRecord(s, id);
    for (const bad of ['2pm', '25:30', '14:37:59']) await assert.rejects(form.setFields(f, { Start__c: bad }), { code: 'INVALID_VALUE' }, bad);
    await form.cancel(f);
  });

  // Tags is required, so its group is named "requiredTags" and Chosen may never go empty.
  await t.test('a multi-select picklist ends with exactly the values given', async () => {
    for (const [given, expected] of [['Beta;Gamma', ['Beta', 'Gamma']], ['Gamma', ['Gamma']]]) {
      await save({ Tags__c: given });
      assert.deepEqual((await read(id, 'Tags__c'))[0].split(';').sort(), expected);
    }
  });

  await t.test('a multi-select value that is not offered fails with the options it saw', async () => {
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { Tags__c: 'Beta;Omega' }), { code: 'VALUE_NOT_FOUND' });
    await form.cancel(f);
  });

  // Saw is not valid under the record's Fruit, so the dependent given first must still be set second.
  await t.test('a dependent picklist is set after its controller whatever the order given', async () => {
    await save({ Detail__c: 'Saw', Kind__c: 'Tool' });
    assert.deepEqual(await read(id, 'Kind__c', 'Detail__c'), ['Tool', 'Saw']);
  });

  await t.test('a dependent value its controller does not allow fails fast with the options it saw', async () => {
    const f = await form.editRecord(s, id);
    const started = Date.now();
    await assert.rejects(form.setFields(f, { Kind__c: 'Fruit', Detail__c: 'Hammer' }),
      (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.includes('Apple'));
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
    await form.cancel(f);
  });

  // A field the model lists but the form does not show (a visibility rule, drift) is reported, not waited on.
  await t.test('setFields on a modelled field the form does not show throws FIELD_NOT_SHOWN', async () => {
    const f = await form.editRecord(s, id);
    await f.scope.getByRole('spinbutton', { name: 'Count', exact: true }).evaluate((el) => { el.closest('lightning-input, div').style.display = 'none'; });
    const started = Date.now();
    await assert.rejects(form.setFields(f, { Count__c: 5 }), { code: 'FIELD_NOT_SHOWN' });
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
    await form.cancel(f);
  });

  await t.test('a checkbox and a number are set and read back', async () => {
    await save({ Done__c: true, Count__c: 7 });
    assert.deepEqual(await read(id, 'Done__c', 'Count__c'), [true, 7]);
  });

  // The MCP schema lets an agent send "false" as text, which Boolean() would read as true.
  await t.test('a checkbox given "false" as text is unticked, and a value that is not a boolean is refused', async () => {
    await save({ Done__c: true });
    await save({ Done__c: 'false' });
    assert.deepEqual(await read(id, 'Done__c'), [false]);
    const f = await form.editRecord(s, id);
    await assert.rejects(form.setFields(f, { Done__c: 'yes' }), { code: 'INVALID_VALUE' });
    await form.cancel(f);
  });

  // Inline edit: the pencil on a view field turns the detail panel into a form with a footer Save, no dialog.
  await t.test('editInline opens the detail panel form from a field pencil, and save stores the values', async () => {
    const f = await form.editInline(s, id, 'Due__c');
    assert.deepEqual(f.missing, []);
    await form.setFields(f, { Due__c: '2026-05-06', Count__c: 11 });
    const r = await form.save(f);
    assert.equal(r.outcome, 'saved', JSON.stringify(r));
    assert.deepEqual(await read(id, 'Due__c', 'Count__c'), ['2026-05-06', 11]);
    assert.equal(await s.page.getByRole('button', { name: 'Save', exact: true }).count(), 0, 'the panel left edit mode');
  });

  await t.test('a blocked inline save reports the field, and cancel leaves edit mode', async () => {
    const f = await form.editInline(s, id, 'Name');
    await form.setFields(f, { Name: '' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'blocked');
    assert.ok(r.fieldErrors.find((e) => e.apiName === 'Name' && /Complete this field/.test(e.message)), JSON.stringify(r.fieldErrors));
    await form.cancel(f);
    assert.equal(await s.page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
  });

  // New opens the same kind of dialog as Edit, from the Create layout; a saved create reports the new record's id.
  await t.test('createRecord opens the New dialog, and save stores the record and returns its id', async () => {
    const name = `sfui created ${stamp()}`;
    const f = await form.createRecord(s, 'SfUiProbe__c');
    assert.deepEqual(f.missing, []);
    await form.setFields(f, { Name: name, Tags__c: 'Beta', Due__c: '2026-07-08' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'saved', JSON.stringify(r));
    t.after(() => api.call(s, `/sobjects/SfUiProbe__c/${r.recordId}`, { method: 'DELETE', as: 'admin' }));
    assert.deepEqual(await read(r.recordId, 'Name', 'Due__c'), [name, '2026-07-08']);
  });

  // SF UI Typed has two record types: New asks which first. Grade C is a value only Beta Type offers.
  await t.test('createRecord picks the record type it is given, and refuses to guess one', async () => {
    await assert.rejects(form.createRecord(s, 'SfUiTyped__c'), (e) => e.code === 'RECORD_TYPE_REQUIRED' && e.evidence.recordTypes.join() === 'Alpha Type,Beta Type');
    const alpha = await form.createRecord(s, 'SfUiTyped__c', { recordType: 'Alpha Type' });
    await assert.rejects(form.setFields(alpha, { Grade__c: 'C' }), { code: 'VALUE_NOT_FOUND' }); // the control
    await form.cancel(alpha);
    const name = `sfui typed ${stamp()}`;
    const f = await form.createRecord(s, 'SfUiTyped__c', { recordType: 'Beta Type' });
    await form.setFields(f, { Name: name, Grade__c: 'C' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'saved', JSON.stringify(r));
    t.after(() => api.call(s, `/sobjects/SfUiTyped__c/${r.recordId}`, { method: 'DELETE', as: 'admin' }));
    const got = await api.call(s, `/sobjects/SfUiTyped__c/${r.recordId}?fields=Name,Grade__c,RecordType.Name`, { as: 'admin' });
    assert.deepEqual([got.Name, got.Grade__c, got.RecordType?.Name], [name, 'C', 'Beta Type']);
    await assert.rejects(form.createRecord(s, 'SfUiTyped__c', { recordType: 'Gamma Type' }), { code: 'VALUE_NOT_FOUND' });
  });

  // The persona, given SfUi_Typed_One, sees Alpha Type only; its profile gives Alpha its own layout.
  await t.test('createRecord with one record type skips the picker and models that type\'s layout', async (st) => {
    const persona = await auth(env.user);
    const userId = (await (await fetch(`${persona.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${persona.accessToken}` } })).json()).user_id;
    const [ps] = (await api.call(s, `/query?q=${encodeURIComponent("SELECT Id FROM PermissionSet WHERE Name = 'SfUi_Typed_One'")}`, { as: 'admin' })).records;
    if (!ps) throw new Error('SfUi_Typed_One is not deployed; deploy test/fixture first');
    await record(s, st, 'PermissionSetAssignment', { AssigneeId: userId, PermissionSetId: ps.Id });
    const p = await session.start(persona);
    st.after(() => session.end(p));
    const types = Object.values((await api.call(p, '/ui-api/object-info/SfUiTyped__c')).recordTypeInfos).filter((r) => r.available && !r.master);
    assert.deepEqual(types.map((r) => r.name), ['Alpha Type'], 'the control: one type for this user');
    const f = await form.createRecord(p, 'SfUiTyped__c');
    assert.equal(await p.page.getByRole('button', { name: 'Next', exact: true }).count(), 0, 'no record type picker');
    assert.equal(await f.scope.getByText('Alpha Information', { exact: true }).count(), 1, 'the dialog is Alpha\'s layout');
    assert.deepEqual([f.model.recordTypeId, [...new Set(f.model.fields.map((x) => x.section))]], [types[0].recordTypeId, ['Alpha Information']]);
    await form.cancel(f);
    // sf_form_model's New form, with no page opened, names the same type.
    const m = await discover.formModel(p, null, { mode: 'Create', objectApiName: 'SfUiTyped__c' });
    assert.deepEqual([m.recordTypeId, [...new Set(m.fields.map((x) => x.section))]], [types[0].recordTypeId, ['Alpha Information']]);
  });

  await t.test('a blocked create reports the missing required field', async () => {
    const f = await form.createRecord(s, 'SfUiProbe__c');
    await form.setFields(f, { Tags__c: 'Beta' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'blocked');
    assert.ok(r.fieldErrors.find((e) => e.apiName === 'Name'), JSON.stringify(r.fieldErrors));
    await form.cancel(f);
  });

  // A multi-select's error has no aria-describedby, and a rule's error carries a hidden copy of the label.
  await t.test('a blocked save reads each field error as the page shows it', async () => {
    for (const [values, apiName, message] of [[{ Name: `sf-ui err ${stamp()}` }, 'Tags__c', 'An option must be selected'],
      [{ Name: `sf-ui err ${stamp()}`, Tags__c: 'Alpha', Count__c: -1 }, 'Count__c', 'Count cannot be negative']]) {
      const f = await form.createRecord(s, 'SfUiProbe__c');
      await form.setFields(f, values);
      const r = await form.save(f);
      assert.equal(r.outcome, 'blocked', JSON.stringify(r));
      assert.equal(r.fieldErrors.find((e) => e.apiName === apiName)?.message, message, JSON.stringify(r.fieldErrors));
      await form.cancel(f);
    }
  });
});
