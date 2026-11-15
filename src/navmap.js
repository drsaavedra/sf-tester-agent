'use strict';

// A navigation map built per run from the org's own metadata through the Tooling API, held in memory and dropped
// with the session: placed components and their tab paths, the components each one renders, and the dialogs a
// button opens. Edges carry how they are known: metadata (the page) or code (a component's template and script).

const validity = require('./validity');
const discover = require('./discover');
const { SfUiError } = require('./errors');

const ROUNDS = 3;
const camel = (kebabName) => kebabName.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const handler = (tag) => (tag.match(/\bonclick=\{(\w+)\}/) || [])[1];

// The body of method name in a component script, by brace matching from its opening line.
function body(js, name) {
  const m = js.match(new RegExp(`\\n\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`));
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < js.length; i += 1) {
    if (js[i] === '{') depth += 1;
    else if (js[i] === '}' && (depth -= 1) === 0) return js.slice(m.index, i + 1);
  }
  return '';
}

// What a component's source says: the components it renders, its buttons, and the dialog each button opens, an
// inline one (role="dialog" under lwc:if) or a LightningModal (an imported c/ component's .open call).
function read(html, js = '') {
  const children = [...new Set([...html.matchAll(/<([a-z][a-z0-9]*)-([a-z0-9-]+)[\s/>]/g)]
    .filter(([, ns]) => ns !== 'lightning').map(([, , name]) => camel(name)))];
  const buttons = [
    ...[...html.matchAll(/<lightning-button\b[^>]*>/g)].map((m) => ({ at: m.index, label: attr(m[0], 'label'), method: handler(m[0]) })),
    ...[...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ at: m.index, label: m[2].trim(), method: handler(m[1]) })),
  ].filter((b) => b.label && b.method);
  const inline = [...html.matchAll(/<template\s+(?:lwc:if|if:true)=\{(\w+)\}>([\s\S]*?)<\/template>/g)]
    .map((m) => ({ flag: m[1], from: m.index, to: m.index + m[0].length, label: (m[2].match(/role="dialog"[^>]*aria-label="([^"]+)"|aria-label="([^"]+)"[^>]*role="dialog"/) || []).slice(1).find(Boolean) }))
    .filter((d) => d.label);
  const imports = [...js.matchAll(/import\s+(\w+)\s+from\s+'c\/(\w+)'/g)].map(([, local, name]) => ({ local, name }));
  const dialogs = [];
  for (const b of buttons) {
    const code = body(js, b.method);
    // A button inside the dialog's own template (its Close) shares the toggle but cannot open it.
    for (const d of inline) if ((b.at < d.from || b.at > d.to) && new RegExp(`this\\.${d.flag}\\b`).test(code)) dialogs.push({ label: d.label, button: b.label, kind: 'inline' });
    for (const i of imports) {
      const open = code.match(new RegExp(`${i.local}\\.open\\(([^)]*)\\)`));
      if (open) dialogs.push({ label: (open[1].match(/label:\s*['"]([^'"]+)['"]/) || [])[1] || i.name, button: b.label, kind: 'modal', component: i.name });
    }
  }
  // One entry per dialog and button: a row of icon buttons opening the same dialog adds nothing.
  const seen = new Set();
  return { children, buttons: buttons.map((b) => b.label), dialogs: dialogs.filter((d) => !seen.has(`${d.label}|${d.button}`) && seen.add(`${d.label}|${d.button}`)) };
}

// Every page, a blip tried once more: a component's source on a later page would otherwise read as a standard component.
const tooling = (s, q) => validity.queryPaged(s, undefined, s.apiVersion, '/tooling/query')(q);
const inList = (names) => names.map((n) => `'${n.replace(/'/g, '')}'`).join(',');

// The map for the entry points given: FlexiPages (their placed components) and components by API name. Each round
// reads the source of the components found in the round before, at most 3, so a nested child is reached.
async function build(s, { flexiPages = [], lwcs = [] } = {}) {
  if (!flexiPages.length && !lwcs.length) throw new SfUiError('BAD_ARGS', 'name at least one FlexiPage or component to map');
  const started = Date.now();
  const map = { builtAt: new Date().toISOString(), pages: {}, components: {}, rounds: [] };
  let next = [...lwcs];
  for (const page of flexiPages) {
    const placed = await discover.placements(s, page);
    if (!placed) throw new SfUiError('NOT_FOUND', `no FlexiPage ${page} in this org`, { flexiPage: page });
    map.pages[page] = placed.filter((p) => !p.componentName.startsWith('flexipage:'))
      .map(({ componentName, tabs, tabsets, visibilityRule }) => ({ component: componentName.split(':')[1], componentName, tabs, tabsets, conditional: !!visibilityRule }));
    next.push(...map.pages[page].map((p) => p.component));
  }
  map.rounds.push({ round: 1, read: flexiPages.length, found: [...new Set(next)].length });
  for (let round = 2; round <= ROUNDS + 1 && next.length; round += 1) {
    const names = [...new Set(next)].filter((n) => !map.components[n]);
    if (!names.length) break;
    const rows = await tooling(s, `SELECT FilePath, Source, LightningComponentBundle.DeveloperName FROM LightningComponentResource WHERE LightningComponentBundle.DeveloperName IN (${inList(names)})`);
    next = [];
    for (const name of names) {
      const file = (ext) => (rows.find((r) => r.LightningComponentBundle.DeveloperName === name && r.FilePath.endsWith(`/${name}.${ext}`)) || {}).Source;
      const html = file('html');
      if (html === undefined) continue; // a standard or Aura component: placed, but no LWC source to read
      map.components[name] = read(html, file('js') || '');
      next.push(...map.components[name].children, ...map.components[name].dialogs.filter((d) => d.component).map((d) => d.component));
    }
    map.rounds.push({ round, read: names.length, found: Object.keys(map.components).length });
  }
  map.seconds = Math.round((Date.now() - started) / 100) / 10;
  return map;
}

// The placed component a component sits in (itself when placed), and the page, from the map.
function placedAncestor(map, name, seen = new Set()) {
  for (const [page, placed] of Object.entries(map.pages)) if (placed.some((p) => p.component === name)) return { page, placed: name };
  seen.add(name);
  const parent = Object.entries(map.components).find(([n, c]) => !seen.has(n) && (c.children.includes(name) || c.dialogs.some((d) => d.component === name)));
  return parent ? placedAncestor(map, parent[0], seen) : null;
}

// Steps for sf_run_route to a component (by API name) or a dialog (by its label), from a record page.
function route(map, { to, recordId = '{{recordId}}' }) {
  const want = to.toLowerCase();
  const owner = Object.entries(map.components).find(([, c]) => c.dialogs.some((d) => d.label.toLowerCase() === want));
  const target = owner ? owner[0] : to;
  const at = placedAncestor(map, target);
  if (!at) throw new SfUiError('NOT_FOUND', `the map has no route to ${to}`, { to, places: [...Object.values(map.pages).flat().map((p) => p.component), ...Object.keys(map.components)], dialogs: Object.values(map.components).flatMap((c) => c.dialogs.map((d) => d.label)) });
  // It opens the record page first, so the route stands alone: a scenario's saved route must open its own page.
  const steps = [{ tool: 'sf_open_record', args: { recordId } }, { tool: 'sf_lwc_read', args: { recordId, lwcApiName: at.placed } }];
  if (target !== at.placed) steps.push({ tool: 'sf_lwc_read', args: { recordId, lwcApiName: target } });
  const via = [{ from: at.page, to: at.placed, known: 'metadata', tabs: map.pages[at.page].find((p) => p.component === at.placed).tabs }];
  if (target !== at.placed) via.push({ from: at.placed, to: target, known: 'code' });
  if (owner) {
    const d = owner[1].dialogs.find((x) => x.label.toLowerCase() === want);
    steps.push({ tool: 'sf_click', args: { recordId, lwcApiName: target, name: d.button } }, { tool: 'sf_wait', args: { inModal: true, text: d.label, timeoutMs: 15000 } });
    via.push({ from: target, to: d.label, by: `button ${d.button}`, kind: d.kind, known: 'code' });
  }
  return { steps, via, needs: recordId === '{{recordId}}' ? ['recordId'] : [] };
}

module.exports = { read, build, route };
