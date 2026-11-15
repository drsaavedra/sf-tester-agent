'use strict';

// Watch the page over time: every everyMs, the first rendered match of a CSS selector under the scope (through
// shadow roots) is read, and a sample is kept each time what it shows changes; named events are kept as they fire,
// on window (capture: composed events only, under shadow DOM) and on every match of `on` (default the selector),
// with their detail. Times are ISO on this machine's clock, as `at` is. ponytail: it lives in the page, so a page
// load ends it (read says so); one watch per page; a match is listened to from the first tick that finds it.
const { SfUiError } = require('./errors');

const KEY = '__sfUiWatch';
// Each page's watch window: the frame its scope sat in, so read and stop reach a watch started in an iframe.
// ponytail: a later start in another frame leaves the earlier watch running unread until that frame loads.
const frames = new WeakMap();

// Runs in the page.
function install(root, { key, selector, on, everyMs, attrs, styles, events, max }) {
  for (const sel of [selector, on]) {
    try { if (sel) document.createDocumentFragment().querySelector(sel); } catch { return { bad: sel }; } // before the old watch stops
  }
  const now = () => new Date(Date.now()).toISOString();
  const prev = window[key];
  if (prev) prev.stop();
  const w = { samples: [], events: [], ticks: 0, maxGapMs: 0, everyMs, startedAt: now(), dropped: 0 };
  const seen = new WeakSet(); // an event heard on window and on its target is kept once
  const heard = new Set(); // elements listened to, so stop can remove those listeners too
  const hear = (e) => {
    if (seen.has(e)) return;
    seen.add(e);
    let detail;
    // A key whose value JSON drops (a function, undefined) is kept by name, so the detail shows every key it had.
    const keep = (k, v) => (typeof v === 'function' ? '[function]' : v === undefined && k ? '[undefined]' : v);
    try { detail = JSON.stringify(e.detail ?? null, keep).slice(0, 2000); } catch {
      try { detail = JSON.stringify({ unreadable: true, keys: Object.keys(e.detail) }); } catch { detail = String(e.detail).slice(0, 2000); }
    }
    const host = e.composedPath()[0] || e.target;
    if (w.events.length < max) w.events.push({ type: e.type, t: now(), target: host && host.localName, detail });
    else w.dropped += 1;
  };
  for (const type of events) window.addEventListener(type, hear, true);
  const matches = (sel) => {
    const out = root.matches && root.matches(sel) ? [root] : []; // the scope's own host can be the match
    const walk = (n) => {
      for (const c of n.children || []) {
        if (c.matches(sel)) out.push(c);
        if (c.shadowRoot) walk(c.shadowRoot);
        walk(c);
      }
    };
    if (root.shadowRoot) walk(root.shadowRoot);
    walk(root);
    return out;
  };
  let last = null;
  let lastTick = performance.now();
  const tick = () => {
    const t = performance.now();
    if (w.ticks) w.maxGapMs = Math.max(w.maxGapMs, Math.round(t - lastTick));
    lastTick = t;
    w.ticks += 1;
    const all = selector ? matches(selector) : [];
    const listen = !events.length ? [] : on ? matches(on) : all;
    for (const el of listen) if (!heard.has(el)) { heard.add(el); for (const type of events) el.addEventListener(type, hear); }
    if (!selector) return;
    const el = all.find((n) => n.getBoundingClientRect().width > 0) || all[0];
    let state = { present: false, count: all.length };
    if (el) {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      state = {
        present: true, count: all.length, rendered: r.width > 0 && r.height > 0,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
        ...(attrs.length && { attrs: Object.fromEntries(attrs.map((a) => [a, el.getAttribute(a)])) }),
        ...(styles.length && { styles: Object.fromEntries(styles.map((p) => [p, c.getPropertyValue(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))])) }),
      };
    }
    const json = JSON.stringify(state);
    if (json === last) return;
    last = json;
    if (w.samples.length < max) w.samples.push({ t: now(), ...state });
    else w.dropped += 1;
  };
  tick();
  const timer = setInterval(tick, everyMs);
  w.tick = tick; // read samples once more, so a change since the last tick is not missed
  w.stop = () => {
    clearInterval(timer);
    for (const type of events) window.removeEventListener(type, hear, true);
    for (const el of heard) for (const type of events) el.removeEventListener(type, hear);
    heard.clear();
    w.stoppedAt = w.stoppedAt || now();
  };
  window[key] = w;
  return { count: selector ? matches(selector).length : null, onCount: on ? matches(on).length : null };
}

async function start(scope, { selector, on, everyMs = 250, attrs = [], styles = [], events = [] } = {}) {
  if (!selector && !events.length) throw new SfUiError('BAD_ARGS', 'give a selector to sample, events to record, or both');
  const root = scope.ariaSnapshot ? scope : scope.locator('body'); // a component host, a modal, or the page
  const { bad, count, onCount } = await root.evaluate(install, { key: KEY, selector, on, everyMs, attrs, styles, events, max: 1000 });
  if (bad) throw new SfUiError('BAD_ARGS', `not a CSS selector: ${bad}`, { selector: bad });
  const handle = await root.elementHandle();
  frames.set(root.page(), await handle.ownerFrame());
  await handle.dispose();
  // The page matches one element at a time, so `c-x .bar` with .bar in c-x's shadow root never matches there, where
  // Playwright (and sf_measure) would find it: refuse it rather than report absent for the whole run.
  for (const [sel, n] of [[selector, count], [on, onCount]]) {
    if (sel && n === 0 && (await root.locator(sel).count()) > 0) {
      await read(root.page(), { stop: true });
      throw new SfUiError('BAD_ARGS', `${sel} crosses a shadow root, which sf_watch cannot follow; name the inner element alone (e.g. its tag or class)`, { selector: sel });
    }
  }
}

async function read(page, { stop = false } = {}) {
  const frame = frames.get(page);
  const out = await (frame && !frame.isDetached() ? frame : page).evaluate(([key, stop]) => {
    const w = window[key];
    if (!w) return null;
    if (!w.stoppedAt) w.tick();
    if (stop) { w.stop(); delete window[key]; }
    const { stop: _, tick: __, ...data } = w;
    return JSON.parse(JSON.stringify(data));
  }, [KEY, stop]);
  if (!out) throw new SfUiError('NOT_WATCHING', 'no watch on this page: sf_watch start first, or the page loaded since it started (a load ends a watch)');
  return out;
}

module.exports = { start, read };
