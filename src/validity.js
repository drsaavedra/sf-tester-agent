'use strict';

// What a route was checked against, read from the live session, so a replay can name a changed page behind a red.
// Content hashes, not ids or dates: both differ per org, and a catalogue replays on orgs other than the one that saved it.
const { createHash } = require('node:crypto');
// The module, not its setTimeout: a test's mock timers replace the property, not a name taken from it at load.
const timers = require('node:timers/promises');
const api = require('./api');
const discover = require('./discover');
const nav = require('./nav');
const { z } = require('zod');
const { SfUiError } = require('./errors');
const A = require('./anchors');

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
// A failed step leaves a page in an unknown state, so this read must not cost the route its error.
const LIMIT_MS = 20_000;
// A promise's value, or undefined once ms pass: a slow read costs its part, never the call.
const within = (p, ms) => { let t; return Promise.race([p, new Promise((done) => { t = setTimeout(done, ms); })]).finally(() => clearTimeout(t)); };
// ponytail: half the read's limit for the set hashes; a persona of many large managed sets may need more.
const HASH_MS = LIMIT_MS / 2;
const RETRY_MS = 1000;
// A blip is a 5xx, a 429 or a network fault (fetchCoded makes fetch's TypeError an API_ERROR with its cause). A 400, 403
// or 414 would answer the same again, and a TypeError that reaches here is a bug, so none is retried.
const transient = (e) => (e?.evidence && 'cause' in e.evidence) || e?.evidence?.status >= 500 || e?.evidence?.status === 429;

// Metadata's JSON grows with the API version, so a hash read at the session's own version would move with each release.
const metadata = (s, ...what) => discover.metadataOf({ ...s, apiVersion: api.PINNED_VERSION }, ...what);

// A profile's own set and a Session set that nobody activated are not part of what a user sees.
const PERM_SETS = "PermissionSet.IsOwnedByProfile = false AND PermissionSet.Type != 'Session'";
const SET_FIELDS = 'PermissionSetId, PermissionSet.Name, PermissionSet.NamespacePrefix, PermissionSetGroup.DeveloperName, PermissionSetGroup.NamespacePrefix';
// A group is named by the group: its row in PermissionSet may be named per org.
const permName = ({ PermissionSet: set, PermissionSetGroup: group }) => {
  const { NamespacePrefix: ns } = group || set;
  const name = group ? group.DeveloperName : set.Name;
  return ns ? `${ns}__${name}` : name;
};

// A call whose blip is tried once more after RETRY_MS, unless the deadline passed by then.
async function retryOnce(go, deadline = Infinity) {
  try { return await go(); } catch (e) {
    if (!transient(e)) throw e;
    await timers.setTimeout(RETRY_MS);
    if (Date.now() >= deadline) throw e;
    return go();
  }
}

// One query page as the alias's user (a later page by nextRecordsUrl), SOQL or, with root /tooling/query, Tooling as
// navmap reads it; a blip is tried once more after RETRY_MS unless the deadline passed.
const pageOf = (s, q, next, deadline, version = api.PINNED_VERSION, root = '/query') => retryOnce(() => api.call({ ...s, apiVersion: version }, next ? next.replace(/^\/services\/data\/v[\d.]+/, '') : `${root}?q=${encodeURIComponent(q)}`, { as: 'admin' }), deadline);

// A query whose cut result would read as sets a user does not hold, so a second page is refused, not used.
const queryAs = (s) => async (q) => {
  const { records, done } = await pageOf(s, q);
  if (done === false) throw new SfUiError('QUERY_TOO_LARGE', `more rows than one page: ${q.slice(0, 100)}`);
  return records;
};

// Every page of a query, for rows that can pass one page (a big set's field permissions).
// root '/tooling/query' reads Tooling.
const queryPaged = (s, deadline, version, root) => async (q) => {
  let page = await pageOf(s, q, undefined, deadline, version, root);
  const rows = [...page.records];
  while (page.nextRecordsUrl) rows.push(...(page = await pageOf(s, q, page.nextRecordsUrl, deadline, version)).records);
  return rows;
};

// Setup entities by name, so a swap that keeps the count reads as changed. Each type: the object that names it, the
// field holding the id SetupEntityAccess gives, and the name field. A flow's type is FlowDefinition (API 58.0+) and its id
// the FlowDefinitionView DurableId; an app's (TabSet) the AppMenuItem ApplicationId. ponytail: any other type hashes by type alone.
const NAMED = [
  { type: 'ApexClass', from: 'ApexClass', key: 'Id', field: 'Name' },
  { type: 'ApexPage', from: 'ApexPage', key: 'Id', field: 'Name' },
  { type: 'CustomPermission', from: 'CustomPermission', key: 'Id', field: 'DeveloperName' },
  { type: 'FlowDefinition', from: 'FlowDefinitionView', key: 'DurableId', field: 'ApiName' },
  { type: 'TabSet', from: 'AppMenuItem', key: 'ApplicationId', field: 'Name' },
];
const VIEW_ALL_FIELDS_VERSION = '63.0';
const inIds = (ids) => [...new Set(ids)].map((id) => `'${id}'`).join(', ');
// One id as 15 characters: an object can give the 15 and SetupEntityAccess the 18 of the same record.
const id15 = (id) => String(id).slice(0, 15);

// What each named set grants, hashed (a group by its own row, the sum of its sets), never by id, so it reads alike on two
// orgs. byName maps a name to its PermissionSet Ids: a set and a group of one name are hashed together.
async function permSetHashes(s, byName, deadline) {
  const names = Object.keys(byName);
  if (!names.length) return {};
  const query = queryPaged(s, deadline);
  const ids = inIds(Object.values(byName).flat());
  const [objects, fields, tabs, access, sets] = await Promise.all([
    // View All Fields came in API 63.0, past the pinned version, which has no such column; it opens every field's read.
    queryPaged(s, deadline, VIEW_ALL_FIELDS_VERSION)(`SELECT ParentId, SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, PermissionsViewAllFields FROM ObjectPermissions WHERE ParentId IN (${ids})`),
    query(`SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId IN (${ids})`),
    query(`SELECT ParentId, Name, Visibility FROM PermissionSetTabSetting WHERE ParentId IN (${ids})`),
    query(`SELECT ParentId, SetupEntityType, SetupEntityId FROM SetupEntityAccess WHERE ParentId IN (${ids})`),
    query(`SELECT FIELDS(STANDARD) FROM PermissionSet WHERE Id IN (${ids})`),
  ]);
  const named = {};
  const failed = new Set();
  await Promise.all(NAMED.map(async ({ type, from, key, field }) => {
    const of = access.filter((a) => a.SetupEntityType === type).map((a) => a.SetupEntityId);
    if (!of.length) return;
    try {
      for (const r of await query(`SELECT ${key}, NamespacePrefix, ${field} FROM ${from} WHERE ${key} IN (${inIds(of)})`)) named[id15(r[key])] = r.NamespacePrefix ? `${r.NamespacePrefix}__${r[field]}` : r[field];
    } catch (e) { if (!(e instanceof SfUiError)) throw e; failed.add(type); } // only the sets that grant this type go unhashed
  }));
  const flags = (r) => Object.keys(r).filter((k) => k.startsWith('Permissions') && r[k] === true).sort();
  return Object.fromEntries(names.flatMap((name) => {
    const mine = [byName[name]].flat();
    if (access.some((r) => mine.includes(r.ParentId) && failed.has(r.SetupEntityType))) return [];
    const of = (rows, row) => rows.filter((r) => mine.includes(r.ParentId)).map(row).map((x) => JSON.stringify(x)).sort();
    return [[name, hash({
      system: [...new Set(sets.filter((r) => mine.includes(r.Id)).flatMap(flags))].sort(),
      objects: of(objects, (r) => [r.SobjectType, ...flags(r)]),
      fields: of(fields, (r) => [r.Field, ...flags(r)]),
      tabs: of(tabs, (r) => [r.Name, r.Visibility]),
      access: of(access, (r) => [r.SetupEntityType, named[id15(r.SetupEntityId)] ?? null]),
    })]];
  }));
}

// Each name's PermissionSet Ids, as permSetHashes takes them.
const idsByName = (rows, nameOf) => rows.reduce((by, r) => { (by[nameOf(r)] ??= []).push(r.Id ?? r.PermissionSetId); return by; }, {});

// The profile's own set, hashed beside the persona's sets under a key no API name can be, so a profile change is stale too.
const PROFILE = '~profile';
// What a check leaves to the route's end: the form, which only the page shows.
const formNote = (object) => `form of ${object}, read where the route ends`;

// Each saved set (and the profile) whose hash differs now; null in now is one the org no longer has. One saved with no
// hash says nothing.
const setChanges = (persona, now = {}) => [...persona.permissionSets, PROFILE].flatMap((name) => {
  const [was, is] = [persona.permissionSetHashes?.[name], now[name]];
  const what = name === PROFILE ? `persona profile ${persona.profile}` : `persona permission set ${name}`;
  return !was || is === undefined || is === was ? [] : [`${what}${is === null ? ' is gone' : ''}`];
});

// Sorted here too: a hand-edited catalogue need not keep the order.
const personaKey = (p) => p && JSON.stringify([p.profile, [...p.permissionSets].sort()]);

// Who a route was checked as: profile and perm sets, which match across orgs where a username does not.
async function personaOf(s, alias = false, hashMs = HASH_MS) {
  const id = s?.loggedInAs ?? (alias ? s?.tokenUserId : undefined);
  if (!id) return undefined;
  if (id === 'unknown') throw new SfUiError('VIEWER_UNKNOWN', 'a login failed, so nobody can say who this page runs as: sf_start again');
  if (s.persona?.id === id) return s.persona.key; // a persona is read once, not on each route
  const query = queryAs(s);
  const [[user], sets] = await Promise.all([
    query(`SELECT ProfileId, Profile.Name FROM User WHERE Id = '${id}'`),
    query(`SELECT ${SET_FIELDS} FROM PermissionSetAssignment WHERE AssigneeId = '${id}' AND ${PERM_SETS}`),
  ]);
  // The profile's own set is part of the hashes, not the key: a lookup that fails costs the hashes, never the persona.
  const hashes = async (deadline) => {
    const own = await query(`SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND ProfileId = '${user.ProfileId}'`);
    return permSetHashes(s, { ...idsByName(sets, permName), ...(own.length && { [PROFILE]: own.map((r) => r.Id) }) }, deadline);
  };
  // A set hash the org cannot give in time leaves the persona without hashes, never without the persona.
  const permissionSetHashes = await within(hashes(Date.now() + hashMs), hashMs)
    .catch((e) => { if (!(e instanceof SfUiError)) throw e; });
  const key = { profile: user.Profile.Name, permissionSets: sets.map(permName).sort(), ...(permissionSetHashes && { permissionSetHashes }) };
  // A failed name lookup was retried in pageOf, so a gap is kept; a timeout leaves no hashes and is read again.
  if (permissionSetHashes) s.persona = { id, key };
  return key;
}

// The user a replay runs a persona's route as: active, this profile, exactly these perm sets, as a superset is another view.
// query reads every page; the assignments are asked by profile, not by a list of ids that grows with the users.
async function userFor(query, { profile, permissionSets }, self) {
  const name = profile.replace(/[\\']/g, '\\$&');
  const users = await query(`SELECT Id FROM User WHERE IsActive = true AND Profile.Name = '${name}' ORDER BY Username`);
  const sets = users.length ? await query(`SELECT AssigneeId, ${SET_FIELDS} FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.Profile.Name = '${name}' AND ${PERM_SETS}`) : [];
  const key = JSON.stringify([...permissionSets].sort());
  const matches = users.filter((u) => JSON.stringify(sets.filter((r) => r.AssigneeId === u.Id).map(permName).sort()) === key);
  const user = matches.find((u) => u.Id === self) ?? matches[0]; // the alias's user needs no Login As
  if (!user) throw new SfUiError('NO_PERSONA_USER', `no active user with profile ${profile} has exactly these perm sets: ${permissionSets.join(', ') || 'none'}`, { profile, permissionSets });
  return user.Id;
}

// The UI API names a packaged app ns__App, and a standard app (Tooling's prefix standard) as it does a local one, which wins.
const appMeta = (s, app) => {
  const [name, ns] = app.split('__').reverse();
  return metadata(s, 'CustomApplication', name, ns ? ` AND NamespacePrefix = '${ns.replace(/'/g, '')}'` : " AND (NamespacePrefix = null OR NamespacePrefix = 'standard') ORDER BY NamespacePrefix NULLS FIRST");
};

// The app the session opened: session.currentApp waits up to 15 s on a page that has not named its app yet.
async function appPart(s) {
  const app = s.app?.developerName;
  if (!app) return undefined;
  const meta = await appMeta(s, app);
  return meta && { name: app, hash: hash(meta) };
}

// ponytail: only the page the route ended on; note each page it crosses if routes over two objects need it.
async function pagePart(s) {
  const recordId = nav.recordIdOf(s.page.url(), '(?:view|edit)\\b');
  if (!recordId) return undefined;
  let flexiPage = await discover.renderedPage(s);
  if (!flexiPage) {
    // renderedPage's null is also a page not rendered in time, whose form would fall back to the layout: no read at all.
    if (!(await s.page.locator(`${A.recordHome} > *`).count())) return undefined;
    flexiPage = await discover.renderedPage(s); // the host may have come after that wait ran out; now it does not wait
  }
  const [form, meta] = await Promise.all([discover.formModel(s, recordId, { flexiPageApiName: flexiPage }), flexiPage && metadata(s, 'FlexiPage', flexiPage)]);
  return { object: form.objectApiName, ...(meta && { flexiPage, flexiPageHash: hash(meta) }), formHash: hash(form.fields) };
}

// The app and record page the session is on, each whole or left out, or null when neither can be read in time.
// alias: name the alias's user too, as a saved persona needs something to compare with.
async function read(s, limit, alias) { return (await readParts(s, limit, alias)).read; }

// read, and with it the parts that threw: { read, unread }. withPage false skips the page part, for a route that opened none.
async function readParts(s, limit = LIMIT_MS, alias = false, withPage = true) {
  const logged = s?.errors?.length ?? 0;
  let timer;
  const late = new Promise((_, fail) => { timer = setTimeout(() => fail(Object.assign(new Error(`timed out after ${limit}ms`), { code: 'TIMEOUT' })), limit); });
  const [app, page, persona] = await Promise.allSettled([appPart(s), withPage ? pagePart(s) : undefined, personaOf(s, alias)].map((part) => Promise.race([part, late])));
  clearTimeout(timer);
  // A read that fails in the page logs a console error, which must not read as the page's own in sf_page_errors.
  // A slow read is not a failed one: its errors stay.
  // ponytail: by text, so a page's own failed load in that moment goes too; session.js would need to keep each error's URL.
  if (page.status === 'rejected' && page.reason?.code !== 'TIMEOUT' && s?.errors) s.errors = s.errors.filter((e, i) => i < logged || !e.message.startsWith('Failed to load resource'));
  // A part that threw, said beside the result: a red with no stale may be a page nobody read. An unknown viewer says so already.
  const unread = [['app', app], ['page', page], ['persona', persona]].filter(([, r]) => r.status === 'rejected' && r.reason?.code !== 'VIEWER_UNKNOWN').map(([name, r]) => `${name}: ${String(r.reason?.message ?? r.reason).slice(0, 120)}`);
  // A page read with no known viewer is no baseline: it could be anyone's view.
  const viewer = !s?.loggedInAs || persona.value;
  const out = { ...(app.value && { app: app.value }), ...(persona.value && { persona: persona.value }), ...(page.value && viewer && { page: page.value }) };
  return { read: Object.keys(out).length ? out : null, unread };
}

// What differs between a saved read and this one. Only like with like: the same object in the same app, as an app can
// assign its own page, so a red before the route reached its saved page is not put down to that page. A page is also
// per persona: another persona's form differs with no change to the page. An app is not.
function changed(saved, now) {
  const out = [];
  const [was, is] = [saved?.page, now?.page];
  const otherApp = saved?.app && now?.app && saved.app.name !== now.app.name;
  if (saved?.app && now?.app && !otherApp && saved.app.hash !== now.app.hash) out.push(`app ${now.app.name}`);
  const samePersona = personaKey(saved?.persona) === personaKey(now?.persona);
  // Run as anyone else, a persona's route proves nothing about that persona, and an admin can go green on it.
  // A read that could not name its user says nothing: that is not another persona.
  if (saved?.persona && now?.persona && !samePersona) out.push(`persona: saved as ${[saved.persona.profile, ...saved.persona.permissionSets].join(' + ')}`);
  if (samePersona && saved?.persona) out.push(...setChanges(saved.persona, now?.persona?.permissionSetHashes)); // a set can grant more now
  if (was && is && !otherApp && samePersona && was.object === is.object) {
    if (was.flexiPage !== is.flexiPage) out.push(`FlexiPage ${was.flexiPage || 'none'} is now ${is.flexiPage || 'none'}`);
    else if (was.flexiPageHash !== is.flexiPageHash) out.push(`FlexiPage ${is.flexiPage}`);
    if (was.formHash !== is.formHash) out.push(`form of ${is.object}`);
  }
  return out;
}

// A saved route against the org before it runs, by API alone: app, FlexiPage and persona sets, by read()'s hashes. The form
// needs the persona's page, so the route's end checks it; unknown (nothing to compare) is never valid.
async function check(s, saved, limit = LIMIT_MS) {
  if (!saved?.app && !saved?.page && !saved?.persona) return { state: 'unknown', unchecked: ['no validity saved'] };
  const stale = [];
  const unchecked = [];
  const flexiPage = saved.page?.flexiPageHash && saved.page.flexiPage; // a hash with no name is nothing to look up
  const read = await within(Promise.all([saved.app && appMeta(s, saved.app.name), flexiPage && metadata(s, 'FlexiPage', flexiPage), saved.persona && liveSets(s, saved.persona, unchecked)]), limit);
  if (!read) return { state: 'unknown', unchecked: [`the org did not answer the check in ${limit / 1000} s`] };
  const [app, flexi, sets] = read;
  if (saved.app && !app) stale.push(`app ${saved.app.name} is gone`);
  else if (saved.app && hash(app) !== saved.app.hash) stale.push(`app ${saved.app.name}`);
  if (flexiPage && !flexi) stale.push(`FlexiPage ${flexiPage} is gone`);
  else if (flexiPage && hash(flexi) !== saved.page.flexiPageHash) stale.push(`FlexiPage ${flexiPage}`);
  if (saved.page) unchecked.push(formNote(saved.page.object));
  if (sets) stale.push(...setChanges(saved.persona, sets));
  // Valid only for what was compared: a validity with no hash to compare (an old persona, a page with no FlexiPage) is unknown.
  const compared = !!saved.app || !!flexiPage || Object.values(sets || {}).some(Boolean);
  const state = stale.length ? 'stale' : compared ? 'valid' : 'unknown';
  if (state === 'unknown' && !unchecked.length) unchecked.push('nothing saved has a hash to compare'); // a persona with no sets, no app and no page
  return { state, ...(stale.length && { stale }), ...(unchecked.length && { unchecked }) };
}

// What a saved route's validity holds: the shape sf_save_route takes and a catalogue keeps.
const shape = z.object({
  app: z.object({ name: z.string(), hash: z.string() }).strict().optional(),
  page: z.object({ object: z.string(), flexiPage: z.string().optional(), flexiPageHash: z.string().optional(), formHash: z.string() }).strict().optional(),
  persona: z.object({ profile: z.string(), permissionSets: z.array(z.string()), permissionSetHashes: z.record(z.string(), z.string()).optional() }).strict().optional(),
}).strict();

// check as the server and the CLI replay both take it: a validity this version cannot read, or an org error, leaves the
// route to run as unknown, and a bug in the check throws. Through exports, so a test can stand in for check.
async function guarded(s, raw) {
  const saved = shape.safeParse(raw).data;
  if (raw && !saved) return { state: 'unknown', unchecked: ['the saved validity is not a shape this version reads'] };
  return module.exports.check(s, saved).catch((e) => {
    if (!(e instanceof SfUiError)) throw e;
    return { state: 'unknown', unchecked: [`the check failed: ${String(e.message).slice(0, 200)}`] };
  });
}

// Each saved set's hash in the org now, and the profile's, null for one the org no longer has; one saved with no hash is
// listed unchecked.
async function liveSets(s, persona, unchecked) {
  const saved = persona.permissionSetHashes || {};
  const profile = saved[PROFILE] ? await profileSet(s, persona.profile, unchecked) : {};
  if (persona.permissionSetHashes && !saved[PROFILE]) unchecked.push(`persona profile ${persona.profile}, saved with no hash`); // hashed before the profile was
  const wanted = persona.permissionSets.filter((n) => saved[n] || !unchecked.push(`persona permission set ${n}, saved with no hash`));
  if (!wanted.length) return profile;
  // Asked by the name without its namespace, and matched on the whole name: a set or a group, as permName names them.
  const bare = inIds(wanted.map((n) => n.split('__').pop().replace(/'/g, '')));
  const rows = await queryPaged(s)(`SELECT Id, Name, NamespacePrefix, PermissionSetGroup.DeveloperName, PermissionSetGroup.NamespacePrefix FROM PermissionSet WHERE (Name IN (${bare}) OR PermissionSetGroup.DeveloperName IN (${bare})) AND IsOwnedByProfile = false AND Type != 'Session'`);
  const ids = idsByName(rows, (r) => permName({ PermissionSet: r, PermissionSetGroup: r.PermissionSetGroup }));
  // A set and a group of one name cannot be told apart from the name, so the saved hash may be of either alone or of both.
  const held = (n) => (ids[n].length > 1 ? [ids[n], ...ids[n].map((id) => [id])] : [ids[n]]);
  const now = await permSetHashes(s, Object.fromEntries(wanted.filter((n) => ids[n]).flatMap((n) => held(n).map((v, i) => [`${n}\0${i}`, v]))));
  return { ...profile, ...Object.fromEntries(wanted.map((n) => {
    if (!ids[n]) return [n, null];
    const hashes = held(n).map((v, i) => now[`${n}\0${i}`]);
    const is = hashes.find((h) => h && h === saved[n]) ?? hashes[0];
    if (!is) unchecked.push(`persona permission set ${n}, a name lookup failed`); // the org has it; it could not be hashed
    return [n, is];
  })) };
}

// The profile's own set hashed as personaOf hashes it, null for a profile the org no longer has; a failed hash is left
// out and listed unchecked, as a permission set's is.
async function profileSet(s, profile, unchecked) {
  const rows = await queryPaged(s)(`SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND Profile.Name = '${profile.replace(/[\\']/g, '\\$&')}'`);
  if (!rows.length) return { [PROFILE]: null };
  const now = await permSetHashes(s, { [PROFILE]: rows.map((r) => r.Id) });
  if (PROFILE in now) return { [PROFILE]: now[PROFILE] };
  unchecked.push(`persona profile ${profile}, a name lookup failed`);
  return {};
}

module.exports = { read, readParts, changed, check, guarded, shape, hash, personaOf, personaKey, userFor, queryAs, queryPaged, permSetHashes, PROFILE, transient, retryOnce, formNote };
