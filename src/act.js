'use strict';

// Act by role and accessible name inside a scope (component host, modal, page), optionally inside the one
// table row containing some text. A miss or a tie throws with what was there, so the agent can re-aim.
// ponytail: rows are ARIA rows (tables, grids); a list of cards with no row role is scoped by component instead.
const { SfUiError, AT } = require('./errors');

// A page is read from its one main landmark (the app shell's header and nav otherwise fill the snapshot first);
// an open modal hides main, so the body then shows the modal. ponytail: menus or toasts outside main are left out.
async function mainOf(page) {
  const main = page.getByRole('main');
  return (await main.count()) === 1 ? main : page.locator('body');
}
// A cut snapshot says so: on a large page the target often sits past the cut.
const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}\n[cut at ${max} of ${text.length} characters]` : text);
// A page or frame that closed, navigated or detached mid-read: what was read stands; any other error is a bug and surfaces.
const lost = (e) => /context was destroyed|been closed|Target closed|detached/i.test(e?.message);
// The page-side reader, loaded on first use. ponytail: lazy, layer.js requires this file.
const layerRead = () => require('./layer').read;
// Text the aria snapshot lists that another layer paints over, one line each, after the cut. A failure or a pass past
// 2 s adds a line saying the check did not run, so no covered line never reads as nothing covered.
async function marked(loc, text) {
  if (!text) return text; // no snapshot was read, so there is nothing a covered line could qualify
  // evaluate's own timeout bounds only finding loc, so the 2 s is a race; a pass that loses settles unobserved.
  // Only the page read is caught: a bug in reading its answer below surfaces, not as a page condition.
  let read;
  try {
    const pass = loc.evaluate(layerRead(), { covered: true });
    pass.catch(() => {});
    read = await Promise.race([pass, new Promise((_, no) => { setTimeout(no, 2_000, new Error('ran past 2 s')).unref(); })]);
  } catch (e) {
    return `${text}\n- covered check not run: ${String(e?.message || e).split('\n')[0].slice(0, 200)}`;
  }
  const { covered, stopped } = read;
  const lines = covered.slice(0, 10).map((c) => `- covered: "${c.text}" under ${c.top.tag}${c.top.label ? ` ${c.top.label}` : ''}`);
  if (covered.length > 10) lines.push(`- and ${covered.length - 10} more covered`);
  if (stopped) lines.push('- covered check stopped at 100 texts');
  return lines.length ? `${text}\n${lines.join('\n')}` : text;
}
const snapshot = async (loc, max = 3000) => {
  const at = loc.ariaSnapshot ? loc : await mainOf(loc);
  return marked(at, cut(await at.ariaSnapshot({ timeout: 5_000 }).catch(() => ''), max));
};

// On a miss, what the asked words do match (longest word first, five at most) and the custom components each sits
// in, so a wrong name or a cut snapshot still leads to the right name and lwcApiName.
let marks = 0;

async function near(asked, find) {
  const words = [...new Set(`${asked ?? ''}`.toLowerCase().split(/\W+/).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length);
  const out = [];
  const call = `n${(marks += 1)}:`;
  const end = Date.now() + 3_000; // the whole search, however many stale matches it skips (one element's two 1 s reads may overrun it by up to about 2 s)
  try {
    for (const w of words) {
      for (const el of await find(new RegExp(w, 'i')).all()) {
        if (out.length >= 5 || Date.now() >= end) return out;
        // A match gone since the list (a re-render) is skipped in 1 s; the mark reads the name from the same node,
        // and a node this call already marked (another asked word matched it) is skipped.
        const id = `${call}${out.length}`;
        const read = await el.evaluate((n, [c, m]) => {
          if (n.getAttribute('data-sf-ui-near')?.startsWith(c)) return null;
          n.setAttribute('data-sf-ui-near', m);
          const tags = [];
          for (let r = n.getRootNode(); r.host && tags.length < 3; r = r.host.getRootNode()) if (!r.host.localName.startsWith('lightning-')) tags.push(r.host.localName);
          const label = n.getAttribute('aria-label') || n.getAttribute('title') || n.innerText || n.textContent || '';
          return { tags, label: label.replace(/\s+/g, ' ').trim().slice(0, 120) };
        }, [call, id], { timeout: 1_000 }).catch(() => null);
        if (!read) continue;
        // The snapshot leaves out an aria-hidden area (the page behind a modal), so its name is then the node's label.
        const name = (await el.page().locator(`[data-sf-ui-near="${id}"]`).ariaSnapshot({ timeout: 1_000 }).catch(() => '')).split('\n')[0].replace(/^- /, '').slice(0, 120);
        out.push({ name: name || read.label, hosts: read.tags });
      }
    }
  } catch (e) {
    if (!lost(e)) throw e;
  }
  return out;
}

// The one element with that role and name (or, for an element with no role, that exact text), in the row and the
// cell under the column header when named. includeHidden also reaches what an open modal hides, if it renders.
async function resolve(scope, { name, role, text, row, column, nth, timeout, includeHidden = false }) {
  // In a row, a role alone is that row's one such element: a list view names its checkbox by position ("Select Item 2").
  if (name == null && text == null && !row) throw new SfUiError('BAD_ARGS', 'give a name ("" for an unnamed icon button), a text, or a row for a role alone');
  const byRole = (at, r, opts) => (includeHidden ? at.getByRole(r, { ...opts, includeHidden }).locator('visible=true') : at.getByRole(r, opts));
  let within = scope;
  if (row) {
    const rows = byRole(scope, 'row').filter({ hasText: row });
    await rows.first().waitFor({ timeout }).catch(() => {});
    const count = await rows.count();
    if (count !== 1) {
      const texts = (await rows.allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim().slice(0, 120));
      const of = await byRole(scope, 'row').count(); // 0 of 0 is no table yet, 0 of 40 a wrong text
      throw new SfUiError(count ? 'AMBIGUOUS_ROW' : 'ROW_NOT_FOUND', `${count} of ${of} rows contain "${row}"`, { row, rows: texts,
        ...(!count && { near: await near(row, (re) => byRole(scope, 'row').filter({ hasText: re })), snapshot: await snapshot(scope) }) });
    }
    within = rows;
  }
  if (column) {
    const header = await resolve(scope, { name: column, role: 'columnheader', timeout, includeHidden });
    const at = await header.evaluate((th) => [...th.parentElement.children].indexOf(th) + 1);
    within = (row ? within : byRole(scope, 'row')).locator(`:scope > :nth-child(${at})`);
  }
  const all = text ? within.getByText(text, { exact: true }).locator('visible=true') : byRole(within, role, { name, exact: true });
  await all.first().waitFor({ timeout }).catch(() => {});
  const count = await all.count();
  if (nth ? count < nth : count !== 1) {
    const what = text ? `elements with text "${text}"` : `${role}s${name == null ? '' : ` named "${name}"`}`;
    const where = `${row ? ` in the row with "${row}"` : ''}${column ? ` under "${column}"` : ''}`;
    const like = !count && (await near(text ?? name, (re) => (text ? within.getByText(re).locator('visible=true') : byRole(within, role, { name: re }))));
    // A column with no row is one cell per row, which ariaSnapshot refuses, so the snapshot is then the scope's.
    // An nth past the matches is not there: NOT_FOUND, even when some match.
    throw new SfUiError(count && !nth ? 'AMBIGUOUS' : 'NOT_FOUND', `${count} ${what}${where}${count && nth ? `, so no number ${nth}` : ''}`, { role, name: name instanceof RegExp ? String(name) : name, text, row, column, nth, count, ...(like && { near: like }), snapshot: await snapshot(row ? within : scope) });
  }
  // nth (1-based, page order) picks one of several same-named elements that no table row tells apart.
  const target = nth ? all.nth(nth - 1) : all;
  // Visually hidden text (an icon's alternative text) stands for its composed parent, and a hidden input (an SLDS radio
  // or checkbox) for its label: each shows and takes clicks. xpath cannot cross a shadow root, so mark and find by CSS.
  const mark = `${(marks += 1)}`;
  const hidden = await target.evaluate((el, [m, byText]) => {
    if (el.getBoundingClientRect().width > 1) return false;
    const shown = byText ? el.parentElement || el.getRootNode().host : [...(el.labels || [])].find((l) => l.getBoundingClientRect().width > 1);
    shown?.setAttribute('data-sf-ui-for', m);
    return !!shown;
  }, [mark, !!text]);
  if (!hidden) return target;
  // Found in the target's own frame: page.locator searches only the main one, so a mark in an iframe matched nothing.
  const handle = await target.elementHandle();
  const frame = await handle.ownerFrame();
  await handle.dispose();
  return frame.locator(`[data-sf-ui-for="${mark}"]`);
}

// Every document gets a force:showToast listener before Aura loads, sending each toast to a list in Node, so a reload
// cannot drop one. Arming clears it: each action and page open (server.js ARMS), and again here once a target is found.
const lists = new WeakMap(); // context -> its session's toasts
async function recordToasts(context) {
  lists.set(context, []);
  await context.exposeFunction('__sfUiToast', (t) => lists.get(context).push(t));
  await context.addInitScript(() => window.addEventListener('force:showToast', (e) => {
    const d = (e.getParams && e.getParams()) || (e.detail && (e.detail.data || e.detail)) || {};
    const data = d.messageTemplateData || [];
    const fill = (t) => (t || '').replace(/\{(\d+)\}/g, (_, i) => { const v = data[i]; return v && typeof v === 'object' ? v.label : v; });
    window.__sfUiToast({ type: d.type, title: d.title, message: d.messageTemplate ? fill(d.messageTemplate) : d.message });
  }, true));
  return lists.get(context);
}
const armToasts = async (page) => { lists.get(page.context())?.splice(0); };
const raised = (page) => [...(lists.get(page.context()) || [])];

// Waits up to timeout for the toasts recorded since the last action or page open, and returns them.
async function toasts(page, { timeout = 5_000 } = {}) {
  const end = Date.now() + timeout;
  while (!raised(page).length && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return raised(page);
}

async function click(scope, { name, role = 'button', text, row, column, nth, download = false, timeout = 10_000 } = {}) {
  const target = await resolve(scope, { name, role, text, row, column, nth, timeout });
  await armToasts(target.page());
  // A press the element took but a release it never saw fires no click on it: the page moved it mid-click.
  // The click scrolls the element into view first, so the box is read after that scroll, not before it. A re-render
  // (a Path after a save) can replace it while the scroll waits for it to stop moving: then it is found again, once.
  let el;
  for (let tries = 1; ; tries += 1) {
    el = await target.elementHandle({ timeout });
    const err = await el.scrollIntoViewIfNeeded({ timeout }).then(() => null, (e) => e);
    if (!err) break;
    if (tries > 1 || !/not attached/i.test(err.message)) throw err;
  }
  const before = await el.evaluate((e) => {
    e.__sfUiClicked = false;
    e.__sfUiReleased = false; // a release the element saw: a handler that stops the click is no miss
    e.addEventListener('click', () => { e.__sfUiClicked = true; }, { once: true, capture: true });
    e.addEventListener('mouseup', () => { e.__sfUiReleased = true; }, { once: true, capture: true });
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const downloading = download && downloadFrom(target.page(), timeout);
  await target.click({ timeout });
  const saved = download && (await savedDownload(await downloading, { name, text }));
  // A navigation or a re-render that replaced the element leaves nothing to judge, so it is no miss.
  const after = await el.evaluate((e) => {
    if (!e.isConnected) return null;
    const r = e.getBoundingClientRect();
    // What sits on its centre now, if not itself: the layer to blame for a miss (through shadow hosts).
    let over = e.getRootNode().elementFromPoint?.(r.x + r.width / 2, r.y + r.height / 2);
    for (let n = over; n; n = n.parentNode || n.host) if (n === e) over = null;
    return { clicked: e.__sfUiClicked, released: e.__sfUiReleased, disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
      over: over && { tag: over.localName, ...(over.id && { id: over.id }) }, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).catch(() => null);
  if (after && !after.clicked && (after.box.x !== before.x || after.box.y !== before.y)) {
    const dy = Math.round(after.box.y - before.y);
    throw new SfUiError('TARGET_MOVED', `"${name ?? text}" moved during the click (${Math.abs(dy)} px ${dy < 0 ? 'up' : 'down'}), so the release missed it and no click reached it: a layout shift, such as a validation line opening or closing when the click took focus from a field`, { role, name, text, before, after: after.box });
  }
  // It did not move, but the release missed it: the press disabled it, or opened a layer over it.
  if (after && !after.clicked && !after.released) {
    const why = after.disabled ? 'it was disabled by then (a handler the press ran, such as a blur, disabled it)' : after.over ? `a layer the press opened over it (${after.over.tag})` : 'nothing over it now names the cause';
    throw new SfUiError('CLICK_MISSED', `"${name ?? text}" took the press, but the release did not reach it, so no click did: ${why}`, { role, name, text, box: before, disabled: after.disabled, ...(after.over && { over: after.over }) });
  }
  const clicked = new Date().toISOString();
  const opened = after && (await openedBy(el, target.page()));
  return { ...(opened && { opened }), ...(saved && { download: saved }), [AT]: { clicked } };
}

// The first download from the page or from a tab the click opens (a Salesforce file preview downloads in a new tab).
function downloadFrom(page, timeout) {
  const fromTab = page.context().waitForEvent('page', { timeout }).then((tab) => tab.waitForEvent('download', { timeout }).then((d) => Object.assign(d, { tab })));
  return Promise.any([page.waitForEvent('download', { timeout }), fromTab]).catch(() => null);
}

// The file a click started downloading, saved under the system temp folder: its name, path and size.
async function savedDownload(d, { name, text }) {
  if (!d) throw new SfUiError('NO_DOWNLOAD', `"${name ?? text}" started no download`, { name, text });
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sf-ui-download-')), d.suggestedFilename());
  await d.saveAs(file);
  if (d.tab) await d.tab.close().catch(() => {}); // the tab the download opened is left with nothing to show
  return { name: d.suggestedFilename(), path: file, bytes: fs.statSync(file).size };
}

// The popup an expanded control names in aria-controls (a menu, a listbox), which may render outside main and the
// dialog, so no snapshot shows it; its own snapshot, once it shows (up to 2 s).
async function openedBy(el, page) {
  const mark = `o${(marks += 1)}`;
  const found = await el.evaluate((e, m) => {
    const id = e.getAttribute('aria-expanded') === 'true' && e.getAttribute('aria-controls');
    const pop = id && ((e.getRootNode().getElementById && e.getRootNode().getElementById(id)) || document.getElementById(id));
    pop?.setAttribute('data-sf-ui-opened', m);
    return !!pop;
  }, mark).catch(() => false);
  if (!found) return undefined;
  const pop = page.locator(`[data-sf-ui-opened="${mark}"]`);
  await pop.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  return (await pop.isVisible()) ? cut(await pop.ariaSnapshot({ timeout: 2_000 }).catch(() => ''), 1500) : undefined;
}

// Puts the mouse over the element, so a tooltip opens or a hover style applies, and with focus also focuses it (a
// focus ring). The state holds until another tool moves the mouse or the focus. Focus already elsewhere stays,
// as it would for a user; blurring it would fire blur handlers (an inline edit saving) a real hover never fires.
async function hover(scope, { name, role = 'button', text, row, column, nth, focus = false, timeout = 10_000 } = {}) {
  const target = await resolve(scope, { name, role, text, row, column, nth, timeout });
  await target.hover({ timeout });
  if (focus) {
    await target.focus({ timeout });
    // :focus-within reads the real tree, so it holds under synthetic shadow too. A label standing in for a hidden input
    // passes focus to its control, so the control is what must hold it.
    const landed = await target.evaluate((el) => ((el.localName === 'label' && el.control) || el).matches(':focus-within') || (document.activeElement || document.body).localName);
    if (landed !== true) throw new SfUiError('NOT_FOCUSABLE', `the element took no focus (focus is on ${landed}); aim at the button or link that holds it`, { role, name, text, focusedTag: landed });
    await target.page().keyboard.press('Shift'); // keyboard modality, so a :focus-visible ring draws after a click
  }
  return { [AT]: { hovered: new Date().toISOString() } };
}

// A key (Tab, Enter, Escape, Shift+Tab) on whatever has focus: leaves a box that reads its value on change, confirms,
// or closes a dropdown. It starts a new toast window, as a click does, so a save by Enter reads only its own.
async function press(page, { key }) {
  await armToasts(page);
  await page.keyboard.press(key).catch((e) => {
    throw /Unknown key/.test(e.message) ? new SfUiError('BAD_ARGS', `unknown key "${key}"; use names like Tab, Enter, Escape, ArrowDown, Shift+Tab`, { key }) : e;
  });
  return { [AT]: { pressed: new Date().toISOString() } };
}

// Replaces the box's text the way typing would, firing the input and change events components listen to.
async function fill(scope, { name, value, role = 'textbox', row, column, nth, timeout = 10_000 } = {}) {
  const box = await resolve(scope, { name, role, row, column, nth, timeout }).catch(async (e) => {
    // lightning-input-rich-text renders its textbox only once the area under its toolbar is clicked. It ignores row and
    // column and adds one textbox, so only a plain miss opens it; with an nth past 1 something already matched.
    if (e.code !== 'NOT_FOUND' || role !== 'textbox' || row || column || (nth ?? 1) > 1) throw e;
    const group = scope.getByRole('group', { name, exact: true });
    const toolbar = group.getByRole('toolbar').first();
    if ((await group.count()) !== 1 || !(await toolbar.count())) throw e;
    await group.scrollIntoViewIfNeeded({ timeout });
    const [g, bar] = [await group.boundingBox(), await toolbar.boundingBox()];
    await group.click({ position: { x: 20, y: bar.y + bar.height - g.y + 15 }, timeout });
    return resolve(scope, { name, role, row, column, nth, timeout });
  });
  // A native select (an Aura dialog, a Visualforce page) takes an option by its label, not typing.
  const kind = await box.evaluate((e) => (e.localName === 'select' ? 'select' : e.type), null, { timeout });
  if (kind === 'select') {
    const options = await box.locator('option').allInnerTexts();
    if (!options.map((o) => o.trim()).includes(String(value))) throw new SfUiError('VALUE_NOT_FOUND', `${name} offers no "${value}"`, { name, value, options: options.map((o) => o.trim()) });
    await box.selectOption({ label: String(value) }, { timeout });
  } else {
    // A searchable combobox (record picker, lookup) lists its matches only once pressed, as a user does before typing.
    if (role === 'combobox') await box.click({ timeout });
    await replaceText(box, String(value ?? ''), { timeout });
  }
  const [got, rich] = await boxValue(box);
  readBack(String(value ?? ''), got, { rich, label: name ?? role, name, value });
  if (kind !== 'select' && String(value ?? '') !== '') await parsed(box, String(value), { label: name ?? role, name, value, timeout });
}

// A Lightning date, time or number box parses its text only once focus leaves it, then may drop it with the text
// still shown: such a box is left (a blur), and a component that then holds no value is VALUE_NOT_SET.
async function parsed(box, want, { label, timeout, ...evidence }) {
  const out = await box.evaluate(async (e) => {
    let host;
    for (let n = e; n && !host; n = n.parentNode || n.host) {
      if (['lightning-datepicker', 'lightning-timepicker'].includes(n.localName) || (n.localName === 'lightning-input' && n.type === 'number')) host = n;
    }
    if (!host) return null;
    e.blur();
    for (const end = Date.now() + 1_000; (host.value ?? '') === '' && Date.now() < end;) await new Promise((r) => setTimeout(r, 50));
    const root = e.getRootNode();
    const help = (e.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => id && root.querySelector(`#${CSS.escape(id)}`)?.innerText?.trim()).filter(Boolean).join(' ');
    return { kept: host.value ?? '', got: e.value, help };
  }, null, { timeout });
  if (out && out.kept === '') {
    throw new SfUiError('VALUE_NOT_SET', `${label} holds no value once left: the component did not take "${want}"${out.help ? ` (${out.help})` : ''}`, { ...evidence, want, got: out.got, help: out.help || undefined });
  }
}

// Select what the box holds, then fill: a box that rewrites on focus ("10%" to "10") is selected after the rewrite, and
// the old value stays until the typed one replaces it (no empty value, which a slider or colour box refuses).
async function replaceText(box, value, { timeout } = {}) {
  await box.selectText({ timeout });
  await box.fill(value, { timeout });
}

// What a box holds now: a select's chosen label, an input's value, or a rich text editor's text (rich).
const boxValue = (box) => box.evaluate((e) => (e.localName === 'select' ? [e.selectedOptions[0]?.label ?? '', false]
  : ['input', 'textarea'].includes(e.localName) ? [e.value, false] : [e.innerText, true]));

// Read back before a blur formats it: a cut (maxlength) or refused value is VALUE_NOT_SET. A rich text editor's
// paragraphs read as blank lines, so its whitespace is compared as one space; CRLF is LF everywhere.
function readBack(want, got, { rich = false, label, ...evidence } = {}) {
  const as = (x) => (rich ? x.replace(/\s+/g, ' ').trim() : x.replace(/\r\n?/g, '\n'));
  if (as(got) !== as(want)) throw new SfUiError('VALUE_NOT_SET', `${label} holds "${got}", not "${want}"`, { ...evidence, want, got });
}

// Waits for text to show (or, with gone, to leave) inside the scope: a spinner's label, a status line, a result.
// With any, for the first of several (a text, or a toast raised since the last action or page open), and says which.
async function waitFor(scope, { text, gone = false, any, timeout = 30_000 } = {}) {
  const conds = any || [{ text, gone }];
  if ((any && (text != null || gone)) || !conds.length || conds.some((c) => (c.text == null) === (c.toast == null))) {
    throw new SfUiError('BAD_ARGS', 'give text or any (gone goes inside each any condition), and each condition a text or a toast, not both', { text, gone, any });
  }
  if (conds.some((c) => c.toast != null && c.gone)) throw new SfUiError('BAD_ARGS', 'gone is for text, not a toast', { any });
  const page = typeof scope.page === 'function' ? scope.page() : scope;
  const norm = (x) => (x || '').replace(/\s+/g, ' ').trim().toLowerCase(); // as getByText matches a text
  // gone = no visible match left, not just the first. Polled 100 ms apart; a count mid-navigation reads 0, a closed page throws.
  // A text in the DOM but covered does not hold; covers keeps what covered it as of the last poll.
  const covers = new Map(); // condition index -> covered list
  const seenOnce = new Set(); // gone conditions with an uncollapsed visible match on some poll: a gone without one says neverSeen
  const unread = new Set(); // text conditions in the DOM whose cover no read reached on the last poll, none seen before
  const end = Date.now() + timeout; // before holds, which reads it for the time left
  // One copy's cover read within the time left; null when it lost the race or a navigation took it.
  const readCopy = async (shown, i, scroll) => {
    const left = Math.max(250, end - Date.now());
    let timer;
    // The in-page wait for an earlier read is half the race, so the read itself still runs inside it.
    const reading = shown.nth(i).evaluate(layerRead(), { covered: true, scroll, budget: Math.min(1_000, left) / 2 }, { timeout: Math.min(1_000, left) });
    reading.catch(() => {}); // a read that loses the race settles unobserved
    return Promise.race([reading, new Promise((ok) => { timer = setTimeout(ok, left, null); })])
      .catch((e) => { if (e?.name !== 'TimeoutError' && !lost(e)) throw e; return null; }).finally(() => clearTimeout(timer));
  };
  const collapsed = (r) => !!r && !r.checked && r.clipped; // cut to nothing by a collapsed box (height or width 0)
  // The document a count ran in, read before and after it: a 0 read while a navigation swapped it is not a 0.
  const docOf = () => page.evaluate(() => (window.__sfUiDoc ??= Math.random())).catch(() => null);
  const holds = async (c, index) => {
    if (c.toast != null) return raised(page).some((t) => [t.title, t.message].some((x) => norm(x).includes(norm(c.toast))));
    const shown = scope.getByText(c.text).locator('visible=true');
    const doc = c.gone && (await docOf());
    const n = await shown.count();
    unread.delete(index);
    if (n === 0) { covers.delete(index); return !!c.gone && doc !== null && doc === (await docOf()); }
    if (c.gone) { // gone once every copy is collapsed, as shown reads them; a lost read or an 11th copy is still there
      covers.delete(index);
      let [i, r] = [0, null];
      while (i < Math.min(n, 10) && collapsed((r = await readCopy(shown, i, false)))) i++;
      if (i < Math.min(n, 10) && r) seenOnce.add(index); // a stop at a painted copy; a lost read or an unread 11th is none
      return i >= n;
    }
    // Up to 10 copies, stopping at the first painted (ponytail: an 11th behind ten covered ones reads covered). A read past the
    // time left, a gone match or one lost to a navigation is skipped; a poll that read none keeps the last covers, or marks it unread.
    let list = [];
    let cut = false; // copies left unread at the deadline: the covers so far do not speak for them
    let [clipped, missed] = [false, false]; // missed: a read lost its race, so a clipped copy does not speak for it
    for (let i = 0; i < Math.min(n, 10); i++) {
      if (i && Date.now() >= end) { cut = true; break; } // the first copy is always read; no later one past the deadline
      const r = await readCopy(shown, i, true);
      if (!r) { missed = true; continue; }
      if (collapsed(r)) { clipped = true; continue; } // not shown
      if (r.covered.length < r.checked || !r.checked) { covers.delete(index); return true; }
      list = list.concat(r.covered);
    }
    if (cut) { if (!covers.has(index)) unread.add(index); } // an earlier complete poll's covers stand
    else if (list.length) covers.set(index, list);
    else if (clipped && !missed) covers.delete(index);
    else if (!covers.has(index)) unread.add(index);
    return false;
  };
  // A document swap reads as gone for a moment, so gone holds only on two polls in a row, seen at the first.
  // Every condition is checked each poll; the first to hold wins, and on the same poll the lower index.
  const first = new Map(); // gone condition's index -> { seen, poll } of its first zero
  const done = (h) => ({ ...(any ? { matched: { index: h.index, ...h.c }, toasts: raised(page) } : {}), ...(h.c.gone && !seenOnce.has(h.index) && { neverSeen: true }), [AT]: { seen: h.seen } });
  let held = null; // the winner of the last poll, kept one poll while a lower-index gone on that poll confirms
  let late = false;
  for (let poll = 0; ; poll++) {
    const hits = held ? [held] : [];
    let pendingBelow = Infinity; // lowest index of a gone whose first zero is this poll
    for (const [index, c] of conds.entries()) {
      if (!(await holds(c, index))) { first.delete(index); continue; }
      const now = new Date().toISOString();
      if (c.gone && !first.has(index)) { first.set(index, { seen: now, poll }); pendingBelow = Math.min(pendingBelow, index); continue; }
      hits.push({ index, c, ...(first.get(index) || { seen: now, poll }) });
    }
    const best = hits.sort((x, y) => x.poll - y.poll || x.index - y.index)[0];
    if (best && (best.poll < poll || pendingBelow > best.index)) return done(best);
    held = best || null;
    // One poll past the deadline at most: a gone seen once gets its second poll, but alternating gones cannot extend it.
    if (Date.now() >= end) { if (late || !first.size) break; late = true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (held) return done(held); // a hold on the extra deadline poll still held in time
  // A busy page can lose every read of a text's cover: the text in the DOM is shown, as before the check, and says so.
  const blind = Math.min(...unread);
  if (unread.size) return { ...done({ index: blind, c: conds[blind], seen: new Date().toISOString() }), coverUnchecked: true };
  if (covers.size) {
    const list = [...covers].map(([i, c]) => ({ index: i, text: conds[i].text, top: c[0].top }));
    const by = (t) => `${t.tag}${t.label ? ` (${t.label})` : ''}`;
    throw new SfUiError('TEXT_COVERED', list.map((c) => `"${c.text}" is on the page but covered by ${by(c.top)}`).join('; '), { reason: 'covered', covered: list, ...(any && { conditions: conds, toasts: raised(page) }), snapshot: await snapshot(scope) });
  }
  if (!any) throw new SfUiError('TIMEOUT', `"${text}" did not ${gone ? 'go' : 'show'} within ${timeout} ms`, { text, gone, timeout, snapshot: await snapshot(scope) });
  const what = conds.map((c) => (c.toast != null ? `a toast with "${c.toast}"` : `"${c.text}" to ${c.gone ? 'go' : 'show'}`));
  throw new SfUiError('TIMEOUT', `none of ${what.join(', ')} within ${timeout} ms`, { conditions: conds, timeout, toasts: raised(page), snapshot: await snapshot(scope) });
}

module.exports = { near, click, hover, press, fill, replaceText, boxValue, readBack, waitFor, toasts, armToasts, recordToasts, raised, mainOf, snapshot, marked, cut, resolve };
