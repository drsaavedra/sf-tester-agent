'use strict';

// Modals render at page level, outside the component that opened them (LightningModal goes into
// lightning-overlay-container), so always search from the page and take the newest visible dialog.

const { requireEnglish } = require('./session');

// A true modal (aria-modal) while one shows: an open utility panel or docked composer is a dialog too, and may sit
// after it in the page.
// One deadline for both waits; 0 is one short look (Playwright reads a 0 timeout as none, so it would wait for ever).
async function find(s, { timeout = 30_000, body = false } = {}) {
  const until = Date.now() + timeout;
  const left = () => Math.max(100, until - Date.now());
  // LightningAlert and LightningConfirm are role alertdialog (F-fixtures-4). includeHidden: a stacked panel on an Aura
  // template page sets aria-hidden on div.viewport, which holds the drawn dialogs too (F-fixtures-26).
  const role = (includeHidden = true) => s.page.getByRole('dialog', { includeHidden }).or(s.page.getByRole('alertdialog', { includeHidden }));
  const any = role().locator('visible=true');
  await any.last().waitFor({ state: 'visible', timeout: left() });
  // A shown dialog before one the page hid when a newer one opened over it: DOM order is not stacking order (R7).
  const modal = (hidden) => s.page.locator('[aria-modal="true"]').and(role(hidden)).locator('visible=true');
  let dialog = any.last();
  for (const l of [modal(false), modal(true), role(false).locator('visible=true')]) {
    if (!(await l.count())) continue;
    // Held by its place in `any`: a locator of shown dialogs loses it when the page hides it a moment later (R9).
    const at = await any.evaluateAll((els, h) => els.indexOf(h), await l.last().elementHandle({ timeout: left() }));
    if (at >= 0) dialog = any.nth(at);
    break;
  }
  // body, for a caller that reads the dialog at once: its frame and footer (Submit, Next) show before its body, so wait
  // for the body to hold text or a field and no empty group, returning it either way. Steps inside wait on their own.
  while (body && !(await dialog.evaluate(drawn, null, { timeout: left() }).catch((e) => { if (/has been closed/.test(e.message)) throw e; return false; })) && Date.now() < until) {
    await new Promise((ok) => { setTimeout(ok, 100); });
  }
  // Marks the dialog so act.resolve reaches inside it and read gives its text: its accessibility snapshot is empty.
  const by = await dialog.evaluate(hider, null, { timeout: left() });
  if (by) dialog.hiddenBy = by;
  return dialog;
}

// In the page: the nearest ancestor, across shadow roots, that hides d from assistive tech, as an opening tag.
function hider(d) {
  for (let e = d; e; e = e.parentElement || (e.getRootNode().host ?? null)) {
    if (e.getAttribute('aria-hidden') === 'true') return `<${e.tagName.toLowerCase()}${e.className ? ` class="${String(e.className).slice(0, 60)}"` : ''}>`;
  }
  return null;
}

// What sf_modal snapshot answers: the snapshot, or for a dialog the page hides from assistive tech, its text and the hider.
async function read(dialog, snapshot) {
  if (!dialog.hiddenBy) return { snapshot: await snapshot(dialog) };
  return { hiddenBy: dialog.hiddenBy, text: (await dialog.innerText()).slice(0, 6000) };
}

// In the page: a field or a button besides close or Cancel, as before, and every body (a quick action nests one) holds
// text or a field and no empty group: Change Owner draws an empty body, Change Record Type no radio (F-flow-28).
function drawn(d) {
  const seen = (e) => e.getClientRects().length > 0;
  const FIELD = 'input, textarea, select, [role="combobox"], [role="radio"], [role="checkbox"], iframe, button';
  const live = (e) => seen(e) && !(e.tagName === 'BUTTON' && /^\s*(Close|Cancel and close|Cancel)\s*$/.test(e.title || e.textContent));
  const filled = (b) => (Boolean(b.innerText.trim()) || [...b.querySelectorAll(FIELD)].some(seen))
    && ![...b.querySelectorAll('fieldset, [role="group"], [role="radiogroup"]')].some((g) => seen(g) && !g.querySelector(FIELD));
  return [...d.querySelectorAll(FIELD)].some(live) && [...d.querySelectorAll('.slds-modal__content')].filter(seen).every(filled);
}

// The newest dialog, or null when none shows within the wait: "is a dialog still open" answered without a TIMEOUT.
async function open(s, { timeout = 5_000, body = false } = {}) {
  return find(s, { timeout, body }).catch((e) => { if (e.name !== 'TimeoutError') throw e; return null; });
}

async function close(dialog, { timeout = 30_000 } = {}) {
  await requireEnglish({ page: dialog.page() });
  const handle = await dialog.elementHandle();
  await dialog.getByRole('button', { name: /^(Close|Cancel and close|Cancel)$/, includeHidden: Boolean(dialog.hiddenBy) }).first().click({ timeout });
  await handle.waitForElementState('hidden', { timeout });
}

module.exports = { find, open, close, read };
