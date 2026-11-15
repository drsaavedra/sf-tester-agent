'use strict';

// sf_verify_checks: verify's checks with no browser, so a tester checks access before the UI. Only org, the check file, since
// and only reach verify: --cascade deploys, and --junit writes a local file.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const verify = require('./verify');
const { SfUiError } = require('./errors');
const { VALIDATE } = require('./cascade-log');

// It blocks the shared server while it runs, so verify's diffs share one 60 s deadline per run; verify reports a timeout as bad usage.
// ponytail: still synchronous; an async git needs verify to await it.
const gitUntil = (end) => (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: Math.max(1, end - Date.now()) });
const VERDICT = { 0: 'green', 1: 'red', 2: 'not run' };
const bad = (why, evidence) => new SfUiError('BAD_ARGS', why, evidence);
// only is check ids, matched whole: a regular expression from the tester could backtrack and stall the shared server.
const idsPattern = (ids) => `^(?:${ids.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;

// A run the server died in leaves its folder: one older than four times the validate's own time limit is removed by the next run.
function sweep(project) {
  const stale = 4 * VALIDATE.minutes * 60_000;
  for (const f of fs.readdirSync(project)) {
    if (!f.startsWith('.sf-tester-checks-')) continue;
    const d = path.join(project, f);
    // A parallel run can remove its own folder between the list and the stat.
    const st = fs.statSync(d, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs > stale) fs.rmSync(d, { recursive: true, force: true });
  }
}

// verify's argument rules, which a route's verify step meets before its first step.
// A path is absolute and holds no {{: a route never fills a verify path, so a placeholder there is refused up front.
const real = (p) => typeof p === 'string' && path.isAbsolute(p) && !p.includes('{{');
function check({ checksFile, checks, project, since }) {
  if ((checksFile == null) === (checks == null)) throw bad('give checksFile or checks, not both and not neither', { checksFile, checks: checks != null });
  // verify takes the project from the check file, so a project beside one would be a folder nobody reads.
  if (checksFile != null && project != null) throw bad('project goes with checks, not with checksFile', { checksFile, project });
  // The guard judges these paths before the call, and the server's folder is not the agent's.
  if (checksFile != null && !real(checksFile)) throw bad(`checksFile must be an absolute path, not ${checksFile}`, { checksFile });
  // verify finds the project at or above the check file, so a folder with none would reach a project above it.
  if (checks != null && !(real(project) && fs.existsSync(path.join(project, 'sfdx-project.json')))) throw bad(`checks need project: the absolute path of the folder that holds sfdx-project.json, not ${project}`, { project });
  // verify passes since to git diff, where a leading - is an option (--output writes a file).
  if (since?.startsWith('-')) throw bad(`since must be a git ref, not an option: ${since}`, { since });
}

async function run({ org, checksFile, checks, project, since, only }, { signal, main = verify.main } = {}) {
  check({ checksFile, checks, project, since });
  // Inline checks go to a file of the tool's own inside the project, as verify reads checks only from a file; it is gone after the run.
  if (checks != null) sweep(project);
  const dir = checks != null && fs.mkdtempSync(path.join(project, '.sf-tester-checks-'));
  const file = dir ? path.join(dir, 'checks.json') : checksFile;
  if (dir) fs.writeFileSync(file, JSON.stringify({ checks }));
  const lines = [];
  // The CLI's usage line is no help to a tool caller, and only is the ids it sent, not the pattern made from them.
  const problems = [];
  const pattern = only && idsPattern(only);
  try {
    const exit = await main({ org, checks: file, since, only: pattern }, { log: (l) => lines.push(l), warn: (l) => problems.push(l.replace(`\n${verify.USAGE}`, '').replace(`--only ${pattern}`, () => `only ${JSON.stringify(only)}`)), git: gitUntil(Date.now() + 60_000), signal });
    // verify exits 0 with no PASS when since touches no covered item, only leaves none, or every case needs the browser:
    // no access was checked, so it is never green.
    const verdict = exit === 0 && !lines.some((l) => l.startsWith('PASS ')) ? 'nothing checked' : VERDICT[exit];
    return { verdict, exit, lines, ...(problems.length && { problems }) };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run, check };
