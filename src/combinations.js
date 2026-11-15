'use strict';

// UI combinations with a checked route on the fixture org (combinations.json), so a tester replays a known route with
// sf_run_route instead of exploring; test/combinations.test.js replays them all, so a stale route goes red.
// SF_TESTER_COMBINATIONS names a catalogue of the user's own org (same shape) read instead; not there yet is empty.
const fs = require('node:fs');
const path = require('node:path');
const { SfUiError } = require('./errors');
const validity = require('./validity');

const BUNDLED = path.join(__dirname, 'combinations.json');
const defaultFile = () => process.env.SF_TESTER_COMBINATIONS || BUNDLED;
// The one place a verify step's checksFile and project change form: stored relative to the catalogue's folder, loaded absolute.
function checkPaths(route, file, store = false) {
  const dir = path.dirname(path.resolve(file));
  const to = store ? (p) => (path.isAbsolute(p) ? path.relative(dir, p) || '.' : p) : (p) => path.resolve(dir, p);
  return route.map((s) => (s.tool !== 'sf_verify_checks' ? s : {
    ...s, args: Object.fromEntries(Object.entries(s.args || {}).map(([k, v]) => [k, ['checksFile', 'project'].includes(k) && typeof v === 'string' ? to(v) : v])) }));
}
// Read on every call, so a route saved since the server started is listed.
function catalogue({ file = defaultFile() } = {}) {
  if (!fs.existsSync(file)) return { placeholders: {}, combinations: [], candidates: [] };
  return { placeholders: {}, combinations: [], candidates: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Case, spaces and punctuation aside, so the sf-ui-inputs a tester reads off a component finds a task that says SF UI Inputs.
const has = (value, part) => !part || (value ?? '').toLowerCase().includes(part.toLowerCase()) || (!!slug(part) && slug(value ?? '').includes(slug(part)));

// Tested routes in combinations, routes a person has not promoted yet in candidates; both are listed, only tested replay.
function list({ component, container, file = defaultFile() } = {}) {
  const all = catalogue({ file });
  return [...all.combinations, ...all.candidates.map((c) => ({ ...c, status: 'candidate' }))].map((c) => (c.route ? { ...c, route: checkPaths(c.route, file) } : c))
    .filter((c) => [c.component, c.id, c.task, c.requirement].some((v) => has(v, component)) && has(c.container, container));
}

// The whole catalogue in a read a tester can afford: each component (the id before @) once, with its interaction and
// the containers (the slug after @) its route is tested in, a note beside a slug whose interaction differs, a legend
// of the slugs, and the candidates apart. An id is component@slug, and a persona's route ends the slug with ~persona.
function index(entries) {
  const components = {};
  const containers = {};
  for (const c of entries.filter((e) => e.status === 'tested')) {
    const [name, slug] = c.id.split('@');
    const it = (components[name] ??= { does: c.interaction, in: [] });
    it.in.push(c.interaction === it.does ? slug : `${slug} (${c.interaction})`);
    containers[slug] ??= c.container;
  }
  const candidates = entries.filter((e) => e.status !== 'tested').map(({ id, interaction }) => ({ id, interaction }));
  return { components, containers, candidates };
}

// Each placeholder's description, as an agent reads it: the object form (how a replay makes it) shows its about.
const describe = (placeholders) => Object.fromEntries(Object.entries(placeholders).map(([k, v]) => [k, typeof v === 'string' ? v : v.about]));

// The route with every {{name}} replaced by the run's value; a placeholder with no value is BAD_ARGS, never sent.
// placeholders: the catalogue in use, listed in that error; the default catalogue's when not given.
function fill(route, values, placeholders) {
  const missing = new Set();
  const text = JSON.stringify(route).replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? JSON.stringify(String(values[k])).slice(1, -1) : (missing.add(k), '')));
  if (missing.size) throw new SfUiError('BAD_ARGS', `no value for ${[...missing].join(', ')}`, { missing: [...missing], placeholders: describe(placeholders || catalogue().placeholders) });
  return JSON.parse(text);
}

// The user's own catalogue, never the bundled fixture one, which only fixture routes go into.
const own = (file) => {
  if (!file || path.resolve(file) === BUNDLED) throw new SfUiError('NO_CATALOGUE', 'set SF_TESTER_COMBINATIONS to your own catalogue file to save routes; the bundled one holds only fixture routes', { file });
  return catalogue({ file });
};
// How many entries carry an id across both lists: the one invariant save and promote keep is at most one.
const copies = (all, id) => [...all.combinations, ...all.candidates].filter((c) => c.id === id).length;
const write = (file, all) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
};

// A route is identified by route + persona, so one route can be saved once per persona. The id carries it because every
// reader (--only, --baseline, sf_promote_route, JUnit) goes by id. No character here means anything in a regex.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const personaId = (id, { profile, permissionSets }) => {
  const suffix = ['', slug(profile), ...permissionSets.map(slug)].join('~');
  return id.endsWith(suffix) ? id : `${id}${suffix}`;
};

// Appends a route a tester just checked: a candidate, listed at once and replayed only once a person promotes it; or,
// promoted (auto mode), straight into the tested routes that replays and CI run.
function save({ id, component, container, interaction, task, requirement, replaces, needs = [], app, route, validity }, { file = process.env.SF_TESTER_COMBINATIONS, promoted = false } = {}) {
  const all = own(file);
  route = checkPaths(route, file, true); // portable with the catalogue
  if (validity?.persona) id = personaId(id, validity.persona);
  if (copies(all, id)) throw new SfUiError('DUPLICATE_ID', `${id} is already in ${file}`, { id, file });
  const entry = { id, component, container, interaction, task, ...(requirement && { requirement }), ...(replaces && { replaces }), needs, ...(app && { app }), route, ...(validity && { validity }),
    status: promoted ? 'tested' : 'candidate', verified: { on: new Date().toISOString().slice(0, 10), by: promoted ? 'sf-tester run, promoted by the tester' : 'sf-tester run' } };
  (promoted ? all.combinations : all.candidates).push(entry);
  write(file, all);
  return { saved: entry, file };
}

// A person's promotion of a candidate to tested, so replays and CI run it.
function promote(id, { file = process.env.SF_TESTER_COMBINATIONS } = {}) {
  const all = own(file);
  const at = all.candidates.findIndex((c) => c.id === id);
  if (at < 0) throw new SfUiError('NOT_FOUND', `no candidate ${id} in ${file}`, { id, file, candidates: all.candidates.map((c) => c.id) });
  // A hand-edited file can hold the id twice, in both lists or among the candidates; promoting would keep a duplicate.
  if (copies(all, id) > 1) throw new SfUiError('DUPLICATE_ID', `${id} appears more than once in ${file}`, { id, file });
  // Two remaps can name one stale route: the first to be promoted retires it, and the other is found against a route that is gone.
  // An id retired before and saved again is live, so a remap of it retires it again.
  const { replaces } = all.candidates[at];
  const by = !all.combinations.some((c) => c.id === replaces) && all.replaced?.findLast((c) => c.id === replaces)?.replacedBy; // the last to retire it
  if (by) throw new SfUiError('ALREADY_REPLACED', `${all.candidates[at].replaces} was retired by ${by.id}: run the remap again against that route, or leave this draft`, { id, replaces: all.candidates[at].replaces, replacedBy: by.id });
  const [entry] = all.candidates.splice(at, 1);
  const on = new Date().toISOString().slice(0, 10);
  const tested = { ...entry, status: 'tested', verified: { ...entry.verified, promoted: { on, by: 'a person' } } };
  all.combinations.push(tested);
  // A remap's promotion retires the stale route it names: kept under replaced, so no replay or lookup reaches it again.
  const gone = entry.replaces ? all.combinations.findIndex((c) => c.id === entry.replaces) : -1;
  if (gone >= 0) all.replaced = [...(all.replaced || []), { ...all.combinations.splice(gone, 1)[0], replacedBy: { id, on } }];
  write(file, all);
  return { promoted: tested, file, ...(gone >= 0 && { retired: entry.replaces }) };
}

// A replay's reads become the new baselines: a part read replaces the saved one, a part not read keeps its own, but a persona's
// set hashes merge per set. Returns the ids of routes that kept a saved set hash. Read raw: catalogue() would reorder the file.
function baseline(reads, { file }) {
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const carried = [];
  for (const e of all.combinations.filter((c) => reads[c.id])) {
    const { app, page, persona } = e.validity || {}; // only these: a stray key would make the saved value count as no baseline
    const read = reads[e.id];
    // A set the read could not hash keeps its saved hash, safe as the read is of the same persona; a set the persona dropped loses it.
    const own = read.persona?.permissionSetHashes || {};
    // The profile's own set is kept the same way.
    const kept = [...(read.persona?.permissionSets || []), validity.PROFILE].filter((n) => !own[n] && persona?.permissionSetHashes?.[n]);
    const hashes = { ...Object.fromEntries(kept.map((n) => [n, persona.permissionSetHashes[n]])), ...own };
    const merged = kept.length > 0;
    if (merged) carried.push(e.id);
    e.validity = { ...(app && { app }), ...(page && { page }), ...(persona && { persona }), ...(merged ? { ...read, persona: { ...read.persona, permissionSetHashes: hashes } } : read) };
  }
  write(file, all);
  return carried;
}

module.exports = { list, index, fill, describe, save, promote, baseline, catalogue, own, slug, BUNDLED };
