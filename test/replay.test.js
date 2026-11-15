'use strict';

// The replay with no org: placeholders made in dependency order through a fake creator, so these run offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const replay = require('../src/replay');
const cli = require('../src/cli');
const { combinations } = require('..');

// The replay keeps the records it made under ~/.sf-tester: a home of the tests' own, so no run here touches the real one.
// os.homedir, not HOME: a server this file starts must still find the sf CLI's auth.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-home-'));
os.homedir = () => testHome;
// Every replay here runs in one process, which takes what an earlier replay in it left: each test starts with none.
test.afterEach(() => fs.rmSync(path.join(testHome, '.sf-tester'), { recursive: true, force: true }));

const PH = {
  accountId: { about: 'an Account Id', create: { sobject: 'Account', fields: { Name: '{{accountName}}' } } },
  accountName: { about: "that Account's Name", value: 'acct {{stamp}}', with: ['accountId'] },
  contactName: { about: 'a Contact on it', value: 'c{{stamp}}', with: ['contactId'] },
  contactId: { about: 'that Contact', create: { sobject: 'Contact', fields: { LastName: '{{contactName}}', AccountId: '{{accountId}}' } } },
  probeName: { about: "that probe's Name", value: 'p{{stamp}}n{{routeIndex}}', with: ['probeId'] },
  probeId: { about: 'a probe', create: { sobject: 'SfUiProbe__c', fields: { Name: '{{probeName}}', Count__c: 1 } } },
  dynId: { about: 'a dyn', perRoute: true, create: { sobject: 'SfUiDyn__c', fields: { Name: 'dyn {{stamp}}' } } },
  uploadName: { about: 'a file name', value: 'f-{{stamp}}.txt' },
  uploadFile: { about: 'a path', tempFile: { name: '{{uploadName}}', content: 'combo' } },
  caseId: 'a Case Id',
};

test('order puts each placeholder after the ones its templates use, and brings in what it is made with', () => {
  assert.deepEqual(replay.order(PH, ['accountName']), ['accountName', 'accountId']);
  assert.deepEqual(replay.order(PH, ['contactName']), ['contactName', 'accountName', 'accountId', 'contactId']);
  assert.deepEqual(replay.order(PH, ['accountId', 'uploadFile']), ['accountName', 'accountId', 'uploadName', 'uploadFile']);
});

test('order refuses a cycle, naming it', () => {
  const cyclic = { a: { value: '{{b}}' }, b: { create: { sobject: 'X', fields: { Name: '{{a}}' } } } };
  assert.throws(() => replay.order(cyclic, ['a']), { code: 'BAD_ARGS', message: /cycle: a -> b -> a/ });
});

test('a description-only placeholder with no value is refused by name; --values supplies it', () => {
  assert.throws(() => replay.order(PH, ['caseId', 'accountId']), { code: 'BAD_ARGS', message: /no value for caseId \(a Case Id\)/ });
  assert.deepEqual(replay.order(PH, ['caseId', 'accountId'], { caseId: '500X' }), ['accountName', 'accountId']);
});

test('a placeholder given in --values is not made, nor anything only it would have used', async () => {
  const given = { accountId: '001GIVEN', accountName: 'Given Co' };
  const names = replay.order(PH, ['accountName', 'contactName'], given);
  assert.deepEqual(names, ['contactName', 'contactId']);
  const made = [];
  const values = await replay.make(PH, names, { stamp: '42', ...given }, { create: async (sobject) => `${sobject}#${made.length}`, made });
  assert.deepEqual(made.map((m) => m.sobject), ['Contact'], 'no Account made');
  assert.equal(values.accountId, '001GIVEN');
});

test('a record given in --values without the name made with it is refused, naming both', () => {
  assert.throws(() => replay.order(PH, ['accountName'], { accountId: '001GIVEN' }), { code: 'BAD_ARGS', message: /--values gives accountId but not accountName, which is made with it: give both/ });
  assert.deepEqual(replay.order(PH, ['accountId'], { accountName: 'Given Co' }), ['accountId'], 'control: a given name with its record made is fine');
});

test('make fills templates, keeps non-string fields, writes a temp file, and records what it made', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const calls = [];
  const made = [];
  const create = async (sobject, fields) => { calls.push({ sobject, fields }); return `${sobject}#${calls.length}`; };
  const values = await replay.make(PH, replay.order(PH, ['probeName', 'uploadFile']), { stamp: '42', routeIndex: '007' }, { create, made, tempDir: () => dir });
  assert.deepEqual(calls, [{ sobject: 'SfUiProbe__c', fields: { Name: 'p42n007', Count__c: 1 } }]);
  assert.deepEqual(made, [{ sobject: 'SfUiProbe__c', id: 'SfUiProbe__c#1' }]);
  assert.equal(values.probeId, 'SfUiProbe__c#1');
  assert.equal(fs.readFileSync(values.uploadFile, 'utf8'), 'combo');
  assert.equal(path.basename(values.uploadFile), 'f-42.txt');
});

test('perRoute covers a marked placeholder, one using routeIndex, and one using either', () => {
  const names = replay.order(PH, ['probeName', 'accountName', 'dynId']);
  assert.deepEqual([...replay.perRoute(PH, names)].sort(), ['dynId', 'probeId', 'probeName']);
});

test('the bundled catalogue says how to make every placeholder its tested routes need, a probe, a pair, a child, a level and a task per route', () => {
  const { placeholders } = combinations.catalogue({ file: combinations.BUNDLED });
  const all = replay.order(placeholders, combinations.list({ file: combinations.BUNDLED }).filter((c) => c.status === 'tested').flatMap((c) => c.needs));
  assert.deepEqual([...all].sort(), Object.keys(placeholders).sort(), 'every placeholder is reached, none is missing');
  assert.deepEqual([...replay.perRoute(placeholders, all)].sort(), ['childId', 'childName', 'levelId', 'levelName', 'pairId', 'pairName', 'probeId', 'probeName', 'taskId']);
});

// "User User" is only a scratch org admin's default name: a route that types it is red on the CI org (gate M1).
test('no tested route types the scratch org admin\'s default name', () => {
  const typed = combinations.list({ file: combinations.BUNDLED }).filter((c) => c.status === 'tested' && JSON.stringify(c.route).includes('User User')).map((c) => c.id);
  assert.deepEqual(typed, []);
});

test('fill lists the placeholders of the catalogue in use when a value is missing', () => {
  const own = { caseId: 'a Case Id', accountId: { about: 'an Account Id', value: 'x' } };
  assert.throws(() => combinations.fill([{ args: { recordId: '{{caseId}}' } }], {}, own), (e) => e.code === 'BAD_ARGS' && JSON.stringify(e.evidence.placeholders) === JSON.stringify({ caseId: 'a Case Id', accountId: 'an Account Id' }));
  assert.throws(() => combinations.fill([{ args: { recordId: '{{caseId}}' } }], {}), (e) => 'probeId' in e.evidence.placeholders, 'control: the default catalogue without one');
});

test('sf_combinations shows an object placeholder as its about, so the agent view does not change', () => {
  assert.deepEqual(combinations.describe({ a: 'text', b: { about: 'b text', value: 'x' } }), { a: 'text', b: 'b text' });
});

// Four routes through a fake server and a fake REST that log what they are asked, in order.
function fake(t, { failDelete, placeholders = PH } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-')), 'combinations.json');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true }));
  const entry = (id, needs, text, more) => ({ id, needs, status: 'tested', route: [{ tool: 'sf_open_record', args: { recordId: '{{probeId}}' } }, { tool: 'sf_wait', args: { text } }], ...more });
  fs.writeFileSync(file, JSON.stringify({ placeholders, candidates: [], combinations: [
    entry('a@x', ['probeId', 'accountName', 'contactName'], 'Company {{accountName}}'),
    entry('b@x', ['probeName'], 'Probe {{probeName}}'),
    entry('c@x', ['probeId', 'childName'], 'red', { requirement: 'The child shows red' }),
    entry('d@x', ['probeId', 'dynId'], 'mail', { sideEffects: 'sends an email' }),
  ] }));
  const log = [];
  const rest = {
    create: async (sobject, fields) => { log.push(`create ${sobject}#${log.length} ${fields.Name || fields.LastName}`); return `${sobject}#${log.length - 1}`; },
    remove: async (sobject, id) => { log.push(`delete ${id}`); if (id === failDelete) throw new Error('API_ERROR: DELETE answered 500'); },
  };
  const tools = {
    call: async (name, args) => {
      log.push(`call ${name}${args.steps ? ` ${args.steps[1].args.text}` : ''}`);
      if (args.steps?.[1].args.text === 'red') return { isError: true, text: JSON.stringify({ code: 'ROUTE_STEP_FAILED', message: 'ROUTE_STEP_FAILED: sf_wait failed', evidence: { failedAt: 1, tool: 'sf_wait', error: 'TIMEOUT: no "red" in 10000 ms' } }) };
      return { isError: false, text: '{}' };
    },
    close: async () => log.push('close'),
  };
  return { file, rest, tools, log };
}
const CHILD = { ...PH, childName: { about: 'a child', value: 'child {{stamp}}n{{routeIndex}}', with: ['childId'] }, childId: { about: 'that child', perRoute: true, create: { sobject: 'SfUiDyn__c', fields: { Name: '{{childName}}', Probe__c: '{{probeId}}' } } } };

test('replay makes a run-wide record once, only if a route needs it, and a per-route one for each route', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const { stamp, results, cleanup } = await replay.replay({ org: 'x', file, rest, tools });
  const made = (sobject) => log.filter((l) => l.startsWith(`create ${sobject}#`)).map((l) => l.split(' ').slice(2).join(' '));
  assert.deepEqual(made('Account'), [`acct ${stamp}`]);
  assert.deepEqual(made('Contact'), [`c${stamp}`]);
  // c@x is red, so it runs once more on fresh per-route records, named apart from the first try's.
  assert.deepEqual(made('SfUiProbe__c'), [`p${stamp}n000`, `p${stamp}n001`, `p${stamp}n002`, `p${stamp}nr002`]);
  assert.deepEqual(made('SfUiDyn__c'), [`child ${stamp}n002`, `child ${stamp}nr002`], 'no dynId: its only route was skipped');
  assert.deepEqual(results.map((r) => [r.id, r.status, r.step, r.error, r.reason]), [
    ['a@x', 'pass', undefined, undefined, undefined], ['b@x', 'pass', undefined, undefined, undefined],
    ['c@x', 'fail', 1, 'sf_wait: TIMEOUT: no "red" in 10000 ms', undefined], ['d@x', 'skip', undefined, undefined, 'sideEffects: sends an email']]);
  assert.deepEqual(results.map((r) => r.requirement), [undefined, undefined, 'The child shows red', undefined], 'a route\'s requirement rides with its result');
  assert.deepEqual(cleanup, []);
  const some = await replay.replay({ org: 'x', file, rest, tools, sideEffects: true, only: /^[cd]@/ });
  assert.deepEqual(some.results.map((r) => [r.id, r.status]), [['c@x', 'fail'], ['d@x', 'pass']]);
  assert.equal(made('Account').length, 1, 'only a@x needs the account, and it is not in only');
  assert.equal(made('SfUiDyn__c').filter((n) => n.startsWith('dyn ')).length, 1, 'a perRoute dynId for d@x');
});

test('cleanup deletes a route\'s records after it and the run\'s after sf_end, newest first, and reports a failed delete', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD, failDelete: 'SfUiProbe__c#9' });
  const reported = [];
  const { cleanup } = await replay.replay({ org: 'x', file, rest, tools, onCleanup: (c) => reported.push(c) });
  assert.deepEqual(log.map((l) => l.split(' ').slice(0, 2).join(' ').replace('call sf_run_route', 'route')), [
    'call sf_start', 'create Account#1', 'create Contact#2',
    'create SfUiProbe__c#3', 'route', 'delete SfUiProbe__c#3',
    'create SfUiProbe__c#6', 'route', 'delete SfUiProbe__c#6',
    'create SfUiProbe__c#9', 'create SfUiDyn__c#10', 'route', 'delete SfUiDyn__c#10', 'delete SfUiProbe__c#9',
    // c@x is red: its records go before it runs again, in a new session, on records of its own.
    'call sf_start', 'create SfUiProbe__c#15', 'create SfUiDyn__c#16', 'route', 'delete SfUiDyn__c#16', 'delete SfUiProbe__c#15',
    'call sf_end', 'close', 'delete Contact#2', 'delete Account#1']);
  assert.deepEqual(cleanup, [{ sobject: 'SfUiProbe__c', id: 'SfUiProbe__c#9', error: 'API_ERROR: DELETE answered 500' }]);
  assert.deepEqual(reported, cleanup);
});

// A folder for the made-records files, and a pid no process holds, as a run that was killed leaves.
const madeRoot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-made-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const deadPid = () => { for (let pid = 99_999; ; pid -= 1) try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return pid; } };
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

test('each record a run makes is on disk until it is deleted, and one whose delete failed is still there after', async (t) => {
  const madeDir = madeRoot(t);
  const mine = () => { const [n, ...more] = files(path.join(madeDir, 'x')); assert.equal(more.length, 0); assert.match(n, new RegExp(`^${process.pid}-[0-9a-f]+\\.json$`)); return path.join(madeDir, 'x', n); };
  const { file, rest, tools } = fake(t, { placeholders: CHILD, failDelete: 'SfUiProbe__c#9' });
  const seen = [];
  const watching = { ...tools, call: async (name, args) => { if (name === 'sf_run_route') seen.push(JSON.parse(fs.readFileSync(mine(), 'utf8')).map((r) => r.id)); return tools.call(name, args); } };
  await replay.replay({ org: 'x', file, rest, tools: watching, madeDir });
  assert.deepEqual(seen[0], ['Account#1', 'Contact#2', 'SfUiProbe__c#3'], 'written before the route runs');
  assert.deepEqual(JSON.parse(fs.readFileSync(mine(), 'utf8')), [{ sobject: 'SfUiProbe__c', id: 'SfUiProbe__c#9' }], 'only the record whose delete failed');
  const clean = fake(t, { placeholders: CHILD });
  const cleanDir = madeRoot(t);
  await replay.replay({ org: 'x', file: clean.file, rest: clean.rest, tools: clean.tools, madeDir: cleanDir });
  assert.deepEqual(files(path.join(cleanDir, 'x')), [], 'a run whose deletes all worked leaves no file');
});

test('the next run deletes what an ended run left before it makes anything, and leaves a live run and another org alone', async (t) => {
  const madeDir = madeRoot(t);
  const write = (org, pid, rows) => { fs.mkdirSync(path.join(madeDir, org), { recursive: true }); fs.writeFileSync(path.join(madeDir, org, `${pid}.json`), JSON.stringify(rows)); };
  const dead = deadPid();
  write('x', dead, [{ sobject: 'Account', id: 'SWA-left-1' }, { sobject: 'SfUiProbe__c', id: 'SWA-left-2' }]);
  write('x', process.ppid, [{ sobject: 'Account', id: 'SWA-live' }]);
  write('y', dead, [{ sobject: 'Account', id: 'SWA-other-org' }]);
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const out = [];
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, madeDir });
  assert.equal(code, 0);
  assert.deepEqual(log.slice(0, 3), ['delete SWA-left-2', 'delete SWA-left-1', 'call sf_start'], 'newest first, before the session starts');
  assert.ok(out.includes('removed 2 of 2 records an earlier run left'), out.join('\n'));
  assert.deepEqual(files(path.join(madeDir, 'x')), [`${process.ppid}.json`], 'the ended run\'s file is gone, the live run\'s stays, and this run left none');
  assert.deepEqual(files(path.join(madeDir, 'y')), [`${dead}.json`], 'another org\'s file is not this run\'s to take');
  assert.ok(!log.some((l) => l.includes('SWA-live') || l.includes('SWA-other-org')));
});

test('a dead run\'s file under this process\'s pid is taken, not overwritten, and a second replay in one process takes the first one\'s', (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify([{ sobject: 'Account', id: 'SWF-reused-pid' }]));
  const first = replay.ledger('x', madeDir);
  first.add({ sobject: 'Account', id: 'SWF-first' });
  const second = replay.ledger('x', madeDir);
  assert.deepEqual(second.left().map((r) => r.id).sort(), ['SWF-first', 'SWF-reused-pid']);
  assert.equal(files(dir).length, 1, 'only the second run\'s file is left');
});

test('a records file that does not parse or is not a list is moved aside with a warning, and the files after it are still taken', async (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  const dead = deadPid();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${dead}-0.json`), '[{"sobject":"Acc');
  fs.writeFileSync(path.join(dir, `${dead}-1.json`), '{"id":"x"}');
  fs.writeFileSync(path.join(dir, `${dead}-2.json`), JSON.stringify([{ sobject: 'Account', id: 'SWF-after-bad' }]));
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const out = [];
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@'], { log: (l) => out.push(`log ${l}`), warn: (l) => out.push(`warn ${l}`), rest, tools, madeDir });
  assert.equal(code, 0, out.join('\n'));
  assert.equal(log[0], 'delete SWF-after-bad');
  assert.equal(out.filter((l) => /^warn .*is not a list of records .*moved to .*\.bad$/.test(l)).length, 2, out.join('\n'));
  assert.deepEqual(files(dir).map((n) => n.replace(/\.\d+\.bad$/, '.N.bad')), [`${dead}-0.json.N.bad`, `${dead}-1.json.N.bad`]);
});

test('a .bad from before is kept, a file another run moved aside first is skipped, and an empty .tmp beside its file goes quietly', (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  const dead = deadPid();
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, n);
  fs.writeFileSync(at(`${dead}-0.json.bad`), 'earlier');
  fs.writeFileSync(at(`${dead}-0.json`), '[{"sobject":"Acc');
  fs.writeFileSync(at(`${dead}-1.json`), JSON.stringify([{ sobject: 'Account', id: 'SWF-whole' }]));
  fs.writeFileSync(at(`${dead}-1.json.tmp`), '');
  const warned = [];
  const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (...a) => readdir(...a).sort().reverse()); // the .tmp listed before its file
  const first = replay.ledger('x', madeDir, (l) => warned.push(l));
  assert.deepEqual(first.left().map((r) => r.id), ['SWF-whole']);
  first.done({ id: 'SWF-whole' });
  assert.equal(fs.readFileSync(at(`${dead}-0.json.bad`), 'utf8'), 'earlier', 'the earlier .bad is not overwritten');
  assert.equal(warned.length, 1, warned.join('\n'));
  assert.match(warned[0], new RegExp(`${dead}-0\\.json is not a list`), 'only the bad file warns, not the cut .tmp');
  assert.ok(!files(dir).some((n) => n.startsWith(`${dead}-1`)), files(dir).join(' '));
  // Another run read the same bad file and moved it aside first: this run's rename finds nothing.
  fs.writeFileSync(at(`${dead}-2.json`), '{');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (from.endsWith(`${dead}-2.json`)) { fs.rmSync(from); } return rename(from, to); });
  assert.deepEqual(replay.ledger('x', madeDir, (l) => warned.push(l)).left(), []);
  assert.equal(warned.length, 1, 'no warning for a file another run moved');
});

test('a cut .tmp that is not empty, or whose file beside it is not a whole list, warns and is kept as .bad', (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  const dead = deadPid();
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, n);
  fs.writeFileSync(at(`${dead}-0.json`), '[{"sobject":"Acc');
  fs.writeFileSync(at(`${dead}-0.json.tmp`), '[{"sobject":"Account","id":"SWF-0"},{"sob');
  fs.writeFileSync(at(`${dead}-1.json`), JSON.stringify([{ sobject: 'Account', id: 'SWF-1' }]));
  fs.writeFileSync(at(`${dead}-1.json.tmp`), '[{"sobject":"Account","id":"SWF-1"},{"sobject":"Account","id":"SWF-only-here"');
  fs.writeFileSync(at(`${dead}-2.json.tmp`), '');
  fs.writeFileSync(at(`${dead}-3.json`), '[{"sobject":"Acc');
  fs.writeFileSync(at(`${dead}-3.json.tmp`), '');
  const warned = [];
  assert.deepEqual(replay.ledger('x', madeDir, (l) => warned.push(l)).left().map((r) => r.id), ['SWF-1']);
  const tmps = warned.filter((l) => /\.json\.tmp is not a list/.test(l)).map((l) => l.match(/-(\d)\.json\.tmp/)[1]);
  assert.deepEqual(tmps.sort(), ['0', '1', '2', '3'], warned.join('\n'));
  assert.deepEqual(files(dir).filter((n) => n.includes('.tmp.')).map((n) => n.replace(/\.\d+\.bad$/, '.N.bad')).sort(), [0, 1, 2, 3].map((i) => `${dead}-${i}.json.tmp.N.bad`));
});

test('a records file another run took first is not an error', (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${deadPid()}-0.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify([{ sobject: 'Account', id: 'SWF-raced' }]));
  const kept = replay.ledger('x', madeDir);
  const read = fs.readFileSync;
  let after = false; // the other run removes the file before this run's read, or after it
  t.mock.method(fs, 'readFileSync', (f, ...more) => {
    if (!f.startsWith(dir)) return read(f, ...more);
    if (!after) fs.rmSync(f);
    const text = read(f, ...more);
    fs.rmSync(f);
    return text;
  });
  assert.deepEqual(kept.left(), []);
  fs.writeFileSync(path.join(dir, name.replace('-0', '-1')), JSON.stringify([{ sobject: 'Account', id: 'SWF-both-read' }]));
  after = true;
  assert.deepEqual(kept.left().map((r) => r.id), ['SWF-both-read']);
});

test('a dead run\'s .tmp records file is read beside its file, each record once, and both go', (t) => {
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${deadPid()}-0.json`);
  fs.writeFileSync(base, JSON.stringify([{ sobject: 'Account', id: 'SWF-old' }]));
  fs.writeFileSync(`${base}.tmp`, JSON.stringify([{ sobject: 'Account', id: 'SWF-old' }, { sobject: 'Account', id: 'SWF-newest' }]));
  const kept = replay.ledger('x', madeDir);
  assert.deepEqual(kept.left().map((r) => r.id).sort(), ['SWF-newest', 'SWF-old']);
  assert.equal(files(dir).filter((n) => n.startsWith(path.basename(base))).length, 0);
});

test('a leftover the org no longer has (404) is counted already gone, not removed', async (t) => {
  const { SfUiError } = require('..');
  const madeDir = madeRoot(t);
  const dir = path.join(madeDir, 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${deadPid()}-0.json`), JSON.stringify([{ sobject: 'Account', id: 'SWF-gone' }, { sobject: 'Account', id: 'SWF-there' }]));
  t.mock.method(require('../src/api'), 'call', async (s, p) => { if (p.endsWith('SWF-gone')) throw new SfUiError('API_ERROR', 'DELETE answered 404', { status: 404 }); return null; });
  const real = await replay.admin('x', async () => ({}));
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const out = [];
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest: { ...rest, remove: real.remove }, tools, madeDir });
  assert.equal(code, 0);
  assert.ok(out.includes('removed 1 of 2 records an earlier run left, 1 already gone'), out.join('\n'));
  assert.deepEqual(files(dir), []);
});

test('a delete that fails on the network is tried once more; any other failure is not', async (t) => {
  const { SfUiError } = require('..');
  const madeDir = madeRoot(t);
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  let blips = 1;
  const flaky = { ...rest, remove: async (sobject, id) => {
    log.push(`delete ${id}`);
    if (id.startsWith('Account') && blips-- > 0) throw new SfUiError('API_ERROR', 'DELETE /x: fetch failed (UND_ERR_CONNECT_TIMEOUT)', { cause: 'UND_ERR_CONNECT_TIMEOUT' });
    if (id.startsWith('Contact')) throw new SfUiError('API_ERROR', 'DELETE answered 400', { status: 400 });
  } };
  const { cleanup } = await replay.replay({ org: 'x', file, rest: flaky, tools, madeDir, only: /^a@/ });
  assert.deepEqual(log.filter((l) => l.startsWith('delete Account')), ['delete Account#1', 'delete Account#1'], 'tried again after the network fault');
  assert.deepEqual(log.filter((l) => l.startsWith('delete Contact')), ['delete Contact#2'], 'control: a 400 is not tried again');
  assert.deepEqual(cleanup.map((c) => c.id), ['Contact#2']);
});

test('junit gives one testcase per route, the failing step and error as the failure, escaped', () => {
  const xml = replay.junit([
    { id: 'a@x', status: 'pass', ms: 1200 },
    { id: 'c&<x>', status: 'fail', ms: 10, step: 2, error: 'sf_wait: no "x" in \u001b10 s', requirement: 'Size is "Large"' },
    { id: 'd@x', status: 'skip', ms: 0, reason: 'sideEffects: mail' }]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuite name="sf-tester replay" tests="3" failures="1" errors="0" skipped="1" time="1.210">\n/);
  assert.match(xml, /<testcase classname="sf-tester.replay" name="a@x" time="1.200"><\/testcase>/);
  assert.match(xml, /<testcase classname="sf-tester.replay" name="c&#38;&#60;x&#62;" time="0.010"><failure message="step 2 sf_wait: no &#34;x&#34; in 10 s"\/><system-out>requirement: Size is &#34;Large&#34;<\/system-out><\/testcase>/);
  assert.match(xml, /<testcase [^>]*name="d@x"[^>]*><skipped message="sideEffects: mail"\/><\/testcase>\n<\/testsuite>\n$/);
  assert.equal((xml.match(/<testcase /g) || []).length, 3);
});

// A route stale to remap did not run, but the CLI exits 1 for it, so the report counts it a failure, not a skip.
test('junit writes a route stale to remap as a failure; a sideEffects skip stays skipped', () => {
  const xml = replay.junit([
    { id: 's@x', status: 'skip', ms: 0, remap: true, reason: 'stale (FlexiPage P): remap it with the tester' },
    { id: 'd@x', status: 'skip', ms: 0, reason: 'sideEffects: mail' }]);
  assert.match(xml, /<testsuite name="sf-tester replay" tests="2" failures="1" errors="0" skipped="1" time="0.000">/);
  assert.match(xml, /name="s@x" time="0.000"><failure message="stale \(FlexiPage P\): remap it with the tester"\/><\/testcase>/);
  assert.match(xml, /name="d@x" time="0.000"><skipped message="sideEffects: mail"\/><\/testcase>/);
});

test('the CLI prints a line per route and a count, and exits 0 all green, 1 on a red or a record left, 2 on bad usage', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const run = async (args, more = {}) => {
    const out = [];
    const code = await cli.main(args, { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, ...more });
    return { code, out };
  };
  const junitFile = path.join(path.dirname(file), 'replay.xml');
  const red = await run(['replay', '--org', 'x', '--catalogue', file, '--junit', junitFile]);
  assert.equal(red.code, 1);
  assert.equal(red.out[0], `catalogue ${file}`);
  assert.equal(red.out[1], 'total 3 (1 sideEffects skipped)', 'a replay prints the total --plan does');
  assert.match(red.out[4], /^FAIL c@x \d+ms step 1 sf_wait: TIMEOUT: no "red" in 10000 ms \(unknown: no validity saved\) \(red on rerun too\) \(requirement: The child shows red\)$/);
  assert.equal(red.out[5], 'SKIP d@x 0ms sideEffects: sends an email');
  assert.equal(red.out.at(-1), 'checked 4, passed 2, failed 1, skipped 1');
  assert.match(fs.readFileSync(junitFile, 'utf8'), /tests="4" failures="1" errors="0" skipped="1"/);
  const green = await run(['replay', '--org', 'x', '--catalogue', file, '--only', '^[ab]@']);
  assert.deepEqual([green.code, green.out.at(-1)], [0, 'checked 2, passed 2, failed 0, skipped 0']);
  assert.deepEqual(green.out.slice(1, 3), ['--only ^[ab]@ keeps 2 of 4', 'total 2'], 'the head --plan prints');
  assert.match(green.out[3], /^PASS a@x \d+ms \(unknown: no validity saved\)$/, 'a route with no validity says it was not checked');
  const left = await run(['replay', '--org', 'x', '--catalogue', file, '--only', '^a@', '--junit', junitFile], { rest: { ...rest, remove: async () => { throw new Error('nope'); } } });
  assert.equal(left.code, 1);
  assert.match(left.out[4], /^CLEANUP FAIL SfUiProbe__c SfUiProbe__c#\d+ nope$/);
  assert.equal(left.out.at(-1), 'checked 1, passed 1, failed 0, skipped 0, left 3 records');
  const leftXml = fs.readFileSync(junitFile, 'utf8');
  assert.match(leftXml, /tests="4" failures="0" errors="3" skipped="0"/, 'each record left is an error case, as the exit code is red');
  assert.match(leftXml, /<testcase classname="sf-tester.replay" name="cleanup SfUiProbe__c SfUiProbe__c#\d+" time="0.000"><error message="nope"\/><\/testcase>/);
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['replay', '--org', 'x', '--only', '('])).code, 2);
  assert.equal((await run(['replay', '--org', 'x', '--catalogue', '/no/such/file.json'])).code, 2);
  const refused = await run(['replay', '--org', 'x', '--catalogue', fake(t).file]);
  assert.equal(refused.code, 2);
  assert.match(refused.out[2], /^BAD_ARGS: no value for childName: /);
});

test('the CLI replay sends a verify step\'s relative path from the --catalogue folder, and an absolute one as it is', async (t) => {
  const { file, rest, tools } = fake(t);
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const b = all.combinations.find((e) => e.id === 'b@x');
  b.route.push({ tool: 'sf_verify_checks', args: { checksFile: 'checks/ok.json' } }, { tool: 'sf_verify_checks', args: { checks: [{}], project: '/abs/proj' } });
  fs.writeFileSync(file, JSON.stringify(all));
  const sent = [];
  const ceilings = [];
  const call = async (name, args, timeout) => { if (name === 'sf_run_route') { sent.push(args.steps.slice(2)); ceilings.push(timeout); } return tools.call(name, args); };
  assert.equal(await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@x$'], { log: () => {}, warn: () => {}, rest, tools: { ...tools, call } }), 0);
  assert.deepEqual(sent, [[{ tool: 'sf_verify_checks', args: { checksFile: path.join(path.dirname(file), 'checks', 'ok.json') } }, { tool: 'sf_verify_checks', args: { checks: [{}], project: '/abs/proj' } }]]);
  assert.deepEqual(ceilings, [300_000 + 2 * 30 * 60_000], 'each verify step adds its validate\'s time to the route\'s ceiling');
  ceilings.length = 0;
  assert.equal(await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^a@x$'], { log: () => {}, warn: () => {}, rest, tools: { ...tools, call } }), 0);
  assert.deepEqual(ceilings, [300_000], 'control: a route with no verify step keeps the UI ceiling');
});

// One route over a saved page; the fake server answers as sf_run_route does: green or a failed step, with what changed.
function moved(t, { unread, red, stale, refuse, validity = { page: { formHash: 'old' } }, read: fresh = { page: { formHash: 'new' } } }) {
  const { file, rest: base, tools } = fake(t, { placeholders: CHILD });
  const checked = [];
  const rest = { ...base, check: async (v) => { checked.push(v); return refuse ? { state: 'stale', stale: refuse } : { state: 'valid' }; } };
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.slice(0, 1).map((e) => ({ ...e, ...(validity && { validity }) }));
  fs.writeFileSync(file, JSON.stringify(all));
  const sent = [];
  const call = async (name, args) => {
    if (name !== 'sf_run_route') return tools.call(name, args);
    sent.push(args.validity);
    if (args.validity && args.onStale !== 'run') throw new Error('the CLI checked this route, so it must not ask sf_run_route to check again');
    const note = { ...(stale && { stale }), ...(unread && { unread }) };
    return red ? { isError: true, text: JSON.stringify({ code: 'ROUTE_STEP_FAILED', evidence: { failedAt: 1, tool: 'sf_wait', error: 'no x', ...note } }) } : { isError: false, text: JSON.stringify({ validity: fresh, ...note }) };
  };
  const out = [];
  const run = (...more) => cli.main(['replay', '--org', 'x', '--catalogue', file, ...more], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools: { ...tools, call } });
  return { file, out, run, sent, checked, made: base.made, saved: () => JSON.parse(fs.readFileSync(file, 'utf8')).combinations[0].validity };
}

test('a red on a changed page prints STALE, names the change and stays a red', async (t) => {
  const m = moved(t, { red: true, stale: ['form of Probe__c'] });
  const xml = path.join(path.dirname(m.file), 'stale.xml');
  assert.equal(await m.run('--junit', xml), 1);
  assert.deepEqual(m.sent, [{ page: { formHash: 'old' } }], 'the saved validity goes with the route');
  assert.match(m.out[2], /^STALE a@x \d+ms step 1 sf_wait: no x \(changed since saved: form of Probe__c\)$/);
  assert.equal(m.out.at(-1), 'checked 1, passed 0, failed 1, skipped 0, 1 on a changed page');
  assert.match(fs.readFileSync(xml, 'utf8'), /failures="1".*\n.*<failure message="stale \(form of Probe__c\): step 1 sf_wait: no x"/);
});

test('a route the pre-run check finds stale is skipped with its reason, and --baseline runs it', async (t) => {
  const m = moved(t, { refuse: ['FlexiPage P'] });
  const xml = path.join(path.dirname(m.file), 'remap.xml');
  assert.equal(await m.run('--junit', xml), 1, 'nothing ran, and every route is stale to remap: red, not bad usage');
  assert.match(m.out[2], /^SKIP a@x \d+ms stale \(FlexiPage P\): remap it with the tester$/);
  assert.equal(m.out.at(-2), 'checked 1, passed 0, failed 0, skipped 1, 1 stale to remap');
  assert.equal(m.out.at(-1), 'no route ran: 1 stale, remap them with the tester');
  assert.match(fs.readFileSync(xml, 'utf8'), /failures="1" errors="0" skipped="0"[^]*<failure message="stale \(FlexiPage P\): remap it with the tester"\/>/, 'the report is red as the exit code is');
  assert.deepEqual(m.sent, [], 'no step ran, no sf_run_route call');
  const again = moved(t, { refuse: ['FlexiPage P'] });
  assert.equal(await again.run('--baseline'), 0);
  assert.deepEqual([again.checked, again.saved()], [[], { page: { formHash: 'new' } }], 'a stale route is read anew, unchecked');
});

test('a step value a changed page emptied is STALE too', () => {
  const body = { code: 'BAD_ARGS', message: 'BAD_ARGS: step 1 sf_click: step 0 returned no value', evidence: { step: 1, stale: ['form of X'] } };
  assert.deepEqual(replay.failure(JSON.stringify(body)), { status: 'fail', step: 1, error: body.message, stale: ['form of X'] });
});

test('a red with no change, or no baseline, stays a plain FAIL', async (t) => {
  const same = moved(t, { red: true });
  assert.equal(await same.run(), 1);
  assert.match(same.out[2], /^FAIL a@x \d+ms step 1 sf_wait: no x \(red on rerun too\)$/);
  const none = moved(t, { red: true, validity: null });
  assert.equal(await none.run(), 1);
  assert.deepEqual(none.sent, [undefined, undefined], 'a route with no baseline sends none, on the rerun too');
  assert.match(none.out[2], /^FAIL a@x /);
});

test('a red or a green whose page read failed says so, and the red stays a FAIL', async (t) => {
  const red = moved(t, { red: true, unread: ['page: boom'] });
  assert.equal(await red.run(), 1);
  assert.match(red.out[2], /^FAIL a@x \d+ms step 1 sf_wait: no x \(not read: page: boom\) \(red on rerun too\)$/);
  const green = moved(t, { unread: ['page: boom'] });
  assert.equal(await green.run(), 0);
  assert.match(green.out[2], /^PASS a@x \d+ms \(not read: page: boom\)$/);
});

test('a green on a changed page stays a pass, with a note', async (t) => {
  const m = moved(t, { stale: ['app A'] });
  assert.equal(await m.run(), 0);
  assert.match(m.out[2], /^PASS a@x \d+ms \(changed since saved: app A\)$/);
  assert.equal(m.out.at(-1), 'checked 1, passed 1, failed 0, skipped 0, 1 on a changed page');
  assert.deepEqual(m.saved(), { page: { formHash: 'old' } }, 'a replay never moves a baseline by itself');
});

test('--baseline keeps a green route\'s read and leaves a red route\'s old one', async (t) => {
  const green = moved(t, { stale: ['app A'] });
  assert.equal(await green.run('--baseline'), 0);
  assert.deepEqual(green.saved(), { page: { formHash: 'new' } });
  const red = moved(t, { red: true, stale: ['app A'] });
  assert.equal(await red.run('--baseline'), 1);
  assert.deepEqual(red.saved(), { page: { formHash: 'old' } });
});

test('--baseline replaces a part it read whole and keeps a part it missed', async (t) => {
  const saved = { app: { name: 'A', hash: 'a1' }, page: { object: 'X', flexiPage: 'P', flexiPageHash: 'p1', formHash: 'f1' } };
  const m = moved(t, { validity: saved, read: { page: { object: 'X', formHash: 'f2' } } });
  assert.equal(await m.run('--baseline'), 0);
  assert.deepEqual(m.saved(), { app: saved.app, page: { object: 'X', formHash: 'f2' } }, 'a FlexiPage the org removed goes, and the app read missed stays');
  assert.match(m.out.at(-2), /^baseline 1 of 1 green routes, 1 on a record page, in /);
});

test('--baseline names the routes that kept a saved set hash the read could not give', async (t) => {
  const m = moved(t, {});
  t.mock.method(combinations, 'baseline', () => ['a@x', 'b@x']);
  assert.equal(await m.run('--baseline'), 0);
  assert.match(m.out.at(-2), /^baseline 1 of 1 green routes, 1 on a record page, 2 kept a saved set hash: a@x, b@x, in /);
  combinations.baseline.mock.mockImplementation(() => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `${n}@x`));
  const long = moved(t, {});
  await long.run('--baseline');
  assert.match(long.out.at(-2), /, 7 kept a saved set hash: a@x, b@x, c@x, d@x, e@x and 2 more, in /, 'a long list stops at five ids');
  combinations.baseline.mock.mockImplementation(() => []);
  const none = moved(t, {});
  await none.run('--baseline');
  assert.match(none.out.at(-2), /^baseline 1 of 1 green routes, 1 on a record page, in /, 'control: none kept says nothing');
});

test('--baseline repairs a saved value with a stray key', async (t) => {
  const m = moved(t, { validity: { formHash: 'old', note: 'a hand edit' } });
  assert.equal(await m.run('--baseline'), 0);
  assert.deepEqual(m.saved(), { page: { formHash: 'new' } });
});

test('--baseline writes no file when it read nothing, and a catalogue it cannot write is an error in the report', async (t) => {
  const m = moved(t, { red: true });
  const before = fs.readFileSync(m.file, 'utf8').replace(/$/, ' ');
  fs.writeFileSync(m.file, before);
  assert.equal(await m.run('--baseline'), 1);
  assert.equal(fs.readFileSync(m.file, 'utf8'), before, 'a run with no read leaves the file alone');
  assert.ok(m.out.some((l) => l.startsWith('baseline 0 of 0 green routes')), 'and says so');
  const green = moved(t, {});
  const xml = path.join(path.dirname(green.file), 'first.xml');
  fs.chmodSync(green.file, 0o444);
  assert.equal(await green.run('--baseline', '--junit', xml), 1);
  assert.match(green.out.at(-1), /, 1 errors$/);
  assert.ok(!green.out.some((l) => l.startsWith('baseline ')), 'no line says it wrote');
  assert.match(fs.readFileSync(xml, 'utf8'), /<error message="baseline: EACCES/);
});

test('--baseline leaves the rest of the file as it was', async (t) => {
  const m = moved(t, {});
  const before = JSON.parse(fs.readFileSync(m.file, 'utf8'));
  await m.run('--baseline');
  const after = JSON.parse(fs.readFileSync(m.file, 'utf8'));
  assert.deepEqual(Object.keys(after), Object.keys(before), 'catalogue() would put placeholders first');
  after.combinations[0].validity = before.combinations[0].validity;
  assert.deepEqual(after, before);
});

test('the CLI exits 1 when one route is stale to remap and another passes, so CI shows the page change', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.filter((e) => /^[ab]@/.test(e.id));
  all.combinations[0].validity = { page: { formHash: 'old' } }; // only a has a saved validity, so only a is checked
  fs.writeFileSync(file, JSON.stringify(all));
  const out = [];
  const stale = { ...rest, check: async () => ({ state: 'stale', stale: ['FlexiPage P'] }) };
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file], { log: (l) => out.push(l), warn: (l) => out.push(l), rest: stale, tools });
  assert.match(out.join('\n'), /SKIP a@x .*stale/);
  assert.equal(out.at(-1), 'checked 2, passed 1, failed 0, skipped 1, 1 stale to remap');
  assert.equal(code, 1);
});

// Two routes with a saved validity, a and b, and a check that answers each as the test says.
function twoChecked(t, check) {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.filter((e) => /^[ab]@/.test(e.id)).map((e) => ({ ...e, validity: { page: { object: 'X', formHash: 'old' } } }));
  fs.writeFileSync(file, JSON.stringify(all));
  const out = [];
  const run = (...more) => cli.main(['replay', '--org', 'x', '--catalogue', file, ...more], { log: (l) => out.push(l), warn: (l) => out.push(l), rest: { ...rest, check }, tools });
  return { out, run, file };
}

test('a check that could not compare prints why beside the route, and the route still runs', async (t) => {
  const why = 'the org did not answer the check in 20 s';
  const { out, run } = twoChecked(t, async (v) => (out.some((l) => l.includes('a@x')) ? { state: 'valid' } : { state: 'unknown', unchecked: [why] }));
  assert.equal(await run(), 0);
  assert.match(out.find((l) => l.includes('a@x')), new RegExp(`^PASS a@x \\d+ms \\(unknown: ${why}\\)$`), 'the timeout shows, not a plain PASS');
  assert.match(out.find((l) => l.includes('b@x')), /^PASS b@x \d+ms$/, 'control: a route that was compared has no note');
});

test('a valid check keeps what it could not compare beside the route, bar the form read at the route\'s end', async (t) => {
  const form = 'form of X, read where the route ends';
  const other = 'a note of its own, read where the route ends';
  const { out, run } = twoChecked(t, async () => ({ state: 'valid', unchecked: out.some((l) => l.includes('a@x')) ? [form] : [form, 'persona permission set S, saved with no hash', other] }));
  assert.equal(await run(), 0);
  assert.match(out.find((l) => l.includes('a@x')), new RegExp(`^PASS a@x \\d+ms \\(unchecked: persona permission set S, saved with no hash; ${other}\\)$`), 'only the form note is left out, not words like it');
  assert.match(out.find((l) => l.includes('b@x')), /^PASS b@x \d+ms$/, 'control: the form alone is no note');
});

test('a check that is unknown with no reason ends no replay: both routes are reported and run', async (t) => {
  const { out, run } = twoChecked(t, async () => ({ state: 'unknown' }));
  assert.equal(await run(), 0);
  assert.match(out.find((l) => l.includes('a@x')), /^PASS a@x \d+ms \(unknown\)$/);
  assert.match(out.find((l) => l.includes('b@x')), /^PASS b@x \d+ms \(unknown\)$/, 'the second route ran after the first');
});

test('two routes of a persona with no sets and nothing else to compare are both reported unknown, with why', async (t) => {
  const { validity } = require('..');
  const { out, run } = twoChecked(t, () => validity.check({}, { persona: { profile: 'P', permissionSets: [] } }));
  assert.equal(await run(), 0);
  for (const id of ['a@x', 'b@x']) assert.match(out.find((l) => l.includes(id)), new RegExp(`^PASS ${id} \\d+ms \\(unknown: nothing saved has a hash to compare\\)$`));
});

test('a bug in the check fails that route alone, and the rest of the replay runs', async (t) => {
  const { out, run } = twoChecked(t, async () => { if (!out.some((l) => l.includes('a@x'))) throw new TypeError('boom'); return { state: 'valid' }; });
  assert.equal(await run(), 1);
  assert.match(out.find((l) => l.includes('a@x')), /^FAIL a@x \d+ms the check threw: boom$/);
  assert.match(out.find((l) => l.includes('b@x')), /^PASS b@x /, 'the next route ran');
  assert.equal(out.at(-1), 'checked 2, passed 1, failed 1, skipped 0');
});

test('a route the check stops reports how long the check took, on its line and in JUnit', async (t) => {
  const { out, run, file } = twoChecked(t, async () => { await new Promise((done) => setTimeout(done, 60)); return out.some((l) => l.includes('a@x')) ? { state: 'valid' } : { state: 'stale', stale: ['FlexiPage P'] }; });
  const xml = path.join(path.dirname(file), 'ms.xml');
  await run('--junit', xml);
  const ms = Number(out.find((l) => l.startsWith('SKIP a@x')).match(/^SKIP a@x (\d+)ms /)[1]);
  assert.ok(ms >= 50, `${ms}ms, not 0ms, for a 60 ms check`);
  assert.ok(Number(fs.readFileSync(xml, 'utf8').match(/name="a@x" time="([\d.]+)"/)[1]) >= 0.05, 'and the JUnit time');
});

test('a stale check with no reason skips that route alone, and the rest of the replay runs', async (t) => {
  const { out, run } = twoChecked(t, async () => (out.some((l) => l.includes('a@x')) ? { state: 'valid' } : { state: 'stale' }));
  const code = await run();
  assert.match(out.find((l) => l.includes('a@x')), /^SKIP a@x .*stale \(no reason given\)/);
  assert.match(out.find((l) => l.includes('b@x')), /^PASS b@x /, 'the next route ran');
  assert.equal(out.at(-1), 'checked 2, passed 1, failed 0, skipped 1, 1 stale to remap');
  assert.equal(code, 1, 'a route stale to remap is red');
});

test('the CLI exits 2 when no route ran, and when SF_TESTER_COMBINATIONS names no file', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const said = [];
  const run = (args) => cli.main(args, { log: () => {}, warn: (l) => said.push(l), rest, tools });
  assert.equal(await run(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@']), 0, 'control: one route ran');
  assert.equal(await run(['replay', '--org', 'x', '--catalogue', file, '--only', '^nope$']), 2, 'checked 0');
  assert.equal(said.at(-1), 'no route ran: check the catalogue and --only', 'an empty run is not a persona run');
  assert.equal(await run(['replay', '--org', 'x', '--catalogue', file, '--only', '^d@']), 2, 'only a sideEffects skip');
  const was = process.env.SF_TESTER_COMBINATIONS;
  t.after(() => { if (was === undefined) delete process.env.SF_TESTER_COMBINATIONS; else process.env.SF_TESTER_COMBINATIONS = was; });
  process.env.SF_TESTER_COMBINATIONS = '/no/such/catalogue.json';
  assert.equal(await run(['replay', '--org', 'x']), 2);
  assert.match(said.at(-1), /^no catalogue at \/no\/such\/catalogue.json\n/);
});

test('the CLI never falls back to the bundled fixture catalogue: it needs --catalogue or SF_TESTER_COMBINATIONS', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const was = process.env.SF_TESTER_COMBINATIONS;
  t.after(() => { if (was === undefined) delete process.env.SF_TESTER_COMBINATIONS; else process.env.SF_TESTER_COMBINATIONS = was; });
  delete process.env.SF_TESTER_COMBINATIONS;
  const out = [];
  const run = (args) => cli.main(args, { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools });
  assert.equal(await run(['replay', '--org', 'x']), 2);
  assert.match(out[0], /^name the catalogue with --catalogue or SF_TESTER_COMBINATIONS/);
  process.env.SF_TESTER_COMBINATIONS = file;
  out.length = 0;
  assert.equal(await run(['replay', '--org', 'x', '--only', '^b@']), 0);
  assert.equal(out[0], `catalogue ${file}`, 'the first line names the catalogue used');
});

// The real server, offline: sf_start fails at once on an alias with no auth, and a route of sf_combinations needs none.
test('the replay\'s server client waits past the SDK\'s 60 s for sf_start, sf_login_as and sf_run_route', { timeout: 60_000 }, async (t) => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const seen = {};
  const real = Client.prototype.callTool;
  t.mock.method(Client.prototype, 'callTool', function (params, schema, options) { seen[params.name] = options?.timeout; return real.call(this, params, schema, options); });
  const srv = await replay.server();
  t.after(() => srv.close());
  assert.equal((await srv.call('sf_start', { org: 'sf-tester-no-such-alias' })).isError, true);
  assert.equal((await srv.call('sf_run_route', { steps: [{ tool: 'sf_combinations', args: { container: 'sidebar' } }] })).isError, false);
  await srv.call('sf_combinations', { container: 'sidebar' });
  await srv.call('sf_login_as', { user: '005x' });
  assert.ok(seen.sf_start > 60_000 && seen.sf_run_route > 60_000 && seen.sf_login_as > 60_000, JSON.stringify(seen));
  assert.equal(seen.sf_combinations, undefined, 'any other tool keeps the default');
});

test('failure() reads the failed step and its error from the server\'s ROUTE_STEP_FAILED evidence', { timeout: 30_000 }, async (t) => {
  const srv = await replay.server();
  t.after(() => srv.close());
  const out = await srv.call('sf_run_route', { steps: [{ tool: 'sf_combinations', args: { container: 'sidebar' } }, { tool: 'sf_whoami' }] });
  assert.deepEqual(replay.failure(out.text), { status: 'fail', step: 1, error: 'sf_whoami: NO_SESSION: call sf_start first' });
  const refused = await srv.call('sf_run_route', { steps: [{ tool: 'sf_wait', args: { bogus: 1 } }] });
  assert.deepEqual(Object.keys(replay.failure(refused.text)), ['status', 'step', 'error'], refused.text);
  assert.match(replay.failure(refused.text).error, /^BAD_ARGS: step 0 sf_wait: /);
});

test('a replay on a production org says so before its first route, and on any other org says nothing', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const run = async (text) => {
    const said = [];
    const started = { ...tools, call: async (name, args) => (name === 'sf_start' ? { isError: false, text } : tools.call(name, args)) };
    const making = { ...rest, create: async (...a) => { said.push('create'); return rest.create(...a); } };
    await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^[ab]@'], { log: (l) => said.push(l), warn: () => {}, rest: making, tools: started });
    return said;
  };
  const said = await run('{"session":"default","production":true}');
  assert.ok(said.includes('create'), 'control: the run made records');
  assert.ok(said.indexOf('production org: x') >= 0 && said.indexOf('production org: x') < said.indexOf('create'), said.join(' | '));
  assert.equal((await run('{"session":"default"}')).includes('production org: x'), false);
});

test('a server that will not end loses no result: replay reports it and returns, the CLI counts it red', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const dead = { ...tools, call: async (name, args) => { if (name === 'sf_end') throw new Error('Not connected'); return tools.call(name, args); }, close: async () => { throw new Error('already closed'); } };
  const said = [];
  const r = await replay.replay({ org: 'x', file, rest, tools: dead, only: /^[ab]@/, onError: (m) => said.push(m) });
  assert.deepEqual(r.results.map((x) => x.status), ['pass', 'pass']);
  assert.deepEqual(r.errors, ['sf_end: Not connected', 'close: already closed']);
  assert.deepEqual(said, r.errors);
  assert.equal(log.filter((l) => l.startsWith('delete ')).at(-1), 'delete Account#1', 'the run\'s records are still deleted');
  const out = [];
  const junitFile = path.join(path.dirname(file), 'end.xml');
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^[ab]@', '--junit', junitFile], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools: dead });
  assert.equal(code, 1);
  assert.equal(out.at(-1), 'checked 2, passed 2, failed 0, skipped 0, 2 errors');
  assert.match(fs.readFileSync(junitFile, 'utf8'), /tests="4" failures="0" errors="2"[\s\S]*<error message="sf_end: Not connected"\/>/);
});

test('the CLI prints the count and writes JUnit when replay throws, with the error as a testcase', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const refusing = { ...tools, call: async (name, args) => (name === 'sf_start' ? { isError: true, text: 'no browser' } : tools.call(name, args)) };
  const out = [];
  const junitFile = path.join(path.dirname(file), 'thrown.xml');
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--junit', junitFile], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools: refusing });
  assert.equal(code, 1);
  assert.equal(out.at(-1), 'checked 0, passed 0, failed 0, skipped 0, 1 errors');
  assert.match(fs.readFileSync(junitFile, 'utf8'), /tests="1" failures="0" errors="1"[\s\S]*name="replay" time="0.000"><error message="START_FAILED: sf_start x: no browser"\/>/);
});

test('the CLI exits 2 for an --org with no auth here, as bad usage rather than a red route', async (t) => {
  const { file, tools } = fake(t, { placeholders: CHILD });
  const { SfUiError } = require('..');
  const noAuth = (code) => ({ create: async () => { throw new SfUiError(code, 'no sf CLI alias nope has auth here'); }, remove: async () => {} });
  const run = (rest) => cli.main(['replay', '--org', 'nope', '--catalogue', file, '--only', '^a@'], { log: () => {}, warn: () => {}, rest, tools });
  assert.equal(await run(noAuth('NO_AUTH')), 2);
  assert.equal(await run(noAuth('AUTH_UNREADABLE')), 2);
  assert.equal(await run(noAuth('API_ERROR')), 1, 'control: any other error is red');
});

test('the CLI exits 2 when the org cannot be read at connect, the same as verify, and 1 for a later API_ERROR', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const { SfUiError } = require('..');
  const run = (more) => cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^a@'], { log: () => {}, warn: () => {}, tools, ...more });
  const unread = async () => { throw new SfUiError('API_ERROR', '/services/data/ answered 503'); };
  assert.equal(await run({ connect: unread }), 2);
  const loginAs = { ...tools, call: async (name, args) => (name === 'sf_start' ? { isError: true, text: JSON.stringify({ code: 'API_ERROR', message: 'API_ERROR: readMetadata SecuritySettings answered 500' }) } : tools.call(name, args)) };
  assert.equal(await run({ rest, tools: loginAs }), 1, 'control: an API_ERROR from sf_start, after the connect, is red');
});

test('a red route runs once more: a flake passes and says so, and a red twice stays red', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  let reds = 1; // c@x is red this many times, then green
  const flaky = { ...tools, call: async (name, args) => { const got = await tools.call(name, args); return name === 'sf_run_route' && args.steps[1].args.text === 'red' && reds-- <= 0 ? { isError: false, text: '{}' } : got; } };
  const out = [];
  const junitFile = path.join(path.dirname(file), 'rerun.xml');
  const code = await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^c@', '--junit', junitFile], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools: flaky });
  assert.equal(code, 0, 'a flake that passes on its rerun does not fail the run');
  assert.match(out[3], /^PASS c@x \d+ms \(unknown: no validity saved\) \(passed on rerun; first try: step 1 sf_wait: TIMEOUT: no "red" in 10000 ms\)$/);
  assert.equal(out.at(-1), 'checked 1, passed 1, failed 0, skipped 0, 1 passed on rerun');
  assert.match(fs.readFileSync(junitFile, 'utf8'), /name="c@x" [^>]*><flakyFailure message="step 1 sf_wait: TIMEOUT: no &#34;red&#34; in 10000 ms" type="rerun"\/><system-out>validity unknown: no validity saved\nrequirement: The child shows red\nrerun after a red: step 1 sf_wait: TIMEOUT: no &#34;red&#34; in 10000 ms<\/system-out>/);
  assert.equal(log.filter((l) => l.startsWith('call sf_run_route')).length, 2);
  reds = 2;
  const slow = { ...rest, remove: async (...a) => { await new Promise((ok) => { setTimeout(ok, 50); }); return rest.remove(...a); } };
  const twice = await replay.replay({ org: 'x', file, rest: slow, tools: flaky, only: /^c@/ });
  assert.deepEqual(twice.results.map((r) => [r.status, r.retried?.step]), [['fail', 1]], 'control: a red on both tries is red');
  assert.ok(twice.results[0].ms >= 50, `the delete between the tries is in the route's time: ${twice.results[0].ms} ms`);
});

test('a rerun\'s first try prints what it has: a step with no message, a message with no step, or nothing', () => {
  const pass = (retried) => cli.line({ id: 'a@x', status: 'pass', ms: 1, retried });
  assert.equal(pass({ step: 1 }), 'PASS a@x 1ms (passed on rerun; first try: step 1)');
  assert.equal(pass({ error: 'NOT_FOUND: x\nlog' }), 'PASS a@x 1ms (passed on rerun; first try: NOT_FOUND: x)');
  assert.equal(pass({}), 'PASS a@x 1ms (passed on rerun)');
  assert.match(replay.junit([{ id: 'a@x', status: 'pass', ms: 1, note: 'unknown: no validity saved' }]), /"><system-out>validity unknown: no validity saved<\/system-out><\/testcase>/, 'a pass that checked nothing says so');
  assert.match(replay.junit([{ id: 'a@x', status: 'pass', ms: 1, retried: { step: 1 } }]), /"><flakyFailure message="step 1" type="rerun"\/><system-out>rerun after a red: step 1<\/system-out><\/testcase>/);
  assert.match(replay.junit([{ id: 'a@x', status: 'fail', ms: 1, step: 2, error: 'x', retried: { step: 1, error: 'y' } }]), /"><failure message="step 2 x"\/><system-out>rerun after a red: step 1 y<\/system-out><\/testcase>/, 'a red twice keeps its first red in system-out');
});

// A red on a changed page gets none either: the STALE test above sends sf_run_route once.
test('a sideEffects route and a stopped run get no rerun', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const routes = () => log.filter((l) => l.startsWith('call sf_run_route')).length;
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations[2].sideEffects = 'sends an email'; // c@x, the red one
  fs.writeFileSync(file, JSON.stringify(all));
  const side = await replay.replay({ org: 'x', file, rest, tools, only: /^c@/, sideEffects: true });
  assert.deepEqual([side.results[0].status, side.results[0].retried, routes()], ['fail', undefined, 1], 'a second run would repeat what it changes');
  all.combinations[2].sideEffects = undefined;
  fs.writeFileSync(file, JSON.stringify(all));
  const stop = new AbortController();
  const stopping = { ...tools, call: async (name, args) => { if (name === 'sf_run_route') stop.abort('SIGTERM'); return tools.call(name, args); } };
  const stopped = await replay.replay({ org: 'x', file, rest, tools: stopping, only: /^c@/, signal: stop.signal });
  assert.deepEqual([stopped.results[0].status, stopped.results[0].retried, routes()], ['fail', undefined, 2], 'no rerun once stopped');
  const control = await replay.replay({ org: 'x', file, rest, tools, only: /^c@/ });
  assert.deepEqual([control.results[0].retried?.step, routes()], [1, 4], 'control: the same red reruns when not stopped and not sideEffects');
});

test('a stopped replay runs no more routes and still deletes what it made', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const stop = new AbortController();
  const stopping = { ...tools, call: async (name, args) => { if (name === 'sf_run_route') stop.abort('SIGTERM'); return tools.call(name, args); } };
  const { results } = await replay.replay({ org: 'x', file, rest, tools: stopping, signal: stop.signal });
  assert.deepEqual(results.map((r) => r.id), ['a@x'], 'the route in hand finishes, no later one starts');
  assert.equal(log.filter((l) => l.startsWith('call sf_run_route')).length, 1);
  assert.deepEqual(log.slice(-5), ['delete SfUiProbe__c#3', 'call sf_end', 'close', 'delete Contact#2', 'delete Account#1']);
});

test('a catalogue that is not JSON is bad usage, exit 2, naming the file', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const run = async (...more) => {
    const out = [];
    return [await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@', ...more], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools }), out[0]];
  };
  assert.equal((await run())[0], 0, 'control: the file as written is green');
  fs.writeFileSync(file, '{ not json');
  for (const more of [[], ['--plan']]) {
    const [code, said] = await run(...more);
    assert.equal(code, 2, more.join());
    assert.match(said, new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not a JSON catalogue: `));
  }
});

test('replay refuses the verify options --matrix and --checks as it does --cascade', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const run = async (...more) => {
    const out = [];
    return [await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@', ...more], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools }), out[0]];
  };
  assert.equal((await run())[0], 0, 'control: the same run with neither is green');
  for (const more of [['--matrix'], ['--checks', 'c.json'], ['--cascade']]) {
    const [code, said] = await run(...more);
    assert.deepEqual([code, said.split('\n')[0]], [2, `${more[0]} is a verify option; replay does not take it`], more[0]);
  }
});

test('the CLI exits 2 for --values that is not a JSON object', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const values = path.join(path.dirname(file), 'values.json');
  const run = async (json) => {
    fs.writeFileSync(values, json);
    return cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^b@', '--values', values], { log: () => {}, warn: () => {}, rest, tools });
  };
  assert.equal(await run('{"uploadName": "x.txt"}'), 0, 'control: an object is taken');
  for (const json of ['null', '3', '"text"', '["a"]']) assert.equal(await run(json), 2, json);
});

test('the CLI runs sideEffects routes with --side-effects or SF_TESTER_REPLAY_SIDE_EFFECTS=1', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const was = process.env.SF_TESTER_REPLAY_SIDE_EFFECTS;
  t.after(() => { if (was === undefined) delete process.env.SF_TESTER_REPLAY_SIDE_EFFECTS; else process.env.SF_TESTER_REPLAY_SIDE_EFFECTS = was; });
  const last = async (...more) => {
    const out = [];
    await cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', '^[bd]@', ...more], { log: (l) => out.push(l), warn: () => {}, rest, tools });
    return out.at(-1);
  };
  delete process.env.SF_TESTER_REPLAY_SIDE_EFFECTS;
  assert.equal(await last(), 'checked 2, passed 1, failed 0, skipped 1', 'control: skipped by default');
  assert.equal(await last('--side-effects'), 'checked 2, passed 2, failed 0, skipped 0');
  process.env.SF_TESTER_REPLAY_SIDE_EFFECTS = '1';
  assert.equal(await last(), 'checked 2, passed 2, failed 0, skipped 0');
});

test('routeIndex is as wide as the largest index, so at 1001 routes no probe name is a prefix of another', async (t) => {
  const { file, rest, tools, log } = fake(t);
  const entries = Array.from({ length: 1001 }, (_, n) => ({ id: `r${n}@x`, needs: ['probeName'], status: 'tested', route: [{ tool: 'sf_open_record', args: { recordId: '{{probeId}}' } }, { tool: 'sf_wait', args: { text: '{{probeName}}' } }] }));
  fs.writeFileSync(file, JSON.stringify({ placeholders: PH, candidates: [], combinations: entries }));
  const { stamp } = await replay.replay({ org: 'x', file, rest, tools, only: /^r(100|1000)@x$/ });
  const names = log.filter((l) => l.startsWith('create SfUiProbe__c#')).map((l) => l.split(' ')[2]);
  assert.deepEqual(names, [`p${stamp}n0100`, `p${stamp}n1000`]);
});

test('two routes whose indexes differ in the first digit rerun under different names', async (t) => {
  const { file, rest, tools, log } = fake(t);
  const entries = Array.from({ length: 200 }, (_, n) => ({ id: `r${n}@x`, needs: ['probeName'], status: 'tested', route: [{ tool: 'sf_open_record', args: { recordId: '{{probeId}}' } }, { tool: 'sf_wait', args: { text: 'red' } }] }));
  fs.writeFileSync(file, JSON.stringify({ placeholders: PH, candidates: [], combinations: entries }));
  const { stamp } = await replay.replay({ org: 'x', file, rest, tools, only: /^r(23|123)@x$/ });
  const names = log.filter((l) => l.startsWith('create SfUiProbe__c#')).map((l) => l.split(' ')[2]);
  assert.deepEqual(names, [`p${stamp}n023`, `p${stamp}nr023`, `p${stamp}n123`, `p${stamp}nr123`]);
});

// signal-exit (loaded by @salesforce/core's file locks) re-raises a signal it finds no other listener for, which once
// lost the cleanup on the org: the child here registers the same listener, then the CLI's, and signals itself.
test('a SIGTERM with signal-exit loaded still lets the CLI clean up, print its count and exit 143', async (t) => {
  const { file } = fake(t, { placeholders: CHILD });
  const child = `
    const { main, stopOnSignals, CODES } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'cli.js'))});
    const signal = stopOnSignals();
    const reraise = () => { if (process.listeners('SIGTERM').length === 1) { process.removeListener('SIGTERM', reraise); process.kill(process.pid, 'SIGTERM'); } };
    process.on('SIGTERM', reraise);
    let n = 0;
    const rest = { create: async (o) => o + '#' + ++n, remove: async (o, id) => console.log('delete ' + id) };
    const tools = { close: async () => {}, call: async (name) => {
      if (name === 'sf_run_route') { process.kill(process.pid, 'SIGTERM'); await new Promise((r) => setTimeout(r, 200)); }
      return { isError: false, text: '{}' };
    } };
    main(['replay', '--org', 'x', '--catalogue', ${JSON.stringify(file)}], { signal, rest, tools, madeDir: ${JSON.stringify(path.join(testHome, 'made'))} }).then((code) => { process.exitCode = signal.aborted ? CODES[signal.reason] : code; });`;
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.signal, null, `killed by ${r.signal}: ${r.stdout}${r.stderr}`);
  assert.equal(r.status, 143, r.stderr);
  assert.match(r.stdout, /^PASS a@x \d+ms \(unknown: no validity saved\)$/m);
  assert.match(r.stdout, /delete Account#1\nchecked 1, passed 1, failed 0, skipped 0\n$/);
});

test('--app starts the replay in that app, and an entry with its own app restarts in it, then returns', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations[1].app = 'SF UI Console'; // b@x
  fs.writeFileSync(file, JSON.stringify(all));
  const starts = [];
  const spy = { ...tools, call: (name, args) => { if (name === 'sf_start') starts.push(args.app ?? 'none'); return tools.call(name, args); } };
  await cli.main(['replay', '--org', 'x', '--app', 'SF UI App', '--catalogue', file, '--only', '^[abc]@'], { log: () => {}, warn: () => {}, rest, tools: spy });
  // c@x is red, so its rerun starts once more in its own app.
  assert.deepEqual(starts, ['SF UI App', 'SF UI Console', 'SF UI App', 'SF UI App']);
  starts.length = 0;
  await replay.replay({ org: 'x', file, rest, tools: spy, only: /^[abc]@/ });
  assert.deepEqual(starts, ['none', 'SF UI Console', 'none', 'none'], 'control: no --app starts with none and goes back to none');
  starts.length = 0;
  await replay.replay({ org: 'x', app: 'sf ui console', file, rest, tools: spy, only: /^[abc]@/ });
  assert.deepEqual(starts, ['sf ui console', 'sf ui console'], 'the same app in another case needs no restart; the second is c@x\'s rerun');
});

// sf_start closes the session before it opens one, so a refused app leaves none, as the server does.
test('an entry whose app cannot open fails alone: the next route starts a session again', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations[0].app = 'Nope App'; // a@x
  fs.writeFileSync(file, JSON.stringify(all));
  let open = false;
  const server = { ...tools, call: async (name, args) => {
    if (name === 'sf_start') { open = args.app !== 'Nope App'; return open ? tools.call(name, args) : { isError: true, text: 'APP_UNAVAILABLE: Nope App' }; }
    if (name === 'sf_run_route' && !open) return { isError: true, text: JSON.stringify({ code: 'NO_SESSION', message: 'NO_SESSION: call sf_start first' }) };
    return tools.call(name, args);
  } };
  const { results } = await replay.replay({ org: 'x', app: 'SF UI App', file, rest, tools: server, only: /^[ab]@/ });
  assert.deepEqual(results.map((r) => [r.id, r.status, r.error]), [['a@x', 'fail', 'sf_start in app Nope App: APP_UNAVAILABLE: Nope App'], ['b@x', 'pass', undefined]]);
});

// A route that fails between two app switches leaves the browser in the wrong app, so the next one restarts.
test('a red route restarts the session before the next route, in that route\'s app, with or without --app', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const starts = [];
  let red = 'return'; // how route a fails, on both tries: an error result, a thrown call, or a failed restart after it
  const spy = { ...tools, call: async (name, args) => {
    if (name === 'sf_start') { starts.push(args.app ?? 'none'); if ((red === 'restart' && starts.length === 3) || (red === 'rerun' && starts.length > 1)) return { isError: true, text: 'LOGIN_FAILED' }; }
    if (name === 'sf_run_route' && args.steps[1].args.text.startsWith('Company')) {
      if (red === 'throw') throw new Error('Request timed out');
      return { isError: true, text: JSON.stringify({ code: 'NOT_FOUND', message: 'NOT_FOUND: x' }) };
    }
    return tools.call(name, args);
  } };
  const run = async (app, only = /^[ab]@/) => { starts.length = 0; return (await replay.replay({ org: 'x', ...(app && { app }), file, rest, tools: spy, only })).results.map((r) => [r.id, r.status]); };
  // Each start: the run's, a@x's rerun, then b@x's after a@x's second red.
  assert.deepEqual(await run('SF UI App'), [['a@x', 'fail'], ['b@x', 'pass']]);
  assert.deepEqual(starts, ['SF UI App', 'SF UI App', 'SF UI App']);
  assert.deepEqual(await run(), [['a@x', 'fail'], ['b@x', 'pass']]);
  assert.deepEqual(starts, ['none', 'none', 'none'], 'no app given: it still restarts, so a Login As or a modal is not carried over');
  red = 'throw';
  assert.deepEqual(await run('SF UI App'), [['a@x', 'fail'], ['b@x', 'pass']]);
  assert.deepEqual(starts, ['SF UI App', 'SF UI App', 'SF UI App'], 'a route whose call threw restarts too');
  red = 'restart';
  starts.length = 0;
  const { results: r } = await replay.replay({ org: 'x', app: 'SF UI App', file, rest, tools: spy, only: /^[ab]@/ });
  assert.deepEqual(r.map((x) => [x.id, x.status, x.retried]), [['a@x', 'fail', { step: undefined, error: 'NOT_FOUND: x' }], ['b@x', 'fail', undefined]], 'a failed restart is a refusal before the route: no rerun');
  assert.match(r[1].error, /^sf_start in app SF UI App \(restart after a red\): LOGIN_FAILED/, 'the next route names why it failed');
  red = 'rerun'; // a@x's rerun cannot restart either, so b@x's restart follows a refusal, not a red route
  starts.length = 0;
  const { results: twice } = await replay.replay({ org: 'x', app: 'SF UI App', file, rest, tools: spy, only: /^[ab]@/ });
  assert.deepEqual(twice.map((x) => [x.id, x.status]), [['a@x', 'fail'], ['b@x', 'fail']]);
  assert.match(twice[1].error, /\(restart after a red\): LOGIN_FAILED/, 'a refused rerun keeps the hint for the next route');
});

// A fake git for --since: the merge base, the diff's files, and the catalogue at the base (absent when then is not given).
const fakeGit = (file, files, then) => (args) => {
  if (args[0] === 'merge-base') return 'abc1234def\n';
  if (args[0] === 'diff') return assert.deepEqual(args.slice(1), ['-z', '--name-only', '--no-renames', 'origin/main...HEAD'], 'the merge-base diff, a rename as both paths') ?? `${files.join('\0')}\0`;
  if (args[0] === 'rev-parse') return `${path.dirname(file)}\n`;
  // Every sfdx-project.json under the fake repo's top, as ls-files prints them.
  if (args[2] === 'ls-files') {
    assert.deepEqual(args, ['-C', path.dirname(file), 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'sfdx-project.json', '**/sfdx-project.json']);
    return fs.readdirSync(path.dirname(file), { recursive: true }).filter((p) => path.basename(p) === 'sfdx-project.json').map((p) => `${p.split(path.sep).join('/')}\0`).join('');
  }
  if (!then) throw Object.assign(new Error('Command failed: git show'), { stderr: `fatal: path 'combinations.json' does not exist in '${args[1].split(':')[0]}'\n` });
  return JSON.stringify(then);
};

// A renamed tab: its label at the merge base (what the routes still quote), at HEAD and on disk, unescaped and trimmed;
// a new tab has none at the base, and a diff with no tab or app file asks git nothing.
test('--since reads a changed tab file\'s label at the merge base, at HEAD and on disk', (t) => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tabs-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const tab = 'test/fixture/force-app/main/default/tabs/X.tab-meta.xml';
  fs.mkdirSync(path.join(top, path.dirname(tab)), { recursive: true });
  fs.writeFileSync(path.join(top, tab), '<CustomTab><label>\n  New &amp; Hub\n</label></CustomTab>');
  const git = (base) => (args) => {
    if (args[0] === 'rev-parse') return `${top}\n`;
    if (args[1].startsWith('HEAD:')) return '<CustomTab><label>Bob&#39;s Hub</label></CustomTab>';
    if (base) return `<CustomTab><label>${base}</label></CustomTab>`;
    throw Object.assign(new Error('Command failed: git show'), { stderr: `fatal: path '${tab}' exists on disk, but not in 'abc'\n` });
  };
  assert.deepEqual(cli.tabLabels([tab, 'README.md'], 'abc', git('Old Label')), { [tab]: ['Old Label', "Bob's Hub", 'New & Hub'] });
  assert.deepEqual(cli.tabLabels([tab], 'abc', git(null)), { [tab]: ["Bob's Hub", 'New & Hub'] });
  assert.deepEqual(cli.tabLabels(['README.md'], 'abc', () => assert.fail('no git call')), {});
  // An app file too; a decoded & is not decoded again, and a code point past Unicode stays as written.
  const app = 'test/fixture/force-app/main/default/applications/Y.app-meta.xml';
  const appGit = (args) => (args[0] === 'rev-parse' ? `${top}\n` : `<CustomApplication><label>${args[1].startsWith('HEAD:') ? 'A &#38;lt; B' : 'It&#x27;s &#99999999;'}</label></CustomApplication>`);
  assert.deepEqual(cli.tabLabels([app], 'abc', appGit), { [app]: ['It\'s &#99999999;', 'A &lt; B'] });
  // A user's tab under a package's main/default is read too; with no package directories it is not.
  const mine = 'force-app/main/default/tabs/X.tab-meta.xml';
  assert.deepEqual(cli.tabLabels([mine], 'abc', git('Old Label'), top, ['force-app']), { [mine]: ['Old Label', "Bob's Hub"] });
  assert.deepEqual(cli.tabLabels([mine], 'abc', () => assert.fail('no git call')), {});
  // A Tabs/ folder in another case is a tab folder too, as select.js reads it.
  const upper = 'test/fixture/force-app/main/default/Tabs/Z.tab-meta.xml'; // not on disk
  assert.deepEqual(cli.tabLabels([upper], 'abc', git(null)), { [upper]: ["Bob's Hub"] });
});

// The wiring: a tab file in the diff selects, through the CLI, the route that opens the tab by its label at the base.
test('--since selects the route that opens a changed tab by its old label', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  cat.combinations.push({ id: 'e@x', needs: [], status: 'tested', container: 'app page', task: 'Open the tab', route: [{ tool: 'sf_open_tab', args: { tab: 'old label' } }] });
  fs.writeFileSync(file, JSON.stringify(cat));
  const tab = 'test/fixture/force-app/main/default/tabs/X.tab-meta.xml';
  const git = (args) => {
    if (args[0] === 'merge-base') return 'abc1234def\n';
    if (args[0] === 'diff') return `${tab}\0`;
    if (args[0] === 'rev-parse') return `${path.dirname(file)}\n`;
    if (args[1] === `abc1234def:${tab}`) return '<CustomTab><label>Old Label</label></CustomTab>';
    if (args[1].endsWith(tab)) return '<CustomTab><label>New Label</label></CustomTab>';
    return JSON.stringify(cat);
  };
  const out = [];
  assert.equal(await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git }), 0);
  assert.deepEqual([out.filter((l) => l.startsWith('  fixture')), out.at(-1)], [['  fixture 1: X'], 'total 1'], 'e@x alone, by its old label');
});

// The wiring: the package directories come from every sfdx-project.json in the repo, under its folder.
test('--since replays the smoke slice for a metadata change under a package directory of sfdx-project.json', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const plan = async (files = ['force-app/main/default/lwc/myCard/myCard.js']) => {
    const out = [];
    const code = await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git: fakeGit(file, files, JSON.parse(fs.readFileSync(file, 'utf8'))) });
    return { code, smoke: out.find((l) => l.startsWith('  smoke')), last: out.at(-1) };
  };
  assert.deepEqual(await plan(), { code: 0, smoke: '  smoke 0', last: 'total 0' }, 'control: no sfdx-project.json, no package');
  fs.writeFileSync(path.join(path.dirname(file), 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: './force-app/' }] }));
  const got = await plan();
  assert.equal(got.code, 0);
  assert.match(got.smoke, /^  smoke [1-9]\d*: force-app\/main\/default\/lwc\/myCard\/myCard\.js \(no route names myCard\)$/);
  assert.match(got.last, /^total [1-9]/);
  // A project in a subfolder: its package directory sits under that folder, and not at the top.
  fs.mkdirSync(path.join(path.dirname(file), 'sub'));
  fs.writeFileSync(path.join(path.dirname(file), 'sub', 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'pkg' }] }));
  assert.match((await plan(['sub/pkg/main/default/lwc/x/x.js'])).smoke, /^  smoke [1-9]\d*: sub\/pkg\/main\/default\/lwc\/x\/x\.js \(no route names x\)$/);
  assert.equal((await plan(['pkg/main/default/lwc/x/x.js'])).smoke, '  smoke 0', 'control: pkg at the top is no package');
});

// A tracked sfdx-project.json deleted on disk is no project, not a crash.
test('--since skips an sfdx-project.json git lists but the disk no longer has', (t) => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pkgs-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  fs.writeFileSync(path.join(top, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }));
  assert.deepEqual(cli.packages(top, () => 'gone/sfdx-project.json\0sfdx-project.json\0'), ['force-app']);
});

// Real git: a folder name git would quote (non-ASCII) is read as it is on disk, in the diff and in ls-files.
test('--since selects for a project in a folder whose name git quotes', async (t) => {
  for (const dir of ['projekt', 'pr\u00f6jekt']) {
    const { file, rest, tools } = fake(t, { placeholders: CHILD });
    const top = path.dirname(file);
    const git = (args) => require('node:child_process').execFileSync('git', ['-C', top, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
    fs.mkdirSync(path.join(top, dir));
    fs.writeFileSync(path.join(top, dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'pkg' }] }));
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).trim();
    fs.mkdirSync(path.join(top, dir, 'pkg/main/default/classes'), { recursive: true });
    fs.writeFileSync(path.join(top, dir, 'pkg/main/default/classes/X.cls'), 'public class X {}');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'change']);
    const out = [];
    assert.equal(await cli.main(['replay', '--catalogue', file, '--plan', '--since', base], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git }), 0);
    assert.match(out.find((l) => l.startsWith('  smoke')), new RegExp(`^  smoke [1-9]\\d*: ${dir}/pkg/main/default/classes/X\\.cls \\(no route names X\\)$`), dir);
  }
});

test('--since with a malformed sfdx-project.json is bad usage, exit 2', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  fs.writeFileSync(path.join(path.dirname(file), 'sfdx-project.json'), '{"packageDirectories":[],}');
  const out = [];
  const code = await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git: fakeGit(file, ['force-app/x.js'], JSON.parse(fs.readFileSync(file, 'utf8'))) });
  assert.equal(code, 2);
  assert.match(out.join('\n'), /sfdx-project\.json is not JSON: .*\nusage: sf-tester replay/);
});

// A bad project file below the top (a template) warns and its folder takes smoke; the top one stays bad usage (above).
test('--since skips a malformed sfdx-project.json below the repo top with a warning', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const top = path.dirname(file);
  fs.writeFileSync(path.join(top, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }));
  fs.mkdirSync(path.join(top, 'templates/app'), { recursive: true });
  fs.mkdirSync(path.join(top, 'templates/bad'), { recursive: true });
  fs.writeFileSync(path.join(top, 'templates/app/sfdx-project.json'), '{"packageDirectories":[{"path":"<%= appDir %>"}],<% } %>}');
  fs.writeFileSync(path.join(top, 'templates/bad/sfdx-project.json'), 'null');
  const out = [];
  const code = await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(`warn ${l}`), rest, tools, git: fakeGit(file, ['force-app/main/default/lwc/myCard/myCard.js', 'templates/bad/force-app/main/default/classes/Foo.cls'], JSON.parse(fs.readFileSync(file, 'utf8'))) });
  assert.equal(code, 0, out.join('\n'));
  const warned = out.filter((l) => l.startsWith('warn')).map((l) => l.replace(top, '<top>')).sort();
  assert.equal(warned.length, 2, warned.join('\n'));
  assert.match(warned[0], /^warn <top>\/templates\/app\/sfdx-project\.json is not JSON: .+: its files take the smoke slice$/);
  assert.equal(warned[1], 'warn <top>/templates/bad/sfdx-project.json has no valid packageDirectories: its files take the smoke slice');
  // Its <folder>/main/default reads as a metadata root (as main/default always did), so the reason names the class.
  assert.match(out.find((l) => l.startsWith('  smoke')), /templates\/bad\/force-app\/main\/default\/classes\/Foo\.cls \(no route names Foo\)/, 'a file in the skipped project still takes smoke');
  assert.match(out.find((l) => l.startsWith('  smoke')), /^  smoke [1-9]\d*: force-app\/main\/default\/lwc\/myCard\/myCard\.js /);
});

test('--since with an sfdx-project.json of the wrong shape is bad usage, exit 2', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  for (const json of ['null', '[]', '{"packageDirectories":{}}', '{"packageDirectories":[{"package":"x"}]}']) {
    fs.writeFileSync(path.join(path.dirname(file), 'sfdx-project.json'), json);
    const out = [];
    const code = await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git: fakeGit(file, ['force-app/x.js'], JSON.parse(fs.readFileSync(file, 'utf8'))) });
    assert.deepEqual([code, /sfdx-project\.json has no valid packageDirectories\nusage: sf-tester replay/.test(out.join('\n'))], [2, true], json);
  }
});

test('--since shows the first five files of a reason, then "and N more"', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => `src/${x}.js`);
  const out = [];
  const git = fakeGit(file, files, JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(await cli.main(['replay', '--catalogue', file, '--plan', '--since', 'origin/main'], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git }), 0);
  assert.match(out.find((l) => l.startsWith('  smoke')), /^  smoke \d+: src\/a\.js, src\/b\.js, src\/c\.js, src\/d\.js, src\/e\.js and 2 more$/);
});

test('--since replays only the routes the diff affects; none affected exits 0, and an --only that empties it exits 2', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  const then = { ...now, combinations: now.combinations.map((e) => (e.id === 'b@x' ? { ...e, needs: [] } : e)) };
  const run = async (args, files, base = then, git = fakeGit(file, files, base)) => {
    const out = [];
    const code = await cli.main(['replay', '--catalogue', file, ...args], { log: (l) => out.push(l), warn: (l) => out.push(l), rest, tools, git });
    return { code, out };
  };
  const planned = await run(['--plan', '--since', 'origin/main'], ['src/combinations.json', 'README.md']);
  assert.equal(planned.code, 0);
  assert.deepEqual(planned.out.slice(1), ['since origin/main (merge base abc1234), 2 files changed', '  catalogue 1: b@x', '  fixture 0', '  smoke 0', 'total 1']);
  assert.deepEqual(log, [], '--plan needs no --org, makes no record and calls no tool');
  const replayed = await run(['--org', 'x', '--since', 'origin/main'], ['src/combinations.json']);
  assert.equal(replayed.code, 0);
  assert.deepEqual(replayed.out.filter((l) => /^(PASS|FAIL|SKIP) /.test(l)).map((l) => l.split(' ')[1]), ['b@x']);
  const junitFile = path.join(path.dirname(file), 'none.xml');
  const docs = await run(['--org', 'x', '--since', 'origin/main', '--junit', junitFile], ['README.md'], now);
  assert.match(fs.readFileSync(junitFile, 'utf8'), /<testsuite name="sf-tester replay" tests="0" failures="0" errors="0" skipped="0"/, 'an empty suite');
  assert.deepEqual([docs.code, docs.out.at(-1)], [0, 'no route affected by origin/main']);
  assert.deepEqual((await run(['--plan', '--since', 'origin/main'], ['README.md'], now)).out.slice(-2), ['no route affected by origin/main', 'total 0'], 'a plan always ends in its total');
  const fresh = await run(['--plan', '--since', 'origin/main', '--only', '^[bcd]@'], ['src/combinations.json'], null);
  assert.deepEqual(fresh.out.slice(-3), ['  smoke 0', '--only ^[bcd]@ keeps 3 of 4', 'total 2 (1 sideEffects skipped)'], 'no catalogue at the base: every entry is new');
  assert.equal((await run(['--org', 'x', '--since', 'origin/main', '--only', '^a@'], ['src/combinations.json'])).code, 2, 'the intersection is empty');
  const emptied = await run(['--plan', '--since', 'origin/main', '--only', '^a@'], ['src/combinations.json']);
  assert.deepEqual([emptied.code, emptied.out.at(-1)], [2, 'no route ran: check the catalogue and --only'], 'and --plan says the same');
  // Only d@x changed, and it has sideEffects: nothing to run, the same verdict and message for the plan and the run.
  const sideOnly = { ...now, combinations: now.combinations.map((e) => (e.id === 'd@x' ? { ...e, needs: [] } : e)) };
  const said = 'no route to run: every route origin/main affects has sideEffects (--side-effects runs them)';
  const sidePlan = await run(['--plan', '--since', 'origin/main'], ['src/combinations.json'], sideOnly);
  assert.deepEqual([sidePlan.code, ...sidePlan.out.slice(-2)], [0, 'total 0 (1 sideEffects skipped)', said]);
  const calls = log.length;
  const sideRun = await run(['--org', 'x', '--since', 'origin/main', '--junit', junitFile], ['src/combinations.json'], sideOnly);
  assert.deepEqual([sideRun.code, sideRun.out.at(-1), log.length - calls], [0, said, 0], 'no record made, no tool called');
  assert.match(fs.readFileSync(junitFile, 'utf8'), /tests="1" failures="0" errors="0" skipped="1"/);
  assert.equal((await run(['--org', 'x', '--since', 'origin/main', '--side-effects'], ['src/combinations.json'], sideOnly)).code, 0, 'control: --side-effects runs it');
  const badRef = () => { throw Object.assign(new Error('Command failed: git merge-base'), { stderr: 'fatal: Not a valid object name nope\n' }); };
  const bad = await run(['--plan', '--since', 'nope'], [], then, badRef);
  assert.equal(bad.code, 2);
  assert.match(bad.out[0], /^fatal: Not a valid object name nope\n/);
  const unreadable = (args) => { if (args[0] !== 'show') return fakeGit(file, [], then)(args); throw Object.assign(new Error('Command failed: git show'), { stderr: 'fatal: bad object abc1234def\n' }); };
  const lost = await run(['--plan', '--since', 'origin/main'], [], then, unreadable);
  assert.deepEqual([lost.code, lost.out[0].split('\n')[0]], [2, 'fatal: bad object abc1234def'], 'only an absent base catalogue counts as empty');
  await assert.rejects(run(['--plan', '--since', 'origin/main'], [], then, (args) => (args[0] === 'show' ? '{not json' : fakeGit(file, [], then)(args))), SyntaxError, 'a bug is not bad usage');
  assert.deepEqual((await run(['--plan'], [])).out.slice(1), ['total 3 (1 sideEffects skipped)'], 'control: no --since plans every tested route');
});

// A replay runs hundreds of routes on one session, so neither its first start nor a restart may carry a tool-call budget.
test('both of the replay\'s sf_start calls pass budget 0', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations[1].app = 'SF UI Console'; // b@x restarts the session
  fs.writeFileSync(file, JSON.stringify(all));
  const budgets = [];
  const spy = { ...tools, call: (name, args) => { if (name === 'sf_start') budgets.push(args.budget); return tools.call(name, args); } };
  await replay.replay({ org: 'x', file, rest, tools: spy, only: /^[ab]@/ });
  assert.deepEqual(budgets, [0, 0], 'the first start, then the restart into the console');
});

const READER = { profile: 'Read Only', permissionSets: ['Probe_Read'] };
// Routes a to c through the fake server, with b saved as a persona. Two users hold the profile; only 005b is an exact match.
function personaRun(t, { persona = READER, started = {}, routes = ['b@x', 'c@x'], sets = [{ AssigneeId: '005a', PermissionSet: { Name: 'Probe_Read' } }, { AssigneeId: '005a', PermissionSet: { Name: 'Extra' } }, { AssigneeId: '005b', PermissionSet: { Name: 'Probe_Read' } }] } = {}) {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.map((e) => (routes.includes(e.id) ? { ...e, validity: { persona } } : e));
  all.combinations[2].route[1].args.text = 'plain';
  fs.writeFileSync(file, JSON.stringify(all));
  const logins = [];
  const sent = [];
  const queries = [];
  const call = async (name, args) => {
    if (name === 'sf_login_as') logins.push(args);
    if (name === 'sf_run_route') sent.push(args.validity);
    const out = await tools.call(name, args);
    return name === 'sf_start' ? { ...out, text: JSON.stringify({ userId: '005self', ...started }) } : out;
  };
  const query = async (q) => { queries.push(q); return q.includes('FROM User') ? [{ Id: '005a' }, { Id: '005b' }] : sets; };
  let asked = query;
  return { run: () => replay.replay({ org: 'x', file, rest: { ...rest, query: (q) => asked(q) }, tools: { ...tools, call }, only: /^[abc]@/ }), setQuery: (q) => { asked = q; }, query, log, logins, sent, queries, file };
}
const steps = (log) => log.filter((l) => /^call sf_(start|login_as|run_route)/.test(l)).map((l) => l.slice(5).split(' ').slice(0, 1)[0]);

test('a persona route runs as the exact match, found once, and the next route goes back to the alias user', async (t) => {
  const r = personaRun(t);
  const { results } = await r.run();
  assert.deepEqual(results.map((x) => x.status), ['pass', 'pass', 'pass']);
  assert.deepEqual(r.logins, [{ user: '005b' }, { user: '005b' }], 'not 005a, who holds one perm set more');
  assert.deepEqual(r.sent, [undefined, { persona: READER }, { persona: READER }], 'the server compares against the whole baseline');
  assert.deepEqual(steps(r.log), ['sf_start', 'sf_run_route', 'sf_login_as', 'sf_run_route', 'sf_start', 'sf_login_as', 'sf_run_route']);
  assert.equal(r.queries.length, 2, 'two routes of one persona look the user up once');
  assert.match(r.queries[0], /IsActive = true AND Profile.Name = 'Read Only' ORDER BY Username/);
  assert.match(r.queries[1], /PermissionSet.Type != 'Session'/);
  assert.doesNotMatch(r.queries[0], /LIMIT/, 'no cap on the users of a profile');
  assert.match(r.queries[1], /WHERE Assignee.IsActive = true AND Assignee.Profile.Name = 'Read Only' AND /, 'assignments by profile, not by a list of ids');
});

test('perm sets match in any order, in the catalogue or from the org', async (t) => {
  const sets = [{ AssigneeId: '005b', PermissionSet: { Name: 'Z' } }, { AssigneeId: '005b', PermissionSet: { Name: 'A' } }];
  for (const permissionSets of [['A', 'Z'], ['Z', 'A']]) {
    const r = personaRun(t, { sets, persona: { ...READER, permissionSets } });
    await r.run();
    assert.equal(r.logins[0]?.user, '005b', permissionSets.join());
  }
});

test('an API error in the user lookup fails one route, and the next asks again', async (t) => {
  const r = personaRun(t);
  const { run, query } = r;
  let calls = 0;
  r.setQuery(async (q) => { calls += 1; if (calls === 1) throw new Error('API_ERROR: 503'); return query(q); });
  const { results } = await run();
  assert.deepEqual(results.map((x) => x.status), ['pass', 'fail', 'pass']);
});

test('a persona with no matching user is a red that names it, and the run goes on', async (t) => {
  const r = personaRun(t, { persona: { ...READER, permissionSets: ['Nobody'] } });
  const { results } = await r.run();
  assert.deepEqual(results.map((x) => x.status), ['pass', 'fail', 'fail']);
  assert.match(results[1].error, /NO_PERSONA_USER: no active user with profile Read Only has exactly these perm sets: Nobody/);
  assert.deepEqual(r.logins, []);
});

test('a persona whose user is the alias user runs with no login', async (t) => {
  const r = personaRun(t, { sets: [{ AssigneeId: '005self', PermissionSet: { Name: 'Probe_Read' } }], started: { userId: '005a' }, persona: { ...READER, permissionSets: [] } });
  const { results } = await r.run();
  assert.deepEqual(results.map((x) => x.status), ['pass', 'pass', 'pass']);
  assert.deepEqual(r.logins, [], '005a holds no perm set and is the alias user here');
});

test('the alias user wins a persona when another user sorts first', async (t) => {
  const r = personaRun(t, { sets: [], started: { userId: '005b' }, persona: { ...READER, permissionSets: [] } });
  await r.run();
  assert.deepEqual(r.logins, [], 'both hold no perm set, and 005a sorts first');
});

test('a production replay skips a persona route and picks no user', async (t) => {
  const r = personaRun(t, { started: { production: true } });
  const { results } = await r.run();
  assert.deepEqual(results.map((x) => x.status), ['pass', 'skip', 'skip']);
  assert.match(results[1].reason, /production/);
  assert.deepEqual([r.logins, r.queries], [[], []]);
  const all = personaRun(t, { started: { production: true }, routes: ['a@x', 'b@x', 'c@x'] });
  await all.run();
  assert.deepEqual(all.log.filter((l) => l.startsWith('create')), [], 'no record for a route that does not run');
  const owner = personaRun(t, { started: { production: true } });
  await owner.run();
  assert.ok(owner.log.some((l) => l.startsWith('create Account')), 'control: a route that runs still gets its records');
});

test('a production run of only persona routes says so, not that the catalogue is wrong', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.map((e) => (e.id === 'b@x' ? { ...e, validity: { persona: READER } } : e));
  fs.writeFileSync(file, JSON.stringify(all));
  const prod = { ...tools, call: async (name, args) => { const out = await tools.call(name, args); return name === 'sf_start' ? { ...out, text: '{"userId":"005self","production":true}' } : out; } };
  const said = [];
  const run = (only) => cli.main(['replay', '--org', 'x', '--catalogue', file, '--only', only], { log: () => {}, warn: (l) => said.push(l), rest, tools: prod });
  assert.equal(await run('^b@'), 2);
  assert.equal(said.at(-1), 'no route ran: only persona routes, which a production run does not replay');
  assert.equal(await run('^d@'), 2, 'control: a sideEffects skip still blames the catalogue');
  assert.equal(said.at(-1), 'no route ran: check the catalogue and --only');
  assert.equal(await run('^[bd]@'), 2, 'a persona skip beside a sideEffects skip');
  assert.equal(said.at(-1), 'no route ran: only persona routes, which a production run does not replay');
});

test('a failed restart after a refused login does not blame an older red route', async (t) => {
  const { file, rest, tools } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations[1].validity = { persona: READER }; // b@x logs in as the reader; c@x is red in its route
  all.combinations = [all.combinations[2], all.combinations[1], all.combinations[0]]; // c@x, b@x, a@x
  fs.writeFileSync(file, JSON.stringify(all));
  const query = async (q) => (q.includes('FROM User') ? [{ Id: '005b' }] : [{ AssigneeId: '005b', PermissionSet: { Name: 'Probe_Read' } }]);
  let starts = 0;
  const call = async (name, args) => {
    if (name === 'sf_login_as') return { isError: true, text: 'LOGIN_AS_DISABLED' };
    if (name === 'sf_start' && ++starts === 4) return { isError: true, text: 'LOGIN_FAILED' }; // a@x's restart
    return tools.call(name, args);
  };
  const { results } = await replay.replay({ org: 'x', file, rest: { ...rest, query }, tools: { ...tools, call }, only: /^[abc]@/ });
  assert.deepEqual(results.map((r) => [r.id, r.status]), [['c@x', 'fail'], ['b@x', 'fail'], ['a@x', 'fail']]);
  assert.equal(results[2].error, 'sf_start in app undefined: LOGIN_FAILED', 'b@x restarted after c@x\'s red, so a@x\'s restart follows b@x\'s login');
});

test('a login that fails is a red for that route, and the next route still runs', async (t) => {
  const r = personaRun(t);
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  fs.copyFileSync(r.file, file);
  const refuse = async (name, args) => (name === 'sf_login_as' ? { isError: true, text: 'LOGIN_AS_DISABLED' } : { ...(await tools.call(name, args)), ...(name === 'sf_start' && { text: '{"userId":"005self"}' }) });
  const query = async (q) => (q.includes('FROM User') ? [{ Id: '005b' }] : [{ AssigneeId: '005b', PermissionSet: { Name: 'Probe_Read' } }]);
  const { results } = await replay.replay({ org: 'x', file, rest: { ...rest, query }, tools: { ...tools, call: refuse }, only: /^[abc]@/ });
  assert.deepEqual(results.map((x) => x.status), ['pass', 'fail', 'fail']);
  assert.match(results[1].error, /sf_login_as for Read Only: LOGIN_AS_DISABLED/);
  assert.equal(log.filter((l) => l === 'call sf_start').length, 2, 'a failed login still restarts the next route, and a refusal before the route gets no rerun');
});

test('a persona name with a quote stays one SOQL string', async (t) => {
  const r = personaRun(t, { persona: { ...READER, profile: "Bob's \\ Team" } });
  await r.run();
  assert.match(r.queries[0], /Profile.Name = 'Bob\\'s \\\\ Team'/);
  assert.match(r.queries[1], /Assignee.Profile.Name = 'Bob\\'s \\\\ Team'/, 'and in the assignments');
});

test('the replay\'s own query reads every page, so a persona past one page of users or assignments is found', async (t) => {
  const { api } = require('..');
  const asked = [];
  t.mock.method(api, 'call', async (s, p) => {
    asked.push(p);
    return p.startsWith('/query?') ? { records: [{ Id: '005a' }], done: false, nextRecordsUrl: '/services/data/v60.0/query/01gx-2000' } : { records: [{ Id: '005b' }], done: true };
  });
  assert.deepEqual(await (await replay.admin('x', async () => ({}))).query('SELECT Id FROM User'), [{ Id: '005a' }, { Id: '005b' }]);
  assert.equal(asked[1], '/query/01gx-2000');
});

test('the replay\'s own check reads an org error as unknown, so the route runs', async (t) => {
  const { api, SfUiError } = require('..');
  t.mock.method(api, 'call', async () => { throw new SfUiError('API_ERROR', 'the org refused'); });
  const check = (await replay.admin('x', async () => ({}))).check;
  assert.deepEqual(await check({ app: { name: 'A', hash: 'a1' } }), { state: 'unknown', unchecked: ['the check failed: API_ERROR: the org refused'] });
  assert.equal((await check({ persona: { profile: 'P' } })).state, 'unknown', 'a validity this version cannot read is no crash');
});

test('--baseline keeps a route\'s persona', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-'));
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ combinations: [{ id: 'a@x', validity: { persona: READER, page: { formHash: 'old' } } }] }));
  combinations.baseline({ 'a@x': { page: { formHash: 'new' } } }, { file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).combinations[0].validity, { page: { formHash: 'new' }, persona: READER });
  fs.rmSync(dir, { recursive: true });
});

test('--baseline keeps the saved set hashes when the read could not hash them, and takes new ones when it can', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-'));
  const file = path.join(dir, 'c.json');
  const hashed = (h) => ({ persona: { ...READER, permissionSetHashes: { Probe_Read: h } } });
  fs.writeFileSync(file, JSON.stringify({ combinations: [{ id: 'a@x', validity: hashed('h1') }] }));
  const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')).combinations[0].validity;
  combinations.baseline({ 'a@x': { persona: READER } }, { file });
  assert.deepEqual(saved(), hashed('h1'), 'a read whose hashes timed out leaves the saved ones');
  combinations.baseline({ 'a@x': hashed('h2') }, { file });
  assert.deepEqual(saved(), hashed('h2'), 'control: a read that has hashes replaces them');
  fs.rmSync(dir, { recursive: true });
});

test('--baseline keeps the saved hash of a set the read left out, and drops a hash of a set the persona no longer holds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tester-replay-'));
  const file = path.join(dir, 'c.json');
  const persona = (sets, hashes) => ({ persona: { profile: 'Read Only', permissionSets: sets, permissionSetHashes: hashes } });
  fs.writeFileSync(file, JSON.stringify({ combinations: [{ id: 'a@x', validity: persona(['A', 'B'], { A: 'a1', B: 'b1' }) }] }));
  const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')).combinations[0].validity;
  assert.deepEqual(combinations.baseline({ 'a@x': persona(['A', 'B'], { A: 'a1' }) }, { file }), ['a@x'], 'and it names the route');
  assert.deepEqual(saved(), persona(['A', 'B'], { A: 'a1', B: 'b1' }), 'B was not hashed this time: its saved hash stays');
  assert.deepEqual(combinations.baseline({ 'a@x': persona(['A', 'B'], { A: 'a2', B: 'b2' }) }, { file }), [], 'control: a whole read keeps none');
  assert.deepEqual(saved(), persona(['A', 'B'], { A: 'a2', B: 'b2' }), 'control: both hashed, both replaced');
  combinations.baseline({ 'a@x': persona(['A', 'C'], { A: 'a3' }) }, { file });
  assert.deepEqual(saved(), persona(['A', 'C'], { A: 'a3' }), 'B left the persona: its hash goes too');
  combinations.baseline({ 'a@x': persona(['A', 'C'], { A: 'a4', '~profile': 'p1' }) }, { file });
  assert.deepEqual(combinations.baseline({ 'a@x': persona(['A', 'C'], { A: 'a5' }) }, { file }), ['a@x']);
  assert.deepEqual(saved(), persona(['A', 'C'], { '~profile': 'p1', A: 'a5' }), 'the profile\'s hash the read did not give stays too');
  fs.rmSync(dir, { recursive: true });
});

test('a route the check finds stale costs no login and no record: it is checked first', async (t) => {
  const { file, rest, tools, log } = fake(t, { placeholders: CHILD });
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.combinations = all.combinations.filter((e) => e.id === 'c@x').map((e) => ({ ...e, validity: { persona: READER } })); // per-route childId
  fs.writeFileSync(file, JSON.stringify(all));
  const stale = { ...rest, check: async () => ({ state: 'stale', stale: ['persona permission set Probe_Read is gone'] }), query: async () => { throw new Error('userFor asked'); } };
  const { results } = await replay.replay({ org: 'x', file, rest: stale, tools });
  assert.deepEqual(results.map((r) => [r.status, r.reason]), [['skip', 'stale (persona permission set Probe_Read is gone): remap it with the tester']]);
  assert.deepEqual(log.filter((l) => l.includes('sf_login_as') || l.includes('SfUiDyn__c')), [], 'no login, no per-route record');
  const valid = { ...rest, check: async () => ({ state: 'valid' }), query: async () => [] };
  assert.equal((await replay.replay({ org: 'x', file, rest: valid, tools })).results[0].status, 'fail', 'control: a valid route goes on to find its persona user (none here)');
});

// replay loads cascade-log, which once loaded replay back and read unxml and esc off its unfinished exports.
test('loading replay first leaves no module half loaded', () => {
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', "require('./src/replay')"], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(r.stderr, '');
});
