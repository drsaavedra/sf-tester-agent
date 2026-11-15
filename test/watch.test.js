'use strict';

// watch on a local page: a progress bar inside nested shadow roots that appears, counts up and goes, a result event
// that does not bubble from a host inside another shadow root (only a listener on the host hears it), and the same
// event from a top-level host, which window and the host both hear and must be kept once.

const test = require('node:test');
const assert = require('node:assert/strict');
const { watch, session, lwc, act } = require('..');
const { localPage, auth, env, skip, probe } = require('./helpers');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('watch, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<x-outer></x-outer><x-card class="top"></x-card>');
  await page.evaluate(() => {
    const outer = document.querySelector('x-outer').attachShadow({ mode: 'open' });
    outer.innerHTML = '<x-card class="inner"></x-card>';
    for (const card of [outer.querySelector('x-card'), document.querySelector('x-card.top')]) card.attachShadow({ mode: 'open' });
  });
  const body = page.locator('body');

  await t.test('samples keep each change of a bar inside shadow roots, from absent to gone', async () => {
    await watch.start(body, { selector: '.bar', attrs: ['aria-valuenow'], everyMs: 50 });
    await page.evaluate(async () => {
      const root = document.querySelector('x-outer').shadowRoot.querySelector('x-card').shadowRoot;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(200);
      root.innerHTML = '<div class="bar" aria-valuenow="0" style="width:10px;height:4px"></div>';
      for (const v of ['50', '100']) { await wait(200); root.querySelector('.bar').setAttribute('aria-valuenow', v); }
      await wait(200);
      root.innerHTML = '';
      await wait(200);
    });
    await page.evaluate(() => { document.querySelector('x-outer').shadowRoot.querySelector('x-card').shadowRoot.innerHTML = '<div class="bar" aria-valuenow="7"></div>'; });
    const w = await watch.read(page); // straight after a change, before any tick could see it
    const seen = w.samples.map((x) => (x.present ? x.attrs['aria-valuenow'] : 'absent'));
    assert.deepEqual(seen, ['absent', '0', '50', '100', 'absent', '7']);
    assert.ok(w.samples.every((x, i) => !i || x.t >= w.samples[i - 1].t), 'times run forward');
    assert.ok(w.ticks > 10 && w.maxGapMs < 500, JSON.stringify([w.ticks, w.maxGapMs]));
    assert.equal(w.events.length, 0, 'no events were asked for');
  });

  await t.test('a non-bubbling event in a shadow root is heard on its host, and one heard twice is kept once', async () => {
    await watch.start(body, { selector: 'x-card', events: ['ocrresult'], everyMs: 50 });
    await pause(150); // a tick finds both hosts and listens on them
    await page.evaluate(() => {
      const fire = (el, ok) => el.dispatchEvent(new CustomEvent('ocrresult', { detail: { ok } }));
      fire(document.querySelector('x-outer').shadowRoot.querySelector('x-card'), 'inner');
      fire(document.querySelector('x-card.top'), 'top');
      document.querySelector('x-card.top').dispatchEvent(new CustomEvent('ocrresult', { detail: { run: () => 1, gone: undefined, n: 2 } }));
    });
    await page.evaluate(() => {
      const top = document.querySelector('x-card.top');
      const remove = top.removeEventListener.bind(top);
      window.removedOnTop = 0;
      top.removeEventListener = (type, fn, o) => { if (type === 'ocrresult') window.removedOnTop += 1; return remove(type, fn, o); };
    });
    const w = await watch.read(page, { stop: true });
    assert.equal(await page.evaluate(() => window.removedOnTop), 1, 'stop removes the listener it put on a match');
    assert.deepEqual(w.events.map((e) => [e.type, e.target, e.detail]), [['ocrresult', 'x-card', '{"ok":"inner"}'], ['ocrresult', 'x-card', '{"ok":"top"}'],
      ['ocrresult', 'x-card', '{"run":"[function]","gone":"[undefined]","n":2}']]);
  });

  // The ticket's case: sample one thing, hear a non-composed event from another component inside a shadow root.
  // The control is the same start without on, which only window hears, and window hears only composed events.
  await t.test('on listens to another host, and window hears only a composed event', async () => {
    const fire = () => page.evaluate(() => {
      const inner = document.querySelector('x-outer').shadowRoot.querySelector('x-card');
      inner.dispatchEvent(new CustomEvent('ocrresult', { detail: { by: 'inner' } }));
      inner.shadowRoot.append(Object.assign(document.createElement('span'), { className: 'spark' }));
      inner.shadowRoot.querySelector('.spark').dispatchEvent(new CustomEvent('ocrresult', { detail: { by: 'composed' }, bubbles: true, composed: true }));
    });
    await watch.start(body, { selector: '.bar', events: ['ocrresult'], everyMs: 50 });
    await pause(150);
    await fire();
    assert.deepEqual((await watch.read(page, { stop: true })).events.map((e) => JSON.parse(e.detail).by), ['composed']);
    await watch.start(body, { selector: '.bar', on: 'x-card.inner', events: ['ocrresult'], everyMs: 50 });
    await pause(150);
    await fire();
    assert.deepEqual((await watch.read(page, { stop: true })).events.map((e) => JSON.parse(e.detail).by).sort(), ['composed', 'inner']);
  });

  // The inner host sits in a shadow root, so window cannot hear its non-composed event: only the host's own listener.
  await t.test('the scope host matches itself, and an unreadable detail keeps its keys', async () => {
    await watch.start(page.locator('x-card.inner'), { selector: 'x-card', events: ['ocrresult'], everyMs: 50 });
    await page.evaluate(() => {
      const d = { a: 1 }; d.self = d;
      document.querySelector('x-outer').shadowRoot.querySelector('x-card').dispatchEvent(new CustomEvent('ocrresult', { detail: d }));
    });
    const w = await watch.read(page, { stop: true });
    assert.equal(w.samples[0].present, true);
    assert.deepEqual(JSON.parse(w.events[0].detail), { unreadable: true, keys: ['a', 'self'] });
  });

  await t.test('a bad selector is BAD_ARGS and leaves the running watch alone', async () => {
    await watch.start(body, { selector: 'x-card', everyMs: 50 });
    await assert.rejects(watch.start(body, { selector: 'x-card[', everyMs: 50 }), { code: 'BAD_ARGS' });
    await assert.rejects(watch.start(body, { selector: 'x-card', on: '::nope(', events: ['x'] }), { code: 'BAD_ARGS' });
    const w = await watch.read(page);
    assert.equal(w.stoppedAt, undefined, 'the running watch was not stopped');
    await watch.read(page, { stop: true });
  });

  // The control is the same element named alone, which the page can match.
  await t.test('a selector across a shadow boundary is BAD_ARGS, and the element named alone is watched', async () => {
    await assert.rejects(watch.start(body, { selector: 'x-outer x-card', everyMs: 50 }), (e) => e.code === 'BAD_ARGS' && /crosses a shadow root/.test(e.message));
    await assert.rejects(watch.read(page), { code: 'NOT_WATCHING' }, 'the refused watch was stopped');
    await assert.rejects(watch.start(body, { selector: 'x-card', on: 'x-outer x-card', events: ['x'], everyMs: 50 }), { code: 'BAD_ARGS' });
    await watch.start(body, { selector: 'x-card.inner', everyMs: 50 });
    assert.equal((await watch.read(page, { stop: true })).samples[0].present, true);
  });

  await t.test('stop ends the watch, a page load ends it too, and nothing to watch is refused', async () => {
    await assert.rejects(watch.read(page), { code: 'NOT_WATCHING' });
    await watch.start(body, { selector: 'x-card', everyMs: 50 });
    await page.reload();
    await assert.rejects(watch.read(page), { code: 'NOT_WATCHING' });
    await assert.rejects(watch.start(body, {}), { code: 'BAD_ARGS' });
  });
});

// No org: a watch started inside an iframe is read and stopped there, through the page as any watch is.
test('watch in an iframe, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<iframe srcdoc="<div class=bar>1</div>"></iframe>');
  const body = page.locator('iframe').contentFrame().locator('body');
  await body.locator('.bar').waitFor();
  await watch.start(body, { selector: '.bar', everyMs: 50 });
  await page.frameLocator('iframe').locator('.bar').evaluate((el) => { el.textContent = '2'; });
  assert.deepEqual((await watch.read(page)).samples.map((x) => x.text), ['1', '2']);
  assert.equal((await watch.read(page, { stop: true })).samples.length, 2);
  await assert.rejects(watch.read(page), { code: 'NOT_WATCHING' });
});

// On the fixture org: a Ping writes a line into the probe and raises a toast event, which the watch must both see.
test('watch on the org', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await probe(s, t);
  const host = await lwc.scope(s, id, 'sfUiProbe');
  await watch.start(host, { selector: 'p:last-of-type', events: ['lightning__showtoast'], everyMs: 100 });
  await act.click(host, { name: 'Ping' });
  await act.waitFor(host, { text: `pong ${id}` });
  const w = await watch.read(s.page, { stop: true });
  assert.ok(w.samples.some((x) => x.text === `pong ${id}`), JSON.stringify(w.samples));
  assert.ok(!w.samples[0].text || w.samples[0].text !== `pong ${id}`, 'the first sample is from before the ping');
  // Lightning's toast event carries { toast, label }; toast is not JSON, so it is kept by name. sf_toasts reads the text.
  const toast = w.events.find((e) => e.type === 'lightning__showtoast');
  assert.ok(toast && toast.target === 'c-sf-ui-probe', JSON.stringify(w.events));
  assert.deepEqual(Object.keys(JSON.parse(toast.detail)).sort(), ['label', 'toast'], toast.detail);
});
