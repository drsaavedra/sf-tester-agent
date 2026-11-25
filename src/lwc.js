'use strict';

// Reach a custom component from FlexiPage metadata instead of looking: which page rendered, which tabs hold
// the component, then its live host. ponytail: the host wait is untested; no case here rendered late enough.
const { SfUiError } = require('./errors');
const nav = require('./nav');
const discover = require('./discover');
const api = require('./api');
const { requireEnglish } = require('./session');

// The live host and how it was found: placed on the FlexiPage, or rendered inside another component (foundBy).
async function locate(s, recordId, lwcApiName, { flexiPageApiName, timeout = 30_000 } = {}) {
  // Not an id ('.'), it would match any record URL in showsRecord and skip the open.
  if (!nav.isId(recordId)) throw new SfUiError('BAD_ARGS', `${lwcApiName} needs the recordId of the page it is on${recordId ? `; ${recordId} is not a record id` : ''}`, { lwcApiName, recordId });
  await onRecord(s, recordId);
  const page = flexiPageApiName || (await discover.renderedPage(s));
  if (!page) throw new SfUiError('NOT_ON_PAGE', `no FlexiPage was detected on ${s.page.url()}, so ${lwcApiName} cannot be placed`, { reason: 'noFlexiPage', url: s.page.url(), lwcApiName });
  const place = await discover.lwcOnPage(s, page, lwcApiName);
  if (!place) return nested(s, page, lwcApiName, { timeout: Math.min(timeout, 10_000) }); // a mistyped name fails in 10 s
  await openTabs(s, place, { timeout });
  const host = s.page.locator(place.tag).locator('visible=true').first();
  // Ask Tooling only for a host that has not painted in 2 s: most paint by then, and a Tooling error must not fail a render.
  const shown = await host.waitFor({ state: 'visible', timeout: Math.min(timeout, 2_000) }).then(() => true, (e) => { if (e.name !== 'TimeoutError') throw e; return false; });
  if (!shown && (await isAura(s, place.componentName))) {
    throw new SfUiError('BAD_ARGS', `${lwcApiName} is an Aura component: it renders no host to scope by its name, so aim at it without lwcApiName (role and name on the page)`, { reason: 'auraComponent', page, place });
  }
  await host.waitFor({ state: 'visible', timeout }).catch((e) => {
    if (e.name !== 'TimeoutError') throw e; // a closed page is not a hidden component
    throw new SfUiError('NOT_ON_PAGE', `${lwcApiName} is on ${page} but did not render${ruleHint(place.visibilityRule)}`, { ...why('notRendered', place.visibilityRule), page, place });
  });
  return { host, foundBy: { via: 'flexiPage', page, tabs: place.tabs } };
}

// An Aura bundle renders no tag of its name (and no class without CSS of its own), so a wait for its host never ends.
// c is the org's own: no namespace, or its own one; an installed package's bundle of the same name is not it.
const OWN = " AND (NamespacePrefix = null OR ManageableState NOT IN ('installed', 'installedEditable', 'deprecated', 'deprecatedEditable'))";
async function isAura(s, componentName) {
  const [ns, name] = componentName.split(':').map((v) => v.replace(/'/g, ''));
  const q = `SELECT Id FROM AuraDefinitionBundle WHERE DeveloperName = '${name}'${ns === 'c' ? OWN : ` AND NamespacePrefix = '${ns}'`} LIMIT 1`;
  return (await api.call(s, `/tooling/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records.length > 0;
}

// Open recordId unless the page shows it: reopening reloads it and loses what earlier clicks opened there (an expanded panel, a row's editor).
async function onRecord(s, recordId) {
  if (!nav.showsRecord(s.page.url(), recordId)) await nav.openRecord(s, recordId);
  else await requireEnglish(s); // the open page skipped openRecord's check, and a refused open stays on the record
}

const scope = async (...args) => (await locate(...args)).host;

// The host tag of a component in any namespace: c-file-scan, or acme-file-scan in a packaged org; never a platform one
// (lightning-card for card). ponytail: a fixed list of platform namespaces, the last eight seen on a scratch org's pages;
// a customer package with one of these namespaces reads as platform, so its components are not found.
const PLATFORM = '(?:lightning|force|ui|aura|one|records|flexipage|forcegenerated|runtime_[a-z0-9_]*|lst|laf|record_flexipage|navex|sales_yukon|sales_pathways|sentos_common|devops_center)';
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagPattern = (lwcApiName) => `^(?!${PLATFORM}-)[a-z0-9_]+-${escRe(discover.kebab(lwcApiName))}$`;

// A component rendered by another component is not on the FlexiPage: walk the shadow roots for a showing host
// of any namespace. ponytail: tabs are not opened for it; open its parent first (sf_lwc_read) if it sits in one.
async function nested(s, page, lwcApiName, { timeout }) {
  const found = await s.page.waitForFunction((pattern) => {
    const hosts = (n) => { const out = []; for (let r = n.getRootNode(); r.host && out.length < 3; r = r.host.getRootNode()) out.push(r.host.localName); return out; };
    const match = new RegExp(pattern);
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (match.test(el.localName) && el.getClientRects().length) return { tag: el.localName, inside: hosts(el) };
        const hit = el.shadowRoot && walk(el.shadowRoot);
        if (hit) return hit;
      }
      return null;
    };
    return walk(document);
  }, tagPattern(lwcApiName), { timeout, polling: 500 }).then((h) => h.jsonValue(), () => null);
  if (!found) throw new SfUiError('NOT_ON_PAGE', `${lwcApiName} is not placed on ${page} and no component showing now renders it; a parent on a closed tab is not searched, so open the parent first (sf_lwc_read it)`, { reason: 'notOnFlexiPage', page, lwcApiName });
  return { host: s.page.locator(found.tag).locator('visible=true').first(), foundBy: { via: 'shadowRoots', page, ...found } };
}

// A FlexiPage visibility rule as Tooling metadata gives it ({ criteria, booleanFilter }), in one readable line;
// a boolean filter names criteria by number, so they are numbered then.
const ruleText = ({ criteria, booleanFilter } = {}) => [].concat(criteria ?? [])
  .map((c, i) => (booleanFilter ? `${i + 1}: ` : '') + [c.leftValue, c.operator, c.rightValue === '' ? '""' : c.rightValue].filter((v) => v != null).join(' '))
  .join(booleanFilter ? ', ' : ' AND ') + (booleanFilter ? ` (${booleanFilter})` : '');
// reason is what was seen; a rule with text is a suspected cause, not a proved one.
const why = (reason, rule) => ({ reason, ...((rule && ruleText(rule)) && { likelyCause: 'visibilityRule' }) });
const ruleHint = (rule) => { const text = rule && ruleText(rule); return text ? `; its visibility rule may hide it: ${text}` : ''; };

// Opens the tab path lwcOnPage gives (outer first). Each tab is looked up in its own tabset's first tablist:
// another tabset may carry a tab with the same title.
async function openTabs(s, { tabs, tabsets = [], visibilityRule }, { timeout = 30_000 } = {}) {
  for (const [i, title] of tabs.entries()) {
    const wrapper = tabsets[i] && s.page.locator(`[data-component-id="${tabsets[i]}"]`);
    const rendered = wrapper && (await wrapper.first().waitFor({ state: 'attached', timeout: 5_000 }).then(() => true, () => false));
    const tabset = rendered ? wrapper.first().getByRole('tablist').first() : s.page; // never rendered: page-wide, as before
    const tab = tabset.getByRole('tab', { name: title, exact: true });
    // Pressing a tab already selected takes focus and closes what the component had open (a menu, a dropdown).
    // A tab Lightning never rendered is NOT_ON_PAGE, its component's rule named as a likely cause, not a proved one.
    const selected = await tab.getAttribute('aria-selected', { timeout }).catch((e) => {
      if (e.name !== 'TimeoutError') throw e;
      throw new SfUiError('NOT_ON_PAGE', `tab "${title}" is not on the page${ruleHint(visibilityRule)}`, { ...why('tabNotRendered', visibilityRule), tab: title, tabs, visibilityRule });
    });
    if (selected === 'true') continue;
    await tab.click({ timeout });
    await s.page.waitForFunction((el) => el.getAttribute('aria-selected') === 'true', await tab.elementHandle(), { timeout });
  }
}

module.exports = { scope, locate, onRecord, openTabs, tagPattern, nested, why, escRe };
