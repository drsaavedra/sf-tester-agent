#!/usr/bin/env node
'use strict';

// PreToolUse guard for the tester agents: no file read, search, upload or check file (a route's steps too) or non-web page reaches the bench answer key
// (a bench/ that holds defects.json, the test beside it, the bench folders, session transcripts). Only denies, exit 2.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { benchRoot, beside, real, within } = require('../bench/paths');

const deny = (why) => {
  console.error(`sf-tester guard: ${why} is refused. The bench answer key is not for testers; read or search a folder that does not hold it, such as src or test/fixture.`);
  process.exit(2);
};
// A crash exits 1, which Claude Code treats as a non-blocking error and runs the call: make it a deny.
process.on('uncaughtException', (e) => deny(`this call (guard error: ${e.message})`));

const { tool_name: tool, tool_input: args = {}, cwd = process.cwd() } = JSON.parse(fs.readFileSync(0, 'utf8'));
const target = (p) => real(path.resolve(cwd, p.replace(/^~(?=$|[\\/])/, os.homedir()))); // a path that is no text throws: a deny
const name = tool.split('__').pop(); // mcp__<server>__<tool>

// A tester tests the org in a browser: a web page only, never a file:, view-source: or other local scheme.
if (['browser_navigate', 'browser_tabs'].includes(name)) {
  if (args.url !== undefined) {
    // Playwright MCP adds https:// to a URL with no scheme, so judge it the same way.
    let url;
    try { url = new URL(String(args.url)); } catch { try { url = new URL(`https://${args.url}`); } catch { deny(`opening ${args.url}`); } }
    if (!['http:', 'https:'].includes(url.protocol)) deny(`opening ${args.url}`);
  }
  process.exit(0);
}
// A route step reaches a tool with no hook of its own, and a saved route runs later with none, so the guard reads the steps here.
const ROUTES = { sf_run_route: 'steps', sf_save_route: 'route' };
const routed = Object.hasOwn(ROUTES, name);
const routeSteps = routed ? [].concat(args[ROUTES[name]] ?? []) : [];
const steps = routeSteps.filter((s) => s?.tool === 'sf_upload_file');
const verifySteps = routeSteps.filter((s) => s?.tool === 'sf_verify_checks');
const uploads = routed || ['browser_file_upload', 'browser_drop', 'sf_upload_file'].includes(name);
const checkFile = name === 'sf_verify_checks';
if (!uploads && !checkFile && !['Read', 'Grep', 'Glob'].includes(tool)) process.exit(0);

const repo = path.join(__dirname, '..');
const search = tool === 'Grep' || tool === 'Glob';
const checkouts = [repo, cwd];
// For a search, and for sf_verify_checks, which works across its project root, every worktree of this repo, so one over the folder that holds them sees their keys too. A Read or an
// upload needs none: the walk in inKey finds a key in any checkout. No list, no search: fail closed.
if ((search || checkFile || verifySteps.length) && fs.existsSync(path.join(repo, '.git'))) { // a copy with no .git has no worktrees
  try { checkouts.push(...execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 5000 }).split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))); } catch (e) { deny(`${tool} (no worktree list: ${e.message.split('\n')[0]})`); }
}
const isKey = (d) => path.basename(d) === 'bench' && fs.existsSync(path.join(d, 'defects.json'));
// This config and every ~/.claude* one: a main session resumed under another config keeps a copy of its transcript there.
// ponytail: a config dir outside the home folder or not named .claude* is not seen; add it here if one is used.
const home = os.homedir();
// A path that resolves to no folder (a dead link, a loop, a link through a file, no home folder) holds no transcript and
// is skipped; any other error, such as EACCES, refuses.
const absent = (read, empty) => { try { return read(); } catch (e) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) return empty; throw e; } };
const isDir = (d) => absent(() => fs.statSync(d).isDirectory(), false);
const configs = [...new Set([process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
  ...absent(() => fs.readdirSync(home), []).filter((d) => d.startsWith('.claude')).map((d) => path.join(home, d)).filter(isDir)].map((c) => real(path.resolve(c))))];
const keys = [benchRoot(), beside('defect-state'), ...configs.flatMap((c) => [path.join(c, 'file-history'), path.join(c, 'history.jsonl')]),
  ...checkouts.filter((c) => isKey(path.join(c, 'bench'))).flatMap((c) => [path.join(c, 'bench'), path.join(c, 'test', 'bench.test.js')])].map((k) => real(path.resolve(k)));
// Session transcripts record what the main session read; a tester's saved tool results beside them stay readable.
const projects = configs.map((c) => real(path.join(c, 'projects')));
const inKey = (p) => {
  if (keys.some((k) => within(p, k)) || (projects.some((d) => within(p, d)) && p.endsWith('.jsonl'))) return true;
  if (path.basename(p) === 'bench.test.js' && isKey(path.join(path.dirname(p), '..', 'bench'))) return true;
  for (let d = p; path.dirname(d) !== d; d = path.dirname(d)) if (isKey(d)) return true;
  return false;
};

// verify reads the check file and the project at or above it, and inline checks are written into the project: each an
// absolute path, judged like a Read. src/access.js holds the full argument rules; this keeps only what reaches the key.
function judgeChecks({ checksFile, project }) {
  const paths = [checksFile, project].filter((p) => p !== undefined);
  if (!paths.length) deny('sf_verify_checks with no checksFile or project');
  for (const p of paths) if (!path.isAbsolute(String(p)) || String(p).includes('{{') || inKey(target(p))) deny(`checks at ${p}`);
  // verify lists and reads files across the project root (the nearest sfdx-project.json at or above a check file), so a
  // root that holds the key is refused, as a search over it is.
  // verify walks up from the path as given and the guard's target() resolves links, so both walks are judged.
  const from = checksFile !== undefined ? checksFile : path.join(String(project), 'sfdx-project.json');
  for (const start of [path.resolve(cwd, String(from)), target(from)]) {
    let root = path.dirname(start);
    while (!fs.existsSync(path.join(root, 'sfdx-project.json')) && path.dirname(root) !== root) root = path.dirname(root);
    // With no sfdx-project.json at or above it, verify stops before reading anything.
    const r = real(root);
    if (fs.existsSync(path.join(root, 'sfdx-project.json')) && keys.some((k) => within(k, r) || within(k, root))) deny(`checks in ${root}, which holds the bench key`);
  }
}
// A route's verify step is judged like the call: absolute paths only, as the guard cannot see the server's folder.
for (const { args: a = {} } of verifySteps) judgeChecks({ checksFile: a.checksFile, project: a.project });
if (uploads) {
  // The server resolves a relative path against its own folder, which the guard cannot see: absolute paths only.
  // A {{stepN.x}} value is not known yet, so nothing can judge that path. A saved route's {{name}} is the catalogue's own file.
  const paths = routed ? steps.flatMap((s) => [].concat(s.args?.paths ?? [])) : [].concat(args.paths ?? []);
  for (const p of paths) {
    if (name === 'sf_save_route' && /^\{\{\w+\}\}$/.test(String(p))) continue;
    if (!path.isAbsolute(String(p)) || String(p).includes('{{') || inKey(target(p))) deny(`uploading ${p}`);
  }
  process.exit(0);
}
if (checkFile) {
  judgeChecks(args);
  process.exit(0);
}
if (tool === 'Read') {
  if (inKey(target(args.file_path))) deny(`Read ${args.file_path}`);
  process.exit(0);
}
// Grep and Glob: a search inside the key, or in a folder that holds it, would return its files.
// ponytail: a separate clone of the repo below the searched folder, not a worktree of this one, is not seen.
const where = args.path || cwd;
const dir = target(where);
// No search over or inside projects/: tool-results holds the main session's saved outputs too. A named file at any
// depth under <p>/<s>/tool-results may be searched, no wider than a Read of it; inKey still refuses a .jsonl there.
const savedFile = (d) => path.relative(d, dir).split(path.sep)[2] === 'tool-results' && fs.statSync(dir, { throwIfNoEntry: false })?.isFile();
if (inKey(dir) || keys.some((k) => within(k, dir)) || projects.some((d) => within(d, dir) || (within(dir, d) && !savedFile(d)))) deny(`${tool} in ${where}`);
const pattern = tool === 'Glob' ? args.pattern : args.glob;
if (typeof pattern === 'string' && (pattern.split(/[\\/{},]/).includes('..') || pattern.split(/[{},]/).some((x) => path.isAbsolute(x) || x.startsWith('~')))) deny(`${tool} pattern ${pattern}`);
process.exit(0);
