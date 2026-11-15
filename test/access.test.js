'use strict';

// sf_verify_checks: what reaches verify from a tool argument, and the verdict it reads back. No org.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/access');

const FILE = '/repo/verify-checks.json';
const stub = (exit = 0, { lines = [], problems = [], seen } = {}) => {
  const calls = [];
  const main = async (a, o) => { calls.push({ a, o, file: seen && JSON.parse(fs.readFileSync(a.checks, 'utf8')) }); lines.forEach(o.log); problems.forEach(o.warn); return exit; };
  return { calls, main };
};
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-access-'));
fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app"}]}');
test.after(() => fs.rmSync(project, { recursive: true, force: true }));
const CHECKS = [{ id: 'a', kind: 'record' }];

test('checksFile must be an absolute path, which the guard can judge', async () => {
  const { calls, main } = stub();
  for (const checksFile of ['verify-checks.json', './x.json', '../bench/defects.json']) await assert.rejects(run({ org: 'o', checksFile }, { main }), { code: 'BAD_ARGS' }, checksFile);
  assert.equal(calls.length, 0);
  await run({ org: 'o', checksFile: FILE }, { main });
  assert.equal(calls.length, 1, 'control: an absolute path reaches verify');
});

test('one of checksFile and checks, and checks need the folder that holds sfdx-project.json', async () => {
  const { calls, main } = stub();
  await assert.rejects(run({ org: 'o' }, { main }), { code: 'BAD_ARGS' }, 'neither');
  await assert.rejects(run({ org: 'o', checksFile: FILE, checks: CHECKS, project }, { main }), { code: 'BAD_ARGS' }, 'both');
  await assert.rejects(run({ org: 'o', checks: CHECKS }, { main }), { code: 'BAD_ARGS' }, 'no project');
  await assert.rejects(run({ org: 'o', checksFile: FILE, project }, { main }), { code: 'BAD_ARGS' }, 'a project beside a check file');
  await assert.rejects(run({ org: 'o', checks: CHECKS, project: path.relative(process.cwd(), project) }, { main }), { code: 'BAD_ARGS' }, 'a relative project');
  // A folder below a project would make verify find the one above it.
  fs.mkdirSync(path.join(project, 'sub'), { recursive: true });
  await assert.rejects(run({ org: 'o', checks: CHECKS, project: path.join(project, 'sub') }, { main }), { code: 'BAD_ARGS' }, 'no sfdx-project.json in the folder');
  assert.equal(calls.length, 0);
});

test('inline checks reach verify as a file of the tool\'s own in the project, gone after the run', async () => {
  const { calls, main } = stub(0, { seen: true });
  await run({ org: 'o', checks: CHECKS, project }, { main });
  assert.deepEqual(calls[0].file, { checks: CHECKS });
  assert.equal(path.dirname(path.dirname(calls[0].a.checks)), project, 'inside the project, so verify finds it');
  assert.equal(fs.existsSync(calls[0].a.checks), false);
  // A throw leaves no file behind either.
  const boom = async (a) => { calls.push({ a }); throw new Error('boom'); };
  await assert.rejects(run({ org: 'o', checks: CHECKS, project }, { main: boom }), /boom/);
  assert.equal(fs.existsSync(path.dirname(calls[1].a.checks)), false);
  assert.deepEqual(fs.readdirSync(project).filter((f) => f.startsWith('.sf-tester-checks-')), []);
});

test('a folder a dead run left is removed by the next run, and one a run still uses is kept', async () => {
  const stale = path.join(project, '.sf-tester-checks-dead');
  const live = path.join(project, '.sf-tester-checks-live');
  fs.mkdirSync(stale); fs.mkdirSync(live);
  const old = new Date(Date.now() - 3 * 60 * 60_000);
  fs.utimesSync(stale, old, old);
  await run({ org: 'o', checks: CHECKS, project }, { main: stub().main });
  assert.deepEqual([fs.existsSync(stale), fs.existsSync(live)], [false, true]);
  fs.rmSync(live, { recursive: true });
});

test('how old a folder must be to count as dead follows the validate\'s own time limit', async (t) => {
  const { VALIDATE } = require('../src/cascade-log');
  const was = VALIDATE.minutes;
  t.after(() => { VALIDATE.minutes = was; });
  VALIDATE.minutes = 60;
  const dead = path.join(project, '.sf-tester-checks-3h');
  fs.mkdirSync(dead);
  t.after(() => fs.rmSync(dead, { recursive: true, force: true }));
  const old = new Date(Date.now() - 3 * 60 * 60_000);
  fs.utimesSync(dead, old, old);
  await run({ org: 'o', checks: CHECKS, project }, { main: stub().main });
  assert.equal(fs.existsSync(dead), true, 'a run may still use it under a 60 min validate');
});

test('a folder another run removes while this one sweeps does not stop this run', async () => {
  // A dangling link is listed, then gone at the stat, as a parallel run's folder is when its run ends in between.
  const gone = path.join(project, '.sf-tester-checks-gone');
  fs.symlinkSync(path.join(project, 'no-such-folder'), gone);
  try {
    assert.equal((await run({ org: 'o', checks: CHECKS, project }, { main: stub(0, { lines: ['PASS a/b'] }).main })).verdict, 'green');
  } finally { fs.rmSync(gone, { force: true }); }
});

test('since is a ref, never a git option', async () => {
  const { calls, main } = stub();
  for (const since of ['--output=/tmp/x', '-p']) await assert.rejects(run({ org: 'o', checksFile: FILE, since }, { main }), { code: 'BAD_ARGS' }, since);
  assert.equal(calls.length, 0);
  await run({ org: 'o', checksFile: FILE, since: 'origin/main' }, { main });
  assert.equal(calls[0].a.since, 'origin/main', 'control: a ref reaches verify');
});

test('only org, the check file, since and only reach verify: no --cascade deploy, no --junit file', async () => {
  const { calls, main } = stub();
  await run({ org: 'o', checksFile: FILE, since: 'HEAD~1', only: ['a'], cascade: true, junit: '/tmp/x.xml', plan: true, matrix: true }, { main });
  assert.deepEqual(calls[0].a, { org: 'o', checks: FILE, since: 'HEAD~1', only: '^(?:a)$' });
  assert.equal(typeof calls[0].o.git, 'function', 'a git runner, as the CLI passes');
});

test('only is check ids, matched whole and literally, never a pattern', async () => {
  const { calls, main } = stub();
  await run({ org: 'o', checksFile: FILE, only: ['probe-ping', '(a+)+$', 'x.y'] }, { main });
  const re = new RegExp(calls[0].a.only);
  assert.deepEqual(['probe-ping', '(a+)+$', 'x.y', 'probe-ping-2', 'aaaa', 'xzy'].map((id) => re.test(id)), [true, true, true, false, false, false]);
});

test('a problem about only names the ids sent, not the pattern made from them', async () => {
  // verify's own wording: it refuses an only that names no check before it reads the org.
  const fixture = path.join(__dirname, 'fixture', 'verify-checks.json');
  for (const id of ['probe-png', "a$'b$&"]) {
    assert.deepEqual((await run({ org: 'no-such-alias', checksFile: fixture, only: [id] })).problems, [`only ${JSON.stringify([id])} matches no check`], id);
  }
});

test('the exit code is the verdict, and verify\'s lines come back', async () => {
  assert.deepEqual(await run({ org: 'o', checksFile: FILE }, { main: stub(1, { lines: ['FAIL a/b x'] }).main }), { verdict: 'red', exit: 1, lines: ['FAIL a/b x'] });
  assert.equal((await run({ org: 'o', checksFile: FILE }, { main: stub(0, { lines: ['PASS a/b'] }).main })).verdict, 'green');
  assert.equal((await run({ org: 'o', checksFile: FILE, since: 'x' }, { main: stub(0, { lines: ['since x, 2 files changed', 'no checkable change since x'] }).main })).verdict, 'nothing checked', 'exit 0 with no check run');
  const usage = `p is a production org\n${require('../src/verify').USAGE}`;
  assert.deepEqual(await run({ org: 'o', checksFile: FILE }, { main: stub(2, { problems: [usage] }).main }), { verdict: 'not run', exit: 2, lines: [], problems: ['p is a production org'] });
});
