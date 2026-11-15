'use strict';

// Quick actions on the fixture's probe page: the UI API lists them, and launch presses one by API name (Bump sits
// under "Show more actions", fifth in the layout) and returns its dialog, which the agent then fills and saves.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, discover, action, act, api, modal } = require('..');
const { auth, env, skip, probe, localPage, record, account, stamp } = require('./helpers');

// No org: a Developer Edition org draws the panel's quick actions as buttons, then again with them in the menu (the
// nightly reds from 2026-10-25 on). The button never settles until the test says so, and the open menu covers it.
async function panel(t, { menu = '', onclick = "document.title='from the button'" } = {}) {
  const page = await localPage(t);
  page.setDefaultTimeout(8_000); // the old click waited this long for a button that left, then failed
  await page.goto(`data:text/html,${encodeURIComponent(`<style>@keyframes slide { from { margin-left: 0 } to { margin-left: 200px } }
    .moving { animation: slide 400ms linear infinite } #menu { position: fixed; inset: 0; background: white }</style><records-highlights2><span id="bar"><button id="b" class="moving" onclick="${onclick}">Bump Flow</button></span>
    <button aria-haspopup="true" onclick="document.getElementById('menu').hidden=false">Show more actions</button></records-highlights2>
    <div id="menu" role="menu" hidden>${menu}<div role="menuitem">Clone</div></div>
    <script>addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('menu').hidden = true; })</script>`)}`);
  return page;
}
const inMenu = '<div role="menuitem" onclick="document.title=\'from the menu\'">Bump Flow</div>';
const leave = (page) => page.evaluate(() => { window.gone = document.getElementById('b'); window.gone.remove(); });

test('press takes the menu when the panel moves a counted button there, within its 2 s try', { timeout: 30_000 }, async (t) => {
  const page = await panel(t, { menu: inMenu });
  const start = Date.now();
  const pressed = action.press({ page }, 'Bump Flow');
  await page.waitForTimeout(1_500); // inside the first try, so the button was counted before it left
  await leave(page);
  await pressed;
  assert.equal(await page.title(), 'from the menu');
  assert.ok(Date.now() - start < 5_000, `took ${Date.now() - start} ms`);
});

test('press clicks a landed button once, however long the page then blocks', { timeout: 30_000 }, async (t) => {
  const page = await panel(t, { onclick: 'window.n=(window.n||0)+1;const t0=Date.now();while(Date.now()-t0<2500);' });
  await page.evaluate(() => document.getElementById('b').classList.remove('moving'));
  await action.press({ page }, 'Bump Flow');
  await page.waitForTimeout(3_000); // a second press, if there were one, has run by now
  assert.equal(await page.evaluate(() => window.n), 1);
});

test('press looks again when the redraw swallows the click', { timeout: 30_000 }, async (t) => {
  const page = await panel(t, { menu: inMenu });
  await page.evaluate(() => {
    const b = document.getElementById('b');
    b.classList.remove('moving');
    b.onmouseover = () => { const t0 = Date.now(); while (Date.now() - t0 < 2500); b.remove(); };
  });
  await action.press({ page }, 'Bump Flow');
  assert.equal(await page.title(), 'from the menu');
});

test('press waits for a button that stays but settles after its first try', { timeout: 30_000 }, async (t) => {
  const page = await panel(t, { menu: inMenu });
  const pressed = action.press({ page }, 'Bump Flow');
  await page.waitForTimeout(3_000);
  await page.evaluate(() => document.getElementById('b').classList.remove('moving'));
  await pressed;
  assert.equal(await page.title(), 'from the button');
});

test('press finds a button that leaves and comes back, not a false ACTION_NOT_AVAILABLE', { timeout: 30_000 }, async (t) => {
  const page = await panel(t);
  const start = Date.now();
  const pressed = action.press({ page }, 'Bump Flow');
  await page.waitForTimeout(1_500);
  await leave(page);
  await page.waitForTimeout(1_500);
  await page.evaluate(() => { window.gone.classList.remove('moving'); document.getElementById('bar').append(window.gone); });
  await pressed;
  assert.equal(await page.title(), 'from the button');
  assert.ok(Date.now() - start < 6_000, `the menu wait ends when the button returns, took ${Date.now() - start} ms`);
});

test('press returns from a landed click whose page never yields', { timeout: 30_000 }, async (t) => {
  const page = await panel(t, { onclick: 'while(true);' });
  await page.evaluate(() => document.getElementById('b').classList.remove('moving'));
  const start = Date.now();
  await action.press({ page }, 'Bump Flow');
  assert.ok(Date.now() - start < 12_000, `took ${Date.now() - start} ms`);
});

// No browser: a new document has no flag, so the URL decides between a click that navigated and a reload that was not ours.
test('arrived reads a missing flag by whether the URL moved', async () => {
  const page = (said, url) => ({ evaluate: async () => said, url: () => url });
  assert.equal(await action.arrived(page(undefined, 'https://b'), 'https://a'), true);
  assert.equal(await action.arrived(page(undefined, 'https://a'), 'https://a'), false);
  assert.equal(await action.arrived(page(false, 'https://b'), 'https://a'), false); // the flag, when there is one, decides
  assert.equal(await action.arrived(page(true, 'https://a'), 'https://a'), true);
});

test('press does not count a script\'s click as a press', { timeout: 30_000 }, async (t) => {
  const page = await panel(t);
  const pressed = action.press({ page }, 'Bump Flow', { settle: 3_000 }).then(() => 'pressed', (e) => e.name);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.body.click());
  assert.equal(await pressed, 'TimeoutError');
});

test('press ends TIMEOUT, not ACTION_NOT_AVAILABLE, when the button shows only with the menu open', { timeout: 30_000 }, async (t) => {
  const page = await panel(t);
  await page.evaluate(() => {
    const b = document.getElementById('b');
    const bar = document.getElementById('bar');
    b.classList.remove('moving');
    b.remove();
    document.querySelector('[aria-haspopup]').addEventListener('click', () => bar.append(b));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') b.remove(); });
  });
  await assert.rejects(action.press({ page }, 'Bump Flow', { settle: 500 }), (e) => e.code === 'TIMEOUT');
});

test('press still says ACTION_NOT_AVAILABLE for an action in neither place', { timeout: 30_000 }, async (t) => {
  const page = await panel(t);
  await page.evaluate(() => document.getElementById('b').classList.remove('moving')); // it would shift the menu button too
  await assert.rejects(action.press({ page }, 'Nope'), (e) => e.code === 'ACTION_NOT_AVAILABLE' && e.evidence.seen.includes('Clone'));
});

test('action', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const id = await probe(s, t);

  await t.test('discover.actions lists the record page actions with API name, label and type', async () => {
    const actions = await discover.actions(s, id);
    assert.deepEqual(actions.find((a) => a.apiName === 'SfUiProbe__c.Bump'), { apiName: 'SfUiProbe__c.Bump', label: 'Bump', type: 'QuickAction' });
  });

  await t.test('action.launch opens a quick action from the overflow menu, and its dialog saves', async () => {
    const d = await action.launch(s, id, 'SfUiProbe__c.Bump');
    // Read at once, with no wait of its own: launch returns the dialog with its body drawn, not its bare frame.
    assert.equal(await d.getByLabel('Count').count(), 1, 'Count is drawn when launch returns');
    await act.fill(d, { name: 'Count', value: '42' });
    await act.click(d, { name: 'Save' });
    await d.waitFor({ state: 'hidden', timeout: 15_000 });
    assert.equal((await api.call(s, `/ui-api/records/${id}?fields=SfUiProbe__c.Count__c`)).fields.Count__c.value, 42);
  });

  // A standard action's dialog is not named by its label ("Edit" opens "Edit <record name>").
  await t.test('action.launch opens a standard action\'s dialog too', async () => {
    const d = await action.launch(s, id, 'Edit');
    await d.getByRole('button', { name: 'Save', exact: true }).waitFor({ timeout: 15_000 });
    await act.click(d, { name: 'Cancel' });
    await d.waitFor({ state: 'hidden', timeout: 15_000 });
  });

  await t.test('action.launch returns null for an action that opens a page instead of a dialog', async () => {
    const pages = s.context.pages().length;
    assert.equal(await action.launch(s, id, 'PrintableView', { timeout: 5_000 }), null);
    for (const p of s.context.pages().slice(pages)) await p.close();
  });

  // A screen flow behind a quick action needs no flow-specific code: the same launch, fill and click drive it.
  await t.test('a screen flow launched from a quick action is driven with the generic tools', async () => {
    const d = await action.launch(s, id, 'SfUiProbe__c.Bump_Flow');
    await act.fill(d, { name: 'New count', role: 'spinbutton', value: '77' });
    await act.click(d, { name: 'Next' });
    for (const end = Date.now() + 20_000; ; await new Promise((r) => setTimeout(r, 1000))) {
      if ((await api.call(s, `/ui-api/records/${id}?fields=SfUiProbe__c.Count__c`)).fields.Count__c.value === 77) break;
      if (Date.now() > end) assert.fail('the flow did not set Count to 77');
    }
  });

  await t.test('action.launch refuses an action the record does not offer', async () => {
    await assert.rejects(action.launch(s, id, 'SfUiProbe__c.NoSuchAction'), (e) => e.code === 'ACTION_NOT_AVAILABLE' && e.evidence.actions.includes('SfUiProbe__c.Bump'));
  });
});

// On a Dynamic Actions page (the break fixture's gate and Account pages) the panel's own list and rules decide, not the
// layout's: measured on sfui-s4-flow, the gate record at Level 3 with a Note shows Edit only.
test('discover.actions lists a Dynamic Actions page\'s actions, as its ribbon shows them', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const ribbon = async () => {
    const bar = s.page.locator('records-highlights2');
    const more = bar.getByRole('button', { name: action.MORE });
    let menu = [];
    if (await more.count()) { await more.click(); menu = await s.page.getByRole('menuitem').allInnerTexts(); await s.page.keyboard.press('Escape'); }
    return [...await bar.locator('runtime_platform_actions-actions-ribbon').getByRole('button').allInnerTexts(), ...menu].filter((l) => !action.MORE.test(l));
  };
  await t.test('a visibility rule hides Delete and Clone on the gate page', async (st) => {
    await session.openApp(s, 'SfUi_App');
    const id = await record(s, t, 'SfUiGate__c', { Name: `BREAK fix actions ${stamp()}`, Level__c: '3', Note__c: 'BREAK fix' })
      .catch((e) => { if (e.evidence?.errorCode === 'INVALID_FIELD') return null; throw e; });
    if (!id) return st.skip('the admin cannot set SfUiGate__c.Level__c on this org (INVALID_FIELD), so no gate record');
    const got = await discover.actions(s, id);
    assert.deepEqual(got.map((a) => a.apiName), ['Edit']);
    assert.deepEqual(got.map((a) => a.label), await ribbon());
  });
  await t.test('a quick action placed only on the page is listed and launches', async (st) => {
    const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
    if (!app) return st.skip('the org has no test/fixture-components app SfUiC_App');
    const id = await account(s, t);
    const got = await discover.actions(s, id);
    assert.deepEqual(got.map((a) => a.apiName), ['Edit', 'Account.SfUiC_New_Contact', 'Delete', 'PrintableView']);
    assert.deepEqual(got.map((a) => a.label), await ribbon());
    const d = await action.launch(s, id, 'Account.SfUiC_New_Contact');
    assert.equal(await d.getByLabel('Last Name').count(), 1);
    await act.click(d, { name: 'Cancel' });
  });
});

// No org: a Task page's Aura header counts its overflow ("Show 22 more actions", measured on sfui-s4-flow) and puts Edit there.
test('press finds an action behind a counted overflow button, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<header data-aura-class="forceHighlightsPanel"><button>Mark Complete</button>
    <a role="button" href="#" onclick="document.getElementById('menu').hidden=false">Show 22 more actions</a></header>
    <div id="menu" role="menu" hidden><div role="menuitem" onclick="document.title='edit'">Edit</div></div>`);
  await action.press({ page }, 'Edit', { actionTimeout: 3_000 });
  assert.equal(await page.title(), 'edit');
});

// F-flow-28: a standard Aura dialog draws its frame (heading, Cancel, Submit or Next) first and its form a moment later:
// Change Owner with an empty body, Change Record Type with its record type group empty. No org: the form lands at 1.5 s.
test('modal.find with body waits for the form, not the frame and its footer, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const frame = (body, later) => page.setContent(`<div role="dialog" aria-modal="true" aria-label="Change"><h2>Change</h2>
    <div class="slds-modal__content" id="b">${body}</div><div class="slds-modal__footer"><button>Cancel</button><button>Submit</button></div></div>
    <script>setTimeout(() => { document.getElementById('b').innerHTML = '${later}'; }, 1500)</script>`);
  await frame('<div role="status" class="slds-assistive-text"></div>', '<input role="combobox" aria-label="Select New Owner">');
  let d = await modal.find({ page }, { timeout: 5_000, body: true });
  assert.equal(await d.getByRole('combobox', { name: 'Select New Owner' }).count(), 1, 'Change Owner: the lookup is drawn');
  await frame('Existing picklists are not updated.<fieldset><legend>Available record types</legend></fieldset>',
    'Existing picklists are not updated.<fieldset><legend>Available record types</legend><input type=radio aria-label=Alpha></fieldset>');
  d = await modal.find({ page }, { timeout: 5_000, body: true });
  assert.equal(await d.getByRole('radio', { name: 'Alpha' }).count(), 1, 'Change Record Type: the radio is drawn');
  await frame('Are you sure you want to delete this item?', 'never');
  const start = Date.now();
  await modal.find({ page }, { timeout: 5_000, body: true });
  assert.ok(Date.now() - start < 1_000, `a body of text alone is drawn: took ${Date.now() - start} ms`);
});

// The repro on the component fixture (sfui-s4-flow): the snapshot sf_launch_action returns holds the form.
test('launch returns Change Owner and Change Record Type with their forms', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  const id = await record(s, t, 'SfUiC_Item__c', { Name: `BREAK fix launch ${stamp()}` });
  const read = async (apiName) => {
    const d = await action.launch(s, id, apiName);
    const snap = await d.ariaSnapshot(); // read at once, as the tool does
    await modal.close(d);
    return snap;
  };
  assert.match(await read('ChangeOwnerOne'), /combobox "Select New Owner"/);
  assert.match(await read('ChangeRecordType'), /radio "SFUIC Alpha"/);
});
