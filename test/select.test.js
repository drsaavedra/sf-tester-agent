'use strict';

// replay --since's selection, offline: which tested routes a diff's files and the catalogue change select.

const test = require('node:test');
const assert = require('node:assert/strict');
const { select, names, smoke, FIXTURE } = require('../src/select');
const real = require('../src/combinations.json');

const entry = (id, container, task, route = []) => ({ id, container, task, route, status: 'tested' });
const NOW = {
  combinations: [
    entry('a@rec', 'record page', 'Choose Large', [{ tool: 'sf_click', args: { lwcApiName: 'sfUiInputs' } }]),
    entry('b@rec', 'record page', 'Run the SfUi_Inputs_Flow action'),
    entry('c@list', 'list view', 'Open the Kanban', [{ tool: 'sf_open_list', args: { objectApiName: 'SfUiProbe__c', listViewApiName: 'Kanban_Probes' } }]),
    entry('d@app', 'app page', 'Set Count__c to 2'),
    { ...entry('e@app', 'app page', 'not yet'), status: 'candidate' },
  ],
  candidates: [],
};
const run = (files, before = NOW, after = NOW) => select(files, before, after);
const by = (out) => Object.fromEntries(out.reasons.map((r) => [r.reason, r.ids]));
const fx = (p) => FIXTURE + p;

test('names reads the component a fixture file defines from its path', () => {
  assert.deepEqual(names(fx('lwc/sfUiInputs/sfUiInputs.js')), ['sfUiInputs']);
  assert.deepEqual(names(fx('flows/SfUi_Inputs_Flow.flow-meta.xml')), ['SfUi_Inputs_Flow']);
  assert.deepEqual(names(fx('objects/SfUiProbe__c/fields/Count__c.field-meta.xml')), ['Count__c', 'SfUiProbe__c']);
  assert.deepEqual(names(fx('objects/SfUiProbe__c/listViews/All.listView-meta.xml')), ['All', 'SfUiProbe__c']);
  assert.deepEqual(names(fx('objects/SfUiProbe__c/SfUiProbe__c.object-meta.xml')), ['SfUiProbe__c']);
  assert.deepEqual(names(fx('quickActions/SfUiProbe__c.Bump.quickAction-meta.xml')), ['SfUiProbe__c.Bump', 'Bump']);
  assert.deepEqual(names(fx('classes/SfUiProbeController.cls')), ['SfUiProbeController']);
  assert.deepEqual(names(fx('package.xml')), ['package'], 'a file with no type folder');
  assert.deepEqual(names(fx('classes/SfUiProbeController.cls-meta.xml')), ['SfUiProbeController']);
});

test('the catalogue rule selects a tested entry that is new or changed, never a removed or unchanged one', () => {
  const before = { combinations: [NOW.combinations[0], { ...NOW.combinations[1], task: 'old' }, entry('gone@x', 'x', 'removed')], candidates: [] };
  const out = run([], before);
  assert.deepEqual(by(out).catalogue, ['b@rec', 'c@list', 'd@app'], 'b changed, c and d new; a same, gone removed, e a candidate');
  assert.deepEqual(run([]).ids, [], 'control: the same catalogue selects nothing');
  const promoted = { combinations: [NOW.combinations[0]], candidates: [{ ...NOW.combinations[1], status: 'candidate' }] };
  assert.deepEqual(by(run([], { ...promoted, combinations: [...promoted.combinations, NOW.combinations[2], NOW.combinations[3]] })).catalogue, ['b@rec'], 'a candidate marked tested is changed');
});

test('a changed persona selects its route: it changes who runs it', () => {
  const as = (profile) => ({ ...NOW, combinations: NOW.combinations.map((e, i) => (i ? e : { ...e, validity: { persona: { profile, permissionSets: [] } } })) });
  assert.deepEqual(run([], as('A'), as('B')).ids, [NOW.combinations[0].id]);
  assert.deepEqual(run([], as('A'), as('A')).ids, [], 'control: the same persona selects nothing');
});

test('a refreshed baseline selects nothing: it changes what a replay reports, not what a route does', () => {
  const baselined = { ...NOW, combinations: NOW.combinations.map((e) => ({ ...e, validity: { formHash: 'x' } })) };
  assert.deepEqual(run([], NOW, baselined).ids, []);
  const again = { ...NOW, combinations: NOW.combinations.map((e) => ({ ...e, validity: { formHash: 'y' } })) };
  assert.deepEqual(run([], baselined, again).ids, []);
  const edited = { ...baselined, combinations: baselined.combinations.map((e, i) => (i ? e : { ...e, task: 'edited' })) };
  assert.deepEqual(run([], baselined, edited).ids, [NOW.combinations[0].id], 'control: an edit beside it still selects');
});

test('a changed placeholder selects the routes whose needs reach it, directly or through a template or with', () => {
  const PH = {
    probeId: { create: { sobject: 'SfUiProbe__c', fields: { Name: '{{probeName}}', Count__c: 1 } } },
    probeName: { value: 'p{{stamp}}', with: ['probeId'] },
    label: { value: 'L {{probeName}}' },
    other: { value: 'o' },
  };
  const cat = (placeholders) => ({ placeholders, candidates: [], combinations: [
    { ...NOW.combinations[0], needs: ['probeId'] }, { ...NOW.combinations[1], needs: ['label'] },
    { ...NOW.combinations[2], needs: ['other'] }, NOW.combinations[3]] });
  const edited = { ...PH, probeId: { create: { ...PH.probeId.create, fields: { Name: '{{probeName}}', Count__c: 2 } } } };
  const out = run(['src/combinations.json'], cat(PH), cat(edited));
  assert.deepEqual(by(out), { catalogue: ['a@rec', 'b@rec'], fixture: [], smoke: [] }, 'b needs label, whose template uses probeName, made with probeId');
  assert.deepEqual(out.reasons[0].from, ['placeholder probeId']);
  assert.deepEqual(run(['src/combinations.json'], cat(PH), cat({ ...PH, other: 'now a description' })).ids, ['c@list']);
  assert.deepEqual(run(['src/combinations.json'], cat(PH), cat(PH)).ids, [], 'control: the same placeholders select nothing');
});

test('an LWC file selects the routes that name its bundle', () => {
  const out = run([fx('lwc/sfUiInputs/sfUiInputs.html'), fx('lwc/sfUiInputs/format.js')]);
  assert.deepEqual(by(out), { catalogue: [], fixture: ['a@rec'], smoke: [] });
  assert.deepEqual(out.reasons[1].from, ['sfUiInputs']);
});

test('a quick action selects the routes that name it unqualified when none names it qualified', () => {
  const ACT = { combinations: [...NOW.combinations, entry('q@rec', 'quick action', 'Run the "Bump Flow" action'), entry('r@rec', 'quick action', 'Run SfUi_Bump_Flow')], candidates: [] };
  assert.deepEqual(run([fx('quickActions/SfUiProbe__c.Bump.quickAction-meta.xml')], ACT, ACT).ids, ['q@rec']);
});

test('a flow selects the routes that name it, and one no route names takes the smoke slice', () => {
  assert.deepEqual(run([fx('flows/SfUi_Inputs_Flow.flow-meta.xml')]).ids, ['b@rec']);
  const none = run([fx('flows/SfUi_Page_Flow.flow-meta.xml')]);
  assert.deepEqual(by(none), { catalogue: [], fixture: [], smoke: ['a@rec', 'c@list', 'd@app'] });
  assert.match(none.reasons[2].from[0], /SfUi_Page_Flow.flow-meta.xml \(no route names SfUi_Page_Flow\)$/);
});

test('a list view selects the routes that name it, else its object; a data-shape child adds the smoke slice', () => {
  const MORE = { combinations: [...NOW.combinations, entry('f@rec', 'record page', 'Open a probe', [{ tool: 'sf_open_list', args: { objectApiName: 'SfUiProbe__c' } }])], candidates: [] };
  const SMOKE = ['a@rec', 'c@list', 'd@app'];
  assert.deepEqual(run([fx('objects/SfUiProbe__c/listViews/Kanban_Probes.listView-meta.xml')], MORE, MORE).ids, ['c@list'], 'the child wins over the object');
  assert.deepEqual(run([fx('objects/SfUiProbe__c/listViews/Other.listView-meta.xml')], MORE, MORE).ids, ['c@list', 'f@rec'], 'no route names it: the object');
  assert.deepEqual(by(run([fx('objects/SfUiDyn__c/fields/Probe__c.field-meta.xml')], MORE, MORE)).fixture, [], 'a whole name only: Probe__c is not SfUiProbe__c');
  assert.deepEqual(by(run([fx('objects/SfUiDyn__c/fields/Count__c.field-meta.xml')])), { catalogue: [], fixture: ['d@app'], smoke: SMOKE }, 'the field, and the smoke slice');
  const DOT = { combinations: [...NOW.combinations, entry('g@rec', 'record page', 'Read the grade', [{ tool: 'sf_api', args: { path: '/ui-api/records/x?fields=SfUiTyped__c.Grade__c' } }]), entry('h@rec', 'record page', 'Open a typed record', [{ tool: 'sf_create_record', args: { objectApiName: 'SfUiTyped__c' } }])], candidates: [] };
  assert.deepEqual(by(run([fx('objects/SfUiTyped__c/fields/Grade__c.field-meta.xml')], DOT, DOT)).fixture, ['g@rec'], 'a field after its object and a dot');
  const done = run([fx('objects/SfUiProbe__c/fields/Done__c.field-meta.xml')]);
  assert.deepEqual(by(done), { catalogue: [], fixture: [], smoke: SMOKE }, 'a field no route names: the smoke slice, not every route on the object');
  assert.match(done.reasons[2].from[0], /Done__c.field-meta.xml \(data shape\)$/);
  for (const f of ['objects/SfUiProbe__c/validationRules/SfUi_Count_Not_Negative.validationRule-meta.xml', 'objects/SfUiTyped__c/recordTypes/Alpha_Type.recordType-meta.xml']) assert.deepEqual(by(run([fx(f)])).smoke, SMOKE, f);
});

// Routes open a tab by the label the requirement quotes, so a tab file selects them by its label, old or new.
test('a tab file selects the routes that open it by its label', () => {
  const tab = fx('tabs/SfUi_Inputs_App.tab-meta.xml');
  const opening = real.combinations.filter((e) => e.status === 'tested' && e.route.some((s) => s.tool === 'sf_open_tab' && s.args.tab === 'SF UI Inputs App')).map((e) => e.id);
  assert.ok(opening.length > 40, `${opening.length} routes open the tab by label`);
  assert.deepEqual(by(select([tab], real, real, { [tab]: ['SF UI Inputs App', 'SF UI Widgets Hub'] })).fixture, opening);
  assert.deepEqual(by(select([tab], real, real)).fixture, [], 'control: with no labels the API name alone reaches none of them');
  // One route opening it by API name does not hide the label routes, and a label in another case still matches.
  const more = { ...real, combinations: [...real.combinations, entry('z@app', 'app page', 'Open it', [{ tool: 'sf_open_tab', args: { tab: 'SfUi_Inputs_App' } }]), entry('y@app', 'app page', 'Open it', [{ tool: 'sf_open_tab', args: { tab: 'sf ui inputs app' } }])] };
  assert.deepEqual(by(select([tab], more, more, { [tab]: ['SF UI Inputs App'] })).fixture, [...opening, 'z@app', 'y@app']);
});

// Every route runs in some app, so an app file takes the smoke slice too, plus each route that opens or names it.
test('an app file selects the routes that open or name it by label, and the smoke slice', () => {
  const app = fx('applications/SfUi_App.app-meta.xml');
  // x@app opens it in another case; w@app types it in another case; v@app clicks a label with a quote, escaped in the route JSON.
  const more = { ...real, combinations: [...real.combinations, { ...entry('x@app', 'app page', 'Open it'), app: 'sf ui app' },
    entry('w@app', 'app page', 'Switch apps', [{ tool: 'sf_fill', args: { label: 'Search apps', value: 'sf ui app' } }]),
    entry('v@app', 'app page', 'Switch apps', [{ tool: 'sf_click', args: { name: 'Say "Hi" App' } }])] };
  const out = by(select([app], more, more, { [app]: ['SF UI App', 'Say "Hi" App'] }));
  assert.deepEqual(out.fixture, ['sf-list-open@split-view', 'utility-panel@utility-bar', 'x@app', 'w@app', 'v@app'], 'the split view route runs in it; the App Launcher route names the label');
  assert.deepEqual(out.smoke, smoke(more.combinations.filter((e) => e.status === 'tested')));
});

test('a permission set or profile takes the smoke slice, even one a route names', () => {
  const NAMED = { combinations: [...NOW.combinations, entry('f@app', 'app page', 'As SfUi_Probe')], candidates: [] };
  const out = run([fx('permissionsets/SfUi_Probe.permissionset-meta.xml')], NAMED, NAMED);
  assert.deepEqual(by(out), { catalogue: [], fixture: [], smoke: ['a@rec', 'c@list', 'd@app'] });
  assert.deepEqual(run([fx('profiles/StandardAul.profile-meta.xml')]).ids, ['a@rec', 'c@list', 'd@app']);
});

test('tool code takes the smoke slice: the first tested route of each container, in catalogue order', () => {
  for (const f of ['src/cli.js', 'package.json', 'package-lock.json', '.github/workflows/validation.yml', 'test/fixture/sfdx-project.json', 'test/fixture/config/project-scratch-def.json']) assert.deepEqual(by(run([f])).smoke, ['a@rec', 'c@list', 'd@app'], f);
  assert.deepEqual(run(['src/combinations.json']).ids, [], 'the catalogue is its own rule');
  const tested = real.combinations.filter((e) => e.status === 'tested');
  const slice = run(['src/replay.js'], real, real).ids;
  assert.equal(slice.length, new Set(tested.map((e) => e.container)).size);
  assert.deepEqual(slice, run(['src/replay.js'], real, real).ids, 'stable');
  assert.equal(slice[0], tested[0].id);
  assert.deepEqual(new Set(slice.map((id) => tested.find((e) => e.id === id).container)).size, slice.length, 'one per container');
});

test('the smoke slice takes a container\'s first route without sideEffects, and a sideEffects one only when it is all there is', () => {
  const SIDE = { combinations: [{ ...entry('m@rec', 'record page', 'mail'), sideEffects: 'sends an email' }, ...NOW.combinations, { ...entry('n@new', 'new page', 'mail'), sideEffects: 'mail' }], candidates: [] };
  assert.deepEqual(by(run(['src/cli.js'], SIDE, SIDE)).smoke, ['a@rec', 'c@list', 'd@app', 'n@new']);
});

// A user's repo: a metadata file under a package directory that no rule maps replays the smoke slice, not nothing.
test('a changed file under a package directory takes the smoke slice; one outside every package selects nothing', () => {
  const pkgs = ['force-app', 'pkgs/core'];
  for (const f of ['force-app/main/default/lwc/myCard/myCard.js', 'pkgs/core/objects/Acct__c/fields/Tier__c.field-meta.xml']) {
    assert.deepEqual(by(select([f], NOW, NOW, {}, pkgs)).smoke, ['a@rec', 'c@list', 'd@app'], f);
  }
  assert.deepEqual(select(['force-apps/x.js', 'pkgs/corex/y.js', 'README.md'], NOW, NOW, {}, pkgs).ids, [], 'a prefix that is not the folder');
  assert.deepEqual(run(['force-app/main/default/lwc/myCard/myCard.js']).ids, [], 'control: no package directories, no rule');
  // A package at the repo's top ('.' or './', which pkgDir makes ''), and one whose case differs from git's.
  for (const d of ['.', '']) assert.deepEqual(by(select(['main/default/lwc/x/x.js'], NOW, NOW, {}, [d])).smoke, ['a@rec', 'c@list', 'd@app'], d);
  assert.deepEqual(by(select(['force-app/x.js'], NOW, NOW, {}, ['Force-App'])).smoke, ['a@rec', 'c@list', 'd@app'], 'case');
});

// The fixture's name rules run under each package's main/default/ too, so a route naming the component is selected;
// a user's named file takes the smoke slice as well, and the same fixture file does not.
test('a user\'s metadata under main/default selects the routes that name it, as a fixture file does, and the smoke slice', () => {
  const pkgs = ['force-app'];
  const user = (p) => by(select([`force-app/main/default/${p}`], NOW, NOW, {}, pkgs));
  for (const p of ['lwc/sfUiInputs/sfUiInputs.html', 'flows/SfUi_Inputs_Flow.flow-meta.xml', 'objects/SfUiProbe__c/listViews/Kanban_Probes.listView-meta.xml', 'tabs/sfUiInputs.tab-meta.xml']) {
    assert.deepEqual(user(p), { ...by(run([fx(p)])), smoke: ['a@rec', 'c@list', 'd@app'] }, p);
    assert.deepEqual(by(run([fx(p)])).smoke, [], `control: the fixture's ${p} takes no smoke`);
  }
  assert.deepEqual(user('lwc/sfUiInputs/sfUiInputs.html').fixture, ['a@rec']);
  assert.deepEqual(by(select(['Force-App/Main/Default/lwc/sfUiInputs/x.js', 'main/default/flows/SfUi_Inputs_Flow.flow-meta.xml'], NOW, NOW, {}, ['force-app', '.'])).fixture, ['a@rec', 'b@rec'], 'case and a top package');
  assert.deepEqual(by(select(['force-app/lwc/sfUiInputs/x.js'], NOW, NOW, {}, pkgs)), { catalogue: [], fixture: [], smoke: ['a@rec', 'c@list', 'd@app'] }, 'outside main/default: the (metadata) catch-all');
});

// A project's sfdx-project.json or .forceignore changes what deploys, a removed package directory included.
test('a changed sfdx-project.json or .forceignore at a project root takes the smoke slice', () => {
  for (const f of ['sfdx-project.json', '.forceignore', 'sub/sfdx-project.json', 'sub/.forceignore']) {
    assert.deepEqual(by(run([f])).smoke, ['a@rec', 'c@list', 'd@app'], f);
  }
  assert.deepEqual(run(['config/project-scratch-def.json', 'sfdx-project.json.bak', 'my.forceignore']).ids, [], 'control: not a project file');
});

test('docs, tests, the bench and the agents select nothing; the union is in catalogue order', () => {
  assert.deepEqual(run(['README.md', 'docs/a.md', 'test/replay.test.js', 'bench/x.js', 'agents/sf-tester.md', '.github/dependabot.yml']).ids, []);
  const before = { combinations: NOW.combinations.filter((e) => e.id !== 'd@app'), candidates: [] };
  assert.deepEqual(run([fx('lwc/sfUiInputs/sfUiInputs.js'), 'README.md'], before).ids, ['a@rec', 'd@app']);
});

test('a metadata type folder in another case takes the same rule as its usual case', () => {
  assert.deepEqual(run([fx('PermissionSets/SfUi_Probe.permissionset-meta.xml')]).ids, ['a@rec', 'c@list', 'd@app'], 'access: the smoke slice');
  assert.deepEqual(names(fx('LWC/sfUiInputs/helper.js')), ['sfUiInputs'], 'an LWC/ file is named by its bundle, not its file');
  assert.deepEqual(by(run([fx('LWC/sfUiInputs/helper.js')])).fixture, ['a@rec'], 'its bundle');
  assert.deepEqual(by(run([fx('Objects/SfUiProbe__c/Fields/Count__c.field-meta.xml')])).smoke, ['a@rec', 'c@list', 'd@app'], 'a field is data shape');
});

test('a .gitkeep in tabs or applications names no route: the smoke slice, not every route', () => {
  for (const f of [fx('tabs/.gitkeep'), fx('applications/.gitkeep')]) {
    const out = by(select([f], real, real));
    assert.deepEqual(out.fixture, [], f);
    assert.deepEqual(out.smoke, smoke(real.combinations.filter((e) => e.status === 'tested')), f);
  }
  assert.deepEqual(names(fx('tabs/.gitkeep')), [], 'an empty name is dropped');
});
