'use strict';

// No org: an action that only raises a toast (a headless action); test/action.test.js covers act and discover too.

const test = require('node:test');
const assert = require('node:assert/strict');
const { action } = require('..');
const { localPage } = require('./helpers');

test('launch returns the toasts of an action that opens no dialog, and TIMEOUT for one that does nothing', { timeout: 30_000 }, async (t) => {
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'actions', async () => [{ apiName: 'SfUiProbe__c.Ping', label: 'Ping' }, { apiName: 'SfUiProbe__c.Noop', label: 'Noop' }]);
  const page = await localPage(t);
  const toast = "window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'success', title: 'Pinged' } }))";
  // A goto keeps the toast recorder; setContent drops it.
  await page.goto(`data:text/html,${encodeURIComponent(`<records-highlights2><button onclick="${toast}">Ping</button><button>Noop</button></records-highlights2>`)}`);
  const s = { page, context: page.context() };
  const result = await action.launch(s, '001x', 'SfUiProbe__c.Ping', { timeout: 1_000 });
  assert.deepEqual(result, { toasts: [{ type: 'success', title: 'Pinged', message: undefined }] });
  // Control: no dialog, no page and no toast is still TIMEOUT, also when a toast came before the press.
  await page.evaluate(toast);
  await assert.rejects(action.launch(s, '001x', 'SfUiProbe__c.Noop', { timeout: 1_000 }), (e) => e.code === 'TIMEOUT');
});

test('launch waits a settle for a dialog after a toast, returns toasts at once, and counts no toast from before the click', { timeout: 60_000 }, async (t) => {
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'actions', async () => [{ apiName: 'X.Late', label: 'Late' }, { apiName: 'X.Ping', label: 'Ping' }, { apiName: 'X.Noop', label: 'Noop' }]);
  const page = await localPage(t);
  const toast = "window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'info', title: 'Working' } }))";
  const dialog = "setTimeout(() => { const d = document.createElement('section'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Late'); d.innerHTML = '<button>Go</button>'; document.body.appendChild(d); }, 1000)";
  const html = `<records-highlights2><button onclick="${toast}; ${dialog}">Late</button><button onclick="${toast}">Ping</button></records-highlights2>`;
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
  const s = { page, context: page.context() };
  // F2: a toast at the press and the dialog 1 s later is the dialog, not "no dialog".
  const late = await action.launch(s, '001x', 'X.Late', { timeout: 500 });
  assert.equal(late.toasts, undefined);
  assert.equal(await late.getAttribute('aria-label'), 'Late');
  await page.evaluate(() => document.querySelectorAll('[role=dialog]').forEach((d) => d.remove()));
  // F13: a toast-only action returns after the settle, not after the whole dialog timeout.
  const t0 = Date.now();
  assert.deepEqual(await action.launch(s, '001x', 'X.Ping'), { toasts: [{ type: 'info', title: 'Working', message: undefined }] });
  assert.ok(Date.now() - t0 < 6_000, `took ${Date.now() - t0} ms`);
  // A toast the page raised while its action panel loaded is not the action's: Noop shows 500 ms after a page toast.
  const slow = `<records-highlights2></records-highlights2><script>setTimeout(() => { ${toast}; }, 100); setTimeout(() => { document.querySelector('records-highlights2').innerHTML = '<button>Noop</button>'; }, 600);</script>`;
  await page.goto(`data:text/html,${encodeURIComponent(slow)}`);
  await assert.rejects(action.launch(s, '001x', 'X.Noop', { timeout: 1_000 }), (e) => e.code === 'TIMEOUT');
});

test('launch on a page that closes after the press throws the close at once, not TIMEOUT', { timeout: 30_000 }, async (t) => {
  t.mock.method(require('../src/nav'), 'openRecord', async () => {});
  t.mock.method(require('../src/discover'), 'actions', async () => [{ apiName: 'X.Boom', label: 'Boom' }]);
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<records-highlights2><button>Boom</button></records-highlights2>')}`);
  setTimeout(() => page.close().catch(() => {}), 1_000);
  const t0 = Date.now();
  const e = await action.launch({ page, context: page.context() }, '001x', 'X.Boom', { timeout: 8_000 }).then(() => null, (x) => x);
  assert.notEqual(e?.code, 'TIMEOUT', String(e));
  assert.match(String(e?.message), /closed/);
  assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`);
});
