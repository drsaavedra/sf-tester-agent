'use strict';

// apex.record logs the Apex call a component button makes, and the component shows what it returned; a call it cannot
// parse is logged as UNPARSED.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, lwc, apex } = require('..');
const { auth, env, skip, probe, localPage } = require('./helpers');

test('apex', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await probe(s, t);

  await t.test('apex.record logs the Apex call a component button makes', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    const rec = apex.record(s);
    try {
      await host.getByRole('button', { name: 'Ping', exact: true }).click();
      await host.getByText(`pong ${id}`).waitFor({ timeout: 15_000 });
      for (let i = 0; i < 50 && !rec.calls.length; i++) await s.page.waitForTimeout(100); // the log reads the response after the page does
    } finally {
      rec.stop();
    }
    const call = rec.calls.find((c) => /SfUiProbeController/.test(c.classname));
    assert.equal(call?.state, 'SUCCESS', JSON.stringify(rec.calls));
    assert.equal(call.method, 'ping');
    assert.ok(call.ms > 0, `ms ${call.ms}`);
  });
});

// No org: an Apex call whose request or response does not parse is logged as UNPARSED, with the parse error.
test('apex.record logs a call it cannot parse as UNPARSED', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.route('https://sf.test/**', (r) => r.fulfill(r.request().method() === 'GET'
    ? { contentType: 'text/html', body: '<p>page</p>' }
    : { contentType: 'application/json', body: 'while(1);\n{"actions": [' }));
  await page.goto('https://sf.test/');
  const rec = apex.record({ page });
  t.after(() => rec.stop());
  const post = (url, message) => page.evaluate(([u, m]) => fetch(u, { method: 'POST', body: new URLSearchParams({ message: m }) }).then((r) => r.text()), [url, message]);
  await post('https://sf.test/aura?r=1&other.Action=1', '{}'); // control: not an Apex call, not logged
  await post('https://sf.test/aura?r=2&aura.ApexAction.execute=1', JSON.stringify({ actions: [{ id: '1', params: { classname: 'C', method: 'm' } }] }));
  for (let i = 0; i < 50 && !rec.calls.length; i++) await page.waitForTimeout(100);
  assert.equal(rec.calls.length, 1, JSON.stringify(rec.calls));
  assert.equal(rec.calls[0].state, 'UNPARSED');
  assert.match(rec.calls[0].error, /JSON/);
});
