'use strict';

// form.editRecord, setFields and save on a real Account. The blocked save (required name cleared) is the
// control that proves save can come out red; the good save flips Rating so the value must actually change.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, form, api, nav, act, modal } = require('..');
const { auth, env, skip, account, probe, stamp } = require('./helpers');
const { SfUiError } = require('../src/errors');

test('form', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const record = await account(s, t);
  const rating = async () => (await api.call(s, `/ui-api/records/${record}?fields=Account.Rating`)).fields.Rating.value;

  await t.test('editRecord opens the form with every editable model field present', async () => {
    const f = await form.editRecord(s, record);
    assert.deepEqual(f.missing, []);
    assert.ok(f.model.fields.filter((x) => x.editable).length > 10);
    await form.cancel(f);
  });

  await t.test('setFields refuses a field that is not on the form', async () => {
    const f = await form.editRecord(s, record);
    await assert.rejects(form.setFields(f, { NoSuchField__c: 'x' }), { code: 'FIELD_NOT_ON_FORM' });
    await form.cancel(f);
  });

  // The standard form sets maxlength (Account Number, 40), so a longer value lands cut, and the read-back says so.
  await t.test('setFields refuses a value the form cut to its maxlength', async () => {
    const f = await form.editRecord(s, record);
    await assert.rejects(form.setFields(f, { AccountNumber: 'A'.repeat(50) }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === 'A'.repeat(40));
    await form.cancel(f);
  });

  // An address is one layout item: its pencil is "Edit Billing Address", not the part's label.
  await t.test('editInline reaches a part of a compound field through the item\'s pencil', async () => {
    const f = await form.editInline(s, record, 'BillingCity');
    const city = `Lyon ${Date.now() % 1000}`;
    await form.setFields(f, { BillingCity: city });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.equal((await api.call(s, `/ui-api/records/${record}?fields=Account.BillingCity`)).fields.BillingCity.value, city);
  });

  // Any navigation closes the dialog; the form object must say so instead of filling nothing for 30 s.
  await t.test('setFields and save on a form that navigation closed throw FORM_CLOSED at once', async () => {
    const f = await form.editRecord(s, record);
    await nav.openRecord(s, record);
    const started = Date.now();
    await assert.rejects(form.setFields(f, { Phone: '1' }), { code: 'FORM_CLOSED' });
    await assert.rejects(form.save(f), { code: 'FORM_CLOSED' });
    await form.cancel(f); // nothing left to cancel: returns at once
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  });

  await t.test('save reports a blocked save with the field and its message', async () => {
    const f = await form.editRecord(s, record);
    await form.setFields(f, { Name: '' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'blocked');
    const nameError = r.fieldErrors.find((e) => e.apiName === 'Name');
    assert.ok(nameError, JSON.stringify(r.fieldErrors));
    assert.match(nameError.message, /Complete this field/);
    await form.cancel(f);
  });

  await t.test('save stores a picklist and a text value and reports the success toast', async () => {
    const next = (await rating()) === 'Hot' ? 'Warm' : 'Hot';
    const phone = `+1 555 ${String(Date.now()).slice(-7)}`;
    const f = await form.editRecord(s, record);
    await form.setFields(f, { Rating: next, Phone: phone });
    const r = await form.save(f);
    assert.equal(r.outcome, 'saved', JSON.stringify(r));
    assert.equal(r.toasts.at(-1).type, 'success');
    assert.equal(await rating(), next);
    assert.equal((await api.call(s, `/ui-api/records/${record}?fields=Account.Phone`)).fields.Phone.value, phone);
  });

  // Two tabs of one user: the stale save opens Salesforce's own conflict dialog, which also has a Save button.
  await t.test('a save that another save overtook reports conflict instead of throwing', async () => {
    const id = await probe(s, t, { Count__c: 1 });
    const other = await session.start(await auth(env.org));
    t.after(() => session.end(other));
    const [mine, theirs] = [await form.editRecord(s, id), await form.editRecord(other, id)];
    await form.setFields(theirs, { Count__c: 8 });
    assert.equal((await form.save(theirs)).outcome, 'saved');
    await form.setFields(mine, { Count__c: 9 });
    const r = await form.save(mine);
    assert.equal(r.outcome, 'conflict', JSON.stringify(r).slice(0, 500));
    assert.match(r.snapshot, /values to keep/i);
    const count = async () => (await api.call(s, `/ui-api/records/${id}?fields=SfUiProbe__c.Count__c`)).fields.Count__c.value;
    assert.equal(await count(), 8, 'the stale save wrote nothing');
    // The way sf_save's description gives: Save in that dialog keeps Your Value. The edit dialog is no dialog while it
    // shows (measured on sfui-s4-map), so the wait is on the conflict dialog.
    await act.click(await modal.find(s), { name: 'Save' });
    await s.page.getByRole('dialog', { name: 'Choose values to keep' }).waitFor({ state: 'hidden', timeout: 15_000 });
    assert.equal(await count(), 9);
  });

  // A create's success toast can fire while its new record page loads, after the dialog has closed.
  await t.test('save after createRecord reports the create\'s success toast', async () => {
    const f = await form.createRecord(s, 'SfUiProbe__c');
    await form.setFields(f, { Name: `sfui toast ${stamp()}`, Tags__c: 'Beta' });
    const r = await form.save(f);
    assert.equal(r.outcome, 'saved', JSON.stringify(r));
    t.after(() => api.call(s, `/sobjects/SfUiProbe__c/${r.recordId}`, { method: 'DELETE', as: 'admin' }));
    assert.equal(r.toasts.at(-1)?.type, 'success', JSON.stringify(r.toasts));
  });

  // F-cascade-19: Save & New swaps a fresh New dialog in for the form, so cancel must not answer ok with it still up.
  await t.test('cancel after Save & New is FORM_CLOSED naming the New dialog still open', async () => {
    const f = await form.createRecord(s, 'SfUiProbe__c');
    const name = `BREAK fix sn ${stamp()}`;
    await form.setFields(f, { Name: name, Tags__c: 'Delta' });
    await f.scope.getByRole('button', { name: 'Save & New', exact: true }).click();
    await s.page.getByText(/was created/).first().waitFor({ timeout: 30_000 });
    t.after(async () => {
      const q = `SELECT Id FROM SfUiProbe__c WHERE Name = '${name}'`;
      for (const r of (await api.call(s, `/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records) await api.call(s, `/sobjects/SfUiProbe__c/${r.Id}`, { method: 'DELETE', as: 'admin' });
    });
    const next = s.page.getByRole('dialog').filter({ has: s.page.getByRole('button', { name: 'Save', exact: true }) });
    await next.first().waitFor({ timeout: 10_000 });
    await f.marked.first().waitFor({ state: 'detached', timeout: 15_000 }); // the old form lingers a moment: FORM_COVERED then
    await assert.rejects(form.cancel(f), (e) => e.code === 'FORM_CLOSED' && e.evidence.dialogs.some((d) => /^New /.test(d)));
    await next.first().getByRole('button', { name: 'Cancel', exact: true }).click();
    await next.first().waitFor({ state: 'hidden', timeout: 10_000 });
  });

  // The persona must hold the read-only probe permission set and not the full one, whatever the org had before.
  const persona = async (userId) => {
    const q = async (x) => (await api.call(s, `/query?q=${encodeURIComponent(x)}`, { as: 'admin' })).records;
    for (const a of await q(`SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSet.Name = 'SfUi_Probe'`)) {
      await api.call(s, `/sobjects/PermissionSetAssignment/${a.Id}`, { method: 'DELETE', as: 'admin' });
    }
    if (!(await q(`SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSet.Name = 'SfUi_Probe_Read'`)).length) {
      const [ps] = await q("SELECT Id FROM PermissionSet WHERE Name = 'SfUi_Probe_Read'");
      if (!ps) throw new Error('SfUi_Probe_Read is not deployed; deploy test/fixture first');
      await api.call(s, '/sobjects/PermissionSetAssignment', { method: 'POST', as: 'admin', body: { AssigneeId: userId, PermissionSetId: ps.Id } });
    }
  };

  // Last, because Login As switches the session: the persona holds SfUi_Probe_Read, so the page offers no Edit.
  await t.test('editRecord throws ACTION_NOT_AVAILABLE for a record the user can read but not edit', async () => {
    const readOnly = await probe(s, t);
    const target = await auth(env.user);
    const targetId = (await (await fetch(`${target.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${target.accessToken}` } })).json()).user_id;
    await persona(targetId);
    await session.loginAs(s, targetId);
    await nav.openRecord(s, readOnly); // the persona's first page load is not what the bound measures
    const started = Date.now();
    await assert.rejects(form.editRecord(s, readOnly), (e) => e.code === 'ACTION_NOT_AVAILABLE' && Array.isArray(e.evidence.seen));
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
    // The same persona cannot create probes either: refused from object-info before any page is opened.
    const before = Date.now();
    await assert.rejects(form.createRecord(s, 'SfUiProbe__c'), (e) => e.code === 'ACTION_NOT_AVAILABLE');
    assert.ok(Date.now() - before < 10_000, `took ${Date.now() - before} ms`);
  });

  // As the persona: in German, Lightning's own controls carry German names, which sf-ui cannot find.
  await t.test('editRecord throws UNSUPPORTED_LANGUAGE for a user whose language is not English', async () => {
    const target = await auth(env.user);
    const targetId = (await (await fetch(`${target.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${target.accessToken}` } })).json()).user_id;
    const language = (LanguageLocaleKey) => api.call(s, `/sobjects/User/${targetId}`, { method: 'PATCH', as: 'admin', body: { LanguageLocaleKey } });
    await language('de');
    t.after(() => language('en_US'));
    // Its own Login As unless already that user (a Login As session cannot start another), so it stands alone.
    if ((await session.whoAmI(s)).slice(0, 15) !== targetId.slice(0, 15)) await session.loginAs(s, targetId);
    await assert.rejects(form.editRecord(s, record), (e) => e.code === 'UNSUPPORTED_LANGUAGE' && e.evidence.lang === 'de');
    await assert.rejects(require('..').assert.fieldValue(s, record, 'Rating', 'Warm', { via: 'ui' }), (e) => e.code === 'UNSUPPORTED_LANGUAGE');
    // A refused open leaves the page on the record, so lwc.scope's reuse of the open page must refuse too.
    assert.match(s.page.url(), new RegExp(record.slice(0, 15)));
    await assert.rejects(require('..').lwc.scope(s, record, 'sfUiProbe'), (e) => e.code === 'UNSUPPORTED_LANGUAGE');
  });
});

// No org: createRecord on an object with no record types presses New on the object home, and fails when the home has none.
// A Task page is Aura: its header counts the overflow (Edit sits behind "Show 22 more actions") and its inline edit
// and Subject (a ComboBox) differ from an Account's.
test('form on a Task', { skip, timeout: 600_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const { record: own } = require('./helpers');
  const task = await own(s, t, 'Task', { Subject: `L11 form task ${stamp()}` });
  const subject = async () => (await api.call(s, `/sobjects/Task/${task}`, { as: 'admin' })).Subject;

  await t.test('editRecord opens a Task\'s Edit from its overflow and saves its Subject', async () => {
    const f = await form.editRecord(s, task);
    const value = `L11 edited ${stamp()}`;
    await form.setFields(f, { Subject: value });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.equal(await subject(), value);
  });

  // Name and Related To are Aura lookups: an id is picked by the id its option's component holds, before setFields returns.
  await t.test('setFields sets a Task\'s Name and Related To by name, then Name by id', async () => {
    const st = stamp();
    const acct = await own(s, t, 'Account', { Name: `L11 acct ${st}` });
    const [c1, c2] = [await own(s, t, 'Contact', { LastName: `L11 contact ${st}`, AccountId: acct }), await own(s, t, 'Contact', { LastName: `L11 contact b ${st}`, AccountId: acct })];
    const stored = async () => { const r = await api.call(s, `/sobjects/Task/${task}`, { as: 'admin' }); return [r.WhoId, r.WhatId]; };
    let f = await form.editRecord(s, task);
    await form.setFields(f, { WhoId: `L11 contact ${st}`, WhatId: `L11 acct ${st}` });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.deepEqual(await stored(), [c1, acct]);
    f = await form.editRecord(s, task);
    await form.setFields(f, { WhoId: c2 });
    assert.equal(f.set.WhoId.confirm, true, 'an Aura pick by id: the save reads the stored id back');
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.deepEqual(await stored(), [c2, acct]);
  });

  // The switcher: Name to a Lead (by id, then by name with objects), Related To to an Opportunity, on tasks of their own
  // (Salesforce refuses Related To on a task whose Name is a Lead).
  await t.test('setFields switches Name to Lead and Related To to Opportunity', async () => {
    const st = stamp();
    const acct = await own(s, t, 'Account', { Name: `L11 acct ${st}` });
    const [lead1, lead2] = [await own(s, t, 'Lead', { LastName: `L11 lead ${st}`, Company: 'L11 co' }), await own(s, t, 'Lead', { LastName: `L11 lead b ${st}`, Company: 'L11 co' })];
    const opp = await own(s, t, 'Opportunity', { Name: `L11 opp ${st}`, StageName: 'Prospecting', CloseDate: '2026-12-31', AccountId: acct });
    const [leadTask, oppTask] = [await own(s, t, 'Task', { Subject: `L11 lead task ${st}` }), await own(s, t, 'Task', { Subject: `L11 opp task ${st}` })];
    const read = async (id) => { const r = await api.call(s, `/sobjects/Task/${id}`, { as: 'admin' }); return [r.WhoId, r.WhatId]; };
    let f = await form.editRecord(s, leadTask);
    await form.setFields(f, { WhoId: lead1 });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.deepEqual(await read(leadTask), [lead1, null]);
    f = await form.editRecord(s, leadTask);
    await form.setFields(f, { WhoId: `L11 lead b ${st}` }, { objects: { WhoId: 'Lead' } });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.deepEqual(await read(leadTask), [lead2, null]);
    f = await form.editRecord(s, oppTask);
    await form.setFields(f, { WhatId: `L11 opp ${st}` }, { objects: { WhatId: 'Opportunity' } });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.deepEqual(await read(oppTask), [null, opp]);
  });

  await t.test('editInline edits a Task\'s Subject in its Aura detail panel', async () => {
    const f = await form.editInline(s, task, 'Subject');
    const value = `L11 inline ${stamp()}`;
    await form.setFields(f, { Subject: value });
    assert.equal((await form.save(f)).outcome, 'saved');
    assert.equal(await subject(), value);
  });

  // The delta-B's row 11: a Save click returns once it lands (38-43 ms with the save request held 7 s, sfui-s4-map),
  // so the 5 s click cap is never spent after it; a click that waited for the save would end TIMEOUT here.
  await t.test('a Save whose save request is held 7 s is saved, not TIMEOUT', async () => {
    const f = await form.editRecord(s, task);
    const value = `L11 held ${stamp()}`;
    await form.setFields(f, { Subject: value });
    let held = 0;
    const hold = async (route) => {
      if (!held && /saveRecord|RecordUi|updateRecord|save/i.test(decodeURIComponent(route.request().postData() || ''))) { held += 1; await new Promise((r) => { setTimeout(r, 7_000); }); }
      await route.continue().catch(() => {});
    };
    await s.page.route('**/aura?**', hold);
    try { assert.equal((await form.save(f)).outcome, 'saved'); } finally { await s.page.unroute('**/aura?**', hold); }
    assert.equal(held, 1, 'control: the save request was held');
    assert.equal(await subject(), value);
  });

  // Last, as it logs in as the platform user. Its rows are the admin's <a role=option>, but a record made seconds ago
  // is not searchable for it yet (none at 5 s, found at 42 s on sfui-s4-map), so the pick is retried until it shows.
  await t.test('setFields picks a Task\'s Name by name as the platform user', async () => {
    const st = stamp();
    const target = await auth(env.user);
    const userId = (await (await fetch(`${target.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${target.accessToken}` } })).json()).user_id;
    const acct = await own(s, t, 'Account', { Name: `L11 acct ${st}` });
    const con = await own(s, t, 'Contact', { LastName: `L11 user con ${st}`, AccountId: acct });
    const mine = await own(s, t, 'Task', { Subject: `L11 user task ${st}`, OwnerId: userId });
    await session.loginAs(s, userId);
    for (const end = Date.now() + 120_000; ;) {
      const f = await form.editRecord(s, mine);
      const e = await form.setFields(f, { WhoId: `L11 user con ${st}` }).then(() => null, (x) => x);
      if (!e) { assert.equal((await form.save(f)).outcome, 'saved'); break; }
      await form.cancel(f);
      if (e.code !== 'VALUE_NOT_FOUND' || Date.now() > end) throw e;
      await s.page.waitForTimeout(10_000);
    }
    assert.equal((await api.call(s, `/sobjects/Task/${mine}`, { as: 'admin' })).WhoId, con);
  });
});

test('createRecord presses New on the object home, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const s = { page, origin: 'http://127.0.0.1:1' }; // a goto to origin would fail: the form must come from the button
  t.mock.method(api, 'call', async () => ({ createable: true, recordTypeInfos: { master: { master: true, available: true, name: 'Master' } } }));
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  await page.setContent(`<main><button id="n" onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>')">New</button></main>`);
  const f = await form.createRecord(s, 'Plain__c');
  assert.equal(await page.getByRole('dialog').count(), 1, 'the dialog came from the New button');
  assert.deepEqual(f.missing, []);
});

// No org: a lookup that renders 300 ms after Save is waited for, not listed missing; a field that never renders is.
test('the form model waits briefly for a field that renders after Save, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async () => ({ createable: true, recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [
    { apiName: 'Probe__c', label: 'Probe', dataType: 'Reference', editable: true },
    { apiName: 'Gone__c', label: 'Gone', dataType: 'String', editable: true }] }));
  const late = `setTimeout(() => document.querySelector('[role=dialog]').insertAdjacentHTML('afterbegin', '<input role=combobox aria-label=Probe>'), 300)`;
  await page.setContent(`<main><button onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>'); ${late}">New</button></main>`);
  const f = await form.createRecord({ page }, 'Plain__c');
  assert.deepEqual(f.missing, ['Gone__c'], 'control: the field that never renders is still missing');
});

// No org: a home whose button is "New Task" presses it (no URL navigation); a home with no New button is ACTION_NOT_AVAILABLE.
test('createRecord presses New or New <label>, never opens by URL, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const s = { page, origin: 'http://127.0.0.1:1' }; // a goto to origin would fail: the form must come from the button
  const dialog = `onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>')"`;
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: { master: { master: true, available: true, name: 'Master' } } }));
  await page.setContent(`<main><button ${dialog}>New Task</button></main>`);
  await form.createRecord(s, 'Task', { timeout: 3_000 });
  assert.equal(await page.getByRole('dialog').count(), 1, 'the dialog came from the New Task button');
  await page.setContent(`<main><button ${dialog}>New Event</button></main>`);
  await assert.rejects(form.createRecord(s, 'Task', { timeout: 1_000 }), { code: 'ACTION_NOT_AVAILABLE' }); // another object's New is not this one's
  await page.setContent('<main><p>no button</p></main>');
  await assert.rejects(form.createRecord(s, 'Task', { timeout: 1_000 }), { code: 'ACTION_NOT_AVAILABLE' });
  assert.equal(page.url(), 'about:blank', 'the form was not opened by URL');
});

// No org: a home that shows both New and New <label> presses the exact New, with no strict-mode clash; a padded label still matches.
test('createRecord presses the exact New when New <label> shows too, and trims the label, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const s = { page, origin: 'http://127.0.0.1:1' };
  const by = (who) => `onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog data-by=${who}><button>Save</button></div>')"`;
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  const info = (label) => async () => ({ createable: true, label, recordTypeInfos: { master: { master: true, available: true, name: 'Master' } } });
  t.mock.method(api, 'call', info('Task'));
  await page.setContent(`<main><button ${by('label')}>New Task</button><button ${by('exact')}>New</button></main>`);
  await form.createRecord(s, 'Task', { timeout: 3_000 });
  assert.equal(await page.locator('[data-by=exact]').count(), 1, 'the exact New was pressed');
  assert.equal(await page.locator('[data-by=label]').count(), 0, 'not New Task');
  t.mock.method(api, 'call', info('Task '));
  await page.setContent(`<main><button ${by('label')}>New Task</button></main>`);
  await form.createRecord(s, 'Task', { timeout: 3_000 });
  assert.equal(await page.locator('[data-by=label]').count(), 1, 'a label with a trailing space still matches New Task');
});

// No org: several record types and none named is RECORD_TYPE_REQUIRED before any page opens; one or none presses New.
test('createRecord asks for a record type when the object has several, no org', async (t) => {
  const info = (...names) => ({ createable: true, recordTypeInfos: Object.fromEntries(names.map((n) => [n, { name: n, available: true, master: n === 'Master', recordTypeId: `012${n}` }])) });
  const opened = t.mock.method(nav, 'openList', async () => { throw new Error('opened the home'); });
  t.mock.method(api, 'call', async () => info('Master', 'Alpha', 'Beta'));
  await assert.rejects(form.createRecord({}, 'Typed__c'), (e) => e.code === 'RECORD_TYPE_REQUIRED' && e.evidence.recordTypes.join() === 'Alpha,Beta');
  assert.equal(opened.mock.callCount(), 0, 'refused before the home');
  t.mock.method(api, 'call', async () => info('Master', 'Alpha'));
  await assert.rejects(form.createRecord({}, 'Typed__c'), /opened the home/); // control: one type goes on to the home
});

// No org: only a wait that ran out is "no New button"; two of them is a strict-mode clash the caller must see as it is.
// No org: the Task home (a split view) has no New button; New Task sits in its "Show 2 more actions" menu (measured on
// sfui-s4-flow, 2026-11-12). A menu without New is still ACTION_NOT_AVAILABLE.
test('createRecord takes New <label> from the home\'s overflow menu, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const s = { page, origin: 'http://127.0.0.1:1' };
  const dialog = `onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>')"`;
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  const home = (items) => `<main><button aria-haspopup="true" onclick="document.getElementById('m').hidden=false">Show 2 more actions</button></main><div id="m" role="menu" hidden>${items}</div>`;
  await page.setContent(home(`<div role="menuitem" ${dialog}>New Task</div><div role="menuitem">Assign Label</div>`));
  await form.createRecord(s, 'Task', { timeout: 3_000 });
  assert.equal(await page.getByRole('dialog').count(), 1, 'the dialog came from the menu item');
  await page.setContent(home('<div role="menuitem">Assign Label</div>'));
  await assert.rejects(form.createRecord(s, 'Task', { timeout: 3_000 }), { code: 'ACTION_NOT_AVAILABLE' });
});
// No org: the overflow menu prefers the exact New over New <label>, as the button branch does.
test('createRecord takes the exact New from the overflow menu when New <label> shows too, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const by = (who) => `data-by="${who}" onclick="this.dataset.pressed=1; document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>')"`;
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  await page.setContent(`<main><button aria-haspopup="true" onclick="document.getElementById('m').hidden=false">Show 2 more actions</button></main><div id="m" role="menu" hidden><div role="menuitem" ${by('label')}>New Task</div><div role="menuitem" ${by('exact')}>New</div></div>`);
  await form.createRecord({ page, origin: 'http://127.0.0.1:1' }, 'Task', { timeout: 3_000 });
  assert.equal(await page.locator('[data-by=exact][data-pressed]').count(), 1, 'the exact New was pressed');
  assert.equal(await page.locator('[data-by=label][data-pressed]').count(), 0, 'not New Task');
});
// No org, F23 (Dave 2026-11-24): two visible "New" items (two menus open) or two New buttons on the home end AMBIGUOUS
// naming each control, and nothing is pressed; one New presses (the tests above are the control).
test('createRecord ends AMBIGUOUS on two New controls and presses neither, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const by = (who) => `data-by="${who}" onclick="this.dataset.pressed=1; document.body.insertAdjacentHTML('beforeend', '<div role=dialog><button>Save</button></div>')"`;
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ fields: [] }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  const ambiguous = (e) => e.code === 'AMBIGUOUS' && e.evidence.controls.length === 2 && e.evidence.controls.every((c) => /^New/.test(c.label));
  const pressed = () => page.locator('[data-pressed]').count();
  await page.setContent(`<main><button aria-haspopup="true" onclick="document.querySelectorAll('[role=menu]').forEach((m) => { m.hidden = false; })">Show 2 more actions</button></main>
    <div role="menu" hidden><div role="menuitem" ${by('one')}>New</div></div><div role="menu" hidden><div role="menuitem" ${by('two')}>New</div></div>`);
  await assert.rejects(form.createRecord({ page, origin: 'http://127.0.0.1:1' }, 'Task', { timeout: 3_000 }), ambiguous);
  assert.equal(await pressed(), 0, 'no menu item was pressed');
  await page.setContent(`<main><button ${by('one')}>New</button><button ${by('two')}>New</button></main>`);
  await assert.rejects(form.createRecord({ page, origin: 'http://127.0.0.1:1' }, 'Task', { timeout: 3_000 }), ambiguous);
  assert.equal(await pressed(), 0, 'no button was pressed');
  await page.setContent(`<main><button ${by('one')}>New Task</button><button ${by('two')}>New Task</button></main>`);
  await assert.rejects(form.createRecord({ page, origin: 'http://127.0.0.1:1' }, 'Task', { timeout: 3_000 }), ambiguous);
  assert.equal(await pressed(), 0, 'no New Task was pressed');
});
// No org, F23: two footer buttons of one name end AMBIGUOUS naming each, not Playwright's raw strict-mode error; one presses.
test('a footer press with two matches ends AMBIGUOUS naming the buttons, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const f = { scope: page.locator('#panel'), footer: page.locator('#footer'), s: { page }, recordId: '001000000000001AAA' };
  await page.setContent(`<article id="panel"><div id="footer"><button onclick="this.dataset.pressed=1">Cancel</button><button title="Cancel edit" onclick="this.dataset.pressed=1">Cancel</button></div></article>`);
  await assert.rejects(form.cancel(f), (e) => e.code === 'AMBIGUOUS' && e.evidence.button === 'Cancel' && e.evidence.controls.map((c) => c.label).join('|') === 'Cancel|Cancel edit');
  assert.equal(await page.locator('[data-pressed]').count(), 0, 'neither was pressed');
  await page.setContent(`<article id="panel"><div id="footer"><button onclick="document.getElementById('panel').hidden=true">Cancel</button></div></article>`);
  await form.cancel(f); // control: one Cancel presses and the form closes
});
test('createRecord reports a missing New button, not another failure, as ACTION_NOT_AVAILABLE, no org', async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async () => ({ createable: true, recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  await page.setContent('<main><p>no button</p></main>');
  const closing = form.createRecord({ page }, 'Plain__c', { timeout: 5_000 });
  setTimeout(() => page.close(), 300); // the page closes while the wait for New runs
  await assert.rejects(closing, (e) => e.code !== 'ACTION_NOT_AVAILABLE' && /closed/.test(e.message));
});
test('createRecord reports a home with no New button as ACTION_NOT_AVAILABLE, no org', async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(api, 'call', async () => ({ createable: true, recordTypeInfos: { a: { available: true, name: 'Alpha' }, b: { available: true, name: 'Beta' } } }));
  await page.setContent('<main><p>no button</p></main>');
  await assert.rejects(form.createRecord({ page }, 'Plain__c', { recordType: 'Alpha', timeout: 1_000 }), { code: 'ACTION_NOT_AVAILABLE' }); // control: a timeout is the missing button
});

// No org: a picklist dropdown that closes before the click (once on an Account's Rating, sfui-s4-map, a raw 30 s
// click timeout) is opened once more, then it is TIMEOUT; only an open list without the value is VALUE_NOT_FOUND.
test('a picklist whose dropdown closes before the click is opened once more, no org', { timeout: 120_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [{ apiName: 'Rating', label: 'Rating', dataType: 'Picklist', editable: true }] } };
  // The option slides for `slide` ms (or with no end), so the click waits for it; the first `skip` presses open nothing, the first `closes` opens close after 150 ms (`dead`: and disable the box; `drop`: and lose the option).
  const html = ({ closes = 0, skip = 0, slide = 400, forever = false, dead = false, drop = false } = {}) => `<style>@keyframes slide { from { margin-left: 0 } to { margin-left: 40px } } [role=option] { animation: slide ${slide}ms linear ${forever ? 'infinite' : ''} }</style>
    <div role="dialog"><button role="combobox" aria-label="Rating">--None--</button>
    <div role="listbox" aria-label="Rating" hidden><div role="option" onclick="document.querySelector('[role=combobox]').textContent = 'Hot'; this.parentNode.hidden = true">Hot</div><div role="option">Warm</div></div><button>Save</button></div>
    <script>{ let left = ${closes}; let skip = ${skip}; const list = document.querySelector('[role=listbox]'); const box = document.querySelector('[role=combobox]');
      box.onclick = () => { document.body.dataset.pressed = +(document.body.dataset.pressed || 0) + 1; if (skip-- > 0) return; list.hidden = !list.hidden; if (list.hidden) return; document.body.dataset.opened = +(document.body.dataset.opened || 0) + 1; if (left-- > 0) setTimeout(() => { list.hidden = true; box.disabled = ${dead}; if (${drop}) list.firstElementChild.remove(); }, 150); }; }</script>`;
  const opened = () => page.evaluate(() => document.body.dataset.opened);
  const pressed = () => page.evaluate(() => document.body.dataset.pressed);
  const fast = { picklist: { timeout: 1_000 } }; // the tools wait 5 s
  const stuck = (why, visible) => (e) => e.code === 'TIMEOUT' && why.test(e.message) && e.evidence.apiName === 'Rating' && e.evidence.value === 'Hot' && e.evidence.visible === visible;
  await page.setContent(html({ closes: 1 }));
  await form.setFields(f, { Rating: 'Hot' }, fast);
  assert.equal(await opened(), '2', 'control: the dropdown closed once and was opened again');
  await page.setContent(html({ skip: 1 })); // the first press showed no list: not "offers no Hot"
  await form.setFields(f, { Rating: 'Hot' }, fast);
  assert.equal(await opened(), '1', 'control: the second press opened it');
  await page.setContent(html({ closes: 9 }));
  await assert.rejects(form.setFields(f, { Rating: 'Hot' }, fast), stuck(/closed or did not show it, twice/, false));
  await page.setContent(html({ closes: 1, drop: true })); // shown once, then an open list without it: not "offers no Hot"
  await assert.rejects(form.setFields(f, { Rating: 'Hot' }, fast), stuck(/closed or did not show it, twice/, false));
  await page.setContent(html({ closes: 1, dead: true })); // the box takes no press to open it again: coded, in the same cap
  await assert.rejects(form.setFields(f, { Rating: 'Hot' }, fast), stuck(/took no press/, false));
  await page.setContent(html({ slide: 1_500 })); // still shown after one cap: clicked again, and a press would close it
  await form.setFields(f, { Rating: 'Hot' }, fast);
  assert.equal(await pressed(), '1', 'control: the box was not pressed again');
  await page.setContent(html({ forever: true })); // shown but never still: two clicks, then TIMEOUT
  await assert.rejects(form.setFields(f, { Rating: 'Hot' }, fast), stuck(/stayed shown/, true));
  assert.equal(await pressed(), '1', 'control: the box was not pressed again');
  await page.setContent(html());
  await assert.rejects(form.setFields(f, { Rating: 'Cold' }, fast), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.join() === 'Hot,Warm'); // an open list without the value
  await page.setContent(html());
  await form.setFields(f, { Rating: 'Hot' }, fast); // control: a dropdown that stays open is opened once
  assert.equal(await opened(), '1');
});

// No org: two Search Results options with the asked name are AMBIGUOUS with both options' lines and ids; one name picks it.
test('a lookup with two records of the asked name is AMBIGUOUS, not the first, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const opt = (name, where) => `<div role="option" data-value="001C100000${where}AAA" onclick="document.body.dataset.picked='${where}'"><div>${name}</div><div>Account | ${where}</div></div>`;
  const form_ = (...opts) => `<div role="dialog"><input role="combobox" aria-label="Parent Account">
    <div role="listbox" aria-label="Parent Account"><div role="group" aria-label="Search Results">${opts.join('')}</div></div><button>Save</button></div>`;
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [{ apiName: 'ParentId', label: 'Parent Account', dataType: 'Reference', editable: true }] } };
  await page.setContent(form_(opt('Acme', 'Lyon'), opt('Acme', 'Paris'), opt('Acme Two', 'Nice')));
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'AMBIGUOUS' && e.evidence.options.join() === 'Acme | Account | Lyon (001C100000LyonAAA),Acme | Account | Paris (001C100000ParisAAA)' && !e.evidence.cleared);
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'nothing was picked');
  await page.setContent(form_(opt('Acme', 'Lyon'), opt('Acme Two', 'Nice')));
  await form.setFields(f, { ParentId: 'Acme' }); // control: one record of the name is picked
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'Lyon');
  // A name no option has lists the options as AMBIGUOUS does: each line and its id.
  await assert.rejects(form.setFields(f, { ParentId: 'Nobody' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.join() === 'Acme | Account | Lyon (001C100000LyonAAA),Acme Two | Account | Nice (001C100000NiceAAA)');
  // Results in stages: one Acme first, a second 150 ms after the typing, between the first two reads.
  await page.setContent(form_(opt('Acme', 'Lyon')));
  await page.evaluate((html) => document.querySelector('[role=combobox]').addEventListener('input', () => setTimeout(() => document.querySelector('[role=group]').insertAdjacentHTML('beforeend', html), 150), { once: true }), opt('Acme', 'Paris'));
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'AMBIGUOUS');
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'the first stage was not picked');
  // A list that changes on every read never settles: the error says so, not that no record has the name.
  await page.setContent(form_(opt('Acme', 'Lyon')));
  await page.evaluate(() => setInterval(() => { document.querySelector('[role=option] div:last-child').textContent += '.'; }, 50));
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.unsettled === true && /kept changing/.test(e.message));
});

// No org: a record id types the name the API reads for it and picks the option whose data-value is that id, so a
// twin of the name cannot make it AMBIGUOUS; an id no option carries is searched again, then NOT_SEARCHABLE_YET.
test('a lookup given a record id picks the option with that id, no org', { timeout: 150_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [LYON, PARIS] = ['001C100000XZ8PWIA1', '001C100000XVXrEIAX'];
  const opt = (id, where) => `<div role="option" data-value="${id}" onclick="document.body.dataset.picked='${where}'"><div>Acme</div><div>Account | ${where}</div></div>`;
  await page.setContent(`<div role="dialog"><input role="combobox" aria-label="Parent Account" oninput="document.body.dataset.typed=this.value">
    <button onclick="document.body.dataset.cleared='yes'">Clear Parent Account Selection</button>
    <div role="listbox" aria-label="Parent Account"><div role="group" aria-label="Search Results">${opt(LYON, 'Lyon')}${opt(PARIS, 'Paris')}</div></div><button>Save</button></div>`);
  const calls = [];
  t.mock.method(api, 'call', async (s, path) => {
    calls.push(path);
    if (path === '/ui-api/object-info/Account') return { fields: { ParentId: { referenceToInfos: [{ apiName: 'Account', nameFields: ['Name'] }] } } };
    if (path.startsWith(`/ui-api/records/${PARIS.slice(0, 15)}`)) return { apiName: 'Account', fields: { Name: { value: 'Acme' } } };
    if (path.startsWith('/ui-api/records/001C100000XBOOM')) throw new SfUiError('API_ERROR', 'answered 500', { status: 500 });
    if (path.startsWith('/ui-api/records/001C100000XNONE')) return { apiName: 'Account', fields: { Name: { value: null } } };
    if (path.startsWith('/ui-api/records/001C100000XWRNG')) throw new SfUiError('API_ERROR', 'answered 400', { status: 400, errorCode: 'INVALID_INPUT_COMBINATION' });
    if (path.startsWith('/ui-api/records/001C100000XHIDE')) throw new SfUiError('API_ERROR', 'answered 403', { status: 403, errorCode: 'INSUFFICIENT_ACCESS' });
    throw new SfUiError('API_ERROR', 'answered 404 NOT_FOUND', { status: 404, errorCode: 'NOT_FOUND' });
  });
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Account', fields: [{ apiName: 'ParentId', label: 'Parent Account', dataType: 'Reference', editable: true }] } };
  await form.setFields(f, { ParentId: PARIS.slice(0, 15) });
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'Paris', 'the option whose data-value is the id, not the first Acme');
  assert.equal(f.set.ParentId.confirm, undefined, 'control: an LWC pick by id reads its id from the DOM, no stored-id check');
  assert.equal(await page.evaluate(() => document.body.dataset.typed), 'Acme', 'the name the API read was typed');
  assert.equal(await page.evaluate(() => document.body.dataset.cleared), 'yes', 'control: a good id clears the old choice');
  assert.ok(calls.some((p) => p.includes('optionalFields=Account.Name')), calls.join());
  await page.evaluate(() => delete document.body.dataset.picked);
  // A failure after the Clear says the chosen record is gone, so a caller knows a save would write a blank.
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'AMBIGUOUS' && e.evidence.cleared === true);
  // A raw failure after the Clear (a list that cannot be read) is coded and says the choice is gone too.
  await page.evaluate(() => Object.defineProperty(document.querySelector('[role=option]'), 'innerText', { get() { throw new Error('unreadable'); }, configurable: true }));
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'UNEXPECTED' && e.evidence.cleared === true && /unreadable/.test(e.message));
  // A raw error keeps its whole text (a call log past the first line), and a raw timeout the page's url, as the server gives them.
  await page.evaluate(() => Object.defineProperty(document.querySelector('[role=option]'), 'innerText', { get() { throw new Error('first line\nCall log:\n  - waiting for option'); }, configurable: true }));
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'UNEXPECTED' && e.evidence.cleared === true && /Call log:\n {2}- waiting for option/.test(e.message));
  await page.evaluate(() => delete document.querySelector('[role=option]').innerText);
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { document.querySelector('[role=combobox]').disabled = true; }, { once: true }));
  page.setDefaultTimeout(1_000); // the Clear disables the box, so the click to type waits it out
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), (e) => e.code === 'LOCATOR_TIMEOUT' && e.evidence.cleared === true && /Call log/.test(e.message) && e.evidence.url === page.url());
  page.setDefaultTimeout(30_000);
  await page.evaluate(() => { document.querySelector('[role=combobox]').disabled = false; });
  // Any other API failure is the API's, not a missing record; a record with no name has nothing to type.
  await assert.rejects(form.setFields(f, { ParentId: '001C100000XBOOM' }), (e) => e.code === 'API_ERROR' && e.evidence.status === 500);
  await assert.rejects(form.setFields(f, { ParentId: '001C100000XNONE' }), (e) => e.code === 'VALUE_NOT_FOUND' && /has no name/.test(e.message));
  // A record this user cannot read is VALUE_NOT_FOUND at once, not typed as a name.
  await page.evaluate(() => delete document.body.dataset.cleared);
  await assert.rejects(form.setFields(f, { ParentId: '001C100000XHIDE' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.status === 403 && /cannot read/.test(e.message) && !e.evidence.cleared);
  assert.equal(await page.evaluate(() => document.body.dataset.cleared), undefined, 'a failed id read keeps the chosen record');
  assert.equal(await page.evaluate(() => document.body.dataset.typed), 'Acme', 'nothing typed for the 403');
  // A read-back after the Clear that finds another value in the box says the old choice is gone too.
  await page.evaluate(() => document.querySelector('[role=group]').insertAdjacentHTML('beforeend', '<div role="option" data-value="001C100000XSOLO" onclick="document.querySelector(\'[role=combobox]\').value=\'Other Co\'"><div>Solo</div><div>Account | Rome</div></div>'));
  await assert.rejects(form.setFields(f, { ParentId: 'Solo' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.cleared === true && e.evidence.got === 'Other Co');
  await page.evaluate(() => document.querySelector('[data-value="001C100000XSOLO"]').remove());
  // An id no record has is typed as a name, so a name shaped like an id (the API answers it 404 too) still picks.
  await assert.rejects(form.setFields(f, { ParentId: '001C100000XQ2b6IAD' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.value === '001C100000XQ2b6IAD' && e.evidence.status === 404 && /answered 404 NOT_FOUND/.test(e.message) && e.evidence.cleared === true);
  // A 400 comes for records that exist (another object's id, a lowercased id), so the message names the answer only.
  await assert.rejects(form.setFields(f, { ParentId: '001C100000XWRNG' }), (e) => e.code === 'VALUE_NOT_FOUND' && !/no record has that id/.test(e.message) && /400 INVALID_INPUT_COMBINATION/.test(e.message));
  await page.evaluate((html) => document.querySelector('[role=group]').insertAdjacentHTML('beforeend', html), opt('001C100000XQ2b7', 'Nice').replace(/Acme/, 'AcmeCorporation'));
  await form.setFields(f, { ParentId: 'AcmeCorporation' });
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'Nice', 'a 15-letter name the API does not know is picked by name');
  await page.evaluate(() => { delete document.body.dataset.picked; document.querySelectorAll('[role=option]')[2].remove(); });
  // The name reads but no option carries the id: searched again for 60 s (F10), then NOT_SEARCHABLE_YET naming the id and the options seen, nothing picked.
  await page.evaluate(() => document.querySelectorAll('[role=option]')[1].remove());
  await page.evaluate(() => document.querySelector('[role=group]').insertAdjacentHTML('beforeend', '<div role="option"><div>Acme</div><div>Account | Nice</div></div>'));
  await assert.rejects(form.setFields(f, { ParentId: PARIS }), (e) => e.code === 'NOT_SEARCHABLE_YET' && e.message.includes(PARIS) && e.evidence.options.join() === `Acme | Account | Lyon (${LYON}),Acme | Account | Nice`);
  await page.evaluate(() => document.querySelectorAll('[role=option]')[1].remove());
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'the other Acme was not picked');
  // The option with the id is there but the list changes on every read: the error says so, not that no option has it.
  await page.evaluate((html) => { document.querySelector('[role=group]').insertAdjacentHTML('beforeend', html); setInterval(() => { document.querySelector('[role=option] div:last-child').textContent += '.'; }, 50); }, opt(PARIS, 'Paris'));
  await assert.rejects(form.setFields(f, { ParentId: PARIS }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.unsettled === true && /kept changing/.test(e.message));
});

// No org: an option that is listed and settled but takes no click (a layer over it) is said so, on both paths.
// No org: a Task's Name is an Aura lookup (measured on sfui-s4-flow, 2026-11-12): its choice is a pill in a list
// "Name - Current Selection: …", its listbox has no name, and its record rows are <a role=option> with no record id.
const AURA_REMOVE = 'To remove the selected record, press Backspace or Del.';
const auraLookup = (rows) => `<div role="dialog"><ul><li><span>Name</span><div id="box"></div></li></ul><button>Save</button></div>
  <script>
    window.box = document.getElementById('box'); // a window property: a second setContent redeclares no const
    window.pill = (name) => { box.innerHTML = '<ul role="list" aria-label="Name - Current Selection: ' + name + ' (Contact)"><li><div>' + name + '</div><button onclick="search()">${AURA_REMOVE}</button></li></ul>'; };
    window.search = () => { box.innerHTML = '<input role="combobox" aria-label="Name" oninput="document.body.dataset.typed=this.value"><div role="listbox">'
      + '<div role="option">Search Contacts in Contacts</div><div role="listbox">' + ${JSON.stringify(rows)} + '</div><div role="option">New Contact</div></div>'; };
    pill('Old Contact');
  </script>`;
const auraRow = (name, second, where) => `<a role="option" href="#" onclick="document.body.dataset.picked='${where}';pill('${name}');return false"><div>${name}</div><div>${second}</div></a>`;

// No org, the gate's R1: clearing Name opens its recent-records dropdown over Related To (measured on
// sfui-s4-map); it is closed before the next field, and a clear that still cannot be clicked is coded, not raw.
test('an Aura lookup cleared with "" closes the dropdown its removal opened, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const row = (label, id) => `<li><span>${label}</span><div id="${id}"><ul role="list" aria-label="${label} - Current Selection: Old (Contact)"><li><div>Old</div>
    <button onclick="cleared('${id}', '${label}')">${AURA_REMOVE}</button></li></ul></div></li>`;
  const html = `<div role="dialog"><h2>Edit Task</h2><ul>${row('Name', 'who')}${row('Related To', 'what')}</ul><button>Save</button></div>
    <script>
      window.cleared = (id, label) => { document.getElementById(id).innerHTML = '<input role="combobox" aria-label="' + label + '">';
        if (id === 'who') document.getElementById('who').insertAdjacentHTML('beforeend', '<div role="listbox" id="drop" style="position:fixed;top:60px;left:0;right:0;bottom:0;background:#fff"><a role="option" href="#">Recent</a></div>');
        document.body.dataset.cleared = (document.body.dataset.cleared || '') + id; };
      document.querySelector('h2').addEventListener('click', () => document.getElementById('drop')?.remove());
    </script>`;
  await page.setContent(html);
  const fields = [['WhoId', 'Name'], ['WhatId', 'Related To']].map(([apiName, label]) => ({ apiName, label, dataType: 'Reference', editable: true }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields } };
  await form.setFields(f, { WhoId: '', WhatId: '' });
  assert.equal(await page.evaluate(() => document.body.dataset.cleared), 'whowhat', 'both cleared');
  assert.equal(await page.getByRole('dialog').count(), 1, 'the dialog stayed open');
  // A dropdown nothing closes: the next clear is coded, with cleared false, since Related To kept its pill.
  await page.setContent(html);
  await page.evaluate(() => { cleared('who', 'Name'); document.querySelector('h2').replaceWith(document.querySelector('h2').cloneNode(true)); });
  await page.waitForSelector('#drop');
  await assert.rejects(form.setFields(f, { WhatId: '' }), (e) => e.code === 'LOCATOR_TIMEOUT' && e.evidence.cleared === false && e.evidence.apiName === 'WhatId');
});

// No org, the org's M5: an inline panel's only heading is 1 px, so a "" clear closes the dropdown with a click at its
// (5,5), which on Task and Event pages is the panel itself (measured on sfui-s4-map), never a section's toggle.
test('an inline Aura lookup cleared with "" closes its dropdown with no heading on screen, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(`<article id="panel" style="padding:20px"><h2 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Details</h2><button id="sect" aria-expanded="true" onclick="this.setAttribute('aria-expanded', 'false')">Information</button>
    <ul><li><span>Name</span><div id="who"><ul role="list" aria-label="Name - Current Selection: Old (Contact)"><li><div>Old</div><button onclick="cleared()">${AURA_REMOVE}</button></li></ul></div></li></ul>
    <div id="footer"><button>Save</button></div></article>
    <script>window.cleared = () => { who.innerHTML = '<input role="combobox" aria-label="Name"><div role="listbox"><a role="option" href="#">Recent</a></div>';
      setTimeout(() => document.addEventListener('mousedown', (e) => { if (!who.contains(e.target)) who.querySelector('[role=listbox]')?.remove(); }), 0); };</script>`);
  const f = { scope: page.locator('#panel'), footer: page.locator('#footer'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  const t0 = Date.now();
  await form.setFields(f, { WhoId: '' });
  assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0} ms`);
  assert.equal(await page.getByRole('listbox').count(), 0, 'the dropdown closed');
  assert.equal(await page.locator('#sect').getAttribute('aria-expanded'), 'true', 'the section stayed open');
});

// No org, the gate's H-A: an edit's Aura pill renders about 1.5 s after the form (measured on sfui-s4-map), so a clear
// waits for it while the record holds a choice, and says so past the bound instead of clearing nothing.
test('an Aura lookup clear waits for a pill the record holds, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  let who = '003C100000XZ8PWIA1';
  const paths = [];
  t.mock.method(api, 'call', async (s, path) => { paths.push(path); return { fields: { WhoId: { value: who } } }; });
  const late = (ms) => page.setContent(`${auraLookup('')}<script>box.innerHTML = '<input role="combobox" aria-label="Name">'; document.querySelector('[role=dialog]').insertAdjacentHTML('afterbegin', '<h2 onclick="box.querySelector(\\'[role=listbox]\\')?.remove()">Edit Task</h2>'); ${ms ? `setTimeout(() => pill('Old Contact'), ${ms})` : ''}</script>`);
  const f = { scope: page.getByRole('dialog'), s: { page }, recordId: '00T000000000001AAA', model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await late(1_500);
  await form.setFields(f, { WhoId: '' });
  await page.waitForTimeout(2_000); // past the pill's render, so a clear that did nothing shows it
  assert.equal(await page.getByRole('list', { name: /^Name - Current Selection/ }).count(), 0, 'the late pill was removed');
  assert.ok(paths.some((p) => p.includes('/ui-api/records/00T000000000001AAA') && p.includes('Task.WhoId')), paths.join());
  // A pill that never comes, while the record holds a choice: coded, nothing cleared.
  await late(0);
  await assert.rejects(form.setFields(f, { WhoId: '' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.cleared === false && /holds a Name/.test(e.message));
  // A Clear that does not take (the pill stays) is read back and refused, not left for the save.
  who = '003C100000XZ8PWIA1';
  await late(1);
  await page.waitForSelector('[aria-label^="Name - Current Selection"] button');
  await page.evaluate(() => { document.querySelector('[aria-label^="Name - Current Selection"] button').onclick = null; });
  await assert.rejects(form.setFields(f, { WhoId: '' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.cleared === true && e.evidence.got === 'Old Contact');
  // Control: a record with no choice has nothing to wait for.
  who = null;
  await late(0);
  const t0 = Date.now();
  await form.setFields(f, { WhoId: '' });
  assert.ok(Date.now() - t0 < 3_000, `took ${Date.now() - t0} ms`);
});

// No org, the gate's M-1 (G13D): a create has no record to say a lookup opened prefilled, so a "" clear with nothing
// to clear yet waits for a pill that renders 1.5 s late, and removes it.
test('an Aura lookup clear on a create waits for a prefilled pill that renders late, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const paths = [];
  t.mock.method(api, 'call', async (s, path) => { paths.push(path); return { fields: {} }; });
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await page.setContent(`${auraLookup('')}<script>box.innerHTML = '<input role="combobox" aria-label="Name">'; document.querySelector('[role=dialog]').insertAdjacentHTML('afterbegin', '<h2 onclick="box.querySelector(\\'[role=listbox]\\')?.remove()">New Task</h2>'); setTimeout(() => pill('Old Contact'), 1500);</script>`);
  await form.setFields(f, { WhoId: '' });
  await page.waitForTimeout(2_000); // past the pill's render, so a clear that did nothing shows it
  assert.equal(await page.getByRole('list', { name: /^Name - Current Selection/ }).count(), 0, 'the late prefilled pill was removed');
  assert.deepEqual([f.set.WhoId.confirm, f.set.WhoId.shown, paths], [true, '', []], 'marked for the create check, with no record read');
});

// No org, the gate's L-2: a required Aura lookup emptied (Task Assigned To) shows a box named "Assigned To Assigned To"
// (measured on sfui-s4-map), so the read-back finds no one box; with no pill left it is empty, and the save's block says the rest.
test('an emptied required Aura lookup reads back as empty, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const html = `<div role="dialog"><h2>Edit Task</h2><ul><li><span>Assigned To</span><div id="box"><ul role="list" aria-label="Assigned To - Current Selection: Ann (User)"><li><div>Ann</div>
    <button onclick="box.innerHTML='<input role=combobox aria-label=\\'Assigned To Assigned To\\'>'">${AURA_REMOVE}</button></li></ul></div></li></ul><button>Save</button></div>`;
  const field = (required) => ({ apiName: 'OwnerId', label: 'Assigned To', dataType: 'Reference', editable: true, required });
  await page.setContent(html);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [field(true)] } };
  await form.setFields(f, { OwnerId: '' });
  assert.equal(await page.getByRole('list', { name: /^Assigned To - Current Selection/ }).count(), 0);
  // Control: a lookup not required with no one box is still refused.
  await page.setContent(html);
  const g = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [field(false)] } };
  await assert.rejects(form.setFields(g, { OwnerId: '' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === 'no one box');
});

test('an Aura lookup removes its pill, picks a record row by name, and reads the new pill back, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(auraLookup(auraRow('Ann Lee', 'Acme', 'ann') + auraRow('Bob Ray', 'Acme', 'bob')));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await form.setFields(f, { WhoId: 'Bob Ray' });
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'bob');
  assert.equal(f.set.WhoId.confirm, undefined, 'a name pick needs no stored-id check');
  await assert.rejects(form.setFields(f, { WhoId: 'Cy Doe' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.join() === 'Ann Lee | Acme,Bob Ray | Acme' && e.evidence.cleared === true);
});

test('an Aura lookup given a record id picks the one row with its name, and refuses two as AMBIGUOUS, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const ANN = '003C100000XZ8PWIA1';
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }, { apiName: 'Lead', nameFields: ['Name'] }] } } };
    return { apiName: 'Contact', fields: { Name: { value: 'Ann Lee' } } };
  });
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await page.setContent(auraLookup(auraRow('Ann Lee', 'Acme', 'ann') + auraRow('Ann Leeds', 'Acme', 'leeds')));
  await form.setFields(f, { WhoId: ANN });
  assert.equal(await page.evaluate(() => document.body.dataset.typed), 'Ann Lee', 'the id\'s record name was typed');
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'ann');
  assert.equal(f.set.WhoId.confirm, true, 'save checks the stored id');
  await page.setContent(auraLookup(auraRow('Ann Lee', 'Acme', 'ann') + auraRow('Ann Lee', 'Globex', 'other')));
  await assert.rejects(form.setFields(f, { WhoId: ANN }), (e) => e.code === 'AMBIGUOUS' && e.evidence.options.join() === 'Ann Lee | Acme,Ann Lee | Globex');
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'nothing was picked');
});

// No org, the gate's H-1 (TW): an Aura option carries its record id in its component's v.value (measured on sfui-s4-map,
// as admin and as the user), so a same-name twin listed alone or first is never picked for the id.
test('an Aura lookup given a record id picks the option whose component holds that id, never a twin, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [ANN, TWIN] = ['003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }] } } };
    return { apiName: 'Contact', fields: { Name: { value: 'Ann Lee' } } };
  });
  const aura = '<script>window.$A = { getComponent: (g) => ({ getComponentValueProvider: () => ({ get: (k) => (k === \'v.value\' ? { id: g } : null) }) }) };</script>';
  const row = (id, second, where) => auraRow('Ann Lee', second, where).replace('<a ', `<a data-aura-rendered-by="${id}" `);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  // A twin listed alone is searched again, then NOT_SEARCHABLE_YET: the next test.
  await page.setContent(auraLookup(row(TWIN, 'Acme', 'twin') + row(ANN, 'Globex', 'ann')) + aura);
  await form.setFields(f, { WhoId: ANN });
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'ann', 'the option with the id, not the first');
  assert.equal(f.set.WhoId.shown, 'Ann Lee', 'the pill was read back');
  // F11: the id came from Aura's private runtime, so the save reads the stored id back (the next test).
  assert.deepEqual([f.set.WhoId.confirm, f.set.WhoId.id], [true, ANN], 'an Aura pick by id is checked at save');
});

// No org: a save that stays on the record still reads it back when an Aura lookup was set by id, and refuses another id.
test('a save checks the stored id of an Aura lookup set by id, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, ANN, OTHER] = ['00T000000000001AAA', '003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  const view = `https://x.lightning.force.com/lightning/r/Task/${id}/view`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><ul role="list" aria-label="Name - Current Selection: Ann Lee (Contact)"><li><div>Ann Lee</div></li></ul><button onclick="this.parentNode.remove()">Save</button></div>' }));
  let rows = [];
  const rec = (who) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: 'Ann Lee' } } });
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rows.shift()));
  const f = (confirm) => ({ scope: page.getByRole('dialog'), s: { page }, model: { fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }], objectApiName: 'Task' }, recordId: id, set: { WhoId: { value: ANN, kind: 'Reference', confirm, shown: 'Ann Lee' } } });
  await page.goto(view);
  rows = [rec(null), rec(ANN)];
  assert.deepEqual((await form.save(f(true))).values, { checked: ['WhoId'], mismatched: [], notChecked: [] });
  await page.goto(view);
  rows = [rec(null), rec(OTHER)];
  await assert.rejects(form.save(f(true)), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.values.mismatched[0].stored === OTHER);
  await page.goto(view);
  rows = [rec(null), rec(OTHER)];
  assert.equal((await form.save(f(false))).outcome, 'saved', 'control: no read-back without an id picked by name');
});

// No org, the gate's H-A (c): a lookup cleared with "" is checked against the record on a save that stays on it, on an
// Aura and on an LWC lookup, so a pill that came back after the clear can never read saved.
test('a save checks that a lookup cleared with "" is empty in the record, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, OLD] = ['00T000000000001AAA', '003C100000XZ8PWIA1'];
  const view = `https://x.lightning.force.com/lightning/r/Task/${id}/view`;
  let body = '';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rows = [];
  const rec = (who) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: who && 'Old Contact' } } });
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rows.shift()));
  const fields = [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }];
  const save = async (shown, after) => {
    body = `<div role="dialog">${shown}<button onclick="this.parentNode.remove()">Save</button></div>`;
    await page.goto(view);
    rows = [rec(OLD), after];
    return form.save({ scope: page.getByRole('dialog'), s: { page }, model: { fields, objectApiName: 'Task' }, recordId: id, set: { WhoId: { value: '', kind: 'Reference', confirm: true, shown: '' } } });
  };
  const pill = '<ul role="list" aria-label="Name - Current Selection: Old Contact (Contact)"><li><div>Old Contact</div></li></ul>';
  await assert.rejects(save(pill, rec(OLD)), (e) => e.code === 'SAVE_UNCONFIRMED' && /does not hold an empty WhoId$/.test(e.message));
  await assert.rejects(save('<input role="combobox" aria-label="Name">', rec(OLD)), (e) => e.code === 'SAVE_UNCONFIRMED' && /an empty WhoId/.test(e.message));
  assert.deepEqual((await save('<input role="combobox" aria-label="Name">', rec(null))).values.checked, ['WhoId'], 'control: cleared in the record');
  // An LWC lookup's clear is checked the same way: setFields marks it for the save.
  await page.setContent(`<div role="dialog"><input role="combobox" aria-label="Name" value="Old Contact">
    <button onclick="document.querySelector('input').value=''">Clear Name Selection</button><button>Save</button></div>`);
  const g = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Account', fields } };
  await form.setFields(g, { WhoId: '' });
  assert.equal(g.set.WhoId.confirm, true);
});

// No org, the gate's M2 and L4: a save that stays on the record after an id picked by name compares the call's other
// fields as a left save does (the org trims text, drops 1,000's comma, lowercases an email), and names a field it does
// not hold as a record id only for a lookup; an id it could not compare is not proved.
test('a save that stays on the record compares every field as a left save does, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, ANN, OTHER] = ['00T000000000001AAA', '003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  const view = `https://x.lightning.force.com/lightning/r/Task/${id}/view`;
  const pill = '<ul role="list" aria-label="Name - Current Selection: Ann Lee (Contact)"><li><div>Ann Lee</div></li></ul>';
  let body = '';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rows = [];
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rows.shift()));
  const kinds = { Description: ['Comments', 'TextArea'], Amount__c: ['Amount', 'Double'], Email__c: ['Email', 'Email'] };
  const typed = { Description: '  note  ', Amount__c: '1,000', Email__c: 'A@Example.com' };
  const fields = [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true },
    ...Object.entries(kinds).map(([apiName, [label, dataType]]) => ({ apiName, label, dataType, editable: true, ...(dataType === 'Double' && { role: 'textbox' }) }))];
  const set = { WhoId: { value: ANN, kind: 'Reference', confirm: true, shown: 'Ann Lee' }, ...Object.fromEntries(Object.entries(typed).map(([k, v]) => [k, { value: v, kind: kinds[k][1], rich: false, shown: v }])) };
  const rec = (who, more) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: 'Ann Lee' }, ...more } });
  const org = { Description: { value: 'note' }, Amount__c: { value: 1000 }, Email__c: { value: 'a@example.com' } };
  const save = async (shown, after) => {
    // A number box's host holds its number (lane 10's blurred-box read), so Amount sits in a lightning-input.
    const box = (k, label) => `<label>${label}<input value="${typed[k]}"></label>`;
    body = `<div role="dialog">${shown}${Object.entries(kinds).map(([k, [label, kind]]) => (kind === 'Double' ? `<lightning-input>${box(k, label)}</lightning-input><script>document.querySelector('lightning-input').value = '${typed[k]}'</script>` : box(k, label))).join('')}<button onclick="this.parentNode.remove()">Save</button></div>`;
    await page.goto(view);
    rows = [rec(null, {}), after];
    return form.save({ scope: page.getByRole('dialog'), s: { page }, model: { fields, objectApiName: 'Task' }, recordId: id, set: structuredClone(set) });
  };
  assert.deepEqual((await save(pill, rec(ANN, org))).values.checked.sort(), ['Amount__c', 'Description', 'Email__c', 'WhoId']);
  await assert.rejects(save(pill, rec(ANN, { ...org, Description: { value: 'other' } })), (e) => e.code === 'SAVE_UNCONFIRMED' && /does not hold the value the form held for Description$/.test(e.message));
  await assert.rejects(save(pill, rec(OTHER, org)), (e) => e.code === 'SAVE_UNCONFIRMED' && /does not hold the record id given for WhoId$/.test(e.message));
  // The pill gone at Save: the id was not compared, so nothing proves it.
  await assert.rejects(save('', rec(OTHER, org)), (e) => e.code === 'SAVE_UNCONFIRMED' && /record id given for WhoId was not compared/.test(e.message));
});

// No org, the review's N3 and N8: a save that left the record proves a confirm field (an id picked by name, a ""
// clear) as a save that stays does: compared, or held before; one not compared is SAVE_UNCONFIRMED.
test('a save that left the record proves a confirm field as one that stays does, no org', { timeout: 120_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, me, ANN] = ['00T000000000001AAA', '005000000000001AAA', '003C100000XZ8PWIA1'];
  const view = `https://x.lightning.force.com/lightning/r/Task/${id}/view`;
  const pill = '<ul role="list" aria-label="Name - Current Selection: Ann Lee (Contact)"><li><div>Ann Lee</div></li></ul>';
  let body = '';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rows = [];
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rows.shift()));
  const rec = (at, who) => ({ fields: { SystemModstamp: { value: at }, LastModifiedById: { value: me }, WhoId: { value: who }, Who: { displayValue: null } } });
  const fields = [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }];
  const save = async (shown, value, before, after) => {
    body = `<div role="dialog">${shown}<button onclick="history.pushState({}, '', '/lightning/o/Task/home'); this.parentNode.remove()">Save</button></div>`;
    await page.goto(view);
    rows = [rec('1', before), rec('2', after)];
    return form.save({ scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields, objectApiName: 'Task' }, recordId: id, set: { WhoId: { value, kind: 'Reference', confirm: true, shown: value && 'Ann Lee' } } });
  };
  // The pill gone at Save: the id was not compared, so nothing proves it.
  await assert.rejects(save('', ANN, null, ANN), (e) => e.code === 'SAVE_UNCONFIRMED' && /record id given for WhoId was not compared/.test(e.message));
  assert.deepEqual((await save(pill, ANN, null, ANN)).values.checked, ['WhoId'], 'control: compared');
  // A clear of a lookup the record held empty before proves nothing new, but nothing is left unproved either.
  assert.equal((await save('<input role="combobox" aria-label="Name">', '', null, null)).outcome, 'saved', 'held before');
});

// No org: Name's switcher (measured on sfui-s4-flow) is a button "Name—Current Selection: Contacts, Pick an object" whose
// menu lists the objects by plural label; the box then searches the object chosen.
const switcherLookup = (rows) => `<div role="dialog"><ul><li><span>Name</span>
  <button id="sw" aria-label="Name—Current Selection: Contacts, Pick an object" onclick="document.getElementById('menu').hidden=false">Contacts</button>
  <div id="menu" role="menu" hidden><div role="menuitem" onclick="pickObject('Contacts')">Contacts</div><div role="menuitem" onclick="pickObject('Leads')">Leads</div></div>
  <input role="combobox" aria-label="Name" oninput="search()"><div role="listbox"><div role="listbox" id="rows"></div></div></li></ul><button>Save</button></div>
  <script>
    window.rows = ${JSON.stringify(rows)}; window.shown = 'Contacts';
    window.pickObject = (o) => { shown = o; document.body.dataset.switched = (document.body.dataset.switched || '') + o; document.getElementById('menu').hidden = true;
      document.getElementById('sw').setAttribute('aria-label', 'Name—Current Selection: ' + o + ', Pick an object'); };
    window.search = () => { document.getElementById('rows').innerHTML = rows[shown]; };
    window.pill = (n) => { document.getElementById('rows').innerHTML = ''; document.querySelector('li').insertAdjacentHTML('beforeend', '<ul role="list" aria-label="Name - Current Selection: ' + n + '"><li><div>' + n + '</div></li></ul>'); };
  </script>`;

test('an Aura lookup switches to the object of the id or of objects, by its plural label, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const LEAD = '00QC100000XZ8PWIA1';
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }, { apiName: 'Lead', nameFields: ['Name'] }] } } };
    if (path === '/ui-api/object-info/Lead') return { labelPlural: 'Leads' };
    if (path === '/ui-api/object-info/Contact') return { labelPlural: 'Contacts' };
    return { apiName: 'Lead', fields: { Name: { value: 'Lee Ray' } } };
  });
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }, { apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] } };
  const rows = { Contacts: auraRow('Lee Ray', 'Acme', 'contact'), Leads: auraRow('Lee Ray', 'Globex', 'lead') };
  const state = () => page.evaluate(() => [document.body.dataset.switched, document.body.dataset.picked]);
  await page.setContent(switcherLookup(rows));
  await form.setFields(f, { WhoId: LEAD });
  assert.deepEqual(await state(), ['Leads', 'lead'], 'by id: the record\'s object');
  await page.setContent(switcherLookup(rows));
  await form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } });
  assert.deepEqual(await state(), ['Leads', 'lead'], 'by name: the object objects names');
  await page.setContent(switcherLookup(rows));
  await form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Contact' } });
  assert.deepEqual(await state(), [undefined, 'contact'], 'the object shown already: no switch');
  await page.setContent(switcherLookup(rows));
  await form.setFields(f, { WhoId: 'Lee Ray' });
  assert.deepEqual(await state(), [undefined, 'contact'], 'no entry: the object shown');
  await page.setContent(switcherLookup(rows));
  await assert.rejects(form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Account' } }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.objects.join() === 'Contact,Lead');
  await assert.rejects(form.setFields(f, { Subject: 'x' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'BAD_ARGS');
  await assert.rejects(form.setFields(f, { Subject: 'x' }, { objects: { Subject: 'Lead' } }), (e) => e.code === 'BAD_ARGS');
  await page.evaluate(() => document.querySelectorAll('[role=menuitem]')[1].remove()); // the menu offers Contacts only
  await assert.rejects(form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.objects.join() === 'Contacts');
  assert.equal((await state())[1], undefined, 'nothing was picked');
});

test('a lookup option that is listed but takes no click says so, not that none is listed, no org', { timeout: 80_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const PARIS = '001C100000XVXrEIAX';
  await page.setContent(`<div role="dialog"><input role="combobox" aria-label="Parent Account">
    <div role="listbox" aria-label="Parent Account" style="position:relative"><div role="group" aria-label="Search Results">
    <div role="option" data-value="${PARIS}" onclick="document.body.dataset.picked='Paris'"><div>Acme</div><div>Account | Paris</div></div></div>
    <div style="position:absolute;inset:0"></div></div><button>Save</button></div>`);
  t.mock.method(api, 'call', async (s, path) => (path.startsWith('/ui-api/object-info/') ? { fields: { ParentId: { referenceToInfos: [{ apiName: 'Account', nameFields: ['Name'] }] } } } : { apiName: 'Account', fields: { Name: { value: 'Acme' } } }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Account', fields: [{ apiName: 'ParentId', label: 'Parent Account', dataType: 'Reference', editable: true }] } };
  const failed = (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.clickFailed === true && /listed, but every click on it failed/.test(e.message) && e.evidence.options.length === 1;
  await assert.rejects(form.setFields(f, { ParentId: PARIS }), failed);
  await assert.rejects(form.setFields(f, { ParentId: 'Acme' }), failed);
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'nothing was picked');
});

// No org: a create whose dialog closes but whose page never reaches a record is CREATE_UNCONFIRMED, never saved with no id.
test('a create-save that lands on no record page is CREATE_UNCONFIRMED, no org', { timeout: 40_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent('<div role="dialog"><button onclick="this.parentNode.remove()">Save</button></div>');
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [] } };
  await assert.rejects(form.save(f), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.url === 'about:blank');
});

// No org, the gate's H1: a create left open by CREATE_UNCONFIRMED never drives a later dialog with a Save (the activity
// composer on an Account), and a create never names the page's own record as the one it made.
test('a create form belongs to its dialog and never returns the shown record, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [ACCT, TASK] = ['001000000000009AAA', '00T000000000009AAA'];
  const dialog = (go) => `<div role="dialog"><input role="combobox" aria-label="Subject"><button onclick="${go}this.closest('[role=dialog]').remove()">Save</button></div>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<main><button>New</button></main>' }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Task', fields: [{ apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] }));
  const open = async (url, go) => {
    await page.goto(url);
    await page.evaluate((html) => document.querySelector('button').addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', html)), dialog(go));
    return form.createRecord({ page }, 'Task', { timeout: 3_000 });
  };
  const f = await open('https://x.lightning.force.com/lightning/o/Task/home', '');
  await form.setFields(f, { Subject: 'L11 one' });
  await assert.rejects(form.save(f), { code: 'CREATE_UNCONFIRMED' }); // E3: a split-view create opens no record page
  await page.goto(`https://x.lightning.force.com/lightning/r/Account/${ACCT}/view`); // E6: the Account's composer
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), dialog(''));
  await assert.rejects(form.setFields(f, { Subject: 'L11 two' }), { code: 'FORM_CLOSED' });
  await assert.rejects(form.save(f), { code: 'FORM_CLOSED' });
  assert.equal(await page.getByRole('combobox').inputValue(), '', 'nothing typed into the composer');
  // (b) A create opened over a record page whose Save stays on that page is unconfirmed, not that record.
  const g = await open(`https://x.lightning.force.com/lightning/r/Account/${ACCT}/view`, '');
  await assert.rejects(form.save(g), (e) => e.code === 'CREATE_UNCONFIRMED');
  // Control: a create that lands on its new record's page returns that id.
  const h = await open(`https://x.lightning.force.com/lightning/r/Account/${ACCT}/view`, `history.pushState({}, '', '/lightning/r/Task/${TASK}/view');`);
  assert.equal((await form.save(h)).recordId, TASK);
});

// No org, the gate's H-1 on a create: once the new record's id is known, each field the form set is compared with it,
// a lookup by id and a "" clear too; a blocked create reads nothing.
test('a create checks the new record against the fields the form set, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [NEW, ANN, OTHER] = ['00T000000000002AAA', '003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  let body = '';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rec = null;
  const paths = [];
  t.mock.method(api, 'call', async (s, path) => { paths.push(path); return path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rec; });
  const row = (who) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: who && 'Ann Lee' } } });
  const fields = [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }];
  const pill = '<ul role="list" aria-label="Name - Current Selection: Ann Lee (Contact)"><li><div>Ann Lee</div></li></ul>';
  const save = async (shown, value, click, confirm) => {
    body = `<div role="dialog"><div id="banner"></div>${shown}<button onclick="${click || `history.pushState({}, '', '/lightning/r/Task/${NEW}/view'); this.parentNode.remove()`}">Save</button></div>`;
    await page.goto('https://x.lightning.force.com/lightning/o/Task/home');
    return form.save({ scope: page.getByRole('dialog'), s: { page }, model: { fields, objectApiName: 'Task' }, recordId: null, set: { WhoId: { value, kind: 'Reference', shown: value ? 'Ann Lee' : '', ...(confirm && { confirm }) } } });
  };
  // The review's N7: a confirm field the form no longer showed at Save was not compared, so the create is unproved.
  rec = row(ANN);
  await assert.rejects(save('', ANN, undefined, true), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.recordId === NEW && e.evidence.values.notChecked[0].apiName === 'WhoId'
    && /created, but the record id given for WhoId was not compared$/.test(e.message)); // worded as an edit's (the delta's row 9)
  assert.equal((await save('', ANN)).outcome, 'saved', 'control: a field not to confirm, not compared, is in notChecked only');
  rec = row(OTHER);
  await assert.rejects(save(pill, ANN), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.recordId === NEW && e.evidence.values.mismatched[0].stored === OTHER);
  rec = row(ANN);
  await assert.rejects(save('<input role="combobox" aria-label="Name">', ''), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.values.mismatched[0].apiName === 'WhoId');
  const r = await save(pill, ANN);
  assert.deepEqual([r.outcome, r.recordId, r.values.checked], ['saved', NEW, ['WhoId']], 'control: the record holds the id set');
  // A blocked create stays blocked, with nothing read.
  paths.length = 0;
  const blocked = await save(pill, ANN, "banner.innerHTML='<span>Review the errors on this page.</span><ul><li><span class=errorsListLink>These required fields must be completed: Subject</span></li></ul>'");
  assert.deepEqual([blocked.outcome, paths], ['blocked', []]);
});

// No org, the org's M1: /ui-api/records gives Task.Who's displayValue as null (measured on sfui-s4-map), so a lookup
// picked by name is checked by the id its option carried; another record stored is still CREATE_UNCONFIRMED.
test('a create checks a lookup picked by name by the id of the option picked, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [NEW, ANN, OTHER] = ['00T000000000002AAA', '003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  const aura = '<script>window.$A = { getComponent: (g) => ({ getComponentValueProvider: () => ({ get: (k) => (k === \'v.value\' ? { id: g } : null) }) }) };</script>';
  const body = auraLookup(auraRow('Ann Lee', 'Acme', 'ann').replace('<a ', `<a data-aura-rendered-by="${ANN}" `)) + aura;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rec;
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rec));
  const row = (who) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: null } } });
  const create = async () => {
    await page.goto('https://x.lightning.force.com/lightning/o/Task/home');
    await page.evaluate((id) => document.querySelector('[role=dialog] > button').addEventListener('click', (e) => { history.pushState({}, '', `/lightning/r/Task/${id}/view`); e.target.parentNode.remove(); }), NEW);
    const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
    await form.setFields(f, { WhoId: 'Ann Lee' });
    return form.save(f);
  };
  rec = row(ANN);
  const r = await create();
  assert.deepEqual([r.outcome, r.recordId, r.values.checked], ['saved', NEW, ['WhoId']]);
  rec = row(OTHER);
  // The delta's row 8: the evidence keeps the name typed beside the option id compared.
  await assert.rejects(create(), (e) => e.code === 'CREATE_UNCONFIRMED' && assert.deepEqual(e.evidence.values.mismatched, [{ apiName: 'WhoId', typed: ANN, stored: OTHER, name: 'Ann Lee' }]) === undefined
    && /does not hold the record picked by name for WhoId$/.test(e.message)); // row 12: no record id was given
});

// No org, the delta's row 14: an LWC lookup picked by name is checked by its option's data-value id, so a twin of the
// name stored instead is CREATE_UNCONFIRMED, though its name matches.
test('a create checks an LWC lookup picked by name by its option\'s data-value id, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [NEW, PARIS, LYON] = ['001000000000002AAA', '001C100000XVXrEIAX', '001C100000XZ8PWIA1'];
  const body = `<div role="dialog"><input role="combobox" aria-label="Parent Account"><div role="listbox" aria-label="Parent Account"><div role="group" aria-label="Search Results">
    <div role="option" data-value="${PARIS}"><div>Acme</div><div>Account | Paris</div></div></div></div>
    <button onclick="history.pushState({}, '', '/lightning/r/Account/${NEW}/view'); this.parentNode.remove()">Save</button></div>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  let rec;
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { ParentId: { relationshipName: 'Parent' } } } : rec));
  const row = (id) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, ParentId: { value: id }, Parent: { displayValue: 'Acme' } } });
  const create = async () => {
    await page.goto('https://x.lightning.force.com/lightning/o/Account/home');
    const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Account', fields: [{ apiName: 'ParentId', label: 'Parent Account', dataType: 'Reference', editable: true }] } };
    await form.setFields(f, { ParentId: 'Acme' });
    return form.save(f);
  };
  rec = row(LYON);
  await assert.rejects(create(), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.values.mismatched[0].stored === LYON);
  rec = row(PARIS);
  const r = await create();
  assert.deepEqual([r.outcome, r.recordId, r.values.checked], ['saved', NEW, ['ParentId']], 'control: the record holds the option\'s id');
});

// No org: a Task dialog's picklist is an Aura <a role=combobox> named "Priority Normal" (label plus value, measured on
// sfui-s4-map) whose unnamed listbox sits in a popup outside the dialog; Assigned To shows a pill. None of them is missing.
test('an Aura picklist is found, set and read back, and a lookup pill is not missing, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const pick = (label, value, options) => `<li><span id="${label}-l">${label}</span><a role="combobox" href="#" aria-labelledby="${label}-l ${label}-v" aria-controls="${label}-lb"
    onclick="document.getElementById('${label}-lb').hidden=false;return false"><span id="${label}-v">${value}</span></a></li>`;
  const list = (label, options) => `<div id="${label}-lb" hidden><div role="listbox">${options.map((o) => `<a role="option" href="#" title="${o}" onclick="document.getElementById('${label}-v').textContent='${o}';this.closest('[hidden]') || (document.getElementById('${label}-lb').hidden=true);return false">${o}</a>`).join('')}</div></div>`;
  const dialog = `<div role=dialog><ul>${pick('Status', 'Not Started')}${pick('Priority', 'Normal')}
    <li><span>Assigned To</span><ul role="list" aria-label="Assigned To - Current Selection: Ann (User)"><li>Ann</li></ul></li></ul><button>Save</button></div>${list('Status', ['Not Started', 'Completed'])}${list('Priority', ['High', 'Normal', 'Low'])}`;
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  const fields = [['Status', 'Status', 'Picklist'], ['Priority', 'Priority', 'Picklist'], ['OwnerId', 'Assigned To', 'Reference'], ['Gone__c', 'Gone', 'Picklist']]
    .map(([apiName, label, dataType]) => ({ apiName, label, dataType, editable: true }));
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Task', fields }));
  await page.setContent(`<main><button onclick="document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(dialog).replace(/"/g, '&quot;')})">New</button></main>`);
  const f = await form.createRecord({ page }, 'Task', { timeout: 3_000 });
  assert.deepEqual(f.missing, ['Gone__c'], 'control: a picklist the dialog does not show is missing');
  await form.setFields(f, { Priority: 'High', Status: 'Completed' });
  assert.deepEqual(await page.locator('[id$="-v"]').allInnerTexts(), ['Completed', 'High']);
  await assert.rejects(form.setFields(f, { Priority: 'Urgent' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.join() === 'High,Normal,Low');
});

// No org: an Aura dialog blocks a save in place (measured on sfui-s4-map): "Review the errors on this page.", a list
// under the failing field's row, the banner's own list for the page. Its banner stays up through the next Save.
test('a save an Aura dialog blocks is outcome blocked with its field errors, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const body = `<div role="dialog"><div id="banner"></div>
    <div role="listitem" class="forcePageBlockItem"><span>Related To</span><div id="what"></div></div>
    <div role="listitem" class="forcePageBlockItem"><span>Status</span><a role="combobox" href="#">Not Started</a></div>
    <button onclick="save()">Save</button></div>
    <script>window.save = () => setTimeout(() => (window.next || (() => {}))(), 200);
    window.block = () => { banner.innerHTML = '<span>Review the errors on this page.</span><ul><li><span class="errorsListLink">These required fields must be completed: Status</span></li></ul>';
      what.innerHTML = '<ul class="has-error" role="alert"><li class="form-element__help">You cannot relate an account to this task.</li></ul>'; };</script>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  t.mock.method(api, 'call', async () => ({ fields: {} }));
  const f = { scope: page.getByRole('dialog'), s: { page }, recordId: id, model: { objectApiName: 'Task', fields: [{ apiName: 'WhatId', label: 'Related To' }, { apiName: 'Status', label: 'Status' }] } };
  await page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  await page.evaluate(() => { window.next = window.block; });
  const t0 = Date.now();
  const r = await form.save(f);
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
  assert.deepEqual([r.outcome, r.fieldErrors, r.pageErrors], ['blocked', [{ apiName: 'WhatId', label: 'Related To', message: 'You cannot relate an account to this task.' }], ['These required fields must be completed: Status']]);
  await page.evaluate(() => { window.next = window.block; }); // blocked again: the banner never went away
  assert.equal((await form.save(f)).outcome, 'blocked');
  await page.evaluate(() => { window.next = () => document.querySelector('[role=dialog]').remove(); });
  assert.equal((await form.save(f)).outcome, 'saved', 'the stale banner is not a block once the dialog closes');
});

// No org, the gate's M-A: after a block, a corrected save the server answers after 7 s clears the errors at once and
// closes the dialog late; it is saved, not blocked. A Save clicked within 1 s of a block is dropped (measured), so a
// block is handed back after that settle and an at-once corrected save still lands.
test('a slow save after a block is saved, and a block is handed back after the drop window, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const body = `<div role="dialog"><div id="banner"></div>
    <div role="listitem" class="forcePageBlockItem"><span>Related To</span><div id="what"></div></div>
    <button onclick="save()">Save</button></div>
    <script>window.save = () => { if (Date.now() - (window.blockedAt || 0) < 1000) return; window.next(); };
    window.block = () => setTimeout(() => { window.blockedAt = Date.now(); banner.innerHTML = '<span>Review the errors on this page.</span>';
      what.innerHTML = '<ul class="has-error" role="alert"><li class="form-element__help">You cannot relate an account to this task.</li></ul>'; }, 200);
    window.slow = () => { what.innerHTML = ''; setTimeout(() => document.querySelector('[role=dialog]').remove(), 7000); };
    window.fast = () => setTimeout(() => document.querySelector('[role=dialog]').remove(), 200);</script>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  t.mock.method(api, 'call', async () => ({ fields: {} }));
  const f = { scope: page.getByRole('dialog'), s: { page }, recordId: id, model: { objectApiName: 'Task', fields: [{ apiName: 'WhatId', label: 'Related To' }] } };
  const open = () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  await open();
  await page.evaluate(() => { window.next = window.block; });
  assert.equal((await form.save(f)).outcome, 'blocked', 'control: a real block, with its error');
  await page.waitForTimeout(1_000); // past the drop window, so this half does not lean on the settle
  await page.evaluate(() => { window.next = window.slow; });
  assert.equal((await form.save(f)).outcome, 'saved', 'a slow corrected save is not blocked');
  // The settle: a save at once after a block is not dropped.
  await open();
  await page.evaluate(() => { window.next = window.block; });
  assert.equal((await form.save(f)).outcome, 'blocked');
  await page.evaluate(() => { window.next = window.fast; });
  assert.equal((await form.save(f)).outcome, 'saved', 'the corrected save after the block landed');
});

// A Task edit dialog whose banner lists a page error (list) and that closes ms after the Save (close).
async function pageListPage(t) {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div role="dialog"><div id="banner"></div>
    <button onclick="window.next()">Save</button></div>
    <script>window.list = (text) => { banner.innerHTML = '<span>Review the errors on this page.</span><ul><li><span class="errorsListLink">' + text + '</span></li></ul>'; };
    window.close = (ms) => setTimeout(() => document.querySelector('[role=dialog]').remove(), ms);</script>` }));
  t.mock.method(api, 'call', async () => ({ fields: {} }));
  await page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  return { page, f: { scope: page.getByRole('dialog'), s: { page }, recordId: id, model: { objectApiName: 'Task', fields: [{ apiName: 'Subject', label: 'Subject' }] } } };
}
const REQUIRED = 'These required fields must be completed: Subject';

// No org, the org's M2 (N2): an earlier block's page list keeps its nodes through a corrected save the server answers
// late, and a new block draws new ones (measured on sfui-s4-map), so only a new error blocks this save.
test('a corrected save is not blocked by the page list an earlier block left, no org', { timeout: 90_000 }, async (t) => {
  const { page, f } = await pageListPage(t);
  await page.evaluate((m) => { window.next = () => window.list(m); }, REQUIRED);
  assert.deepEqual((await form.save(f)).pageErrors, [REQUIRED], 'control: the first block');
  await page.waitForTimeout(1_000);
  const again = await form.save(f);
  assert.deepEqual([again.outcome, again.pageErrors], ['blocked', [REQUIRED]], 'a second real block, same text, new nodes');
  await page.waitForTimeout(1_000);
  await page.evaluate(() => { window.next = () => window.close(7_000); });
  assert.equal((await form.save(f)).outcome, 'saved', 'the corrected save the server answered after 7 s');
});

// No org, N6: under a stale banner a save gets 5 s to close before its errors are read, so a server's block that lands
// seconds after the Save (the org's N1 conflict, at 6.4 s) is blocked then, not at the save's bound.
test('a block that lands seconds after a save under a stale banner is read then, no org', { timeout: 90_000 }, async (t) => {
  const { page, f } = await pageListPage(t);
  await page.evaluate((m) => { window.next = () => window.list(m); }, REQUIRED);
  await form.save(f);
  await page.waitForTimeout(1_000);
  const MODIFIED = 'This record was modified by User User during your edit session.';
  await page.evaluate((m) => { window.next = () => setTimeout(() => window.list(m), 4_500); }, MODIFIED);
  const t0 = Date.now();
  const r = await form.save(f, { timeout: 20_000 });
  assert.deepEqual([r.outcome, r.pageErrors], ['blocked', [MODIFIED]]);
  assert.ok(Date.now() - t0 < 12_000, `took ${Date.now() - t0} ms`);
});

// A Task edit dialog that blocks in place as an Aura dialog does: banner1 shows its banner, err the field error.
async function blockedPage(t) {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div role="dialog"><div id="banner"></div>
    <div role="listitem" class="forcePageBlockItem"><span>Related To</span><div id="what"></div></div>
    <button onclick="window.next()">Save</button></div>
    <script>window.banner1 = () => { banner.innerHTML = '<span>Review the errors on this page.</span>'; };
    window.err = () => { what.innerHTML = '<ul class="has-error" role="alert"><li class="form-element__help">You cannot relate an account to this task.</li></ul>'; };</script>` }));
  t.mock.method(api, 'call', async () => ({ fields: {} }));
  await page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  return { page, f: { scope: page.getByRole('dialog'), s: { page }, recordId: id, model: { objectApiName: 'Task', fields: [{ apiName: 'WhatId', label: 'Related To' }] } } };
}

// No org, the gate's M-2 (G13C): a stale banner, no error and a dialog that never closes, reached past the save's own
// bound, ends coded at once; the wait is never given 0 ms, which Playwright reads as no limit.
test('a block wait reached past the bound ends coded, not a hang, no org', { timeout: 60_000 }, async (t) => {
  const { page, f } = await blockedPage(t);
  await page.evaluate(() => { window.next = () => setTimeout(window.banner1, 200); });
  await assert.rejects(form.save(f, { timeout: 10_000 }), { code: 'SAVE_UNCONFIRMED' });
  await page.waitForTimeout(1_000);
  await page.evaluate(() => { window.next = () => {}; });
  let timer;
  const hung = new Promise((res) => { timer = setTimeout(() => res('HUNG past 25 s'), 25_000); });
  const r = await Promise.race([form.save(f, { timeout: 3_000 }).then((x) => x.outcome, (e) => e.code), hung]);
  clearTimeout(timer);
  assert.notEqual(r, 'HUNG past 25 s');
});
// No org, the gate's L-3: a banner with no error and a dialog that never closes ends at the bound in the coded result.
test('a banner with no error and a dialog that never closes is unconfirmed at the bound, no org', { timeout: 60_000 }, async (t) => {
  const { page, f } = await blockedPage(t);
  await page.evaluate(() => { window.next = () => setTimeout(window.banner1, 200); });
  const t0 = Date.now();
  await assert.rejects(form.save(f, { timeout: 6_000 }), (e) => e.code === 'SAVE_UNCONFIRMED' && /did not close within 6000 ms/.test(e.message));
  assert.ok(Date.now() - t0 < 12_000, `took ${Date.now() - t0} ms`);
});
// No org, the gate's L-1 (G13A): a field error that renders after the 3 s read is read once more at the bound, so the
// save is blocked with it, not unconfirmed.
test('a block whose field error renders late is blocked at the bound, no org', { timeout: 60_000 }, async (t) => {
  const { page, f } = await blockedPage(t);
  await page.evaluate(() => { window.next = () => setTimeout(() => { window.banner1(); setTimeout(window.err, 4_000); }, 200); });
  const r = await form.save(f, { timeout: 8_000 });
  assert.deepEqual([r.outcome, r.fieldErrors], ['blocked', [{ apiName: 'WhatId', label: 'Related To', message: 'You cannot relate an account to this task.' }]]);
});

// No org, the delta's row 1: Aura re-draws a field error on every block (measured on sfui-s4-map, Assigned To empty),
// so one drawn before the first Save and a second block both name the field, in seconds.
test('a field error re-drawn by each block names its field, no org', { timeout: 90_000 }, async (t) => {
  const { page, f } = await blockedPage(t);
  const field = [{ apiName: 'WhatId', label: 'Related To', message: 'You cannot relate an account to this task.' }];
  await page.evaluate(() => { window.banner1(); window.err(); window.next = () => setTimeout(() => { window.banner1(); window.err(); }, 200); });
  for (const which of ['drawn before the first Save', 'a second block']) {
    const t0 = Date.now();
    const r = await form.save(f, { timeout: 20_000 });
    assert.deepEqual([r.outcome, r.fieldErrors], ['blocked', field], which);
    assert.ok(Date.now() - t0 < 10_000, `${which} took ${Date.now() - t0} ms`);
    await page.waitForTimeout(1_000);
  }
});

// No org: a Task create stays on the Task home and its toast holds no id, so the new id is the one Task with the typed
// Subject that this user holds after the Save and did not before; none or two stay CREATE_UNCONFIRMED with the count.
test('a Task create is confirmed by the one new Task with its Subject, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [ME, OLD, NEW, NEW2] = ['005000000000001AAA', '00T000000000001AAA', '00T000000000002AAA', '00T000000000003AAA'];
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button onclick="this.parentNode.remove()">Save</button></div>' }));
  let reads = [];
  const paths = [];
  // The new Task itself is read too, to compare what the form set (a create is checked as an edit is).
  t.mock.method(api, 'call', async (s, path) => { paths.push(path); if (path.startsWith('/ui-api/records/')) return { fields: { Subject: { value: "L11 o'k" } } }; const r = reads.shift(); if (r instanceof Error) throw r; return { records: r.map((Id) => ({ Id })) }; });
  const f = () => ({ scope: page.getByRole('dialog'), s: { page, tokenUserId: ME }, model: { fields: [], objectApiName: 'Task' }, set: { Subject: { value: "L11 o'k ", kind: 'ComboBox' } } });
  const home = () => page.goto('https://x.lightning.force.com/lightning/o/Task/home');
  await home();
  reads = [[OLD], [NEW, OLD]];
  const t0 = Date.now();
  const r = await form.save(f());
  assert.ok(Date.now() - t0 < 8_000, `took ${Date.now() - t0} ms: it waited for a record page`);
  assert.equal(r.recordId, NEW);
  assert.match(r.recordIdFrom, /created with this Subject/);
  assert.match(decodeURIComponent(paths[0]), new RegExp(`CreatedById = '${ME}' AND Subject = 'L11 o\\\\'k'`));
  await home();
  reads = [[OLD], [NEW2, NEW, OLD]];
  await assert.rejects(form.save(f()), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.tasksMade === 2 && /holds 2 new Tasks with this Subject/.test(e.message));
  await home();
  reads = [[OLD], [OLD]];
  await assert.rejects(form.save(f()), (e) => e.code === 'CREATE_UNCONFIRMED' && e.evidence.tasksMade === 0 && /holds no new Task with this Subject/.test(e.message));
  // The read after the Save failed: no count, only why (the gate's L-C).
  await home();
  reads = [[OLD], new SfUiError('API_ERROR', 'answered 503', { status: 503 })];
  await assert.rejects(form.save(f()), (e) => e.code === 'CREATE_UNCONFIRMED' && !('tasksMade' in e.evidence) && /could not be read/.test(e.message) && /answered 503/.test(e.evidence.unread.join()));
  // The delta's row 7: the read before the Save failed, so the message says so, not only that no record page opened.
  await home();
  reads = [new SfUiError('API_ERROR', 'answered 503', { status: 503 })];
  await assert.rejects(form.save(f()), (e) => e.code === 'CREATE_UNCONFIRMED' && /could not be read before the Save/.test(e.message) && /answered 503/.test(e.evidence.unread.join()));
});

// No org: an edit whose form hides as the page leaves the record (a login page), with no record read (no instanceUrl), is unconfirmed.
test('an edit-save whose page leaves the record is SAVE_UNCONFIRMED, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button>Save</button></div>' }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [] }, recordId: id };
  await page.goto(view);
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/secur/login.jsp'); document.querySelector('[role=dialog]').remove(); }));
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && /login\.jsp/.test(e.evidence.url) && e.evidence.recordId === id);
  await page.goto(view);
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => document.querySelector('[role=dialog]').remove()));
  assert.equal((await form.save(f)).outcome, 'saved'); // control: the form closed on its own record's page
});

// No org: an edit that saves and then leaves the record is saved when its SystemModstamp moved by the form's user only.
test('an edit-save that leaves the record is saved only when its SystemModstamp moved, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const reads = [];
  let stamps = [];
  const me = '005000000000001AAA';
  let by = me;
  api.call = async (s, path, o) => { reads.push([path, o.as]); return { fields: { SystemModstamp: { value: stamps.shift() }, LastModifiedById: { value: by } } }; };
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button>Save</button></div>' }));
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields: [], objectApiName: 'Account' }, recordId: id };
  const leave = () => page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); }));
  await page.goto(view);
  await leave();
  stamps = ['2026-11-12T06:04:37.000+0000', '2026-11-12T06:04:54.000+0000'];
  assert.equal((await form.save(f)).outcome, 'saved');
  assert.deepEqual(reads[0], [`/ui-api/records/${id}?fields=Account.SystemModstamp,Account.LastModifiedById`, 'admin']);
  await page.goto(view);
  await leave();
  stamps = ['2026-11-12T06:04:54.000+0000', '2026-11-12T06:04:54.000+0000'];
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.modstamp.after.at === e.evidence.modstamp.before.at && /did not move$/.test(e.message));
  // Arm W: the Save never reached the server, and another user's write in the window moved the stamp.
  await page.goto(view);
  await leave();
  stamps = ['2026-11-12T06:04:54.000+0000', '2026-11-12T06:04:58.000+0000'];
  by = '005000000000002AAA';
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.modstamp.runsAs === me);
});

// No org: a left edit is saved only when the record holds each value the form set, compared by kind; a kind not
// compared, and a value the record held before, are named in values.notChecked, never passed in silence.
test('an edit-save that leaves the record checks each stored value against the one typed, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const me = '005000000000001AAA';
  const acct = '001000000000009AAA';
  const old = { Phone: '555-0100', Kind__c: 'Fruit', Account__c: null, At__c: null, Start__c: null, Count__c: 5, Tags__c: 'Alpha', Body__c: '<p>a</p>', Done__c: false };
  const typed = { Phone: '555-0108', Kind__c: 'Tool', Account__c: 'Acme', At__c: '2026-12-31T17:30:00Z', Start__c: '14:30', Count__c: '7.50', Tags__c: 'Beta;Alpha', Body__c: 'b', Done__c: false };
  const saved = { Phone: '555-0108', Kind__c: 'TOOL', Account__c: acct, At__c: '2026-12-31T17:30:00.000Z', Start__c: '14:30:00.000Z', Count__c: 7.5, Tags__c: 'Alpha;Beta', Body__c: '<p>b</p>', Done__c: false };
  const kinds = { Phone: 'Phone', Kind__c: 'Picklist', Account__c: 'Reference', At__c: 'DateTime', Start__c: 'Time', Count__c: 'Double', Tags__c: 'MultiPicklist', Body__c: 'TextArea', Done__c: 'Boolean' };
  let rows = [];
  const rec = (at, values) => ({ fields: { SystemModstamp: { value: at }, LastModifiedById: { value: me }, Account__r: { displayValue: values.Account__c ? 'Acme' : null },
    ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, displayValue: k === 'Kind__c' ? 'Tool' : null }])) } });
  api.call = async (s, path) => (path.includes('object-info') ? { fields: { Account__c: { relationshipName: 'Account__r' } } } : rows.shift());
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  // The form's boxes as they show the typed values, each label its field's name less __c.
  const boxes = `<input aria-label="Phone" value="555-0108"><div role="combobox" aria-label="Kind">Tool</div><input role="combobox" aria-label="Account" value="Acme">
    <div role="group" aria-label="At"><input aria-label="Date" value="12/31/2026"><input role="combobox" aria-label="Time" value="5:30 PM"></div><input role="combobox" aria-label="Start" value="2:30 PM">
    <lightning-input><input role="spinbutton" aria-label="Count" value="7.50"></lightning-input><script>document.querySelector('lightning-input').value = '7.50'</script><div role="group" aria-label="Tags"><div role="listbox" aria-label="Chosen"><div role="option">Beta</div><div role="option">Alpha</div></div></div>
    <div role="textbox" contenteditable aria-label="Body">b</div><input type="checkbox" aria-label="Done">`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div role="dialog">${boxes}<button>Save</button></div>` }));
  const shown = { Phone: '555-0108', Kind__c: 'Tool', Account__c: 'Acme', At__c: '12/31/2026 5:30 PM', Start__c: '2:30 PM', Count__c: '7.50', Tags__c: 'Alpha;Beta', Body__c: 'b', Done__c: 'false' };
  const set = Object.fromEntries(Object.entries(typed).map(([k, value]) => [k, { value, kind: kinds[k], rich: k === 'Body__c', shown: shown[k] }]));
  const fields = Object.keys(typed).map((apiName) => ({ apiName, label: apiName.replace(/__c$/, ''), dataType: kinds[apiName], editable: true }));
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields, objectApiName: 'Account' }, recordId: id, set };
  const leave = async () => { await page.goto(view); await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); })); };
  await leave();
  rows = [rec('2026-11-12T06:04:37.000+0000', old), rec('2026-11-12T06:04:54.000+0000', saved)];
  const ok = await form.save(f);
  assert.equal(ok.outcome, 'saved');
  assert.deepEqual(ok.values.checked.sort(), ['Account__c', 'At__c', 'Count__c', 'Kind__c', 'Phone', 'Start__c', 'Tags__c']);
  assert.deepEqual(ok.values.notChecked, [{ apiName: 'Body__c', why: 'rich text is stored as HTML' }, { apiName: 'Done__c', why: 'the record held this value before the save, so it proves nothing' }]);
  // Arm W: the stamp moved by the form's user (its other session or a flow), but the record never took the typed Phone.
  await leave();
  rows = [rec('2026-11-12T06:04:54.000+0000', old), rec('2026-11-12T06:04:58.000+0000', { ...saved, Phone: '555-0100' })];
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && JSON.stringify(e.evidence.values.mismatched) === '[{"apiName":"Phone","typed":"555-0108","stored":"555-0100"}]');
});

// No org: the value checked is the one the form holds at Save, not the one typed earlier: a box typed again, a dependent
// picklist its controller reset. A box the form no longer shows is named, and a record that holds the old value still fails.
test('a left edit is checked against what the form holds at Save, no org', { timeout: 120_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const me = '005000000000001AAA';
  let rows = [];
  const rec = (at, values) => ({ fields: { SystemModstamp: { value: at }, LastModifiedById: { value: me }, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, displayValue: null }])) } });
  api.call = async () => rows.shift();
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  let body = '';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div role="dialog">${body}<button>Save</button></div>` }));
  const fields = [['Phone', 'Phone', 'Phone'], ['Detail__c', 'Detail', 'Picklist'], ['Due__c', 'Due', 'Date']].map(([apiName, label, dataType]) => ({ apiName, label, dataType, editable: true }));
  const set = { Phone: { value: '555-0301', kind: 'Phone', rich: false, shown: '555-0301' }, Detail__c: { value: 'Pear', kind: 'Picklist', rich: false, shown: 'Pear' }, Due__c: { value: '2026-12-31', kind: 'Date', rich: false, shown: '12/31/2026' } };
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields, objectApiName: 'Account' }, recordId: id, set };
  const leave = async () => { await page.goto(view); await page.evaluate(() => document.querySelector('button:last-child').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); })); };
  const old = { Phone: '555-0000', Detail__c: 'Apple', Due__c: null };
  // Phone typed again (sf_fill), Detail reset by its controller, Due's box shows another date: the record holds the form's.
  body = '<input aria-label="Phone" value="555-0302"><button role="combobox" aria-label="Detail">--None--</button><input aria-label="Due" value="1/2/2027">';
  await leave();
  rows = [rec('2026-11-12T06:04:37.000+0000', old), rec('2026-11-12T06:04:54.000+0000', { Phone: '555-0302', Detail__c: null, Due__c: '2027-01-02' })];
  const ok = await form.save(f);
  assert.deepEqual(ok.values.checked, ['Phone', 'Detail__c']);
  assert.deepEqual(ok.values.notChecked, [{ apiName: 'Due__c', why: 'the form showed "1/2/2027" at Save, not the value set' }]);
  // The record kept the earlier typed Phone, not the one the form held: a mismatch. A box gone from the form is named.
  body = '<input aria-label="Phone" value="555-0302"><button role="combobox" aria-label="Detail">Pear</button>';
  await leave();
  rows = [rec('2026-11-12T06:04:54.000+0000', old), rec('2026-11-12T06:04:58.000+0000', { Phone: '555-0301', Detail__c: 'Pear', Due__c: null })];
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && JSON.stringify(e.evidence.values.mismatched) === '[{"apiName":"Phone","typed":"555-0302","stored":"555-0301"}]'
    && e.evidence.values.notChecked.some((n) => n.apiName === 'Due__c' && /no longer showed it/.test(n.why)));
  // An emptied Date box holds nothing; a rich box typed with sf_fill is rich; a box whose read throws at Save is named.
  body = `<input aria-label="Due" value=""><div role="textbox" contenteditable aria-label="Body">b</div><lightning-input><input role="spinbutton" aria-label="Count" value="7"></lightning-input>
    <script>Object.defineProperty(document.querySelector('lightning-input'), 'value', { get() { throw new Error('detached'); } });</script>`;
  fields.push({ apiName: 'Body__c', label: 'Body', dataType: 'TextArea', editable: true }, { apiName: 'Count__c', label: 'Count', dataType: 'Double', editable: true });
  f.set = { Due__c: set.Due__c, Count__c: { value: '7', kind: 'Double', rich: false, shown: '7' } };
  form.filled(f, 'Body', 'b');
  await leave();
  rows = [rec('2026-11-12T06:04:58.000+0000', { Due__c: '2026-12-31', Body__c: '<p>a</p>', Count__c: 5 }), rec('2026-11-12T06:05:09.000+0000', { Due__c: null, Body__c: '<p>b</p>', Count__c: 7 })];
  const more = await form.save(f);
  assert.deepEqual(more.values.checked, ['Due__c']);
  assert.deepEqual(more.values.notChecked, [{ apiName: 'Count__c', why: 'the form no longer showed it at Save, so what it saved is not known' }, { apiName: 'Body__c', why: 'rich text is stored as HTML' }]);
});

// No org: a number box that blurs shows display text ($1,500.50, 35%, 1,235) and its lightning-input host the number,
// as on sfui-s4-flow; the host's number is the one checked. A number box with no host is named, never compared as text.
test('a left edit checks a blurred number box by its number, not its display text, no org', { timeout: 240_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const me = '005000000000001AAA';
  let rows = [];
  const rec = (at, values) => ({ fields: { SystemModstamp: { value: at }, LastModifiedById: { value: me }, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, displayValue: null }])) } });
  api.call = async () => rows.shift();
  const page = await localPage(t);
  const id = '006000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Opportunity/${id}/view`;
  const num = (label, fmt, v) => `<lightning-input data-fmt="${fmt}"><input role="spinbutton" aria-label="${label}" data-v="${v}"></lightning-input>`;
  const script = `<script>const F = { cur: { style: 'currency', currency: 'USD' }, dec: { maximumFractionDigits: 0 } };
    const show = (h) => (h.dataset.fmt === 'pct' ? h.value + '%' : new Intl.NumberFormat('en-US', F[h.dataset.fmt]).format(+h.value));
    for (const h of document.querySelectorAll('lightning-input')) { const i = h.querySelector('input'); h.value = i.dataset.v; i.value = show(h);
      i.onfocus = () => { i.value = h.value; }; i.oninput = () => { h.value = i.value; }; i.onblur = () => { i.value = show(h); }; }</script>`;
  const body = `${num('Amount', 'cur', '500')}${num('Probability', 'pct', '10')}${num('Count', 'dec', '5')}<input aria-label="Name" value="old"><input role="spinbutton" aria-label="Bare" value="1">`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div role="dialog">${body}<button>Save</button></div>${script}` }));
  const fields = [['Amount', 'Currency'], ['Probability', 'Percent'], ['Count__c', 'Double'], ['Name', 'String'], ['Bare__c', 'Double']].map(([apiName, dataType]) => ({ apiName, label: apiName.replace(/__c$/, ''), dataType, editable: true }));
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields, objectApiName: 'Opportunity' }, recordId: id };
  const old = { Amount: 500, Probability: 10, Count__c: 5, Name: 'old', Bare__c: 1 };
  let at = 0;
  let shown; // the number boxes' text at Save
  const stamp = () => `2026-11-13T06:00:${String(at++).padStart(2, '0')}.000+0000`;
  const run = async (values, after, stored, was = old) => {
    f.set = {};
    await page.goto(view);
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Opportunity/home'); document.querySelector('[role=dialog]').remove(); }));
    await form.setFields(f, values); // the last field set blurs the number boxes before it
    if (after) await page.evaluate(after);
    shown = await page.locator('lightning-input input').evaluateAll((els) => els.map((e) => e.value));
    rows = [rec(stamp(), was), rec(stamp(), { ...was, ...stored })];
    return form.save(f);
  };
  // The gate's m-opp, m-probe, m-neg: each save wrote, each box shows display text at Save.
  assert.deepEqual((await run({ Probability: '35', Amount: '1500.5', Name: 'm' }, null, { Probability: 35, Amount: 1500.5, Name: 'm' })).values.checked.sort(), ['Amount', 'Name', 'Probability']);
  assert.deepEqual(shown, ['$1,500.50', '35%', '5']);
  assert.deepEqual((await run({ Count__c: '1234.5', Name: 'p' }, null, { Count__c: 1234.5, Name: 'p' })).values.checked.sort(), ['Count__c', 'Name']);
  assert.equal(shown[2], '1,235');
  assert.deepEqual((await run({ Amount: '-250', Name: 'n' }, null, { Amount: -250, Name: 'n' })).values.checked.sort(), ['Amount', 'Name']);
  assert.equal(shown[0], '-$250.00');
  // stage-pct: the form resets Probability itself after it was set (a Stage change), so the record holds the form's 10.
  const reset = () => { const h = document.querySelectorAll('lightning-input')[1]; h.value = '10'; h.querySelector('input').value = '10%'; };
  assert.deepEqual((await run({ Probability: '45', Name: 's' }, reset, { Probability: 10, Name: 's' }, { ...old, Probability: 35 })).values.checked.sort(), ['Name', 'Probability']);
  assert.equal(shown[1], '10%');
  // Controls: a record that holds another number is mismatched with the form's number; a box with no host is named.
  await assert.rejects(run({ Amount: '1500.5', Name: 'c' }, null, { Amount: 1500, Name: 'c' }), (e) => e.code === 'SAVE_UNCONFIRMED' && JSON.stringify(e.evidence.values.mismatched) === '[{"apiName":"Amount","typed":"1500.5","stored":1500}]');
  assert.deepEqual((await run({ Bare__c: '2', Name: 'b' }, null, { Bare__c: 2, Name: 'b' })).values.notChecked, [{ apiName: 'Bare__c', why: 'its box gave no number at Save, only display text' }]);
});

// No org: a box typed with sf_fill is checked like one sf_set_fields set (arm W: the Save never wrote, the same user's
// write moved the stamp); a left save with no field set is saved on the stamp but says so, never an empty values.
test('a left edit checks a field typed with sf_fill, and names a save with nothing to compare, no org', { timeout: 240_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const me = '005000000000001AAA';
  let rows = [];
  const rec = (at, Phone) => ({ fields: { SystemModstamp: { value: at }, LastModifiedById: { value: me }, Phone: { value: Phone, displayValue: null } } });
  api.call = async () => rows.shift();
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><input aria-label="Phone" value="555-0302"><button>Save</button></div>' }));
  const fields = [{ apiName: 'Phone', label: 'Phone', dataType: 'Phone', editable: true }, { apiName: 'Fax', label: 'Fax', dataType: 'Phone', editable: true }, { apiName: 'Other__c', label: 'Fax', dataType: 'Phone', editable: true }];
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: me }, model: { fields, objectApiName: 'Account' }, recordId: id };
  const leave = async () => { await page.goto(view); await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); })); };
  await leave();
  rows = [rec('2026-11-12T06:04:37.000+0000', '555-0000'), rec('2026-11-12T06:04:54.000+0000', '555-0000')];
  const bare = await form.save(f);
  assert.equal(bare.outcome, 'saved');
  assert.deepEqual(bare.values, { checked: [], mismatched: [], notChecked: [{ why: 'no field was set through sf_set_fields or sf_fill, so only the stamp and its writer confirm it' }] });
  form.filled(f, 'Fax', '555-0900'); // two fields share the label: neither is guessed
  form.filled(f, 'Phone', '555-0302');
  await leave();
  rows = [rec('2026-11-12T06:04:54.000+0000', '555-0000'), rec('2026-11-12T06:04:58.000+0000', '555-0000')];
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && JSON.stringify(e.evidence.values.mismatched) === '[{"apiName":"Phone","typed":"555-0302","stored":"555-0000"}]'
    && JSON.stringify(e.evidence.values.notChecked) === JSON.stringify([{ label: 'Fax', why: 'sf_fill typed into "Fax", which names more than one editable field of the form' }]));
  assert.deepEqual(Object.keys(f.set), ['Phone']);
  await leave();
  rows = [rec('2026-11-12T06:04:58.000+0000', '555-0000'), rec('2026-11-12T06:05:09.000+0000', '555-0302')];
  assert.deepEqual((await form.save(f)).values.checked, ['Phone']); // control: the record took it
  // Another user wrote last and the record holds the form's Phone: unconfirmed, saying so, with by and values.
  delete f.unmatched; // the Fax note would leave a field unchecked, which is the other message
  const other = '005000000000002AAA';
  await leave();
  rows = [rec('2026-11-12T06:05:09.000+0000', '555-0000'), { fields: { ...rec('2026-11-12T06:05:20.000+0000', '555-0302').fields, LastModifiedById: { value: other } } }];
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.by === other && JSON.stringify(e.evidence.values.checked) === '["Phone"]'
    && e.message.endsWith(`the record holds the values the form set, but ${other} wrote it last, so this save cannot be told from theirs`));
});

// No org: an sf_fill label that names no editable field of the form, or several, is named at the save, and the
// save is not called one with nothing set.
test('an sf_fill label that names no one form field is named in notChecked, no org', () => {
  const fields = [['Fax', 'Fax', true], ['Other__c', 'Fax', true], ['Phone', 'Phone', false]].map(([apiName, label, editable]) => ({ apiName, label, dataType: 'Phone', editable }));
  const f = { model: { fields } };
  form.filled(f, 'Fax', '555-0900');
  form.filled(f, 'Phone', '555-0901');
  assert.equal(f.set, undefined);
  assert.deepEqual(form.valueCheck({}, { fields: {} }, { fields: {} }, f.unmatched).notChecked, [
    { label: 'Fax', why: 'sf_fill typed into "Fax", which names more than one editable field of the form' },
    { label: 'Phone', why: 'sf_fill typed into "Phone", which names no editable field of the form' }]);
});

// No org: a record read that never answers is cut at 5 s, so the Save is still clicked; a left edit is then
// SAVE_UNCONFIRMED, and modstamp.unread says why each read came back null.
test('a record read that hangs or fails leaves a left edit unconfirmed, with why, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const { SfUiError } = require('../src/errors');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const view = `https://x.lightning.force.com/lightning/r/Account/${id}/view`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button>Save</button></div>' }));
  const f = { scope: page.getByRole('dialog'), s: { page, tokenUserId: '005000000000001AAA' }, model: { fields: [], objectApiName: 'Account' }, recordId: id };
  const leave = async () => { await page.goto(view); await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { window.clicked = true; history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); })); };
  let aborted = 0; // answers late, unless the bound aborts it, so a missing bound fails here, not at the test timeout
  api.call = (s, p, o) => new Promise((ok) => { const late = setTimeout(ok, 30_000, {}); o.signal?.addEventListener('abort', () => { aborted++; clearTimeout(late); ok({}); }); });
  await leave();
  const t0 = Date.now();
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && /^TIMEOUT: no answer in 5000 ms$/.test(e.evidence.modstamp.unread[0]) && /could not be read before the Save/.test(e.message));
  assert.ok(Date.now() - t0 < 25_000, `took ${Date.now() - t0} ms`);
  assert.equal(aborted, 1, 'the timed-out request is cancelled, not left open');
  api.call = async () => { throw new SfUiError('API_ERROR', 'GET as admin answered 401 INVALID_SESSION_ID'); };
  await leave();
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.modstamp.unread[0] === 'API_ERROR: GET as admin answered 401 INVALID_SESSION_ID');
  let n = 0; // the read before the click answers, the one after it fails
  api.call = async () => { if (n++) throw new SfUiError('API_ERROR', 'GET as admin answered 503'); return { fields: { SystemModstamp: { value: '2026-11-12T06:04:37.000+0000' }, LastModifiedById: { value: '005000000000001AAA' } } }; };
  await leave();
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.modstamp.after === null && e.evidence.modstamp.before.at === '2026-11-12T06:04:37.000+0000'
    && /could not be read after the Save/.test(e.message) && !/did not move/.test(e.message));
});

// No org: the org's own rewrite of an accepted value is the same value (measured on sfui-s4-flow): a number's grouping
// comma dropped, text trimmed at both ends, an email lowercased. Another value still differs.
test('stored compares a value in the form the org stores it, no org', () => {
  const ok = (kind, typed, value) => form.stored(kind, typed, { value });
  assert.equal(ok('Int', '1,000', 1000), true);
  assert.equal(ok('Currency', '1,500', 1500), true);
  assert.equal(ok('String', 'L10G acct2 ', 'L10G acct2'), true);
  assert.equal(ok('TextArea', '  lead and trail  ', 'lead and trail'), true);
  assert.equal(ok('Email', 'L10G.Mixed@Example.COM', 'l10g.mixed@example.com'), true);
  assert.equal(ok('Int', '1,001', 1000), false);
  assert.equal(ok('String', 'L10G acct2', 'L10G acct3'), false);
  assert.equal(ok('Email', 'a@example.com', 'b@example.com'), false);
});

// No org: a number typed past its field's scale is stored rounded (Probability 35.5 as 36) or truncated
// (NumberOfEmployees 2000.5 as 2000) on sfui-s4-flow, so either neighbour at that scale matches; nothing further away.
test('stored compares a number typed past its scale at that scale, no org', () => {
  const ok = (kind, typed, value, scale) => form.stored(kind, typed, { value }, undefined, scale);
  assert.equal(ok('Percent', '35.5', 36, 0), true);
  assert.equal(ok('Int', '2000.5', 2000, 0), true);
  assert.equal(ok('Percent', '35.5', 37, 0), false);
  assert.equal(ok('Int', '2000.5', 1999, 0), false);
  assert.equal(ok('Currency', '10.005', 10.005, 3), true);
  assert.equal(ok('Currency', '10.005', 10.01, 3), false);
  assert.equal(ok('Currency', '10.005', 10.01, 2), true);
  assert.equal(ok('Percent', '35', 36, 0), false);
});

// No org: the UI API names a combobox field's type ComboBox (Task.Subject on sfui-s4-flow); it compares as text.
test('stored compares a ComboBox field as text, no org', () => {
  assert.equal(form.stored('ComboBox', 'Call', { value: 'Call' }), true);
  assert.equal(form.stored('ComboBox', 'Call', { value: 'Email' }), false);
});

// No org: setMulti picks a multi-select's labels, so labels that differ from the API values compare by the display
// value, as a picklist does (no such field on sfui-s4-flow, so a stub).
test('stored compares a multi-select by its labels, no org', () => {
  assert.equal(form.stored('MultiPicklist', 'Gold Tier;Silver Tier', { value: 'Gold;Silver', displayValue: 'Gold Tier;Silver Tier' }), true);
  assert.equal(form.stored('MultiPicklist', 'Gold;Silver', { value: 'Gold;Silver', displayValue: 'Gold Tier;Silver Tier' }), true);
  assert.equal(form.stored('MultiPicklist', 'Gold Tier', { value: 'Gold;Silver', displayValue: 'Gold Tier;Silver Tier' }), false);
});

// No org: the value check's edges. A cleared field holds nothing (not 0, not a time), a CRLF text equals its LF form,
// and a field the read missed or a kind not compared is named in notChecked, never mismatched or passed.
test('the value check names what it cannot compare and compares a clear and a CRLF text, no org', () => {
  assert.equal(form.stored('Double', '', { value: null }), true);
  assert.equal(form.stored('Double', '', { value: 0 }), false);
  assert.equal(form.stored('DateTime', '', { value: null }), true);
  assert.equal(form.stored('TextArea', 'a\r\nb', { value: 'a\nb' }), true);
  const held = { Phone: { value: '555', kind: 'Phone' }, Secret__c: { value: 'x', kind: 'EncryptedString' } };
  const out = form.valueCheck(held, { fields: {} }, { fields: { Secret__c: { value: 'x' } } });
  assert.deepEqual(out, { checked: [], mismatched: [], notChecked: [
    { apiName: 'Phone', why: 'the field was not read back' }, { apiName: 'Secret__c', why: 'a EncryptedString field is not compared' }] });
});

// No org: with no user id known for the form and none on the record, nothing names the writer: unconfirmed.
test('a left edit with no known user and no writer on the record is unconfirmed, no org', { timeout: 120_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const api = require('../src/api');
  const real = api.call;
  t.after(() => { api.call = real; });
  const stamps = ['2026-11-12T06:04:37.000+0000', '2026-11-12T06:04:54.000+0000'];
  api.call = async () => ({ fields: { SystemModstamp: { value: stamps.shift() }, LastModifiedById: { value: null } } });
  const page = await localPage(t);
  const id = '001000000000001AAA';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button>Save</button></div>' }));
  await page.goto(`https://x.lightning.force.com/lightning/r/Account/${id}/view`);
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => { history.pushState({}, '', '/lightning/o/Account/home'); document.querySelector('[role=dialog]').remove(); }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [], objectApiName: 'Account' }, recordId: id };
  await assert.rejects(form.save(f), (e) => e.code === 'SAVE_UNCONFIRMED' && e.evidence.modstamp.runsAs === '');
});

// No org: setFields reads each box back after typing, so a value the form cut or rewrote is VALUE_NOT_SET.
test('setFields reads a typed value back and refuses one the form cut or rewrote, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(`<main><label>Account Number<input maxlength="3"></label><label>Close Date<input oninput="this.value=this.value.replace('2026','2027')"></label>
    <label>Probability (%)<input role="spinbutton" value="10" oninput="if(this.value==='35')this.value='1035'"></label>
    <label>Discount (%)<input role="spinbutton" value="10%" onfocus="this.value=this.value.replace('%','')"></label>
    <label>Score<input role="spinbutton" value="1" oninput="(window.seen ||= []).push(this.value)"></label></main>`);
  const fields = [['AccountNumber', 'Account Number', 'String'], ['CloseDate', 'Close Date', 'Date'], ['Probability', 'Probability (%)', 'Percent'], ['Discount', 'Discount (%)', 'Percent'], ['Score', 'Score', 'Double']]
    .map(([apiName, label, dataType]) => ({ apiName, label, dataType, editable: true }));
  const f = { s: { page }, scope: page.locator('main'), model: { fields }, locale: { date: 'M/d/yyyy', time: 'h:mm a', timezone: 'UTC' } };
  await assert.rejects(form.setFields(f, { AccountNumber: 'ABCDEF' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === 'ABC' && e.evidence.apiName === 'AccountNumber');
  await assert.rejects(form.setFields(f, { CloseDate: '2026-01-05' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.want === '1/5/2026' && e.evidence.got === '1/5/2027');
  await assert.rejects(form.setFields(f, { Probability: '35' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === '1035');
  await form.setFields(f, { AccountNumber: 'ABC', Probability: 40 }); // control: values the boxes keep
  await form.setFields(f, { Discount: '35' }); // a box that drops its % on focus (as the org's do) gets 35, not 1035
  await form.setFields(f, { Score: '2' });
  assert.deepEqual(await page.evaluate(() => window.seen), ['2'], 'one input event, no empty one first');
  assert.deepEqual(f.set, { AccountNumber: { value: 'ABC', kind: 'String', rich: false, shown: 'ABC' }, Probability: { value: 40, kind: 'Percent', rich: false, shown: null }, Discount: { value: '35', kind: 'Percent', rich: false, shown: null }, Score: { value: '2', kind: 'Double', rich: false, shown: null } }); // no lightning-input host, no number
});

// No org: a locale whose date and time boxes rewrite on blur: each part is read back before its Tab, as typed.
test('setFields reads a datetime and a time back before the blur that formats them, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const blur = "onblur=\"this.value='formatted '+this.value\"";
  await page.setContent(`<main><div role="group" aria-label="Start"><label>Date<input ${blur}></label><label>Time<input role="combobox" ${blur}></label></div>
    <label>Alarm<input role="combobox" ${blur}></label></main>`);
  const fields = [['Start__c', 'Start', 'DateTime'], ['Alarm__c', 'Alarm', 'Time']].map(([apiName, label, dataType]) => ({ apiName, label, dataType, editable: true }));
  const f = { s: { page }, scope: page.locator('main'), model: { fields }, locale: { date: 'M/d/yyyy', time: 'h:mm a', timezone: 'UTC' } };
  await form.setFields(f, { Start__c: '2026-01-05T14:30:00Z', Alarm__c: '09:15' });
  assert.deepEqual(await page.locator('input').evaluateAll((es) => es.map((e) => e.value)), ['formatted 1/5/2026', 'formatted 2:30 PM', 'formatted 9:15 AM']); // control: the blurs ran
});

// No org: each typed branch's read-back goes red when the box ends on another value than the one asked for.
test('setFields refuses a picklist, lookup, multi-select, datetime or time the box did not keep, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const shift = "oninput=\"this.value=this.value.replace('2026','2027').replace('9:15','9:16')\"";
  await page.setContent(`<main>
    <button role="combobox" aria-label="Rating" onclick="document.getElementById('rl').hidden=false">Hot</button>
    <div id="rl" role="listbox" aria-label="Rating" hidden><div role="option" onclick="document.querySelector('[aria-label=Rating]').textContent='Cold'">Warm</div></div>
    <input role="combobox" aria-label="Parent" onclick="document.getElementById('pl').hidden=false">
    <div id="pl" role="listbox" aria-label="Parent" hidden><div role="group" aria-label="Search Results">
      <div role="option" onclick="document.querySelector('[aria-label=Parent]').value='Acme Corp'">Acme</div></div></div>
    <div role="group" aria-label="Tags"><div role="listbox" aria-label="Available"><div role="option">Beta</div></div>
      <div role="listbox" aria-label="Chosen"></div><button>Move selection to Chosen</button><button>Move selection to Available</button></div>
    <div role="group" aria-label="Start"><label>Date<input ${shift}></label><label>Time<input role="combobox" ${shift}></label></div>
    <label>Alarm<input role="combobox" ${shift}></label></main>`);
  const fields = [['Rating', 'Rating', 'Picklist'], ['Parent__c', 'Parent', 'Reference'], ['Tags__c', 'Tags', 'MultiPicklist'], ['Start__c', 'Start', 'DateTime'], ['Alarm__c', 'Alarm', 'Time']]
    .map(([apiName, label, dataType]) => ({ apiName, label, dataType, editable: true }));
  const f = { s: { page }, scope: page.locator('main'), model: { fields }, locale: { date: 'M/d/yyyy', time: 'h:mm a', timezone: 'UTC' } };
  const refused = (values, got) => assert.rejects(form.setFields(f, values), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === got && e.evidence.apiName === Object.keys(values)[0]);
  await refused({ Rating: 'Warm' }, 'Cold');
  await refused({ Parent__c: 'Acme' }, 'Acme Corp');
  await refused({ Tags__c: 'Beta' }, ''); // the move button did nothing
  await refused({ Start__c: '2026-01-05T14:30:00Z' }, '1/5/2027');
  await refused({ Start__c: '2025-01-05T09:15:00Z' }, '9:16 AM'); // the date part holds; the time part does not
  await refused({ Alarm__c: '09:15' }, '9:16 AM');
});

// No org: a Rich Text Area is a contenteditable textbox, so setFields reads it back as sf_fill does, not as an input.
test('setFields reads a rich text area back as its text, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(`<main><div role="textbox" aria-label="Story" contenteditable="true"
    oninput="this.innerHTML=this.innerText.split('\\n').filter(Boolean).map((l)=>'<p>'+l+'</p>').join('')"></div>
    <div role="textbox" aria-label="Quiet" contenteditable="true" oninput="this.textContent=''"></div></main>`);
  const fields = [['Story__c', 'Story'], ['Quiet__c', 'Quiet']].map(([apiName, label]) => ({ apiName, label, dataType: 'TextArea', editable: true }));
  const f = { s: { page }, scope: page.locator('main'), model: { fields } };
  await form.setFields(f, { Story__c: 'two\nlines' });
  await assert.rejects(form.setFields(f, { Quiet__c: 'x' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === '' && e.evidence.apiName === 'Quiet__c');
});

// No org, a Dynamic Forms page (no detail panel): a component on the record page with a Save of its own does not clash with the inline edit's Save, which sits
// in records-form-footer (measured on sfui-s4-flow, layout and Dynamic Forms pages); save and cancel press the footer's.
test('editInline takes the form footer\'s Save when the page shows another Save, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '001000000000001AAA';
  const footer = "<records-form-footer><button onclick=\"document.body.dataset.pressed='footer save';this.parentNode.remove()\">Save</button><button onclick=\"document.body.dataset.pressed='footer cancel';this.parentNode.remove()\">Cancel</button></records-form-footer>";
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<one-record-home-flexipage2>
    <c-widget><button onclick="document.body.dataset.pressed='widget save'">Save</button><button>Cancel</button></c-widget>
    <div><span>Phone</span><button onclick="edit(this)">Edit Phone</button></div>
    </one-record-home-flexipage2><script>window.edit = (b) => b.parentNode.insertAdjacentHTML('beforeend', ${JSON.stringify(footer)})</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Account/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Account', source: 'pageLayout', fields: [{ apiName: 'Phone', label: 'Phone', itemLabel: 'Phone', dataType: 'Phone', editable: false }] }));
  t.mock.method(api, 'call', async () => ({ SystemModstamp: null }));
  const f = await form.editInline({ page }, id, 'Phone', { timeout: 5_000 });
  assert.equal((await form.save(f)).outcome, 'saved');
  assert.equal(await page.evaluate(() => document.body.dataset.pressed), 'footer save', 'the footer\'s Save, not the widget\'s');
  const g = await form.editInline({ page }, id, 'Phone', { timeout: 5_000 });
  await form.cancel(g);
  assert.equal(await page.evaluate(() => document.body.dataset.pressed), 'footer cancel');
});

// No org: a field on the form that this user cannot edit is FIELD_NOT_EDITABLE before anything is typed.
test('setFields refuses a read-only field as FIELD_NOT_EDITABLE, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent('<main><label>Owner<input oninput="document.body.dataset.typed=1"></label><label>Phone<input></label></main>');
  const fields = [{ apiName: 'OwnerId', label: 'Owner', dataType: 'String', editable: false }, { apiName: 'Phone', label: 'Phone', dataType: 'Phone', editable: true }];
  const f = { s: { page }, scope: page.locator('main'), model: { fields } };
  await assert.rejects(form.setFields(f, { OwnerId: 'x' }), (e) => e.code === 'FIELD_NOT_EDITABLE' && e.evidence.apiName === 'OwnerId');
  assert.equal(await page.evaluate(() => document.body.dataset.typed), undefined, 'nothing typed');
  await form.setFields(f, { Phone: '555' }); // control: an editable field is set
});

// No org: a ComboBox field (a Task's Subject, measured on sfui-s4-flow) is a combobox the user types into.
test('setFields types into a ComboBox field, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent('<main><input role="combobox" aria-label="Subject"></main>');
  const f = { s: { page }, scope: page.locator('main'), model: { fields: [{ apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] } };
  await form.setFields(f, { Subject: 'L11 call' });
  assert.equal(await page.getByRole('combobox').inputValue(), 'L11 call');
});

// No org: a Task page's inline edit is Aura's, a footer in forceRecordEditActions inside forceDetailPanelDesktop
// (measured on sfui-s4-flow, 2026-11-12); editInline finds its Save and scopes the form to that panel.
test('editInline finds the Aura inline edit of a Task page, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const footer = '<div data-aura-class="forceRecordEditActions"><button>Cancel</button><button>Save</button></div>';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceDetailPanelDesktop">
    <div><span>Subject</span><button onclick="edit(this)">Edit Subject</button></div></div>
    <script>window.edit = (b) => b.parentNode.insertAdjacentHTML('beforeend', '<input role="combobox" aria-label="Subject">' + ${JSON.stringify(footer)})</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Subject', label: 'Subject', itemLabel: 'Subject', dataType: 'ComboBox', editable: true }] }));
  const f = await form.editInline({ page }, id, 'Subject', { timeout: 5_000 });
  assert.equal(await f.scope.count(), 1, 'the form is scoped to the Aura detail panel');
  assert.deepEqual(f.missing, []);
  assert.equal(await f.footer.getByRole('button', { name: 'Save', exact: true }).count(), 1);
});

// No org: a Task page's header has a quick action "Edit Comments", the same name as the Comments pencil in the detail
// panel (measured on sfui-s4-map); editInline presses the panel's.
test('editInline presses the detail panel\'s pencil when a header action shares its name, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const footer = '<div data-aura-class="forceRecordEditActions"><button>Cancel</button><button>Save</button></div>';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceHighlightsPanel">
    <button onclick="document.body.dataset.pressed='header'">Edit Comments</button></div><div data-aura-class="forceDetailPanelDesktop">
    <div><span>Comments</span><button onclick="edit(this)">Edit Comments</button></div></div>
    <script>window.edit = (b) => { document.body.dataset.pressed = 'panel'; b.parentNode.insertAdjacentHTML('beforeend', '<textarea aria-label="Comments"></textarea>' + ${JSON.stringify(footer)}); }</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Description', label: 'Comments', itemLabel: 'Comments', dataType: 'TextArea', editable: true }] }));
  await form.editInline({ page }, id, 'Description', { timeout: 5_000 });
  assert.equal(await page.evaluate(() => document.body.dataset.pressed), 'panel');
});

// No org, the review's N9: a detail panel in a Details tab not yet open is drawn by the tab's click, so the pencil is
// looked up again then: the panel's, not the header action of the same name the page showed before.
test('editInline looks up the pencil again once the Details tab opens, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const footer = '<div data-aura-class="forceRecordEditActions"><button>Cancel</button><button>Save</button></div>';
  const panel = `<div data-aura-class="forceDetailPanelDesktop"><div><span>Comments</span><button onclick="edit(this)">Edit Comments</button></div></div>`;
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceHighlightsPanel">
    <button style="width:0;height:0;padding:0;border:0;overflow:hidden">Edit Comments</button></div>
    <div role="tablist"><div role="tab" onclick="document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(panel).replace(/"/g, '&quot;')})">Details</div></div>
    <script>window.edit = (b) => { document.body.dataset.pressed = 'panel'; b.parentNode.insertAdjacentHTML('beforeend', '<textarea aria-label="Comments"></textarea>' + ${JSON.stringify(footer)}); }</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Description', label: 'Comments', itemLabel: 'Comments', dataType: 'TextArea', editable: true }] }));
  await form.editInline({ page }, id, 'Description', { timeout: 5_000, actionTimeout: 2_000 });
  assert.equal(await page.evaluate(() => document.body.dataset.pressed), 'panel');
});

// No org, the gate's L3: an id whose object is not the one objects names is BAD_ARGS before the old choice is cleared.
test('an id of another object than objects names is BAD_ARGS before any clear, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async (s, path) => (path === '/ui-api/object-info/Task'
    ? { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }, { apiName: 'Lead', nameFields: ['Name'] }] } } }
    : { apiName: 'Contact', fields: { Name: { value: 'Ann Lee' } } }));
  await page.setContent(auraLookup(auraRow('Ann Lee', 'Acme', 'ann')));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await assert.rejects(form.setFields(f, { WhoId: '003C100000XZ8PWIA1' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'BAD_ARGS' && e.evidence.object === 'Contact');
  assert.equal(await pillOfName(page), 1, 'the old choice is kept');
  await form.setFields(f, { WhoId: '003C100000XZ8PWIA1' }, { objects: { WhoId: 'Contact' } }); // control: objects agrees
  assert.equal(await page.evaluate(() => document.body.dataset.picked), 'ann');
});
const pillOfName = (page) => page.getByRole('list', { name: /^Name - Current Selection/ }).count();

// No org, the gate's L5 and L6: VALUE_NOT_FOUND names the object searched (the one the switcher shows), and says when
// the dropdown listed no record but its full-search row (a record made a minute ago, measured on sfui-s4-map).
test('a lookup miss names the object searched and a dropdown with only its search row, no org', { timeout: 90_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(switcherLookup({ Contacts: auraRow('Lee Ray', 'Acme', 'contact'), Leads: '' }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await assert.rejects(form.setFields(f, { WhoId: 'Nobody' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.searched === 'Contacts' && / in Contacts$/.test(e.message));
  await page.setContent(auraLookup('').replace('Search Contacts in Contacts', 'Search Contacts &quot;New Guy&quot; in Contacts'));
  await assert.rejects(form.setFields(f, { WhoId: 'New Guy' }), (e) => e.code === 'VALUE_NOT_FOUND' && /only its full search \(Search Contacts "New Guy" in Contacts\): not searchable yet for this user .*, or not visible to this user$/.test(e.message));
});

// No org, the gate's search lag: for the platform user a record another user made lists only the full-search row for
// 3 to 56 s (measured). Picked by an id the user read, it is searched again until it lists, 60 s in all; by name or by an
// id the user cannot read, once, with both causes named.
test('a lookup by an id the user reads searches again while its search lags, no org', { timeout: 150_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const GUY = '003C100000XZ8PWIA1';
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }] } } };
    if (path.startsWith(`/ui-api/records/${GUY}`)) return { apiName: 'Contact', fields: { Name: { value: 'New Guy' } } };
    throw new SfUiError('API_ERROR', 'answered 404 NOT_FOUND', { status: 404, errorCode: 'NOT_FOUND' });
  });
  const lagging = (after) => page.setContent(`<div role="dialog"><ul><li><span>Name</span><div id="box"><input role="combobox" aria-label="Name" oninput="find(this.value)"><div role="listbox" id="lb"></div></div></li></ul><button>Save</button></div>
    <script>window.n = 0; window.pill = (name) => { box.innerHTML = '<ul role="list" aria-label="Name - Current Selection: ' + name + ' (Contact)"><li><div>' + name + '</div></li></ul>'; };
      window.find = (v) => { if (!v) return; n++; lb.innerHTML = '<div role="option">Search Contacts &quot;' + v + '&quot; in Contacts</div>' + (n >= ${after} ? ${JSON.stringify(auraRow('New Guy', 'Acme', 'guy'))} : ''); };</script>`);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await lagging(3);
  await form.setFields(f, { WhoId: GUY });
  assert.deepEqual(await page.evaluate(() => [document.body.dataset.picked, window.n]), ['guy', 3], 'picked on the third search');
  // By name: one search, and both causes named.
  await lagging(99);
  await assert.rejects(form.setFields(f, { WhoId: 'New Guy' }), (e) => e.code === 'VALUE_NOT_FOUND' && /not searchable yet for this user .*, or not visible to this user$/.test(e.message));
  assert.equal(await page.evaluate(() => window.n), 1, 'no search again by name');
  // An id the user cannot read (404): typed as a name, one search, and the message says the user cannot read it.
  await lagging(99);
  await assert.rejects(form.setFields(f, { WhoId: '003C100000XHIDDEN1' }), (e) => e.code === 'VALUE_NOT_FOUND' && /404 NOT_FOUND for it as a record id, so this user cannot read a record with that id$/.test(e.message));
  assert.equal(await page.evaluate(() => window.n), 1, 'no search again for a 404');
});

// No org, F10 (Dave 2026-11-24): a pick by id whose dropdown lists a same-name twin but not the target searches again
// for up to 60 s, as when it lists no record, so a lagging target is picked; a true miss is NOT_SEARCHABLE_YET, twin never picked.
test('a lookup by id with only a same-name twin listed searches again, then NOT_SEARCHABLE_YET, no org', { timeout: 150_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [GUY, TWIN] = ['003C100000XZ8PWIA1', '003C100000XZ8PXIA1'];
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }] } } };
    return { apiName: 'Contact', fields: { Name: { value: 'New Guy' } } };
  });
  const row = (id, where) => auraRow('New Guy', where, where).replace('<a ', `<a data-aura-rendered-by="${id}" `);
  const lagging = (after) => page.setContent(`<div role="dialog"><ul><li><span>Name</span><div id="box"><input role="combobox" aria-label="Name" oninput="find(this.value)"><div role="listbox" id="lb"></div></div></li></ul><button>Save</button></div>
    <script>window.$A = { getComponent: (g) => ({ getComponentValueProvider: () => ({ get: (k) => (k === 'v.value' ? { id: g } : null) }) }) };
      window.n = 0; window.pill = (name) => { box.innerHTML = '<ul role="list" aria-label="Name - Current Selection: ' + name + ' (Contact)"><li><div>' + name + '</div></li></ul>'; };
      window.find = (v) => { if (!v) return; n++; lb.innerHTML = ${JSON.stringify(row(TWIN, 'twin'))} + (n >= ${after} ? ${JSON.stringify(row(GUY, 'guy'))} : ''); };</script>`);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await lagging(3);
  await form.setFields(f, { WhoId: GUY });
  assert.deepEqual(await page.evaluate(() => [document.body.dataset.picked, window.n]), ['guy', 3], 'picked on the third search, past the twin');
  await lagging(999);
  await assert.rejects(form.setFields(f, { WhoId: GUY }), (e) => e.code === 'NOT_SEARCHABLE_YET' && e.evidence.options.join() === `New Guy | twin (${TWIN})` && /no option with that id/.test(e.message));
  assert.equal(await page.evaluate(() => document.body.dataset.picked), undefined, 'the twin was never picked');
  assert.ok(await page.evaluate(() => window.n) > 1, 'searched again');
});

// No org, the gate's unverified read-back: after an Aura pick the box can stay a moment before the pill replaces it,
// so the read-back waits for the pill; a pill naming another record than the one picked is VALUE_NOT_SET.
test('an Aura pick reads its pill back, not the box it replaces, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const late = (name, shows) => `<a role="option" href="#" onclick="document.body.dataset.picked='${name}';setTimeout(() => pill('${shows}'), 300);return false"><div>${name}</div><div>Acme</div></a>`;
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await page.setContent(auraLookup(late('Ann Lee', 'Ann Leeds')));
  await assert.rejects(form.setFields(f, { WhoId: 'Ann Lee' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === 'Ann Leeds');
  await page.setContent(auraLookup(late('Ann Lee', 'Ann Lee')));
  await form.setFields(f, { WhoId: 'Ann Lee' }); // control: the late pill names the record picked
});

// No org, the gate's four guards with no red test (M19, M26, M27, M28), one assertion each.
test('a confirm save whose read-back fails is refused, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, ANN] = ['00T000000000001AAA', '003C100000XZ8PWIA1'];
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><button onclick="this.parentNode.remove()">Save</button></div>' }));
  let n = 0;
  t.mock.method(api, 'call', async (s, path) => {
    if (path.includes('object-info')) return { fields: { WhoId: { relationshipName: 'Who' } } };
    if (n++) throw new SfUiError('API_ERROR', 'GET as admin answered 503'); // the read before the Save answers, the one after fails
    return { fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: null } } };
  });
  await page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  await assert.rejects(form.save({ scope: page.getByRole('dialog'), s: { page }, model: { fields: [], objectApiName: 'Task' }, recordId: id, set: { WhoId: { value: ANN, kind: 'Reference', confirm: true } } }),
    (e) => e.code === 'SAVE_UNCONFIRMED' && /its values could not be read back/.test(e.message) && /503/.test(e.evidence.unread[0]));
});

test('a switcher whose menu item does not take, or offers no such object, says so and closes its menu, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async (s, path) => (path === '/ui-api/object-info/Task'
    ? { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }, { apiName: 'Lead', nameFields: ['Name'] }] } } }
    : { labelPlural: 'Leads' }));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await page.setContent(switcherLookup({ Contacts: '', Leads: auraRow('Lee Ray', 'Globex', 'lead') }));
  await page.evaluate(() => { window.pickObject = () => { document.getElementById('menu').hidden = true; }; }); // the label never changes
  await assert.rejects(form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'VALUE_NOT_SET' && /did not switch to Leads/.test(e.message));
  await page.setContent(switcherLookup({ Contacts: '', Leads: '' }));
  await page.evaluate(() => { document.querySelectorAll('[role=menuitem]')[1].remove(); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('menu').hidden = true; }); });
  await assert.rejects(form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.objects.join() === 'Contacts');
  assert.equal(await page.locator('#menu').isHidden(), true, 'the refused menu was closed');
});

test('an Aura row listed for an id but taking no click says the click failed, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async (s, path) => (path === '/ui-api/object-info/Task'
    ? { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }] } } }
    : { apiName: 'Contact', fields: { Name: { value: 'Ann Lee' } } }));
  await page.setContent(auraLookup(auraRow('Ann Lee', 'Acme', 'ann')));
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  await page.evaluate(() => { search(); const box = document.querySelector('[role=listbox]'); box.style.position = 'relative'; box.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0"></div>'); }); // rows under a layer
  await assert.rejects(form.setFields(f, { WhoId: '003C100000XZ8PWIA1' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.clickFailed === true);
});

// No org: an LWC lookup's named listbox closes as its option is clicked (the replay's lookup@edit-dialog on
// sfui-s4-map), so the pick is not taken for an Aura one and its box is read back, not a pill.
test('an LWC lookup whose listbox closes on the click reads its box back, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent(`<div role="dialog"><input role="combobox" aria-label="Account">
    <div role="listbox" aria-label="Account"><div role="group" aria-label="Search Results">
    <div role="option" onclick="document.querySelector('[role=combobox]').value='Acme';this.closest('[role=listbox]').remove()"><div>Acme</div><div>Account</div></div></div></div><button>Save</button></div>`);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [{ apiName: 'Account__c', label: 'Account', dataType: 'Reference', editable: true }] } };
  const t0 = Date.now();
  await form.setFields(f, { Account__c: 'Acme' });
  assert.ok(Date.now() - t0 < 4_000, `took ${Date.now() - t0} ms: it waited for a pill`);
});

// No org: a dialog opened over the form (a lookup's New Account, measured on sfui-s4-map) hides the form from the
// page's roles until it closes; the form is still open then, and a form whose dialog is gone is not.
test('a form under a dialog over it is still open, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<main><button>New</button></main>' }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Task', fields: [{ apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] }));
  await page.goto('https://x.lightning.force.com/lightning/o/Task/home');
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="edit"><input role="combobox" aria-label="Subject"><button>Save</button></div>')));
  const f = await form.createRecord({ page }, 'Task', { timeout: 3_000 });
  await page.evaluate(() => { document.getElementById('edit').setAttribute('aria-hidden', 'true'); document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="nested">New Account<button>Save</button></div>'); });
  setTimeout(() => page.evaluate(() => { document.getElementById('nested').remove(); document.getElementById('edit').removeAttribute('aria-hidden'); }).catch(() => {}), 1_000);
  await form.setFields(f, { Subject: 'L11 under' }); // waits out the nested dialog, not FORM_CLOSED
  // The gate's M-B: a dialog that stays over the form (Choose values to keep) is named at once by every action, and
  // nothing reaches it.
  await page.evaluate(() => { document.getElementById('edit').setAttribute('aria-hidden', 'true'); document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="keep" aria-labelledby="kh"><h2 id="kh">Choose values to keep</h2><input role="combobox" aria-label="Subject"><button onclick="document.body.dataset.pressed=1">Save</button><button onclick="document.body.dataset.pressed=1">Cancel</button></div>'); });
  const covered = (e) => e.code === 'FORM_COVERED' && e.evidence.dialogs.join() === 'Choose values to keep';
  const t0 = Date.now();
  await assert.rejects(form.setFields(f, { Subject: 'L11 over' }), covered);
  await assert.rejects(form.save(f), covered);
  await assert.rejects(form.cancel(f), covered);
  assert.ok(Date.now() - t0 < 25_000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(await page.evaluate(() => [document.body.dataset.pressed, document.querySelector('#keep input').value]), [undefined, ''], 'nothing reached the dialog on top');
  await page.evaluate(() => { document.getElementById('keep').remove(); document.getElementById('edit').removeAttribute('aria-hidden'); });
  // A form that closes between the check and the Save click (K7 on the org): FORM_CLOSED, not a 30 s wait on its Save.
  await page.evaluate(() => { document.querySelector('#edit button').disabled = true; setTimeout(() => document.getElementById('edit').remove(), 1_000); });
  const t1 = Date.now();
  await assert.rejects(form.save(f), { code: 'FORM_CLOSED' });
  assert.ok(Date.now() - t1 < 15_000, `took ${Date.now() - t1} ms`);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="edit"><input role="combobox" aria-label="Subject"><button>Save</button></div>'));
  await page.evaluate(() => document.getElementById('edit').remove());
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button>Save</button></div>'));
  await assert.rejects(form.save(f), { code: 'FORM_CLOSED' }); // control: its dialog is gone
});

// No org, the org's M4: a visible modal that is not the form covers it before the form is aria-hidden (measured on
// sfui-s4-map); a hidden modal does not, nor the closed one pages keep at 0 x 0 (Account, Contact, Event, Task).
test('a form under a modal dialog not yet aria-hidden is covered, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<main><button>New</button></main><div role="dialog" aria-modal="true" style="display:none">old</div>' }));
  t.mock.method(api, 'call', async () => ({ createable: true, label: 'Task', recordTypeInfos: {} }));
  t.mock.method(nav, 'openList', async () => {});
  t.mock.method(require('../src/discover'), 'formModel', async () => ({ objectApiName: 'Task', fields: [{ apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] }));
  await page.goto('https://x.lightning.force.com/lightning/o/Task/home');
  await page.evaluate(() => document.querySelector('button').addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" id="edit" aria-label="New Task"><input role="combobox" aria-label="Subject"><button>Save</button></div>')));
  const f = await form.createRecord({ page }, 'Task', { timeout: 3_000 });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" id="kept" style="display:flex;width:0;height:0;overflow:hidden">closed</div>'));
  await form.setFields(f, { Subject: 'L11 one' }); // control: hidden and closed modals and the form's own are no cover
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" aria-label="New Contact" style="position:fixed;inset:0;background:#fff"><input aria-label="Last Name"></div>'));
  const t0 = Date.now();
  await assert.rejects(form.setFields(f, { Subject: 'L11 two' }), (e) => e.code === 'FORM_COVERED' && e.evidence.dialogs.includes('New Contact') && !e.evidence.dialogs.includes('New Task'));
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
});

// No org, the delta's row 15: a modal under aria-hidden (behind the one on top) and a modal that holds the form are no
// cover, so a set goes on; a modal beside the form, at the same size, is.
test('a modal under aria-hidden or holding the form is no cover, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const modal = (inner, z = 1) => `<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#fff;z-index:${z}">${inner}</div>`;
  const box = '<div data-sf-tester-form="m1"><input role="combobox" aria-label="Subject"></div>';
  const f = { scope: page.locator('[data-sf-tester-form="m1"]'), s: { page }, recordId: '00T000000000001AAA', mark: 'm1', model: { fields: [{ apiName: 'Subject', label: 'Subject', dataType: 'ComboBox', editable: true }] } };
  await page.setContent(`${box}<div aria-hidden="true">${modal('behind', -1)}</div>`);
  await form.setFields(f, { Subject: 'L11 hidden' });
  await page.setContent(modal(box));
  await form.setFields(f, { Subject: 'L11 inside' });
  await page.setContent(`${box}${modal('New Contact')}`);
  await assert.rejects(form.setFields(f, { Subject: 'L11 beside' }), { code: 'FORM_COVERED' }); // control
});

// No org, the delta's row 5: a navigation between the open check and the cover check destroys the page's context;
// the form is gone then, so the action is FORM_CLOSED, not a raw "Execution context was destroyed".
test('a navigation under the cover check is FORM_CLOSED, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent('<div role="dialog" aria-label="Edit"><input aria-label="Subject"><button>Cancel</button></div>');
  const f = { scope: page.getByRole('dialog'), s: { page }, recordId: '00T000000000001AAA', mark: 'm1', model: { fields: [] } };
  t.mock.method(page, 'evaluate', async () => { await page.setContent('<main>Task home</main>'); throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'); });
  await assert.rejects(form.cancel(f), { code: 'FORM_CLOSED' });
  await page.setContent('<div role="dialog" aria-label="Edit"><button>Cancel</button></div>');
  page.evaluate.mock.mockImplementation(async () => { throw new Error('boom'); });
  await assert.rejects(form.cancel(f), /boom/, 'control: a form still open keeps the error');
});

// No org, the review's N15: an inline edit's detail panel stays on the page after edit mode ends, and its footer stays
// with no Save (measured on sfui-s4-map), so a later dialog never makes it read open: FORM_CLOSED, and cancel clears it.
test('an inline edit ended is closed under a later dialog, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const footer = '<div data-aura-class="forceRecordEditActions"><button>Cancel</button><button id="save">Save</button></div>';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceDetailPanelDesktop">
    <div><span>Subject</span><button onclick="edit(this)">Edit Subject</button></div></div>
    <script>window.edit = (b) => b.parentNode.insertAdjacentHTML('beforeend', '<input role="combobox" aria-label="Subject">' + ${JSON.stringify(footer)})</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Subject', label: 'Subject', itemLabel: 'Subject', dataType: 'ComboBox', editable: true }] }));
  const f = await form.editInline({ page }, id, 'Subject', { timeout: 5_000 });
  await page.evaluate(() => { document.querySelector('input').remove(); document.getElementById('save').remove(); document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Edit Task<button>Save</button></div>'); });
  const t0 = Date.now();
  await assert.rejects(form.setFields(f, { Subject: 'L11 late' }), { code: 'FORM_CLOSED' });
  assert.ok(Date.now() - t0 < 3_000, `took ${Date.now() - t0} ms`);
  // F-cascade-19: it closed with edit mode, and the dialog with a Save on screen is a form cancel did not close.
  await assert.rejects(form.cancel(f), (e) => e.code === 'FORM_CLOSED' && e.evidence.dialogs.length === 1);
  await page.evaluate(() => document.querySelector('[role=dialog]').remove());
  await form.cancel(f); // control: nothing on screen, nothing to clear
});

// No org, the delta's row 4: under a lookup's New Contact an inline footer keeps its marked Save (measured on
// sfui-s4-map, before and after a blocked save), so a set and a cancel are FORM_COVERED, never a quiet return.
test('an inline edit under a lookup\'s New Contact is covered, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const footer = '<div data-aura-class="forceRecordEditActions"><button onclick="document.body.dataset.pressed=1">Cancel</button><button id="save">Save</button></div>';
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceDetailPanelDesktop" id="panel">
    <div><span>Subject</span><button onclick="edit(this)">Edit Subject</button></div></div>
    <script>window.edit = (b) => b.parentNode.insertAdjacentHTML('beforeend', '<input role="combobox" aria-label="Subject">' + ${JSON.stringify(footer)})</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Subject', label: 'Subject', itemLabel: 'Subject', dataType: 'ComboBox', editable: true }] }));
  const f = await form.editInline({ page }, id, 'Subject', { timeout: 5_000 });
  await page.evaluate(() => { panel.setAttribute('aria-hidden', 'true'); document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" aria-label="New Contact" style="position:fixed;inset:0;background:#fff"><input aria-label="Last Name"></div>'); });
  const covered = (e) => e.code === 'FORM_COVERED' && e.evidence.dialogs.includes('New Contact');
  await assert.rejects(form.setFields(f, { Subject: 'L11 under' }), covered);
  await assert.rejects(form.cancel(f), covered);
  assert.equal(await page.evaluate(() => document.body.dataset.pressed), undefined, 'the Cancel under the dialog took no click');
});

// No org: an inline edit blocks in a popover by its footer, "Record Form Error Dialog", outside the panel, its links
// naming the fields (measured on sfui-s4-map, a Task's Subject ""), so a block is blocked in seconds, not a raw 30 s.
test('a blocked inline save is blocked with its field errors, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const id = '00T000000000001AAA';
  const pop = '<div role="dialog" aria-label="Record Form Error Dialog"><button title="Close" aria-label="" onclick="this.parentNode.remove()"><span>Close</span></button><span>Review the following fields</span><ul class="errorsList"><li><a class="errorsListLink" data-field-name="Subject" href="javascript:void(0);">Subject</a></li></ul></div>';
  const footer = `<div data-aura-class="forceRecordEditActions"><button>Cancel</button><button id="sv" onclick="save()">Save</button></div>`;
  // The box sits in a shadow root and its describedby help outside it; its blur draws the help, which moves the footer
  // (measured), so a Save pressed from the box loses its click unless the box is left first.
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<div data-aura-class="forceDetailPanelDesktop" id="panel">
    <div><span>Subject</span><button onclick="edit(this)">Edit Subject</button></div></div>
    <script>window.edit = (b) => { b.parentNode.insertAdjacentHTML('beforeend', '<div class="slds-form-element" id="row"><span id="box"></span><div id="help-message-1" class="slds-form-element__help"></div></div>' + ${JSON.stringify(footer)});
      box.attachShadow({ mode: 'open' }).innerHTML = '<input role="combobox" aria-label="Subject" aria-describedby="help-message-1">';
      box.shadowRoot.querySelector('input').addEventListener('blur', () => { document.getElementById('help-message-1').textContent = 'Complete this field.'; }); };
    window.save = () => { if (Date.now() - (window.blockedAt || 0) < 1000) return; (window.next || window.block)(); };
    window.block = () => setTimeout(() => { window.blockedAt = Date.now(); document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(pop)}); }, 200);
    window.done = () => setTimeout(() => { sv.remove(); row.remove(); }, 200);</script>` }));
  t.mock.method(nav, 'openRecord', async () => page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`));
  const discover = require('../src/discover');
  t.mock.method(discover, 'renderedPage', async () => null);
  t.mock.method(discover, 'formModel', async () => ({ objectApiName: 'Task', source: 'pageLayout', fields: [{ apiName: 'Subject', label: 'Subject', itemLabel: 'Subject', dataType: 'ComboBox', editable: true }] }));
  t.mock.method(api, 'call', async () => ({ fields: {} }));
  const f = await form.editInline({ page }, id, 'Subject', { timeout: 5_000 });
  const field = [{ apiName: 'Subject', label: 'Subject', message: 'Complete this field.' }];
  await page.getByRole('combobox', { name: 'Subject' }).focus(); // as sf_set_fields leaves it
  for (const which of ['the first block', 'a second block']) {
    const t0 = Date.now();
    const r = await form.save(f, { timeout: 15_000 });
    assert.deepEqual([r.outcome, r.fieldErrors, r.pageErrors], ['blocked', field, []], which);
    assert.ok(Date.now() - t0 < 10_000, `${which} took ${Date.now() - t0} ms`);
  }
  // A Save within about 1 s of a block is dropped (measured), so the block is handed back after it and this one lands.
  await page.evaluate(() => { window.next = window.done; });
  assert.equal((await form.save(f, { timeout: 15_000 })).outcome, 'saved', 'the corrected save at once after the block');
});

// No org, the review's N12: a save that stays on the record names an sf_fill label that matched no one field in
// notChecked, as a left save and a create do.
test('a save that stays on the record names an unmatched sf_fill label, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const [id, ANN] = ['00T000000000001AAA', '003C100000XZ8PWIA1'];
  await page.route('https://x.lightning.force.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div role="dialog"><ul role="list" aria-label="Name - Current Selection: Ann Lee (Contact)"><li><div>Ann Lee</div></li></ul><button onclick="this.parentNode.remove()">Save</button></div>' }));
  const rec = (who) => ({ fields: { SystemModstamp: { value: 'x' }, LastModifiedById: { value: '005' }, WhoId: { value: who }, Who: { displayValue: null } } });
  const rows = [rec(null), rec(ANN)];
  t.mock.method(api, 'call', async (s, path) => (path.includes('object-info') ? { fields: { WhoId: { relationshipName: 'Who' } } } : rows.shift()));
  await page.goto(`https://x.lightning.force.com/lightning/r/Task/${id}/view`);
  const unmatched = [{ label: 'Notes', why: 'sf_fill typed into "Notes", which names no editable field of the form' }];
  const r = await form.save({ scope: page.getByRole('dialog'), s: { page }, model: { fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }], objectApiName: 'Task' }, recordId: id, unmatched,
    set: { WhoId: { value: ANN, kind: 'Reference', confirm: true, shown: 'Ann Lee' } } });
  assert.deepEqual([r.outcome, r.values.checked, r.values.notChecked], ['saved', ['WhoId'], unmatched]);
});

// No org: a Save or Cancel that stays disabled past the 5 s click cap ends coded, not as a raw TimeoutError.
test('a footer button that stays disabled ends TIMEOUT naming it, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  await page.setContent('<div role="dialog" aria-label="Edit"><input aria-label="Subject"><button disabled>Cancel</button></div>');
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [] } };
  await assert.rejects(form.cancel(f), (e) => e.code === 'TIMEOUT' && e.evidence.button === 'Cancel' && e.evidence.disabled === true);
});

// No org, the delta's row 10: a footer with no such button says it is missing, not TIMEOUT with disabled null.
test('a footer with no such button says it is missing, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [] } };
  await page.setContent('<div role="dialog" aria-label="Edit"><input aria-label="Subject"><button>Save</button></div>');
  await assert.rejects(form.cancel(f), (e) => e.code === 'ACTION_NOT_AVAILABLE' && e.evidence.button === 'Cancel');
});

// No org, the delta's row 12: an enabled button that takes no click (a cover over it) is TIMEOUT with disabled false;
// two Cancels end AMBIGUOUS naming both (F23), not Playwright's raw strict-mode error.
test('a covered and a doubled footer button each keep what happened, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { fields: [] } };
  await page.setContent('<div role="dialog" aria-label="Edit"><input aria-label="Subject"><button>Cancel</button></div><div style="position:fixed;inset:0;z-index:9"></div>');
  await assert.rejects(form.cancel(f), (e) => e.code === 'TIMEOUT' && e.evidence.disabled === false);
  await page.setContent('<div role="dialog" aria-label="Edit"><input aria-label="Subject"><button>Cancel</button><button>Cancel</button></div>');
  await assert.rejects(form.cancel(f), (e) => e.code === 'AMBIGUOUS' && e.evidence.controls.length === 2 && e.evidence.controls.every((c) => c.label === 'Cancel'));
});

// No org: switchTo's wait for the switched object reads only a timeout as "did not switch"; a page that closed under it
// keeps its own error. Control: a menu item that switches nothing is still VALUE_NOT_SET.
test('an Aura lookup switch that never shows is VALUE_NOT_SET, and a closed page is not, no org', { timeout: 60_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t);
  t.mock.method(api, 'call', async (s, path) => {
    if (path === '/ui-api/object-info/Task') return { fields: { WhoId: { referenceToInfos: [{ apiName: 'Contact', nameFields: ['Name'] }, { apiName: 'Lead', nameFields: ['Name'] }] } } };
    return { labelPlural: path.endsWith('/Lead') ? 'Leads' : 'Contacts' };
  });
  const f = { scope: page.getByRole('dialog'), s: { page }, model: { objectApiName: 'Task', fields: [{ apiName: 'WhoId', label: 'Name', dataType: 'Reference', editable: true }] } };
  const stuck = (rows) => switcherLookup(rows).replace("window.pickObject = (o) => {", "window.pickObject = (o) => { document.body.dataset.clicked = o; return;");
  await page.setContent(stuck({ Contacts: '', Leads: '' }));
  await assert.rejects(form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } }), (e) => e.code === 'VALUE_NOT_SET' && /did not switch/.test(e.message));
  await page.setContent(stuck({ Contacts: '', Leads: '' }));
  const set = form.setFields(f, { WhoId: 'Lee Ray' }, { objects: { WhoId: 'Lead' } });
  await page.waitForFunction(() => document.body.dataset.clicked === 'Leads');
  await page.close();
  await assert.rejects(set, (e) => e.code !== 'VALUE_NOT_SET' && /closed/.test(e.message));
});
