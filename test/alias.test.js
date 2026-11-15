'use strict';

// fromAlias against a temporary HOME, in its own file so core's per-process state (logger, crypto version,
// config) never reaches the org tests. No org needed; skipped where the sf CLI is not installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { session } = require('..');

const noSf = (() => { try { session.sfCore(); return false; } catch { return 'the sf CLI is not installed'; } })();

test('fromAlias', { skip: noSf }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-home-'));
  const sfdx = path.join(home, '.sfdx');
  const aliases = (orgs) => fs.writeFileSync(path.join(sfdx, 'alias.json'), JSON.stringify({ orgs }));
  const keys = ['HOME', 'SF_USE_GENERIC_UNIX_KEYCHAIN', 'SF_DISABLE_LOG_FILE'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  fs.mkdirSync(sfdx);
  aliases({});
  // A temp HOME has no macOS keychain, so core would mint a key into it and pop a dialog; keep the key in a file.
  Object.assign(process.env, { HOME: home, SF_USE_GENERIC_UNIX_KEYCHAIN: 'true', SF_DISABLE_LOG_FILE: 'true' });
  t.after(() => {
    for (const k of keys) if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    fs.rmSync(home, { recursive: true, force: true });
  });

  await t.test('an unknown alias is NO_AUTH', async () => {
    await assert.rejects(session.fromAlias('nobody'), (e) => e.code === 'NO_AUTH' && /nobody/.test(e.message));
  });

  // The server lives longer than any one alias: one set after its first fromAlias must still resolve.
  await t.test('an alias set after the first call resolves to its username', async () => {
    aliases({ late: 'late@example.com' });
    await assert.rejects(session.fromAlias('late'), (e) => {
      assert.equal(e.code, 'NO_AUTH');
      assert.match(e.evidence.cause, /late@example\.com/, 'the alias resolved to its username');
      return true;
    });
  });

  await t.test('an auth file core cannot read is AUTH_UNREADABLE, not NO_AUTH', async () => {
    const file = path.join(sfdx, 'locked@example.com.json');
    fs.writeFileSync(file, '{}');
    fs.chmodSync(file, 0o000);
    aliases({ late: 'late@example.com', locked: 'locked@example.com' });
    await assert.rejects(session.fromAlias('locked'), (e) => e.code === 'AUTH_UNREADABLE' && e.evidence.username === 'locked@example.com');
  });

  await t.test('core kept its key in the temp HOME, not the macOS keychain', () => {
    assert.ok(fs.existsSync(path.join(sfdx, 'key.json')));
  });
});

// The CLI's own core is found by walking PATH, with no shell, through the npm bin link to its package.
test('sfCore finds the sf CLI\'s own core on PATH without a shell, and says what to install when there is none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-cli-'));
  const pkg = path.join(root, 'cli');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'bin', 'run.js'), '');
  fs.mkdirSync(path.join(pkg, 'node_modules', '@salesforce', 'core'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'node_modules', '@salesforce', 'core', 'index.js'), "module.exports = { marker: 'cli core' };");
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(path.join(pkg, 'bin', 'run.js'), path.join(bin, 'sf'));
  try {
    assert.equal(session.sfCore({ PATH: [path.join(root, 'empty'), bin].join(path.delimiter) }).marker, 'cli core');
    assert.throws(() => session.sfCore({ PATH: path.join(root, 'empty') }), (e) => e.code === 'NO_SF_CLI' && /@salesforce\/cli/.test(e.message));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The CLI's own core throws at load on Node below 22.10 (webidl.util.markAsUncloneable): a coded error names the Node,
// and blames it only when it is below 22.10; on a Node above, the load error is the cause.
test('sfCore turns a core that throws at load into a coded error naming the running Node', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-cli-'));
  const pkg = path.join(root, 'cli');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'bin', 'run.js'), '');
  fs.mkdirSync(path.join(pkg, 'node_modules', '@salesforce', 'core'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'node_modules', '@salesforce', 'core', 'index.js'), "throw new TypeError('webidl.util.markAsUncloneable is not a function');");
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(path.join(pkg, 'bin', 'run.js'), path.join(bin, 'sf'));
  try {
    assert.throws(() => session.sfCore({ PATH: bin }), (e) => e.code === 'SF_CORE_LOAD_FAILED' && e.message.includes(process.version)
      && !/Node 22\.10 or later/.test(e.message) && /reinstall the sf CLI/.test(e.message) && e.evidence.cause === 'webidl.util.markAsUncloneable is not a function' && e.cause instanceof TypeError);
    const real = Object.getOwnPropertyDescriptor(process.versions, 'node');
    t.after(() => Object.defineProperty(process.versions, 'node', real));
    Object.defineProperty(process.versions, 'node', { ...real, value: '22.9.0' });
    assert.throws(() => session.sfCore({ PATH: bin }), (e) => e.code === 'SF_CORE_LOAD_FAILED' && /Node v22\.9\.0: .*sf-tester needs Node 22\.10 or later/.test(e.message));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// An installed @salesforce/core (the fallback, found through NODE_PATH here) that throws at load is that load
// failure, not NO_SF_CLI's "install it"; run in a child so NODE_PATH is read at its start.
test('sfCore keeps a fallback core that throws at load as SF_CORE_LOAD_FAILED, not NO_SF_CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-core-'));
  fs.mkdirSync(path.join(root, '@salesforce', 'core'), { recursive: true });
  fs.writeFileSync(path.join(root, '@salesforce', 'core', 'index.js'), "throw new Error('broken core');");
  try {
    const run = (env) => require('node:child_process').spawnSync(process.execPath, ['-e', `try { require(${JSON.stringify(path.join(__dirname, '..', 'src', 'session'))}).sfCore({ PATH: '' }); } catch (e) { console.log(e.code); }`], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout.trim();
    assert.equal(run({ NODE_PATH: root }), 'SF_CORE_LOAD_FAILED');
    assert.equal(run({ NODE_PATH: path.join(root, 'none') }), 'NO_SF_CLI', 'control: no core at all');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('SF_TESTER_BROWSER picks the Playwright channel: Chrome by default, its own Chromium, or another installed browser', () => {
  assert.equal(session.browserChannel({}), 'chrome');
  assert.equal(session.browserChannel({ SF_TESTER_BROWSER: 'chromium' }), undefined);
  assert.equal(session.browserChannel({ SF_TESTER_BROWSER: 'msedge' }), 'msedge');
});
