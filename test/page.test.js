'use strict';

// resolvePage over the fixture's own files, no org: the expected pages are the ones measured on a scratch org
// (test/page-org.test.js scores the same cases against the rendered page).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { overrides, profileName, resolvePage, ownName } = require('../src/page');

const DEF = path.join(__dirname, 'fixture', 'force-app', 'main', 'default');
const read = (rel) => fs.readFileSync(path.join(DEF, rel), 'utf8');
const app = (name) => { const xml = read(`applications/${name}.app-meta.xml`); return { actionOverrides: overrides(xml, 'actionOverrides'), profileActionOverrides: overrides(xml, 'profileActionOverrides') }; };
const objectOverrides = (o) => overrides(read(`objects/${o}/${o}.object-meta.xml`), 'actionOverrides');
const pick = (appName, object, profile, recordType) => resolvePage({ app: app(appName), objectOverrides: objectOverrides(object) }, { object, profile: profileName(profile), recordType }).page;

// Each case is { app, object, profile, recordType, page }, shared with the org calibration.
const CASES = require('./page-cases');

test('resolvePage returns the page measured on the org for each assignment case', () => {
  assert.ok(CASES.length >= 8);
  for (const c of CASES) assert.equal(pick(c.app, c.object, c.profile, c.recordType), c.page, JSON.stringify(c));
});

test('a profile name no row spells falls through to the app default', () => {
  assert.equal(resolvePage({ app: app('SfUi_App'), objectOverrides: objectOverrides('SfUiTyped__c') }, { object: 'SfUiTyped__c', profile: 'Standard', recordType: 'Beta_Type' }).page, 'SfUi_Typed_App_Page');
});

test('an object with no override resolves to level none', () => {
  assert.deepEqual(resolvePage({ app: { actionOverrides: [], profileActionOverrides: [] }, objectOverrides: [] }, { object: 'Account', profile: 'Admin' }), { page: null, level: 'none' });
});

test('object, profile and record type match in any case, and an object may be spelled with or without its namespace', () => {
  const row = (extra) => ({ content: 'P', object: 'ns__Foo__c', formFactor: 'Large', profile: 'Admin', recordType: 'ns__Foo__c.Beta', ...extra });
  const from = (rows, key) => resolvePage({ app: { actionOverrides: [], profileActionOverrides: rows }, objectOverrides: [] }, key).page;
  assert.equal(from([row()], { object: 'NS__foo__C', profile: 'admin', recordType: 'beta' }), 'P', 'any case');
  assert.equal(from([row()], { object: ['Foo__c', 'ns__Foo__c'], profile: 'Admin', recordType: 'Beta' }), 'P', 'a list of spellings');
  assert.equal(from([row()], { object: 'Foo__c', profile: 'Admin', recordType: 'Beta' }), null, 'one spelling that is neither');
  assert.equal(from([row()], { object: 'ns__Foo__c', profile: 'Admin', recordType: 'Alpha' }), null, 'another record type');
});

test('a row for another form factor is not used', () => {
  const small = { content: 'P', object: 'A__c', formFactor: 'Small', profile: null, recordType: null };
  assert.equal(resolvePage({ app: { actionOverrides: [small], profileActionOverrides: [] }, objectOverrides: [{ ...small, content: 'O' }] }, { object: 'A__c', profile: 'Admin' }).page, null);
});

// The Tooling JSON of the gate page, as the org gives it (a blank right value comes back null).
const { components, rulesFor } = require('../src/page');
const JSON_PAGE = { flexiPageRegions: [
  { name: 'header', itemInstances: [{ componentInstance: { componentName: 'force:highlightsPanel', identifier: 'h', componentInstanceProperties: [{ name: 'actionNames', value: null, valueList: { valueListItems: [{ value: 'Edit', visibilityRule: null }, { value: 'Clone', visibilityRule: { booleanFilter: null, criteria: [{ leftValue: '{!Record.Note__c}', operator: 'EQUAL', rightValue: null }] } }] } }], visibilityRule: null } }] },
  { name: 'col', itemInstances: [{ componentInstance: null, fieldInstance: { fieldItem: 'Record.Note__c', identifier: 'n', visibilityRule: { booleanFilter: null, criteria: [{ leftValue: '{!Record.Level__c}', operator: 'NE', rightValue: 'Low' }] } } }] },
] };

test('components reads actions and fields from Tooling JSON the way it reads the XML', () => {
  const [panel, note] = components(JSON_PAGE);
  assert.deepEqual(panel.actions.map((a) => [a.name, a.rule && a.rule.criteria[0].rightValue]), [['Edit', null], ['Clone', '']]);
  assert.deepEqual([note.field, note.rule.criteria[0].operator], ['Note__c', 'NE']);
  const xml = components(fs.readFileSync(path.join(DEF, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml'), 'utf8'));
  assert.deepEqual(xml[0].actions.find((a) => a.name === 'Clone').rule.criteria, panel.actions[1].rule.criteria);
  assert.equal(xml[0].rule, null, 'the actions\' rules are not the panel\'s own');
  assert.deepEqual(rulesFor(xml, xml.find((c) => c.field === 'Note__c')).map((r) => r.by), ['RecordNoteField', 'flexipage_fieldSection']);
});

test('a property that only carries a template region\'s name does not make its component a container', () => {
  const rule = { booleanFilter: null, criteria: [{ leftValue: '{!Record.X__c}', operator: 'EQUAL', rightValue: '1' }] };
  const target = { region: 'sidebar', facet: false, componentName: 'c:target', identifier: 't', props: {}, rule: null };
  const other = { region: 'main', facet: false, componentName: 'c:other', identifier: 'o', props: { decorate: 'sidebar' }, rule };
  assert.deepEqual(rulesFor([target, other], target), []);
  const inTab = { ...target, region: 'Facet-1', facet: true };
  const tab = { region: 'main', facet: false, componentName: 'flexipage:tab', identifier: 'tab', props: { body: 'Facet-1' }, rule };
  assert.deepEqual(rulesFor([inTab, other, tab], inTab).map((r) => r.by), ['tab'], 'a body naming the Facet holds it');
});

test('a component holds a Facet by any property name, not by a list of names', () => {
  const rule = { booleanFilter: null, criteria: [{ leftValue: '{!Record.Status__c}', operator: 'EQUAL', rightValue: 'Open' }] };
  const all = [
    { region: 'main', facet: false, componentName: 'flexipage:accordion', identifier: 'acc', props: { accordionSections: 'Facet-1' }, rule },
    { region: 'Facet-1', facet: true, componentName: 'flexipage:accordionSection', identifier: 'sec', props: { body: 'Facet-2', title: 'S' }, rule: null },
    { region: 'Facet-2', facet: true, componentName: 'c:widget', identifier: 'w', props: {}, rule: null },
  ];
  assert.deepEqual(rulesFor(all, all[2]).map((r) => r.by), ['acc']);
});

test('components marks a Facet region from the XML and from Tooling JSON', () => {
  const xml = components(fs.readFileSync(path.join(DEF, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml'), 'utf8'));
  assert.deepEqual([...new Set(xml.map((c) => `${c.region}:${c.facet}`))].sort(), ['Facet-gate-col1:true', 'Facet-gate-cols:true', 'Facet-gate-tabbodyEq:true', 'Facet-gate-tabbodyNe:true', 'Facet-gate-tabsEq:true', 'Facet-gate-tabsNe:true', 'header:false', 'main:false', 'sidebar:false']);
  const json = components({ flexiPageRegions: [{ name: 'Facet-9', type: 'Facet', itemInstances: [{ componentInstance: { componentName: 'c:x', identifier: 'x' } }] }, { name: 'main', type: 'Region', itemInstances: [{ componentInstance: { componentName: 'c:y', identifier: 'y', componentInstanceProperties: [{ name: 'sections', value: 'Facet-9' }] } }] }] });
  assert.deepEqual(json.map((c) => [c.region, c.facet]), [['Facet-9', true], ['main', false]]);
});

test('a region is named by its own name, not by a property name inside its items', () => {
  const regions = Object.fromEntries(components(fs.readFileSync(path.join(DEF, 'flexipages/SfUi_Gate_Record_Page.flexipage-meta.xml'), 'utf8')).map((c) => [c.identifier, c.region]));
  assert.deepEqual(regions, { force_highlightsPanel: 'header', RecordLevelField: 'Facet-gate-col1', RecordNoteField: 'Facet-gate-col1', flexipage_column1: 'Facet-gate-cols', flexipage_fieldSection: 'main', c_sfUiMore: 'sidebar',
    gateCmpNe: 'sidebar', gateCmpEq: 'sidebar', gateTabsetNe: 'main', gateTabsetEq: 'main', gateTabNe: 'Facet-gate-tabsNe', gateTabEq: 'Facet-gate-tabsEq', gateTabBodyNe: 'Facet-gate-tabbodyNe', gateTabBodyEq: 'Facet-gate-tabbodyEq' });
});

test('a record type spelled with the own namespace matches the one the check names without it', () => {
  const row = { content: 'P', object: 'ns__Foo__c', formFactor: 'Large', profile: 'Admin', recordType: 'ns__Foo__c.ns__Beta' };
  const from = (recordType) => resolvePage({ app: { actionOverrides: [], profileActionOverrides: [row] }, objectOverrides: [] }, { object: 'ns__Foo__c', profile: 'Admin', recordType, namespace: 'ns' }).page;
  assert.equal(from('Beta'), 'P');
  assert.equal(from('ns__Beta'), 'P');
  assert.equal(from('Alpha'), null);
});

test('ownName strips the own namespace prefix in any case', () => {
  assert.equal(ownName('acme', 'ACME__Gadget'), 'Gadget');
  assert.equal(ownName('Acme', 'acme__Gadget'), 'Gadget');
  assert.equal(ownName('ns', 'other__Gadget'), 'other__Gadget', 'another prefix stays');
  assert.equal(ownName(null, 'ns__Gadget'), 'ns__Gadget', 'no namespace, nothing to strip');
});

test('ownName never reduces an object or field name to a bare suffix, in any case', () => {
  const obj = { object: true };
  assert.equal(ownName('Widget', 'Widget__c', obj), 'Widget__c', 'an object named as the namespace');
  assert.equal(ownName('ns', 'ns__c', obj), 'ns__c');
  for (const s of ['c', 'r', 'e', 'mdt', 'x', 'b', 'share', 'history', 'feed', 'kav', 'Share', 'History', 'Feed', 'C', 'Mdt']) assert.equal(ownName('ns', `ns__${s}`, obj), `ns__${s}`, s);
  for (const n of ['Widget__Share', 'Widget__History', 'Widget__C']) assert.equal(ownName('Widget', n, obj), n, n);
  assert.equal(ownName('Widget', 'Widget__Gadget__c', obj), 'Gadget__c', 'a real name is still stripped');
});

test('ownName strips a class, permission or page name that looks like a suffix', () => {
  for (const n of ['History', 'Feed', 'Share', 'X', 'B', 'E', 'C', 'c']) assert.equal(ownName('ns', `ns__${n}`), n, n);
});

test('a row for an object named Share does not answer for Widget__Share', () => {
  const row = { content: 'P', object: 'Share', formFactor: 'Large', profile: null, recordType: null };
  const page = (object) => resolvePage({ app: { actionOverrides: [row], profileActionOverrides: [] }, objectOverrides: [] }, { object, profile: 'Admin', namespace: 'Widget' }).page;
  assert.equal(page('Widget__Share'), null);
  assert.equal(page('Share'), 'P', 'the control: the same row answers for its own name');
});

test('an app row that spells the object without the own namespace matches the check that names it with the prefix', () => {
  const row = { content: 'P', object: 'Foo__c', formFactor: 'Large', profile: null, recordType: null };
  const from = (namespace) => resolvePage({ app: { actionOverrides: [row], profileActionOverrides: [] }, objectOverrides: [] }, { object: 'ns__Foo__c', profile: 'Admin', namespace }).page;
  assert.equal(from('ns'), 'P');
  assert.equal(from(null), null, 'another project\'s object stays another object');
});
