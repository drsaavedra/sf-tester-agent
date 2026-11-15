'use strict';

// The unit test files a pull request's diff reaches, from the require graph and the paths built on __dirname. Prints
// them one per line, the word ALL, or nothing; CI runs the whole suite on ALL. Paths: argv, else stdin.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ALL_OF = [/^package(-lock)?\.json$/, /^\.github\//, /^test\/select-tests\.js$/, /^test\/helpers\.js$/];
// Selects nothing unless a test reaches it: the graph comes first, so agents/sf-tester.md or bench/bench.js still select.
const OUTSIDE = [/\.md$/, /^docs\//, /^LICENSE$/, /^claude-mod\//, /^bench\//];
const SHARE = 0.6;

// One file's own edges: relative requires, and path.join or path.resolve on __dirname, or on a name built from it,
// with literal parts. A require of anything else is a dynamic site: the file goes in opaque.
function edges(root, file) {
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const dir = path.dirname(path.join(root, file));
  const out = new Set();
  for (const [, spec] of text.matchAll(/\brequire\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
    try { out.add(rel(require.resolve(path.resolve(dir, spec)))); } catch { /* a require that fails here fails its own test */ }
  }
  const anchors = new Map([['__dirname', dir]]);
  const lits = (s) => [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  const calls = () => text.matchAll(/(?:\bconst|\blet)?\s*(\w+\s*=\s*)?\b(?:path\.)?(?:join|resolve)\(\s*(\w+)((?:\s*,\s*(?:'[^']*'|"[^"]*"))*)/g);
  for (let grew = true; grew;) {
    grew = false;
    for (const [, def, base, args] of calls()) {
      const name = def?.split('=')[0].trim();
      if (name && anchors.has(base) && !anchors.has(name)) { anchors.set(name, path.join(anchors.get(base), ...lits(args))); grew = true; }
    }
  }
  for (const [, , base, args] of calls()) {
    if (!anchors.has(base) || !lits(args).length) continue;
    const to = rel(path.join(anchors.get(base), ...lits(args)));
    if (to && !to.startsWith('..')) out.add(to);
  }
  const dynamic = [...text.matchAll(/\brequire\((?!\s*['"])(?!\$\{JSON\.stringify\((?:path\.)?join\(__dirname,(?:\s*'[^']*',?)+\)\)\})/g)].length;
  return { out: [...out], dynamic };
}

// Every test file with what it reaches, files and folders, through every .js it reaches.
function graph(root = ROOT) {
  root = fs.realpathSync(root); // require.resolve answers real paths, as macOS's /var is /private/var
  const memo = new Map();
  const own = (f) => memo.get(f) ?? memo.set(f, f.endsWith('.js') && fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile() ? edges(root, f) : { out: [], dynamic: 0 }).get(f);
  const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`).sort();
  const reach = new Map();
  for (const t of tests) {
    const seen = new Set([t]);
    for (const todo = [t]; todo.length;) for (const n of own(todo.pop()).out) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    reach.set(t, seen);
  }
  const opaque = [...memo].filter(([, e]) => e.dynamic).map(([f, e]) => ({ file: f, sites: e.dynamic }));
  return { tests, reach, opaque };
}

// ALL, or the test files to run (none for a diff no test reaches).
function select(changed, g = graph()) {
  const picked = new Set();
  for (const f of changed) {
    if (ALL_OF.some((re) => re.test(f)) || g.opaque.some((o) => o.file === f)) return 'ALL';
    const hits = g.tests.filter((t) => [...g.reach.get(t)].some((n) => f === n || f.startsWith(`${n}/`)));
    if (hits.length > SHARE * g.tests.length) return 'ALL';
    if (hits.length) { hits.forEach((t) => picked.add(t)); continue; }
    if (OUTSIDE.some((re) => re.test(f))) continue;
    // Unknown, deleted or renamed away (CI diffs with --no-renames, so the old path shows): run everything.
    return 'ALL';
  }
  return [...picked].sort();
}

module.exports = { select, graph };

if (require.main === module) {
  const args = process.argv.slice(2);
  const changed = (args.length ? args : fs.readFileSync(0, 'utf8').split('\n')).map((s) => s.trim()).filter(Boolean);
  const r = select(changed);
  if (r === 'ALL') console.log('ALL');
  else if (r.length) console.log(r.join('\n'));
}
