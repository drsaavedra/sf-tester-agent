'use strict';

// Record page actions (Edit, Delete, quick actions) as the highlights panel offers them: the first few as buttons,
// the rest under "Show more actions" ("Show 22 more actions" on a Task). Which actions exist comes from the UI API.
const { SfUiError } = require('./errors');
const discover = require('./discover');
const modal = require('./modal');
const A = require('./anchors');
const { armToasts, raised } = require('./act');

// A click timeout also covers the wait after the click lands, so only the page can say whether it arrived. The listener
// runs after Playwright's, which stops a swallowed click at the window. A page too busy to answer is 'busy', not a hang.
const ask = (page, fn) => Promise.race([page.evaluate(fn).catch(() => undefined), new Promise((done) => { setTimeout(done, 5_000, 'busy').unref(); })]);
const arm = (page) => ask(page, () => {
  if (window.sfPressed === undefined) document.addEventListener('click', (e) => { if (e.isTrusted) window.sfPressed = true; }, { capture: true });
  window.sfPressed = false;
});
// Busy counts as pressed, since a second press can create twice. No flag is a new document: pressed only if the URL moved.
async function arrived(page, url) {
  const said = await ask(page, () => window.sfPressed);
  return said === true || said === 'busy' || (said === undefined && page.url() !== url);
}

// The overflow menu's button; a Task page or list counts its items: "Show 22 more actions".
const MORE = /^Show (\d+ )?more actions$/;

// Presses the action labelled `label` on the open record page, from its button or the overflow menu.
async function press(s, label, { actionTimeout = 10_000, recordId, settle = 30_000 } = {}) {
  const bar = s.page.locator(A.highlights);
  const button = bar.getByRole('button', { name: label, exact: true });
  const more = bar.getByRole('button', { name: MORE });
  const none = (seen) => new SfUiError('ACTION_NOT_AVAILABLE', `no ${label} action on this record as this user`, { recordId, label, seen });
  await button.or(more).first().waitFor({ timeout: actionTimeout }).catch(() => { throw none([]); }); // the panel has loaded
  // The panel can draw its actions twice, quick actions first as buttons (a Developer Edition org, 2026-11-04), so a
  // button that leaves before the click, or a menu that lacks the action, means look again, not wait 30 s or give up.
  const end = Date.now() + settle;
  for (;;) {
    const n = await button.count();
    if (n > 1) throw new SfUiError('AMBIGUOUS', `${n} ${label} buttons on this record`, { label });
    if (n) {
      const url = s.page.url();
      await arm(s.page);
      await armToasts(s.page); // a toast the page raised before this click is not the action's
      try {
        return await button.click({ timeout: 2_000 });
      } catch (e) {
        if (e.name !== 'TimeoutError') throw e;
        if (await arrived(s.page, url)) return undefined; // never press twice: a second press can create twice
        if (Date.now() > end) throw e;
        continue;
      }
    }
    await more.click();
    const item = s.page.getByRole('menuitem', { name: label, exact: true });
    await item.or(button).first().waitFor({ timeout: 5_000 }).catch(() => {});
    if (await item.count()) { await armToasts(s.page); return item.click(); }
    if (!(await button.count())) throw none(await s.page.getByRole('menuitem').allInnerTexts());
    if (Date.now() > end) throw new SfUiError('TIMEOUT', `${label} kept moving between its button and the menu for ${settle} ms`, { recordId, label });
    await s.page.keyboard.press('Escape'); // the button came back: close the menu and press it
  }
}

// Opens a record action by API name (SfUiProbe__c.Bump, Edit) and returns the dialog it opens, null when the action
// navigates instead (Printable View), or { toasts } when it only raised toasts. Edit opens "Edit <name>", not "Edit".
async function launch(s, recordId, apiName, { timeout = 15_000, settle = 2_000 } = {}) {
  const actions = await discover.actions(s, recordId); // it opens the record
  const found = actions.find((a) => a.apiName === apiName);
  if (!found) throw new SfUiError('ACTION_NOT_AVAILABLE', `${recordId} offers no action ${apiName} to this user`, { recordId, apiName, actions: actions.map((a) => a.apiName) });
  const twins = actions.filter((a) => a.label === found.label);
  if (twins.length > 1) throw new SfUiError('AMBIGUOUS', `${twins.length} actions are labelled ${found.label}, so the page cannot tell them apart`, { label: found.label, actions: twins.map((a) => a.apiName) });
  const [url, pages] = [s.page.url(), s.context.pages().length];
  const moved = () => s.page.url() !== url || s.context.pages().length > pages;
  await press(s, found.label, { recordId }); // it arms the toasts at its click
  // Wait for a dialog or the first toast; after a toast, a dialog gets `settle` more. No dialog counts as navigation
  // only when the page or the tab count moved, and as done when the action raised a toast (a headless action).
  // 0 mid-navigation; any other error (a closed page) is thrown at once.
  const shown = () => s.page.getByRole('dialog').locator('visible=true').count().catch((e) => { if (/context was destroyed/i.test(e.message)) return 0; throw e; });
  const end = Date.now() + timeout;
  while (!(await shown()) && !raised(s.page).length && Date.now() < end) await new Promise((ok) => { setTimeout(ok, 100); });
  if (await shown()) return modal.find(s, { timeout: Math.max(1_000, end - Date.now()), body: true });
  if (raised(s.page).length) {
    const dialog = await modal.open(s, { timeout: settle, body: true });
    if (dialog) return dialog;
  }
  if (moved()) return null;
  const toasts = raised(s.page);
  if (toasts.length) return { toasts };
  throw new SfUiError('TIMEOUT', `${apiName} opened no dialog within ${timeout} ms and did not navigate`, { apiName, url });
}

module.exports = { MORE, press, launch, arrived };
