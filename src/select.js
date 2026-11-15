'use strict';

// The tested routes a change can reach, for replay --since: pure over a diff's file list and the catalogue at the
// merge base and now, so it tests without git. Each reason keeps what put it there, for the CLI's header.
const { refs } = require('./replay');
const { fold } = require('./session');

const FIXTURE = 'test/fixture/force-app/main/default/';
const ACCESS = ['permissionsets', 'profiles'];
// Every route runs in some app, so an app file takes the smoke slice beside the routes that open or name it.
const SMOKE_TOO = ['applications'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHAPE = ['fields', 'validationRules', 'recordTypes'];
// A metadata folder name in the case the rules use (PermissionSets/ is permissionsets/), as the sf CLI on macOS reads it.
const FOLDERS = ['objects', 'tabs', 'lwc', 'aura', ...ACCESS, ...SMOKE_TOO, ...SHAPE];
const folder = (name) => FOLDERS.find((x) => x.toLowerCase() === String(name).toLowerCase()) ?? name;

// A metadata file's names from its path under root, most specific first: a bundle's folder, else its file name less
// the suffix, then after its last dot (Obj.Bump, Bump), then its object or report folder.
function names(file, root = FIXTURE) {
  const parts = file.slice(root.length).split('/');
  const [type, ...rest] = parts;
  if (['lwc', 'aura'].includes(folder(type)) && rest.length) return [rest[0]];
  const own = parts.at(-1).replace(/-meta\.xml$/, '').replace(/\.[^.]*$/, '');
  // A file with no name of its own (.gitkeep) names nothing, so no route is selected by an empty name.
  return [...new Set([own, own.split('.').at(-1), ...(rest.length > 1 ? [rest[0]] : [])])].filter(Boolean);
}

// A package directory as a path prefix: a package at the top ('' or '.') holds every file.
const under = (d) => (d === '' || d === '.' ? '' : `${d}/`);
// A path starts with a prefix in any case, as macOS's disk and the sf CLI there match them.
const within = (f, prefix) => f.toLowerCase().startsWith(prefix.toLowerCase());

// The metadata root a file sits under: the fixture project's, else main/default/ or <folder>/main/default/ of a package directory, in any case.
const rootOf = (f, packages = []) => [FIXTURE, ...packages.map((d) => `${under(d)}main/default/`)].find((r) => within(f, r))
  ?? packages.map((d) => f.match(new RegExp(`^${esc(under(d))}[^/]+/main/default/`, 'i'))?.[0]).find(Boolean);

const tested = (cat) => (cat?.combinations || []).filter((e) => e.status === 'tested');
// A route as it runs: a refreshed baseline changes what a replay reports, not what it does. Its persona is who runs it.
const steps = ({ validity, ...e }) => JSON.stringify({ ...e, persona: validity?.persona });

// The placeholders whose recipe changed, and each name that reaches one through its templates or with.
function reaching(before = {}, after = {}) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const reach = new Set(changed);
  for (let grew = true; grew;) {
    grew = false;
    for (const [k, spec] of Object.entries(after)) {
      if (!reach.has(k) && [...refs(spec), ...(spec.with || [])].some((r) => reach.has(r))) { reach.add(k); grew = true; }
    }
  }
  return { changed, reach };
}

// The first tested route of each container, in catalogue order: one route through every kind of page.
function smoke(entries) {
  const first = new Map();
  // One without sideEffects where the container has one, since a replay skips those.
  for (const e of entries) if (!first.has(e.container) || (first.get(e.container).sideEffects && !e.sideEffects)) first.set(e.container, e);
  return [...first.values()].map((e) => e.id);
}

// A tab or app is opened by its API name or its label, in any case, as sf_open_tab and sf_start match them.
const OPENS = { tabs: (e) => e.route.filter((s) => s.tool === 'sf_open_tab').map((s) => s.args?.tab), applications: (e) => [e.app] };

// files: paths from git diff, repo-relative. before, after: the parsed catalogue at the merge base and now. labels: a
// tab or app file's <label> then and now, since routes open them by the label the requirement or brief quotes.
// packages: the package directories of every sfdx-project.json in the repo, each under its file's folder.
function select(files, before, after, labels = {}, packages = []) {
  const now = tested(after);
  const was = new Map([...(before?.combinations || []), ...(before?.candidates || [])].map((e) => [e.id, steps(e)]));
  const { changed, reach } = reaching(before?.placeholders, after?.placeholders);
  const edited = now.filter((e) => was.get(e.id) !== steps(e)).map((e) => e.id);
  const needing = new Set(now.filter((e) => (e.needs || []).some((n) => reach.has(n))).map((e) => e.id));
  const catalogue = { reason: 'catalogue', ids: now.filter((e) => edited.includes(e.id) || needing.has(e.id)).map((e) => e.id), from: [...edited, ...changed.map((k) => `placeholder ${k}`)] };
  const fixture = { reason: 'fixture', ids: [], from: [] };
  const wide = { reason: 'smoke', ids: [], from: [] };
  const text = new Map(now.map((e) => [e.id, `${e.task} ${JSON.stringify(e.route)}`]));
  const hits = new Set();
  for (const f of files) {
    const root = rootOf(f, packages);
    // A user's file a route names takes the smoke slice too: its name is often a generic word (Account, All).
    const alsoSmoke = () => root !== FIXTURE && wide.from.push(`${f} (metadata)`);
    if (root) {
      const [type, , kind] = f.slice(root.length).split('/').map(folder);
      if (ACCESS.includes(type)) { wide.from.push(`${f} (access)`); continue; }
      if (SMOKE_TOO.includes(type)) wide.from.push(`${f} (app)`);
      // A field, validation rule or record type can break making a record in a route that never names it: smoke too.
      const shape = type === 'objects' && SHAPE.includes(kind);
      if (shape) wide.from.push(`${f} (data shape)`);
      const routesNaming = (n) => {
        const re = new RegExp(`(?<!\\w)${esc(n)}(?!\\w)`);
        return now.filter((e) => re.test(text.get(e.id))).map((e) => e.id);
      };
      // A tab or app selects every route that opens it or names it by any of its names, in any case and as the route
      // JSON escapes it, in one scan, not the first name with a hit.
      if (OPENS[type]) {
        const all = [...names(f, root), ...(labels[f] || [])];
        const want = new Set(all.map(fold));
        const opening = now.filter((e) => OPENS[type](e).some((v) => v != null && want.has(fold(v)))).map((e) => e.id);
        const forms = [...new Set(all.flatMap((n) => [n, JSON.stringify(n).slice(1, -1)]))];
        const re = new RegExp(`(?<!\\w)(?:${forms.map(esc).join('|')})(?!\\w)`, 'i');
        const reached = new Set(all.length ? [...opening, ...now.filter((e) => re.test(text.get(e.id))).map((e) => e.id)] : []);
        if (!reached.size) { if (!SMOKE_TOO.includes(type)) wide.from.push(`${f} (no route names ${all.join(' or ')})`); continue; }
        reached.forEach((id) => hits.add(id));
        if (!SMOKE_TOO.includes(type)) alsoSmoke();
        if (!fixture.from.includes(names(f, root)[0])) fixture.from.push(names(f, root)[0]);
        continue;
      }
      // The most specific name any route carries as a whole word wins (a list view before its object); a file no
      // route names (flows, flexipages, classes) takes the smoke slice rather than replaying nothing.
      const named = shape ? names(f, root).slice(0, 1) : names(f, root);
      const n = named.find((x) => routesNaming(x).length);
      if (!n) { if (!shape) wide.from.push(`${f} (no route names ${named.join(' or ')})`); continue; }
      routesNaming(n).forEach((id) => hits.add(id));
      if (!shape) alsoSmoke();
      if (!fixture.from.includes(n)) fixture.from.push(n);
    } else if ((f.startsWith('src/') && f !== 'src/combinations.json') || f === 'package.json' || f === 'package-lock.json'
      || f.startsWith('.github/workflows/') || f.startsWith('test/fixture/')) {
      // The CI steps and the fixture project (sfdx-project.json, config) run before any route.
      wide.from.push(f);
    } else if (/(^|\/)(sfdx-project\.json|\.forceignore)$/.test(f)) {
      // A project file decides what deploys (a package added or removed, a path ignored): smoke, as the fixture's do.
      wide.from.push(`${f} (project)`);
    } else if (packages.some((d) => within(f, under(d)))) {
      // Metadata no rule above maps (a user's own source): replay the smoke slice rather than nothing.
      wide.from.push(`${f} (metadata)`);
    }
  }
  fixture.ids = now.filter((e) => hits.has(e.id)).map((e) => e.id);
  if (wide.from.length) wide.ids = smoke(now);
  const all = new Set([catalogue, fixture, wide].flatMap((r) => r.ids));
  return { reasons: [catalogue, fixture, wide], ids: now.filter((e) => all.has(e.id)).map((e) => e.id) };
}

module.exports = { select, names, rootOf, smoke, FIXTURE };
