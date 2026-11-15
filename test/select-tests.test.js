'use strict';

// The CI test selector: which unit test files a diff reaches, over a small made-up repo and over this one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { select, graph } = require('./select-tests');

// Five tests: one through a, one reading a fixture folder, one a JSON, one through index; four reach shared.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-select-tests-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const files = {
  'package.json': '{"main":"src/index.js"}',
  'src/index.js': "require('./shared');",
  'src/a.js': "require('./b');",
  'src/b.js': "require('./c.js');",
  'src/c.js': '',
  'src/shared.js': '',
  'src/data.json': '{}',
  // Split, so this file holds no dynamic require of its own.
  'src/loader.js': ['module.exports = (m) => require', '(m);'].join(''),
  'test/helpers.js': '',
  'test/fixture/x.xml': '',
  'test/one.test.js': "require('../src/a');",
  'test/two.test.js': "const path = require('node:path');\nconst F = path.join(__dirname, 'fixture');\nfs.readdirSync(path.join(F, 'x.xml'));\nrequire('../src/shared');",
  'test/three.test.js': "require('../src/data.json'); require('./helpers'); require('../src/shared');",
  'test/four.test.js': "require('..');",
  'test/five.test.js': "require('../src/shared'); require('../src/loader');",
  'agents/guard.js': '',
};
for (const [f, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
  fs.writeFileSync(path.join(tmp, f), text);
}
const g = graph(tmp);
const run = (...changed) => select(changed, g);

test('a src file two requires away from a test selects that test', () => {
  assert.deepEqual(run('src/c.js'), ['test/one.test.js']);
});

test('a changed test file selects itself', () => {
  assert.deepEqual(run('test/two.test.js'), ['test/two.test.js']);
});

test('a file reached by a path built on __dirname, or a required JSON, follows the graph', () => {
  assert.deepEqual(run('test/fixture/x.xml'), ['test/two.test.js']);
  assert.deepEqual(run('src/data.json'), ['test/three.test.js']);
});

test('a file more than 60% of the tests reach runs everything', () => {
  assert.equal(g.tests.length, 5);
  assert.deepEqual(run('src/index.js'), ['test/four.test.js'], 'control: one test of five');
  assert.equal(run('src/shared.js'), 'ALL', 'four of five');
});

test('the files every run depends on run everything', () => {
  for (const f of ['package.json', 'package-lock.json', '.github/workflows/validation.yml', 'test/select-tests.js', 'test/helpers.js']) assert.equal(run(f), 'ALL', f);
});

test('an unknown path, a deleted src file, or a file with a dynamic require runs everything', () => {
  assert.equal(run('agents/guard.js'), 'ALL', 'a file no test reaches');
  assert.equal(run('src/gone.js'), 'ALL', 'deleted, or the old side of a rename');
  assert.deepEqual(g.opaque, [{ file: 'src/loader.js', sites: 1 }]);
  assert.equal(run('src/loader.js'), 'ALL');
});

test('a diff of docs, Markdown, LICENSE, claude-mod or an unread bench file selects nothing', () => {
  assert.deepEqual(run('docs/x.md', 'README.md', 'LICENSE', 'claude-mod/hooks/hooks.json', 'bench/README.md'), []);
  assert.deepEqual(run('docs/x.md', 'src/c.js'), ['test/one.test.js'], 'control: a src file beside them still selects');
});

test('the command prints one file a line, ALL, or nothing, from argv or stdin', () => {
  const cli = path.join(__dirname, 'select-tests.js');
  const out = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });
  assert.equal(out(['package.json']).stdout, 'ALL\n');
  assert.equal(out([], 'docs/a.md\n\n').stdout, '');
  // guard.test.js names the test/ folder as a path, so every test file change selects it too.
  assert.equal(out([], 'test/select-tests.test.js\n').stdout, 'test/guard.test.js\ntest/select-tests.test.js\n');
});

// This repo: every test file reaches some src file, else it is listed here as self-contained, so a new test that
// no src change would select is noticed. The one dynamic require loads the sf CLI's @salesforce/core, not repo code.
const SELF_CONTAINED = [];
test('in this repo every test file is reached from src, and the dynamic requires are known', () => {
  const real = graph();
  assert.ok(real.tests.length > 50, `${real.tests.length} test files`);
  const orphans = real.tests.filter((t) => ![...real.reach.get(t)].some((n) => n.startsWith('src/')) && !SELF_CONTAINED.includes(t));
  assert.deepEqual(orphans, []);
  assert.deepEqual(real.opaque, [{ file: 'src/session.js', sites: 1 }]);
});

// A shard count in the matrix that differs from the one in --test-shard runs some files nowhere, and CI stays green.
test('the workflow shards the suite as many ways as its matrix has shards', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validation.yml'), 'utf8');
  const shards = yml.match(/^\s+shard: \[([\d, ]+)\]$/m)[1].split(',').map(Number);
  const totals = [...yml.matchAll(/--test-shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(shards, shards.map((_, i) => i + 1), 'shards number 1 to N');
  assert.deepEqual(totals, [shards.length]);
});
