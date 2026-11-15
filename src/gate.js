'use strict';

// Which custom permissions an LWC bundle gates its markup on. A getter or field that is exactly the import (or its negation)
// is plain; any other mention of the import is mixed or elsewhere, and the permission is NOT_STATIC.
const IMPORT = /import\s+(\w+)\s+from\s+['"]@salesforce\/customPermission\/([\w.]+)['"]/g;
const DIRECTIVE = /(lwc:if|lwc:elseif|if:true|if:false)\s*=\s*\{\s*([^}]*?)\s*\}|(lwc:else)(?![\w:-])/;
const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

// The template's blocks in order, each with the conditions it shows under, { directive, conds: [{ directive, expr, neg }] }.
// An lwc:elseif or lwc:else reads the negated conditions of the siblings before it in its chain, so the chain reads as one.
function blocks(html) {
  const out = [];
  // One entry per open element depth: the conditions of the lwc:if chain its last child continues, or null.
  const chains = [null];
  // Per depth: the conditions of the blocks around it, carried in so a nested lwc:else reads as a flat chain.
  const outer = [[]];
  for (const [, close, tag, attrs, self] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    if (close) { if (chains.length > 1) { chains.pop(); outer.pop(); } continue; }
    const m = DIRECTIVE.exec(attrs);
    const d = m && (m[1] ?? m[3]);
    const own = m?.[1] && { directive: d, expr: m[2], neg: m[2].startsWith('!') || d === 'if:false' };
    const prev = (d === 'lwc:elseif' || d === 'lwc:else' ? chains.at(-1) : null) ?? [];
    const before = [...outer.at(-1), ...prev.map((c) => ({ ...c, neg: !c.neg, before: true }))];
    if (d) out.push({ directive: d, conds: [...before, ...(own ? [own] : [])] });
    chains[chains.length - 1] = d === 'lwc:if' || d === 'lwc:elseif' ? [...prev, own] : null;
    // A nested block also reads the condition of the block around it; a value that reads no permission is left out.
    // under: the block a carried condition came from, named in a NOT_STATIC reason ("the lwc:else of lwc:if={x}" for an earlier sibling's).
    const under = (c) => c.under ?? (c.before ? `the ${d} of ${c.directive}={${c.expr}}` : `${d}={${c.expr}}`);
    if (!self && !VOID.test(tag)) { chains.push(null); outer.push([...before, ...(own ? [own] : [])].map((c) => ({ ...c, before: true, outer: true, under: under(c) }))); }
  }
  return out;
}

// Properties of the class as { name, body } where body is the expression a getter returns or a field is set to.
function properties(js) {
  const out = [];
  for (const m of js.matchAll(/\bget\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+([^;]+?);?\s*\}/g)) out.push({ name: m[1], body: m[2].trim() });
  for (const m of js.matchAll(/^\s*(\w+)\s*=\s*([^;\n]+);/gm)) out.push({ name: m[1], body: m[2].trim() });
  return out;
}

// The source without its comments: one pass that tracks '...', "..." and `...` (with ${ } holding code) and drops // and /* */ outside them.
// ponytail: a regex literal holding a quote, // or /* is read as code; parse regex literals if a bundle trips on it.
function stripComments(src) {
  let out = '';
  // One entry per open template literal or ${ }: 'tpl' for the text, a number (the { depth) for the code inside ${ }.
  const stack = [];
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (top === 'tpl') {
      if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') stack.pop();
      else if (ch === '$' && src[i + 1] === '{') { stack.push(0); out += '${'; i += 2; continue; }
      out += ch; i++; continue;
    }
    // A / after a backslash ends an escaped regex literal such as /\/\//, so it opens no comment.
    if (ch === '/' && src[i - 1] !== '\\' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i - 1] !== '\\' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; out += ' '; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '`') stack.push('tpl');
    else if (typeof top === 'number' && ch === '{') stack[stack.length - 1]++;
    else if (typeof top === 'number' && ch === '}') { if (top === 0) stack.pop(); else stack[stack.length - 1]--; }
    out += ch; i++;
  }
  return out;
}

// plain: name -> true when the property is the permission, false when it is the negation; mixed: any other reader.
function readers(js, props, binding) {
  const word = new RegExp(`(^|[^\\w$.])${binding}($|[^\\w$])`);
  const plain = new Map();
  for (const p of props) {
    const t = p.body.replace(/\s+/g, '');
    if (t === binding) plain.set(p.name, true);
    else if (t === `!${binding}`) plain.set(p.name, false);
  }
  // mixed: a property that mentions the import, or a mixed or plain property, in any other shape.
  const mixed = new Set(props.filter((p) => !plain.has(p.name) && word.test(p.body)).map((p) => p.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of props) {
      const uses = [...p.body.matchAll(/this\.(\w+)/g)].some((m) => mixed.has(m[1]) || plain.has(m[1]));
      if (uses && !mixed.has(p.name) && !plain.has(p.name)) { mixed.add(p.name); grew = true; }
    }
  }
  // A field set again with this.x = ..., ||=, &&= or ??= is no longer the permission.
  for (const name of [...plain.keys()]) if (new RegExp(`\\bthis\\.${name}\\s*(?:\\|\\||&&|\\?\\?)?=(?!=)`).test(js)) { plain.delete(name); mixed.add(name); }
  return { plain, mixed };
}

// One result per imported custom permission: { permission, status: 'STATIC' | 'NOT_STATIC', gates, reason }.
// A gate is { prop, directive, shownWhenHeld }.
function scanGates(source, html) {
  // Comments go first so properties and mentions are read from the same text.
  const js = stripComments(source);
  const props = properties(js);
  const directives = blocks(html);
  const imports = [...js.matchAll(IMPORT)].map(([, binding, permission]) => ({ binding, permission, ...readers(js, props, binding) }));
  // A block after a sibling on a value that reads no permission (a loading flag) is read as nested markup is: that
  // sibling is left out, so a flat chain and its nested lwc:else give one verdict.
  const perms = new Set(imports.flatMap((i) => [...i.plain.keys(), ...i.mixed]));
  return imports.map(({ binding, permission, plain, mixed }) => {
    const gates = [];
    const bad = [];
    for (const d of directives) {
      let conds = d.conds.map((c) => ({ ...c, name: c.expr.replace(/^!/, '') })).filter((c) => !c.before || perms.has(c.name));
      // The blocks around count only for a block that reads a permission itself, so a spinner under the else changes nothing.
      if (!conds.some((c) => !c.outer && perms.has(c.name))) conds = conds.filter((c) => !c.outer);
      const mix = conds.find((c) => mixed.has(c.name));
      const held = conds.filter((c) => plain.has(c.name));
      const other = conds.find((c) => !plain.has(c.name));
      if (mix) bad.push(`${mix.directive}={${mix.expr}} reads a property that mixes the permission with other values`);
      else if (held.length && other) {
        const around = [...held, other].find((c) => c.under);
        const earlier = [...held, other].find((c) => c.before) ?? other; // the chain's earlier block, not this one
        bad.push(`${d.directive} ${around ? `nested under ${around.under}` : `in the chain of ${earlier.directive}={${earlier.expr}}`} reads the permission with another value`);
      }
      else if (held.length) {
        // A block whose chain asks for both held and not held never shows, so it gates nothing.
        const when = [...new Set(held.map((c) => plain.get(c.name) !== c.neg))];
        if (when.length === 1) gates.push({ prop: held.at(-1).name, directive: d.directive, shownWhenHeld: when[0] });
      }
    }
    if (bad.length) return { permission, status: 'NOT_STATIC', gates: [], reason: bad[0] };
    // Every other mention of the import in the class, a multi-statement getter or a method, may also decide the markup.
    // A getter or field that only carries the import's name is not a mention.
    const code = js.replace(IMPORT, '').replace(new RegExp(`\\bget\\s+${binding}\\s*\\(|^\\s*${binding}\\s*=(?!=)`, 'gm'), ' ');
    const mentions = (code.match(new RegExp(`(?<![\\w$.])${binding}(?![\\w$])`, 'g')) || []).length;
    if (mentions > props.filter((p) => plain.has(p.name) && [binding, `!${binding}`].includes(p.body.replace(/\s+/g, ''))).length) return { permission, status: 'NOT_STATIC', gates: [], reason: `${binding} is read outside a plain getter or field` };
    if (!gates.length) return { permission, status: 'NOT_STATIC', gates: [], reason: 'no plain directive in the template reads it' };
    return { permission, status: 'STATIC', gates };
  });
}

module.exports = { scanGates };
