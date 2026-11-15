'use strict';

// The tester agents' PreToolUse guard: no read, search, upload or non-web page reaches the bench answer key, in any checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const GUARD = path.join(REPO, 'agents', 'guard.js');
const HOME_BENCH = path.join(os.homedir(), '.sf-tester', 'bench');

// A bench folder outside the home one, so the test reads and writes nothing real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-guard-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const bench = path.join(tmp, 'bench');
fs.mkdirSync(path.join(bench, 'run1', 'briefs'), { recursive: true });
fs.writeFileSync(path.join(bench, 'run1', 'briefs', 'a.txt'), 'brief');

const CONFIG = path.join(tmp, 'config');
const env = (root) => { const e = { ...process.env, CLAUDE_CONFIG_DIR: CONFIG }; if (root === null) delete e.SF_TESTER_BENCH; else e.SF_TESTER_BENCH = root; return e; }; // null: unset
const guard = (tool, args, { cwd = REPO, input, root = bench } = {}) => spawnSync('node', [GUARD], {
  input: input ?? JSON.stringify({ tool_name: tool, tool_input: args, cwd }), encoding: 'utf8', env: env(root),
});
const denied = (...a) => { const r = guard(...a); return r.status === 2 && /sf-tester guard/.test(r.stderr); };
const allowed = (...a) => { const r = guard(...a); assert.equal(r.status, 0, `${JSON.stringify(a[1])}: ${r.stderr}`); };

test('a tester may not Read the answer key: bench/, its test, the run folders, the defect state', () => {
  for (const f of ['bench/defects.json', 'bench/defects/x.patch', 'bench/README.md', 'test/bench.test.js']) {
    assert.ok(denied('Read', { file_path: path.join(REPO, f) }), f);
  }
  assert.ok(denied('Read', { file_path: path.join(bench, 'run1', 'briefs', 'a.txt') }), 'another cell\'s brief');
  assert.ok(denied('Read', { file_path: path.join(bench, 'run1', 'cells.json') }), 'a file not there yet');
  assert.ok(denied('Read', { file_path: path.join(bench, '..x', 'cells.json') }), 'a run whose name starts with ..');
  assert.ok(denied('Read', { file_path: `${bench}-defect-state/x.json` }), 'the defect state');
  assert.ok(denied('Read', { file_path: `${bench}-defect-state/x.json` }, { root: `${bench}/` }), 'a root with a trailing slash');
  assert.ok(denied('Read', { file_path: 'bench/defects.json' }), 'a relative path, from the repo');
  assert.ok(denied('Read', { file_path: path.join(CONFIG, 'projects', 'p', 's.jsonl') }), 'a session transcript, which holds what the main session read');
  assert.ok(denied('Read', { file_path: path.join(CONFIG, 'history.jsonl') }), 'the prompt history');
  assert.ok(denied('Read', { file_path: path.join(CONFIG, 'file-history', 's', 'h@v1') }), 'a backup of an edited file');
  assert.ok(denied('Grep', { pattern: 'expected', path: path.join(CONFIG, 'projects') }), 'a search over the transcripts');
  // macOS folders ignore case, so another spelling opens the same file.
  if (fs.existsSync(path.join(REPO, 'BENCH', 'defects.json'))) assert.ok(denied('Read', { file_path: path.join(REPO, 'BENCH', 'Defects.json') }), 'another case');
});

test('a transcript under another Claude config dir in the home folder is refused too', () => {
  // A main session resumed under a second config keeps a copy of its transcript there, outside CLAUDE_CONFIG_DIR.
  const home = path.join(tmp, 'home');
  const other = path.join(home, '.claude-other');
  fs.mkdirSync(path.join(other, 'projects', 'p', 's', 'tool-results'), { recursive: true });
  const run = (tool, args) => spawnSync('node', [GUARD], {
    input: JSON.stringify({ tool_name: tool, tool_input: args, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), HOME: home },
  });
  const refused = (tool, args) => { const r = run(tool, args); return r.status === 2 && /sf-tester guard/.test(r.stderr); };
  assert.ok(refused('Read', { file_path: path.join(other, 'projects', 'p', 's.jsonl') }), 'a transcript in the other config');
  assert.ok(refused('Read', { file_path: path.join(other, 'history.jsonl') }), 'its prompt history');
  assert.ok(refused('Grep', { pattern: 'expected', path: path.join(other, 'projects') }), 'a search over its transcripts');
  assert.ok(refused('Grep', { pattern: 'expected', path: path.join(other, 'projects', 'p') }), 'a search in one project folder');
  assert.ok(refused('Grep', { pattern: 'expected', path: path.join(CONFIG, 'projects', 'p') }), 'the same in the current config');
  const saved = run('Read', { file_path: path.join(other, 'projects', 'p', 's', 'tool-results', 'r.txt') });
  assert.equal(saved.status, 0, `a saved tool result stays readable: ${saved.stderr}`);
  // A subagent tester shares its parent's session folder, so tool-results also holds the main session's saved outputs.
  assert.ok(refused('Grep', { pattern: 'expected', path: path.join(other, 'projects', 'p', 's', 'tool-results') }), 'a search in tool-results');
  // One named file there is no wider than a Read of it, which is allowed; a transcript copy there is not.
  const results = path.join(other, 'projects', 'p', 's', 'tool-results');
  fs.writeFileSync(path.join(results, 'r.txt'), 'Id');
  fs.writeFileSync(path.join(results, 'x.jsonl'), '{}');
  const one = run('Grep', { pattern: 'Id', path: path.join(results, 'r.txt') });
  assert.equal(one.status, 0, `a search in one saved result file, by name: ${one.stderr}`);
  assert.ok(refused('Grep', { pattern: 'x', path: path.join(results, 'x.jsonl') }), 'a .jsonl file in tool-results');
  fs.mkdirSync(path.join(other, 'projects', 'p', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(other, 'projects', 'p', 'memory', 'MEMORY.md'), 'x');
  assert.ok(refused('Grep', { pattern: 'x', path: path.join(other, 'projects', 'p', 'memory', 'MEMORY.md') }), 'a named file outside tool-results');
});

test('a broken ~/.claude* link in the home folder does not refuse every call', () => {
  const home = path.join(tmp, 'home-dangling');
  fs.mkdirSync(home, { recursive: true });
  fs.symlinkSync(path.join(tmp, 'gone'), path.join(home, '.claude-gone'));
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'README.md') }, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const absent = spawnSync('node', [GUARD], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'README.md') }, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), HOME: path.join(tmp, 'no-home') },
  });
  assert.equal(absent.status, 0, `a home folder that does not exist: ${absent.stderr}`);
  // A link loop and a link through a file resolve to no folder either, so they hold no transcript. One home each.
  const loop = path.join(tmp, 'home-loop');
  fs.mkdirSync(loop, { recursive: true });
  fs.symlinkSync(path.join(loop, '.claude-b'), path.join(loop, '.claude-a'));
  fs.symlinkSync(path.join(loop, '.claude-a'), path.join(loop, '.claude-b'));
  const viaFile = path.join(tmp, 'home-via-file');
  fs.mkdirSync(viaFile, { recursive: true });
  fs.writeFileSync(path.join(viaFile, 'file'), '');
  fs.symlinkSync(path.join(viaFile, 'file', 'sub'), path.join(viaFile, '.claude-x'));
  for (const [home, what] of [[loop, 'a link loop'], [viaFile, 'a link through a file']]) {
    const r2 = spawnSync('node', [GUARD], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'README.md') }, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), HOME: home },
    });
    assert.equal(r2.status, 0, `${what}: ${r2.stderr}`);
  }
});

// Root ignores a 000 folder, so the stat would succeed and nothing could be refused.
test('a ~/.claude* entry the guard may not stat refuses: it may hide a config', { skip: process.getuid?.() === 0 && 'root ignores chmod 000' }, () => {
  const home = path.join(tmp, 'home-locked');
  const locked = path.join(tmp, 'locked');
  fs.mkdirSync(path.join(locked, 'cfg'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.symlinkSync(path.join(locked, 'cfg'), path.join(home, '.claude-locked'));
  fs.chmodSync(locked, 0o000);
  try {
    const r = spawnSync('node', [GUARD], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'README.md') }, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), HOME: home },
    });
    assert.ok(r.status === 2 && /sf-tester guard: .*EACCES/.test(r.stderr), r.stderr);
  } finally { fs.chmodSync(locked, 0o755); }
});

test('with no SF_TESTER_BENCH, the home bench folder is the one guarded', () => {
  assert.ok(denied('Read', { file_path: path.join(HOME_BENCH, 'r', 'cells.json') }, { root: null }));
  assert.ok(denied('Glob', { pattern: '**/*.json', path: path.dirname(HOME_BENCH) }, { root: null }), 'the folder that holds it');
  assert.ok(denied('Read', { file_path: '~/.sf-tester/bench/r/cells.json' }, { root: null }), 'spelled with ~');
});

test('a tester may Read the rest: the source, the fixture, the other tests, the upload a brief names', () => {
  for (const f of ['src/server.js', 'test/fixture/force-app', 'test/act.test.js', 'README.md', 'agents/sf-tester.md']) allowed('Read', { file_path: path.join(REPO, f) });
  allowed('Read', { file_path: `${bench}-uploads/k/bench-upload.txt` });
  allowed('Read', { file_path: path.join(CONFIG, 'projects', 'p', 's', 'tool-results', 'mcp-sf-tester-sf_api-1.txt') }); // a big result, saved for it to read
});

test('a copy of the repo elsewhere is guarded too: a bench folder that holds defects.json', () => {
  const copy = path.join(tmp, 'copy');
  fs.mkdirSync(path.join(copy, 'bench', 'defects'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'test'));
  fs.writeFileSync(path.join(copy, 'bench', 'defects.json'), '[]');
  assert.ok(denied('Read', { file_path: path.join(copy, 'bench', 'defects', 'x.patch') }));
  assert.ok(denied('Read', { file_path: path.join(copy, 'test', 'bench.test.js') }));
  assert.ok(denied('Grep', { pattern: 'x' }, { cwd: copy }), 'a Grep with no path searches the copy, bench/ included');
  // A folder named bench with no defects.json is somebody's code, not the answer key.
  fs.mkdirSync(path.join(copy, 'other', 'bench'), { recursive: true });
  allowed('Read', { file_path: path.join(copy, 'other', 'bench', 'a.js') });
});

test('a Grep or Glob may not search the key, nor a folder that holds it', () => {
  assert.ok(denied('Grep', { pattern: 'expected', path: path.join(REPO, 'bench') }));
  assert.ok(denied('Grep', { pattern: 'expected' }), 'no path: the repo root, which holds bench/');
  assert.ok(denied('Glob', { pattern: '**/*', path: tmp }), 'the folder that holds the bench folder');
  assert.ok(denied('Grep', { pattern: 'x', path: path.join(REPO, 'test') }), 'test/ holds bench.test.js');
  for (const p of ['../bench/**', '{..,x}/bench/*', 'x/{a,..}/b', `${REPO}/bench/*`, '~/.sf-tester/**', '{~,x}/.sf-tester/**', '{/,x}Users/**']) assert.ok(denied('Glob', { pattern: p, path: path.join(REPO, 'src') }), p);
  for (const p of ['src', 'test/fixture']) allowed('Grep', { pattern: 'x', path: path.join(REPO, p) });
  for (const p of ['**/*.js', '**/*..snap']) allowed('Glob', { pattern: p, path: path.join(REPO, 'src') });
});

// Its root, searched from elsewhere, so only the guard's worktree list can see the bench inside it.
test('a search over another worktree of the repo is refused', (t) => {
  const wt = path.join(tmp, 'wt');
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'ignore' });
  t.after(() => execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }));
  assert.ok(denied('Grep', { pattern: 'x', path: wt }, { cwd: tmp }), wt);
  // sf_verify_checks works across its project root, so one that holds another worktree's key is refused the same way.
  fs.writeFileSync(path.join(wt, 'sfdx-project.json'), '{}');
  assert.ok(denied('mcp__sf-tester__sf_verify_checks', { org: 'o', checks: [{}], project: wt }, { cwd: tmp }), `verify in ${wt}`);
});

test('a search with no worktree list to check it against is refused', () => {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'x', path: path.join(REPO, 'src') }, cwd: REPO }), encoding: 'utf8', env: { ...env(bench), PATH: '/nonexistent' } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no worktree list/);
});

// A copy with no .git has no worktrees to list, so its searches are judged without one.
test('a guard in a copy with no .git still lets a search run', () => {
  const copy = path.join(tmp, 'zip');
  for (const f of ['agents/guard.js', 'bench/paths.js']) { fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(copy, f)); }
  fs.mkdirSync(path.join(copy, 'src'));
  const r = spawnSync(process.execPath, [path.join(copy, 'agents', 'guard.js')], { input: JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'x', path: path.join(copy, 'src') }, cwd: copy }), encoding: 'utf8', env: { ...env(bench), PATH: '/nonexistent' } });
  assert.equal(r.status, 0, r.stderr);
});

test('a tester opens only web pages, and uploads no file from the key', () => {
  for (const url of [`file://${REPO}/bench/defects.json`, `view-source:file://${REPO}/bench/defects.json`, `fi\tle://${REPO}/bench/defects.json`, 'not a url']) {
    assert.ok(denied('mcp__playwright__browser_navigate', { url }), url);
  }
  assert.ok(denied('mcp__playwright__browser_tabs', { action: 'new', url: `file://${REPO}/bench/defects.json` }), 'a new tab');
  allowed('mcp__playwright__browser_navigate', { url: 'https://example.my.salesforce.com/lightning/page/home' });
  allowed('mcp__playwright__browser_navigate', { url: 'example.my.salesforce.com/lightning/page/home' }); // Playwright MCP adds https://
  allowed('mcp__playwright__browser_tabs', { action: 'list' });
  for (const t of ['mcp__playwright__browser_file_upload', 'mcp__playwright__browser_drop', 'mcp__sf-tester__sf_upload_file']) {
    assert.ok(denied(t, { paths: [path.join(REPO, 'src', 'server.js'), path.join(REPO, 'bench', 'defects.json')] }), t);
    assert.ok(denied(t, { paths: ['README.md'] }), `${t}: a relative path, which its server resolves where the guard cannot see`);
    allowed(t, { paths: [`${bench}-uploads/k/bench-upload.txt`] });
  }
});

test('a check file or project sf_verify_checks reads is judged like a Read: absolute, and not in the key', () => {
  const t = 'mcp__sf-tester__sf_verify_checks';
  assert.ok(denied(t, { org: 'o', checksFile: path.join(bench, 'run1', 'checks.json') }), 'the key');
  assert.ok(denied(t, { org: 'o', checksFile: 'test/fixture/verify-checks.json' }), 'a relative path, which the server resolves where the guard cannot see');
  assert.ok(denied(t, { org: 'o', checks: [{}], project: path.join(bench, 'run1') }), 'a project in the key');
  assert.ok(denied(t, { org: 'o', checks: [{}], project: 'test/fixture' }), 'a relative project');
  assert.ok(denied(t, { org: 'o', checks: [{}] }), 'no path');
  allowed(t, { org: 'o', checksFile: path.join(REPO, 'test', 'fixture', 'verify-checks.json') });
  allowed(t, { org: 'o', checks: [{}], project: path.join(REPO, 'test', 'fixture') });
});

test('sf_verify_checks may not work in a project root that holds the key', () => {
  const t = 'mcp__sf-tester__sf_verify_checks';
  // tmp holds the bench folder: a project there, or a check file whose nearest sfdx-project.json is there.
  fs.writeFileSync(path.join(tmp, 'sfdx-project.json'), '{}');
  fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
  try {
    assert.ok(denied(t, { org: 'o', checks: [{}], project: tmp }), 'a project above the key');
    assert.ok(denied(t, { org: 'o', checksFile: path.join(tmp, 'app', 'checks.json') }), 'a check file whose project is above the key');
    // A project given beside a check file is refused by the tool; the guard judges the check file's own root.
    assert.ok(denied(t, { org: 'o', checksFile: path.join(tmp, 'app', 'checks.json'), project: path.join(REPO, 'test', 'fixture') }), 'a safe project beside a check file above the key');
    // A link in the path: verify walks the path as given, up to the folder above the key.
    fs.symlinkSync(path.join(REPO, 'test', 'fixture', 'force-app'), path.join(tmp, 'link'));
    assert.ok(denied(t, { org: 'o', checksFile: path.join(tmp, 'link', 'checks.json') }), 'a link to a safe folder under a root that holds the key');
  } finally { fs.rmSync(path.join(tmp, 'sfdx-project.json')); fs.rmSync(path.join(tmp, 'link'), { force: true }); }
  allowed(t, { org: 'o', checksFile: path.join(tmp, 'app', 'checks.json') }); // control: no project root above the key now
});

test('a route step that uploads is judged like the upload itself', () => {
  const route = (paths, tool = 'sf_upload_file') => ({ steps: [{ tool: 'sf_wait', args: { text: 'x' } }, { tool, args: { paths } }] });
  const t = 'mcp__sf-tester__sf_run_route';
  assert.ok(denied(t, route([path.join(REPO, 'bench', 'defects.json')])), 'the key');
  assert.ok(denied(t, route(['README.md'])), 'a relative path');
  assert.ok(denied(t, route(['/tmp/{{step0.result}}'])), 'a path that only a step can fill');
  allowed(t, route([`${bench}-uploads/k/bench-upload.txt`]));
  allowed(t, route([path.join(REPO, 'bench', 'defects.json')], 'sf_wait')); // paths on another tool are not an upload
  allowed(t, { steps: [{ tool: 'sf_wait', args: { text: 'x' } }] });
  // A saved route runs later with no hook, so saving it is the moment to judge it.
  const save = 'mcp__sf-tester__sf_save_route';
  assert.ok(denied(save, { route: route([path.join(REPO, 'bench', 'defects.json')]).steps }), 'a saved route');
  allowed(save, { route: route([`${bench}-uploads/k/bench-upload.txt`]).steps });
  allowed(save, { route: [{ tool: 'sf_wait', args: { text: 'x' } }] });
  allowed(save, { route: route(['{{uploadFile}}']).steps }); // the catalogue's own file, as both upload routes name it
  assert.ok(denied(save, { route: route(['{{step0.x}}']).steps }), 'a value only a run can fill');
  assert.ok(denied(t, route(['{{uploadFile}}'])), 'a run gets its values filled first');
  allowed('mcp__sf-tester__constructor', {}); // a tool name is not looked up on the prototype
});

test('a route step that runs sf_verify_checks is judged like the call, and a relative path is refused', (t) => {
  const route = (args) => ({ steps: [{ tool: 'sf_wait', args: { text: 'x' } }, { tool: 'sf_verify_checks', args }] });
  const fixture = path.join(REPO, 'test', 'fixture');
  for (const [tool, key] of [['mcp__sf-tester__sf_run_route', 'steps'], ['mcp__sf-tester__sf_save_route', 'route']]) {
    const call = (args) => ({ [key]: route(args).steps });
    assert.ok(denied(tool, call({ checksFile: path.join(bench, 'run1', 'checks.json') })), `${tool}: the key`);
    assert.ok(denied(tool, call({ checks: [{}], project: path.join(bench, 'run1') })), `${tool}: a project in the key`);
    assert.ok(denied(tool, call({ checks: [{}] })), `${tool}: no path`);
    assert.ok(denied(tool, call({ checksFile: '{{step0.x}}' })), `${tool}: a path only a run can fill`);
    // The server's folder (SF_TESTER_COMBINATIONS) is not the guard's to see, so no relative path is judged, even one outside the key.
    assert.ok(denied(tool, call({ checksFile: '../test/fixture/verify-checks.json' })), `${tool}: a relative check file`);
    assert.ok(denied(tool, call({ checks: [{}], project: '../test/fixture' })), `${tool}: a relative project`);
    allowed(tool, call({ checksFile: path.join(fixture, 'verify-checks.json') }));
    allowed(tool, call({ checks: [{}], project: fixture }));
    assert.ok(denied(tool, call({ checksFile: 'x{{checks}}' })), `${tool}: a placeholder inside a path`);
    // A verify path is never a placeholder, in a saved route either: whole-value or inside an absolute path.
    assert.ok(denied(tool, call({ checksFile: '{{checks}}' })), `${tool}: a whole-value placeholder`);
    assert.ok(denied(tool, call({ checks: [{}], project: '{{project}}' })), `${tool}: a whole-value project placeholder`);
  }
  for (const [tool, key] of [['mcp__sf-tester__sf_run_route', 'steps'], ['mcp__sf-tester__sf_save_route', 'route']]) {
    assert.ok(denied(tool, { [key]: route({ checksFile: path.join(fixture, '{{step0.x}}.json') }).steps }), `${tool}: an absolute path with a placeholder`);
  }
  // Another worktree's key is seen, so a project root that holds it is refused.
  const wt = path.join(tmp, 'wt-verify');
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'ignore' });
  t.after(() => execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }));
  fs.writeFileSync(path.join(wt, 'sfdx-project.json'), '{}');
  assert.ok(denied('mcp__sf-tester__sf_run_route', route({ checks: [{}], project: wt }), { cwd: tmp }), 'a project root that holds another worktree\'s key');
});

test('other tools pass, and a guard that cannot read its input denies', () => {
  allowed('mcp__sf-tester__sf_start', {});
  assert.ok(denied('Read', {}, { input: 'not json' }));
  assert.ok(denied('Read', {}), 'a Read with no file_path');
});

// Every agent file here that can Read runs the guard, before its browser navigation too when it has one.
test('every agent that can Read runs the guard', () => {
  const files = ['agents', 'bench'].flatMap((d) => fs.readdirSync(path.join(REPO, d)).filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
  const agents = files.filter((f) => /^tools:.*\bRead\b/m.test(fs.readFileSync(path.join(REPO, f), 'utf8').split('\n---')[0]));
  assert.ok(agents.length >= 2, `checked ${agents.length} agents`);
  for (const f of agents) assert.ok(require('../bench/bench').wiresGuard(fs.readFileSync(path.join(REPO, f), 'utf8')), f);
  const open = fs.readFileSync(path.join(REPO, 'agents', 'sf-tester.md'), 'utf8').replace('|mcp__sf-tester__sf_run_route|mcp__sf-tester__sf_save_route', '');
  assert.equal(require('../bench/bench').wiresGuard(open), false, 'a tester whose routes skip the guard');
  const unsaved = fs.readFileSync(path.join(REPO, 'agents', 'sf-tester.md'), 'utf8').replace('|mcp__sf-tester__sf_save_route', '');
  assert.equal(require('../bench/bench').wiresGuard(unsaved), false, 'a tester whose saved routes skip the guard');
  const { wiresGuard } = require('../bench/bench');
  const cmd = `          command: 'node "x/agents/guard.js" || exit 2'`;
  assert.equal(wiresGuard(`---\nhooks:\n    - matcher: "Read|Grep|Glob"\n${cmd}\n---\n`), false, 'no tools line: the agent has every tool');
  assert.equal(wiresGuard(`---\ntools: Read, Grep\nhooks:\n    - matcher: "Read|Grep"\n          command: 'other'\n    - matcher: "Grep"\n${cmd}\n---\n`), false, 'the guard sits under a narrower matcher than the first');
  // A matcher that misses one tool the agent lists is not wired.
  assert.equal(require('../bench/bench').wiresGuard("---\ntools: Read, Grep, Glob, mcp__playwright__browser_navigate\nhooks:\n    - matcher: \"Read|Grep|Glob\"\n          command: 'node \"x/agents/guard.js\" || exit 2'\n---\n"), false);
});
