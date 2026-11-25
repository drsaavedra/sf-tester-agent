'use strict';

// Stacking and clipping without vision: what paints on top at a target's centre and inset corners (hit tests
// descend through shadow roots), and how much of its box survives the viewport and overflow-clipping ancestors.
const { SfUiError } = require('./errors');
const { resolve } = require('./act');

// Runs in the page. ponytail: hit tests skip pointer-events:none layers.
// hit: false skips the hit tests and adds the rect at 0.1 px, overflow and the named computed styles; textBox adds
// where the element's text draws, one box per line, so a word's edge is readable where the element box is wider.
function read(el, { hit = true, styles = [], textBox = false, withBox = false, covered = false, scroll = false, budget = 1000 } = {}) {
  const up = (n) => n.assignedSlot || n.parentNode || n.host; // composed parent; synthetic shadow patches contains()
  // Alpha from rgba(r, g, b, a) or a CSS Color 4 form (oklch(l c h / a), where "/ none" is 0); none given is opaque.
  const fill = (c) => {
    const a = c.backgroundColor.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$|\/\s*([\d.]+|none)%?\s*\)$/);
    const alpha = !a ? 1 : a[2] === 'none' ? 0 : Number(a[1] ?? a[2]);
    return alpha > 0 || c.backgroundImage !== 'none';
  };
  // A ::before or ::after paints for its element when it is an absolute or fixed fill over its whole box (a pseudo
  // overlay); a nubbin, a divider or a hidden one does not.
  const pseudo = (n) => ['::before', '::after'].some((p) => {
    const c = getComputedStyle(n, p);
    if (['none', 'normal'].includes(c.content) || c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0 || !['absolute', 'fixed'].includes(c.position) || !fill(c)) return false;
    // inset: 0 fills the padding box, not the border box
    return parseFloat(c.width) >= (n.clientWidth || n.getBoundingClientRect().width) - 1 && parseFloat(c.height) >= (n.clientHeight || n.getBoundingClientRect().height) - 1;
  });
  const paints = (n, c = getComputedStyle(n)) => n.checkVisibility({ opacityProperty: true }) && (fill(c) || pseudo(n));
  const ownText = (n) => [...n.childNodes].some((k) => k.nodeType === 3 && /\S/.test(k.nodeValue));
  // A hit that is absolute or fixed, paints and has no text of its own covers the target (the T1 span, an SLDS spinner).
  // ponytail: in measure only the hit is tested, so an overlay's unpainted child reads as the target, and an overlay with
  // text is not told from a host's own absolute popover or backdrop; walk the nodes from hit to target if either bites.
  const occluder = (n, target = el, c = getComputedStyle(n)) => {
    if (n === target || !['absolute', 'fixed'].includes(c.position)) return false; // most hits stop here, before the walks
    return paints(n, c) && !ownText(n);
  };
  // The layers at x, y top down, each shadow tree's own layers before its host, read only past the hit.
  function* layersAt(x, y, root = document, depth = 0) {
    for (const n of root.elementsFromPoint(x, y)) {
      if (root !== document && n.getRootNode() !== root) continue; // an outer layer: the outer call yields it
      if (n.shadowRoot?.elementsFromPoint && depth < 50) yield* layersAt(x, y, n.shadowRoot, depth + 1); // a root without it is weighed as its host
      yield n;
    }
  }
  // covered mode: text in parent is covered by a layer that paints before the walk meets parent, an ancestor or a
  // descendant (a transparent SLDS modal over its backdrop). ponytail: an ancestor's pseudo over its child is missed.
  const covering = (hit, parent, x, y) => {
    // Text that takes no hits (pointer-events: none) is missing from the layers, so the hit and its ancestors are weighed, and
    // only an overlay (occluder) counts: the layer under a label is not its cover.
    const blind = getComputedStyle(parent).pointerEvents === 'none';
    if (blind) {
      const own = new Set();
      for (let k = parent; k; k = up(k)) own.add(k);
      // An overlay counts only if it paints over the text: at the fork below their common ancestor the higher level wins, a tie goes to the later node.
      // ponytail: positioned or not and z-index only, no other stacking contexts (opacity, transform).
      const level = (n) => { if (n.nodeType !== 1) return 0; const c = getComputedStyle(n); return c.position === 'static' ? -1 : Number.isNaN(parseInt(c.zIndex, 10)) ? 0 : parseInt(c.zIndex, 10); };
      const stacks = (n) => { if (n.nodeType !== 1) return false; const c = getComputedStyle(n); return ['fixed', 'sticky'].includes(c.position) || (c.position !== 'static' && !Number.isNaN(parseInt(c.zIndex, 10))); };
      // A branch paints at the level of its outermost stacking-context node below the fork, else the fork node's.
      const branch = (n, fork) => { let top = fork; for (let m = n; m; m = up(m)) { if (stacks(m)) top = m; if (m === fork) break; } return level(top); };
      const over = (k) => {
        let a = k;
        while (a && !own.has(up(a))) a = up(a);
        if (!a) return true;
        let t = parent;
        while (t && up(t) !== up(a)) t = up(t);
        if (!t || a === t) return true;
        const [la, lt] = [branch(k, a), branch(parent, t)];
        return la !== lt ? la > lt : !!(t.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      };
      for (let k = hit; k && !own.has(k); k = up(k)) if (k.nodeType === 1 && occluder(k, parent) && over(k)) return { by: k }; // a static child of a fixed modal
      return false; // a blind label's hit is whatever lies under it (an input it floats over), which proves nothing
    }
    for (const n of (function* () { yield hit; yield* layersAt(x, y); })()) {
      for (let k = parent; k; k = up(k)) if (k === n) return false;
      const c = getComputedStyle(n);
      if (occluder(n, parent, c)) return { by: n }; // the T1 span is inside the text's element
      for (let k = n; k; k = up(k)) if (k === parent) return false;
      // An invisible layer (opacity 0, a drop zone's file input) still takes hits, but draws nothing.
      if (n.checkVisibility({ opacityProperty: true }) && (fill(c) || pseudo(n) || ownText(n) || n.matches('img, svg, canvas, video, iframe, input, textarea, select'))) return { by: n };
    }
    return false;
  };
  // A layer that stays put while the page scrolls: it, or an ancestor, is fixed or sticky.
  const pinnedOf = (n) => { for (; n; n = up(n)) if (n.nodeType === 1 && ['fixed', 'sticky'].includes(getComputedStyle(n).position)) return true; return false; };
  // The nearest box that scrolls under el; a layer outside it stays put while it scrolls.
  const scrollerOf = (n) => { for (n = up(n); n; n = up(n)) if (n.nodeType === 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n; return null; };
  const outside = (n, box) => { for (; n; n = up(n)) if (n === box) return false; return !!box; };
  // The children of e, then those of its open shadow root.
  const kids = (e) => [...e.childNodes, ...(e.shadowRoot ? e.shadowRoot.childNodes : [])].values();
  // The element a text node draws in: a <slot> has no box of its own, and one directly in a shadow root climbs to the
  // root, whose box is its host.
  const boxOf = (t) => {
    let n = t.parentElement || t.parentNode?.host;
    while (n && getComputedStyle(n).display === 'contents') { n = up(n); if (n?.nodeType === 11) n = n.host; }
    return n;
  };
  // The hit and every ancestor up to the target are weighed: an overlay wrapping the hit covers the target too. An
  // ancestor with drawn text anywhere inside (shadow roots too, hidden text not) is a styled control (a badge in a wrapper), not an overlay.
  const isTarget = (n, target = el) => {
    const hit = n;
    for (; n; n = up(n)) {
      if (n === target) return true;
      if (n.nodeType === 1 && occluder(n, target) && (n === hit || drawnTexts(n).next().done)) return false;
    }
    return false;
  };
  const hosts = (n) => { const out = []; for (let r = n.getRootNode(); r.host && out.length < 3; r = r.host.getRootNode()) out.push(r.host.localName); return out; };
  const text = (n) => (n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const describe = (n) => ({ tag: n.localName, label: text(n), hosts: hosts(n) });
  const topAt = (x, y) => {
    let hit = document.elementFromPoint(x, y);
    for (let i = 0; hit && hit.shadowRoot && i < 50; i++) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };
  const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
  // b cut to the clipping ancestors from n up (not body or html), the first that cut it, and shut when a collapsed one
  // clips it (a closed accordion); an absolute or fixed box (out, el's own position) is not cut below its containing block.
  // ponytail: transform, filter, perspective, contain and will-change make a fixed box's containing block, not other rules.
  const clipFrom = (n, b, out = null) => {
    let [by, shut] = [null, false];
    for (; n; n = up(n)) {
      if (n.nodeType !== 1 || n === document.body || n === document.documentElement) continue;
      const c = getComputedStyle(n);
      const holds = c.transform !== 'none' || c.perspective !== 'none' || c.filter !== 'none' || /paint|layout|strict|content/.test(c.contain) || /transform|perspective|filter/.test(c.willChange);
      if (holds || (out === 'absolute' && c.position !== 'static')) out = null; // n is the containing block, so it clips
      if (out) continue; // a fixed calendar over a scrolling modal's edge (F-flow-16)
      if (['absolute', 'fixed'].includes(c.position)) out = c.position;
      const [cx, cy] = [c.overflowX !== 'visible', c.overflowY !== 'visible'];
      if ((!cx && !cy) || ['inline', 'contents'].includes(c.display)) continue; // overflow has no effect on an inline box
      const p = n.getBoundingClientRect();
      const [left, top] = [p.left + n.clientLeft, p.top + n.clientTop];
      const next = {
        left: cx ? Math.max(b.left, left) : b.left, right: cx ? Math.min(b.right, left + n.clientWidth) : b.right,
        top: cy ? Math.max(b.top, top) : b.top, bottom: cy ? Math.min(b.bottom, top + n.clientHeight) : b.bottom,
      };
      if (!by && area(next) < area(b) - 0.5) by = describe(n);
      shut ||= (cx && n.clientWidth === 0) || (cy && n.clientHeight === 0);
      // Cut to nothing by a box the user cannot scroll (a carousel stage): shut too. A 1x1 assistive box is no stage:
      // it does not shut its own text (whose line can start below its 1 px), and what it leaves has nothing to cut.
      const fixedIn = (o) => ['hidden', 'clip'].includes(o);
      shut ||= n.clientWidth > 1 && n.clientHeight > 1
        && ((fixedIn(c.overflowX) && b.right - b.left > 1 && next.right - next.left <= 0.5) || (fixedIn(c.overflowY) && b.bottom - b.top > 1 && next.bottom - next.top <= 0.5));
      b = next;
    }
    return { box: b, by, shut };
  };
  // Each drawn text node under n, with its box parent and start offset; hidden text is skipped, and aria-hidden
  // subtrees with skipAria. Light children are walked as well as the shadow root: they hold its slotted text.
  function* drawnTexts(n, { skipAria = false } = {}) {
    const stack = [kids(n)];
    while (stack.length) {
      const { value: c, done } = stack[stack.length - 1].next();
      if (done) { stack.pop(); continue; }
      if (c.nodeType === 1) { if (!(skipAria && c.getAttribute('aria-hidden') === 'true')) stack.push(kids(c)); continue; }
      const v = c.nodeType === 3 ? c.nodeValue : '';
      const start = v.search(/\S/);
      if (start < 0) continue;
      const parent = boxOf(c);
      if (!parent || !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      yield { c, v, start, parent };
    }
  }
  // Drawn text cut by its overflow ancestors, one box per line.
  // Rects join a line when their vertical centres meet and less than 1 em apart, so columns stay separate lines.
  const textLines = (root) => {
    const lines = [];
    for (const { c, v, start, parent } of drawnTexts(root)) {
      const em = parseFloat(getComputedStyle(parent).fontSize) || 16;
      const range = document.createRange();
      range.setStart(c, start);
      range.setEnd(c, v.trimEnd().length);
      for (const rect of range.getClientRects()) {
        const { box: b } = clipFrom(parent, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        const by = b.left - rect.left > 0.5 || rect.right - b.right > 0.5; // cut sideways; a line box is taller than its glyphs
        if (b.right - b.left <= 1 || b.bottom - b.top <= 1) continue; // cut away, or a 1px assistive box
        const cy = (b.top + b.bottom) / 2;
        const line = lines.find((l) => cy >= l.top && cy < l.bottom && b.left - l.right < em && l.left - b.right < em);
        if (line) Object.assign(line, { left: Math.min(line.left, b.left), right: Math.max(line.right, b.right), top: Math.min(line.top, b.top), bottom: Math.max(line.bottom, b.bottom), clipped: line.clipped || !!by });
        else lines.push({ ...b, clipped: !!by });
      }
    }
    return lines.sort((a, b) => a.top - b.top || a.left - b.left);
  };

  // covered: every drawn text under el (open shadow roots, aria-hidden subtrees skipped), hit-tested at the centre of its
  // first drawn rect; covered by the first painting layer covering() finds. ponytail: centre point only, and 100 texts.
  // Reads on one page take turns: one that lost its race in Node still scrolls and restores here, and must finish
  // before the next one saves the scroll it will put back. A read waits for the one before it for budget ms at most, then
  // looks without scrolling (late), since the one before may still be mid-scroll.
  const inTurn = (run) => {
    const prior = window.sfCoverRead;
    let timer;
    const mine = prior ? Promise.race([Promise.resolve(prior).then(() => false, () => false), new Promise((ok) => { timer = setTimeout(ok, budget, true); })]).finally(() => clearTimeout(timer)).then(run) : run(false);
    window.sfCoverRead = Promise.resolve(mine).catch(() => {});
    return mine;
  };
  if (covered) return inTurn((late) => {
    let [pinned, unseen] = [false, false]; // unseen: a drawn text lies off-screen, so no hit test reached it
    const scroller = scrollerOf(el);
    const pass = () => {
      const out = [];
      let [checked, drawn, stopped, clipped] = [0, false, false, false]; // clipped: drawn text a collapsed box cut to nothing
      for (const { c, v, start, parent } of drawnTexts(el, { skipAria: true })) {
        const range = document.createRange();
        range.setStart(c, start);
        range.setEnd(c, v.trimEnd().length);
        const rects = [...range.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
        if (rects.length) drawn = true;
        const cuts = rects.map((q) => clipFrom(parent, { left: q.left, right: q.right, top: q.top, bottom: q.bottom }));
        const b = cuts.map((k) => k.box).find((k) => k.right - k.left > 1 && k.bottom - k.top > 1);
        // A 1x1 assistive box (slds-assistive-text) or a scroller's hidden part is not collapsed, so not clipped.
        if (!b) { clipped ||= cuts.some((k) => k.shut); continue; }
        if (checked >= 100) { stopped = true; break; }
        const [x, y] = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
        const top = topAt(x, y);
        if (!top) { unseen = true; continue; }
        checked++;
        const cover = covering(top, parent, x, y);
        if (cover) pinned ||= pinnedOf(cover.by) || outside(cover.by, scroller);
        if (cover) out.push({ text: v.trim().replace(/\s+/g, ' ').slice(0, 60), top: describe(cover.by) });
      }
      return { covered: out, checked, drawn, stopped, clipped };
    };
    const r = pass();
    // scroll: drawn text all covered by a fixed or sticky layer or one outside its scroller, or off-screen where it sits, is centred and read again, as a
    // user scrolls to read it, so a fixed bar it sits under is not its cover; shown text keeps the first read and the page where it is.
    if (late || !scroll || !r.drawn || r.covered.length < r.checked || (r.covered.length && !pinned && !unseen)) return r; // a cover that scrolls with the text is not cleared by scrolling
    // The read leaves the page where it found it: every scrolled ancestor and the window go back after the pass, and
    // so does each parent document the scroll reached when el sits in an iframe.
    const saved = [];
    const keep = (from) => { for (let n = from; n; n = up(n)) if (n.nodeType === 1 && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth)) saved.push([n, n.scrollLeft, n.scrollTop]); };
    keep(el);
    const parents = [];
    try { for (let w = window; w.frameElement; w = w.parent) { keep(w.frameElement); parents.push([w.parent, w.parent.scrollX, w.parent.scrollY]); } } catch { /* a cross-origin parent is not reached by el's scroll either */ }
    const [sx, sy] = [scrollX, scrollY];
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    // Only boxes a user can scroll stay scrolled: an overflow:hidden one (a carousel stage) goes back before the pass.
    for (const [n, left, top] of saved) if (n !== document.documentElement && n !== document.body && !['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) { n.scrollLeft = left; n.scrollTop = top; }
    // One frame on, so a script that docks or undocks a header on scroll has run; the timer is for a hidden page.
    return new Promise((done, fail) => {
      let ran = false;
      const go = () => {
        if (ran) return;
        ran = true;
        try { done(pass()); } catch (e) { fail(e); } finally { // a throw rejects now, and the page goes back either way
          for (const [n, left, top] of saved) { n.scrollLeft = left; n.scrollTop = top; }
          scrollTo({ left: sx, top: sy, behavior: 'instant' });
          for (const [w, x, y] of parents) w.scrollTo({ left: x, top: y, behavior: 'instant' });
        }
      };
      requestAnimationFrame(go);
      setTimeout(go, 100);
    });
  });

  const r = el.getBoundingClientRect();
  const box0 = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
  const own = getComputedStyle(el).position;
  const { box, by: clippedBy } = clipFrom(up(el), box0, ['absolute', 'fixed'].includes(own) ? own : null);

  const at = [['centre', 0.5, 0.5], ['topLeft', 0.2, 0.2], ['topRight', 0.8, 0.2], ['bottomLeft', 0.2, 0.8], ['bottomRight', 0.8, 0.8]];
  const points = !hit ? null : at.map(([name, fx, fy]) => {
    const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
    const hit = topAt(x, y);
    const onTarget = !!hit && isTarget(hit);
    return { at: name, x: Math.round(x), y: Math.round(y), onTarget, ...(onTarget ? {} : { top: hit ? describe(hit) : null }) };
  });
  const size = r.width * r.height;
  const visible = size ? Math.round((area(box) / size) * 100) / 100 : 0;
  if (!hit) {
    const px = (v) => Math.round(v * 10) / 10;
    const c = getComputedStyle(el);
    return {
      ...describe(el),
      rect: { x: px(r.left), y: px(r.top), width: px(r.width), height: px(r.height), right: px(r.right), bottom: px(r.bottom) },
      visible, clippedBy,
      overflow: { x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight },
      styles: Object.fromEntries(styles.map((p) => [p, c.getPropertyValue(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))])),
      ...(withBox && { shown: box }),
      ...(textBox && { textLines: textLines(el).map((b) => ({ x: px(b.left), y: px(b.top), width: px(b.right - b.left), height: px(b.bottom - b.top), right: px(b.right), bottom: px(b.bottom), ...(b.clipped && { clipped: true }) })) }),
    };
  }
  return {
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    visible,
    clippedBy,
    points,
  };
}

// The target is the element with that role and name (or text) in the scope, or the scope itself (a component
// host, a modal). An empty name is a name: it picks an unnamed icon button.
async function onTop(scope, { name, role = 'button', text, row, column, nth, timeout = 10_000 } = {}) {
  const named = name != null || text != null;
  if (!named && !scope.ariaSnapshot) throw new SfUiError('BAD_ARGS', 'name an element, or give a component or modal as the target');
  const target = named ? await resolve(scope, { name, role, text, row, column, nth, timeout, includeHidden: true }) : scope;
  // visible and box are the page as the user sees it now; only the hit test runs at the scrolled position.
  const now = await target.evaluate(read);
  // An element past the viewport edge is scrolled to the centre for the hit test, as a user scrolls to it, then put back.
  const moved = await target.evaluateHandle((el) => {
    const r = el.getBoundingClientRect();
    if (r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth) return null;
    const saved = [];
    for (let n = el.parentNode || el.host; n; n = n.parentNode || n.host) if (n.nodeType === 1) saved.push([n, n.scrollLeft, n.scrollTop]);
    const [sx, sy] = [scrollX, scrollY];
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); // a smooth-scrolling page would read mid-way
    const n = el.getBoundingClientRect();
    return { scrolled: { x: Math.round(r.left - n.left), y: Math.round(r.top - n.top) },
      back: () => { for (const [e, left, top] of saved) e.scrollTo({ left, top, behavior: 'instant' }); scrollTo({ left: sx, top: sy, behavior: 'instant' }); } };
  });
  let scrolled;
  let out = now;
  try {
    scrolled = await moved.evaluate((m) => m && m.scrolled);
    if (scrolled) out = await target.evaluate(read);
  } finally {
    await moved.evaluate((m) => m && m.back()).finally(() => moved.dispose());
  }
  const modalOpen = (await target.page().getByRole('dialog').locator('visible=true').count()) > 0;
  return { onTop: out.points.every((p) => p.onTarget), modalOpen, ...now, points: out.points, ...(scrolled && { scrolled }) };
}

// Layout readings in CSS px: one element aimed as onTop aims, every match of a CSS selector (Playwright's CSS
// crosses open shadow roots), or the scope itself. count, rendered and inView make every sweep carry its denominator.
const MAX_MEASURED = 50;
// The one visible iframe a selector matches in the scope, waited for as the page loads it; also what the scoped tools use.
async function oneFrame(scope, frame, timeout) {
  const frames = scope.locator(frame).locator('visible=true');
  await frames.first().waitFor({ timeout }).catch(() => {});
  const n = await frames.count();
  if (n !== 1) {
    const matches = await frames.evaluateAll((fs) => fs.slice(0, 5).map((f) => {
      const r = f.getBoundingClientRect();
      return { title: f.title, name: f.name, x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }));
    throw new SfUiError(n ? 'AMBIGUOUS' : 'NOT_FOUND', `${n} visible iframes match ${frame}; one off-screen still counts, so narrow by title`, { frame, count: n, matches });
  }
  return frames.first();
}

// frame: a CSS selector for the one visible iframe in the scope (a Visualforce page); the aim and selector then work
// inside it, and rects are mapped to page px through its position, border, padding and scale. visible and inView are
// also cut by where the iframe shows on the page. ponytail: one frame deep, that cut uses the iframe's border box,
// and a rotated or skewed iframe reads as scaled (its bounding box is not its shape).
async function measure(scope, { frame, ...opts } = {}) {
  if (!frame) return measureIn(scope, opts);
  const iframe = await oneFrame(scope, frame, opts.timeout ?? 10_000);
  const [map, own] = await Promise.all([iframe.evaluate((f) => {
    const r = f.getBoundingClientRect();
    const c = getComputedStyle(f);
    const [sx, sy] = [r.width / f.offsetWidth || 1, r.height / f.offsetHeight || 1]; // a CSS transform on it or above
    return { x: r.left + (f.clientLeft + parseFloat(c.paddingLeft)) * sx, y: r.top + (f.clientTop + parseFloat(c.paddingTop)) * sy, sx, sy };
  }), iframe.evaluate(read, { hit: false, withBox: true })]);
  const out = await measureIn(iframe.contentFrame().locator('body'), { ...opts, withBox: true });
  const px = (v) => Math.round(v * 10) / 10;
  const [X, Y] = [(v) => map.x + v * map.sx, (v) => map.y + v * map.sy];
  const shift = (b) => ({ ...b, x: px(X(b.x)), y: px(Y(b.y)), width: px(b.width * map.sx), height: px(b.height * map.sy), right: px(X(b.right)), bottom: px(Y(b.bottom)) });
  const S = own.shown;
  for (const e of out.elements) {
    const rect = shift(e.rect);
    const area = rect.width * rect.height;
    // What shows inside the frame, in page px, then cut by where the iframe shows.
    const k = e.shown;
    const inside = Math.max(0, Math.min(X(k.right), S.right) - Math.max(X(k.left), S.left)) * Math.max(0, Math.min(Y(k.bottom), S.bottom) - Math.max(Y(k.top), S.top));
    const share = area ? Math.round((inside / area) * 100) / 100 : 0;
    delete e.shown;
    // A line past the iframe's on-screen box is cut to it and marked clipped, as an overflow ancestor would.
    const cut = (l) => {
      const c = { ...l, x: Math.max(l.x, px(S.left)), right: Math.min(l.right, px(S.right)), y: Math.max(l.y, px(S.top)), bottom: Math.min(l.bottom, px(S.bottom)) };
      if (c.right <= c.x || c.bottom <= c.y) return null;
      const sideways = c.x > l.x + 0.5 || c.right < l.right - 0.5;
      return { ...c, width: px(c.right - c.x), height: px(c.bottom - c.y), ...((l.clipped || sideways) && { clipped: true }) };
    };
    Object.assign(e, { rect }, e.textLines && { textLines: e.textLines.map(shift).map(cut).filter(Boolean) });
    if (share < e.visible) Object.assign(e, { visible: share, clippedBy: e.clippedBy || own.clippedBy || { tag: 'iframe', label: own.label, hosts: own.hosts } });
  }
  out.inView = out.elements.filter((e) => e.visible > 0).length;
  return { ...out, frame: { selector: frame, x: px(map.x), y: px(map.y), ...(map.sx !== 1 && { scale: px(map.sx) }) } };
}

async function measureIn(scope, { name, role = 'button', text, row, column, nth, selector, styles = [], textBox = false, withBox = false, timeout = 10_000 } = {}) {
  const named = name != null || text != null;
  if (named && selector) throw new SfUiError('BAD_ARGS', 'aim by name or text, or by selector, not both');
  if (!named && !selector && !scope.ariaSnapshot) throw new SfUiError('BAD_ARGS', 'name an element, give a selector, or give a component or modal as the target');
  let els;
  let count = 1;
  if (selector) {
    const all = scope.locator(selector);
    await all.first().waitFor({ state: 'attached', timeout }).catch(() => {}); // none after the wait is a count of 0
    count = await all.count();
    els = Array.from({ length: Math.min(count, MAX_MEASURED) }, (_, i) => all.nth(i));
  } else {
    els = [named ? await resolve(scope, { name, role, text, row, column, nth, timeout, includeHidden: true }) : scope];
  }
  const elements = [];
  for (const el of els) elements.push(await el.evaluate(read, { hit: false, styles, textBox, withBox }));
  const page = scope.page ? scope.page() : scope;
  return {
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    count,
    rendered: elements.filter((e) => e.rect.width > 0 && e.rect.height > 0).length,
    inView: elements.filter((e) => e.visible > 0).length,
    ...(count > elements.length && { measured: elements.length }),
    elements,
  };
}

module.exports = { onTop, measure, oneFrame, read };
