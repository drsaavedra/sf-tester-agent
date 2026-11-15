'use strict';

// Arm G's Bash guard: one plain sf read on a scratch org, reaching what sf-tester's own reads reach, and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'bench', 'sf-read-guard.js');
// A home whose sf CLI state knows one scratch org and one that is not, with no tokens in either file.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-read-guard-'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
fs.mkdirSync(path.join(home, '.sfdx'));
fs.writeFileSync(path.join(home, '.sfdx', 'alias.json'), JSON.stringify({ orgs: { scr: 's@x.test', prod: 'p@x.test' } }));
fs.writeFileSync(path.join(home, '.sfdx', 's@x.test.json'), JSON.stringify({ username: 's@x.test', isScratch: true }));
fs.writeFileSync(path.join(home, '.sfdx', 'p@x.test.json'), JSON.stringify({ username: 'p@x.test', isScratch: false }));

const guard = (command) => spawnSync('node', [GUARD], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...process.env, HOME: home } });

test('the reads sf-tester makes pass: a query, a tooling query, a describe, a REST GET under a read root, on a scratch org', () => {
  const ok = [
    `sf data query -q "SELECT Id FROM Account" -o scr`,
    `sf data query --query 'SELECT COUNT() FROM Property__c WHERE Status__c = '"'"'Available'"'"'' --target-org=scr --json`,
    `sf data query -q 'SELECT Name FROM ApexClass' -o scr -t`,
    `sf sobject describe -s Property__c -o scr --json`,
    `sf api request rest '/services/data/v60.0/query?q=SELECT+Id+FROM+Account' -o scr`,
    `sf api request rest /services/data/v62.0/ui-api/object-info/Account -o scr -X GET`,
    `sf sobject list -s custom -o s@x.test`,
    `sf data query -q "SELECT Id FROM Property__c WHERE Status__c != 'Sold'" -o scr`, // a non-interactive shell expands no !
  ];
  for (const c of ok) assert.equal(guard(c).status, 0, `${c}: ${guard(c).stderr}`);
  assert.equal(ok.length, 8, 'checked 8 allowed reads');
});

test('anything else is refused: Apex on a GET, a write, another org, a file, shell syntax, another command', () => {
  const bad = [
    `sf api request rest /services/data/v60.0/tooling/executeAnonymous?anonymousBody=System.debug(1) -o scr`,
    `sf api request rest '/services/data/v60.0/tooling/executeAnonymous?anonymousBody=x' -o scr`,
    `sf api request rest /services/data/v60.0/sobjects/../tooling/executeAnonymous -o scr`,
    `sf api request rest /services/data/v60.0/sobjects/%2e%2e/tooling/executeAnonymous -o scr`,
    `sf api request rest /services/data/v60.0/sobjects/Account -o scr -X POST`,
    `sf api request rest /services/data/v60.0/sobjects/Account -o scr --body x`,
    `sf data query -q 'SELECT Id FROM Account' -o prod`,
    `sf data query -q 'SELECT Id FROM Account' -o nobody`,
    `sf data query -q 'SELECT Id FROM Account'`,
    `sf data query --file q.soql -o scr`,
    `sf data query --file=q.soql -o scr`,
    `sf data query -q 'SELECT Id FROM Account' -o scr --output-file=out.csv`,
    `sf data query -q 'SELECT Id FROM Account' -o scr --output-file out.csv`,
    `sf data query -q 'SELECT Id FROM Account' -o scr --flags-dir /tmp`,
    `sf data query -q x -o scr; cat ~/.sf-tester/bench/key/corpus.json`,
    `sf data query -q "$(cat ~/.sf-tester/bench/key/corpus.json)" -o scr`,
    'sf data query -q `id` -o scr',
    `sf data query -q x -o scr > out.txt`,
    `cat ~/.sf-tester/bench/key/corpus.json`,
    `sf apex run -o scr`,
    `sf project deploy start -o scr`,
    `sf data query -q x -o prod -o scr`, // the guard would judge one org and the CLI might use the other
    `sf data query -q x --target-org=scr -o scr`,
    `sf data query SELECT -o scr`, // a query takes no positional argument
    `sf data query -q x -o scr -r xml`, // nor a result format outside human, csv and json
  ];
  for (const c of bad) {
    const r = guard(c);
    assert.equal(r.status, 2, c);
    assert.match(r.stderr, /sf read guard: .* is refused/, c);
  }
  assert.equal(bad.length, 25, 'checked 25 refusals');
  assert.match(guard(`sf data query -q x -o prod --target-org scr`).stderr, /a second org flag --target-org is refused/, 'the refusal names the flag');
});
