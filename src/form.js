'use strict';

// The record edit form (the Edit dialog or inline edit), driven from discover.formModel: fields by role + accessible name, never XPath.
const { SfUiError } = require('./errors');
const nav = require('./nav');
const discover = require('./discover');
const api = require('./api');
const { armToasts, raised, boxValue, readBack, replaceText, openRich } = require('./act');
const lwc = require('./lwc');
const action = require('./action');
const { requireEnglish } = require('./session');
const { sameValue } = require('./assert');
const { dateOk, instantOf } = require('./iso');
const A = require('./anchors');

// Role the edit form gives each UI API data type; anything not listed renders as a textbox. A ComboBox (a Task's
// Subject) is typed into like text.
const ROLE = { Picklist: 'combobox', ComboBox: 'combobox', Reference: 'combobox', Time: 'combobox', Int: 'spinbutton', Double: 'spinbutton', Currency: 'spinbutton', Percent: 'spinbutton', Boolean: 'checkbox' };

// A datetime is a group of a Date textbox and a Time combobox, a multi-select a group of Available and Chosen
// listboxes; a required group's name is prefixed "required".
const GROUP = ['DateTime', 'MultiPicklist'];
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An Aura picklist (a Task's Status) is an <a role=combobox> named by its label and its value: "Priority Normal".
// ponytail: a second Aura picklist whose label starts with this one's and a space matches too.
const locate = (f, field) => {
  // A Geolocation draws group "Spot" with textboxes "Latitude" and "Longitude", whatever the model labels a part.
  const part = /__(Latitude|Longitude)__s$/.exec(field.apiName);
  if (part && field.itemLabel) return f.scope.getByRole('group', { name: new RegExp(`^(required)?${esc(field.itemLabel)}$`) }).getByRole('textbox', { name: part[1], exact: true });
  if (GROUP.includes(field.dataType)) return f.scope.getByRole('group', { name: new RegExp(`^(required)?${esc(field.label)}$`) });
  const exact = f.scope.getByRole(field.role || ROLE[field.dataType] || 'textbox', { name: field.label, exact: true });
  return field.dataType === 'Picklist' ? exact.or(f.scope.getByRole('combobox', { name: new RegExp(`^${esc(field.label)} `) }).and(f.scope.locator('a'))) : exact;
};

// A caller that names the form model it expects (pageLayout, dynamicForms) is refused another one, so a route
// checked on a page layout goes red once the page moves to Dynamic Forms instead of passing on the new form.
function expectSource(model, source) {
  if (source && model.source !== source) throw new SfUiError('SOURCE_MISMATCH', `the form comes from ${model.source}, not ${source}`, { source: model.source, expected: source });
  return model;
}

async function editRecord(s, recordId, { timeout = 30_000, actionTimeout = 10_000, source } = {}) {
  await nav.openRecord(s, recordId);
  const model = expectSource(await discover.formModel(s, recordId, { mode: 'Edit', flexiPageApiName: await discover.renderedPage(s) }), source);
  await action.press(s, 'Edit', { actionTimeout, recordId });
  const save = s.page.getByRole('button', { name: 'Save', exact: true });
  await save.waitFor({ timeout });
  return formOf(s, recordId, model, s.page.getByRole('dialog').filter({ has: save }));
}

// The New dialog for an object, from the Create layout of the record type chosen. ponytail: the layout even on a
// Dynamic Forms object, whose New dialog may follow the page instead (unmeasured).
async function createRecord(s, objectApiName, { recordType, timeout = 30_000 } = {}) {
  nav.segment(objectApiName);
  // Refused from object-info before any page: no create access, or a record type to choose that the caller did not name.
  const info = await api.call(s, `/ui-api/object-info/${objectApiName}`);
  if (!info.createable) throw new SfUiError('ACTION_NOT_AVAILABLE', `this user cannot create ${objectApiName}`, { objectApiName });
  const types = Object.values(info.recordTypeInfos || {}).filter((r) => r.available && !r.master);
  const names = types.map((r) => r.name);
  if (recordType != null && !names.includes(recordType)) throw new SfUiError('VALUE_NOT_FOUND', `${objectApiName} offers this user no record type "${recordType}"`, { objectApiName, recordType, recordTypes: names });
  // The picker of several types asks first; the caller names one, since New alone would stop at the picker.
  if (types.length > 1 && recordType == null) throw new SfUiError('RECORD_TYPE_REQUIRED', `${objectApiName} asks for a record type first; pass recordType`, { objectApiName, recordTypes: names });
  // New is pressed on the object home as a user does: a button named New or New <object label>, or that item in the
  // home's overflow menu (the Task split view). A home with none is the answer, never a reason to open the form by URL.
  await nav.openList(s, objectApiName, undefined, { timeout });
  const label = esc(String(info.label || '').trim());
  const main = s.page.getByRole('main');
  // New or New <label>, as a button or a menu item; both showing, the exact New, so neither clashes; two, the first.
  const news = (at, role) => ({ exact: at.getByRole(role, { name: 'New', exact: true }), named: at.getByRole(role, { name: new RegExp(`^New${label ? ` ${label}` : ''}$`) }) });
  const pressNew = async ({ exact, named }) => ((await exact.count()) ? exact : named).first().click({ timeout });
  const button = news(main, 'button');
  const more = main.getByRole('button', { name: action.MORE });
  const none = () => new SfUiError('ACTION_NOT_AVAILABLE', `the ${objectApiName} home shows no New button`, { objectApiName });
  await button.exact.or(button.named).or(more).first().waitFor({ timeout: Math.min(timeout, 10_000) }).catch((e) => {
    if (e.name !== 'TimeoutError') throw e; // a closed page is not a missing button
    throw none();
  });
  if (await button.exact.or(button.named).count()) await pressNew(button);
  else {
    await more.first().click({ timeout });
    const item = news(s.page, 'menuitem');
    await item.exact.or(item.named).first().waitFor({ timeout: 5_000 }).catch((e) => { if (e.name !== 'TimeoutError') throw e; throw none(); });
    await pressNew(item);
  }
  if (recordType != null) {
    const picker = s.page.getByRole('dialog').filter({ has: s.page.getByRole('button', { name: 'Next', exact: true }) });
    // The radio is a hidden Aura input; its label text takes the click, as a user's would.
    const radio = picker.getByRole('radio', { name: recordType, exact: true });
    await picker.getByText(recordType, { exact: true }).click({ timeout });
    if (!(await radio.isChecked())) throw new SfUiError('VALUE_NOT_SET', `the record type picker did not take "${recordType}"`, { objectApiName, recordType });
    await picker.getByRole('button', { name: 'Next', exact: true }).click({ timeout });
  }
  await s.page.getByRole('dialog').first().waitFor({ timeout });
  await requireEnglish(s);
  const save = s.page.getByRole('button', { name: 'Save', exact: true });
  await save.waitFor({ timeout });
  const recordTypeId = recordType != null ? types.find((r) => r.name === recordType).recordTypeId : undefined;
  const model = await discover.formModel(s, null, { mode: 'Create', objectApiName, recordTypeId });
  return formOf(s, null, model, s.page.getByRole('dialog').filter({ has: save }));
}

// Inline edit: a view field's pencil ("Edit <label>") turns the detail panel into a form with a footer Save.
// ponytail: the detail panel must be on screen (its tab open); a field only in another panel is not reached.
async function editInline(s, recordId, apiName, { timeout = 30_000, actionTimeout = 10_000, source } = {}) {
  await nav.openRecord(s, recordId);
  const model = expectSource(await discover.formModel(s, recordId, { mode: 'Edit', flexiPageApiName: await discover.renderedPage(s) }), source);
  const field = model.fields.find((x) => x.apiName === apiName);
  if (!field) throw new SfUiError('FIELD_NOT_ON_FORM', `${apiName} is not on this user's form`, { apiName });
  // The detail panel's pencil first: a header action can share its name (a Task's "Edit Comments"). When the panel
  // has none (Dynamic Forms), the page's.
  const named = { name: `Edit ${field.itemLabel || field.label}`, exact: true };
  const inPanel = s.page.locator(A.detailPanel).getByRole('button', named);
  const pencilOf = async () => ((await inPanel.count()) ? inPanel : s.page.getByRole('button', named));
  let pencil = await pencilOf();
  // The detail panel may sit in a tab that is not open: the FlexiPage says which; a standard page names it Details.
  if (!(await pencil.isVisible())) {
    const page = await discover.renderedPage(s);
    const place = page && (await discover.lwcOnPage(s, page, 'detailPanel'));
    const details = s.page.getByRole('tab', { name: 'Details', exact: true });
    if (place) await lwc.openTabs(s, place);
    else if ((await details.count()) === 1) await details.click();
    pencil = await pencilOf();
  }
  await pencil.waitFor({ timeout: actionTimeout }).catch(() => {
    throw new SfUiError('ACTION_NOT_AVAILABLE', `no "Edit ${field.itemLabel || field.label}" pencil on screen for ${recordId}: no edit access, or the detail panel is not open`, { recordId, apiName });
  });
  await pencil.click();
  // The edit's Save is its form footer's, so a component on the page with a Save of its own does not clash with it.
  const footer = s.page.locator(A.formFooter).filter({ has: s.page.getByRole('button', { name: 'Save', exact: true }) });
  const save = footer.getByRole('button', { name: 'Save', exact: true });
  await save.waitFor({ timeout });
  // Scoped to the panel (or, on a Dynamic Forms page, the record page) while it has a Save, so the scope
  // disappears, as a dialog does, once edit mode ends.
  const panel = s.page.locator(A.detailPanel).filter({ has: save });
  const f = await formOf(s, recordId, model, (await panel.count()) ? panel : s.page.locator(A.recordHome).filter({ has: save }));
  // The panel and its footer stay after edit mode ends (measured), so the form under a dialog is its Save, marked.
  await save.evaluate((el, m) => el.setAttribute('data-sf-tester-save', m), f.mark);
  return Object.assign(f, { footer, marked: s.page.locator(`[data-sf-tester-save="${f.mark}"]`) });
}

// The form object setFields and save work on, with the editable fields the form failed to show.
async function formOf(s, recordId, model, open) {
  // The form is the element it opened in, marked: once that closes, another dialog with a Save is never this form.
  const mark = `f${Date.now()}${Math.random().toString(36).slice(2)}`;
  await open.evaluateAll((els, m) => els.forEach((el) => el.setAttribute('data-sf-tester-form', m)), mark);
  const marked = s.page.locator(`[data-sf-tester-form="${mark}"]`);
  const f = { s, recordId, model, mark, marked, scope: open.and(marked) };
  // A field can render after Save (a lookup on a cold page), so each gets 2 s, in parallel, before it counts as missing.
  const want = model.fields.filter((x) => x.editable && !x.conditional); // a rule may hide a conditional one
  const late = await Promise.all(want.map((field) => shownOf(f, field).first().waitFor({ state: 'attached', timeout: 2_000 })
    .then(() => null, (e) => { if (e.name !== 'TimeoutError') throw e; return field.apiName; })));
  f.missing = late.filter(Boolean);
  return f;
}

// Navigation closes the edit dialog, so a form object can outlive it; say so instead of waiting on nothing.
const gone = (f) => new SfUiError('FORM_CLOSED', `the edit form for ${f.recordId} is no longer open`, { recordId: f.recordId });
async function stillOpen(f) {
  if (!(await isOpen(f))) throw gone(f);
  await uncovered(f);
}

// A dialog over the form takes every action until it closes: one gone within 5 s (a nested New just saved) is waited
// out, else the form names it, so nothing waits 30 s on it or reaches it.
async function uncovered(f) {
  for (const end = Date.now() + 5_000; !(await free(f)); await f.s.page.waitForTimeout(250)) if (Date.now() > end) return covered(f);
}

// A modal not yet aria-hidden over the form covers it too: the first second of a lookup's New Contact (measured).
const free = async (f) => (await f.scope.count()) > 0 && !(await f.s.page.evaluate((m) => [...document.querySelectorAll('[role=dialog][aria-modal="true"]')].some((d) => {
  const r = d.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !d.closest('[aria-hidden="true"]') && !d.closest(`[data-sf-tester-form="${m}"]`) && !d.querySelector(`[data-sf-tester-form="${m}"]`);
}), f.mark).catch(async (e) => { throw (await isOpen(f)) ? e : gone(f); })); // a navigation destroys the context

// The names of the dialogs shown that are not the form's own; with has, only those holding it.
const others = (f, has) => (has ? f.s.page.getByRole('dialog').filter({ has }) : f.s.page.getByRole('dialog')).evaluateAll((els, m) => els.filter((e) => !e.closest(m) && !e.querySelector(m)).map((e) => e.getAttribute('aria-label')
  || (e.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ')
  || (e.querySelector('h1, h2') || {}).textContent?.trim() || ''), `[data-sf-tester-form="${f.mark}"]`);

async function covered(f) {
  const dialogs = await others(f); // the form's own dialog is no cover
  throw new SfUiError('FORM_COVERED', `the form for ${f.recordId || 'the new record'} is under the dialog ${dialogs.map((d) => `"${d}"`).join(', ')}: finish or close that dialog first`, { recordId: f.recordId, dialogs });
}

// A dialog over the form (a lookup's New Account, Choose values to keep) hides it from the page's roles for a while: its
// marked element still showing under a dialog is the form still open.
const isOpen = async (f) => (await f.scope.count()) > 0 || (!!f.marked && (await f.marked.first().isVisible()) && (await f.s.page.getByRole('dialog').count()) > 0);

function fieldOf(f, apiName) {
  const field = f.model.fields.find((x) => x.apiName === apiName);
  if (!field) throw new SfUiError('FIELD_NOT_ON_FORM', `${apiName} is not on this user's form`, { apiName });
  if (!field.editable) throw new SfUiError('FIELD_NOT_EDITABLE', `${apiName} is read-only for this user`, { apiName });
  return field;
}

// A lookup's search name for a record id, read as the user with every target's name fields (the API skips the rest).
// 400 or 404, which an id-shaped name gets too, is a miss; 403 (a record this user cannot read) is VALUE_NOT_FOUND.
async function lookupName(f, field, id) {
  const targets = (await api.call(f.s, `/ui-api/object-info/${f.model.objectApiName}`)).fields[field.apiName].referenceToInfos;
  const wanted = targets.flatMap((t) => t.nameFields.map((n) => `${t.apiName}.${n}`)).join(',');
  const rec = await api.call(f.s, `/ui-api/records/${id}?optionalFields=${wanted}`).catch((e) => {
    if (e.code !== 'API_ERROR' || ![400, 403, 404].includes(e.evidence.status)) throw e;
    if (e.evidence.status === 403) throw new SfUiError('VALUE_NOT_FOUND', `${field.label}: this user cannot read record ${id} (403 ${e.evidence.errorCode || ''})`.trim(), { apiName: field.apiName, value: id, status: 403, errorCode: e.evidence.errorCode });
    return { miss: { status: e.evidence.status, errorCode: e.evidence.errorCode } };
  });
  if (rec.miss) return rec;
  const name = (rec.fields.Name || Object.values(rec.fields).find((v) => v.value) || {}).value;
  if (!name) throw new SfUiError('VALUE_NOT_FOUND', `record ${id} has no name for the ${field.label} search`, { apiName: field.apiName, value: id });
  return { name, apiName: rec.apiName };
}

// A lookup to several objects searches the one its switcher shows ("Name—Current Selection: Contacts, Pick an object");
// another is chosen from the switcher's menu by its plural label, as a user does. No switcher: nothing to choose.
const switcherOf = (f, field, objects) => f.scope.getByRole('button', objects ? { name: `${field.label}—Current Selection: ${objects}, Pick an object`, exact: true }
  : { name: new RegExp(`^${esc(field.label)}—Current Selection: .*, Pick an object$`) }); // objects: the one shown, else any
async function switchTo(f, field, object) {
  const switcher = switcherOf(f, field);
  if (!(await switcher.count())) return;
  const { labelPlural } = await api.call(f.s, `/ui-api/object-info/${object}`);
  const showing = switcherOf(f, field, labelPlural);
  if (await showing.count()) return;
  await switcher.click();
  const item = f.s.page.getByRole('menuitem', { name: labelPlural, exact: true });
  if (!(await item.first().waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
    const objects = (await f.s.page.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    await f.s.page.keyboard.press('Escape');
    throw new SfUiError('VALUE_NOT_FOUND', `${field.label} offers no ${labelPlural} in its object menu`, { apiName: field.apiName, object, objects });
  }
  await item.first().click();
  await showing.waitFor({ timeout: 5_000 }).catch((e) => {
    if (e.name !== 'TimeoutError') throw e; // a closed page is not a switch that did not take
    throw new SfUiError('VALUE_NOT_SET', `${field.label} did not switch to ${labelPlural}`, { apiName: field.apiName, object });
  });
}

// An Aura lookup (a Task's Name and Related To) shows its choice as a pill in a list "<label> - Current Selection: …".
const pillOf = (f, field) => f.scope.getByRole('list', { name: new RegExp(`^${esc(field.label)} - Current Selection`) });
// A Rich Text Area shows a group with a toolbar and no textbox until a click mounts its editor (F-cascade-3).
const richOf = (f, field) => f.scope.getByRole('group', { name: field.label, exact: true }).filter({ has: f.s.page.getByRole('toolbar') });
const shownOf = (f, field) => (field.dataType === 'Reference' ? locate(f, field).or(pillOf(f, field))
  : field.dataType === 'TextArea' ? locate(f, field).or(richOf(f, field)) : locate(f, field));

// Types the record name (clearing the old choice once any id is read) and picks the first-line match once two reads
// agree; two such options are AMBIGUOUS. A record id types its name and picks the option with that id, or when no
// option carries one, the one with its name (save then checks the stored id).
async function setLookup(f, field, input, value, { timeout = 10_000, object: named } = {}) {
  const v = value == null ? '' : String(value);
  const read = nav.isId(v) ? await lookupName(f, field, v) : null; // before the clear, so a failed read keeps the choice
  // The object to search: an id's own, else the one the caller names, which the field must look up.
  const object = read && !read.miss ? read.apiName : named;
  if (named && object !== named) throw new SfUiError('BAD_ARGS', `${field.label}: record ${v} is a ${object}, not the ${named} objects names`, { apiName: field.apiName, value, object, named });
  if (named && object === named) {
    const offered = (await api.call(f.s, `/ui-api/object-info/${f.model.objectApiName}`)).fields[field.apiName].referenceToInfos.map((t) => t.apiName);
    if (!offered.includes(named)) throw new SfUiError('VALUE_NOT_FOUND', `${field.label} looks up ${offered.join(', ')}, not ${named}`, { apiName: field.apiName, object: named, objects: offered });
  }
  const clear = f.scope.getByRole('button', { name: `Clear ${field.label} Selection`, exact: true })
    .or(pillOf(f, field).getByRole('button', { name: 'To remove the selected record, press Backspace or Del.', exact: true }));
  let cleared = (await clear.count()) > 0; // a failure after this says so: a save would write a blank
  // An edit's Aura pill renders a moment after the form: a clear waits for it while the record holds a choice.
  if (!cleared && v === '' && f.recordId && (await holdsChoice(f, field))) {
    cleared = await clear.first().waitFor({ timeout }).then(() => true, () => false);
    if (!cleared) throw new SfUiError('VALUE_NOT_SET', `${field.label}: record ${f.recordId} holds a ${field.label}, but the form showed none to clear in ${timeout} ms`, { apiName: field.apiName, value, cleared: false });
  }
  // A create has no record to say a lookup opened prefilled, so its clear gives a late pill 3 s to show.
  if (!cleared && v === '' && !f.recordId) cleared = await clear.first().waitFor({ timeout: 3_000 }).then(() => true, () => false);
  const pilled = cleared && (await pillOf(f, field).count()) > 0;
  // From the Clear on, any failure is coded, a raw one too (its whole text, and for a timeout the page), and says
  // whether the old choice is gone.
  const coded = (done) => (e) => {
    if (e instanceof SfUiError) throw Object.assign(e, { evidence: { ...e.evidence, cleared: done } });
    throw Object.assign(new SfUiError(e.name === 'TimeoutError' ? 'LOCATOR_TIMEOUT' : 'UNEXPECTED', `${field.label}: ${e.message}`, { apiName: field.apiName, value, cleared: done, ...(e.name === 'TimeoutError' && { url: f.s.page.url() }) }), { cause: e });
  };
  if (cleared) await clear.click({ timeout }).catch(coded(false));
  // An Aura pill's removal opens its recent-records dropdown over the next field, a moment later; a click on the
  // dialog's heading, or an inline panel's corner, closes it (a blur does not, Tab picks a row, Escape closes the form).
  if (v === '') {
    if (pilled) await closeDropdown(f, field).catch(coded(true));
    return emptied(f, field, value).catch(coded(cleared)); // read back, as a set value is
  }
  // The read-back is inside the coded error too, so its VALUE_NOT_SET says the old choice is gone.
  // A record this user reads that its search does not list yet (another user's, made a moment ago): search again, 60 s in all.
  const end = Date.now() + 60_000;
  const attempt = (ms) => pick(f, field, input, value, v, read, ms, object) // a search again: 3 s, as the full-search row shows at once
    .catch((e) => (e.code === 'NOT_SEARCHABLE_YET' && Date.now() + 3_000 <= end ? input.fill('').then(() => attempt(3_000)) : Promise.reject(e)));
  const set = attempt(timeout).then((picked) => picked && pickedBack(f, field, input, value, picked));
  return cleared ? set.catch(coded(true)) : set;
}

// An Aura pick turns into a pill, whose first line is the name, after a moment in which its box still shows; any other
// lookup's box holds the name.
async function pickedBack(f, field, input, value, picked) {
  const pill = pillOf(f, field).getByRole('listitem').first();
  const got = picked.aura ? await pill.waitFor({ timeout: 5_000 }).then(async () => (await pill.innerText()).split('\n')[0], () => '') : await input.inputValue();
  landed(field, value, picked.name, got.trim());
  return picked;
}

// A clear is read back as empty: no pill and an empty box, within 3 s of the Clear (an Aura pill leaves a moment later).
async function emptied(f, field, value) {
  let got;
  for (const end = Date.now() + 3_000; Date.now() < end; await f.s.page.waitForTimeout(250)) if ((got = ((await shownIn(f, field)) || [])[0]) === '') return;
  // An emptied required lookup's box is renamed ("Assigned To Assigned To", measured): with no pill it is empty.
  if (got === undefined && field.required && !(await pillOf(f, field).count())) return;
  landed(field, value, '', got ?? 'no one box');
}

// Whether the edit's record holds a value for the lookup, read as the user (the record the form edits).
async function holdsChoice(f, field) {
  const o = f.model.objectApiName;
  const r = await api.call(f.s, `/ui-api/records/${f.recordId}?optionalFields=${o}.${field.apiName}`);
  return !!(r.fields[field.apiName] && r.fields[field.apiName].value);
}

async function closeDropdown(f, field) {
  const dropdown = f.scope.getByRole('listitem').filter({ has: f.s.page.getByRole('combobox', { name: field.label, exact: true }) }).getByRole('listbox').first();
  if (!(await dropdown.waitFor({ timeout: 3_000 }).then(() => true, () => false))) return;
  // An inline edit's panel shows no heading (its h2 is 1 px, measured): a click in its corner closes the dropdown.
  await (f.footer ? f.scope.first().click({ position: { x: 5, y: 5 }, timeout: 5_000 }) : f.scope.getByRole('heading').first().click({ timeout: 5_000 }));
  await dropdown.waitFor({ state: 'hidden', timeout: 5_000 });
}

// The typing and the pick of setLookup, after any Clear.
async function pick(f, field, input, value, v, read, timeout, object) {
  const miss = read && read.miss; // typed as a name, as before ids were taken
  const id = read && !miss ? v.slice(0, 15) : null;
  const name = id ? read.name : v;
  const hasId = (d) => d.slice(0, 15) === id;
  if (object) await input.waitFor().then(() => switchTo(f, field, object)); // the switcher draws with the box
  await input.click();
  await input.fill(name);
  // An Aura lookup's listbox has no name and its record rows are <a role=option>, in the field's own row.
  const aura = f.scope.getByRole('listitem').filter({ has: f.s.page.getByRole('combobox', { name: field.label, exact: true }) });
  const named = f.scope.getByRole('listbox', { name: field.label, exact: true });
  const listbox = named.or(aura.getByRole('listbox')).first();
  const options = named.getByRole('group', { name: 'Search Results' }).getByRole('option').or(aura.locator('a[role="option"]'));
  let names = [];
  let ids = [];
  let texts = [];
  const row = (j) => `${texts[j].split('\n').map((l) => l.trim()).filter(Boolean).join(' | ')}${ids[j] ? ` (${ids[j]})` : ''}`;
  let last;
  let unsettled = false; // the last read differed from the one before it, so nothing was tried on it
  let clickFailed = false; // the option was listed and settled, and a click on it failed
  for (const end = Date.now() + timeout; Date.now() < end; await f.s.page.waitForTimeout(250)) {
    // The dropdown sometimes closes over the typed text, before or during the pick; a click reopens it.
    if (!(await listbox.isVisible())) await input.click();
    // An Aura row's id is in its component's value only (ui:autocompleteOption v.value.id, measured as admin and user):
    // Aura's private runtime, so if it changes the id reads '' and the pick falls back to the by-name path (fails closed).
    const rows = await options.evaluateAll((els) => els.map((el) => [el.innerText, el.getAttribute('data-value') || (() => { try { return $A.getComponent(el.getAttribute('data-aura-rendered-by')).getComponentValueProvider().get('v.value').id || ''; } catch { return ''; } })()]));
    texts = rows.map(([t]) => t);
    names = texts.map((t) => t.split('\n')[0].trim());
    ids = rows.map(([, d]) => d);
    const seen = JSON.stringify(rows);
    unsettled = seen !== last;
    if (unsettled) { last = seen; continue; }
    const byName = id && names.length && !ids.some(Boolean); // no option carries an id: by its name, checked at save
    const isAura = !(await named.count()); // before the click, which closes an LWC lookup's named listbox
    if (id && !byName) {
      const k = ids.findIndex(hasId);
      if (k >= 0) { if (await options.nth(k).click({ timeout: 2_000 }).then(() => true, () => false)) return { name, aura: isAura, id: ids[k] }; clickFailed = true; }
      continue;
    }
    const twins = names.flatMap((n, j) => (n === name ? [row(j)] : []));
    if (twins.length > 1) throw new SfUiError('AMBIGUOUS', byName ? `${twins.length} ${field.label} options are named "${name}" and none carries an id, so record ${value} cannot be told apart` : `${twins.length} ${field.label} records are named "${value}"; pass the record id`, { apiName: field.apiName, value, options: twins });
    const i = names.indexOf(name);
    if (i >= 0) { if (await options.nth(i).click({ timeout: 2_000 }).then(() => true, () => false)) return { name, byName, aura: isAura, id: ids[i] }; clickFailed = true; }
  }
  const listed = id ? ids.some(hasId) || (!ids.some(Boolean) && names.includes(name)) : names.includes(name);
  const changing = unsettled && listed;
  const failed = !changing && listed && clickFailed;
  const what = id ? `record ${value}` : `"${value}"`;
  const asId = miss ? `; the API answered ${[miss.status, miss.errorCode].filter(Boolean).join(' ')} for it as a record id${miss.status === 404 ? ', so this user cannot read a record with that id' : ''}` : '';
  // The object searched (asked, else the switcher's); an Aura dropdown with only its full-search row ("… in Products"):
  // the search lags for an id this user read (3-56 s, another user's record), and by name may be a record it cannot see.
  const showing = /—Current Selection: (.*), Pick an object"/.exec(await switcherOf(f, field).first().ariaSnapshot({ timeout: 1_000 }).catch(() => ''));
  const searched = object || (showing && showing[1]);
  const only = names.length ? [] : (await aura.getByRole('option').allInnerTexts().catch(() => [])).filter((t) => /" in \S/.test(t));
  const full = only.length ? only[0].replace(/\s+/g, ' ').trim() : '';
  if (id && full) throw new SfUiError('NOT_SEARCHABLE_YET', `${field.label}: this user reads record ${value} ("${name}"), but its search, made again for up to 60 s, listed no record, only its full search (${full}); a record another user made can take about a minute to be searchable`, { apiName: field.apiName, value, ...(searched && { searched }) });
  const where = `${searched ? ` in ${searched}` : ''}${full ? `; the dropdown listed no record, only its full search (${full}): not searchable yet for this user (a record another user made in the last minute), or not visible to this user` : ''}`;
  const none = id ? `no ${field.label} option for record ${value} ("${name}")${where}` : `no ${field.label} record named "${value}"${where}${asId}`;
  const why = changing ? `the ${field.label} results kept changing, so ${what} was not picked` : failed ? `the ${field.label} option for ${what} is listed, but every click on it failed` : none;
  throw new SfUiError('VALUE_NOT_FOUND', why,
    { apiName: field.apiName, value, options: names.map((_, j) => row(j)), ...(searched && { searched }), ...(changing && { unsettled: true }), ...(failed && { clickFailed }), ...miss });
}

// A dependent picklist offers only what its controller allows, so a missing option is reported, not waited on.
// A dropdown can close before the click (once, an Account's Rating): it is opened once more, then it is TIMEOUT.
async function setPicklist(f, field, input, value, { timeout = 5_000 } = {}) {
  await input.click();
  // An Aura picklist's listbox has no name or id and sits outside the form, in the popup its combobox controls.
  const controls = await input.getAttribute('aria-controls');
  const listbox = f.scope.getByRole('listbox', { name: field.label, exact: true }).or(f.s.page.locator(`[id="${controls}"]`).getByRole('listbox'));
  const option = listbox.getByRole('option', { name: String(value), exact: true });
  const stuck = (why, visible) => new SfUiError('TIMEOUT', `the ${field.label} option "${value}" took no click: ${why}`, { apiName: field.apiName, value, visible });
  let seen = false; // shown once: a later list without it is no proof that the value is missing
  for (const last of [false, true]) {
    let shown = false; // still shown after a click that did not land: clicked again, since a press would close it
    if (await option.waitFor({ timeout }).then(() => true, () => false)) {
      seen = true;
      const failed = await option.click({ timeout }).then(() => null, (e) => e);
      if (!failed) return;
      if (failed.name !== 'TimeoutError') throw failed;
      shown = await option.isVisible();
    } else if (!seen && (await listbox.first().isVisible())) { // only an open list proves that the value is missing
      const options = (await listbox.getByRole('option').allInnerTexts()).map((t) => t.trim());
      throw new SfUiError('VALUE_NOT_FOUND', `${field.label} offers no "${value}" here`, { apiName: field.apiName, value, options });
    }
    if (last) throw stuck(shown ? 'it stayed shown, and two clicks did not land' : 'the dropdown closed or did not show it, twice', shown);
    if (!shown) await input.click({ timeout }).catch((e) => { throw e.name === 'TimeoutError' ? stuck('the dropdown closed, and its box took no press to open it again', false) : e; });
  }
}

// Moves options between the two listboxes until Chosen holds exactly the given "A;B", checking every value first.
async function setMulti(f, field, group, value) {
  const want = String(value ?? '').split(';').map((v) => v.trim()).filter(Boolean);
  const list = (name) => group.getByRole('listbox', { name, exact: true });
  const names = async (name) => (await list(name).getByRole('option').allInnerTexts()).map((t) => t.trim());
  const move = async (from, to, name) => {
    await list(from).getByRole('option', { name, exact: true }).click();
    await group.getByRole('button', { name: `Move selection to ${to}`, exact: true }).click();
  };
  const [chosen, available] = [await names('Chosen'), await names('Available')];
  const unknown = want.filter((v) => !chosen.includes(v) && !available.includes(v));
  if (unknown.length) throw new SfUiError('VALUE_NOT_FOUND', `${field.label} offers no ${unknown.join(', ')}`, { apiName: field.apiName, value, options: [...chosen, ...available] });
  for (const name of want.filter((v) => !chosen.includes(v))) await move('Available', 'Chosen', name);
  for (const name of chosen.filter((v) => !want.includes(v))) await move('Chosen', 'Available', name);
  landed(field, value, [...want].sort().join(';'), (await names('Chosen')).sort().join(';'));
}

// The box's own read right after typing, with fill's rules (act.readBack): VALUE_NOT_SET when it holds another value.
const landed = (field, value, want, got, rich) => readBack(want, got, { rich, label: field.apiName, apiName: field.apiName, value });

// The running user's own formats (Login As can change them); the form accepts only what they read as.
const localeOf = async (f) => f.locale || (f.locale = await f.s.page.evaluate(() => {
  const L = $A.get('$Locale');
  return { date: L.shortDateFormat, time: L.shortTimeFormat, timezone: L.timezone };
}));

// ponytail: numeric short patterns only (M/d/yyyy, dd.MM.yyyy, h:mm a); a MMM pattern would need month names.
const pad = (n) => String(n).padStart(2, '0');
const formatAs = (pattern, p) => pattern.replace(/yyyy|yy|MM|M|dd|d|HH|H|hh|h|mm|a/g, (t) => ({
  yyyy: p.y, yy: String(p.y).slice(2), MM: pad(p.m), M: p.m, dd: pad(p.d), d: p.d,
  HH: pad(p.H), H: p.H, hh: pad(p.H % 12 || 12), h: p.H % 12 || 12, mm: pad(p.min), a: p.H < 12 ? 'AM' : 'PM',
})[t]);

function isoDate(field, value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || !dateOk(value)) throw new SfUiError('INVALID_VALUE', `${field.apiName} takes an ISO date on the calendar (2026-12-31), got "${value}"`, { apiName: field.apiName, value });
  return { y: +m[1], m: +m[2], d: +m[3] };
}

// An instant (2026-11-02T06:37:00Z) as the wall time the user's timezone shows; minutes are the form's precision.
function wallTime(field, value, timeZone) {
  const ms = instantOf(value);
  const { apiName } = field;
  if (Number.isNaN(ms)) throw new SfUiError('INVALID_VALUE', `${apiName} takes an ISO instant with a zone, on the calendar (2026-12-31T17:30:00Z), got "${value}"`, { apiName, value });
  if (ms % 60_000) throw new SfUiError('INVALID_VALUE', `${apiName} takes whole minutes, as the form does, got "${value}"`, { apiName, value });
  const wall = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(t).map((x) => [x.type, +x.value]));
  const p = wall(ms);
  const offset = (t) => { const w = wall(t); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - t; };
  // The first pass of an hour the zone repeats has a later twin with the same wall time, and the form saves the twin.
  const twin = ms + offset(ms) - offset(ms + 3 * 3_600_000);
  if (twin > ms && offset(twin) + twin === offset(ms) + ms) {
    throw new SfUiError('VALUE_NOT_SET', `${apiName}: ${value} is a wall time ${timeZone} repeats when daylight saving ends, and the form saves it as ${new Date(twin).toISOString()}, so this instant cannot be typed`, { apiName, value, timeZone, saves: new Date(twin).toISOString() });
  }
  return { y: p.year, m: p.month, d: p.day, H: p.hour, min: p.minute };
}

async function setFields(f, values, { objects = {}, picklist } = {}) {
  // F-tz-5: an all-day Event's date is typed as the user's wall date, so an instant saves a day early west of UTC.
  const allDay = ['StartDateTime', 'EndDateTime'].filter((k) => k in values);
  if ([true, 'true'].includes(values.IsAllDayEvent) && allDay.length) {
    throw new SfUiError('INVALID_VALUE', `${allDay.join(' and ')} cannot be set as an instant on an all-day Event: the form takes a date only. Tick All-Day Event, then sf_fill the date text ("Jun 1, 2027")`, { apiName: allDay[0], value: values[allDay[0]] });
  }
  await stillOpen(f);
  for (const k of Object.keys(objects)) {
    if (!(k in values) || fieldOf(f, k).dataType !== 'Reference') throw new SfUiError('BAD_ARGS', `objects names ${k}, which is not a lookup in values`, { apiName: k });
  }
  // A controller set after its dependent resets it, so controllers go first whatever order the caller gave.
  const pending = Object.keys(values);
  const order = [];
  while (pending.length) {
    const i = pending.findIndex((k) => !pending.includes(fieldOf(f, k).controllerName));
    order.push(...pending.splice(Math.max(i, 0), 1));
  }
  for (const apiName of order) {
    const value = values[apiName];
    const field = fieldOf(f, apiName);
    let rich = false;
    let confirm = false; // a lookup set by id but picked by name: save checks the stored id
    let picked; // a lookup's option picked, with the record id it carried ('' when none)
    const input = locate(f, field);
    // A modelled field the form does not show (a visibility rule, a page that drifted) is said so, not waited on.
    const shown = shownOf(f, field); // an Aura lookup with a choice is a pill
    if (!(await shown.first().waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
      throw new SfUiError('FIELD_NOT_SHOWN', `${apiName} is on this user's form model but the form does not show it`, { apiName, conditional: !!field.conditional });
    }
    if (field.dataType === 'Reference') {
      picked = await setLookup(f, field, input, value, { object: objects[apiName] });
      confirm = !!(picked && picked.byName) || value == null || value === ''; // a clear: save checks the record holds none
    } else if (field.dataType === 'Picklist') {
      await setPicklist(f, field, input, value, picklist);
      landed(field, value, String(value), (await input.innerText()).trim());
    } else if (field.dataType === 'Boolean') {
      if (![true, false, 'true', 'false'].includes(value)) throw new SfUiError('INVALID_VALUE', `${apiName} takes true or false, got "${value}"`, { apiName, value });
      // Space from the keyboard: a mouse click on a box low in a long modal lands on the sticky footer instead.
      const want = value === true || value === 'true';
      if ((await input.isChecked()) !== want) {
        await input.focus();
        await input.press('Space');
        if ((await input.isChecked()) !== want) throw new SfUiError('VALUE_NOT_SET', `${apiName} did not change to ${want}`, { apiName, value });
      }
    } else if (field.dataType === 'Date') {
      const typed = value ? formatAs((await localeOf(f)).date, isoDate(field, value)) : '';
      await input.fill(typed);
      landed(field, value, typed, await input.inputValue());
    } else if (field.dataType === 'DateTime') {
      const L = await localeOf(f);
      const p = value ? wallTime(field, value, L.timezone) : null;
      // Leaving the date fills a default 12:00 PM, which collides with a time typed before it lands. Each part is
      // read back before the Tab that blurs it, as a blur may format it.
      const date = input.getByRole('textbox', { name: 'Date', exact: true });
      const time = input.getByRole('combobox', { name: 'Time', exact: true });
      const [day, hour] = p ? [formatAs(L.date, p), formatAs(L.time, p)] : ['', ''];
      await date.fill(day);
      landed(field, value, day, await date.inputValue());
      await date.press('Tab');
      await time.fill(hour);
      landed(field, value, hour, await time.inputValue());
      await time.press('Tab');
    } else if (field.dataType === 'MultiPicklist') {
      await setMulti(f, field, input, value);
    } else if (field.dataType === 'Time') {
      // Wall-clock time with no zone: typed as the user reads it, stored as given.
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
      if (value && !m) throw new SfUiError('INVALID_VALUE', `${apiName} takes a time as HH:mm (14:30), got "${value}"`, { apiName, value });
      const typed = m ? formatAs((await localeOf(f)).time, { H: +m[1], min: +m[2] }) : '';
      await input.fill(typed);
      landed(field, value, typed, await input.inputValue()); // before the blur formats it
      await input.press('Tab');
    } else {
      if (field.dataType === 'TextArea' && !(await input.count()) && (await openRich(f.scope, field.label))) await input.waitFor({ timeout: 5_000 });
      await replaceText(input, String(value));
      const [got, isRich] = await boxValue(input); // a Rich Text Area is a contenteditable, not an input
      landed(field, value, String(value), got, (rich = isRich));
    }
    // What save checks the stored value against, while the form still shows what it shows now.
    (f.set ||= {})[apiName] = { value, kind: field.dataType, rich, shown: ((await shownIn(f, field)) || [])[0], ...(confirm && { confirm }), ...(picked && picked.id && { id: picked.id }) };
  }
}

// The field's box as the form shows it now, as [text, rich]: a picklist its label, a lookup its record name, a checkbox
// "true" or "false"; undefined when the form shows no one such box.
async function shownIn(f, field) {
  const pill = pillOf(f, field).getByRole('listitem').first(); // an Aura lookup's choice: its first line is the name
  if (field.dataType === 'Reference' && (await pill.count())) return [(await pill.innerText({ timeout: 2_000 })).split('\n')[0].trim(), false];
  const input = locate(f, field);
  if ((await input.count()) !== 1) return undefined;
  const t = { timeout: 2_000 };
  const text = (x) => [x, false];
  if (field.dataType === 'Picklist') return text((await input.innerText(t)).trim().replace(/^--None--$/, ''));
  if (field.dataType === 'Reference') return text((await input.inputValue(t)).trim());
  if (field.dataType === 'Boolean') return text(String(await input.isChecked(t)));
  if (field.dataType === 'Date' || field.dataType === 'Time') return text(await input.inputValue(t));
  if (field.dataType === 'DateTime') return text(`${await input.getByRole('textbox', { name: 'Date', exact: true }).inputValue(t)} ${await input.getByRole('combobox', { name: 'Time', exact: true }).inputValue(t)}`);
  if (field.dataType === 'MultiPicklist') return text((await input.getByRole('listbox', { name: 'Chosen', exact: true }).getByRole('option').allInnerTexts()).map((x) => x.trim()).sort().join(';'));
  // A blurred number box shows display text ($1,500.50, 35%, 1,235); its lightning-input host holds the number. null: none.
  if (NUMBER.includes(field.dataType)) return text(await input.evaluate((e) => { for (let n = e; n; n = n.parentNode || n.host) if (n.localName === 'lightning-input') return String(n.value ?? ''); return null; }, null, t));
  return boxValue(input);
}

// sf_fill on a box of the open form: the one editable field its label names joins the set, so a left save checks it.
function filled(f, label, value) {
  const hits = f.model.fields.filter((x) => x.editable && x.label === label);
  if (hits.length === 1) (f.set ||= {})[hits[0].apiName] = { value, kind: hits[0].dataType, rich: false };
  else (f.unmatched ||= []).push({ label, why: `sf_fill typed into "${label}", which names ${hits.length ? 'more than one editable field' : 'no editable field'} of the form` });
}

// Kinds whose box text is a value the stored one compares with (a number from its host, a label, a record name).
const AS_SHOWN = ['String', 'TextArea', 'Phone', 'Email', 'Url', 'ComboBox', 'Picklist', 'Reference', 'MultiPicklist', 'Boolean', 'Double', 'Int', 'Long', 'Currency', 'Percent'];

// Each set field's value as the form holds it at the Save press: as set while the box shows what it showed then, else
// its text now (empty, or a kind in AS_SHOWN); else why it cannot be compared.
async function formHolds(f) {
  const out = {};
  for (const [apiName, x] of Object.entries(f.set || {})) {
    const field = f.model.fields.find((m) => m.apiName === apiName);
    const [now, rich] = (field && (await shownIn(f, field).catch(() => undefined))) || [];
    out[apiName] = { kind: x.kind, scale: field && field.scale, rich: x.rich || !!rich,
      ...(x.kind === 'Reference' && (x.value == null || x.value === '') ? { value: '' } // a clear: the record must hold none
        : now === undefined ? { why: 'the form no longer showed it at Save, so what it saved is not known' }
        : now === null ? { why: 'its box gave no number at Save, only display text' }
          : now === x.shown ? { value: x.id || x.value, ...(x.id && String(x.value).slice(0, 15) !== x.id.slice(0, 15) && { name: x.value }) } // the option's id: Task.Who has no displayValue
            : now === '' || AS_SHOWN.includes(x.kind) ? { value: now }
              : { why: `the form showed "${now}" at Save, not the value set` }) };
  }
  return out;
}

// The stored value against the one typed, by kind; undefined for a kind not compared (rich text, a compound field).
const NUMBER = ['Double', 'Int', 'Long', 'Currency', 'Percent'];
const STRING = ['String', 'TextArea', 'Phone', 'Email', 'Url', 'Date', 'Boolean', 'ComboBox'];
function stored(kind, typed, { value, displayValue }, name, scale) {
  const want = typed == null ? '' : String(typed);
  if (want === '') return value == null || value === '';
  if (NUMBER.includes(kind)) {
    const n = Number(want.replace(/,/g, '')), p = 10 ** scale; // the org drops 1,000's comma
    if (value == null) return false;
    // Past its scale the org rounds or truncates by field type, so either neighbour at that scale matches.
    const past = Number.isInteger(scale) && (want.split('.')[1] || '').length > scale;
    return n === Number(value) || (past && [Math.floor(n * p), Math.ceil(n * p)].some((k) => k / p === Number(value)));
  }
  if (kind === 'DateTime') return value != null && instantOf(want) === instantOf(value); // the whole instant
  if (kind === 'Time') return String(value ?? '').slice(0, 5) === want;
  const set = (v) => String(v ?? '').split(';').map((x) => x.trim()).filter(Boolean).sort().join(';');
  if (kind === 'MultiPicklist') return set(want) === set(value) || (displayValue != null && set(want) === set(displayValue)); // labels, as setMulti picks
  if (kind === 'Reference') return sameValue(want, value, name, { id: true, name: true });
  if (kind === 'Picklist') return sameValue(want, value, displayValue, { name: true }); // a label, or the API value
  // The org trims text at both ends and lowercases an email, so each compares in that form.
  const text = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (kind === 'Email') return text(want).toLowerCase() === text(value).toLowerCase();
  if (STRING.includes(kind)) return sameValue(text(want), text(value));
  return undefined;
}

// The edit's record as admin (the save may take the user's access): its stamp, last writer and each field the form set,
// with each set lookup's record name when names is given (its relationship names, from object-info).
async function readBackRecord(f, names, signal) {
  const o = f.model.objectApiName;
  const set = Object.keys(f.set || {});
  const rels = Object.values(names || {}).map((r) => `${o}.${r}.Id`);
  const optional = [...set.map((k) => `${o}.${k}`), ...rels].join(',');
  const r = await api.call(f.s, `/ui-api/records/${f.recordId}?fields=${o}.SystemModstamp,${o}.LastModifiedById${optional ? `&optionalFields=${optional}` : ''}`, { as: 'admin', signal });
  const v = (k) => (r.fields[k] ? r.fields[k].value : undefined);
  return { at: v('SystemModstamp'), by: v('LastModifiedById'), fields: r.fields, names };
}

// Saved = the form closes and what it set is proved (a read-back, or a left edit's stamp). Blocked = an error this Save
// drew: the "We hit a snag." dialog, an inline popover or an Aura error (one an earlier block left is not).
async function save(f, { timeout = 30_000 } = {}) {
  await stillOpen(f);
  const { page } = f.s;
  await armToasts(page);
  // An inline edit blocks in a popover by its footer, outside the panel, whose links name the fields (measured).
  const snag = page.getByRole('dialog', { name: 'We hit a snag.' }).or(page.getByRole('dialog', { name: 'Record Form Error Dialog', exact: true }));
  // A save another tab or user overtook: Salesforce asks which values to keep, in a dialog with a Save of its own.
  const conflict = page.getByRole('dialog', { name: 'Choose values to keep' });
  // An Aura dialog (a Task's) blocks in place: this banner, and an alert under each failing field.
  const review = f.scope.getByText('Review the errors on this page.', { exact: true });
  // Every save moves the stamp, a no-change one too, to the second. An unread record is null, and the evidence shows it.
  const unread = []; // why a read came back null, for the evidence
  const read = (run) => inTime(run).catch((e) => { unread.push(String(e.code ? e.message : `${e.name}: ${e.message}`).split('\n')[0]); return null; });
  const before = f.recordId ? await read((signal) => readBackRecord(f, undefined, signal)) : null;
  const held = await formHolds(f); // the values a left save, a confirmed save or a create is checked against
  const shown = nav.recordIdOf(page.url()); // a create's page before the Save: never its new record
  const stale = await review.isVisible(); // an earlier block's banner stays until the dialog closes
  const tasks = !f.recordId && f.model.objectApiName === 'Task' ? await read((signal) => tasksNamed(f, signal)) : null;
  // A lookup set by id on an Aura lookup (picked by its name) or cleared is proved by the stored id: compared, or held
  // before, on a save that stays on the record or leaves it.
  const confirms = Object.keys(f.set || {}).filter((k) => f.set[k].confirm);
  const unprovedOf = (values) => confirms.filter((k) => !values.checked.includes(k) && !values.notChecked.some((x) => x.apiName === k && x.why === HELD));
  const blank = (k) => f.set[k].value == null || f.set[k].value === '';
  const what = (k) => (f.set[k].kind !== 'Reference' ? `the value the form held for ${k}` : blank(k) ? `an empty ${k}` : nav.isId(String(f.set[k].value)) ? `the record id given for ${k}` : `the record picked by name for ${k}`);
  // One rule for a create and a save that stays: a field it does not hold, else a confirm field not compared; null: proved.
  const failing = (values) => {
    const [wrong, unproved] = [values.mismatched.map((m) => m.apiName), unprovedOf(values)];
    return wrong.length ? `it does not hold ${wrong.map(what).join(', ')}` : unproved.length ? `${unproved.map(what).join(', ')} was not compared` : null;
  };
  // A create is checked as an edit is, once its id is known: each field set, a lookup by id and a "" clear too.
  const createdAs = async (recordId, extra) => {
    const after = Object.keys(held).length ? await read((signal) => valuesAfter({ ...f, recordId }, signal)) : undefined;
    const values = after ? valueCheck(held, { fields: {} }, after, f.unmatched) : undefined;
    const why = after === null ? 'its values could not be read back' : values && failing(values);
    if (why) throw new SfUiError('CREATE_UNCONFIRMED', `record ${recordId} was created, but ${why}`, { recordId, values, unread, toasts: raised(page) });
    return { outcome: 'saved', recordId, ...extra, toasts: raised(page), fieldErrors: [], pageErrors: [], ...(values && { values }) };
  };
  // An earlier block's errors keep their nodes through a corrected save (measured on sfui-s4-map): marked, never read.
  await f.scope.locator(AURA_ERRORS.join(', ')).evaluateAll((els) => els.forEach((e) => e.setAttribute('data-sf-tester-old', '')));
  await press(f, 'Save');
  const clicked = Date.now();
  await Promise.race([f.scope.first().waitFor({ state: 'hidden', timeout }), snag.waitFor({ timeout }), conflict.waitFor({ timeout }), review.waitFor({ timeout })]);
  if (await conflict.isVisible()) {
    return { outcome: 'conflict', snapshot: (await conflict.ariaSnapshot()).slice(0, 3000), toasts: raised(page), fieldErrors: [], pageErrors: [] };
  }
  // The banner stays up after an earlier block, so blocked needs an error to show; with none the dialog gets the save's
  // own bound to close, as a slow save's does.
  const closed = (ms) => f.scope.first().waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false);
  if ((await review.isVisible()) && !(stale && (await closed(5_000)))) {
    const errors = await auraErrors(f);
    if (errors.fieldErrors.length || errors.pageErrors.length) return { outcome: 'blocked', toasts: raised(page), ...errors };
    if (!(await closed(Math.max(timeout - (Date.now() - clicked), 1)))) { // never 0: Playwright reads it as no limit
      const late = await auraErrors(f, false); // an error that rendered after the first read
      if (late.fieldErrors.length || late.pageErrors.length) return { outcome: 'blocked', toasts: raised(page), ...late };
      throw new SfUiError(f.recordId ? 'SAVE_UNCONFIRMED' : 'CREATE_UNCONFIRMED', `the dialog still shows "Review the errors on this page." with no error listed, and did not close within ${timeout} ms of the Save`, { recordId: f.recordId, url: page.url(), toasts: raised(page) });
    }
  }
  // A saved create lands on its new record's page, which is where its id comes from; its toast can fire on the way.
  // A saved edit stays on its record's page; one that left it (a login page, a redirect) is saved only if its stamp moved
  // and its writer and its values confirm it.
  const created = (u) => { const id = nav.recordIdOf(u); return id && id !== shown ? id : undefined; };
  // A Task create (its read worked) opens no record page, so the read runs once the dialog closed, with no URL wait.
  if (!tasks && !(await snag.isVisible())) await page.waitForURL((u) => (f.recordId ? nav.showsRecord(u.href, f.recordId) : !!created(u.href)), { timeout: 15_000 }).catch(() => {});
  const opened = created(page.url()); // the new record page the save left the form on
  if (!(await snag.isVisible())) {
    if (!f.recordId && !opened) {
      // A Task create stays on its home: the one Task with the typed Subject this user holds now and did not before.
      const now = tasks && (await read((signal) => tasksNamed(f, signal)));
      const made = now ? now.filter((id) => !tasks.includes(id)) : []; // no count from a read that failed: unread says why
      if (made.length === 1) return createdAs(made[0], { recordIdFrom: 'the one Task this user created with this Subject during the save' });
      const why = !tasks ? `the New dialog closed but no new record page opened${f.model.objectApiName === 'Task' ? ', and the Tasks with this Subject could not be read before the Save (unread says why)' : ''}` : !now ? 'the New dialog closed on the Task home, and the Tasks with this Subject could not be read after the Save (unread says why)'
        : `the New dialog closed on the Task home, and this user holds ${made.length ? `${made.length} new Tasks` : 'no new Task'} with this Subject since the Save, not one`;
      throw new SfUiError('CREATE_UNCONFIRMED', why, { url: page.url(), toasts: raised(page), ...(now && { tasksMade: made.length }), ...(unread.length && { unread }) });
    }
    if (f.recordId && !nav.showsRecord(page.url(), f.recordId)) {
      // The window runs from the read before the click to the read after the 15 s URL wait, so the stamp must move and
      // name the user the form runs as. ponytail: a flow or another session running as that user passes too.
      const after = before && (await read((signal) => valuesAfter(f, signal)));
      const runsAs = userOf(f.s);
      const moved = !!after && !!before && after.at !== before.at;
      const byUs = !!runsAs && String(after?.by || '').slice(0, 15) === runsAs.slice(0, 15);
      const modstamp = { before: before && { at: before.at, by: before.by }, after: after && { at: after.at, by: after.by }, runsAs, ...(unread.length && { unread }) };
      const why = !after ? `the record could not be read ${before ? 'after' : 'before'} the Save (modstamp.unread says why)` : !moved ? 'its SystemModstamp did not move'
        : `its SystemModstamp moved by ${after.by}, not ${runsAs || 'the running user'}`;
      const values = moved ? valueCheck(held, before, after, f.unmatched) : undefined;
      // Every set field holds and only the writer differs: say so, since another user's same write looks identical.
      if (moved && !byUs && !values.mismatched.length && !values.notChecked.length) {
        throw new SfUiError('SAVE_UNCONFIRMED', `the page left record ${f.recordId}; the record holds the values the form set, but ${after.by} wrote it last, so this save cannot be told from theirs`, { recordId: f.recordId, url: page.url(), modstamp, by: after.by, values, toasts: raised(page) });
      }
      if (!moved || !byUs) throw new SfUiError('SAVE_UNCONFIRMED', `the edit form closed but the page left record ${f.recordId}, and ${why}`, { recordId: f.recordId, url: page.url(), modstamp, toasts: raised(page) });
      if (values.mismatched.length) throw new SfUiError('SAVE_UNCONFIRMED', `the page left record ${f.recordId} and it does not hold the value the form held for ${values.mismatched.map((m) => m.apiName).join(', ')}`, { recordId: f.recordId, url: page.url(), modstamp, values, toasts: raised(page) });
      const unproved = unprovedOf(values);
      if (unproved.length) throw new SfUiError('SAVE_UNCONFIRMED', `the page left record ${f.recordId} and ${unproved.map(what).join(', ')} was not compared`, { recordId: f.recordId, url: page.url(), modstamp, values, toasts: raised(page) });
      return { outcome: 'saved', recordId: f.recordId, toasts: raised(page), fieldErrors: [], pageErrors: [], values };
    }
    // A save that stays reads the record back for a confirm field; the call's other fields are compared as a left save's are.
    if (f.recordId && confirms.length) {
      const after = before && (await read((signal) => valuesAfter(f, signal)));
      const values = after ? valueCheck(held, before, after, f.unmatched) : null;
      const why = !values ? 'its values could not be read back' : failing(values);
      if (why) throw new SfUiError('SAVE_UNCONFIRMED', `record ${f.recordId} saved, but ${why}`, { recordId: f.recordId, values, unread, toasts: raised(page) });
      return { outcome: 'saved', recordId: f.recordId, toasts: raised(page), fieldErrors: [], pageErrors: [], values };
    }
    if (!f.recordId) return createdAs(opened);
    return { outcome: 'saved', recordId: f.recordId, toasts: raised(page), fieldErrors: [], pageErrors: [] };
  }

  const labels = await snag.getByRole('link').allInnerTexts();
  const pageErrors = (await snag.getByRole('listitem').filter({ hasNot: page.getByRole('link') }).allInnerTexts()).map((t) => t.trim());
  await snag.getByRole('button', { name: 'Close error dialog' }).or(snag.getByRole('button', { name: 'Close', exact: true })).click();
  await snag.waitFor({ state: 'hidden' });
  const fieldErrors = [];
  for (const label of labels.map((l) => l.trim())) {
    const field = f.model.fields.find((x) => x.label === label);
    // Hidden assistive text (a copy of the label, key help) is not the message; a dual listbox's error has no describedby.
    const message = field ? await locate(f, field).evaluate((el) => {
      const root = el.getRootNode();
      const text = (d) => { const c = d.cloneNode(true); c.querySelectorAll('.slds-assistive-text').forEach((a) => a.remove()); return c.textContent.trim(); };
      const read = (ds) => ds.filter((d) => d && !d.classList.contains('slds-assistive-text')).map(text).filter(Boolean).join(' ');
      // An inline box's help sits in an outer shadow root (measured), so each root up from the box is searched.
      const byId = (id) => { for (let r = root; r; r = r.host && r.host.getRootNode()) { const d = r.querySelector(`[id="${id}"]`); if (d) return d; } return null; };
      return read((el.getAttribute('aria-describedby') || '').split(' ').map(byId))
        || read([...root.querySelectorAll('.slds-form-element__help')]);
    }) : '';
    fieldErrors.push({ apiName: field ? field.apiName : undefined, label, message });
  }
  if (f.footer) await page.waitForTimeout(1_000); // an inline Save within about 1 s of its block is dropped (measured)
  return { outcome: 'blocked', toasts: raised(page), fieldErrors, pageErrors };
}

// The user the form runs as: the Login As target, else the token's.
const userOf = (s) => String(s.loggedInAs || s.tokenUserId || '');

// The Tasks the form's user created with the Subject it typed, newest first, read as admin: the user's page cookie
// answers /query 401 INVALID_SESSION_ID (measured), so this is a read the user cannot do through the session.
async function tasksNamed(f, signal) {
  const by = userOf(f.s);
  const subject = f.set && f.set.Subject ? String(f.set.Subject.value).trim() : '';
  if (!nav.isId(by) || !subject) throw new SfUiError('UNREAD', 'no user id or no Subject to find the new Task by');
  const q = `SELECT Id FROM Task WHERE CreatedById = '${by}' AND Subject = '${subject.replace(/[\\']/g, '\\$&')}' ORDER BY CreatedDate DESC LIMIT 200`;
  return (await api.call(f.s, `/query?q=${encodeURIComponent(q)}`, { as: 'admin', signal })).records.map((r) => r.Id);
}

const AURA_ERRORS = ['.has-error .form-element__help', '.errorsListLink'];
// A blocked Aura dialog's errors: each field's list under its row (whose text starts with the label), and the banner's
// list for the page; a server's error can land just after the banner.
async function auraErrors(f, wait = true) {
  // ponytail: a Save clicked within about 1 s of the block is dropped (measured), so the dialog is handed back after 1 s.
  if (wait) await f.s.page.waitForTimeout(1_000);
  const errors = f.scope.locator(AURA_ERRORS.map((x) => `${x}:not([data-sf-tester-old])`).join(', '));
  if (wait) await errors.first().waitFor({ timeout: 2_000 }).catch(() => {});
  const found = await errors.evaluateAll((els) => els.map((e) => [e.innerText.trim(), e.classList.contains('errorsListLink') ? null : ((e.parentElement.closest('[role=listitem], li') || {}).innerText || '')]));
  const byLength = [...f.model.fields].sort((x, y) => y.label.length - x.label.length);
  const fieldErrors = [];
  const pageErrors = [];
  for (const [message, row] of found.filter(([m]) => m)) {
    const field = row != null && byLength.find((x) => row.trim().startsWith(x.label));
    if (field) fieldErrors.push({ apiName: field.apiName, label: field.label, message });
    else pageErrors.push(message);
  }
  return { fieldErrors, pageErrors };
}

// A read bounded at 5 s, since one that never answers would hold the Save click; on expiry it fails closed (null) and
// its request is aborted.
function inTime(run, ms = 5_000) {
  const ac = new AbortController();
  let timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => { ac.abort(); no(new SfUiError('TIMEOUT', `no answer in ${ms} ms`)); }, ms); });
  return Promise.race([run(ac.signal), late]).finally(() => clearTimeout(timer));
}

// The record after a save that left it, with each set lookup's record name.
async function valuesAfter(f, signal) {
  const refs = Object.entries(f.set || {}).filter(([, x]) => x.kind === 'Reference').map(([k]) => k);
  const info = refs.length ? (await api.call(f.s, `/ui-api/object-info/${f.model.objectApiName}`, { as: 'admin', signal })).fields : {};
  return readBackRecord(f, Object.fromEntries(refs.filter((k) => info[k] && info[k].relationshipName).map((k) => [k, info[k].relationshipName])), signal);
}

const HELD = 'the record held this value before the save, so it proves nothing';

// Each set field: checked (the record holds the value the form held), mismatched, or notChecked with why, so a fall
// back to the stamp alone is named. A value that equals the old one proves nothing, and says so.
function valueCheck(held, before, after, unmatched = []) {
  const out = { checked: [], mismatched: [], notChecked: [] };
  for (const [apiName, { value, kind, scale, rich, why: unheld, name }] of Object.entries(held)) {
    const [a, b] = [after.fields[apiName], before.fields[apiName]];
    const rel = after.names && after.names[apiName];
    const ok = unheld || !a ? undefined : stored(kind, value, a, rel && after.fields[rel] ? after.fields[rel].displayValue : undefined, scale);
    const why = unheld || (rich ? 'rich text is stored as HTML' : !a ? 'the field was not read back' : ok === undefined ? `a ${kind} field is not compared`
      : ok && b && JSON.stringify(a.value) === JSON.stringify(b.value) ? HELD : null);
    if (why) out.notChecked.push({ apiName, why });
    else if (ok) out.checked.push(apiName);
    else out.mismatched.push({ apiName, typed: value, stored: a.value, ...(name && { name }) }); // name: a lookup picked by name
  }
  out.notChecked.push(...unmatched); // sf_fill labels that name no one field
  if (!Object.keys(held).length && !unmatched.length) out.notChecked.push({ why: 'no field was set through sf_set_fields or sf_fill, so only the stamp and its writer confirm it' });
  return out;
}

// A form can close between the check and the click (the conflict dialog's Save closes it a moment later), so a click
// that finds no button within 5 s asks again whether the form is open; an open form's button that took no click is TIMEOUT.
// The box typed in last is left first: its blur can draw a field error that moves the footer between mousedown and
// mouseup, and the click is lost (measured, an inline Task Subject "").
const press = async (f, name) => {
  const button = (f.footer || f.scope).getByRole('button', { name, exact: true });
  await f.s.page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; if (a && a.blur) a.blur(); }).catch(() => {}); // a page gone is read by the click below
  return button.click({ timeout: 5_000 }).catch(async (e) => {
    await stillOpen(f);
    if (e.name !== 'TimeoutError') throw e;
    if (!(await button.count())) throw new SfUiError('ACTION_NOT_AVAILABLE', `the form shows no ${name} button`, { recordId: f.recordId, button: name });
    const disabled = await button.first().isDisabled({ timeout: 1_000 }).catch(() => null);
    throw new SfUiError('TIMEOUT', `${name} took no click in 5 s${disabled ? ': it stayed disabled' : ''}`, { recordId: f.recordId, button: name, disabled });
  });
};

async function cancel(f) {
  if (!(await isOpen(f))) { // navigation closed it; a form left in its place (Save & New's next New) is not cancelled
    const dialogs = await others(f, f.s.page.getByRole('button', { name: 'Save', exact: true }));
    if (dialogs.length) throw new SfUiError('FORM_CLOSED', `the edit form for ${f.recordId || 'the new record'} is no longer open; the form on screen is the dialog ${dialogs.map((d) => `"${d}"`).join(', ')}, which this tool did not open`, { recordId: f.recordId, dialogs });
    return;
  }
  await uncovered(f);
  await press(f, 'Cancel');
  await f.scope.waitFor({ state: 'hidden' });
}

module.exports = { editRecord, editInline, createRecord, setFields, filled, save, cancel, stored, valueCheck, wallTime, isoDate };
