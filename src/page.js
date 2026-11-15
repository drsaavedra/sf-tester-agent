'use strict';

// Which record FlexiPage a user gets, read from the assignment metadata, with no browser.
// Measured on a scratch org (API 66.0, large form factor, View): see resolvePage.
const { unxml } = require('./replay');
const discover = require('./discover');

// The inner text of every <tag> block in an XML string. Small regexes over the blocks, no XML dependency.
const block = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const field = (b, tag) => { const m = b.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? unxml(m[1]) : null; };

// The overrides in an app or object file: { content, object, profile, recordType, formFactor } for each View of a FlexiPage.
function overrides(src, tag) {
  // src is the file's XML, or the Tooling Metadata JSON of the same app or object.
  const rows = typeof src === 'string'
    ? block(src, tag).map((b) => ({ action: field(b, 'actionName'), type: field(b, 'type'), content: field(b, 'content'), object: field(b, 'pageOrSobjectType'), profile: field(b, 'profile'), recordType: field(b, 'recordType'), formFactor: field(b, 'formFactor') }))
    : (src?.[tag] || []).map((o) => ({ action: o.actionName ?? null, type: o.type ?? null, content: o.content ?? null, object: o.pageOrSobjectType ?? null, profile: o.profile ?? null, recordType: o.recordType ?? null, formFactor: o.formFactor ?? null }));
  return rows.filter((o) => o.action === 'View' && /^flexipage$/i.test(o.type || ''));
}

// A name without the project's own ns__ prefix, which its files do not carry. Any other name stays as it is.
// An object or field name (object: true) is never cut down to a bare suffix such as Share or c, in any case.
const SUFFIX = /^(c|r|e|mdt|x|b|share|history|feed|kav)$/i;
const OBJ = { object: true };
const ownName = (namespace, full, { object = false } = {}) => { const i = full.indexOf('__'); return namespace && i > 0 && full.slice(0, i).toLowerCase() === namespace.toLowerCase() && !(object && SUFFIX.test(full.slice(i + 2))) ? full.slice(i + 2) : full; };

// A profile's metadata name: the label for a custom profile, a short name for a standard one.
const STANDARD = { 'System Administrator': 'Admin', 'Standard User': 'Standard', 'Standard Platform User': 'StandardAul', 'Read Only': 'ReadOnly', 'Marketing User': 'MarketingProfile', 'Contract Manager': 'ContractManager', 'Solution Manager': 'SolutionManager' };
const profileName = (label) => STANDARD[label] ?? label;

// The page for an app, object, profile and record type: profile row, then app default, then object default (README has the details).
// A profile name no row spells falls through to the app default. page null with level 'none' is Lightning's own page.
// API names are case-insensitive, and object may list the names a row can spell (a namespaced org prefixes them).
function resolvePage({ app = { actionOverrides: [], profileActionOverrides: [] }, objectOverrides = [] }, { object, profile, recordType = null, formFactor = 'Large', namespace = null }) {
  const eq = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
  const fits = (o) => [].concat(object).some((n) => eq(o.object && ownName(namespace, o.object, OBJ), ownName(namespace, n, OBJ))) && (o.formFactor ?? formFactor) === formFactor;
  const sameType = (o) => (o.recordType ? recordType != null && eq(ownName(namespace, o.recordType.split('.').pop()), ownName(namespace, recordType)) : recordType == null);
  const rows = [
    ['appProfile', app.profileActionOverrides.filter((o) => fits(o) && eq(o.profile, profile) && sameType(o))],
    ['app', app.actionOverrides.filter(fits)],
    ['org', objectOverrides.filter((o) => (o.formFactor ?? formFactor) === formFactor)],
  ];
  for (const [level, hits] of rows) if (hits.length) return { page: hits[0].content, level };
  return { page: null, level: 'none' };
}

// Scores a resolver against the rendered page for cases { app, object, recordId, as: 'admin' | a user id }; admin goes first.
// checked is the count scored, matched the count where resolve(case) and the page agree.
async function calibrate(s, session, cases, resolve) {
  const rows = [];
  for (const c of [...cases].sort((a, b) => (a.as === 'admin' ? 0 : 1) - (b.as === 'admin' ? 0 : 1))) {
    if (c.as !== 'admin' && s.loggedInAs?.slice(0, 15) !== c.as.slice(0, 15)) await session.loginAs(s, c.as);
    await session.openApp(s, c.app);
    await s.page.goto(`${s.origin}/lightning/r/${c.object}/${c.recordId}/view`);
    await s.page.getByRole('main').waitFor();
    const rendered = await discover.renderedPage(s);
    const resolved = resolve(c);
    rows.push({ ...c, resolved, rendered, ok: resolved === rendered });
  }
  return { checked: rows.length, matched: rows.filter((r) => r.ok).length, rows };
}

// Every component and field on a FlexiPage, from its XML or Tooling Metadata: { region, facet, componentName | field,
// identifier, props, rule, actions }; rule is { booleanFilter, criteria } or null, actions are a highlights panel's { name, rule }.
const ruleOf = (r) => (r ? { booleanFilter: r.booleanFilter ?? null, criteria: (r.criteria || []).map((k) => ({ leftValue: k.leftValue, operator: k.operator, rightValue: k.rightValue ?? '' })) } : null);
const ruleXml = (b) => { const vr = block(b, 'visibilityRule')[0]; return vr ? { booleanFilter: field(vr, 'booleanFilter'), criteria: block(vr, 'criteria').map((k) => ({ leftValue: field(k, 'leftValue'), operator: field(k, 'operator'), rightValue: field(k, 'rightValue') ?? '' })) } : null; };
function components(src) {
  if (typeof src !== 'string') {
    return src.flexiPageRegions.flatMap((r) => (r.itemInstances || []).flatMap((i) => {
      const c = i.componentInstance;
      if (c) {
        const props = c.componentInstanceProperties || [];
        return [{ region: r.name, facet: r.type === 'Facet', componentName: c.componentName, identifier: c.identifier, props: Object.fromEntries(props.map((p) => [p.name, p.value])), rule: ruleOf(c.visibilityRule),
          actions: (props.find((p) => p.name === 'actionNames')?.valueList?.valueListItems || []).map((a) => ({ name: a.value, rule: ruleOf(a.visibilityRule) })) }];
      }
      const f = i.fieldInstance;
      return f ? [{ region: r.name, facet: r.type === 'Facet', field: f.fieldItem.replace(/^Record\./, ''), identifier: f.identifier, props: {}, rule: ruleOf(f.visibilityRule) }] : [];
    }));
  }
  return block(src, 'flexiPageRegions').flatMap((rb) => block(rb, 'itemInstances').flatMap((ib) => {
    // The region's own name follows its items, so the items go first: their property names are <name> too.
    const own = rb.replace(/<itemInstances>[\s\S]*?<\/itemInstances>/g, '');
    const [region, facet] = [field(own, 'name'), field(own, 'type') === 'Facet'];
    const fi = block(ib, 'fieldInstance')[0];
    if (fi) return [{ region, facet, field: unxml(field(fi, 'fieldItem') ?? '').replace(/^Record\./, ''), identifier: field(fi, 'identifier'), props: {}, rule: ruleXml(fi) }];
    return block(ib, 'componentInstance').map((cb) => ({
      region, facet, componentName: field(cb, 'componentName'), identifier: field(cb, 'identifier'),
      props: Object.fromEntries(block(cb, 'componentInstanceProperties').map((pb) => [field(pb, 'name'), field(pb, 'value')])),
      rule: ruleXml(cb.replace(/<componentInstanceProperties>[\s\S]*?<\/componentInstanceProperties>/g, '')),
      actions: block(cb, 'valueListItems').map((ab) => ({ name: field(ab, 'value'), rule: ruleXml(ab) })),
    }));
  }));
}

// The rules that decide whether one component shows: its own and each container's up the page (a tab holds a region by name).
// A container is the component with a property naming the region, when the region is a Facet: only a component holds
// a Facet (a tab's body, a tabset's tabs, an accordion's sections); the template holds every other region.
function rulesFor(all, target) {
  const rules = [];
  const seen = new Set();
  for (let c = target; c; ) {
    if (c.rule) rules.push({ by: c.identifier || c.componentName, rule: c.rule, own: c === target, kind: c.componentName });
    if (seen.has(c.region)) break;
    seen.add(c.region);
    c = c.facet && all.find((x) => x !== c && Object.values(x.props).includes(c.region));
  }
  return rules;
}

module.exports = { components, rulesFor, calibrate, block, field, overrides, profileName, resolvePage, ownName };
