'use strict';

// files.upload into the probe component's own lightning-file-upload: the file must exist, be linked to the
// record, the "Upload Files" dialog must be gone (only Done closes it), and the component must have heard it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { session, lwc, files, api, act, modal, AT } = require('..');
const { auth, env, skip, probe, localPage } = require('./helpers');
const A = require('../src/anchors');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('files', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const query = async (q) => (await api.call(s, `/query?q=${encodeURIComponent(q)}`, { as: 'admin' })).records;
  const id = await probe(s, t);
  const pngFile = (title) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), `${title}.png`);
    fs.writeFileSync(file, PNG);
    return file;
  };

  await t.test('upload goes through the component, links the file to the record and closes the dialog', async () => {
    const title = `sf-ui-files-${Date.now()}`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), `${title}.png`);
    fs.writeFileSync(file, PNG);
    const versions = () => query(`SELECT ContentDocumentId FROM ContentVersion WHERE Title = '${title}'`);
    t.after(async () => { for (const v of await versions()) await api.call(s, `/sobjects/ContentDocument/${v.ContentDocumentId}`, { method: 'DELETE', as: 'admin' }); });
    const host = await lwc.scope(s, id, 'sfUiProbe');
    const before = new Date().toISOString();
    const r = await files.upload(s, host, file);
    const after = new Date().toISOString();
    assert.equal(r.dialog, true);
    assert.ok([before, r[AT].fileSet, r[AT].done, after].every((x, i, a) => /Z$/.test(x) && (!i || a[i - 1] < x)), JSON.stringify({ before, at: r[AT], after }));
    assert.equal(await s.page.getByRole('dialog', { name: 'Upload Files', exact: true }).isVisible(), false);
    await host.getByText(`Uploaded ${title}.png`).waitFor({ timeout: 15_000 });
    const [version] = await versions();
    assert.ok(version, `no ContentVersion titled ${title}`);
    const links = await query(`SELECT LinkedEntityId FROM ContentDocumentLink WHERE ContentDocumentId = '${version.ContentDocumentId}'`);
    assert.ok(links.some((l) => l.LinkedEntityId.slice(0, 15) === id.slice(0, 15)), JSON.stringify(links));
  });

  await t.test('an empty file the dialog refuses is UPLOAD_FAILED with its alert, and the dialog is closed', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ui-')), 'sf-ui-empty.png');
    fs.writeFileSync(file, '');
    const e = await files.upload(s, await lwc.scope(s, id, 'sfUiProbe'), file).then(() => null, (x) => x);
    assert.equal(e?.code, 'UPLOAD_FAILED', String(e));
    assert.deepEqual([e.evidence.count, e.evidence.alerts, e.evidence.closed], ['0 of 1 file uploaded', ['File is empty (0 byte)'], true]);
    assert.equal(await s.page.getByRole('dialog', { name: 'Upload Files', exact: true }).isVisible(), false);
    // A close before Lightning finished opening this second dialog left div.viewport aria-hidden: no role query worked.
    await s.page.waitForTimeout(2_000);
    assert.equal(await s.page.locator('div.viewport[aria-hidden="true"]').count(), 0, 'the page is not left hidden');
    assert.ok(await s.page.getByRole('tab').count() > 0, 'a role query finds the tabs');
  });

  await t.test('upload refuses a scope without exactly one file control', async () => {
    await assert.rejects(files.upload(s, s.page.locator(A.highlights), __filename), (e) => e.code === 'NO_SINGLE_FILE_INPUT' && e.evidence.count === 0);
  });

  await t.test('upload into a plain file box returns without a dialog and the component gets the file', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Open dialog' });
    const m = await modal.find(s);
    try {
      const r = await files.upload(s, m, pngFile('sf-ui-plain'));
      assert.deepEqual([r.dialog, Object.keys(r[AT])], [false, ['fileSet']]);
      await m.getByText('Picked file sf-ui-plain.png').waitFor({ timeout: 15_000 });
    } finally {
      await act.click(m, { name: 'Done with dialog' });
    }
  });

  await t.test('upload into a file input with no label sets it directly', async () => {
    const host = await lwc.scope(s, id, 'sfUiTabbed');
    await files.upload(s, host, pngFile('sf-ui-bare'));
    await host.getByText('Got file sf-ui-bare.png').waitFor({ timeout: 15_000 });
  });
});

// No org: an Upload Files dialog with no Done button times out after the file was set, and says when it was set.
test('an upload that fails at Done still says when the file was set', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<input type="file"><div role="dialog" aria-label="Upload Files">Uploading</div>');
  const before = new Date().toISOString();
  const e = await files.upload({ page }, page.locator('body'), [__filename], { timeout: 1_000 }).then(() => null, (x) => x);
  assert.equal(e?.name, 'TimeoutError', String(e));
  assert.deepEqual(Object.keys(e[AT] || {}), ['fileSet']);
  assert.ok(e[AT].fileSet >= before, JSON.stringify({ before, at: e[AT] }));
});

// No org: a toast from before the upload is dropped and the upload's own is kept, so a wait after it matches only that.
test('an upload records toasts from itself on, not from the click before', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const raise = (title) => `window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'success', title: '${title}' } }))`;
  await page.goto(`data:text/html,${encodeURIComponent(`<input type="file" onchange="${raise('Uploaded')}">`)}`);
  await act.armToasts(page);
  await page.evaluate(raise('Earlier toast'));
  assert.equal((await act.toasts(page)).length, 1, 'the control: the toast was recorded');
  await files.upload({ page }, page.locator('body'), [__filename]);
  assert.deepEqual((await act.toasts(page)).map((x) => x.title), ['Uploaded']);
});

// No org: an uploader that sends its request is waited on past 5 s for its dialog, and Done waits until it turns on.
const uploader = (dialog, delayMs) => `<input type="file" onchange="fetch('/aura?r=1&FileUploadAction.getUploadConfig=1', { method: 'POST' });
  setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(dialog).replace(/"/g, '&quot;')}), ${delayMs})">`;
const page = async (t, html) => {
  const p = await localPage(t);
  await p.route('https://sf.test/**', (r) => r.fulfill(r.request().method() === 'GET' ? { contentType: 'text/html', body: html } : { body: '{}' }));
  await p.goto('https://sf.test/');
  return p;
};
const closes = 'onclick="this.closest(\'[role=dialog]\').remove()"';

test('an upload waits for a late dialog and presses Done only once it turns on', { timeout: 60_000 }, async (t) => {
  const p = await page(t, uploader(`<div role="dialog" aria-label="Upload Files"><span id="n">0 of 1 file uploaded</span>
    <button id="d" disabled ${closes}>Done</button></div>`, 6_000));
  await p.evaluate(() => new MutationObserver(() => { const d = document.getElementById('d'); if (d && d.disabled) setTimeout(() => { document.getElementById('n').textContent = '1 of 1 file uploaded'; d.disabled = false; }, 1_000); }).observe(document.body, { childList: true }));
  const r = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 15_000 });
  assert.equal(r.dialog, true, 'the dialog at 6 s was waited for');
  assert.ok(r[AT].done, JSON.stringify(r[AT]));
  assert.equal(await p.getByRole('dialog').count(), 0);
});

test('the 5 s for the uploader\'s request start when the file is set, not before a slow file chooser', { timeout: 60_000 }, async (t) => {
  const dialog = `<div role="dialog" aria-label="Upload Files"><span>1 of 1 file uploaded</span><button ${closes}>Done</button></div>`;
  // The label's click holds the page 2 s before the chooser opens; the request comes 4 s after the file is set.
  const p = await page(t, `<label for="f" onclick="const end = Date.now() + 2000; while (Date.now() < end);">Upload</label><input id="f" type="file"
    onchange="setTimeout(() => fetch('/aura?r=1&FileUploadAction.getUploadConfig=1', { method: 'POST' }), 4000);
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(dialog).replace(/"/g, '&quot;')}), 6000)">`);
  const r = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 15_000 });
  assert.equal(r.dialog, true, 'the request came 4 s after the file was set');
  assert.equal(await p.getByRole('dialog').count(), 0, 'and Done closed the dialog');
});

test('an upload the dialog refuses throws UPLOAD_FAILED with its alert, and closes the dialog', { timeout: 30_000 }, async (t) => {
  const p = await page(t, uploader(`<div role="dialog" aria-label="Upload Files"><div role="alert">Can't upload x.png.</div>
    <span>0 of 1 file uploaded</span><button ${closes}>Got It</button></div>`, 500));
  const start = Date.now();
  const e = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 10_000 }).then(() => null, (x) => x);
  assert.equal(e?.code, 'UPLOAD_FAILED', String(e));
  assert.ok(Date.now() - start < 3_000, `a page with no div.viewport waits for no hide: ${Date.now() - start} ms`);
  assert.deepEqual([e.evidence.count, e.evidence.alerts, e.evidence.closed, e.evidence.viewport], ['0 of 1 file uploaded', ["Can't upload x.png."], true, 'no viewport']);
  assert.deepEqual(Object.keys(e[AT]), ['fileSet']);
  assert.equal(await p.getByRole('dialog').count(), 0);
});

// No org: like Lightning, the dialog hides div.viewport 500 ms after it shows and its close shows it again.
test('a failed upload closes its dialog only once the page behind it is hidden, so the page is not left hidden', { timeout: 30_000 }, async (t) => {
  const p = await page(t, `<div class="viewport" aria-hidden="false"><button>Behind</button></div>${uploader(`<div role="dialog" aria-label="Upload Files"><div role="alert">File is empty.</div>
    <span>0 of 1 file uploaded</span><button onclick="this.closest('[role=dialog]').remove(); document.querySelector('.viewport').setAttribute('aria-hidden', 'false')">Got It</button></div>`, 200)}`);
  await p.evaluate(() => new MutationObserver((m) => { if (m.some((x) => [...x.addedNodes].some((n) => n.getAttribute?.('role') === 'dialog'))) setTimeout(() => document.querySelector('.viewport').setAttribute('aria-hidden', 'true'), 500); }).observe(document.body, { childList: true }));
  const e = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 10_000 }).then(() => null, (x) => x);
  assert.deepEqual([e?.code, e?.evidence.viewport], ['UPLOAD_FAILED', 'hidden'], String(e));
  await p.waitForTimeout(1_000);
  assert.equal(await p.getByRole('button', { name: 'Behind' }).count(), 1, 'the page behind is not left aria-hidden');
});

test('a failed upload whose page behind is never hidden says so, after the 3 s bound', { timeout: 30_000 }, async (t) => {
  const p = await page(t, `<div class="viewport" aria-hidden="false"></div>${uploader(`<div role="dialog" aria-label="Upload Files"><div role="alert">File is empty.</div>
    <span>0 of 1 file uploaded</span><button ${closes}>Got It</button></div>`, 200)}`);
  const e = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 10_000 }).then(() => null, (x) => x);
  assert.deepEqual([e?.code, e?.evidence.viewport, e?.evidence.closed], ['UPLOAD_FAILED', 'not hidden in 3 s', true], String(e));
});

test('a viewport read that fails for another reason than time is unread in the evidence, and UPLOAD_FAILED keeps its alerts', { timeout: 30_000 }, async (t) => {
  const gone = () => { throw new Error('Target page, context or browser has been closed'); };
  // Only the viewport locators are faked: the count throws, or the count works and the wait throws.
  const faked = (p, viewport) => new Proxy(p, { get: (tg, k) => (k === 'locator' ? (sel, ...r) => (sel.startsWith('div.viewport') ? viewport : tg.locator(sel, ...r)) : typeof tg[k] === 'function' ? tg[k].bind(tg) : tg[k]) });
  for (const [name, viewport] of [['count', { count: async () => gone(), first: () => ({ waitFor: async () => gone() }) }], ['wait', { count: async () => 1, first: () => ({ waitFor: async () => gone() }) }]]) {
    const p = await page(t, `<div class="viewport" aria-hidden="false"></div>${uploader(`<div role="dialog" aria-label="Upload Files"><div role="alert">File is empty.</div>
    <span>0 of 1 file uploaded</span><button ${closes}>Got It</button></div>`, 200)}`);
    const e = await files.upload({ page: faked(p, viewport) }, p.locator('body'), [__filename], { timeout: 10_000 }).then(() => null, (x) => x);
    assert.deepEqual([e?.code, e?.evidence?.alerts, e?.evidence?.viewport], ['UPLOAD_FAILED', ['File is empty.'], 'unread: Target page, context or browser has been closed'], `${name}: ${e}`);
  }
});

test('an upload whose file chooser never opens leaves no request listener behind', { timeout: 30_000 }, async (t) => {
  const p = await page(t, '<label for="f" onclick="event.preventDefault()">Up</label><input id="f" type="file">');
  const before = p.listenerCount('request');
  for (let i = 0; i < 2; i += 1) await assert.rejects(files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 1_000 }), (e) => e.name === 'TimeoutError');
  assert.equal(p.listenerCount('request'), before);
});

test('an upload whose dialog counts fewer files stored than sent throws UPLOAD_FAILED', { timeout: 30_000 }, async (t) => {
  const p = await page(t, uploader(`<div role="dialog" aria-label="Upload Files"><span>1 of 2 files uploaded</span><button ${closes}>Done</button></div>`, 500));
  const e = await files.upload({ page: p }, p.locator('body'), [__filename], { timeout: 10_000 }).then(() => null, (x) => x);
  assert.deepEqual([e?.code, e?.evidence.count, e?.evidence.closed], ['UPLOAD_FAILED', '1 of 2 files uploaded', true], String(e));
});
