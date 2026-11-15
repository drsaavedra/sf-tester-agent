#!/usr/bin/env node
'use strict';

// PreToolUse guard for arm G's Bash: one plain sf read on a scratch org, reaching what sf-tester's own reads reach
// (sf_api's READ_ROOTS, sf_object_context's describes). No shell syntax, no file flag, no write. Only denies, exit 2.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertRead } = require('../src/api');
const { words, ORG_FLAGS, username } = require('./sh');

const deny = (why) => {
  console.error(`sf read guard: ${why} is refused. Run one sf data query, sf sobject describe|list or sf api request rest (GET), with -o <scratch org alias>.`);
  process.exit(2);
};
process.on('uncaughtException', (e) => deny(`this call (guard error: ${e.message})`));


// Each command's flags; true takes a value. Nothing that reads or writes a file (--file, --output-file, --flags-dir, --body).
const ORG = Object.fromEntries(ORG_FLAGS.map((f) => [f, true]));
const FLAGS = {
  'data query': { ...ORG, '-q': true, '--query': true, '-t': false, '--use-tooling-api': false, '-r': true, '--result-format': true, '--all-rows': false, '--json': false },
  'sobject describe': { ...ORG, '-s': true, '--sobject': true, '-t': false, '--use-tooling-api': false, '--json': false },
  'sobject list': { ...ORG, '-s': true, '--sobject': true, '--json': false },
  'api request rest': { ...ORG, '-X': true, '--method': true, '-i': false, '--include': false },
};
const ONLY = { '-X': ['GET'], '--method': ['GET'], '-r': ['human', 'csv', 'json'], '--result-format': ['human', 'csv', 'json'] };

// A scratch org only, as the CLI's own auth file says; the file holds tokens, and only isScratch is read from it.
function scratch(org) {
  const dir = path.join(os.homedir(), '.sfdx');
  const user = username(org);
  if (path.basename(user) !== user) return false;
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${user}.json`), 'utf8')).isScratch === true; } catch { return false; }
}

const { tool_input: { command = '' } = {} } = JSON.parse(fs.readFileSync(0, 'utf8'));
let w;
try { w = words(command); } catch (e) { deny(`${command} (${e.message})`); }
if (w[0] !== 'sf') deny(w[0] ?? 'an empty command');
const cmd = Object.keys(FLAGS).find((k) => w.slice(1, 1 + k.split(' ').length).join(' ') === k);
if (!cmd) deny(`sf ${w.slice(1, 4).join(' ')}`);
const args = w.slice(1 + cmd.split(' ').length);
const positional = [];
let org;
for (let i = 0; i < args.length; i += 1) {
  const eq = args[i].startsWith('-') ? args[i].indexOf('=') : -1;
  const flag = eq > 0 ? args[i].slice(0, eq) : args[i];
  let value = eq > 0 ? args[i].slice(eq + 1) : undefined;
  if (!flag.startsWith('-')) { positional.push(flag); continue; }
  if (!Object.hasOwn(FLAGS[cmd], flag)) deny(`flag ${flag}`);
  if (FLAGS[cmd][flag]) { if (value === undefined) { i += 1; value = args[i]; } if (value === undefined) deny(`${flag} with no value`); }
  else if (value !== undefined) deny(`${args[i]}`);
  if (ONLY[flag] && !ONLY[flag].includes(value)) deny(`${flag} ${value}`);
  if (flag in ORG) { if (org !== undefined) deny(`a second org flag ${flag}`); org = value; } // the CLI might use either one
}
if (!org) deny('a call with no -o');
if (!scratch(org)) deny(`org ${org} (not a scratch org this CLI knows)`);
if (cmd === 'api request rest') {
  if (positional.length !== 1) deny('a REST call without exactly one path');
  const m = positional[0].match(/^\/?services\/data\/v\d+\.\d+(\/.*)$/);
  if (!m) deny(`path ${positional[0]}`);
  try { assertRead(m[1]); } catch { deny(`path ${positional[0]}`); }
} else if (positional.length) deny(`argument ${positional[0]}`);
