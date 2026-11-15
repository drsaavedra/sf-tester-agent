#!/usr/bin/env node
'use strict';

// node src/cli.js replay: the catalogue's tested routes with no model, for CI, or with --since those a diff reaches.
// Exit 0 all green or none to run, 1 any red (a route, a record left, or a route stale to remap), 2 bad usage, a route
// it cannot fill, or an org that cannot be read at connect.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { replay, junit, unxml, tried } = require('./replay');
const combinations = require('./combinations');
const { select, rootOf } = require('./select');
const verify = require('./verify');

const USAGE = 'usage: sf-tester replay --org <alias> [--app <app>] [--catalogue <file>] [--only <regex>] [--since <git-ref>] [--plan] [--values <file>] [--junit <out.xml>] [--side-effects] [--baseline]';
const OPTIONS = { org: { type: 'string' }, app: { type: 'string' }, catalogue: { type: 'string' }, only: { type: 'string' }, since: { type: 'string' }, plan: { type: 'boolean' }, matrix: { type: 'boolean' }, values: { type: 'string' }, junit: { type: 'string' }, 'side-effects': { type: 'boolean' }, baseline: { type: 'boolean' }, checks: { type: 'string' }, cascade: { type: 'boolean' } };
// Past the 1 MiB default: git show prints the whole base catalogue.
const gitRun = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

// The selection for --since: the diff from the merge base of ref and HEAD, and the catalogue at that merge base.
function affected(ref, file, git, warn) {
  const base = git(['merge-base', ref, 'HEAD']).trim();
  // --no-renames: a rename lists the old path too, so routes naming the old component are selected.
  // -z: a path git would quote (non-ASCII) comes through as it is on disk.
  const files = git(['diff', '-z', '--name-only', '--no-renames', `${ref}...HEAD`]).split('\0').filter(Boolean);
  const top = git(['rev-parse', '--show-toplevel']).trim();
  const rel = path.relative(fs.realpathSync(top), fs.realpathSync(file));
  let then = '{}';
  try { then = git(['show', `${base}:${rel}`]); } catch (e) {
    // Not in the base, so every entry is new; any other git failure is reported.
    if (!/does not exist in|exists on disk, but not in/.test(String(e.stderr))) throw e;
  }
  const dirs = packages(top, git, warn);
  return { ref, base, files, ...select(files, JSON.parse(then), combinations.catalogue({ file }), tabLabels(files, base, git, top, dirs), dirs) };
}

// The package directories of every sfdx-project.json in the repo (tracked, or new and not ignored), each prefixed with
// its file's folder, so a project in a subfolder or several projects select too.
function packages(top, git, warn = console.error) {
  const found = git(['-C', top, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'sfdx-project.json', '**/sfdx-project.json']).split('\0').filter(Boolean);
  return found.filter((rel) => fs.existsSync(path.join(top, rel))).flatMap((rel) => {
    let dirs;
    try { dirs = verify.readProject(path.join(top, rel)).dirs; } catch (e) {
      // A bad project file below the top (a template, a scratch copy) is not read: its whole folder takes the smoke
      // slice, so a change in it is never a green with nothing run. The top one is bad usage.
      if (rel === 'sfdx-project.json' || !(e instanceof verify.Usage)) throw e;
      warn(`${e.message}: its files take the smoke slice`);
      return [path.posix.dirname(rel)];
    }
    return dirs.map((d) => path.posix.join(path.posix.dirname(rel), d));
  });
}

// Each changed tab or app file's <label> at the merge base, at HEAD and on disk: a rename keeps the old label in the
// routes until edited, and an uncommitted edit is what the catalogue on disk is replayed against.
function tabLabels(files, base, git, top, dirs = []) {
  const labelled = files.filter((x) => /^(tabs|applications)\//i.test(x.slice(rootOf(x, dirs)?.length ?? x.length)));
  if (!labelled.length) return {};
  top ??= git(['rev-parse', '--show-toplevel']).trim();
  const label = (read) => {
    try { return unxml(read().match(/<label>([^<]*)<\/label>/)?.[1] || '').trim(); } catch (e) {
      // Added on this branch (none at the base) or deleted (none now); any other git failure is reported.
      if (e.code === 'ENOENT' || /does not exist in|exists on disk, but not in/.test(String(e.stderr))) return '';
      throw e;
    }
  };
  const out = {};
  for (const f of labelled) {
    const all = [`${base}:${f}`, `HEAD:${f}`].map((at) => label(() => git(['show', at]))).concat(label(() => fs.readFileSync(path.join(top, f), 'utf8')));
    out[f] = [...new Set(all.filter(Boolean))];
  }
  return out;
}

// The first five of a list, then "and N more".
const shown = (from) => (from.length > 5 ? `${from.slice(0, 5).join(', ')} and ${from.length - 5} more` : from.join(', '));
// A route that needed a rerun says so, with its first red's first line unless the rerun repeated it, so a pass hides no flake.
const rerun = ({ status, step, error, retried: t }) => {
  const first = (status === 'fail' && t.step === step && t.error === error) ? '' : tried(t).split('\n')[0];
  return `(${status === 'pass' ? 'passed on rerun' : 'red on rerun too'}${first && `; first try: ${first}`})`;
};
// A red names the requirement its route proves, so the reader sees what broke, not only which step.
// A red on a changed page is still a red: STALE leads the line so the reader looks at the page first.
const word = (r) => (r.stale && r.status === 'fail' ? 'STALE' : r.status.toUpperCase());
const line = (r) => [word(r), r.id, `${r.ms}ms`, r.step != null && `step ${r.step}`, r.error, r.reason, r.note && `(${r.note})`, r.stale && `(changed since saved: ${r.stale.join('; ')})`, r.unread && `(not read: ${r.unread.join('; ')})`, r.retried && rerun(r), r.status === 'fail' && r.requirement && `(requirement: ${r.requirement})`].filter(Boolean).join(' ');

async function main(argv, { log = console.log, warn = console.error, git = gitRun, ...inject } = {}) {
  let opts;
  let since;
  let ref;
  let plan;
  let check;
  try {
    const { values: a, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    plan = !!a.plan;
    if (positionals.join(' ') === 'verify') check = a;
    else {
      for (const o of ['cascade', 'matrix', 'checks']) if (a[o] !== undefined) throw new Error(`--${o} is a verify option; replay does not take it`);
      if (positionals.join(' ') !== 'replay' || !(a.org || plan)) throw new Error('replay needs --org, except with --plan');
      // Never the bundled fixture catalogue by default: its routes create fixture records in whatever org --org names.
      const file = a.catalogue || process.env.SF_TESTER_COMBINATIONS;
      if (!file) throw new Error('name the catalogue with --catalogue or SF_TESTER_COMBINATIONS (the fixture routes are src/combinations.json)');
      if (!fs.existsSync(file)) throw new Error(`no catalogue at ${file}`);
      try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not a JSON catalogue: ${e.message}`); }
      const values = a.values ? JSON.parse(fs.readFileSync(a.values, 'utf8')) : {};
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`--values ${a.values} must hold a JSON object of placeholder values`);
      opts = { org: a.org, app: a.app, file: path.resolve(file), only: a.only && new RegExp(a.only), values, sideEffects: !!a['side-effects'] || process.env.SF_TESTER_REPLAY_SIDE_EFFECTS === '1', junit: a.junit, baseline: !!a.baseline };
      ref = a.since;
    }
  } catch (e) {
    // A parse error names the subcommand's own usage.
    warn(`${e.message}\n${argv.find((x) => x === 'verify' || x === 'replay') === 'verify' ? verify.USAGE : USAGE}`);
    return 2;
  }
  if (check) return verify.main(check, { log, warn, git, ...inject });
  // A git error (a bad ref) or a malformed sfdx-project.json at the repo top is bad usage; anything else is a bug and
  // throws.
  if (ref) {
    try { since = affected(ref, opts.file, git, warn); } catch (e) {
      if (e.stderr == null && !(e instanceof verify.Usage)) throw e;
      warn(`${String(e.stderr ?? '').trim() || e.message}\n${USAGE}`);
      return 2;
    }
  }
  log(`catalogue ${opts.file}`);
  if (since) {
    log(`since ${since.ref} (merge base ${since.base.slice(0, 7)}), ${since.files.length} files changed`);
    for (const r of since.reasons) log(`  ${r.reason} ${r.ids.length}${r.from.length ? `: ${shown(r.from)}` : ''}`);
    // The one empty run that is green: a change no route can see. An --only that empties it still exits 2.
    if (!since.ids.length) {
      log(`no route affected by ${since.ref}`);
      if (!plan) { if (opts.junit) fs.writeFileSync(opts.junit, junit([])); return 0; } // an empty suite, not no file
    }
    opts.ids = new Set(since.ids);
  }
  // One verdict for --plan and the run: what --since and --only keep, less the sideEffects routes a replay skips.
  const all = combinations.list({ file: opts.file }).filter((e) => e.status === 'tested' && (!opts.ids || opts.ids.has(e.id)));
  const kept = all.filter((e) => !opts.only || opts.only.test(e.id));
  const skipped = opts.sideEffects ? [] : kept.filter((e) => e.sideEffects);
  const runs = kept.length - skipped.length;
  // Printed by a replay as by --plan, so the run's head shows what it will run.
  if (opts.only) log(`--only ${opts.only.source} keeps ${kept.length} of ${all.length}`);
  log(`total ${runs}${skipped.length ? ` (${skipped.length} sideEffects skipped)` : ''}`);
  if (since?.ids.length && kept.length && !runs) {
    log(`no route to run: every route ${since.ref} affects has sideEffects (--side-effects runs them)`);
    if (!plan && opts.junit) fs.writeFileSync(opts.junit, junit(skipped.map((e) => ({ id: e.id, status: 'skip', ms: 0, reason: `sideEffects: ${e.sideEffects}` }))));
    return 0;
  }
  if (plan) {
    if (runs || (since && !since.ids.length)) return 0;
    warn('no route ran: check the catalogue and --only');
    return 2;
  }
  // Collected as they come, so a run that throws still prints its count and writes its JUnit.
  const results = [];
  const cleanup = [];
  const errors = [];
  let thrown;
  try {
    await replay({ ...opts, ...inject,
      onProduction: (org) => log(`production org: ${org}`),
      onLeftover: (gone, already, of) => log(`removed ${gone} of ${of} records an earlier run left${already ? `, ${already} already gone` : ''}`),
      onWarn: warn,
      onResult: (r) => { results.push(r); log(line(r)); },
      onCleanup: (c) => { cleanup.push(c); log(`CLEANUP FAIL ${c.sobject} ${c.id} ${c.error}`); },
      onError: (m) => { errors.push(m); log(`ERROR ${m}`); } });
  } catch (e) {
    thrown = e;
    errors.push(e.message);
    warn(e.message);
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  // Before the report, so it can name a catalogue it could not write. A red carries no read, so it keeps its old baseline.
  const reads = results.filter((r) => r.validity);
  if (opts.baseline) {
    try {
      const carried = reads.length ? combinations.baseline(Object.fromEntries(reads.map((r) => [r.id, r.validity])), { file: opts.file }) : [];
      log(`baseline ${reads.length} of ${count('pass')} green routes, ${reads.filter((r) => r.validity.page).length} on a record page${carried.length ? `, ${carried.length} kept a saved set hash: ${shown(carried)}` : ''}, in ${opts.file}`);
    } catch (e) {
      errors.push(`baseline: ${e.message}`);
      log(`ERROR ${errors.at(-1)}`);
    }
  }
  const moved = results.filter((r) => r.stale).length;
  const remap = results.filter((r) => r.remap).length;
  const flaky = results.filter((r) => r.retried && r.status === 'pass').length;
  log(`checked ${results.length}, passed ${count('pass')}, failed ${count('fail')}, skipped ${count('skip')}${flaky ? `, ${flaky} passed on rerun` : ''}${remap ? `, ${remap} stale to remap` : ''}${moved ? `, ${moved} on a changed page` : ''}${cleanup.length ? `, left ${cleanup.length} records` : ''}${errors.length ? `, ${errors.length} errors` : ''}`);
  // A record left is red in the exit code, so it is an error case in the report too.
  if (opts.junit) fs.writeFileSync(opts.junit, junit(results, [...errors, ...cleanup.map((c) => ({ name: `cleanup ${c.sobject} ${c.id}`, message: c.error }))]));
  // A catalogue that cannot fill a route, an --org with no auth here, or one that cannot be read at connect (as verify)
  // is a run that could not start, not a red route.
  if (thrown) return ['BAD_ARGS', 'NO_AUTH', 'AUTH_UNREADABLE'].includes(thrown.code) || (thrown.code === 'API_ERROR' && thrown.evidence?.phase === 'connect') ? 2 : 1;
  if (errors.length) return 1;
  // Nothing ran is never green: a wrong catalogue or an --only that matches nothing tested nothing.
  // A route stale to remap is a page change, so even when every route is, that is red (1), not bad usage (2).
  if (!results.some((r) => r.status !== 'skip')) {
    if (remap) { warn(`no route ran: ${remap} stale, remap them with the tester`); return 1; }
    // A production run skips a persona's route, so a run of those (and sideEffects skips) is not a catalogue fault.
    warn(results.some((r) => r.reason?.startsWith('persona:')) && results.every((r) => /^(persona|sideEffects):/.test(r.reason)) ? 'no route ran: only persona routes, which a production run does not replay' : 'no route ran: check the catalogue and --only');
    return 2;
  }
  // A stale route is skipped in the summary and a failure in JUnit: a page change must not merge green, so exit 1.
  return count('fail') || cleanup.length || remap ? 1 : 0;
}

// A cancelled CI job (SIGTERM) or Ctrl-C stops after the route in hand, so cleanup still deletes the run's records.
// process.on, not once: signal-exit (under @salesforce/core) kills the process when it is a signal's only listener.
const CODES = { SIGINT: 130, SIGTERM: 143 };
function stopOnSignals() {
  const stop = new AbortController();
  for (const sig of Object.keys(CODES)) {
    process.on(sig, () => {
      if (stop.signal.aborted) process.exit(CODES[sig]); // a second signal does not wait for cleanup
      console.error(`${sig}: stopping after this route, then cleaning up`);
      stop.abort(sig);
    });
  }
  return stop.signal;
}

if (require.main === module) {
  const signal = stopOnSignals();
  main(process.argv.slice(2), { signal }).then((code) => { process.exitCode = signal.aborted ? CODES[signal.reason] : code; });
}

module.exports = { main, line, stopOnSignals, tabLabels, packages, CODES };
