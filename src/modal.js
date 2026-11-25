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
  // LightningAlert and LightningConfirm are role alertdialog (F-fixtures-4).
  const role = () => s.page.getByRole('dialog').or(s.page.getByRole('alertdialog'));
  const any = role().locator('visible=true');
  await any.last().waitFor({ state: 'visible', timeout: left() });
  const modal = s.page.locator('[aria-modal="true"]').and(role()).locator('visible=true');
  const dialog = (await modal.count()) ? modal.last() : any.last();
  // body, for a caller that reads the dialog at once: its frame and footer (Submit, Next) show before its body, so wait
  // for the body to hold text or a field and no empty group, returning it either way. Steps inside wait on their own.
  while (body && !(await dialog.evaluate(drawn, null, { timeout: left() }).catch((e) => { if (/has been closed/.test(e.message)) throw e; return false; })) && Date.now() < until) {
    await new Promise((ok) => { setTimeout(ok, 100); });
  }
  return dialog;
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
  await dialog.getByRole('button', { name: /^(Close|Cancel and close|Cancel)$/ }).first().click({ timeout });
  await handle.waitForElementState('hidden', { timeout });
}

module.exports = { find, open, close };
