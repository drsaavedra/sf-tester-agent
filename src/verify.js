'use strict';

// verify: a verdict on a metadata change from project checks, no browser, no model. Exit 0 green, 1 red, 2 bad usage; nothing ran is never green, bar --since with no checkable change or only NOT RUN items.
// Without --since, record checks test the org as it is, not the branch; --since puts the changed rules, fields and classes in the validate.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { junit, unxml } = require('./replay');
const { SfUiError } = require('./errors');
const { dateOk, instantOf } = require('./iso');
const { block, components, rulesFor, overrides, resolvePage, ownName } = require('./page');
const rule = require('./rule');
const { scanGates } = require('./gate');
const { cascade, crossCheck, mcdRows, stripCode, rootsOf } = require('./cascade');
const ranlog = require('./cascade-log');

const SUITE = 'sf-tester verify';
const USAGE = 'usage: sf-tester verify --org <alias> --checks <file> [--since <git-ref>] [--only <regex>] [--plan | --matrix] [--cascade] [--junit <out.xml>]';
// The item types a check can cover: rules and fields are tried by saving records, layouts and pages are read.
const SUPPORTED = new Set(['validationRules', 'fields', 'layouts', 'flexipages', 'classes', 'permissionsets', 'lwc', 'customPermissions', 'flows']);
// The types each kind can test: a check covering a type it cannot test would make that change's gap look covered.
const COVERS = { record: ['fields', 'validationRules'], pageRequired: ['layouts', 'flexipages', 'fields', 'permissionsets'], classAccess: ['classes', 'permissionsets', 'lwc'], apex: ['classes'], flow: ['flows', 'classes'], componentVisible: ['flexipages', 'permissionsets'] };
const KINDS_OF = Object.keys(COVERS);
// An act asserts nothing and starts no test: the code writes the asserts from expect.
// Judged on the act with its comments and string literals gone, so a string 'test.key' or a field wrapper.test is fine.
// Any Test method call, in any case: a local named test is refused too, as a regex cannot follow the scope that shadows the class.
// One exception: getStandardPricebookId(), the only way an act reaches the standard price book for a PricebookEntry.
const ACT_BANNED = /\bSystem\s*\.\s*assert|\bAssert\s*\./i;
const ALLOW = String.raw`(?!getStandardPricebookId\s*\()`;
const SYS_TEST = new RegExp(String.raw`\bSystem\s*\.\s*Test\s*\.\s*${ALLOW}\w+\s*\(`, 'i');
const BARE_TEST = new RegExp(String.raw`(?<!\.\s*)\bTest\s*\.\s*${ALLOW}\w+\s*\(`, 'i');
const callsTest = (code) => SYS_TEST.test(code) || BARE_TEST.test(code);

class Usage extends Error {}

// A package path as git prints it: forward slashes, no ./ and no trailing slash, or no changed file would match it.
const pkgDir = (p) => path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/+$/, '');

// One sfdx-project.json's namespace, API version and package directories; bad JSON, or JSON of the wrong shape, is bad usage.
function readProject(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Usage(`${file} is not JSON: ${e.message}`); }
  const dirs = j?.packageDirectories ?? [];
  if (typeof j !== 'object' || j === null || Array.isArray(j) || !Array.isArray(dirs) || dirs.some((d) => typeof d?.path !== 'string')) throw new Usage(`${file} has no valid packageDirectories`);
  return { namespace: j.namespace || null, apiVersion: j.sourceApiVersion, dirs: dirs.map((d) => pkgDir(d.path)) };
}

// The project holding the check file: the nearest folder at or above it with an sfdx-project.json.
function loadProject(checkFile) {
  for (let dir = path.dirname(path.resolve(checkFile)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'sfdx-project.json');
    if (fs.existsSync(file)) return { root: dir, ...readProject(file) };
    if (dir === path.dirname(dir)) throw new Usage(`no sfdx-project.json at or above ${checkFile}`);
  }
}

// A changed file's item key: its path inside its package directory, less main/default/ (or <folder>/main/default/) and the -meta.xml suffix.
// main/default is matched in lower case only, as rootsOf joins it: a Main/Default folder is no root on Linux CI.
// ponytail: a folder of metadata with no main/default above it, deeper than the package directory itself, is no item; a file outside one is none.
function itemOf(file, proj) {
  const dir = proj.dirs.find((d) => file.startsWith(`${d}/`));
  if (!dir) return null;
  const rel = file.slice(dir.length + 1).replace(/^([^/]+\/)?main\/default\//, '');
  // A class's source and its meta file are one item, and a file in an LWC bundle is the bundle.
  let key = rel.replace(/\.[^./]+-meta\.xml$/, '').replace(/^(classes\/.+)\.cls$/, '$1');
  if (key.startsWith('lwc/')) key = key.split('/').slice(0, 2).join('/');
  // A loose file under lwc/ (jsconfig.json) is not a bundle.
  if (key.startsWith('lwc/') && rel.split('/').length < 3) return { key, file, type: 'lwcFile', rel };
  return { key, file, type: keyType(key), rel };
}
// An item key's type: its first folder, or a rule or field under objects/.
// Two names are one with the project namespace stripped and the case ignored; a missing name matches nothing.
const sameName = (ns, a, b, o) => ownName(ns, a ?? '', o).toLowerCase() === ownName(ns, b ?? '', o).toLowerCase();
const keyType = (key) => { const [type, , sub] = key.split('/'); return type === 'objects' ? (sub === 'validationRules' || sub === 'fields' ? sub : 'objects') : type; };

// A whole number past 2^53 is rounded by JSON.parse before Apex sees it.
const unsafeInt = (v) => (typeof v === 'number' ? Number.isInteger(v) && !Number.isSafeInteger(v) : v && typeof v === 'object' && Object.values(v).some(unsafeInt));
const FIELD = /^[A-Za-z_]\w*$/;
// The class name a classes/ cover key ends in; a trailing slash leaves it empty, which FIELD rejects.
const classOf = (k) => k.slice(k.lastIndexOf('/') + 1);
// A date or datetime must be on the calendar, and a whole number a safe integer, or it is rounded before Apex sees it.
const valueOk = (v) => v === null || ['boolean', 'string'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)))
  || (v && typeof v === 'object' && Object.keys(v).length === 1 && (dateOk(v.date) || !Number.isNaN(instantOf(v.datetime))));

// What the apex and flow kinds share in a case: a name and an expect object, names that differ, a throws that is text, input of plain values.
// A flow's keys are variable or field names, so its caller passes keyOk (FIELD); an apex input's keys are free.
const caseShape = (cases, min, what) => {
  if (!Array.isArray(cases) || cases.length < min || cases.some((k) => !k || typeof k.name !== 'string' || !k.name || !k.expect || typeof k.expect !== 'object')) return what;
  return new Set(cases.map((k) => k.name)).size !== cases.length ? 'two cases have the same name' : null;
};
const badThrows = (k) => 'throws' in k.expect && (typeof k.expect.throws !== 'string' || !k.expect.throws);
// Nested lists and objects are left out of input: a date, a datetime or a plain value only.
const plainOf = (o, keyOk = () => true) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.entries(o).every(([n, v]) => keyOk(n) && valueOk(v));

// The check file's problems, each naming its check. A record check needs a saving and a failing case, so each one
// carries its own control arm.
function badChecks(file, proj = null) {
  const bad = [];
  if (!file || !Array.isArray(file.checks)) return ['the check file must hold { "checks": [...] }'];
  const seen = new Set();
  file.checks.forEach((c, i) => {
    const fail = (why) => bad.push(`${typeof c?.id === 'string' && c.id ? c.id : `check #${i}`}: ${why}`);
    if (!c || typeof c !== 'object') return fail('not an object');
    if (typeof c.id !== 'string' || !c.id) return fail('no id');
    // A result id is check/case or check/item, and a generated check is id/classAccess: a slash in either part could collide.
    if (c.id.includes('/')) return fail('an id cannot hold a slash, which is reserved for generated and result ids');
    // The rows verify adds of its own, a carried test's and the cascade's, take these ids.
    if (['carried', 'cascade'].includes(c.id)) return fail(`the id ${c.id} is reserved for verify's own rows`);
    const slash = Array.isArray(c.cases) && c.cases.find((k) => typeof k?.name === 'string' && k.name.includes('/'));
    if (slash) return fail(`case "${slash.name}": a case name cannot hold a slash`);
    if (seen.has(c.id)) return fail('duplicate id');
    seen.add(c.id);
    if (!KINDS_OF.includes(c.kind)) return fail(`unknown kind ${JSON.stringify(c.kind)}`);
    if (!c.persona || typeof c.persona.profile !== 'string' || !c.persona.profile) return fail('no persona.profile');
    const sets = c.persona.permissionSets ?? [];
    if (!Array.isArray(sets) || sets.some((p) => typeof p !== 'string' || !p)) return fail('persona.permissionSets must be a list of names');
    // A classAccess or apex check names no object; a flow check names one only when a case uses record, checked in its own branch.
    if (c.kind !== 'classAccess' && c.kind !== 'apex' && c.kind !== 'flow' && (typeof c.object !== 'string' || !FIELD.test(c.object))) return fail('no object');
    if (!Array.isArray(c.covers) || !c.covers.length || c.covers.some((x) => typeof x !== 'string')) return fail('no covers');
    // The class name reaches a RegExp and a file lookup.
    const odd = c.covers.find((k) => k.startsWith('classes/') && !FIELD.test(classOf(k)));
    if (odd) return fail(`${odd}: a class in covers must end in a plain API name`);
    const off = c.covers.filter((k) => !COVERS[c.kind].includes(keyType(k)));
    if (off.length) return fail(`a ${c.kind} check cannot cover ${off.join(', ')}; it covers ${COVERS[c.kind].join(', ')}`);
    if (c.kind === 'classAccess') {
      if (c.class != null && (typeof c.class !== 'string' || !FIELD.test(c.class))) return fail('class must be a plain API name');
      if (typeof c.expect?.access !== 'boolean') return fail('expect.access must be true or false');
      // Shape only: without a class, the classes come from a covered bundle, which the branch may have changed since.
      if (c.class == null && !c.covers.some((k) => k.startsWith('lwc/'))) return fail('no class, and covers names no lwc bundle');
      return;
    }
    if (c.kind === 'apex') {
      if (typeof c.act !== 'string' || !c.act.trim()) return fail('no act');
      const code = stripCode(c.act);
      if (ACT_BANNED.test(code)) return fail('act must not assert or call Test: the asserts come from expect');
      if (callsTest(code)) return fail('act must not assert or call Test: the asserts come from expect; a call on a local named test counts too, as verify cannot tell it from the Test class: rename the local');
      if (!/\breturn\b[^;]*;\s*$/.test(code)) return fail('act must end in a return statement');
      const shape = caseShape(c.cases, 1, 'each case needs a name and expect');
      if (shape) return fail(shape);
      for (const k of c.cases) {
        const keys = Object.keys(k.expect);
        if (keys.length !== 1 || !['returns', 'throws'].includes(keys[0])) return fail(`case "${k.name}": expect needs exactly one of returns or throws`);
        if (keys[0] === 'returns' && unsafeInt(k.expect.returns)) return fail(`case "${k.name}": expect.returns holds an integer past the safe range`);
        if (badThrows(k)) return fail(`case "${k.name}": expect.throws must be non-empty text`);
        if (k.input != null && !plainOf(k.input)) return fail(`case "${k.name}": input must be an object of plain values`);
      }
      // Each check carries its own control arm: a case that returns and a case that throws.
      if (!c.cases.some((k) => 'returns' in k.expect) || !c.cases.some((k) => 'throws' in k.expect)) return fail('needs a case that returns and a case that throws');
      return;
    }
    if (c.kind === 'flow') {
      if (typeof c.flow !== 'string' || !FIELD.test(c.flow)) return fail('flow must be a plain API name');
      if (c.flow.includes('__')) return fail('flow must be the API name without a namespace: the project sets it');
      // Matched to what the check runs: a check that names a flow but does not cover it would leave that flow's change UNCOVERED.
      if (!c.covers.includes(`flows/${c.flow}`)) return fail(`covers must include flows/${c.flow}`);
      // A flow verify hands off (a screen flow) runs no case, so its check needs none, left out or []; cases it gives are still checked.
      if ((c.cases == null || (Array.isArray(c.cases) && !c.cases.length)) && proj && ((x) => x != null && flowPlan(x).hand)(branchFile(proj, `flows/${c.flow}.flow-meta.xml`))) return;
      const shape = caseShape(c.cases, 2, 'needs two or more cases, each with a name and expect');
      if (shape) return fail(shape);
      // Unlike apex, a flow's input keys are variable or field names, and __ is the generator's.
      const plain = (o) => plainOf(o, (n) => FIELD.test(n) && !n.startsWith('__'));
      const named = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length && Object.keys(o).every((n) => FIELD.test(n) && !n.startsWith('__'));
      for (const k of c.cases) {
        const keys = Object.keys(k.expect);
        // returns names what is read back: an output variable of an autolaunched flow, a field of the record a record-triggered flow saves. record names fields of the record the case gave the flow.
        if (!keys.length || keys.some((x) => !['returns', 'record', 'throws'].includes(x)) || (keys.includes('throws') && keys.length > 1)) return fail(`case "${k.name}": expect needs returns and/or record, or throws alone`);
        if ('returns' in k.expect && !named(k.expect.returns)) return fail(`case "${k.name}": expect.returns must be an object of output variable or field names to values`);
        if ('record' in k.expect && !named(k.expect.record)) return fail(`case "${k.name}": expect.record must be an object of field names to values`);
        if (unsafeInt(k.expect.returns) || unsafeInt(k.expect.record)) return fail(`case "${k.name}": expect holds an integer past the safe range`);
        if (badThrows(k)) return fail(`case "${k.name}": expect.throws must be non-empty text`);
        // Input is the flow's input variables, or the fields the record is saved with; __ is the generator's.
        if (k.input != null && !plain(k.input)) return fail(`case "${k.name}": input must be an object of plain values under plain names, none starting with __`);
        // record: a record made in system mode before the flow starts, its id passed as the input recordId; the check's object says which.
        if (k.record != null && !plain(k.record)) return fail(`case "${k.name}": record must be an object of plain field values`);
        if ((k.record != null || 'record' in k.expect) && (k.record == null || typeof c.object !== 'string' || !FIELD.test(c.object))) return fail(`case "${k.name}": record and expect.record go together, and the check names the object`);
      }
      // A record-triggered flow makes its own record from input, so a case cannot hand it one; with the project, that shows at load time and in --plan.
      const xml = proj && c.cases.some((k) => k.record != null) ? branchFile(proj, `flows/${c.flow}.flow-meta.xml`) : null;
      if (xml != null && flowPlan(xml).shape === 'record') return fail(`flows/${c.flow} saves its own record: give input and expect.returns, not record`);
      // The control arm: cases that expect different things, one a throws or a non-null value. It cannot tell a flow that never fires from an echoed input or a field default.
      const sorted = (x) => JSON.stringify(x, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
      if (new Set(c.cases.map((k) => sorted(k.expect))).size < 2) return fail('needs cases that expect different things');
      if (!c.cases.some((k) => 'throws' in k.expect || [k.expect.returns, k.expect.record].some((o) => o && Object.values(o).some((v) => v !== null)))) return fail('needs a case that expects a throws or a value that is not null, or a flow that never fires passes every case');
      return;
    }
    if (c.kind === 'componentVisible') {
      if (typeof c.flexiPage !== 'string' || !FIELD.test(c.flexiPage)) return fail('flexiPage must be a plain API name');
      // The target is a component, one of a component's dynamic actions, or a field placed on the page.
      // The app decides the persona's record page, which must be the named flexiPage, so it is required.
      if (typeof c.app !== 'string' || !FIELD.test(c.app)) return fail('app must be a plain API name');
      if (c.recordType != null && (typeof c.recordType !== 'string' || !FIELD.test(c.recordType))) return fail('recordType must be a plain API name');
      if (c.field != null) {
        if (typeof c.field !== 'string' || !FIELD.test(c.field)) return fail('field must be a plain API name');
        if (c.component != null || c.action != null) return fail('a field check names no component or action');
      } else {
        if (typeof c.component !== 'string' || !c.component) return fail('no component: name its componentName or identifier');
        if (c.action != null && (typeof c.action !== 'string' || !c.action)) return fail('action must be an action name');
      }
      // Text for the NEEDS BROWSER line: the check's, or a case's own.
      if (c.handoff != null && (typeof c.handoff !== 'string' || !c.handoff)) return fail('handoff must be text naming the route or test that owns it');
      const ks = c.cases;
      if (!Array.isArray(ks) || ks.some((k) => !k || typeof k.name !== 'string' || !k.name || typeof k.expect?.visible !== 'boolean')) return fail('each case needs a name and expect.visible');
      if (new Set(ks.map((k) => k.name)).size !== ks.length) return fail('two cases have the same name');
      if (ks.some((k) => k.handoff != null && (typeof k.handoff !== 'string' || !k.handoff))) return fail('a case handoff must be text naming the route or test that owns it');
      // Each check carries its own control arm: a case where the component shows and one where it does not.
      if (!ks.some((k) => k.expect.visible) || !ks.some((k) => !k.expect.visible)) return fail('needs a case where it shows and a case where it does not');
      if (ks.some((k) => ['record', 'user', 'customPermissions', 'standardPermissions'].some((f) => k[f] != null && (typeof k[f] !== 'object' || Array.isArray(k[f]))))) return fail('record, user, customPermissions and standardPermissions must be objects');
      return;
    }
    // recordType and flexiPage reach a file path and SOQL, so they are plain API names.
    for (const k of ['recordType', 'flexiPage']) if (c[k] != null && (typeof c[k] !== 'string' || !FIELD.test(c[k]))) return fail(`${k} must be a plain API name`);
    if (c.kind === 'pageRequired') {
      // The field reaches a file path and SOQL, so it is a plain API name like recordType and flexiPage.
      if (typeof c.field !== 'string' || !FIELD.test(c.field)) return fail('field must be a plain API name');
      if (typeof c.expect?.required !== 'boolean') return fail('expect.required must be true or false');
      return;
    }
    const cases = c.cases;
    if (!Array.isArray(cases) || cases.some((k) => !k || typeof k.name !== 'string' || !k.fields || typeof k.fields !== 'object' || typeof k.expect?.saves !== 'boolean')) return fail('each case needs a name, fields and expect.saves');
    if (new Set(cases.map((k) => k.name)).size !== cases.length) return fail('two cases have the same name');
    if (!cases.some((k) => k.expect.saves) || !cases.some((k) => !k.expect.saves)) return fail('needs a case that saves and a case that does not');
    for (const k of cases) {
      for (const [f, v] of Object.entries(k.fields)) if (!FIELD.test(f) || !valueOk(v)) return fail(`case "${k.name}": bad field ${f}`);
      // Any rejection would pass otherwise, and a required-field error can mask a weakened rule.
      if (k.expect.error != null && typeof k.expect.error !== 'string') return fail(`case "${k.name}": expect.error must be a string`);
      if (!k.expect.saves && !k.expect.error) return fail(`case "${k.name}": a case that does not save needs expect.error`);
    }
  });
  return bad;
}

// What the diff changed: item keys of the supported types, the rest by type, and the files behind each key.
function changes(files, proj, covers = new Set()) {
  const items = new Map();
  const other = new Set();
  for (const f of files) {
    const it = itemOf(f, proj);
    if (!it) continue;
    // A file the diff deletes is gone from the branch, whatever the org still holds.
    it.deleted = !fs.existsSync(path.join(proj.root, f));
    if (SUPPORTED.has(it.type)) items.set(it.key, [...(items.get(it.key) || []), it]); else other.add(it.key);
  }
  // A gone bundle or class is an item only if a check covers it.
  for (const [key, v] of items) {
    // A custom permission is an item only where a check's gate scan reaches it.
    if (key.startsWith('customPermissions/') && !covers.has(key)) { items.delete(key); other.add(key); continue; }
    if (!key.startsWith('lwc/') && !key.startsWith('classes/')) continue;
    // Gone: a bundle no package directory holds with a .js, .ts or .html file, a class with no .cls of its name anywhere (a move into a subfolder is not a deletion).
    const gone = key.startsWith('lwc/') ? !liveBundle(proj, key) : !classFile(proj, classOf(key), '.cls');
    for (const x of v) x.deleted = gone;
    // Only an item no check covers is demoted: a live bundle with no Apex call or a live class with no @AuraEnabled would go UNCOVERED.
    const unchecked = key.startsWith('lwc/') ? !apexImports(proj, key).length : !auraMethod(branchFile(proj, `${key}.cls`) ?? '');
    if (!covers.has(key) && (gone || unchecked)) { items.delete(key); other.add(key); }
  }
  // A component moved between package directories has one path deleted and one added: gone only if every path is.
  const gone = new Set([...items].filter(([, v]) => v.every((x) => x.deleted)).map(([k]) => k));
  return { items, other: [...other], gone };
}

// The cover keys a check reads: a field only where pageRequired names it, a permission set only where the persona holds it.
// A classAccess that names its class reads that class, and a bundle whose Apex imports are all that class.
const reads = (c, k, proj) => {
  const same = (a, b, o) => sameName(proj.namespace, a, b, o);
  const [, obj, , fld] = k.split('/');
  const type = keyType(k);
  if (type === 'fields' && c.kind === 'pageRequired') return same(obj, c.object, { object: true }) && same(fld, c.field, { object: true });
  // A member of a group the persona names counts too: personaGrants reads its branch file.
  if (type === 'permissionsets') return [...c.persona.permissionSets, ...(c.members ?? [])].some((n) => same(obj, n));
  // A page check reads its own FlexiPage only, and a pageRequired check with one reads no layout.
  if (type === 'flexipages') return c.flexiPage != null && same(obj, c.flexiPage);
  if (type === 'layouts' && c.kind === 'pageRequired') return c.flexiPage == null;
  if (c.kind === 'classAccess' && c.class != null && k.startsWith('classes/')) return same(classOf(k), c.class);
  // A classless one reads the classes its covered bundles import.
  if (c.kind === 'classAccess' && k.startsWith('classes/')) return c.covers.some((b) => b.startsWith('lwc/') && apexImports(proj, b).some((x) => same(x, classOf(k))));
  // A deleted bundle has no imports left to match, so it stays covered and fails as deleted.
  if (c.kind === 'classAccess' && c.class != null && k.startsWith('lwc/')) { const n = apexImports(proj, k); return !liveBundle(proj, k) || (n.length > 0 && n.every((x) => same(x, c.class))); }
  return true;
};

// An @AuraEnabled method: the annotation, other annotations, then declaration words up to static; comments go in one pass. A property is not one.
// ponytail: a string holding /* or // is read as a comment start.
const auraMethod = (src) => /@AuraEnabled(\s*\([^)]*\))?(\s*@\w+(\s*\([^)]*\))?)*[^;{(@]*\bstatic\b/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));

// The bundle folder holding code (.js, .ts or .html) in the first package directory that has one: a leftover code-less folder in an earlier one is skipped.
const liveBundle = (proj, key) => {
  for (const d of proj.dirs) {
    const dir = resolveCI({ ...proj, dirs: [d] }, key);
    if (dir && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).some((f) => /\.(js|ts|html)$/.test(f))) return dir;
  }
  return null;
};

// The Apex classes an LWC bundle imports on the branch: Class.method is Class, ns.Class.method is ns__Class.
// Read once per bundle per project load: a run asks many times and its files do not change.
const importsSeen = new WeakMap();
function apexImports(proj, bundle) {
  const seen = importsSeen.get(proj) ?? importsSeen.set(proj, new Map()).get(proj);
  if (!seen.has(bundle)) seen.set(bundle, readImports(proj, bundle));
  return seen.get(bundle);
}
function readImports(proj, bundle) {
  const dir = liveBundle(proj, bundle);
  if (!dir) return [];
  // A line comment is skipped; a block comment is not.
  const code = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const found = fs.readdirSync(dir).filter((f) => /\.[jt]s$/.test(f)).flatMap((f) => [...code(f).matchAll(/@salesforce\/apex(?:Continuation)?\/([\w.]+)\.\w+['"]/g)].map((m) => m[1].replace('.', '__')));
  return [...new Set(found)];
}

// ponytail: the diff is the committed range plus uncommitted edits to tracked files; an untracked new file is not in it.
function changedFiles(ref, root, git) {
  const diff = (...rest) => git(['-C', root, 'diff', '--name-only', '--no-renames', '--relative', ...rest]).split('\n').filter(Boolean);
  return [...new Set([...diff(`${ref}...HEAD`), ...diff('HEAD')])];
}

// Passed, failed, errored: one word per result, the line a reader scans.
const fmt = (r) => [r.status === 'handoff' ? 'NEEDS BROWSER' : r.status.toUpperCase(), r.check, r.name, r.error, r.detail && `(${r.detail})`, r.status !== 'pass' && r.requirement && `(requirement: ${r.requirement})`].filter(Boolean).join(' ');

// Apex string literal: backslash, single quote and newlines escaped.
const aq = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
const apexValue = (v) => {
  if (v === null) return 'null';
  // put() takes an Integer for an Integer field and refuses a Decimal there (measured), so an integer stays one.
  // The real int32 range, -2^31 included: its Long form is refused for an Integer field. The minimum goes through valueOf, as -2147483648 alone parses as a Long.
  if (typeof v === 'number') return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? (v === -2147483648 ? `Integer.valueOf('${v}')` : String(v)) : Number.isSafeInteger(v) ? `${v}L` : `Decimal.valueOf(${aq(v)})`;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return aq(v);
  if (v.date) return `Date.valueOf(${aq(v.date)})`;
  return `(Datetime) JSON.deserialize(${aq(`"${v.datetime}"`)}, Datetime.class)`;
};

// What verify can do with a flow, read from the branch's file: an Apex-started autolaunched flow, a record-triggered flow fired by an insert, or a hand-off with its reason.
function flowPlan(xml) {
  const one = (src, tag) => block(src, tag)[0]?.trim() || undefined;
  const type = one(xml, 'processType');
  const start = block(xml, 'start')[0] ?? '';
  const trigger = one(start, 'triggerType');
  const when = one(start, 'recordTriggerType');
  const object = one(start, 'object');
  const status = one(xml, 'status');
  if (type === 'Flow') return { status, hand: 'a screen flow: Flow.Interview.start() refuses it ("Start can\'t be called on a flow with the process type Screen Flow."), so the browser layer owns it' };
  // An asynchronous or scheduled path, or a Pause, runs after the act's transaction, and badChecks refuses an act that calls Test.stopTest() to flush it, in any case and through a local named test.
  const later = /<scheduledPaths>/.test(xml) ? 'an asynchronous or scheduled path' : /<waits>/.test(xml) ? 'a Wait element' : null;
  // carry: its immediate path still runs on the insert a record check makes, so the validate must hold it though no flow check runs it.
  const carry = ['RecordBeforeSave', 'RecordAfterSave'].includes(trigger) && ['Create', 'CreateAndUpdate'].includes(when);
  if (later) return { status, carry, hand: `a flow with ${later}: its work runs after the transaction that verify's cases end in, so the browser layer or a flow test owns it` };
  if (type === 'AutoLaunchedFlow' && !trigger) return { status, shape: 'auto' };
  const record = ['RecordBeforeSave', 'RecordAfterSave'].includes(trigger) && object;
  // The object goes into generated Apex and SOQL, so it is a plain API name like the check's own object.
  if (record && !FIELD.test(object)) return { status, error: `the flow's trigger object ${JSON.stringify(object)} is not a plain API name, so verify cannot put it in generated Apex` };
  if (record && ['Create', 'CreateAndUpdate'].includes(when)) return { status, shape: 'record', object };
  if (record) return { status, hand: `a record-triggered flow on ${when ?? 'an unknown event'} only: verify saves a new record, which does not fire it` };
  const kind = [type, trigger].filter(Boolean).join(' ');
  return { status, hand: `${kind ? `a ${kind} flow` : 'a flow with no process type and no trigger'}: verify runs autolaunched and record-triggered flows only` };
}

// A flow check as the apex check that runs it, or why it cannot run. The act is generated; the asserts still come from expect.
// Measured on a scratch org (finding-2026-11-10-flow-probe): Apex runs a flow with system access, so the persona limits the DML, not the flow;
// and a validate tests a changed flow only when the branch says Active.
function flowCheck(c, proj, items) {
  const xml = branchFile(proj, `flows/${c.flow}.flow-meta.xml`);
  if (xml == null) return { status: 'error', error: `no flows/${c.flow}.flow-meta.xml in the project, so verify cannot tell what kind of flow it is` };
  const p = flowPlan(xml);
  if (p.error) return { status: 'error', error: p.error };
  if (p.hand) return { status: 'handoff', error: p.hand };
  if (items.has(`flows/${c.flow}`) && p.status !== 'Active') return { status: 'error', error: `flows/${c.flow} is ${p.status ?? 'unmarked'} on the branch, so this check is stale: a validate tests an Active flow only, and the persona would run the org's version. Update or remove the check if the branch turns the flow off on purpose` };
  const reads = 'String.valueOf(input.get(\'__reads\'))';
  // A managed flow is found by the namespace overload, createInterview(namespace, name, inputs): the project's namespace, as a flow's API name holds no __.
  const ns = proj.namespace;
  const bare = c.flow;
  const act = p.shape === 'auto'
    ? ["Map<String,Object> ins = new Map<String,Object>();", "for (String k : input.keySet()) { if (!k.startsWith('__')) ins.put(k, input.get(k)); }",
      'SObject rec = null;',
      // The record is set up in system mode, as the persona is not what is being checked there; its id is the flow's recordId.
      "if (input.get('__object') != null) { rec = Schema.getGlobalDescribe().get((String) input.get('__object')).newSObject(); for (String k : input.keySet()) { if (k.startsWith('__f.')) rec.put(k.substring(4), input.get(k)); } insert as system rec; ins.put('recordId', rec.Id); }",
      `Flow.Interview i = Flow.Interview.createInterview(${ns ? `${aq(ns)}, ` : ''}${aq(bare)}, ins);`, 'i.start();', 'Map<String,Object> got = new Map<String,Object>();',
      `for (String o : ${reads}.split(',')) { if (o != '') got.put(o, i.getVariableValue(o)); }`,
      "String rf = String.valueOf(input.get('__rf'));",
      "if (rec != null && rf != '') { Id rid = rec.Id; SObject back = Database.query('SELECT ' + rf + ' FROM ' + input.get('__object') + ' WHERE Id = :rid', AccessLevel.SYSTEM_MODE); for (String o : rf.split(',')) got.put('record.' + o, back.get(o)); }",
      'return got;'].join('\n')
    : [`SObject r = Schema.getGlobalDescribe().get('${p.object}').newSObject();`, "for (String k : input.keySet()) { if (!k.startsWith('__')) r.put(k, input.get(k)); }",
      'insert r;', 'Id rid = r.Id;', 'Map<String,Object> got = new Map<String,Object>();', `String q = ${reads};`,
      `if (q != '') { SObject back = Database.query('SELECT ' + q + ' FROM ${p.object} WHERE Id = :rid', AccessLevel.SYSTEM_MODE); for (String o : q.split(',')) got.put(o, back.get(o)); }`, 'return got;'].join('\n');
  // The act reads what each case names back into one map, and expect.returns of the apex check is that map.
  const cases = c.cases.map((k) => {
    const rec = k.record == null ? {} : { __object: c.object, ...Object.fromEntries(Object.entries(k.record).map(([f, v]) => [`__f.${f}`, v])), __rf: Object.keys(k.expect.record ?? {}).join(',') };
    const want = { ...k.expect.returns, ...Object.fromEntries(Object.entries(k.expect.record ?? {}).map(([f, v]) => [`record.${f}`, v])) };
    return { name: k.name, input: { ...k.input, __reads: Object.keys(k.expect.returns ?? {}).join(','), ...rec }, expect: 'throws' in k.expect ? k.expect : { returns: want } };
  });
  return { apex: { ...c, kind: 'apex', act, cases }, note: p.shape === 'auto' ? 'the flow ran with system access, not the persona\'s' : null };
}

// The one test class a run deploys: a method per case, each building its persona and saving as it, or calling the act, under runAs.
// A permission set name is a PermissionSet first, else a PermissionSetGroup; a name found in neither fails, named.
function generate(checks, namespace = null) {
  const methods = new Map();
  const body = [];
  const spans = [];
  checks.forEach((c, i) => c.cases.forEach((k, j) => {
    const m = `c${i}_${j}`;
    methods.set(m, { check: c.id, name: k.name });
    if (c.kind === 'apex') {
      // The act is code, inserted as written; the asserts are the generator's, from expect.
      if (j === 0) {
        // Where the act sits in the body, in lines before it: the range is fixed here, not searched for later.
        spans.push({ check: c.id, before: body.length ? body.join('\n').split('\n').length : 0, size: c.act.split('\n').length + 2 });
        body.push(`    static Object act_c${i}(Map<String,Object> input) {\n${c.act}\n    }`);
      }
      const input = Object.entries(k.input || {}).map(([f, v]) => `${aq(f)} => ${apexValue(v)}`).join(', ');
      // Contains, not equals, for a throw: platform messages carry prefixes.
      const want = 'returns' in k.expect
        ? ["        System.assert(threw == null, 'expected a return, but it threw ' + threw);",
          '        Object have;',
          "        try { have = JSON.deserializeUntyped(JSON.serialize(got)); } catch (Exception ex) { System.assert(false, 'returned a value JSON cannot serialize: ' + ex.getMessage()); }",
          `        Object want = JSON.deserializeUntyped(${aq(JSON.stringify(k.expect.returns))});`,
          "        if (!same(have, want)) System.assert(false, 'expected ' + JSON.serialize(want) + ', got ' + JSON.serialize(have));"].join('\n')
        : [`        if (threw == null) System.assert(false, 'expected a throw, but it returned ' + String.valueOf(got));`,
          `        if (!threw.contains(${aq(k.expect.throws)})) System.assert(false, 'expected an error containing ' + ${aq(k.expect.throws)} + ', got: ' + threw);`].join('\n');
      body.push(`    @IsTest static void ${m}() {
        User u = persona(${aq(c.persona.profile)}, new List<String>{${c.persona.permissionSets.map(aq).join(', ')}});
        Map<String,Object> input = new Map<String,Object>{${input}};
        Object got;
        String threw = null;
        System.runAs(u) {
            try { got = act_c${i}(input); } catch (Exception e) { threw = e.getTypeName() + ': ' + e.getMessage(); }
        }
${want}
    }`);
      return;
    }
    const puts = Object.entries(k.fields).map(([f, v]) => `        rec.put(${aq(f)}, ${apexValue(v)});`);
    const want = k.expect.saves
      ? "        System.assert(res.isSuccess(), 'expected a save, got: ' + msgs);"
      : ["        System.assert(!res.isSuccess(), 'expected a rejection, but it saved');",
        `        Boolean hit = false;\n        for (Database.Error e : res.getErrors()) { if (e.getMessage().equals(${aq(k.expect.error)})) hit = true; }`,
        `        System.assert(hit, 'expected the error ' + ${aq(k.expect.error)} + ', got: ' + msgs);`].join('\n');
    body.push(`    @IsTest static void ${m}() {
        User u = persona(${aq(c.persona.profile)}, new List<String>{${c.persona.permissionSets.map(aq).join(', ')}});
        Schema.SObjectType t = Schema.getGlobalDescribe().get(${aq(c.object)});
        System.assertNotEquals(null, t, 'SETUP: object not found: ' + ${aq(c.object)});
        SObject rec = t.newSObject();
${puts.join('\n')}
        Database.SaveResult res;
        // USER_MODE stays explicit, so the check holds whatever API version the class deploys at.
        System.runAs(u) { res = Database.insert(rec, false, AccessLevel.USER_MODE); }
        String msgs = '';
        for (Database.Error e : res.getErrors()) { msgs += e.getMessage() + ' | '; }
${want}
    }`);
  }));
  // Compares an untyped tree by value: numbers as Decimals, maps by key set, lists in order, the rest by equals.
  const same = checks.some((c) => c.kind === 'apex') ? `    static Decimal dec(Object n) { return n instanceof Double ? Decimal.valueOf((Double) n) : Decimal.valueOf(String.valueOf(n)); }
    static Boolean isNum(Object n) { return n instanceof Integer || n instanceof Long || n instanceof Decimal || n instanceof Double; }
    static Boolean same(Object a, Object b) {
        if (a == null || b == null) return a == b;
        if (isNum(a) && isNum(b)) return dec(a) - dec(b) == 0;
        if (a instanceof Map<String,Object> && b instanceof Map<String,Object>) {
            Map<String,Object> x = (Map<String,Object>) a;
            Map<String,Object> y = (Map<String,Object>) b;
            if (!x.keySet().equals(y.keySet())) return false;
            for (String k : x.keySet()) { if (!same(x.get(k), y.get(k))) return false; }
            return true;
        }
        if (a instanceof List<Object> && b instanceof List<Object>) {
            List<Object> x = (List<Object>) a;
            List<Object> y = (List<Object>) b;
            if (x.size() != y.size()) return false;
            for (Integer i = 0; i < x.size(); i++) { if (!same(x[i], y[i])) return false; }
            return true;
        }
        return a.equals(b);
    }
` : '';
  const head = `@IsTest
private class SfTesterVerifyTest {
    static User persona(String profileName, List<String> names) {
        String projNs = ${namespace ? aq(namespace) : 'null'};
        List<Profile> profiles = [SELECT Id FROM Profile WHERE Name = :profileName WITH SYSTEM_MODE];
        System.assertEquals(1, profiles.size(), 'SETUP: profile not found: ' + profileName);
        String un = 'vp' + Crypto.getRandomInteger() + '@verify.probe';
        User usr = new User(ProfileId = profiles[0].Id, Username = un, Email = un, LastName = 'Probe', Alias = 'vprobe',
            TimeZoneSidKey = 'GMT', LocaleSidKey = 'en_US', EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US');
        // Setup runs in system mode: from API 67.0 the default would need the deploying user's setup permissions.
        System.runAs(new User(Id = UserInfo.getUserId())) {
            try { insert as system usr; } catch (DmlException e) { System.assert(false, 'SETUP: ' + e.getMessage()); }
            List<PermissionSetAssignment> a = new List<PermissionSetAssignment>();
            for (String full : names) {
                String ns = null;
                String nm = full;
                Integer i = full.indexOf('__');
                if (i > 0) { ns = full.substring(0, i); nm = full.substring(i + 2); }
                String nsFilter = ns != null ? ' AND NamespacePrefix = :ns' : projNs == null ? ' AND NamespacePrefix = null' : ' AND (NamespacePrefix = null OR NamespacePrefix = :projNs)';
                List<PermissionSet> sets = Database.query('SELECT Id FROM PermissionSet WHERE Name = :nm' + nsFilter + ' AND IsOwnedByProfile = false ORDER BY NamespacePrefix NULLS FIRST LIMIT 1', AccessLevel.SYSTEM_MODE);
                if (!sets.isEmpty()) { a.add(new PermissionSetAssignment(AssigneeId = usr.Id, PermissionSetId = sets[0].Id)); continue; }
                List<PermissionSetGroup> groups = Database.query('SELECT Id FROM PermissionSetGroup WHERE DeveloperName = :nm' + nsFilter + ' ORDER BY NamespacePrefix NULLS FIRST LIMIT 1', AccessLevel.SYSTEM_MODE);
                // An unprefixed name stays exact; a managed set or group of that name is only named back, once.
                // A muting set is never a persona's set: say so rather than not found.
                if (groups.isEmpty()) System.assert([SELECT Id FROM MutingPermissionSet WHERE DeveloperName = :nm WITH SYSTEM_MODE LIMIT 1].isEmpty(), 'SETUP: permission set or group not found: ' + full + '; it is a muting set, name its group');
                if (ns == null && groups.isEmpty()) {
                    Set<String> named = new Set<String>();
                    for (PermissionSet m : [SELECT NamespacePrefix FROM PermissionSet WHERE Name = :nm AND NamespacePrefix != null AND IsOwnedByProfile = false WITH SYSTEM_MODE]) named.add(m.NamespacePrefix + '__' + nm);
                    for (PermissionSetGroup m : [SELECT NamespacePrefix FROM PermissionSetGroup WHERE DeveloperName = :nm AND NamespacePrefix != null WITH SYSTEM_MODE]) named.add(m.NamespacePrefix + '__' + nm);
                    System.assert(named.isEmpty(), 'SETUP: permission set or group not found: ' + full + '; did you mean ' + String.join(new List<String>(named), ' or ') + '?');
                }
                System.assert(!groups.isEmpty(), 'SETUP: permission set or group not found: ' + full);
                a.add(new PermissionSetAssignment(AssigneeId = usr.Id, PermissionSetGroupId = groups[0].Id));
            }
            try { insert as system a; } catch (DmlException e) { System.assert(false, 'SETUP: ' + e.getMessage()); }
        }
        return usr;
    }
${same}`;
  const apex = `${head}${body.join('\n')}\n}\n`;
  // Each act's line range in the class, so a compile error maps back to its check.
  const base = head.split('\n').length - 1;
  const acts = spans.map((x) => ({ check: x.check, from: base + x.before + 1, to: base + x.before + x.size }));
  return { apex, methods, acts };
}

// The payload: its own sfdx project holding the generated class and every changed rule, field and class, so
// the validate tests the branch, not the org.
function payload(dir, proj, apex, files) {
  const base = path.join(dir, 'force-app', 'main', 'default');
  fs.mkdirSync(path.join(base, 'classes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: proj.apiVersion }));
  fs.writeFileSync(path.join(base, 'classes', 'SfTesterVerifyTest.cls'), apex);
  fs.writeFileSync(path.join(base, 'classes', 'SfTesterVerifyTest.cls-meta.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>${proj.apiVersion}</apiVersion><status>Active</status></ApexClass>\n`);
  for (const f of files) {
    const from = path.join(proj.root, f.file);
    const to = path.join(base, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

// The CLI can print an update warning before the JSON.
const parse = (out) => JSON.parse(out.slice(out.indexOf('{')));
const list = (x) => [].concat(x || []);
// The signal stops the validate on Ctrl-C, so the temp folder's finally still runs.
// ponytail: the org's check-only deploy keeps running after the local sf dies; cancelling needs --async and a job id.
const execSf = (args, { cwd, signal }) => new Promise((resolve, reject) => {
  execFile('sf', args, { cwd, signal, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e && !out ? reject(e) : resolve(out)));
});

// A stop or a bug in this code keeps its own message, also as the cause of a cancelled validate's: only the org or the CLI failing is "did not answer".
const bug = (e) => e instanceof TypeError || e instanceof ReferenceError;
const noAnswer = (e, signal, label = 'validate did not answer') => (signal?.aborted || bug(e) || bug(e?.cause) ? e : new Error(`${label}: ${String(e.message).slice(0, 300)}`));
// The sf route: a check-only validate of the payload folder, then its report. Its test level and time limit are
// ranlog.VALIDATE, the ones ranlog.validate sends over SOAP for --cascade.
async function sfReport(sf, { org, dir, signal, tests }) {
  let env;
  try { env = parse(await sf(['project', 'deploy', 'validate', '--source-dir', 'force-app', '--test-level', ranlog.VALIDATE.testLevel, ...tests.flatMap((n) => ['--tests', n]), '-o', org, '--wait', String(ranlog.VALIDATE.minutes), '--json'], { cwd: dir, signal })); } catch (e) { throw noAnswer(e, signal); }
  const id = env.result?.id || env.data?.deployId;
  if (!id) throw new Error(`${env.name || 'validate'}: ${env.message}`);
  try { return { ...parse(await sf(['project', 'deploy', 'report', '--job-id', id, '-o', org, '--json'], { cwd: dir, signal })).result, id }; } catch (e) { throw noAnswer(e, signal, `report ${id} did not answer`); }
}

// The --cascade route: the payload converted to metadata format and sent as one check-only validate over SOAP,
// whose answer carries the tests' debug log. A failed convert is the payload's fault, never the org's.
async function soapReport(sf, { s, dir, signal, tests, cas }) {
  let out;
  try { out = parse(await sf(['project', 'convert', 'source', '--source-dir', 'force-app', '--output-dir', 'mdapi', '--json'], { cwd: dir, signal })); } catch (e) { throw signal?.aborted ? e : new Error(`convert failed: ${String(e.message).slice(0, 300)}`); }
  if (out.status !== 0) throw new Error(`convert failed: ${`${out.name || ''} ${out.message || ''}`.trim()}`);
  const md = path.join(dir, 'mdapi');
  const files = Object.fromEntries(walk(md).map((f) => [f.split(path.sep).join('/'), fs.readFileSync(path.join(md, f))]));
  try { return await ranlog.validate({ s, files, tests, signal, post: cas.post, sleep: cas.sleep }); } catch (e) { throw noAnswer(e, signal); }
}

// Each method's verdict from a check-only validate's report, or from the error that stopped it: { methodName: { status, error } }.
function validate(methods, { rep, err, acts = [] }) {
  const all = (error) => new Map([...methods.keys()].map((m) => [m, { status: 'error', error }]));
  if (err) return all(err);
  const id = rep.id;
  const broken = list(rep?.details?.componentFailures);
  if (broken.length) {
    const text = (b) => `${b.fullName || b.fileName || b.componentType}: ${b.problem ?? ''}`;
    // The line of a compile error, from the failure or the (line:col) the problem ends in.
    const lineOf = (b) => Number(b.lineNumber ?? String(b.problem).match(/\((\d+):\d+\)\s*$/)?.[1]);
    const mapped = broken.flatMap((b) => { const a = (/^(\w+__)?SfTesterVerifyTest$/.test(b.fullName ?? '') || /(^|[\\/])SfTesterVerifyTest\.cls$/.test(b.fileName ?? '')) && acts.find((x) => lineOf(b) >= x.from && lineOf(b) <= x.to); return a ? [[a.check, text(b)]] : []; });
    // Every failure must map; two in one act join under that check.
    if (!mapped.length || mapped.length < broken.length) return all(broken.map(text).join('; '));
    const culprit = new Map();
    for (const [check, msg] of mapped) culprit.set(check, culprit.has(check) ? `${culprit.get(check)}; ${msg}` : msg);
    return new Map([...methods].map(([m, { check }]) => [m, { status: 'error', error: culprit.get(check) ?? `the generated class did not compile because of check ${[...culprit.keys()].join(', ')}` }]));
  }
  const ran = rep?.details?.runTestResult;
  if (!ran) return all(`validate ${id} ended ${rep?.status} with no test result`);
  // A failure row is the generated class's by its name, or by one of its methods when the row has no name; any other is a carried test's.
  const ours = (x) => (x.name ? /^(\w+__)?SfTesterVerifyTest$/.test(x.name) : methods.has(x.methodName));
  const carried = list(ran.failures).filter((x) => !ours(x));
  const warns = list(ran.codeCoverageWarnings).map((w) => w.message);
  // A deploy that failed with no test failing (a coverage failure) is no verdict, whatever its methods did.
  if (rep.status !== 'Succeeded' && !list(ran.failures).length) return all(`validate ${id} ended ${rep.status}${warns.length ? `: ${warns.join('; ')}` : ''}`);
  const out = new Map();
  for (const m of methods.keys()) {
    // Only a row of ours: a carried RepoTest.c0_0 is never our c0_0.
    const ok = list(ran.successes).find((x) => ours(x) && x.methodName === m);
    const bad = list(ran.failures).find((x) => ours(x) && x.methodName === m);
    // A SETUP: failure is the persona or object not being buildable, not the requirement failing.
    const why = bad && String(bad.message ?? '').replace(/^System\.AssertException: Assertion Failed: /, '');
    out.set(m, bad ? { status: why.startsWith('SETUP: ') ? 'error' : 'fail', error: why } : ok ? { status: 'pass' } : { status: 'error', error: `no result for ${m} in ${id}` });
  }
  // Each carried failure is a row of its own beside the case rows, so it is never silent; a Failed validate's coverage warnings too.
  out.extra = [...carried.map((x) => ({ name: [x.name ?? 'a test with no name', x.methodName].filter(Boolean).join('.'), error: `carried test failed: ${x.message}` })),
    ...(rep.status !== 'Succeeded' && warns.length ? [{ name: 'coverage', error: `validate ${id} ended ${rep.status}: ${warns.join('; ')}` }] : [])];
  return out;
}

// The org's own clock for a validate, from the deploy result: queue wait, deploy and test run. Null with a date missing.
function deployTimes(rep) {
  const [made, began, ended] = ['createdDate', 'startDate', 'completedDate'].map((k) => Date.parse(rep?.[k]));
  if ([made, began, ended].some(Number.isNaN)) return null;
  const tests = Number(rep.details?.runTestResult?.totalTime) || 0;
  return { queue: began - made, deploy: Math.max(0, ended - began - tests), tests };
}
const timeLine = (t, total) => `time: ${[...['connect', 'diff', 'generate', 'validate', 'report'].filter((k) => t[k] != null)
  .map((k) => `${k} ${t[k]} ms${k === 'validate' && t.queue != null ? ` (queue ${t.queue} ms, deploy ${t.deploy} ms, tests ${t.tests} ms)` : ''}`), `total ${total} ms`].join(', ')}`;

// Every selected record and apex check's cases in one validate: one deploy, one report.
async function runRecords(checks, { s, proj, sf, org, items, files = [], signal, cascade: cas, time = {} }) {
  // A flow check becomes an apex check, or a result of its own when verify cannot run that flow.
  const early = [];
  const notes = new Map();
  const run = checks.flatMap((c) => {
    // A record check only inserts, so a rule whose formula reads ISNEW, ISCHANGED or PRIORVALUE is tried on one branch only: an update would try the other.
    const upd = c.kind === 'record' && c.covers.filter((k) => keyType(k) === 'validationRules').map((k) => /\b(ISNEW|ISCHANGED|PRIORVALUE)\s*\(/i.exec(block(branchFile(proj, `${k}.validationRule-meta.xml`) ?? '', 'errorConditionFormula').join('\n'))?.[1]).find(Boolean);
    if (upd) notes.set(c.id, `insert only: the rule reads ${upd.toUpperCase()}, which an update would exercise and this check does not`);
    if (c.kind !== 'flow') return [c];
    const p = flowCheck(c, proj, items);
    if (!p.apex) { early.push({ check: c.id, name: c.flow, status: p.status, error: p.error }); return []; }
    if (p.note) notes.set(c.id, p.note);
    return [p.apex];
  });
  if (!run.length) return early;
  const t0 = performance.now();
  const { apex, methods, acts } = generate(run, proj.namespace);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-verify-'));
  try {
    // Every changed rule and field goes in, covered or not, and so does a flow verify can run or one that fires on create; layouts, pages and other flows could fail the validate.
    // The org's latest API version: from 67.0 Apex runs in user context, so runAs enforces the persona's CRUD and FLS.
    const apiVersion = s.orgApiVersion;
    // Every changed class goes in with the branch's tests that name one, so the repo's own tests supply the coverage.
    const carry = carriedClasses(proj, files);
    const classes = [...carry.live, ...carry.tests].flatMap((n) => ['.cls', '.cls-meta.xml']
      .map((ext) => [classFile(proj, n, ext), ext]).filter(([f]) => f).map(([f, ext]) => ({ file: path.relative(proj.root, f), rel: `classes/${n}${ext}` })));
    payload(dir, { ...proj, apiVersion }, apex, [...[...items.values()].flat().filter((x) => !x.deleted && (['fields', 'validationRules'].includes(x.type) || (x.type === 'flows' && ((p) => p.shape || p.carry)(flowPlan(fs.readFileSync(path.join(proj.root, x.file), 'utf8')))))), ...classes]);
    const tests = ['SfTesterVerifyTest', ...carry.tests];
    const report = cas ? () => soapReport(sf, { s, dir, signal, tests, cas }) : () => sfReport(sf, { org, dir, signal, tests });
    let rep;
    let err;
    const t1 = performance.now();
    time.generate = Math.round(t1 - t0); // the run's times, which its last-but-one line prints
    try { rep = await report(); } catch (e) { err = e.message; }
    time.validate = Math.round(performance.now() - t1);
    Object.assign(time, deployTimes(rep));
    const got = validate(methods, { rep, err, acts });
    const text = rep?.debugLog;
    const seen = text ? ranlog.parseLog(text, 'SfTesterVerifyTest') : null;
    // Tests ran per the report itself: a SETUP failure or a coverage failure ran them, yet every verdict is an error.
    // A log naming no case is no log, unless tests ran and it was cut: then the carried tests may have filled it.
    const ranTests = Number(rep?.details?.runTestResult?.numTestsRun) > 0;
    const logged = !!seen && (Object.keys(seen.tests).length > 0 || (seen.truncated && ranTests));
    const noLog = cas && !logged && ranTests;
    const rows = [...methods].map(([m, { check, name }]) => {
      const t = seen?.tests[`SfTesterVerifyTest.${m}`];
      return { check, name, ...got.get(m), ...(notes.has(check) && ['pass', 'fail'].includes(got.get(m).status) && { detail: notes.get(check) }), ...(t ? { t, cascade: ranlog.line(t) } : logged ? { logCut: seen.truncated, cascade: `NO LOG for this method${seen.truncated ? `: the log was cut before it${carry.tests.length ? ` (the carried tests ${carry.tests.join(', ')} share its 1 MiB)` : ''}` : ''}` } : {}) };
    });
    // aside: a row of the cascade itself, not a case of any check.
    if (noLog) rows.push({ check: 'cascade', name: 'run', status: 'error', error: 'the validate ran the tests and returned no debug log of them', aside: true });
    for (const x of got.extra ?? []) rows.push({ check: 'carried', ...x, status: 'error', aside: true });
    return [...early, ...rows];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Fields and how each is held, from the XML a branch holds. Small regexes over the blocks, no XML dependency.
const layoutXml = (xml) => Object.fromEntries(block(xml, 'layoutItems').flatMap((b) => { const f = b.match(/<field>([^<]*)<\/field>/); return f ? [[unxml(f[1]), b.match(/<behavior>(\w+)<\/behavior>/)?.[1] ?? 'Edit']] : []; }));
const pageXml = (xml) => Object.fromEntries(block(xml, 'itemInstances').flatMap((b) => { const f = b.match(/<fieldItem>Record\.([^<]+)<\/fieldItem>/); return f ? [[unxml(f[1]), b.match(/<name>uiBehavior<\/name>\s*<value>(\w+)<\/value>/)?.[1] ?? 'none']] : []; }));
// The same two maps from the org's Tooling JSON.
const layoutJson = (md) => Object.fromEntries(md.layoutSections.flatMap((x) => x.layoutColumns.flatMap((c) => c.layoutItems || [])).filter((i) => i.field).map((i) => [i.field, i.behavior ?? 'Edit']));
const pageJson = (md) => Object.fromEntries(md.flexiPageRegions.flatMap((r) => r.itemInstances || []).filter((i) => i.fieldInstance)
  .map((i) => [i.fieldInstance.fieldItem.replace(/^Record\./, ''), (i.fieldInstance.fieldInstanceProperties || []).find((p) => p.name === 'uiBehavior')?.value ?? 'none']));

// The one path resolver for the branch: a path inside a package directory, under main/default or not, matched in any case
// at every segment (macOS and Linux CI differ). An exact name wins over a differently cased one. With all, every layout
// that holds it comes back as an array, not just the first.
function resolveCI(proj, rel, all = false) {
  const hits = [];
  for (const d of proj.dirs) for (const pre of rootsOf(proj, d)) {
    let at = path.join(proj.root, pre);
    for (const seg of rel.split('/')) {
      const names = fs.existsSync(at) && fs.statSync(at).isDirectory() ? fs.readdirSync(at) : [];
      const hit = names.find((n) => n === seg) ?? names.find((n) => n.toLowerCase() === seg.toLowerCase());
      at = hit ? path.join(at, hit) : null;
      if (!at) break;
    }
    if (at) { if (!all) return at; hits.push(at); }
  }
  return all ? hits : null;
}
const branchFile = (proj, rel) => { const f = resolveCI(proj, rel); return f ? fs.readFileSync(f, 'utf8') : null; };
const branchField = (proj, object, field) => branchFile(proj, `objects/${object}/fields/${field}.field-meta.xml`);
// Every file under a folder, as paths relative to it.
const walk = (base, rel = '') => fs.readdirSync(path.join(base, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(base, path.join(rel, e.name)) : [path.join(rel, e.name)]));
// A class file by name anywhere under a package's classes folder: the exact name wins over a differently cased one.
const classFile = (proj, name, ext) => {
  for (const d of proj.dirs) for (const pre of rootsOf(proj, d)) {
    const base = path.join(proj.root, pre, 'classes');
    const all = fs.existsSync(base) ? walk(base).map((f) => [f, path.basename(f)]) : [];
    const hit = all.find(([, b]) => b === `${name}${ext}`) ?? all.find(([, b]) => b.toLowerCase() === `${name}${ext}`.toLowerCase());
    if (hit) return path.join(base, hit[0]);
  }
  return null;
};
const branchDir = (proj, rel) => resolveCI(proj, rel) !== null;
// The branch's changed classes, and the @IsTest classes whose source names one.
// ponytail: reads every class on the branch per run; index the names once if a repo's classes folder gets slow.
function carriedClasses(proj, files) {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  // A class the branch deletes is not carried, and pulls in no test.
  const live = [...new Set(files.map((f) => itemOf(f, proj)).filter((x) => x?.type === 'classes').map((x) => classOf(x.key)))].filter((n) => classFile(proj, n, '.cls'));
  const names = new Set(proj.dirs.flatMap((d) => rootsOf(proj, d).flatMap((pre) => { const base = path.join(proj.root, pre, 'classes'); return fs.existsSync(base) ? walk(base).filter((f) => f.endsWith('.cls')).map((f) => path.basename(f, '.cls')) : []; })));
  const tests = [...names].filter((n) => {
    const src = strip(fs.readFileSync(classFile(proj, n, '.cls'), 'utf8'));
    return /@IsTest\b/i.test(src) && live.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(src));
  }).sort();
  return { live, tests };
}
// A field file that makes the field required: required true, or a master-detail, as the org's describe says.
const REQUIRED_FILE = /<required>true<\/required>|<type>MasterDetail<\/type>/;
// ns__Name as [ns, Name], or [null, Name]. nsAnd filters on a prefix and on nothing without one; nsRule is the rule for a name without one.
const splitNs = (full) => { const i = full.indexOf('__'); return i > 0 ? [full.slice(0, i), full.slice(i + 2)] : [null, full]; };
const nsAnd = (col, ns) => (ns ? ` AND ${col} = '${sq(ns)}'` : '');
// No prefix in the name means no prefix, or the project's own when it has one: an unrelated managed pkg__Foo never answers for Foo.
const nsRule = (col, ns, proj) => (ns ? nsAnd(col, ns) : proj.namespace ? ` AND (${col} = null OR ${col} = '${sq(proj.namespace)}')` : ` AND ${col} = null`);
// A branch file by its full name, else, in the project's own namespace, by the name without its ns__ prefix; rel builds the path from a name.
const ownFile = (proj, rel, full, opt) => {
  const own = ownName(proj.namespace, full, opt);
  return branchFile(proj, rel(full)) ?? (own !== full ? branchFile(proj, rel(own)) : null);
};
// The check's FlexiPage: the branch file (its own prefix dropped), else the org's Metadata by DeveloperName and prefix.
async function flexiPageOf(c, proj, q) {
  const xml = ownFile(proj, (n) => `flexipages/${n}.flexipage-meta.xml`, c.flexiPage);
  if (xml) return { xml, md: null };
  const [ns, name] = splitNs(c.flexiPage);
  return { xml: null, md: (await q(`SELECT Metadata FROM FlexiPage WHERE DeveloperName = '${sq(name)}'${nsRule('NamespacePrefix', ns, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0]?.Metadata };
}
// The path of an object's file from its name, for ownFile.
const objectFile = (n) => `objects/${n}/${n}.object-meta.xml`;
const setFile = (n) => `permissionsets/${n}.permissionset-meta.xml`;
const muteFile = (n) => `mutingpermissionsets/${n}.mutingpermissionset-meta.xml`;
const groupFile = (n) => `permissionsetgroups/${n}.permissionsetgroup-meta.xml`;
// A group component's PermissionSet as ns__Name, or Name.
const memberName = (ps) => (ps.NamespacePrefix ? `${ps.NamespacePrefix}__${ps.Name}` : ps.Name);
const sq = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const inList = (xs) => xs.map((x) => `'${sq(x)}'`).join(',');
// A permission set by name under nsRule's name rule, the unprefixed one first; a muting set is never one.
const setQuery = (full, proj) => { const [p, n] = splitNs(full); return `SELECT Id, Type FROM PermissionSet WHERE Name = '${sq(n)}'${nsRule('NamespacePrefix', p, proj)} AND IsOwnedByProfile = false ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`; };

// An unprefixed name stays exact; a managed set or group of that name is only named back, never taken.
async function didYouMean(rest, name) {
  const [sets, groups] = await Promise.all([
    rest(`SELECT NamespacePrefix FROM PermissionSet WHERE Name = '${sq(name)}' AND NamespacePrefix != null AND IsOwnedByProfile = false`),
    rest(`SELECT NamespacePrefix FROM PermissionSetGroup WHERE DeveloperName = '${sq(name)}' AND NamespacePrefix != null`)]);
  const names = [...new Set([...sets, ...groups].map((r) => `${r.NamespacePrefix}__${name}`))];
  return names.length ? `; did you mean ${names.join(' or ')}?` : '';
}

// A SOQL query as the admin, its rows.
const queryOf = (s, api) => async (soql) => (await api.call(s, `/query?q=${encodeURIComponent(soql)}`, { as: 'admin' })).records;
// The same for the Tooling API.
const toolingOf = (s, api) => async (soql) => (await api.call(s, `/tooling/query?q=${encodeURIComponent(soql)}`, { as: 'admin' })).records;

// c.members: the sets in the groups c's persona names, asked only for a set key no persona name matches.
// A name with a branch set file is a set. Names only: a group file's from the file, the org's in one component query.
async function groupMembers(checks, proj, rest) {
  const want = checks.filter((c) => c.covers.some((k) => keyType(k) === 'permissionsets' && !c.persona.permissionSets.some((n) => sameName(proj.namespace, k.split('/')[1], n))));
  const names = (c) => c.persona.permissionSets.filter((n) => !ownFile(proj, setFile, n));
  const rows = await componentRows([...new Set(want.flatMap(names).filter((n) => ownFile(proj, groupFile, n) == null))], proj, rest);
  for (const c of want) {
    c.members = names(c).flatMap((n) => {
      const xml = ownFile(proj, groupFile, n);
      return xml != null ? block(xml, 'permissionSets').map((x) => unxml(x.trim())) : rows.get(n.toLowerCase()).filter((r) => !r.PermissionSetId.startsWith('0QM')).map((r) => memberName(r.PermissionSet));
    });
  }
}

// Each group name's PermissionSetGroupComponent rows, under nsRule's name rule with the unprefixed group first: one query for
// every name not yet asked this run, shared by coverage and readGroup; a failed query is not kept.
const rowsSeen = new WeakMap();
async function componentRows(names, proj, rest) {
  const seen = rowsSeen.get(proj) ?? rowsSeen.set(proj, new Map()).get(proj);
  const lc = (v) => String(v ?? '').toLowerCase();
  const ask = names.filter((n) => !seen.has(lc(n)));
  if (ask.length) {
    const all = rest(`SELECT PermissionSetGroup.DeveloperName, PermissionSetGroup.NamespacePrefix, PermissionSetId, PermissionSet.Name, PermissionSet.NamespacePrefix FROM PermissionSetGroupComponent WHERE PermissionSetGroup.DeveloperName IN (${[...new Set(ask.map((n) => `'${sq(splitNs(n)[1])}'`))].join(',')})`);
    for (const full of ask) {
      const [p, n] = splitNs(full);
      const mine = (rows) => rows.filter((r) => lc(r.PermissionSetGroup?.DeveloperName) === lc(n) && (p ? lc(r.PermissionSetGroup.NamespacePrefix) === lc(p) : !r.PermissionSetGroup.NamespacePrefix || lc(r.PermissionSetGroup.NamespacePrefix) === lc(proj.namespace)));
      const one = (rows) => { const ns = rows.some((r) => !r.PermissionSetGroup.NamespacePrefix) ? '' : lc(rows[0]?.PermissionSetGroup.NamespacePrefix); return rows.filter((r) => lc(r.PermissionSetGroup.NamespacePrefix) === ns); };
      seen.set(lc(full), all.then((rows) => one(mine(rows))).catch((e) => { seen.delete(lc(full)); throw e; }));
    }
  }
  return new Map(await Promise.all(names.map(async (n) => [lc(n), await seen.get(lc(n))])));
}

// A group's members and muting sets, each { name, id, xml }: from the branch's group file, else the org's components, else null.
// One read per group and run, shared by coverage and personaGrants, under nsRule's name rule with the unprefixed group first.
const groupsSeen = new WeakMap();
function groupOf(full, proj, rest) {
  const seen = groupsSeen.get(proj) ?? groupsSeen.set(proj, new Map()).get(proj);
  const key = full.toLowerCase();
  if (!seen.has(key)) seen.set(key, readGroup(full, proj, rest).catch((e) => { seen.delete(key); throw e; }));
  return seen.get(key);
}
async function readGroup(full, proj, rest) {
  const xml = ownFile(proj, groupFile, full);
  if (xml != null) {
    // A name the group file lists is read from its branch file, else found in the org by name; one in neither has no id.
    const one = async (n, file, soql) => {
      const f = ownFile(proj, file, n);
      return f != null ? { name: n, id: null, xml: f } : { name: n, id: (await rest(soql(n)))[0]?.Id ?? null, xml: null };
    };
    const names = (tag) => block(xml, tag).map((n) => unxml(n.trim()));
    return { file: true,
      members: await Promise.all(names('permissionSets').map((n) => one(n, setFile, (m) => setQuery(m, proj)))),
      mutes: await Promise.all(names('mutingPermissionSets').map((n) => one(n, muteFile, (m) => `SELECT Id FROM MutingPermissionSet WHERE DeveloperName = '${sq(m)}' LIMIT 1`))) };
  }
  const rows = (await componentRows([full], proj, rest)).get(full.toLowerCase());
  if (!rows.length) return null;
  // A muting component's id is its MutingPermissionSet's (0QM) and its PermissionSet is null, measured 2026-11-12.
  const muteIds = rows.map((r) => r.PermissionSetId).filter((x) => x.startsWith('0QM'));
  const mutes = muteIds.length ? (await rest(`SELECT Id, DeveloperName FROM MutingPermissionSet WHERE Id IN (${inList(muteIds)})`)).map((m) => ({ name: m.DeveloperName, id: m.Id, xml: ownFile(proj, muteFile, m.DeveloperName) })) : [];
  return { file: false, mutes, members: rows.filter((r) => !muteIds.includes(r.PermissionSetId)).map((r) => ({ name: memberName(r.PermissionSet), id: r.PermissionSetId, xml: ownFile(proj, setFile, memberName(r.PermissionSet)) })) };
}

// What a grants hook gave as a list of reasons: false, true, a reason text, or a list of them.
const why = (v) => [].concat(v || []).filter(Boolean);
// A group's grant from its members, less what its muting sets mute, reason by reason: a muted class grant leaves Author Apex.
// Each member or muting set is read from its branch file, else from the org by id; orgGrants is told when the ids are muting sets.
async function groupGrant(members, mutes, fileGrants, orgGrants) {
  const of = async (xs, muting) => {
    const org = xs.filter((r) => !r.xml).map((r) => r.id);
    return [...xs.filter((r) => r.xml).flatMap((r) => why(fileGrants(r.xml, muting)).map((w) => [w, r.name])), ...(org.length ? why(await orgGrants(org, muting)).map((w) => [w, null]) : [])];
  };
  const muted = (await of(mutes, true)).map(([w]) => w);
  const left = (await of(members, false)).find(([w]) => !muted.includes(w));
  return left && { why: left[0], file: left[1] };
}

// Whether the persona holds a grant, and from where: a branch set file decides for itself, else the org's profile, set and group grants.
// fileGrants(xml, muting) reads a branch file, orgGrants(ids, muting) asks the org; muting is true for a group's muting sets.
async function personaGrants(c, { rest, proj, fileGrants, orgGrants }) {
  const ids = [];
  const orgSets = [];
  let allData = false;
  // A grant is kept, not returned, until every name resolves: a misspelt set must not pass behind it.
  let granted = null;
  // The profile first: a misspelt one must not pass behind a branch set's grant.
  const profileSets = await rest(`SELECT Id, PermissionsViewAllData, PermissionsModifyAllData FROM PermissionSet WHERE Profile.Name = '${sq(c.persona.profile)}'`);
  ids.push(...profileSets.map((r) => r.Id));
  allData = profileSets.some((r) => r.PermissionsViewAllData || r.PermissionsModifyAllData);
  if (!ids.length) throw new Error(`no profile ${c.persona.profile} in the org`);
  for (const full of c.persona.permissionSets) {
    const [p, name] = splitNs(full);
    // The unprefixed file stands for ns__Name only in the project's own namespace, not for an unrelated local set.
    const xml = ownFile(proj, setFile, full);
    if (xml) {
      // The branch's set decides for itself: a grant it drops is dropped, whatever the org's copy says. A string grant names its reason.
      const g = why(fileGrants(xml))[0];
      if (g) granted ??= { ok: true, from: `branch permission set ${full}${g === true ? '' : `, ${g}`}` };
      continue;
    }
    orgSets.push([full, p, name]);
  }
  for (const [full, p, name] of orgSets) {
    // A group file on the branch decides the group's members and muting; else the org's own set of Type Group says it is one.
    const filed = ownFile(proj, groupFile, full) != null;
    const set = filed ? [] : await rest(setQuery(full, proj));
    if (filed || set[0]?.Type === 'Group') {
      const parts = await groupOf(full, proj, rest);
      // An org group with no branch file in it: its own set holds the org's grants less its muting.
      if (!filed && !(parts && [...parts.members, ...parts.mutes].some((r) => r.xml))) { ids.push(set[0].Id); continue; }
      const lost = [...parts.members, ...parts.mutes].find((r) => !r.xml && !r.id);
      if (lost) throw new Error(`group ${full} on the branch holds ${lost.name}, which is neither on the branch nor in the org`);
      const g = await groupGrant(parts.members, parts.mutes, fileGrants, orgGrants);
      if (g) granted ??= { ok: true, from: `${g.file ? `branch permission set ${g.file} in group` : filed ? 'org member of branch group' : 'org group'} ${full}${g.why === true ? '' : `, ${g.why}`}` };
      continue;
    }
    if (set.length) { ids.push(set[0].Id); continue; }
    // Every org group has its own set of Type Group (measured 2026-11-12), so a name with no set is neither.
    // A muting set is never a persona's set: say so, else name managed sets back for an unprefixed name.
    const hint = await rest(`SELECT Id FROM MutingPermissionSet WHERE DeveloperName = '${sq(name)}' LIMIT 1`)
      .then((m) => (m.length ? '; it is a muting set, name its group' : p ? '' : didYouMean(rest, name)))
      .catch((e) => `; the hint lookup failed: ${e.message}`);
    throw new Error(`permission set or group not found: ${full}${hint}`);
  }
  if (granted) return granted;
  // first: only the first reason is read here, so a hook may skip asking for the others.
  const g = why(await orgGrants(ids, false, true))[0];
  return { ok: Boolean(g), from: g && g !== true ? `org, ${g}` : 'org', allData };
}

// Whether the persona can read the field, and which source said so. ponytail: record type visibility is not read.
async function canRead(c, { s, api, proj, names }) {
  const rest = queryOf(s, api);
  const own = (full) => ownName(proj.namespace, full, { object: true }).toLowerCase();
  const want = `${own(c.object)}.${own(c.field)}`;
  return personaGrants(c, {
    rest, proj,
    // A muting set's editable mutes Edit only: only its readable takes Read away.
    fileGrants: (xml, muting) => block(xml, 'fieldPermissions').some((b) => unxml(b.match(/<field>([^<]*)<\/field>/)?.[1] ?? '').split('.').map(own).join('.') === want && (muting ? /<readable>true</ : /<(readable|editable)>true</).test(b)),
    orgGrants: async (ids) => (await rest(`SELECT Id FROM FieldPermissions WHERE SobjectType = '${sq(names.object)}' AND Field = '${sq(`${names.object}.${names.field}`)}' AND PermissionsRead = true AND ParentId IN (${ids.map((x) => `'${x}'`).join(',')}) LIMIT 1`)).length > 0,
  });
}

// The object's record types, one query per run and object; a failed query is not kept.
function recordTypes(ctx, on) {
  const types = ctx.recordTypes ?? (ctx.recordTypes = new Map());
  if (!types.has(on)) types.set(on, queryOf(ctx.s, ctx.api)(`SELECT Id, DeveloperName, NamespacePrefix, IsActive FROM RecordType WHERE SobjectType = '${sq(on)}'`).catch((e) => { types.delete(on); throw e; }));
  return types.get(on);
}
// The check's named record type row, null for none or for Master (no row, always valid); a missing or inactive one throws.
// Its branch file says first, as a type the branch adds is not in the org yet: then the row is { branch: true }.
function namedType(c, rts, proj) {
  if (!c.recordType || c.recordType.toLowerCase() === 'master') return null;
  const [rns, rname] = splitNs(c.recordType);
  const lc = (v) => String(v ?? '').toLowerCase();
  // The active row first, then the local one over the own namespace's.
  const rank = (r) => (r.IsActive ? 0 : 2) + (r.NamespacePrefix ? 1 : 0);
  const found = rts.filter((r) => lc(r.DeveloperName) === lc(rname) && (rns ? lc(r.NamespacePrefix) === lc(rns) : !r.NamespacePrefix || lc(r.NamespacePrefix) === lc(proj.namespace))).sort((a, b) => rank(a) - rank(b))[0];
  const xml = ownFile(proj, (o) => `objects/${o}/recordTypes/${ownName(proj.namespace, c.recordType)}.recordType-meta.xml`, c.object, { object: true });
  if (xml != null && /<active>true<\/active>/.test(xml)) return found ?? { DeveloperName: rname, NamespacePrefix: rns, IsActive: true, branch: true };
  if (!found && xml == null) throw new Error(`no record type ${c.recordType} on ${c.object}`);
  if (xml != null || !found.IsActive) throw new Error(`no active record type ${c.recordType} on ${c.object}`);
  return found;
}

// A layout-required field is enforced only by the UI, so this reads metadata: which form the persona gets, whether the
// field is on it and required there or on the field itself, each fact from the branch's file else the org.
async function pageCheck(c, ctx) {
  const { s, api, proj } = ctx;
  const q = toolingOf(s, api);
  let items, label, from;
  // The field on the org's describe, else the branch's file: a field the branch adds is not in the org yet.
  const fieldXml = branchField(proj, c.object, c.field);
  let f;
  // In a namespaced org the describe holds the prefixed names, which FieldPermissions and RecordType queries need.
  let objectName = c.object;
  try {
    const d = await api.call(s, `/sobjects/${c.object}/describe`, { as: 'admin' });
    objectName = d.name ?? c.object;
    const want = c.field.toLowerCase();
    f = d.fields.find((x) => x.name.toLowerCase() === want || x.name.toLowerCase().endsWith(`__${want}`));
  } catch (e) {
    // A 404 is an object the org lacks: only a FlexiPage check carries on from the branch; else the name is wrong.
    if (e.evidence?.status !== 404) throw e;
    if (!branchDir(proj, `objects/${c.object}`)) throw new Error(`no object ${c.object}: check the name`);
  }
  if (!f && !fieldXml) throw new Error(`no field ${c.field} on ${c.object}`);
  // A field nobody can set permissions on (Name, a required field) is always readable. A custom field's file says first,
  // since it may change required; a standard field's file never carries required, so the org's describe says.
  const fromFile = fieldXml && (c.field.toLowerCase().endsWith('__c') || !f);
  const exempt = fromFile ? REQUIRED_FILE.test(fieldXml) : f.permissionable === false;
  let security = '';
  if (!exempt) {
    const read = await canRead(c, { s, api, proj, names: { object: objectName, field: f?.name ?? c.field } });
    // A field the org lacks has no org grants, and a profile file's name does not map from its label: not checkable.
    if (!read.ok && !f) throw new Error(`read access to ${c.field} is not checkable: the org lacks the field and no permission set on the branch grants it`);
    if (!read.ok) {
      const who = [c.persona.profile, ...c.persona.permissionSets].join(' + ');
      return { check: c.id, name: c.field, status: 'fail', error: `${who} cannot read ${c.field}`, detail: `field-level security from ${read.from}` };
    }
    security = `; readable from ${read.from}`;
  }
  if (c.flexiPage) {
    // A named record type must exist and be active. ponytail: whether the persona gets this page is not read.
    if (c.recordType) namedType(c, await recordTypes(ctx, objectName), proj);
    label = `page ${c.flexiPage}`;
    const { xml, md } = await flexiPageOf(c, proj, q);
    from = xml ? 'branch file' : 'org';
    if (!xml && !md) throw new Error(`no FlexiPage ${c.flexiPage} on the branch or in the org`);
    items = xml ? pageXml(xml) : pageJson(md);
  } else {
    // A namespaced object ns__Obj__c is its DeveloperName Obj and its NamespacePrefix ns.
    const [ns, devName] = c.object.endsWith('__c') ? splitNs(c.object.slice(0, -3)) : [null, null];
    const tableId = devName ? (await q(`SELECT Id FROM CustomObject WHERE DeveloperName = '${sq(devName)}'${nsRule('NamespacePrefix', ns, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0]?.Id : c.object;
    if (!tableId) throw new Error(`no custom object ${c.object} in the org: a layout check needs the object deployed`);
    const rt = c.recordType ? namedType(c, await recordTypes(ctx, objectName), proj) : null;
    if (rt?.branch) throw new Error(`${c.recordType} is on the branch only; the layout assignment is read from the org's profile`);
    const rows = await q(`SELECT LayoutId, Layout.Name, RecordTypeId FROM ProfileLayout WHERE TableEnumOrId = '${sq(tableId)}' AND Profile.Name = '${sq(c.persona.profile)}'`);
    // A named record type needs its own row, and an object with active record types needs one named: no silent master row.
    if (!c.recordType && rows.some((r) => r.RecordTypeId) && (await recordTypes(ctx, objectName)).some((r) => r.IsActive)) throw new Error(`name a recordType: ${c.object} has record types`);
    const row = rt ? rows.find((r) => r.RecordTypeId?.slice(0, 15) === rt.Id.slice(0, 15)) : rows.find((r) => !r.RecordTypeId);
    if (!row && c.recordType) throw new Error(`no layout row for record type ${c.recordType} on ${c.object}`);
    if (!row) throw new Error(`no layout assigned to ${c.persona.profile} for ${c.object}`);
    label = `layout ${row.Layout.Name}`;
    // ponytail: a layout whose name has characters Salesforce escapes in a file name (%28) is not found on the branch.
    const xml = branchFile(proj, `layouts/${c.object}-${row.Layout.Name}.layout-meta.xml`);
    from = xml ? 'branch file' : 'org';
    const md = xml ? null : (await q(`SELECT Metadata FROM Layout WHERE Id = '${sq(row.LayoutId)}'`))[0]?.Metadata;
    if (!xml && !md) throw new Error(`no layout ${row.Layout.Name} on the branch or in the org`);
    items = xml ? layoutXml(xml) : layoutJson(md);
  }
  const base = { check: c.id, name: c.field };
  // API names are case-insensitive: a layout may spell the field differently from the check.
  const hit = Object.keys(items).find((k) => k.toLowerCase() === c.field.toLowerCase());
  if (!hit) return { ...base, status: 'fail', error: `not on ${label}`, detail: `${label} from ${from}` };
  const onForm = items[hit].toLowerCase() === 'required';
  let detail = `${label} from ${from}: ${items[hit]}${security}`;
  let actual = onForm;
  if (!onForm) {
    // Required on the field counts on the form too: the branch's field file first, else the org describe.
    let fieldReq;
    if (fromFile) fieldReq = REQUIRED_FILE.test(fieldXml);
    else fieldReq = !f.nillable && f.createable && !f.defaultedOnCreate;
    actual = fieldReq;
    detail += `; field required ${fieldReq} from ${fromFile ? 'branch file' : 'org'}`;
  }
  if (actual === c.expect.required) return { ...base, status: 'pass', detail };
  return { ...base, status: 'fail', error: `required is ${actual}, the requirement says ${c.expect.required}`, detail };
}

// Whether the persona holds each permission a rule names: a custom one through SetupEntityAccess, a standard one through the
// set's Permissions column (a muting set's own columns), each from a branch set file else the org.
async function personaHas(c, kind, name, { s, api, proj }) {
  const rest = queryOf(s, api);
  const mine = name.toLowerCase();
  if (kind === 'CustomPermission') {
    const [ns, bare] = splitNs(name);
    // Looked up only when the org is asked: a permission the branch adds has no row yet, and a branch set decides first.
    let cp;
    const access = async (xs) => {
      cp ??= (await rest(`SELECT Id FROM CustomPermission WHERE DeveloperName = '${sq(bare)}'${nsRule('NamespacePrefix', ns, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0];
      // Added on the branch and not deployed: no org set can hold it yet.
      if (!cp && ownFile(proj, (n) => `customPermissions/${n}.customPermission-meta.xml`, name)) return false;
      if (!cp) throw new Error(`no custom permission ${name} in the org`);
      return (await rest(`SELECT Id FROM SetupEntityAccess WHERE SetupEntityId = '${cp.Id}' AND ParentId IN (${inList(xs)}) LIMIT 1`)).length > 0;
    };
    return (await personaGrants(c, {
      rest, proj,
      fileGrants: (xml) => block(xml, 'customPermissions').some((b) => sameName(proj.namespace, unxml(b.match(/<name>([^<]*)<\/name>/)?.[1] ?? ''), name) && /<enabled>true</.test(b)),
      orgGrants: access,
    })).ok;
  }
  if (!/^[A-Za-z]+$/.test(name)) throw new Error(`${name} is not a standard permission name`);
  return (await personaGrants(c, {
    rest, proj,
    fileGrants: (xml) => block(xml, 'userPermissions').some((b) => (b.match(/<name>([^<]*)<\/name>/)?.[1] ?? '').toLowerCase() === mine && /<enabled>true</.test(b)),
    // A muting set's standard permissions are columns of MutingPermissionSet.
    orgGrants: (xs, muting) => rest(`SELECT Id FROM ${muting ? 'MutingPermissionSet' : 'PermissionSet'} WHERE Id IN (${inList(xs)}) AND Permissions${name} = true LIMIT 1`).then((r) => r.length > 0),
  })).ok;
}

const target = (c) => c.field ?? c.component;

// The bundle a componentVisible check names, scanned for custom-permission gates; null for an action, a field, a name with no
// componentName colon, or a bundle not on the branch. ponytail: a bundle the page places under another name is not found.
function bundleGates(c, proj) {
  const [ns, bundle] = c.action || c.field ? [] : c.component.split(':');
  // Only the project's own components have a bundle here: c:x, or x of its namespace. force:x or another package's x is not one.
  if (ns !== 'c' && ns !== proj.namespace) return null;
  const js = bundle && branchFile(proj, `lwc/${bundle}/${bundle}.js`);
  return js ? { bundle, gates: scanGates(js, branchFile(proj, `lwc/${bundle}/${bundle}.html`) ?? '') } : null;
}
// What else a componentVisible check answers for: its bundle and the custom permissions the bundle imports, so --since selects it.
const gateCovers = (c, proj) => {
  const b = bundleGates(c, proj);
  // The item key of an own-namespace permission has no ns__ prefix, as its file name has none.
  const key = (full) => `customPermissions/${ownName(proj.namespace, full)}`;
  return b ? [`lwc/${b.bundle}`, ...b.gates.map((g) => key(g.permission))] : [];
};
// A what-if replaces the persona's own value for a permission of the same name in any case: API names are case-insensitive.
const overlay = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) { for (const b of Object.keys(out)) if (b.toLowerCase() === k.toLowerCase()) delete out[b]; out[k] = v; }
  return out;
};
const ruleLine = ({ criteria, booleanFilter }) => criteria.map((k, i) => `${booleanFilter ? `${i + 1}: ` : ''}${k.leftValue} ${k.operator} ${k.rightValue ?? ''}`.trim()).join(booleanFilter ? ', ' : ' AND ') + (booleanFilter ? ` (${booleanFilter})` : '');

// The record page the persona gets in the check's app: its Profile as the org names it (Admin for System Administrator),
// the app's and the object's page assignments from the branch file, else the org. ponytail: View and the large form factor only.
async function personaPage(c, ctx) {
  const { s, api, proj } = ctx;
  const q = toolingOf(s, api);
  const profile = (await q(`SELECT FullName FROM Profile WHERE Name = '${sq(c.persona.profile)}' LIMIT 1`))[0]?.FullName;
  if (!profile) throw new Error(`no profile ${c.persona.profile} in the org`);
  // The describe's name is the prefixed one in a namespaced org, and an assignment row may spell either.
  const d = await api.call(s, `/sobjects/${c.object}/describe`, { as: 'admin' }).catch((e) => { if (e.evidence?.status !== 404) throw e; });
  const names = [...new Set([c.object, d?.name].filter(Boolean))];
  // One query per object answers both guards: an object with active record types needs one named, and a named one must be active.
  // Master has no row and is always valid.
  const on = d?.name ?? c.object;
  const rts = await recordTypes(ctx, on);
  if (!c.recordType && rts.some((r) => r.IsActive)) throw new Error(`name a recordType: ${c.object} has record types`);
  const rt = namedType(c, rts, proj);
  const [ans, bareApp] = splitNs(c.app);
  const app = ownFile(proj, (n) => `applications/${n}.app-meta.xml`, c.app) ?? (await q(`SELECT Metadata FROM CustomApplication WHERE DeveloperName = '${sq(bareApp)}'${nsRule('NamespacePrefix', ans, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0]?.Metadata;
  if (!app) throw new Error(`no app ${c.app} on the branch or in the org`);
  const key = { object: names, profile, recordType: rt ? c.recordType : null, namespace: proj.namespace };
  const levels = (objectOverrides) => resolvePage({ app: { actionOverrides: overrides(app, 'actionOverrides'), profileActionOverrides: overrides(app, 'profileActionOverrides') }, objectOverrides }, key);
  let got = levels([]);
  // Only when the app's rows miss does the object's own default decide, so only then is its file needed.
  if (got.level === 'none') {
    const [ons, bareObject] = c.object.endsWith('__c') ? splitNs(c.object.slice(0, -3)) : [null, null];
    const object = ownFile(proj, objectFile, c.object, { object: true }) ?? (bareObject && (await q(`SELECT Metadata FROM CustomObject WHERE DeveloperName = '${sq(bareObject)}'${nsRule('NamespacePrefix', ons, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0]?.Metadata);
    if (!object) throw new Error(`the page assignment of ${c.object} is not readable: no object file on the branch, and the org gives only a custom object's`);
    got = levels(overrides(object, 'actionOverrides'));
  }
  return { profile, describe: d, ...got };
}

// Which kind of rule a rule is: an action's own, the target's own, or the kind of container it sits on (its componentName). The org counts a
// field the persona cannot read as null in each kind below (test/visible-org.test.js scores them against the rendered page); any other is UNKNOWN on such a field.
const ruleKind = (c, r) => (r.action ? 'action' : r.own ? (c.field ? 'field' : 'component') : r.kind);
const CALIBRATED = ['action', 'field', 'component', 'flexipage:tab'];

// What the persona can read: the object, and each field the target or its rules name, as 'read', 'none' or 'unknown'.
// A field the org's describe lacks and no branch set grants, or a path across objects, is 'unknown', never a guess.
async function readAccess(c, rules, ctx, describe) {
  const { s, api, proj } = ctx;
  const rest = queryOf(s, api);
  const read = [...new Set(JSON.stringify(rules.map((r) => r.rule)).match(/\{!\s*Record\.[\w.]+/g)?.map((t) => t.replace(/^\{!\s*Record\./, '')) ?? [])];
  const fields = {};
  let defs;
  // In a namespaced org the describe holds the prefixed name, which ObjectPermissions and FieldPermissions queries need.
  const sobject = describe?.name ?? c.object;
  // A branch set row for an object the branch defines decides it, even when the org holds none: the object is new.
  let inFile = false;
  const got = await personaGrants(c, {
    rest, proj,
    // A muting set's View All or Modify All mutes only that: only its allowRead takes Read away, and its row says nothing of inFile.
    fileGrants: (xml, muting) => {
      const mine = block(xml, 'objectPermissions').filter((b) => sameName(proj.namespace, unxml(b.match(/<object>([^<]*)<\/object>/)?.[1] ?? ''), c.object, { object: true }));
      if (muting) return mine.some((b) => /<allowRead>true</.test(b));
      inFile ||= mine.length > 0;
      return mine.some((b) => /<(allowRead|viewAllRecords|modifyAllRecords)>true</.test(b));
    },
    orgGrants: async (ids) => (await rest(`SELECT Id FROM ObjectPermissions WHERE SobjectType = '${sq(sobject)}' AND PermissionsRead = true AND ParentId IN (${inList(ids)}) LIMIT 1`)).length > 0,
  });
  const object = got.ok;
  if (!object) {
    // An object no set holds a row for (Task, Event, User) has no object permission to read: not decided, never hidden.
    // A branch-defined object's set row decides it, unless the profile reads every object (View or Modify All Data).
    const inBranch = inFile && [c.object, ownName(proj.namespace, c.object, { object: true })].some((n) => resolveCI(proj, objectFile(n)));
    if (inBranch ? got.allData : !(await rest(`SELECT Id FROM ObjectPermissions WHERE SobjectType = '${sq(sobject)}' LIMIT 1`)).length) return { object: 'unknown', fields, none: [] };
    return { object, fields, none: [] };
  }
  for (const name of [...new Set([c.field, ...read].filter(Boolean))]) {
    const key = name.toLowerCase();
    if (name.includes('.')) { fields[key] = 'unknown'; continue; }
    const is = (n) => n.toLowerCase() === key || n.toLowerCase().endsWith(`__${key}`);
    const f = describe?.fields.find((x) => is(x.name));
    // Name, Id and the like carry no field-level security.
    if (f?.permissionable === false) { fields[key] = 'read'; continue; }
    // The describe and FieldDefinition leave out a field the connecting admin cannot read; Tooling lists custom fields all the same.
    // ponytail: a standard field the admin cannot read is not found this way, and gives UNKNOWN.
    defs ??= (await toolingOf(s, api)(`SELECT DeveloperName, NamespacePrefix FROM CustomField WHERE EntityDefinition.QualifiedApiName = '${sq(sobject)}'`)).map((r) => `${r.NamespacePrefix ? `${r.NamespacePrefix}__` : ''}${r.DeveloperName}__c`);
    const real = f?.name ?? defs.find(is);
    const got = await canRead({ ...c, field: name }, { s, api, proj, names: { object: sobject, field: real ?? name } });
    fields[key] = got.ok ? 'read' : real ? 'none' : 'unknown';
  }
  return { object, fields, none: Object.keys(fields).filter((k) => fields[k] === 'none') };
}

// What the persona sees of a component in each of the check's cases, by evaluating its rule and its containers' rules.
// The persona's permissions are read; its user fields, the record state and the form factor come from the case.
async function visibleVerdicts(c, ctx) {
  const { s, api, proj } = ctx;
  // The page the persona is given in the app must be the one the check reads.
  const got = await personaPage(c, ctx);
  if (!sameName(proj.namespace, got.page ?? '', c.flexiPage)) throw new Error(`${[c.persona.profile, ...c.persona.permissionSets].join(' + ')} (profile ${got.profile}) gets ${got.page ?? "Lightning's own page"} (${got.level}) for ${c.object}${c.recordType ? ` ${c.recordType}` : ''} in ${c.app}, not ${c.flexiPage}`);
  const landed = `page ${got.page} from ${got.level}; `;
  const { xml, md } = await flexiPageOf(c, proj, toolingOf(s, api));
  if (!xml && !md) throw new Error(`no FlexiPage ${c.flexiPage} on the branch or in the org`);
  const all = components(xml ?? md);
  const what = target(c);
  const hit = c.field ? all.filter((x) => x.field?.toLowerCase() === c.field.toLowerCase()) : all.filter((x) => x.componentName === c.component || x.identifier === c.component);
  if (!hit.length) throw new Error(`${what} is not placed on ${c.flexiPage}`);
  if (hit.length > 1 && !c.field) throw new Error(`${what} is placed ${hit.length} times on ${c.flexiPage}: name its identifier`);
  // A field check names no identifier: a field placed more than once shows where any one placement's rules all hold.
  const groups = hit.map((h) => rulesFor(all, h));
  let rules = groups[0];
  if (c.action) {
    // An action the component's list lacks is not offered at all; one with no rule is offered whenever the component shows.
    const act = hit[0].actions.find((a) => a.name === c.action);
    if (!act) throw new Error(`${c.action} is not one of the dynamic actions of ${c.component} on ${c.flexiPage}`);
    if (act.rule) groups[0] = rules = [{ by: `action ${act.name}`, rule: act.rule, action: true }, ...rules];
  }
  if (groups.length > 1) rules = groups.flat();
  const text = JSON.stringify(rules.map((r) => r.rule));
  const need = (kind) => [...new Set([...text.matchAll(new RegExp(`\\{!\\$Permission\\.${kind}\\.([\\w]+)\\}`, 'g'))].map((m) => m[1]))];
  const held = async (kind) => Object.fromEntries(await Promise.all(need(kind).map(async (n) => [n, await personaHas(c, kind, n, ctx)])));
  const [customPermissions, standardPermissions] = [await held('CustomPermission'), await held('StandardPermission')];
  const access = await readAccess(c, rules, ctx, got.describe);
  const own = c.field ? access.fields[c.field.toLowerCase()] : 'read';
  const noRead = !access.object ? `cannot read ${c.object}` : access.none.length ? `cannot read ${access.none.join(', ')}` : '';
  // The bundle's gates hide blocks inside the component, not the component: they are listed here, and --matrix tells who holds each.
  const lwc = bundleGates(c, proj)?.gates.map((g) => `${g.permission} ${g.status === 'STATIC' ? 'static' : 'NOT_STATIC'}`).join(', ');
  const says = (rs) => rs.map((r) => `${r.by}: ${ruleLine(r.rule)}`).join('; ');
  // A field placed twice: each placement's own rules apart, joined by |, and a container rule every placement shares once.
  const shared = groups.length > 1 ? groups[0].filter((r) => groups.every((g) => g.some((x) => x.rule === r.rule))) : [];
  const placed = groups.length > 1 ? `placed ${groups.length} times, shown where any placement is: ${groups.map((g) => says(g.filter((r) => !shared.some((x) => x.rule === r.rule))) || 'no rule of its own').join(' | ')}${shared.length ? `; on every placement: ${says(shared)}` : ''}` : '';
  const from = `${landed}${xml ? 'branch file' : 'org'}; ${placed || (rules.length ? says(rules) : 'no rule')}${noRead ? `; persona ${noRead}` : ''}${lwc ? `; lwc gates: ${lwc}` : ''}`;
  return {
    from,
    rows: c.cases.map((k) => {
      // No object access, or no FLS on the field itself: nothing of it shows. A field whose access is not decided is UNKNOWN.
      if (access.object === 'unknown') return { k, got: rule.UNKNOWN };
      if (!access.object || own === 'none') return { k, got: false };
      if (own === 'unknown') return { k, got: rule.UNKNOWN };
      const state = { record: k.record ?? {}, user: k.user ?? {}, customPermissions: overlay(customPermissions, k.customPermissions), standardPermissions: overlay(standardPermissions, k.standardPermissions), formFactor: k.formFactor, access: access.fields };
      return { k, got: groups.map((g) => g.map((r) => rule.evaluate(r.rule, { ...state, unreadable: CALIBRATED.includes(ruleKind(c, r)) ? 'null' : 'unknown' })).reduce(rule.and, true)).reduce(rule.or) };
    }),
  };
}

async function visibleCheck(c, ctx) {
  const { from, rows } = await visibleVerdicts(c, ctx);
  return rows.map(({ k, got }) => {
    const base = { check: c.id, name: k.name, detail: from };
    // A rule it cannot settle is a hand-off to the browser layer, not a failure; it is never a pass.
    if (got === rule.UNKNOWN) return { ...base, status: 'handoff', error: `UNKNOWN: the rule reads an input the case does not give, or a comparison not measured${k.handoff ?? c.handoff ? `; owner: ${k.handoff ?? c.handoff}` : ''}` };
    if (got === k.expect.visible) return { ...base, status: 'pass' };
    return { ...base, status: 'fail', error: `${c.action ? `${c.action} on ${c.component}` : target(c)} is ${got ? 'shown' : 'hidden'}, the requirement says ${k.expect.visible ? 'shown' : 'hidden'}` };
  });
}

// Who sees a component: every persona of the componentVisible checks that name it against every state of theirs, whatever
// each expects, plus the bundle's static gates; NOT_STATIC ones are left to Jest or a browser. Returns the cells for --junit.
async function matrix(checks, ctx, log) {
  const groups = new Map();
  for (const c of checks) { const k = `${c.app} ${c.recordType ?? ''} ${c.flexiPage} ${c.action ? `${c.component} ${c.action}` : target(c)}`.replace(/ +/g, ' '); groups.set(k, [...(groups.get(k) ?? []), c]); }
  const cells = [];
  const errors = [];
  const word = (g) => (g === rule.UNKNOWN ? 'UNKNOWN' : g ? 'shown' : 'hidden');
  const who = (p) => [p.profile, ...p.permissionSets].join(' + ');
  let stopped = false;
  for (const [key, cs] of groups) {
    if (ctx.signal?.aborted) { stopped = true; break; }
    const personas = new Map(cs.map((c) => [JSON.stringify(c.persona), c.persona]));
    const states = new Map();
    // The first name a state was given stays; a state is its content, not its name. A state with a taken name is numbered until the name is free, so its cell id is its own.
    const used = new Set();
    for (const k of cs.flatMap((c) => c.cases)) {
      const id = JSON.stringify([k.record, k.user, k.customPermissions, k.standardPermissions, k.formFactor]);
      if (states.has(id)) continue;
      let name = k.name;
      for (let n = 2; used.has(name); n++) name = `${k.name} (${n})`;
      used.add(name);
      states.set(id, name === k.name ? k : { ...k, name });
    }
    const cases = [...states.values()];
    log(`matrix ${key}: ${cases.map((k) => k.name).join(' | ')}`);
    for (const persona of personas.values()) {
      if (ctx.signal?.aborted) { stopped = true; break; }
      let rows;
      try { ({ rows } = await visibleVerdicts({ ...cs[0], persona, cases }, ctx)); } catch (e) {
        errors.push({ name: `matrix/${key}/${who(persona)}`, message: e.message });
        log(`${who(persona)}: ERROR ${e.message}`);
        continue;
      }
      cells.push(...rows.map((r) => ({ id: `matrix/${key}/${who(persona)}/${r.k.name}`, got: r.got })));
      log(`${who(persona)}: ${rows.map((r) => word(r.got)).join(' | ')}`);
    }
    const scan = bundleGates(cs[0], ctx.proj);
    if (!cs[0].field && !cs[0].action && !cs[0].component.includes(':')) log(`lwc gate scan skipped: ${cs[0].component} is named by identifier, name its componentName to scan the bundle`);
    for (const g of scan?.gates ?? []) {
      if (g.status === 'NOT_STATIC') { log(`NOT_STATIC lwc gate ${g.permission}: ${g.reason}`); continue; }
      const held = [];
      try { for (const persona of personas.values()) held.push(await personaHas({ ...cs[0], persona }, 'CustomPermission', g.permission, ctx)); } catch (e) {
        errors.push({ name: `matrix/${key}/lwc gate ${g.permission}`, message: e.message });
        log(`lwc gate ${g.permission}: ERROR ${e.message}`);
        continue;
      }
      // Blocks read the permission both ways: one line per polarity, so none is hidden behind the first.
      const polarities = [...new Set(g.gates.map((x) => x.shownWhenHeld))];
      for (const shownWhenHeld of polarities) log(`lwc gate ${g.permission}${polarities.length > 1 ? ` (blocks shown when ${shownWhenHeld ? 'held' : 'not held'})` : ''}: ${[...personas.values()].map((p, i) => `${who(p)} ${held[i] === shownWhenHeld ? 'shown' : 'hidden'}`).join(' | ')}`);
    }
  }
  const unknown = cells.filter((x) => x.got === rule.UNKNOWN).length;
  log(`matrix ${groups.size} component(s), ${cells.length} cells, ${unknown} UNKNOWN${errors.length ? `, ${errors.length} ERROR` : ''}${stopped ? ', stopped by a signal' : ''}`);
  return { cells, errors, stopped };
}

async function runVisible(checks, ctx) {
  const out = [];
  for (const c of checks) {
    if (ctx.signal?.aborted) break;
    try { out.push(...await visibleCheck(c, ctx)); } catch (e) { out.push({ check: c.id, name: c.id, status: 'error', error: e.message }); }
  }
  return out;
}

async function runPages(checks, ctx) {
  const out = [];
  for (const c of checks) {
    if (ctx.signal?.aborted) break;
    try { out.push(await pageCheck(c, ctx)); } catch (e) { out.push({ check: c.id, name: c.field, status: 'error', error: e.message }); }
  }
  return out;
}

// Whether the persona can call the class: grants come from the profile's own set and the named sets, a branch file else the org.
// Under System.runAs Apex ignores class access, so a record check cannot see a missing grant.
async function classCheck(c, name, ctx) {
  const { s, api, proj } = ctx;
  const rest = queryOf(s, api);
  const [ns, bare] = splitNs(name);
  const org = (await rest(`SELECT Id, ApiVersion FROM ApexClass WHERE Name = '${sq(bare)}'${nsRule('NamespacePrefix', ns, proj)} ORDER BY NamespacePrefix NULLS FIRST LIMIT 1`))[0];
  // The unprefixed file stands for ns__Name only in the project's own namespace.
  const own = ownName(proj.namespace, name);
  const onBranch = [...new Set([name, own])].map((n) => ({ cls: classFile(proj, n, '.cls'), meta: classFile(proj, n, '.cls-meta.xml') })).find((x) => x.cls || x.meta);
  if (!org && !onBranch) throw new Error(`no Apex class ${name} in the org or on the branch`);
  const ver = onBranch?.meta && fs.readFileSync(onBranch.meta, 'utf8').match(/<apiVersion>([\d.]+)<\/apiVersion>/)?.[1];
  const apiNote = ver ? `class API ${ver} from branch` : org ? `class API ${Number(org.ApiVersion).toFixed(1)} from org` : 'class API unknown';
  const mine = new Set([name, own].filter(Boolean).map((n) => n.toLowerCase()));
  const access = (ids) => (org ? rest(`SELECT Id FROM SetupEntityAccess WHERE SetupEntityId = '${sq(org.Id)}' AND ParentId IN (${ids.map((x) => `'${sq(x)}'`).join(',')}) LIMIT 1`).then((r) => r.length > 0) : false);
  // Author Apex reaches every class whatever its access settings (Help, "How Does Apex Class Security Work?").
  const AUTHOR = 'Author Apex';
  // The answer does not depend on the class, so a check's classes share one query per set of ids.
  const seen = ctx.authorApex ?? (ctx.authorApex = new Map());
  const author = (ids, muting) => {
    const key = [...ids].sort().join();
    if (!seen.has(key)) seen.set(key, rest(`SELECT Id FROM ${muting ? 'MutingPermissionSet' : 'PermissionSet'} WHERE Id IN (${ids.map((x) => `'${sq(x)}'`).join(',')}) AND PermissionsAuthorApex = true LIMIT 1`).then((r) => r.length > 0)
      // A failed query is not kept: the next class asks again.
      .catch((e) => { seen.delete(key); throw e; }));
    return seen.get(key);
  };
  const read = await personaGrants(c, {
    rest, proj,
    // Both reasons, so a group's muting can take away one and leave the other; Author Apex is not asked when access grants and one reason will do.
    orgGrants: async (ids, muting, first) => { const a = await access(ids); return a && first ? [a] : [a, (await author(ids, muting)) && AUTHOR]; },
    fileGrants: (xml) => [block(xml, 'classAccesses').some((b) => mine.has(unxml(b.match(/<apexClass>([^<]*)<\/apexClass>/)?.[1] ?? '').toLowerCase()) && /<enabled>true</.test(b)),
      block(xml, 'userPermissions').some((b) => /<name>AuthorApex<\/name>/.test(b) && /<enabled>true</.test(b)) && AUTHOR],
  });
  const detail = `${read.from}; ${apiNote}`;
  const who = [c.persona.profile, ...c.persona.permissionSets].join(' + ');
  const base = { check: c.id, name, detail };
  if (read.ok === c.expect.access) return { ...base, status: 'pass' };
  return { ...base, status: 'fail', error: read.ok ? `${who} can call ${name}, the requirement says not` : `${who} cannot call ${name}` };
}

// One result per class: the check's own, else the entry classes its covered bundles import.
async function runClasses(checks, ctx) {
  const out = [];
  for (const c of checks) {
    // After a stop a later check is not visited: no import read, no ERROR; main reports it as stopped.
    if (ctx.signal?.aborted) break;
    const names = c.class ? [c.class] : [...new Set(c.covers.filter((k) => k.startsWith('lwc/')).flatMap((k) => apexImports(ctx.proj, k)))];
    if (!names.length) out.push({ check: c.id, name: c.id, status: 'error', error: 'no class, and no covered lwc bundle imports Apex' });
    for (const name of names) {
      // After a stop, the classes with no result are reported as skipped; a check with none at all is reported whole.
      if (ctx.signal?.aborted) { if (out.some((r) => r.check === c.id)) ctx.unrun.push({ check: c.id, name }); continue; }
      try { out.push(await classCheck(c, name, ctx)); } catch (e) { out.push({ check: c.id, name, status: 'error', error: e.message }); }
    }
  }
  return out;
}

// runAs skips class access, so each class an apex check covers and a persona may call gets a generated classAccess check.
// Only a covered class the act names, with an @AuraEnabled method on the branch, that no running classAccess check asks of this persona.
function accessChecks(c, proj, all = []) {
  if (c.kind !== 'apex') return [];
  const act = stripCode(c.act);
  // Profile and set names are not case-sensitive, and a class is compared without its ns__ prefix.
  const who = (p) => JSON.stringify([p.profile, ...[...new Set(p.permissionSets.map((x) => x.toLowerCase()))].sort()].map((x) => x.toLowerCase()));
  const bare = (n) => n.replace(/^\w+?__/, '').toLowerCase();
  // The classes a classAccess check asks about: its own, else those its covered bundles import.
  const named = (x) => (x.class ? [x.class] : x.covers.filter((k) => k.startsWith('lwc/')).flatMap((k) => apexImports(proj, k))).map(bare);
  return c.covers.filter((k) => k.startsWith('classes/')).map(classOf).filter((name) => {
    // The act names the class, and no check that runs already asks the same of this persona; the class is found at any depth.
    if (!new RegExp(`\\b${name}\\b`, 'i').test(act)) return false;
    if (all.some((x) => x.kind === 'classAccess' && x.expect.access === true && who(x.persona) === who(c.persona) && named(x).includes(bare(name)))) return false;
    const f = classFile(proj, name, '.cls');
    return f && auraMethod(fs.readFileSync(f, 'utf8'));
  }).map((name) => ({ id: `${c.id}/classAccess`, kind: 'classAccess', requirement: c.requirement, covers: c.covers, persona: c.persona, class: name, expect: { access: true } }));
}

// One runner per kind: apex rides in the record kind's validate, one class, one deploy.
const RUNNERS = { record: runRecords, apex: runRecords, flow: runRecords, pageRequired: runPages, classAccess: runClasses, componentVisible: runVisible };

async function defaultConnect(org, api) {
  const session = require('./session');
  const s = { ...(await session.fromAlias(org)), apiVersion: api.PINNED_VERSION };
  const [version, res] = await Promise.all([session.latestVersion(s), api.call(s, `/query?q=${encodeURIComponent(session.ORG_QUERY)}`, { as: 'admin' })]);
  const o = res?.records?.[0];
  if (!o) throw new SfUiError('API_ERROR', 'the Organization query returned no row', { body: res });
  s.orgApiVersion = version;
  s.production = session.isProduction(o);
  return s;
}

async function main(a, { log = console.log, warn = console.error, git, sf, api = require('./api'), connect, signal, soap, sleep } = {}) {
  const time = {};
  const began = performance.now(); // not Date.now: a clock correction mid-run would bend a stage
  let proj;
  let file;
  let only;
  try {
    const checks = a.checks || process.env.SF_TESTER_CHECKS;
    if (!checks) throw new Usage('name the check file with --checks or SF_TESTER_CHECKS');
    if (a.plan && a.matrix) throw new Usage('--plan and --matrix are mutually exclusive');
    if (a.cascade && (a.plan || a.matrix)) throw new Usage('--cascade runs the checks, so it cannot go with --plan or --matrix');
    if (!a.plan && !a.org) throw new Usage('verify needs --org, except with --plan');
    if (!fs.existsSync(checks)) throw new Usage(`no check file at ${checks}`);
    proj = loadProject(checks);
    try { file = JSON.parse(fs.readFileSync(checks, 'utf8')); } catch (e) { throw new Usage(`${checks} is not JSON: ${e.message}`); }
    const bad = badChecks(file, proj);
    if (bad.length) throw new Usage(bad.map((b) => `BAD_CHECK ${b}`).join('\n'));
    try { only = a.only && new RegExp(a.only); } catch { throw new Usage(`--only ${a.only} is not a regular expression`); }
    // A pattern that names no check in the file is a typo; one that names checks no change reaches is a NOT RUN.
    if (only && !file.checks.some((c) => only.test(c.id))) throw new Usage(`--only ${a.only} matches no check`);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    warn(`${e.message}\n${USAGE}`);
    return 2;
  }
  for (const c of file.checks) c.persona = { profile: c.persona.profile, permissionSets: [...new Set(c.persona.permissionSets ?? [])].sort() };
  // selects: what else changes the verdict of a check, so --since runs it; unlike covers, it does not cover a gap.
  for (const c of file.checks) c.selects = c.kind === 'componentVisible' ? gateCovers(c, proj) : [];
  let s;
  const tConnect = performance.now();
  if (!a.plan) {
    try {
      s = await (connect || ((org) => defaultConnect(org, api)))(a.org);
      time.connect = Math.round(performance.now() - tConnect);
    } catch (e) {
      if (!['NO_AUTH', 'AUTH_UNREADABLE', 'API_ERROR'].includes(e.code)) throw e;
      // An API_ERROR is the org's answer, not the command line's, so it gets no usage line.
      warn(e.code === 'API_ERROR' ? `${a.org} could not be read: ${e.message}` : `${e.message}\n${USAGE}`);
      return 2;
    }
    if (s.production) { warn(`${a.org} is a production org: verify runs on a scratch org, a sandbox, a trial or a Developer Edition org\n${USAGE}`); return 2; }
  }
  // The cover keys each check reads; a group member is read below, as only a changed key needs it.
  const keysOf = (cs) => { for (const c of cs) c.keys = c.covers.filter((k) => reads(c, k, proj)); };
  keysOf(file.checks);
  // A bundle that imports Apex has a class-access gap only a classAccess check covers, so selecting is not covering there.
  const selectOnly = (key) => !(key.startsWith('lwc/') && apexImports(proj, key).length);
  const covering = (key) => file.checks.filter((c) => c.keys.includes(key) || (c.selects.includes(key) && selectOnly(key)));
  // Why a key no check covers is UNCOVERED: the checks that name it in covers but do not read it, if any.
  const dropped = (key) => { const ids = file.checks.filter((c) => c.covers.includes(key) && !c.keys.includes(key)).map((c) => c.id); return ids.length ? `: ${ids.join(', ')} cover it but do not read it` : ''; };
  // Which checks the change reaches: all of them with no --since, else those that cover a changed item.
  let items = new Map();
  let other = [];
  let gone = new Set();
  let files = [];
  // The item keys the static map named, and its flows' labels, for the --cascade diff.
  let mapped = null;
  let labels;
  const tDiff = performance.now();
  if (a.since) {
    try { files = changedFiles(a.since, proj.root, git); } catch (e) {
      if (e.stderr == null) throw e;
      warn(`${String(e.stderr).trim() || e.message}\n${USAGE}`);
      return 2;
    }
    // Group members are asked of the org only for a check covering a changed permission set, so an unrelated check's group costs nothing.
    if (s) {
      const changedKeys = new Set(files.map((f) => itemOf(f, proj)?.key).filter(Boolean));
      const need = file.checks.filter((c) => c.covers.some((k) => keyType(k) === 'permissionsets' && changedKeys.has(k)));
      try { await groupMembers(need, proj, queryOf(s, api)); } catch (e) {
        if (e.code !== 'API_ERROR') throw e;
        warn(`${a.org} could not be read: ${e.message}`);
        return 2;
      }
      keysOf(need);
    }
    ({ items, other, gone } = changes(files, proj, new Set(file.checks.flatMap((c) => [...c.keys, ...c.selects]))));
    log(`since ${a.since}, ${files.length} files changed`);
    if (other.length) log(`not checkable yet: ${other.join(', ')}`);
    if (files.some((f) => /(^|\/)profiles\//.test(f))) log('note: the layout a profile gets and its class access are read from the org, so a changed layoutAssignments or classAccesses is checked against the old profile');
    // The map of what a changed bundle or class could set off; a gap is a note and never changes the verdict.
    const starts = [...new Set(files.map((f) => itemOf(f, proj)).filter((x) => x && (x.type === 'lwc' || x.type === 'classes')).map((x) => x.key))]
      .filter((k) => (k.startsWith('lwc/') ? liveBundle(proj, k) : classFile(proj, classOf(k), '.cls')));
    // Under --only the map starts only where a selected check reads, so it names nothing the excluded checks alone exercise.
    const left = only ? starts.filter((k) => !covering(k).some((c) => only.test(c.id))) : [];
    if (left.length) log(`NOTE cascade --only leaves out what no selected check covers: ${left.join(', ')}`);
    const map = cascade(proj, starts.filter((k) => !left.includes(k)), { apexImports, classFile, resolveCI }, (k) => file.checks.filter((c) => c.covers.includes(k)).map((c) => c.id));
    for (const l of map.lines) log(l);
    mapped = [...new Set(map.lines.map((l) => /^cascade .* > ((?:flows|triggers|objects)\/[^ :]+): /.exec(l)?.[1]).filter(Boolean))];
    labels = new Map(map.edges.filter((e) => e[0] === 'Flow').map((e) => [`flows/${e[4]}`, e[1]]));
    // With an org, the dependency table is read once and compared; a failed read is a note, not a failure.
    if (s && map.edges.length) {
      try {
        const { rows, cut } = await mcdRows(toolingOf(s, api), map.edges);
        for (const l of crossCheck(map.edges, rows, cut)) log(l);
      } catch (e) { log(`NOTE cascade MetadataComponentDependency could not be read: ${e.message}`); }
    }
    if (!items.size && !a.plan) {
      log(`no checkable change since ${a.since}`);
      if (a.junit) fs.writeFileSync(a.junit, junit([], [], SUITE));
      return 0;
    }
    time.diff = Math.round(performance.now() - tDiff);
  }
  const uncovered = [...items.keys()].filter((k) => !covering(k).length);
  const wanted = (c) => (!a.since || [...items.keys()].some((k) => c.keys.includes(k) || c.selects.includes(k))) && (!only || only.test(c.id));
  const selected = file.checks.filter(wanted);
  const covered = items.size - uncovered.length;
  // A deleted key counts whether the check covers it or only selects it.
  const goneKeys = (c) => [...new Set([...c.keys, ...c.selects])].filter((k) => gone.has(k));
  const runnable = selected.filter((c) => !goneKeys(c).length);
  if (a.plan) {
    for (const k of items.keys()) log(`${k} ${covering(k).length ? covering(k).map((c) => c.id).join(', ') : 'UNCOVERED'}`);
    // A cover key the check does not read is dropped: named here, as the author meant it to count.
    for (const c of file.checks.filter((x) => !only || only.test(x.id))) for (const k of c.covers.filter((x) => !c.keys.includes(x))) log(`NOTE ${c.id}: covers ${k}, which it does not read, so it covers nothing${keyType(k) === 'permissionsets' ? ' (--plan reads no org, so a member of a permission set group the persona names is not known)' : ''}`);
    // A classless check whose bundles import no Apex is an ERROR at run time, unless it covers a deleted item and FAILs as that; the plan says so, exit 0.
    for (const c of selected) if (c.kind === 'classAccess' && c.class == null && !c.covers.some((k) => gone.has(k)) && !c.covers.some((k) => k.startsWith('lwc/') && apexImports(proj, k).length)) log(`NOTE ${c.id}: no covered lwc bundle imports Apex on the branch, so it will be an ERROR at run time`);
    const ran = [...selected.map((c) => c.id), ...runnable.flatMap((c) => accessChecks(c, proj, runnable)).map((g) => `${g.id} ${g.class}`)];
    log(`would run: ${ran.join(', ') || 'nothing'}`);
    // The run carries classes only in the record validate, and not a class the branch deletes.
    if (runnable.some((c) => RUNNERS[c.kind] === runRecords)) {
      const carry = carriedClasses(proj, files);
      if (carry.live.length) log(`would carry: ${[...carry.live, ...carry.tests].join(', ')}`);
    }
    return 0;
  }
  // A flow check counts only when it deploys Apex: a hand-off or an ERROR needs no API 67.0.
  const apexRuns = runnable.some((c) => c.kind === 'apex' || (c.kind === 'flow' && flowCheck(c, proj, items).apex));
  const belowApex = !(parseFloat(s.orgApiVersion) >= 67);
  if (a.matrix) {
    const vis = runnable.filter((c) => c.kind === 'componentVisible');
    if (!vis.length) { warn(`no componentVisible check to build a matrix from\n${USAGE}`); return 2; }
    // A matrix runs no apex check, so the API 67.0 gate for apex does not apply to it.
    if (apexRuns && belowApex) log(`note: apex checks are left out of a matrix (they need API 67.0, ${a.org} reports ${s.orgApiVersion})`);
    let m;
    try { m = await matrix(vis, { s, api, proj, signal }, log); } catch (e) { warn(`matrix: ${e.message}`); return 1; }
    // A cell is a report, not a verdict: shown or hidden is a pass, UNKNOWN is skipped, an ERROR is a failure.
    if (a.junit) fs.writeFileSync(a.junit, junit(m.cells.map((x) => (x.got === rule.UNKNOWN ? { id: x.id, status: 'skip', ms: 0, reason: 'UNKNOWN' } : { id: x.id, status: 'pass', ms: 0 })), m.errors, SUITE));
    return m.errors.length || m.stopped ? 1 : 0;
  }
  // Below 67.0 runAs does not enforce CRUD or FLS, so an apex act could pass what the persona cannot do.
  if (apexRuns && belowApex) { warn(`${a.org} reports API ${s.orgApiVersion}: apex checks need 67.0 or later, where runAs enforces object and field permissions\n${USAGE}`); return 2; }
  const results = [];
  const unrun = [];
  for (const k of uncovered) log(`UNCOVERED ${k}${dropped(k)}`);
  // A covered item the branch deletes fails its checks, which then do not run: the org still has the item.
  // Whatever --only says: a deleted item has nothing to run, so every check covering it fails.
  const deleted = file.checks.flatMap((c) => goneKeys(c).map((k) => ({ check: c.id, name: k, status: 'fail', error: `deleted on the branch: ${k}`, requirement: c.requirement })));
  for (const r of deleted) { r.id = `${r.check}/${r.name}`; results.push(r); log(fmt(r)); }
  // Covered, but nothing ran for it: --only filtered its checks out, or its checks cover or select a deleted item. Not red.
  const notRun = new Map();
  for (const k of items.keys()) {
    if (gone.has(k) || !covering(k).length) continue;
    if (only && covering(k).every((c) => !only.test(c.id))) notRun.set(k, '--only');
    else if (!covering(k).some((c) => runnable.includes(c))) notRun.set(k, 'a covering check covers or selects a deleted item');
  }
  for (const [k, why] of notRun) log(`NOT RUN ${k} (${why})`);
  const generated = runnable.flatMap((c) => accessChecks(c, proj, runnable));
  for (const runner of new Set(Object.values(RUNNERS))) {
    // After Ctrl-C the next kind does not start.
    if (signal?.aborted) break;
    const group = [...runnable, ...generated].filter((c) => RUNNERS[c.kind] === runner);
    if (!group.length) continue;
    for (const r of await runner(group, { s, api, proj, sf: sf || execSf, org: a.org, items, files, signal, unrun, time, cascade: a.cascade ? { post: soap, sleep } : undefined })) {
      r.id = `${r.check}/${r.name}`;
      if (!r.aside) r.requirement = group.find((c) => c.id === r.check).requirement;
      results.push(r);
      log(fmt(r));
      if (r.cascade) log(`  RAN ${r.cascade}`);
    }
  }
  const tReport = performance.now();
  // What the map said could run against what did, over every case that ran.
  if (a.cascade) {
    const ran = results.filter((r) => r.t).map((r) => r.t);
    if (!mapped) log('cascade diff: needs --since, which builds the static map');
    else if (ran.length) {
      const d = ranlog.diff(mapped, ran, labels);
      // A cut log hides what ran after the cut, so "could run, did not" is then a list to check, not a finding.
      const cut = ran.some((t) => t.partial) || results.some((r) => r.logCut) ? ' (a log was cut, so what it lost may have run)' : '';
      log(`cascade diff: the map named ${mapped.length}; could run, did not: ${d.didNot.join(', ') || 'none'}${d.didNot.length ? cut : ''}; ran, not on the map: ${d.unmapped.join(', ') || 'none'}`);
    } else log(`cascade diff: not run, no case has a log to compare with the map's ${mapped.length}`);
  }
  const n = (st) => results.filter((r) => r.status === st).length;
  // After a stop, a runnable check with no result, and a class with none, did not run: each is printed and counted.
  const stopped = signal?.aborted ? runnable.filter((c) => !results.some((r) => r.check === c.id)) : [];
  // A generated check shares its apex check's id, so it is told apart by class.
  if (signal?.aborted) unrun.push(...generated.filter((g) => !results.some((r) => r.check === g.id && r.name === g.class) && !unrun.some((u) => u.check === g.id && u.name === g.class)).map((g) => ({ check: g.id, name: g.class })));
  for (const c of stopped) log(`STOPPED ${c.id} (stopped by a signal)`);
  for (const u of unrun) log(`STOPPED ${u.check} ${u.name} (stopped by a signal)`);
  const nStopped = stopped.length + unrun.length;
  if (a.junit) {
    const asCase = (r) => (r.status === 'handoff' ? { id: r.id, status: 'skip', ms: 0, reason: r.error } : { id: r.id, status: r.status === 'pass' ? 'pass' : 'fail', ms: 0, error: r.error });
    fs.writeFileSync(a.junit, junit([...stopped.map((c) => ({ id: `stopped/${c.id}`, status: 'skip', ms: 0, reason: 'stopped by a signal' })), ...unrun.map((u) => ({ id: `stopped/${u.check}/${u.name}`, status: 'skip', ms: 0, reason: 'stopped by a signal' })), ...[...notRun].map(([k, why]) => ({ id: `notrun/${k}`, status: 'skip', ms: 0, reason: why })), ...uncovered.map((k) => ({ id: `uncovered/${k}`, status: 'fail', ms: 0, error: `UNCOVERED${dropped(k)}` })), ...results.filter((r) => r.status !== 'error').map(asCase)],
      results.filter((r) => r.status === 'error').map((r) => ({ name: r.id, message: r.error })), SUITE));
  }
  // Where the run's time went, before the counts so the counts stay the last line. total also holds what no stage names.
  time.report = Math.round(performance.now() - tReport);
  log(timeLine(time, Math.round(performance.now() - began)));
  log(`changed ${items.size}, covered ${covered}, uncovered ${uncovered.length}, ran ${results.filter((r) => !r.aside).length}, passed ${n('pass')}, failed ${n('fail')}${n('error') ? `, errors ${n('error')}` : ''}${n('handoff') ? `, needs browser ${n('handoff')}` : ''}${notRun.size ? `, not run ${notRun.size}` : ''}${nStopped ? `, stopped ${nStopped}` : ''}`);
  // Nothing ran is never green, unless --only or a deletion left a covered item with nothing to run, which was printed.
  if (!results.length && !uncovered.length && !notRun.size) { warn('no check ran: check --checks, --since and --only'); return 2; }
  return uncovered.length || n('fail') || n('error') ? 1 : 0;
}

module.exports = { visibleVerdicts, execSf, pkgDir, main, defaultConnect, generate, flowPlan, flowCheck, layoutXml, pageXml, itemOf, badChecks, changes, loadProject, readProject, Usage, apexImports, classFile, resolveCI, RUNNERS, USAGE };
