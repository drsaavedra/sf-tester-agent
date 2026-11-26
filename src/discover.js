'use strict';

// Metadata reads that replace looking at the page. Record and layout reads run in the page, so they are the
// running user's view (the layout endpoint already drops fields that user cannot see); FlexiPage reads need admin.
const api = require('./api');
const { SfUiError } = require('./errors');
const A = require('./anchors');
const { isId } = require('./nav');

// One component's metadata over Tooling, or undefined; more narrows the query when two share a name.
async function metadataOf(s, type, name, more = '') {
  const q = `SELECT Metadata FROM ${type} WHERE DeveloperName = '${name.replace(/'/g, '')}'${more} LIMIT 1`;
  return (await api.call(s, `/tooling/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records[0]?.Metadata;
}

async function objectOf(s, recordId) {
  if (!s.keyPrefixes) {
    const { objects } = await api.call(s, '/ui-api/object-info');
    s.keyPrefixes = Object.fromEntries(Object.values(objects).filter((o) => o.keyPrefix).map((o) => [o.keyPrefix, o.apiName]));
  }
  return s.keyPrefixes[recordId.slice(0, 3)];
}

// The form this user gets for this record: fields in layout order, with label, type, editability.
// For a record not yet made (mode Create, recordId null), objectApiName names the object; the default record type
// applies, named when it is the user's only one. Given the record page's FlexiPage, a Dynamic Forms page defines the form.
async function formModel(s, recordId, { mode = 'Edit', objectApiName: given, recordTypeId: chosen, flexiPageApiName } = {}) {
  const objectApiName = recordId ? await objectOf(s, recordId) : given;
  // Object-info goes first only for a New form with no type chosen, to name the only one; else beside the layout.
  const early = !recordId && !chosen && (await api.call(s, `/ui-api/object-info/${objectApiName}`));
  const types = early ? Object.values(early.recordTypeInfos || {}).filter((r) => r.available && !r.master) : [];
  const { recordTypeId } = recordId ? await api.call(s, `/ui-api/records/${recordId}?fields=${objectApiName}.Id`)
    : { recordTypeId: chosen || (types.length === 1 ? types[0].recordTypeId : undefined) };
  const [layout, info] = await Promise.all([
    api.call(s, `/ui-api/layout/${objectApiName}?mode=${mode}${recordTypeId ? `&recordTypeId=${recordTypeId}` : ''}`),
    early || api.call(s, `/ui-api/object-info/${objectApiName}`),
  ]);
  const dynamic = flexiPageApiName && (await dynamicFields(s, flexiPageApiName, info, mode, layout));
  if (dynamic) return { objectApiName, recordTypeId, flexiPageApiName, source: 'dynamicForms', mode, fields: dynamic };
  const fields = layout.sections.flatMap((section) => section.layoutRows.flatMap((row) => row.layoutItems.flatMap((item) =>
    item.layoutComponents.filter((c) => c.componentType === 'Field').map((c) => ({
      apiName: c.apiName,
      // The form shows the layout item's label; a compound item (an address) labels each part instead.
      label: item.layoutComponents.length > 1 ? c.label : item.label,
      itemLabel: item.label, // what the view's pencil is named after ("Edit Billing Address")
      dataType: info.fields[c.apiName] ? info.fields[c.apiName].dataType : undefined,
      scale: info.fields[c.apiName] ? info.fields[c.apiName].scale : undefined,
      controllerName: info.fields[c.apiName] ? info.fields[c.apiName].controllerName : undefined,
      editable: mode === 'Edit' ? item.editableForUpdate : mode === 'Create' ? item.editableForNew : false,
      required: item.required,
      section: section.heading,
    })))));
  return { objectApiName, recordTypeId, layoutId: layout.id, source: 'pageLayout', mode, fields };
}

// Field instances of a Dynamic Forms page, labelled as the dialog labels them. A compound instance (an address,
// a location) becomes its parts, as on a layout; a location part's "Loc (Latitude)" shows as "Latitude".
// Null when the page places no field (not Dynamic Forms); [] when it places only fields this user cannot read.
// ponytail: metadata order, not visual order; a field with a visibility rule is marked conditional, not evaluated.
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function dynamicFields(s, flexiPageApiName, info, mode, layout) {
  // The form labels a field as the layout does ("Account Name"), not as object-info ("Account ID").
  // ponytail: a field the layout does not carry keeps the object-info label.
  const items = layout.sections.flatMap((x) => x.layoutRows.flatMap((r) => r.layoutItems));
  const shown = new Map(items.filter((i) => i.layoutComponents.length === 1).map((i) => [i.layoutComponents[0].apiName, i.label]));
  // A compound item is labelled, and its pencil named, as the layout does ("Name"), not as object-info ("Full Name").
  for (const i of items.filter((x) => x.layoutComponents.length > 1)) {
    const parent = info.fields[i.layoutComponents[0].apiName]?.compoundFieldName;
    if (parent && !shown.has(parent)) shown.set(parent, i.label);
  }
  const page = await metadataOf(s, 'FlexiPage', flexiPageApiName);
  const placed = page ? page.flexiPageRegions.flatMap((r) => (r.itemInstances || []).filter((i) => i.fieldInstance)) : [];
  if (!placed.length) return null;
  return placed.flatMap(({ fieldInstance: fi }) => {
    const apiName = fi.fieldItem.replace(/^Record\./, '');
    const field = info.fields[apiName];
    if (!field) return [];
    const behavior = (fi.fieldInstanceProperties || []).find((p) => p.name === 'uiBehavior');
    const ui = behavior ? behavior.value : 'none';
    // An address form shows no box for its coordinates, as a layout lists none (measured on a custom Address).
    const parts = Object.values(info.fields).filter((p) => p.compoundFieldName === apiName
      && !(field.dataType === 'Address' && /(Latitude|Longitude|GeocodeAccuracy)(__s)?$/.test(p.apiName)));
    return (parts.length ? parts : [field]).map((p) => {
      // An address's boxes keep "Site (City)"; only a location's show as "Latitude".
      const inner = field.dataType === 'Location' && new RegExp(`^${escRe(field.label)} \\((.*)\\)$`).exec(p.label);
      return {
        apiName: p.apiName,
        label: inner ? inner[1] : shown.get(p.apiName) || p.label,
        itemLabel: shown.get(apiName) || field.label,
        dataType: p.dataType,
        scale: p.scale,
        role: field.dataType === 'Location' ? 'textbox' : undefined, // a location's numbers are typed as text
        controllerName: p.controllerName,
        editable: ui !== 'readonly' && (mode === 'Edit' ? !!p.updateable : mode === 'Create' ? !!p.createable : false),
        required: ui === 'required' || p.required === true,
        conditional: !!fi.visibilityRule,
        section: null,
      };
    });
  });
}

// The record page the user actually got: Lightning tags the rendered page with its FlexiPage name, lowercased
// (forcegenerated-flexipage_my_record_page_ns__thing__c__view_js...), so no assignment rules to resolve.
// Given create (an object), the page the open New dialog follows (..._thing__c__create_js...).
async function renderedPage(s, { create } = {}) {
  // The shown one: Lightning keeps the last record's page in the DOM, hidden, after an in-app navigation.
  const host = s.page.locator(`${create ? A.recordAction : A.recordHome} > *`).locator('visible=true').first();
  // An open New dialog has drawn its page host, if it has one, by the time its Save shows: no wait.
  const found = create ? (await host.count()) > 0
    : await host.waitFor({ state: 'attached', timeout: 3_000 }).then(() => true, (e) => { if (e.name !== 'TimeoutError') throw e; return false; });
  if (!found) return null; // not a record FlexiPage
  const tag = await host.evaluate((e) => e.tagName.toLowerCase());
  if (!tag.startsWith(A.generatedPagePrefix)) return null; // not a generated page: no FlexiPage name to query
  const object = (create || new URL(s.page.url()).pathname.split('/')[3]).toLowerCase();
  const lower = tag.slice(A.generatedPagePrefix.length).split(`_${object}__${create ? 'create' : 'view'}_js`)[0];
  const q = `SELECT DeveloperName FROM FlexiPage WHERE DeveloperName = '${lower.replace(/'/g, '')}'`;
  const { records } = await api.call(s, `/tooling/query?q=${encodeURIComponent(q)}`, { as: 'admin' });
  return records.length ? records[0].DeveloperName : null;
}

const STANDARD_TABS = { 'Standard.Tab.detail': 'Details', 'Standard.Tab.relatedLists': 'Related', 'Standard.Tab.activity': 'Activity', 'Standard.Tab.collaborate': 'Chatter', 'Standard.Tab.news': 'News' };
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
// Standard components that render under another tag than their placed name spells (measured on the fixture org).
const RENDERED_AS = { 'flowruntime:interview': 'flowruntime-flow' };

// Every component placed on a FlexiPage, each with its region, its DOM tag and the tab titles to open (outer first);
// null when the page is not in the org.
async function placements(s, flexiPageApiName) {
  const page = await metadataOf(s, 'FlexiPage', flexiPageApiName);
  if (!page) return null;
  const items = page.flexiPageRegions.flatMap((r) => (r.itemInstances || [])
    .filter((i) => i.componentInstance)
    .map((i) => ({ region: r.name, c: i.componentInstance, props: Object.fromEntries((i.componentInstance.componentInstanceProperties || []).map((p) => [p.name, p.value])) })));
  return items.map((hit) => {
    // tabsets[i] is the identifier of the tabset holding tabs[i]; the page renders it as data-component-id.
    const tabs = [];
    const tabsets = [];
    for (let region = hit.region; ;) {
      const tab = items.find((i) => i.c.componentName === 'flexipage:tab' && i.props.body === region);
      if (!tab) break;
      const tabset = items.find((i) => i.c.componentName === 'flexipage:tabset' && i.props.tabs === tab.region);
      tabs.unshift(STANDARD_TABS[tab.props.title] || tab.props.title);
      tabsets.unshift(tabset ? tabset.c.identifier : null);
      if (!tabset) break;
      region = tabset.region;
    }
    const [ns, name] = hit.c.componentName.split(':');
    return { componentName: hit.c.componentName, tag: RENDERED_AS[hit.c.componentName] || `${ns}-${kebab(name)}`, identifier: hit.c.identifier, region: hit.region, tabs, tabsets, visibilityRule: hit.c.visibilityRule || null };
  });
}

// Where one component sits on a FlexiPage, or null. Placed twice, the copy whose wrapper (data-component-id) shows
// now; none showing, the first (its tabs get opened); AMBIGUOUS only when two show, as its name cannot say which.
async function lwcOnPage(s, flexiPageApiName, lwcApiName) {
  const hits = ((await placements(s, flexiPageApiName)) || []).filter((p) => p.componentName.split(':')[1] === lwcApiName);
  if (hits.length < 2) return hits[0] || null;
  const shown = [];
  for (const p of hits) if (await s.page.locator(`[data-component-id="${p.identifier}"]`).locator('visible=true').count()) shown.push(p);
  if (shown.length > 1) throw new SfUiError('AMBIGUOUS', `${lwcApiName} is placed ${hits.length} times on ${flexiPageApiName} and ${shown.length} show, so its name cannot say which: aim without lwcApiName (role and name on the page) or report the page`, { lwcApiName, page: flexiPageApiName, places: hits.map(({ identifier, region, tabs, visibilityRule }) => ({ identifier, region, tabs, visibilityRule })) });
  return shown[0] || hits[0];
}

// The record page actions this user is offered (the highlights panel's), from the UI API, with the record opened. A Dynamic
// Actions panel lists its own, each behind its visibility rule; an undecided rule is kept, marked shown: 'unknown'.
async function actions(s, recordId) {
  const panel = await dynamicActions(s, recordId);
  const r = await api.call(s, `/ui-api/actions/record/${recordId}${panel ? '?retrievalMode=All' : ''}`); // All: off the layout too
  const [entry] = Object.values(r.actions); // keyed by the 18-character id, whichever form was passed
  const offered = entry.actions.filter((a) => a.section === 'Page').map(({ apiName, label, type }) => ({ apiName, label, type }));
  if (!panel) return offered;
  const rule = require('./rule');
  const fields = [...new Set(panel.flatMap((a) => (a.rule?.criteria || []).flatMap((c) => [c.leftValue, c.rightValue]))
    .map((v) => /^\{!Record\.(\w+)\}$/.exec(v || '')?.[1]).filter(Boolean))];
  const read = fields.length && await api.call(s, `/ui-api/records/${recordId}?optionalFields=${fields.map((f) => `${panel.object}.${f}`).join(',')}`);
  const ctx = { record: Object.fromEntries(Object.entries(read?.fields || {}).map(([k, v]) => [k, v.value])), formFactor: 'Large' };
  return panel.flatMap(({ name, rule: vr }) => {
    const found = offered.find((a) => a.apiName === name); // not offered: this user cannot run it, so the page hides it
    const shown = found && rule.evaluate(vr, ctx);
    if (!shown) return [];
    return [shown === rule.UNKNOWN ? { ...found, shown: 'unknown', visibilityRule: vr } : found];
  });
}

// Opens the record; its page's highlights panel actions when it has Dynamic Actions, with rules and the object; else null.
async function dynamicActions(s, recordId) {
  await require('./nav').openRecord(s, recordId); // late: nav loads this file's dependencies
  const name = await renderedPage(s);
  const page = name && await metadataOf(s, 'FlexiPage', name);
  const panel = page && require('./page').components(page).find((c) => c.componentName === 'force:highlightsPanel');
  if (panel?.props.enableActionsConfiguration !== 'true') return null;
  return Object.assign(panel.actions, { object: new URL(s.page.url()).pathname.split('/')[3] });
}

// A User Id from an Id, a username or an sf CLI alias (session is required late, so a test can stub it).
async function userId(s, user) {
  if (isId(user) && /^005/.test(user)) return user; // id-shaped only: it goes into SOQL and the Login As URL
  const username = (await require('./session').aliasUsername(user)).replace(/'/g, '');
  const [row] = (await api.call(s, `/query?q=${encodeURIComponent(`SELECT Id FROM User WHERE Username = '${username}' LIMIT 1`)}`, { as: 'admin' })).records;
  if (!row) throw new SfUiError('USER_NOT_FOUND', `no user ${user}; give a User Id (005...), a username or an sf alias`, { user });
  return row.Id;
}

// What a tester cannot see on the page: who may read or edit each field (profile and permission sets
// together, any grant wins), and what runs on save. Admin reads, so it needs no session as the persona.
// ponytail: muting permission sets and permission set group limits are not applied; add them when an org uses them.
async function objectContext(s, objectApiName, { users = [], fields } = {}) {
  const obj = objectApiName.replace(/'/g, '');
  // Every page (a field's grants can sit past the first 2,000 rows), a blip retried once; required late: validity needs this file.
  const q = require('./validity').queryPaged(s);
  const tooling = require('./validity').queryPaged(s, undefined, undefined, '/tooling/query');
  const info = await api.call(s, `/ui-api/object-info/${obj}`, { as: 'admin' });
  const names = fields || Object.keys(info.fields);
  const unknown = names.filter((n) => !info.fields[n]); // a typo would otherwise follow the object's access
  if (unknown.length) throw new SfUiError('NOT_FOUND', `${obj} has no field ${unknown.join(', ')}`, { objectApiName: obj, fields: unknown });
  const access = {};
  // Name, system fields and required fields take no field permission: each follows the object (edit only if updateable).
  const own = users.length && new Set((await q(`SELECT QualifiedApiName FROM EntityParticle WHERE EntityDefinition.QualifiedApiName = '${obj}' AND IsPermissionable = true`)).map((r) => r.QualifiedApiName));
  for (const user of users) {
    const id = await userId(s, user);
    const held = `ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${id}')`;
    const [fieldRows, objectRows] = await Promise.all([
      q(`SELECT Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${obj}' AND ${held}`),
      q(`SELECT PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete FROM ObjectPermissions WHERE SobjectType = '${obj}' AND ${held}`),
    ]);
    const any = (rows, key) => rows.some((r) => r[key]);
    const object = { create: any(objectRows, 'PermissionsCreate'), read: any(objectRows, 'PermissionsRead'), edit: any(objectRows, 'PermissionsEdit'), delete: any(objectRows, 'PermissionsDelete') };
    access[user] = { object, fields: Object.fromEntries(names.map((name) => {
      const f = info.fields[name] || {};
      if (!own.has(name)) return [name, { read: object.read, edit: object.edit && f.updateable !== false, ...(f.required && f.updateable !== false && { required: true }) }];
      const rows = fieldRows.filter((r) => r.Field === `${obj}.${name}`);
      return [name, { read: any(rows, 'PermissionsRead'), edit: any(rows, 'PermissionsEdit') }];
    })) };
  }
  const [rules, triggers, flows] = await Promise.all([
    tooling(`SELECT ValidationName, ErrorDisplayField, ErrorMessage FROM ValidationRule WHERE Active = true AND EntityDefinition.QualifiedApiName = '${obj}'`),
    tooling(`SELECT Name, Status FROM ApexTrigger WHERE TableEnumOrId = '${obj}'`),
    // A custom object's TriggerObjectOrEventId is its Id, so the flow filter names it through the relationship.
    q(`SELECT ApiName, Label, TriggerType, RecordTriggerType FROM FlowDefinitionView WHERE IsActive = true AND TriggerObjectOrEvent.QualifiedApiName = '${obj}'`),
  ]);
  return {
    objectApiName: obj,
    label: info.label,
    ...(users.length && { access }),
    onSave: {
      validationRules: rules.map((r) => ({ name: r.ValidationName, field: r.ErrorDisplayField, message: r.ErrorMessage })),
      triggers: triggers.map((r) => ({ name: r.Name, status: r.Status })),
      flows: flows.map((r) => ({ name: r.ApiName, label: r.Label, when: r.TriggerType, on: r.RecordTriggerType })),
    },
  };
}

module.exports = { userId, metadataOf, formModel, objectContext, renderedPage, placements, lwcOnPage, actions, kebab, escRe };
