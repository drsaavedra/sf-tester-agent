'use strict';

// cascade: what a changed LWC or Apex class could set off, read from branch source (no org): LWC -> its Apex -> the objects
// it writes (and one level of called classes) -> their active rules, triggers and flows. A gap is a note, not a verdict.
const fs = require('node:fs');
const path = require('node:path');
const { unxml } = require('./replay');

// Comments and string literals out in one left-to-right pass, so a // inside a string is not a comment.
const stripCode = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'/g, (m) => (m[0] === "'" ? "''" : ' '));
const SKIP = new Set(['insert', 'update', 'upsert', 'delete', 'undelete', 'merge', 'return', 'new', 'else', 'throw', 'case', 'when', 'in', 'is']);
// (?<!FOR\s+): `FOR UPDATE` in a query is a lock, not a DML.
const DML = /\b(?<!\bFOR\s+)(insert|update|upsert|delete|undelete|merge)\s+([^;]+);|\bDatabase\s*\.\s*(?:insert|update|upsert|delete|undelete|merge)(?:Async|Immediate)?\s*\(\s*([^;]+)/gi;
// The object an inline query reads: the first FROM once every parenthesised subquery is blanked.
const outerFrom = (q) => { let s = q; for (let p; p !== s;) { p = s; s = s.replace(/\([^()]*\)/g, ' '); } return (s.match(/\bFROM\s+(\w+)/i) || [])[1]; };
// The last type name in a declared type: List<X>, Map<Id, X> and X[] all give X.
const inner = (t) => (t.match(/[\w.]+/g) || []).pop();

// A type no DML can target: a reused variable name that was also one of these is not a write to it.
const PRIMITIVE = /^(?:string|id|integer|long|decimal|double|boolean|date|datetime|time|blob|void|exception)$/i;
// What one class's source writes and reads. ponytail: regex, not a parser; dynamic Apex and DML it cannot type come back
// as limits, and a write two calls away is named as one by cascade.
function scan(src) {
  // The access-mode words come out of DML, so `insert as user a` reads as `insert a`.
  const code = stripCode(src).replace(/\b(insert|update|upsert|delete|undelete|merge)\s+as\s+(?:user|system)\b/gi, '$1');
  const types = new Map();
  const colls = new Set();
  for (const m of code.matchAll(/\b([A-Za-z_][\w.]*(?:\s*<[^<>;(){}]*(?:<[^<>;(){}]*>[^<>;(){}]*)*>)?(?:\[\])?)\s+(\w+)\s*(?==|;|,|\)|:)/g)) {
    if (SKIP.has(m[1])) continue;
    (types.get(m[2]) ?? types.set(m[2], new Set()).get(m[2])).add(inner(m[1]));
    if (/^(?:list|set|map)\s*</i.test(m[1]) || m[1].endsWith('[]')) colls.add(m[2]);
  }
  const writes = new Set();
  const reads = new Set();
  const limits = [];
  // Every type a DML target could have. ponytail: a name keeps every type it has anywhere in the class, so a name reused
  // in two methods over-reports a write rather than dropping one; scoping it needs brace matching.
  const typeOf = (expr) => {
    const e = expr.trim().replace(/^\(\s*/, '');
    if (e.startsWith('[')) return [outerFrom(e)].filter(Boolean);
    const n = e.match(/^new\s+([\w.]+)\s*(<[^>]*>)?/);
    if (n) return [n[2] ? inner(n[2]) : n[1]];
    // A member access (req.items) is not the root's type; a method call on a collection (m.get(id), cs.values()) is.
    const v = e.match(/^(\w+)(\s*\.\s*\w+(\s*\()?)?/);
    return v && types.has(v[1]) && (!v[2] || (v[3] && colls.has(v[1]))) ? [...types.get(v[1])] : [];
  };
  for (const m of code.matchAll(DML)) {
    const ts = typeOf(m[2] ?? m[3]).filter((t) => !PRIMITIVE.test(t));
    const what = (m[0].match(/^\w+(?:\s*\.\s*\w+)?/) || [''])[0].replace(/\s+/g, '');
    if (!ts.length) limits.push(`${what} on a variable the reader cannot type`);
    for (const t of ts) { if (/^s?object$/i.test(t)) limits.push(`${what} on ${t}`); else writes.add(t); }
  }
  for (const m of code.matchAll(/\[\s*SELECT\b[^\]]*\]/gi)) { const f = outerFrom(m[0]); if (f) reads.add(f); }
  if (/\bDatabase\s*\.\s*(query|countQuery|getQueryLocator)\b|\bnewSObject\s*\(|\bSchema\s*\.\s*getGlobalDescribe\b/i.test(code)) limits.push('dynamic Apex');
  const calls = new Set([...code.matchAll(/\b([A-Z]\w*)\s*\.\s*\w+\s*\(|\bnew\s+([A-Z]\w*)\s*\(/g)].map((m) => m[1] ?? m[2]));
  return { writes, reads, limits, calls, test: /@IsTest\b/i.test(code) };
}

// A package directory's metadata roots: main/default, itself, then each <folder>/main/default one level down (force-app/sales/main/default).
const rootsOf = (proj, d) => {
  const at = path.join(proj.root, d);
  const subs = fs.existsSync(at) && fs.statSync(at).isDirectory() ? fs.readdirSync(at, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'main' && fs.existsSync(path.join(at, e.name, 'main', 'default'))).map((e) => `${d}/${e.name}/main/default`) : [];
  return [`${d}/main/default`, d, ...subs];
};
// Every existing folder of this name under the package directories' metadata roots.
const folders = (proj, name) => proj.dirs.flatMap((d) => rootsOf(proj, d)).map((p) => path.join(proj.root, p, name)).filter((p) => fs.existsSync(p));
const files = (proj, name, ext) => folders(proj, name).flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => path.join(d, f)));
const sortBy = (a) => a.sort((x, y) => x.localeCompare(y));
// The flow's own <label>: the one at the indent of a root child (status, apiVersion, processType), whatever that indent is.
const rootLabel = (xml) => { const i = (xml.match(/^([ \t]+)<(?:apiVersion|processType|status)>/m) || [])[1]; return i && (xml.match(new RegExp(`^${i}<label>([^<]*)</label>`, 'm')) || [])[1]; };
// Every active trigger and record-triggered flow on the branch, read once: each as its object (lower case), item key and flow label.
function onSaveScan(proj) {
  const triggers = [];
  for (const f of files(proj, 'triggers', '.trigger')) {
    const obj = (stripCode(fs.readFileSync(f, 'utf8')).match(/\btrigger\s+\w+\s+on\s+(\w+)/i) || [])[1];
    const meta = `${f}-meta.xml`;
    if (obj && (!fs.existsSync(meta) || /<status>Active<\/status>/.test(fs.readFileSync(meta, 'utf8')))) triggers.push({ obj: obj.toLowerCase(), key: `triggers/${path.basename(f, '.trigger')}` });
  }
  const flows = [];
  for (const f of files(proj, 'flows', '.flow-meta.xml')) {
    const xml = fs.readFileSync(f, 'utf8');
    const start = (xml.match(/<start>[\s\S]*?<\/start>/) || [''])[0];
    const obj = (start.match(/<object>([^<]*)<\/object>/) || [])[1];
    const name = path.basename(f, '.flow-meta.xml');
    if (obj && /<status>Active<\/status>/.test(xml) && /<triggerType>Record/.test(start)) flows.push({ obj: obj.toLowerCase(), key: `flows/${name}`, label: unxml(rootLabel(xml) ?? name) });
  }
  return { triggers, flows };
}

// An object's active validation rules, triggers and record-triggered flows on the branch, as item keys; resolveCI finds its folder
// in any case, labels gets each flow's label, and scan is onSaveScan's result, read once per map.
function onSave(proj, obj, resolveCI, labels, scan = onSaveScan(proj)) {
  const items = [];
  for (const d of proj.dirs) {
    for (const dir of resolveCI({ ...proj, dirs: [d] }, `objects/${obj}/validationRules`, true)) {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.validationRule-meta.xml'))) {
        if (/<active>true<\/active>/.test(fs.readFileSync(path.join(dir, f), 'utf8'))) items.push(`objects/${path.basename(path.dirname(dir))}/validationRules/${f.replace('.validationRule-meta.xml', '')}`);
      }
    }
  }
  const o = obj.toLowerCase();
  items.push(...scan.triggers.filter((t) => t.obj === o).map((t) => t.key));
  for (const f of scan.flows.filter((x) => x.obj === o)) { items.push(f.key); labels?.set(f.key, f.label); }
  return sortBy(items);
}

// The chain lines for the changed bundles and classes in starts (item keys); h is verify.js's apexImports, classFile and
// resolveCI, and coveredBy(key) gives the ids of the checks covering a key.
function cascade(proj, starts, h, coveredBy) {
  const ns = proj.namespace;
  // A class or object name in the project's own namespace is held without its prefix on disk.
  const own = (n) => (ns && n.toLowerCase().startsWith(`${ns.toLowerCase()}__`) ? n.slice(ns.length + 2) : n);
  const lines = [];
  const limits = new Set();
  const objects = new Set();
  const reached = new Set();
  const gaps = new Set();
  const seen = new Map();
  const labels = new Map();
  let scanned;
  // The links the lines say, as MetadataComponentDependency would name them, for the cross-check.
  const edges = [];
  const noSuffix = (n) => own(n).replace(/__c$/i, '');
  // The type the dependency table gives an object: a standard one is a StandardEntity, except User, which has its own.
  const typeOfObject = (n) => (own(n).includes('__') ? 'CustomObject' : /^user$/i.test(n) ? 'User' : 'StandardEntity');
  // Each class name is looked up once per map: classFile walks every package's classes tree.
  const found = new Map();
  const file = (name) => { const n = own(name); if (!found.has(n)) found.set(n, h.classFile(proj, n, '.cls')); return found.get(n); };
  const read = (name) => {
    if (!seen.has(name)) { const f = file(name); seen.set(name, f && scan(fs.readFileSync(f, 'utf8'))); }
    return seen.get(name);
  };
  const emit = (via, writes) => {
    for (const w of sortBy([...writes])) {
      const here = `${via} > ${w}`;
      lines.push(`cascade ${here}`);
      edges.push(['ApexClass', own(via.split(' > ').pop().split('/').pop()), typeOfObject(w), noSuffix(w)]);
      // A name with a prefix other than the project's own is managed: its automation is not in this source.
      if (/^\w+?__\w+__\w+$/.test(w) && !w.toLowerCase().startsWith(`${(ns ?? '').toLowerCase()}__`)) { limits.add(`${w} is in a managed package, so its automation is not mapped`); continue; }
      objects.add(own(w));
      for (const k of onSave(proj, own(w), h.resolveCI, labels, (scanned ??= onSaveScan(proj)))) {
        reached.add(k);
        const by = coveredBy(k);
        if (!by.length) gaps.add(k);
        lines.push(`cascade ${here} > ${k}: ${by.length ? `covered by ${by.join(', ')}` : 'GAP'}`);
        const [t, n] = k.startsWith('flows/') ? ['Flow', labels.get(k)] : k.startsWith('triggers/') ? ['ApexTrigger', k.slice(9)] : ['ValidationRule', k.split('/').pop()];
        edges.push([t, n, t === 'ValidationRule' ? 'CustomField' : typeOfObject(w), noSuffix(w), k.slice(k.lastIndexOf('/') + 1)]);
      }
    }
  };
  for (const start of starts) {
    const classes = start.startsWith('lwc/') ? h.apexImports(proj, start) : [start.slice(start.lastIndexOf('/') + 1)];
    for (const c of classes) {
      const via = start.startsWith('lwc/') ? `${start} > classes/${c}` : start;
      if (start.startsWith('lwc/')) edges.push(['LightningComponentBundle', start.slice(4), 'ApexClass', own(c)]);
      const r = read(c);
      if (!r) { limits.add(`classes/${c} is not in this project (managed or missing), so its writes are not mapped`); continue; }
      if (r.test) continue;
      r.limits.forEach((l) => limits.add(`classes/${c}: ${l}`));
      emit(via, r.writes);
      // One level of calls: a helper's own writes, never its calls.
      for (const callee of sortBy([...r.calls])) {
        const cr = own(callee).toLowerCase() !== own(c).toLowerCase() && read(callee);
        if (!cr || cr.test) continue;
        cr.limits.forEach((l) => limits.add(`classes/${callee}: ${l}`));
        // A helper's own calls to a project class the start does not call itself stay unfollowed, and the note says so.
        for (const x of cr.calls) if (![c, ...r.calls].some((n) => own(n).toLowerCase() === own(x).toLowerCase()) && file(x)) limits.add(`classes/${callee} calls classes/${x}, not followed`);
        edges.push(['ApexClass', own(c), 'ApexClass', own(callee)]);
        emit(`${via} > classes/${callee}`, cr.writes);
      }
    }
  }
  const out = [...new Set(lines)];
  if (out.length) out.push(`cascade: ${reached.size} reachable, ${gaps.size} gaps (a gap is a note, not a verdict)`);
  for (const l of sortBy([...limits])) out.push(`NOTE cascade limit: ${l}`);
  return { lines: out, objects: [...objects], gaps: [...gaps], edges };
}

// The dependency rows of the components in the edges. The table holds 2,000 rows at most and refuses a WHERE on a name, so
// each component's Id is read first (a few small lookups) and the table is asked for those components only.
const MCD_SELECT = 'SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency';
const LOOKUP = [['ApexClass', 'ApexClass', 'Name', ''], ['ApexTrigger', 'ApexTrigger', 'Name', ''], ['Flow', 'Flow', 'Definition.DeveloperName', " AND Status = 'Active'"],
  ['ValidationRule', 'ValidationRule', 'ValidationName', ''], ['LightningComponentBundle', 'LightningComponentBundle', 'DeveloperName', '']];
async function mcdRows(q, edges) {
  const list = (a) => a.map((x) => `'${String(x).replace(/['\\]/g, '')}'`).join(', ');
  const ids = [];
  for (const [type, sobject, field, more] of LOOKUP) {
    const names = [...new Set(edges.filter((e) => e[0] === type).map((e) => e[4] ?? e[1]))];
    for (let i = 0; i < names.length; i += 100) ids.push(...(await q(`SELECT Id FROM ${sobject} WHERE ${field} IN (${list(names.slice(i, i + 100))})${more}`)).map((r) => r.Id));
  }
  const rows = [];
  let cut = false;
  for (let i = 0; i < ids.length; i += 100) {
    const got = await q(`${MCD_SELECT} WHERE MetadataComponentId IN (${list(ids.slice(i, i + 100))})`);
    cut ||= got.length >= 2000;
    rows.push(...got);
  }
  return { rows, cut };
}

// Where MetadataComponentDependency rows (Tooling, Beta, 2,000 rows) and the source read disagree; it never changes the map.
// cut is mcdRows': one of its queries came back at the 2,000-row limit.
// A flow is named by its label there, so names compare without case, spaces or underscores.
const flat = (n) => n.replace(/[\s_]/g, '').toLowerCase();
function crossCheck(edges, rows, cut = false) {
  // ponytail: a rule is tied to a CustomField by its bare name, never to its object, so any field agrees; naming the object's fields needs the branch's field files.
  const same = (e, r) => e[0] === r.MetadataComponentType && flat(e[1]) === flat(r.MetadataComponentName) && e[2] === r.RefMetadataComponentType && (e[0] === 'ValidationRule' || flat(e[3]) === flat(r.RefMetadataComponentName));
  const mine = [...new Map(edges.map((e) => [e.join('|'), e])).values()];
  const out = [`NOTE cascade MetadataComponentDependency: ${mine.filter((e) => rows.some((r) => same(e, r))).length} of ${mine.length} links agree${cut ? ' (2,000 rows is its limit, so it may be cut)' : ''}`];
  // A table cut at 2,000 rows may lack the row, so its absences are not said.
  for (const e of cut ? [] : mine) if (!rows.some((r) => same(e, r))) out.push(`NOTE cascade MetadataComponentDependency has no ${e[0]} ${e[1]} -> ${e[2]}${e[0] === 'ValidationRule' ? ' of' : ''} ${e[3]}`);
  const from = new Set(mine.filter((e) => e[0] === 'ApexClass' || e[0] === 'LightningComponentBundle').map((e) => `${e[0]}|${flat(e[1])}`));
  for (const r of rows) {
    if (from.has(`${r.MetadataComponentType}|${flat(r.MetadataComponentName)}`) && ['ApexClass', 'CustomObject', 'StandardEntity', 'User'].includes(r.RefMetadataComponentType) && !mine.some((e) => same(e, r))) {
      out.push(`NOTE cascade MetadataComponentDependency only: ${r.MetadataComponentType} ${r.MetadataComponentName} -> ${r.RefMetadataComponentType} ${r.RefMetadataComponentName} (a read, or a link the source reader missed)`);
    }
  }
  return out;
}

module.exports = { cascade, scan, onSave, crossCheck, mcdRows, stripCode, rootsOf };
