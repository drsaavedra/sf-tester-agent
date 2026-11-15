'use strict';

// deploy.verifyLive finds text the deployed component renders, and throws STALE_BUILD for text it never renders.

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('..');
const { auth, env, skip, probe, localPage } = require('./helpers');

// No org: a marker is a whole word, case included, and an error that is not the wait running out stays itself.
test('deploy, no org: verifyLive matches the marker as a whole word and lets a closed page fail as itself', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  t.mock.method(lib.nav, 'openRecord', async () => {});
  const host = { locator: page.locator('c-probe') };
  t.mock.method(lib.lwc, 'scope', async () => host.locator);
  const s = { page, context: page.context() };
  const live = async (text, marker = 'V21') => {
    await page.setContent(`<c-probe><p>${text}</p></c-probe>`);
    return lib.deploy.verifyLive(s, '001x', 'probe', marker, { timeout: 300 }).catch((e) => e.code);
  };
  assert.equal(await live('V21'), true, 'the whole text');
  assert.equal(await live('Build V21, deployed 12 Nov'), true, 'a word in a longer line');
  assert.equal(await live('Build V210'), 'STALE_BUILD', 'a longer word');
  assert.equal(await live('Build XV21'), 'STALE_BUILD', 'a word that ends with it');
  assert.equal(await live('Build v21'), 'STALE_BUILD', 'another case');
  assert.equal(await live('Build ÜV21'), 'STALE_BUILD', 'a non-ASCII letter is a word character');
  assert.equal(await live('Build\n    V21, deployed', 'Build V21'), true, 'a space matches a source line wrap');
  assert.equal(await live('Build#21', '#21'), true, 'no boundary on a side the marker ends in a non-word character');
  assert.equal(await live('v1.0-beta', '-beta'), true);
  assert.equal(await live('Build(v2)', '(v2)'), true);
  assert.equal(await live('Build#210', '#21'), 'STALE_BUILD', 'a boundary still where it ends in a digit');
  assert.equal(await live('Build X𝐕21', '𝐕21'), 'STALE_BUILD', 'an astral first letter keeps its start edge');
  assert.equal(await live('Build 𝐕21', '𝐕21'), true);
  for (const m of ['', ' ', ' \n ']) assert.equal(await live('Build V21', m), 'BAD_ARGS', JSON.stringify(m));
  const looked = lib.lwc.scope.mock.callCount();
  await assert.rejects(lib.deploy.verifyLive(s, '001x', 'probe', ' '), { code: 'BAD_ARGS' });
  assert.equal(lib.lwc.scope.mock.callCount(), looked, 'a blank marker is refused before the component lookup');
  const closed = new Error('Target page, context or browser has been closed');
  host.locator = { getByText: () => ({ first: () => ({ waitFor: async () => { throw closed; } }) }) };
  await assert.rejects(lib.deploy.verifyLive(s, '001x', 'probe', 'V21', { timeout: 500 }), (e) => e === closed);
});

test('deploy', { skip, timeout: 300_000 }, async (t) => {
  const s = await lib.session.start(await auth(env.org));
  t.after(() => lib.session.end(s));
  const id = await probe(s, t);

  await t.test('deploy.verifyLive finds a marker the deployed component renders', async () => {
    assert.equal(await lib.deploy.verifyLive(s, id, 'sfUiProbe', 'sf-ui probe build 1'), true);
  });

  await t.test('deploy.verifyLive throws STALE_BUILD when the marker never renders', async () => {
    await assert.rejects(lib.deploy.verifyLive(s, id, 'sfUiProbe', 'marker-from-a-build-not-deployed'), { code: 'STALE_BUILD' });
  });
});
