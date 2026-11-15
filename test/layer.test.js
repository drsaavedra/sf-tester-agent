'use strict';

// layer.onTop on the fixture's probe component: a z-index 9999 button and a plain one under the component's own
// SLDS dialog and under a LightningModal, a button half cut off by an overflow-hidden parent, and an info icon with
// no role in a nested child, which a reader sees only as the text "Info".

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, lwc, act, modal, layer } = require('..');
const { expectReading } = require('../src/checks');
const { auth, env, skip, probe, localPage } = require('./helpers');

test('layer', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await probe(s, t);
  const host = () => lwc.scope(s, id, 'sfUiProbe');
  const check = async (name) => layer.onTop(await host(), { name });

  await t.test('with no modal open both layers are on top, every point hitting the button itself', async () => {
    for (const name of ['High layer', 'Low layer']) {
      const r = await check(name);
      assert.equal(r.modalOpen, false);
      assert.equal(r.points.length, 5);
      assert.equal(r.onTop, true, name);
    }
  });

  await t.test('the component\'s own dialog covers the plain button, and the z-index 9999 one draws over it', async () => {
    await act.click(await host(), { name: 'Open inline dialog' });
    try {
      const high = await check('High layer');
      assert.equal(high.modalOpen, true);
      assert.equal(high.onTop, true, 'the z-index 9999 button draws over the open dialog');
      const low = await check('Low layer');
      assert.equal(low.onTop, false);
      for (const p of low.points) {
        assert.equal(p.onTarget, false);
        assert.ok(['div', 'section'].includes(p.top.tag) && p.top.hosts[0] === 'c-sf-ui-probe', JSON.stringify(p.top)); // the dialog, not a host
      }
    } finally {
      await act.click(s.page.getByRole('dialog', { name: 'Inline dialog' }), { name: 'Close inline dialog' });
    }
  });

  // The page behind a LightningModal is aria-hidden, and its stacking context is below the modal at any z-index.
  // The icon's "Info" is 1px assistive text; measuring that span would miss the 16px icon a user sees.
  await t.test('an icon with no role is found by its text, measured as the icon, and covered by the dialog', async () => {
    const help = await lwc.scope(s, id, 'sfUiProbeHelp');
    await assert.rejects(layer.onTop(help, { name: 'Info', role: 'img', timeout: 2_000 }), { code: 'NOT_FOUND' });
    const open = await layer.onTop(help, { text: 'Info' });
    const icon = await help.locator('lightning-icon').boundingBox(); // the helptext's button is 16px too, beside it
    assert.deepEqual([open.onTop, open.box.x, open.box.width, open.box.height], [true, Math.round(icon.x), 16, 16]);
    await act.click(await host(), { name: 'Open inline dialog' });
    try {
      const covered = await layer.onTop(help, { text: 'Info' });
      assert.equal(covered.onTop, false);
      assert.ok(covered.points.every((p) => p.top && p.top.label === 'Inline dialog'), JSON.stringify(covered.points));
    } finally {
      await act.click(s.page.getByRole('dialog', { name: 'Inline dialog' }), { name: 'Close inline dialog' });
    }
  });

  await t.test('a LightningModal covers even the z-index 9999 button, which its page context traps', async () => {
    await act.click(await host(), { name: 'Open dialog' });
    const m = await modal.find(s);
    try {
      const high = await check('High layer');
      assert.equal(high.modalOpen, true);
      assert.equal(high.onTop, false);
      assert.ok(high.points.every((p) => p.top && p.top.hosts.some((h) => h.startsWith('lightning-modal'))), JSON.stringify(high.points));
    } finally {
      await act.click(m, { name: 'Done with dialog' });
      await m.waitFor({ state: 'hidden' });
    }
  });

  await t.test('a button twice as wide as its overflow-hidden parent shows half, and names the parent', async () => {
    const r = await check('Half clipped');
    assert.equal(r.visible, 0.5);
    assert.deepEqual([r.clippedBy.tag, r.clippedBy.hosts[0]], ['div', 'c-sf-ui-probe']);
    const at = Object.fromEntries(r.points.map((p) => [p.at, p.onTarget]));
    assert.deepEqual([at.topLeft, at.topRight], [true, false], 'the cut-off side hits what is behind it');
  });

  await t.test('an unclipped button shows whole', async () => {
    const r = await check('Not clipped');
    assert.deepEqual([r.visible, r.clippedBy], [1, null]);
  });

  // An empty name is the unnamed icon button under that column, not "measure the whole component".
  await t.test('an unnamed icon button is measured by row and column', async () => {
    const r = await layer.onTop(await host(), { name: '', row: 'row two', column: 'Inline' });
    assert.deepEqual([r.onTop, r.box.width, r.box.height], [true, 32, 32], JSON.stringify(r.box));
  });

  // The same clip read by measure agrees with onTop, and a selector inside a synthetic-shadow component counts
  // what getByRole counts there.
  await t.test('measure reads the half-clipped button and sweeps the component\'s buttons', async () => {
    const r = await layer.measure(await host(), { name: 'Half clipped' });
    assert.deepEqual([r.elements[0].visible, r.elements[0].clippedBy.hosts[0], r.viewport.width], [0.5, 'c-sf-ui-probe', session.VIEWPORT.width]);
    const all = await layer.measure(await host(), { selector: 'button' });
    const tagged = await (await host()).getByRole('button', { includeHidden: true }).evaluateAll((els) => els.filter((e) => e.localName === 'button').length);
    assert.equal(all.count, tagged); // role=button also holds non-<button> elements
    assert.ok(all.count > 3 && all.rendered === all.count, JSON.stringify([all.count, all.rendered]));
    const self = await layer.measure(await host());
    assert.ok(self.count === 1 && self.elements[0].tag === 'c-sf-ui-probe', JSON.stringify(self.elements[0]));
  });

  // The control is the same component before the resize; the probe's flexible width must follow the window.
  await t.test('a resize reflows the page, and measure reads the new viewport', async () => {
    const before = (await layer.measure(await host())).elements[0].rect.width;
    try {
      assert.deepEqual(await session.resize(s, { width: 900 }), { width: 900, height: session.VIEWPORT.height });
      const after = await layer.measure(await host());
      assert.equal(after.viewport.width, 900);
      assert.ok(after.elements[0].rect.width < before, JSON.stringify([before, after.elements[0].rect.width]));
    } finally {
      await session.resize(s, session.VIEWPORT);
    }
  });

  // A Lightning tooltip opens on hover; the control is the same text not showing before it.
  await t.test('hovering the helptext opens its tooltip', async () => {
    const help = await lwc.scope(s, id, 'sfUiProbeHelp');
    const tip = s.page.getByText('Help from a nested component').locator('visible=true');
    assert.equal(await tip.count(), 0);
    try {
      await act.hover(help, { name: 'Help' });
      const seen = await act.waitFor(s.page, { text: 'Help from a nested component', timeout: 5_000 }); // the tester's own read
      assert.ok(seen);
      // sf_hover's description sends the tester to sf_wait because the bubble mounts outside main; pin that.
      assert.equal(await s.page.getByRole('main').getByText('Help from a nested component').locator('visible=true').count(), 0);
    } finally {
      await act.hover(await host(), { name: 'Low layer' }); // move off, so later tests see no tooltip
    }
  });

  await t.test('the whole page is no target', async () => {
    await assert.rejects(layer.onTop(s.page), { code: 'BAD_ARGS' });
  });
});

// Lightning may render base components in native shadow, where the assistive text's parent is a shadow root.
test('layer icon text in native shadow, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<x-icon></x-icon>');
  await page.evaluate(() => {
    document.querySelector('x-icon').attachShadow({ mode: 'open' }).innerHTML = '<svg width="16" height="16"><rect width="16" height="16"/></svg>'
      + '<span style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0)">Info</span>';
  });
  const r = await layer.onTop(page.locator('body'), { text: 'Info' });
  assert.deepEqual([r.onTop, r.box.width > 1], [true, true], JSON.stringify(r));
});

// layer.measure on a local page: a CSS grid, an icon pair inside a shadow root (one display:none, the copy a
// querySelectorAll would count as on screen), a box twice as wide as its overflow-hidden parent, and a button.
test('layer measure, no org', async (t) => {
  const page = await localPage(t);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.setContent(`<div class="grid" style="display:grid;grid-template-columns:200px 100px;width:300px"><i>a</i><i>b</i></div>
    <x-card></x-card>
    <div class="clip" style="overflow:hidden;width:100px"><div class="wide" style="width:250px;height:10px"></div></div>
    <button style="width:80px">Go</button>`);
  await page.evaluate(() => {
    document.querySelector('x-card').attachShadow({ mode: 'open' }).innerHTML = '<span class="icon" style="display:inline-block;width:16px;height:16px"></span>'
      + '<span class="icon" style="display:none;width:16px;height:16px"></span>';
  });
  const body = page.locator('body');

  await t.test('a selector crosses the shadow root and counts every match, rendered or not', async () => {
    const r = await layer.measure(body, { selector: '.icon' });
    assert.deepEqual([r.count, r.rendered, r.inView, r.elements.length], [2, 1, 1, 2]);
    assert.deepEqual(r.elements[0].hosts, ['x-card']);
    assert.deepEqual(r.viewport, { width: 1000, height: 600 });
  });

  await t.test('named computed styles come back, kebab or camel case', async () => {
    const r = await layer.measure(body, { selector: '.grid', styles: ['grid-template-columns', 'gridTemplateColumns', 'display'] });
    assert.deepEqual(r.elements[0].styles, { 'grid-template-columns': '200px 100px', gridTemplateColumns: '200px 100px', display: 'grid' });
    assert.equal(r.elements[0].rect.width, 300);
  });

  await t.test('overflow on the clipping parent, visible share and clippedBy on the wide child', async () => {
    const parent = (await layer.measure(body, { selector: '.clip' })).elements[0];
    assert.deepEqual(parent.overflow, { x: 150, y: 0 });
    const child = (await layer.measure(body, { selector: '.wide' })).elements[0];
    assert.deepEqual([child.rect.width, child.rect.right - child.rect.x, child.visible, child.clippedBy.tag], [250, 250, 0.4, 'div']);
  });

  await t.test('one element by role and name, and a miss is a count of 0, not an error', async () => {
    const r = await layer.measure(body, { name: 'Go' });
    assert.deepEqual([r.count, r.elements[0].tag, r.elements[0].rect.width], [1, 'button', 80]);
    assert.equal((await layer.measure(body, { selector: '.none', timeout: 100 })).count, 0);
  });

  await t.test('expect holds a measured px within its tolerance, and a count exactly', async () => {
    const r = await layer.measure(body, { selector: '.wide' }); // 250 px wide
    assert.equal(expectReading(r, { path: 'elements.0.rect.width', value: 252, tolerance: 2 }), r);
    assert.throws(() => expectReading(r, { path: 'elements.0.rect.width', value: 253, tolerance: 2 }), { code: 'MEASURE_MISMATCH' });
    assert.throws(() => expectReading(r, { path: 'count', value: 2, tolerance: 1 }), { code: 'MEASURE_MISMATCH' });
  });

  await t.test('a name and a selector together are refused', async () => {
    await assert.rejects(layer.measure(body, { name: 'Go', selector: 'button' }), { code: 'BAD_ARGS' });
    await assert.rejects(layer.measure(page), { code: 'BAD_ARGS' });
  });
});

// textBox on a local page: a label whose block is wider than its text, the same label with its last word in a span
// (the control: the span's own box), the label wrapped onto two lines, and the text inside a shadow root.
test('layer measure textBox, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent(`<style>div{font:14px Arial;width:400px}</style>
    <div class="a" style="white-space:pre-wrap">  Customer number  </div><div class="b" style="white-space:pre-wrap">  <i style="font-style:normal">Customer</i> <span>number</span>  </div>
    <div class="wrap" style="width:70px">Customer number</div><x-label></x-label>
    <div class="assist">Customer number<span style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Help text for this field</span><span style="visibility:hidden"> hidden tail</span></div>
    <div class="trunc" style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Customer number</div>
    <x-slotted>Customer number</x-slotted><span class="contents" style="display:contents">Customer number</span>
    <div class="short" style="overflow:hidden;white-space:nowrap;height:10px;font:14px Arial">Short</div>
    <div class="cols" style="display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:40px"><span>Left label</span><span>Right value</span></div><x-rootslot></x-rootslot><div class="aria"><span aria-hidden="true">Customer number</span></div>`);
  await page.evaluate(() => { document.querySelector('x-rootslot').attachShadow({ mode: 'open' }).innerHTML = '<slot>Root slot words</slot>'; });
  await page.evaluate(() => { document.querySelector('x-slotted').attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div><div><slot name="none">Fallback words</slot></div>'; });
  await page.evaluate(() => { document.querySelector('x-label').attachShadow({ mode: 'open' }).innerHTML = '<div style="font:14px Arial">Customer number</div>'; });
  const body = page.locator('body');
  const lines = async (selector) => (await layer.measure(body, { selector, textBox: true })).elements[0];

  await t.test('the last line ends where the last word does, inside a wider block', async () => {
    const a = await lines('.a');
    const word = (await layer.measure(body, { selector: '.b span' })).elements[0].rect;
    assert.equal(a.textLines.length, 1);
    assert.equal((await lines('.b')).textLines.length, 1, 'two text nodes on one line make one line');
    assert.ok(Math.abs(a.textLines[0].right - word.right) < 0.5, JSON.stringify([a.textLines[0], word]));
    assert.ok(a.rect.right - a.textLines[0].right > 200, 'the block runs well past the text');
    const first = (await layer.measure(body, { selector: '.b i' })).elements[0].rect;
    assert.ok(Math.abs(a.textLines[0].x - first.x) < 0.5 && first.x > a.rect.x, 'edge spaces are trimmed, though pre-wrap draws them');
  });

  await t.test('wrapped text gives a box per line, top to bottom', async () => {
    const w = await lines('.wrap');
    assert.equal(w.textLines.length, 2);
    assert.ok(w.textLines[1].y > w.textLines[0].y);
  });

  // The control is .a: the same words with nothing hidden end at the same x.
  await t.test('assistive and hidden text are left out of the line', async () => {
    const [assist, a] = [await lines('.assist'), await lines('.a')];
    assert.equal(assist.textLines.length, 1);
    assert.ok(Math.abs(assist.textLines[0].right - (a.textLines[0].right - (a.textLines[0].x - a.rect.x))) < 0.5, JSON.stringify([assist.textLines, a.textLines]));
  });

  await t.test('truncated text ends at its clipping box and says clipped', async () => {
    const tr = await lines('.trunc');
    assert.deepEqual([tr.textLines.length, tr.textLines[0].right <= tr.rect.right, tr.textLines[0].clipped], [1, true, true], JSON.stringify(tr));
    assert.equal((await lines('.wrap')).textLines[0].clipped, undefined);
  });

  // A <slot> is display:contents in Chrome, so slotted text and slot fallback text have a parent with no box.
  await t.test('slotted, fallback and display:contents text are read', async () => {
    assert.equal((await lines('x-slotted')).textLines.length, 2, 'the slotted words and the fallback words');
    assert.equal((await lines('.contents')).textLines.length, 1);
  });

  await t.test('a glyph box cut only at top and bottom is not clipped', async () => {
    assert.equal((await lines('.short')).textLines[0].clipped, undefined);
  });

  await t.test('two columns at one height are two lines, left to right as drawn, not in DOM order', async () => {
    const cols = await lines('.cols');
    const right = (await layer.measure(body, { selector: '.cols span:first-child' })).elements[0].rect;
    assert.equal(cols.textLines.length, 2);
    assert.ok(Math.abs(cols.textLines[1].x - right.x) < 0.5 && cols.textLines[0].x < cols.textLines[1].x, JSON.stringify(cols.textLines));
  });

  await t.test('fallback text of a slot directly in a shadow root is read from the host box', async () => {
    assert.equal((await lines('x-rootslot')).textLines.length, 1);
  });

  await t.test('aria-hidden text still draws, so it is a line', async () => {
    assert.equal((await lines('.aria')).textLines.length, 1);
  });

  await t.test('text inside a shadow root is found from its host, and no textBox means no textLines', async () => {
    assert.equal((await lines('x-label')).textLines.length, 1);
    assert.equal((await layer.measure(body, { selector: '.a' })).elements[0].textLines, undefined);
  });
});

test('layer read covered, no org', async (t) => {
  // Pins the walk's current document order (a host's light children before its shadow content) for the shared walk, not composed order.
  await t.test('covered texts come in document order', async () => {
    const pg = await localPage(t);
    await pg.setContent('<p style="position:relative"><b>First</b> <x-h>Second</x-h> <i>Third</i><span style="position:absolute;inset:0;background:#fff"></span></p>');
    await pg.evaluate(() => { document.querySelector('x-h').attachShadow({ mode: 'open' }).innerHTML = '<u>Shadow</u><slot></slot>'; });
    const r = await pg.locator('p').evaluate(layer.read, { covered: true });
    assert.deepEqual(r.covered.map((c) => c.text), ['First', 'Second', 'Shadow', 'Third']);
  });
});

test('a pointer-events none label is not covered by the input under it, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<div style="position:relative;width:200px"><input style="width:200px"><label style="position:absolute;left:4px;top:4px;pointer-events:none">Hint</label></div>
    <p style="position:relative;pointer-events:none">Blind<span style="position:absolute;inset:0;background:#fff;pointer-events:auto"></span></p>`);
  assert.deepEqual((await pg.locator('label').evaluate(layer.read, { covered: true })).covered, []);
  assert.deepEqual((await pg.locator('p').evaluate(layer.read, { covered: true })).covered.map((c) => c.text), ['Blind'], 'control: an overlay still covers blind text');
});

// frame on a local page: an iframe 50 px in with a 2 px border, holding a 100 px box and a button; the control is
// the same selector without frame, which cannot see inside.
test('layer measure frame, no org', async (t) => {
  const page = await localPage(t);
  const doc = "<body style='margin:8px'><div class='box' style='width:100px;height:20px;font:14px Arial'>Inside words</div><button>Inside</button></body>";
  await page.setContent(`<iframe class="old" style="display:none" srcdoc="${doc}"></iframe>
    <iframe title="Narrow" style="border:0;width:60px;height:40px" srcdoc="<body style='margin:0'><div class='wide' style='width:300px;font:14px Arial;white-space:nowrap'>Customer number field</div></body>"></iframe>
    <div style="margin:50px"><iframe title="Legacy page" style="border:2px solid;padding:5px;width:400px;height:200px" srcdoc="${doc}"></iframe></div>
    <div style="height:2000px"></div><iframe title="Below" style="border:0;width:400px;height:100px" srcdoc="${doc}"></iframe>
    <div style="transform:scale(0.5);transform-origin:0 0"><iframe title="Scaled" style="border:4px solid;padding:6px;width:400px;height:100px" srcdoc="${doc}"></iframe></div>
    <iframe title="Above" style="position:absolute;top:-60px;left:0;border:0;width:400px;height:200px"
      srcdoc="<body style='margin:0'><div style='height:50px;overflow:hidden'><div class='box' style='height:100px'>cut</div></div></body>"></iframe>`);
  const body = page.locator('body');
  const frameAt = await page.locator('iframe[title="Legacy page"]').boundingBox();
  await page.frameLocator('iframe[title="Legacy page"]').locator('.box').waitFor();

  await t.test('a selector inside the frame is measured in page px, which plain selectors cannot reach', async () => {
    assert.equal((await layer.measure(body, { selector: '.box', timeout: 200 })).count, 0);
    const r = await layer.measure(body, { frame: 'iframe[title="Legacy page"]', selector: '.box', textBox: true });
    const box = r.elements[0];
    assert.deepEqual([r.count, box.rect.x, box.rect.y, box.rect.width], [1, frameAt.x + 2 + 5 + 8, frameAt.y + 2 + 5 + 8, 100]);
    assert.equal(box.textLines[0].x, box.rect.x, 'textLines shift with the rect');
    assert.deepEqual(r.frame, { selector: 'iframe[title="Legacy page"]', x: frameAt.x + 7, y: frameAt.y + 7 });
    assert.equal(box.visible, 1);
  });

  await t.test('a named aim works inside the frame, and a missing frame is NOT_FOUND', async () => {
    const r = await layer.measure(body, { frame: 'iframe[title="Legacy page"]', name: 'Inside' });
    assert.equal(r.elements[0].tag, 'button');
    await assert.rejects(layer.measure(body, { frame: 'iframe.none', name: 'Inside', timeout: 200 }), { code: 'NOT_FOUND' });
  });

  // The hidden iframe comes first in the DOM, as an old tab's Visualforce page would.
  await t.test('only visible iframes count, and two visible are AMBIGUOUS', async () => {
    await assert.rejects(layer.measure(body, { frame: 'iframe', selector: '.box', timeout: 200 }), (e) => e.code === 'AMBIGUOUS' && e.evidence.matches.some((m) => m.title === 'Below'));
    // The scoped tools (sf_click, sf_fill... with frame) find their iframe the same way, matches included.
    await assert.rejects(layer.oneFrame(body, 'iframe', 200), (e) => e.code === 'AMBIGUOUS' && e.evidence.matches.some((m) => m.title === 'Below'));
    const only = await layer.measure(body, { frame: 'iframe.old, iframe[title="Legacy page"]', selector: '.box' });
    assert.ok(only.elements[0].rect.width === 100 && only.inView === 1, JSON.stringify(only));
  });

  // The frame shows page y -60..-10 (off-screen); the page shows frame y 60..200, where the box is already cut away.
  await t.test('what shows inside the frame and what the page shows of the frame must overlap', async () => {
    const r = await layer.measure(body, { frame: 'iframe[title="Above"]', selector: '.box' });
    assert.deepEqual([r.elements[0].visible, r.inView, r.elements[0].shown], [0, 0, undefined], JSON.stringify(r.elements[0]));
  });

  // The frame's own viewport does not cut the text (its div is 300 px wide); the iframe's 60 px box must.
  await t.test('text past the iframe edge is cut to it and marked clipped', async () => {
    const r = await layer.measure(body, { frame: 'iframe[title="Narrow"]', selector: '.wide', textBox: true });
    const at = await page.locator('iframe[title="Narrow"]').boundingBox();
    const line = r.elements[0].textLines[0];
    assert.deepEqual([line.right, line.clipped], [at.x + 60, true], JSON.stringify(line));
    const legacy = await layer.measure(body, { frame: 'iframe[title="Legacy page"]', selector: '.box', textBox: true });
    assert.equal(legacy.elements[0].textLines[0].clipped, undefined, 'a line inside the iframe is not marked');
  });

  await t.test('an iframe below the fold shows nothing on screen, and a scaled iframe scales its rects', async () => {
    const below = await layer.measure(body, { frame: 'iframe[title="Below"]', selector: '.box' });
    assert.deepEqual([below.elements[0].visible, below.inView, below.elements[0].clippedBy.tag], [0, 0, 'iframe']);
    const scaled = await layer.measure(body, { frame: 'iframe[title="Scaled"]', selector: '.box' });
    const at = await page.locator('iframe[title="Scaled"]').boundingBox();
    assert.deepEqual([scaled.elements[0].rect.width, scaled.elements[0].rect.x, scaled.frame.scale], [50, at.x + (4 + 6 + 8) / 2, 0.5]);
  });
});

// The fixture's Visualforce tab: Lightning shows the page in a cross-origin iframe. The control for each number is
// Playwright's own box for the same element, which it maps from the frame to the page itself.
test('layer measure frame on a Visualforce tab', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const { nav } = require('..');
  const { main } = await nav.openTab(s, 'SfUi_Vf');
  const frame = 'iframe[name^="vfFrameId"]';
  const box = s.page.frameLocator(frame).locator('.box');
  await box.waitFor({ timeout: 30_000 });

  await t.test('a selector inside the Visualforce page is measured in page px', async () => {
    assert.equal((await layer.measure(main, { selector: '.box', timeout: 500 })).count, 0, 'plain selectors stop at the iframe');
    const r = await layer.measure(main, { frame, selector: '.box', textBox: true });
    const want = await box.boundingBox();
    const got = r.elements[0];
    assert.ok(['x', 'y', 'width', 'height'].every((k) => Math.abs(got.rect[k] - want[k]) < 0.6), JSON.stringify([got.rect, want]));
    assert.deepEqual([got.visible, r.inView, got.textLines.length], [1, 1, 1]);
  });

  await t.test('a button in the page is aimed by name', async () => {
    const r = await layer.measure(main, { frame, name: 'VF button' });
    assert.equal(r.elements[0].tag, 'button');
  });

  await t.test('a tab that does not exist is TAB_UNAVAILABLE', async () => {
    await assert.rejects(nav.openTab(s, 'No_Such_Tab', { timeout: 30_000 }), { code: 'TAB_UNAVAILABLE' });
  });
});

// No org: an overlay inside the target. The first two are the falsifiers; the controls hold with or without the predicate.
test('onTop sees an overlay that is a descendant of the target, no org', async (t) => {
  const page = await localPage(t);
  const sr = 'position:absolute;margin:-1px;border:0;padding:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
  await page.setContent(`
    <p style="position:relative;width:300px">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p>
    <div role="region" aria-label="Spinner card" style="position:relative;width:300px;height:60px"><p>Content under spinner</p>
      <div style="position:absolute;inset:0;background:rgba(255,255,255,0.75)"><div role="status"><span style="${sr}">Loading</span></div></div></div>
    <div style="position:relative;width:300px;height:60px"><p>Under a sibling</p><div style="position:absolute;inset:0;background:rgba(255,255,255,0.75)">Saving</div></div>
    <p style="width:300px"><span>Nested text here</span></p>
    <button style="width:160px;height:40px"><svg width="20" height="20"><rect width="20" height="20"/></svg>Save</button>
    <p style="width:300px">Shipped <svg width="40" height="20" style="vertical-align:middle"><rect width="40" height="20"/></svg></p>`);
  const top = async (opts) => (await layer.onTop(page.locator('body'), opts)).onTop;
  assert.equal(await top({ text: 'Size chosen: Large' }), false, 'T1 overlay: an empty white span over the text');
  assert.equal(await top({ role: 'region', name: 'Spinner card' }), false, 'a spinner container inside the card it covers');
  assert.equal(await top({ text: 'Under a sibling' }), false, 'an overlay beside the target covers it: the walk up, not the predicate');
  assert.equal(await top({ text: 'Nested text here' }), true, 'control: text in a child span');
  assert.equal(await top({ name: 'Save' }), true, 'control: a button with an icon child');
  assert.equal(await top({ text: 'Shipped' }), true, 'control: <p>Shipped <svg/></p>');
});

// No org: one control per occluder condition, each a child that covers its button; each goes red with its condition gone.
test('onTop counts a covering child as the target unless all three occluder conditions hold, no org', async (t) => {
  const page = await localPage(t);
  const btn = 'position:relative;width:160px;height:40px;padding:0';
  await page.setContent(`
    <button style="${btn}" aria-label="Static"><span style="display:block;width:100%;height:100%;background:#0176d3"></span></button>
    <button style="${btn}" aria-label="Clear"><span style="position:absolute;inset:0"></span></button>
    <button style="${btn}" aria-label="Badge"><span style="position:absolute;inset:0;background:#c23934;color:#fff">3</span></button>
    <button style="position:absolute;top:300px;width:160px;height:40px;background:#fff" aria-label="Close"><svg width="8" height="8"></svg></button>
    <button style="${btn};top:360px" aria-label="Upload"><span style="position:absolute;inset:0;background:#fff;opacity:0"></span></button>
    <button style="${btn}" aria-label="Faded"><span style="opacity:0"><span style="position:absolute;inset:0;background:#fff"></span></span></button>
    <button style="${btn}" aria-label="None"><span style="position:absolute;inset:0;background:oklch(0.5 0.1 200 / none)"></span></button>
    <button style="${btn}" aria-label="Hook"><span style="position:absolute;inset:0;background:oklch(0.5 0.1 200 / 0)"></span></button>
    <p style="position:relative;width:300px">Hook overlay<span style="position:absolute;inset:0;background:oklch(1 0 0 / 0.75)"></span></p>`);
  const top = async (name) => (await layer.onTop(page.locator('body'), { name })).onTop;
  assert.equal(await top('Static'), true, 'control: a painted icon container that is not absolute (SLDS utility icon)');
  assert.equal(await top('Clear'), true, 'control: an absolute hit area that paints nothing');
  assert.equal(await top('Badge'), true, 'control: an absolute painted badge with its own text');
  assert.equal(await top('Close'), true, 'control: a target that is itself absolute, white and textless');
  assert.equal(await top('Upload'), true, 'control: an absolute white child at opacity 0 (a styled file input)');
  assert.equal(await top('Faded'), true, 'control: a white child of a wrapper at opacity 0 (a faded-out backdrop)');
  assert.equal(await top('None'), true, 'control: an absolute child whose oklch alpha is none');
  assert.equal(await top('Hook'), true, 'control: an absolute child whose oklch background has alpha 0');
  assert.equal((await layer.onTop(page.locator('body'), { text: 'Hook overlay' })).onTop, false, 'an oklch overlay with alpha 0.75 covers');
});

// No org: the hit is a plain child of an overlay that wraps it; the overlay is the cover, found on the walk up.
test('onTop weighs the ancestors between the hit and the target, no org', async (t) => {
  const page = await localPage(t);
  const btn = 'position:relative;width:160px;height:40px;padding:0';
  await page.setContent(`
    <button style="${btn}" aria-label="Wrapped"><span style="position:absolute;inset:0;background:#fff"><i style="display:block;height:100%"></i></span></button>
    <button style="${btn}" aria-label="Labelled"><span style="position:absolute;inset:0;background:#fff"><i style="display:block;height:100%">Go</i></span></button>`);
  const top = async (name) => (await layer.onTop(page.locator('body'), { name })).onTop;
  assert.equal(await top('Wrapped'), false, 'an empty child inside a white overlay');
  assert.equal(await top('Labelled'), true, 'control: text inside the wrapper makes it a styled control, not an overlay');
});

// No org: a script reacts to the scroll the read makes (here it drops a banner); the read waits one frame to see it.
test('covered read with scroll waits one frame for scroll scripts, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<main style="height:3000px"><p style="position:absolute;top:2000px;margin:0">Docked</p></main><div id="bar" style="position:fixed;inset:0;background:#fff"></div>
    <script>addEventListener('scroll', () => { document.getElementById('bar').style.display = 'none'; });</script>`);
  const r = await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true });
  assert.deepEqual([r.covered.length, r.checked], [0, 1], JSON.stringify(r));
});

// No org: scrolling clears a fixed bar, not a cover that scrolls with the text, so only the first moves the page.
test('covered read with scroll moves the page only for a fixed or sticky cover, no org', async (t) => {
  const pg = await localPage(t);
  const read = async (cover) => {
    await pg.setContent(`<main style="height:3000px;position:relative"><p style="position:absolute;top:600px;margin:0">Words</p>${cover}</main>`);
    await pg.evaluate(() => { window.looked = 0; const o = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (...a) { window.looked++; return o.apply(this, a); }; });
    const r = await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true });
    return [r.covered.length, await pg.evaluate(() => window.looked > 0), 'pinned' in r];
  };
  assert.deepEqual(await read('<div style="position:absolute;left:0;top:560px;width:300px;height:100px;background:#fff"></div>'), [1, false, false], 'absolute cover: the page stays');
  assert.deepEqual(await read('<div style="position:fixed;left:0;top:560px;width:300px;height:100px;background:#fff"></div>'), [0, true, false], 'fixed cover: the page moves and clears it');
});

// No org: the read scrolls to look and puts every scroll position back, so sf_wait stays read-only.
test('covered read with scroll restores the scroll of the window and of an inner box, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<div id="box" style="height:200px;overflow:auto"><div style="height:1500px"></div><p>Deep words</p></div><div style="height:3000px"></div>`);
  const r = await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true });
  assert.deepEqual([r.covered.length, r.checked], [0, 1], 'the text was scrolled to and read');
  assert.deepEqual(await pg.evaluate(() => [scrollY, document.getElementById('box').scrollTop]), [0, 0]);
});

// No org: a pointer-events none label under a fixed panel whose hit is the panel's static, text-bearing child is covered by the panel.
test('a blind label under a fixed panel is covered through the hit\'s ancestors, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<p style="position:absolute;left:10px;top:10px;margin:0;pointer-events:none">Hint</p>
    <div style="position:fixed;left:0;top:0;width:300px;height:300px;background:#fff"><p style="margin:0;height:300px">Modal body</p></div>`);
  assert.deepEqual((await pg.locator('p').first().evaluate(layer.read, { covered: true })).covered.map((c) => c.text), ['Hint']);
  await pg.setContent(`<div style="position:relative;width:200px"><input style="width:200px"><label style="position:absolute;left:4px;top:4px;pointer-events:none">Hint</label></div>`);
  assert.deepEqual((await pg.locator('label').evaluate(layer.read, { covered: true })).covered, [], 'control: the input a label floats over is not a cover');
});

// No org: a blind label z-indexed over a map wrapper is not covered by it; the same wrapper z-indexed over the label is.
test('a blind label above a textless absolute wrapper is not covered by it, no org', async (t) => {
  const pg = await localPage(t);
  const html = (z) => `<div style="position:absolute;left:0;top:0;width:300px;height:300px;background:#ccc;z-index:${z}"><canvas width="300" height="300"></canvas></div>
    <p style="position:absolute;z-index:5;left:10px;top:10px;margin:0;pointer-events:none">Pin</p>`;
  await pg.setContent(html(1));
  assert.deepEqual((await pg.locator('p').evaluate(layer.read, { covered: true })).covered, [], 'the wrapper paints under the label');
  await pg.setContent(html(9));
  assert.deepEqual((await pg.locator('p').evaluate(layer.read, { covered: true })).covered.map((c) => c.text), ['Pin'], 'control: the wrapper paints over the label');
});

// No org: the stacking level of a branch is that of its outermost stacking-context node, not of the node at the fork.
test('a blind label is covered by a z-indexed fixed section inside a static portal, no org', async (t) => {
  const pg = await localPage(t);
  const cover = 'left:0;top:0;width:300px;height:300px;background:#fff';
  await pg.setContent(`<div id="app" style="position:relative"><p style="margin:0;pointer-events:none">Hint</p></div>
    <div id="portal"><section style="position:fixed;z-index:9000;${cover}"></section></div>`);
  assert.deepEqual((await pg.locator('p').evaluate(layer.read, { covered: true })).covered.map((c) => c.text), ['Hint'], 'a fixed z-index 9000 section in a static portal paints over the label');
});

test('a blind label with a z-index inside a static wrapper paints over an auto overlay, no org', async (t) => {
  const pg = await localPage(t);
  const cover = 'left:0;top:0;width:300px;height:300px;background:#fff';
  await pg.setContent(`<div><p style="position:absolute;z-index:5;left:10px;top:10px;margin:0;pointer-events:none">Pin</p></div>
    <div style="position:absolute;${cover}"></div>`);
  assert.deepEqual((await pg.locator('p').evaluate(layer.read, { covered: true })).covered, [], 'a z-index 5 label in a static wrapper paints over a z-index auto overlay');
});

// No org: the styled-control exemption counts text that draws; text in a shadow root counts, hidden text does not.
test('onTop tells an overlay from a styled control by the text it draws, no org', async (t) => {
  const page = await localPage(t);
  const btn = 'position:relative;width:160px;height:40px;padding:0';
  await page.setContent(`
    <button style="${btn}" aria-label="Shadowed"><x-lbl style="position:absolute;inset:0;background:#fff;display:block"></x-lbl></button>
    <button style="${btn}" aria-label="Hidden"><span style="position:absolute;inset:0;background:#fff"><i style="display:block;height:100%"></i><b style="display:none">sr only</b></span></button>`);
  await page.evaluate(() => { document.querySelector('x-lbl').attachShadow({ mode: 'open' }).innerHTML = '<i style="display:block;height:100%">Go</i>'; });
  const top = async (name) => (await layer.onTop(page.locator('body'), { name })).onTop;
  assert.equal(await top('Shadowed'), true, 'text in a shadow root is drawn text: a styled control');
  assert.equal(await top('Hidden'), false, 'text that does not draw does not make an overlay a control');
});

// No org: the text sits in a scrolling panel under a header that is not in the panel; scrolling the panel clears it.
test('covered read with scroll clears a cover that sits outside the text\'s scroller, no org', async (t) => {
  const pg = await localPage(t);
  const html = (header) => `<div style="position:relative;width:300px"><div style="${header};left:0;top:0;width:300px;height:40px;background:#fff"></div>
    <div id="panel" style="height:200px;overflow:auto"><div style="height:300px"></div><p style="margin:0">Panel words</p><div style="height:500px"></div></div></div>`;
  const read = async (header) => {
    await pg.setContent(html(header));
    await pg.evaluate(() => { document.getElementById('panel').scrollTop = 270; }); // the text now sits at 30 px, under the header
    const r = await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true });
    return [r.covered.length, await pg.evaluate(() => document.getElementById('panel').scrollTop)];
  };
  assert.deepEqual(await read('position:absolute'), [0, 270], 'the header outside the panel is cleared by centring, and the scroll put back');
  await pg.setContent('<div id="panel" style="height:200px;overflow:auto;position:relative"><div style="height:300px"></div><p style="margin:0">Panel words</p><div style="position:absolute;left:0;top:300px;width:300px;height:30px;background:#fff"></div><div style="height:500px"></div></div>');
  assert.equal((await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true })).covered.length, 1, 'control: a cover inside the panel scrolls with the text, so it still covers');
});

// No org: overflow hidden is not a box a user scrolls, so a cover outside it is not cleared by scrolling it by script.
test('covered read with scroll does not scroll an overflow-hidden box to clear a cover, no org', async (t) => {
  const pg = await localPage(t);
  const html = (overflow) => `<div style="position:relative;width:300px"><div style="position:absolute;left:0;top:0;width:300px;height:40px;background:#fff"></div>
    <div id="panel" style="height:200px;overflow:${overflow}"><div style="height:300px"></div><p style="margin:0">Panel words</p><div style="height:500px"></div></div></div>`;
  const read = async (overflow) => {
    await pg.setContent(html(overflow));
    await pg.evaluate(() => { document.getElementById('panel').scrollTop = 270; });
    return (await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true })).covered.length;
  };
  assert.equal(await read('hidden'), 1, 'the header still covers the text a user cannot scroll out from under it');
  assert.equal(await read('auto'), 0, 'control: an auto panel is scrolled and clears it');
});

// No org: one copy of the text is on screen under an absolute overlay, another is below the fold; scrolling reads the other.
test('covered read with scroll still looks at text that is only off-screen, no org', async (t) => {
  const pg = await localPage(t);
  const html = (cover) => `<div style="height:300px"></div><div id="t"><p style="position:relative;margin:0">One${cover}</p><p style="margin:500px 0 0">Two</p></div><div style="height:2000px"></div>`;
  await pg.setContent(html('<i style="position:absolute;inset:0;background:#fff"></i>'));
  const r = await pg.locator('#t').evaluate(layer.read, { covered: true, scroll: true });
  assert.deepEqual([r.covered.map((c) => c.text), r.checked], [['One'], 2], 'the copy below the fold is read, shown, and One stays covered');
  assert.equal(await pg.evaluate(() => scrollY), 0);
  await pg.setContent(html('<i style="position:absolute;inset:0"></i>'));
  assert.equal((await pg.locator('#t').evaluate(layer.read, { covered: true, scroll: true })).covered.length, 0, 'control: no overlay');
});

// No org: the text is off-screen inside an iframe that is itself below the fold; the read scrolls both and puts both back.
test('covered read with scroll restores the parent document when el is in an iframe, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<div style="height:1500px"></div><iframe style="width:300px;height:200px;border:0" srcdoc="<body style=margin:0><div style=height:1000px></div><p>Frame words</p>"></iframe><div style="height:2000px"></div>`);
  const p = pg.frameLocator('iframe').locator('p');
  await p.waitFor();
  const r = await p.evaluate(layer.read, { covered: true, scroll: true });
  assert.deepEqual([r.covered.length, r.checked], [0, 1], 'the text was scrolled to and read');
  assert.deepEqual(await pg.evaluate(() => [scrollY, document.querySelector('iframe').contentWindow.scrollY]), [0, 0]);
});

// No org: the second pass throws (here the scroll breaks a Range); the read rejects at once and the page is put back.
test('covered read with scroll rejects when its second pass throws, and restores the scroll, no org', { timeout: 20_000 }, async (t) => {
  const pg = await localPage(t);
  await pg.setContent(`<main style="height:3000px"><p style="position:absolute;top:2000px;margin:0">Deep</p></main>
    <script>addEventListener('scroll', () => { Range.prototype.getClientRects = () => { throw new Error('boom'); }; });</script>`);
  const t0 = Date.now();
  await assert.rejects(pg.locator('p').evaluate(layer.read, { covered: true, scroll: true }, { timeout: 5_000 }), /boom/);
  assert.ok(Date.now() - t0 < 2_000, `rejected after ${Date.now() - t0} ms`);
  assert.equal(await pg.evaluate(() => scrollY), 0);
});

// No org: two reads in flight at once (the first lost its race in Node) must not leave the page at the first one's scroll.
test('two covered reads with scroll at once leave the scroll where it was, no org', async (t) => {
  const pg = await localPage(t);
  await pg.setContent('<main style="height:4000px"><p id="a" style="position:absolute;top:1500px;margin:0">One</p><p id="b" style="position:absolute;top:2500px;margin:0">Two</p></main>');
  const both = await Promise.all(['#a', '#b'].map((id) => pg.locator(id).evaluate(layer.read, { covered: true, scroll: true })));
  assert.deepEqual(both.map((r) => [r.covered.length, r.checked]), [[0, 1], [0, 1]], 'each was scrolled to and read');
  assert.equal(await pg.evaluate(() => scrollY), 0);
});

// No org: a previous read that never settles holds the next one for its time budget, not for ever.
test('a covered read waits for a stalled earlier read only for its own budget, no org', { timeout: 20_000 }, async (t) => {
  const pg = await localPage(t);
  await pg.setContent('<p>Words</p>');
  await pg.evaluate(() => { window.sfCoverRead = new Promise(() => {}); });
  const t0 = Date.now();
  const stuck = new Promise((ok) => { setTimeout(ok, 3_000, null).unref(); });
  const r = await Promise.race([pg.locator('p').evaluate(layer.read, { covered: true, budget: 300 }), stuck]);
  assert.ok(r, 'the read came back');
  assert.deepEqual([r.covered.length, r.checked], [0, 1], 'the read ran');
  assert.ok(Date.now() - t0 < 3_000, `took ${Date.now() - t0} ms`);
});

// No org: the call waitFor makes, evaluate timeout and all, against a stalled earlier read still gets its answer.
test('waitFor reads a text past a stalled earlier read within the time it was given, no org', { timeout: 20_000 }, async (t) => {
  const pg = await localPage(t);
  await pg.setContent('<main><p>Words</p></main>');
  await pg.evaluate(() => { window.sfCoverRead = new Promise(() => {}); });
  const r = await act.waitFor(pg.locator('body'), { text: 'Words', timeout: 800 });
  assert.equal(r.coverUnchecked, undefined, 'the read ran inside the time the call was given');
});

// No org: a read whose budget expired before the earlier one settled looks only; the earlier one may be mid-scroll.
test('a covered read that outwaited its budget does not scroll, no org', { timeout: 20_000 }, async (t) => {
  const pg = await localPage(t);
  await pg.setContent('<main style="height:4000px"><p style="position:absolute;top:2000px;margin:0">Deep</p></main>');
  await pg.evaluate(() => { Element.prototype.scrollIntoView = function spy() { window.scrolled = true; }; });
  await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true });
  assert.equal(await pg.evaluate(() => window.scrolled), true, 'control: with no earlier read it scrolls');
  await pg.evaluate(() => { window.scrolled = false; window.sfCoverRead = new Promise(() => {}); });
  await pg.locator('p').evaluate(layer.read, { covered: true, scroll: true, budget: 200 });
  assert.equal(await pg.evaluate(() => window.scrolled), false, 'it read without scrolling');
});

// No org: a button below the fold is scrolled to before the hit test, so onTop does not follow the viewport's height;
// visible and box are read as the user sees the page before it, and the page is put back after.
test('onTop scrolls to an element past the viewport edge before it reads, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent('<div style="height:3000px">tall</div><button>Low</button>');
  const r = await layer.onTop(page.locator('body'), { name: 'Low' });
  assert.equal(r.onTop, true, JSON.stringify(r.points));
  assert.ok(r.scrolled.y > 1000, JSON.stringify(r.scrolled));
  assert.deepEqual([r.visible, r.box.y > 2000], [0, true], 'visible and box are the unscrolled page\'s');
  assert.equal(await page.evaluate(() => scrollY), 0, 'the page is put back');
  await page.setContent('<html style="scroll-behavior:smooth"><body><div style="height:3000px">tall</div><button>Low</button></body></html>');
  const smooth = await layer.onTop(page.locator('body'), { name: 'Low' });
  assert.deepEqual([smooth.onTop, smooth.scrolled.y > 1000], [true, true], `smooth scrolling: ${JSON.stringify(smooth)}`);
  assert.equal(await page.evaluate(() => scrollY), 0, 'smooth scrolling: the page is put back');
  await page.setContent('<button>High</button>');
  assert.equal((await layer.onTop(page.locator('body'), { name: 'High' })).scrolled, undefined, 'control: one in view is not scrolled');
});
