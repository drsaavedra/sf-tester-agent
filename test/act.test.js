'use strict';

// act.click on the fixture's list view, inside the probe component, and in the modal it opens: the row decides
// which record's Edit dialog or which "Picked" line appears, so a click in the wrong row comes out red.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, act, modal, api, lwc, nav, AT } = require('..');
const { auth, env, skip, record, probe, account, stamp, localPage } = require('./helpers');

test('act', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const run = stamp();
  const rows = [`sf-ui row 1 ${run}`, `sf-ui row 10 ${run}`];
  for (const Name of rows) await probe(s, t, { Name });
  const id = await probe(s, t);
  const [view] = (await api.call(s, `/query?q=${encodeURIComponent("SELECT Id FROM ListView WHERE SobjectType = 'SfUiProbe__c' AND DeveloperName = 'All'")}`, { as: 'admin' })).records;
  const list = async () => {
    await s.page.goto(`${s.origin}/lightning/o/SfUiProbe__c/list?filterName=${view.Id}`);
    return s.page.getByRole('grid');
  };

  await t.test('click in a list row opens that row\'s menu, and a click in the modal closes it', async () => {
    await act.click(await list(), { name: 'Show Actions', row: rows[1] });
    await act.click(s.page.locator('body'), { role: 'menuitem', name: 'Edit' });
    const m = await modal.find(s);
    await m.getByRole('heading', { name: `Edit ${rows[1]}`, exact: true }).waitFor({ timeout: 15_000 });
    await act.click(m, { name: 'Cancel' });
    await m.waitFor({ state: 'hidden' });
  });

  await t.test('row text in more than one row is refused with the rows it matched', async () => {
    await assert.rejects(act.click(await list(), { name: 'Show Actions', row: 'sf-ui row 1' }),
      (e) => e.code === 'AMBIGUOUS_ROW' && e.evidence.rows.length > 1);
  });

  await t.test('a name that is not there fails with a snapshot of what is', async () => {
    await assert.rejects(act.click(await list(), { name: 'No Such Button', row: rows[1] }),
      (e) => e.code === 'NOT_FOUND' && /Show Actions/.test(e.evidence.snapshot));
  });

  // A Page has no ariaSnapshot, so a miss on the whole page must still come back NOT_FOUND with a snapshot.
  await t.test('a miss with the whole page as scope is NOT_FOUND, not a crash', async () => {
    await list();
    await assert.rejects(act.click(s.page, { name: 'No Such Button', timeout: 2_000 }),
      (e) => e.code === 'NOT_FOUND' && /Show Actions/.test(e.evidence.snapshot));
  });

  await t.test('click in a component\'s table row reaches that row\'s button', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Pick', row: 'row two' });
    await host.getByText('Picked row two').waitFor({ timeout: 15_000 });
  });

  // Each row holds two unnamed icon buttons; only the column header says which is the pencil.
  await t.test('column picks one of two unnamed icon buttons in a row by the header above it', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await assert.rejects(act.click(host, { name: '', row: 'row two', timeout: 2_000 }), (e) => e.code === 'AMBIGUOUS' && e.evidence.count === 2);
    await act.click(host, { name: '', row: 'row two', column: 'Edit' });
    await host.getByText('Edited row two').waitFor({ timeout: 15_000 });
    await act.click(host, { name: '', row: 'row two', column: 'Inline' });
    const inline = s.page.getByRole('dialog', { name: 'Inline dialog' });
    await inline.waitFor({ timeout: 15_000 });
    await act.click(inline, { name: 'Close inline dialog' });
    await assert.rejects(act.click(host, { name: '', row: 'row two', column: 'No Such Column', timeout: 2_000 }),
      (e) => e.code === 'NOT_FOUND' && e.evidence.role === 'columnheader' && /columnheader "Edit"/.test(e.evidence.snapshot));
  });

  await t.test('click inside a LightningModal reaches its footer button', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Open dialog' });
    const m = await modal.find(s);
    await act.click(m, { name: 'Done with dialog' });
    await m.waitFor({ state: 'hidden' });
  });

  // An open modal hides the page behind it from assistive tech, so the snapshot shows the modal, as a screen reader would.
  await t.test('a page snapshot shows the main area, and an open modal when there is one', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    const page = await act.snapshot(s.page, 6000);
    assert.match(page, /Ping/);
    assert.doesNotMatch(page, /App Launcher/, 'the app shell header is left out');
    await act.click(host, { name: 'Open dialog' });
    const m = await modal.find(s);
    await m.getByText('SF UI Probe Dialog').first().waitFor();
    try {
      assert.match(await act.snapshot(s.page, 6000), /SF UI Probe Dialog/);
    } finally {
      await act.click(m, { name: 'Done with dialog' });
      await m.waitFor({ state: 'hidden' });
    }
  });

  // The modal hands the typed note back to the component, so the line only appears if the fill reached it.
  await t.test('fill types into a textbox in a modal and the component receives it', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Open dialog' });
    const m = await modal.find(s);
    await act.fill(m, { name: 'Note', value: `typed ${run}` });
    await act.click(m, { name: 'Done with dialog' });
    await host.getByText(`Note: typed ${run}`).waitFor({ timeout: 15_000 });
  });

  await t.test('fill refuses a textbox that is not there, with a snapshot', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await assert.rejects(act.fill(host, { name: 'No Such Box', value: 'x' }), (e) => e.code === 'NOT_FOUND' && /Ping/.test(e.evidence.snapshot));
  });

  await t.test('waitFor sees an async server result arrive', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Ping' });
    await act.waitFor(host, { text: `pong ${id}` });
    assert.equal(await host.getByText(`pong ${id}`).isVisible(), true);
  });

  await t.test('waitFor sees text leave the page', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Open dialog' });
    const m = await modal.find(s);
    await m.getByText('SF UI Probe Dialog').first().waitFor();
    await act.click(m, { name: 'Done with dialog' });
    await act.waitFor(s.page.locator('body'), { text: 'SF UI Probe Dialog', gone: true });
    assert.equal(await s.page.getByText('SF UI Probe Dialog').locator('visible=true').count(), 0);
  });

  await t.test('a click records the toasts it raises, and toasts reads them back', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(host, { name: 'Ping' });
    const seen = await act.toasts(s.page);
    assert.deepEqual(seen.map(({ type, title, message }) => ({ type, title, message })), [{ type: 'success', title: 'Ping', message: `pong ${id}` }]);
  });

  // Lightning's own force:showToast with no click before it, on a document opened after the last arm.
  await t.test('a toast raised with no click before it is recorded', async () => {
    await nav.openRecord(s, id);
    await s.page.evaluate(() => $A.get('e.force:showToast').setParams({ type: 'info', title: 'Unprompted' }).fire());
    assert.ok((await act.toasts(s.page)).some((x) => x.title === 'Unprompted'), JSON.stringify(s.toasts));
  });

  // Two copies of a text, the first hidden: "gone" must wait for the visible one, not settle on the hidden first.
  await t.test('waitFor gone keeps waiting while any visible copy of the text remains', async () => {
    await lwc.scope(s, id, 'sfUiProbe');
    await s.page.evaluate(() => {
      for (const hidden of [true, false]) {
        const d = document.createElement('div');
        d.textContent = 'sf-ui twin marker';
        d.className = 'sf-ui-twin';
        if (hidden) d.style.display = 'none';
        document.body.appendChild(d);
      }
    });
    try {
      await assert.rejects(act.waitFor(s.page.locator('body'), { text: 'sf-ui twin marker', gone: true, timeout: 1_500 }), { code: 'TIMEOUT' });
    } finally {
      await s.page.evaluate(() => document.querySelectorAll('.sf-ui-twin').forEach((d) => d.remove()));
    }
  });

  await t.test('waitFor throws TIMEOUT with a snapshot when the text never comes', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await assert.rejects(act.waitFor(host, { text: 'text that never renders', timeout: 2_000 }), (e) => e.code === 'TIMEOUT' && /Ping/.test(e.evidence.snapshot));
  });

  // The page scope reaches a row button inside the probe (synthetic shadow); a near miss names the button and the probe.
  await t.test('a page-level click reaches a component\'s row, and a miss names the component holding a near match', async () => {
    const host = await lwc.scope(s, id, 'sfUiProbe');
    await act.click(s.page, { name: 'Pick', row: 'row one' });
    await host.getByText('Picked row one').waitFor({ timeout: 15_000 });
    const e = await act.click(s.page, { name: 'Pick it', timeout: 2_000 }).then(() => null, (x) => x);
    assert.equal(e?.code, 'NOT_FOUND', String(e));
    assert.ok(e.evidence.near.some((n) => n.name === 'button "Pick"' && n.hosts.includes('c-sf-ui-probe')), JSON.stringify(e.evidence.near));
  });

  // A record picker lists its matches only once the box was pressed; typing alone opened no list.
  await t.test('fill on a record picker opens its option list', async () => {
    const name = `sf-ui picker ${stamp()}`;
    await account(s, t, { Name: name });
    await act.fill(await lwc.scope(s, id, 'sfUiInputs'), { role: 'combobox', name: 'Company', value: name });
    await act.click(s.page, { role: 'option', name, timeout: 10_000 });
    await s.page.getByText(`Company chosen: ${name}`).waitFor({ timeout: 10_000 });
  });
});

// No org: a long page with the target past the snapshot's cut, inside nested open shadow hosts, as on a large record page.
// GitHub's runners took 3.8 s to over 30 s here, so the cap leaves room for a slow browser.
test('a page-level miss says the snapshot was cut and names the near matches and their components', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  const filler = Array.from({ length: 150 }, (_, i) => `<button>Show filler ${i}</button>`).join('');
  await page.goto(`data:text/html,${encodeURIComponent(`<main>${filler}<c-order-detail></c-order-detail></main><script>
    const host = (tag, html) => customElements.define(tag, class extends HTMLElement { connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = html; } });
    host('c-order-detail', '<c-order-line></c-order-line>');
    host('lightning-button', '<button>Invoice</button>');
    host('c-order-line', '<span>Invoice due</span><lightning-button></lightning-button><table><tr><td>Item One</td><td>No Shipping Label</td></tr></table>');
  </script>`)}`);
  await act.click(page, { name: 'Invoice', timeout: 2_000 }); // the control: the page scope reaches it
  const miss = await act.click(page, { name: 'Show Invoice', timeout: 500 }).then(() => null, (x) => x);
  assert.equal(miss?.code, 'NOT_FOUND', String(miss));
  // the longer word first, so "Show" on every filler cannot crowd it out of the five
  assert.deepEqual(miss.evidence.near[0], { name: 'button "Invoice"', hosts: ['c-order-line', 'c-order-detail'] });
  assert.equal(miss.evidence.near.length, 5);
  assert.match(miss.evidence.snapshot, /\n\[cut at 3000 of \d+ characters\]\n- covered check stopped at 100 texts$/); // 150 buttons also hit the covered cap, whose line follows the cut
  const byText = await act.click(page, { text: 'Show Invoice', timeout: 500 }).then(() => null, (x) => x);
  assert.equal(byText?.code, 'NOT_FOUND', String(byText));
  assert.deepEqual(byText.evidence.near.slice(0, 2).map((n) => n.name), ['text: Invoice due', 'button "Invoice"']); // a text with no role too
  const row = await act.click(page, { name: '', row: 'No Shipping Labels', timeout: 500 }).then(() => null, (x) => x);
  assert.equal(row?.code, 'ROW_NOT_FOUND', String(row));
  assert.match(row.message, /0 of 1 rows/);
  assert.deepEqual(row.evidence.near.map((n) => [n.name.startsWith('row "Item One No Shipping Label'), n.hosts]), [[true, ['c-order-line', 'c-order-detail']]]);
});

// No org: a menu button whose popup renders outside main and the dialog (an Aura object picker, a picklist) says what
// opened, since no snapshot shows it; a plain button says nothing.
test('a click that expands a popup returns the popup it controls as opened', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<main><button aria-haspopup="true" aria-expanded="false" aria-controls="12:0"
    onclick="this.setAttribute('aria-expanded','true');setTimeout(()=>document.getElementById('12:0').hidden=false,200)">Pick an object</button>
    <button>Plain</button></main><div id="12:0" role="menu" hidden><div role="menuitem">Accounts</div><div role="menuitem">Cases</div></div>`)}`);
  const r = await act.click(page, { name: 'Pick an object', timeout: 2_000 });
  assert.match(r.opened || '', /menuitem "Accounts"[\s\S]*menuitem "Cases"/, JSON.stringify(r));
  assert.equal((await act.click(page, { name: 'Plain', timeout: 2_000 })).opened, undefined);
});

// No org: a component re-rendering after a save (the Path after Mark as Complete) replaces the target while the click
// waits for it to stop moving; the click finds it again by name instead of failing UNEXPECTED.
test('a target replaced while it animates is found again and clicked', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<style>@keyframes slide { from { margin-left: 0 } to { margin-left: 200px } }
    .moving { animation: slide 600ms linear }</style><main><span id="slot"></span><p id="out"></p></main><script>
    const make = (moving) => { const b = document.createElement('button'); b.textContent = 'Done'; if (moving) b.className = 'moving';
      b.onclick = () => { document.getElementById('out').textContent = moving ? 'old clicked' : 'fresh clicked'; }; return b; };
    document.getElementById('slot').append(make(true));
    setTimeout(() => document.getElementById('slot').replaceChildren(make(false)), 200);
  </script>`)}`);
  await act.click(page, { name: 'Done', timeout: 3_000 });
  assert.equal(await page.locator('#out').textContent(), 'fresh clicked');
});

// No org: an Aura dialog (Kanban Settings) or a Visualforce page uses a native select, which takes no typing.
test('fill chooses a native select option by its label, and names the options on a miss', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<main><label>Group By<select onchange="document.getElementById('o').textContent=this.value">
    <option value="d">Detail</option><option value="k">Kind</option></select></label><p id="o"></p></main>`)}`);
  await act.fill(page, { role: 'combobox', name: 'Group By', value: 'Kind' });
  assert.equal(await page.locator('#o').textContent(), 'k');
  await assert.rejects(act.fill(page, { role: 'combobox', name: 'Group By', value: 'Owner' }), (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.join() === 'Detail,Kind');
});

// No org: an open utility panel or docked composer is a dialog too, and sits after the App Launcher's modal in the
// page, so "the last dialog" picked the panel; a true modal (aria-modal) is the newest one while it shows.
test('modal.find takes an open aria-modal dialog over a later non-modal one, and a non-modal one alone', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<main></main><div role="dialog" aria-modal="true" aria-label="App Launcher" id="m"><input aria-label="Search apps"></div>
    <footer><div role="dialog" aria-label="SF UI Utility"><input aria-label="Utility note"></div></footer>`)}`);
  assert.equal(await (await modal.find({ page })).getAttribute('aria-label'), 'App Launcher');
  await page.evaluate(() => document.getElementById('m').remove());
  assert.equal(await (await modal.find({ page }, { timeout: 2_000 })).getAttribute('aria-label'), 'SF UI Utility');
});

// No org: LightningAlert and LightningConfirm draw role="alertdialog", not dialog, so find and open missed them (F-fixtures-4).
test('modal.find and modal.open take an alertdialog, over a later non-modal dialog too, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main></main><section role="alertdialog" aria-modal="true" aria-label="SFUIC Alert"><div class="slds-modal__content">SFUIC alert message</div><button>OK</button></section>
    <footer><div role="dialog" aria-label="SF UI Utility"><input aria-label="Utility note"></div></footer>`);
  assert.equal(await (await modal.find({ page }, { timeout: 2_000, body: true })).getAttribute('aria-label'), 'SFUIC Alert');
  await page.setContent('<section role="alertdialog" aria-label="SFUIC Confirm"><button>OK</button><button>Cancel</button></section>');
  assert.equal(await (await modal.open({ page }, { timeout: 500 })).getAttribute('aria-label'), 'SFUIC Confirm');
});

// No org: a second stacked panel on an Aura template page sets aria-hidden on div.viewport, which holds both dialogs
// (F-fixtures-26). find still takes the drawn dialog, a click reaches inside it, and read gives its text and the hider.
test('modal.find, act.click and modal.read reach a drawn dialog under aria-hidden, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<div class="viewport" aria-hidden="true"><main>Record page</main>
    <div role="dialog" aria-modal="true" aria-label="Shell" class="slds-modal"></div>
    <div role="dialog" aria-modal="true" aria-label="New SFUIC Aura" class="slds-modal"><h2>New SFUIC Aura</h2>
      <div class="slds-modal__content"><input aria-label="Aura Name">
        <label for="code"><abbr title="required" aria-hidden="true">*</abbr>Aura Code</label><input id="code" required>
        <div role="group" aria-labelledby="story"><span id="story"><abbr title="required" aria-hidden="true">*</abbr>Aura Story</span><div role="toolbar"><button>Bold</button></div><div class="read" style="min-height:40px">Tell it</div></div>
      </div><button onclick="this.textContent='Cancelled'">Cancel</button></div></div>
    <div role="dialog" aria-label="Hidden copy" style="display:none"><input></div>`);
  const m = await modal.find({ page }, { timeout: 2_000, body: true });
  assert.equal(await m.getAttribute('aria-label'), 'New SFUIC Aura');
  assert.equal(m.hiddenBy, '<div class="viewport">');
  const r = await modal.read(m, (l) => l.ariaSnapshot());
  assert.equal(r.hiddenBy, '<div class="viewport">');
  assert.match(r.text, /New SFUIC Aura/);
  // A required box's aria-hidden "*" leads its name under includeHidden (R4): fill by the label still finds it.
  await act.fill(m, { name: 'Aura Code', value: 'A-1', timeout: 2_000 });
  assert.equal(await page.locator('#code').inputValue(), 'A-1');
  await page.evaluate(() => document.querySelector('#story ~ .read').addEventListener('click', (e) => { e.target.outerHTML = '<div role="textbox" aria-label="Aura Story" contenteditable="true" style="min-height:40px" oninput="window.typed = this.textContent"></div>'; }));
  await act.fill(m, { name: 'Aura Story', value: 'Once', timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.typed), 'Once');
  await act.click(m, { name: 'Cancel', timeout: 2_000 });
  assert.equal(await m.getByText('Cancelled').count(), 1);
  await m.evaluate((d) => { d.innerHTML += '<button title="Cancel and close" onclick="this.closest(\'[role=dialog]\').remove()">Cancel and close</button>'; });
  await modal.close(m, { timeout: 2_000 });
  assert.equal(await page.getByText('New SFUIC Aura').count(), 0, 'closed');
  // Control: a dialog in the accessibility tree is read by its snapshot and carries no hiddenBy.
  await page.setContent('<div role="dialog" aria-modal="true" aria-label="Plain"><input aria-label="Name"></div>');
  const plain = await modal.find({ page }, { timeout: 2_000 });
  assert.equal(plain.hiddenBy, undefined);
  assert.match((await modal.read(plain, (l) => l.ariaSnapshot())).snapshot, /textbox "Name"/);
});

// The repro on the component fixture: the second force:editRecord or force:createRecord panel on the Aura template
// record page draws under an aria-hidden div.viewport, so getByRole('dialog') finds none (F-fixtures-26).
test('modal.find reads and clicks in the Edit dialog an Aura template record page hides', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_Aura_Home').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_Aura_Home');
  const name = `BREAK fix 38 aura ${stamp()}`;
  const id = await record(s, t, 'SfUiC_Aura__c', { Name: name });
  for (const button of ['force:createRecord', 'force:editRecord']) {
    await nav.openRecord(s, id);
    await act.waitFor(s.page, { text: 'force:recordSave', timeout: 20_000 });
    await act.click(s.page, { name: button });
    await s.page.waitForTimeout(2_000); // the platform sets aria-hidden on div.viewport about a second after the panels open
    const m = await modal.find(s, { timeout: 10_000, body: true });
    if (button === 'force:createRecord') { await s.page.keyboard.press('Escape'); continue; } // the first panel opens unhidden
    assert.equal(m.hiddenBy, '<div class="viewport">', 'control: the page hides this dialog from assistive tech');
    assert.equal(await s.page.getByRole('dialog').count(), 0, 'control: no dialog in the accessibility tree');
    assert.match((await modal.read(m, (l) => l.ariaSnapshot())).text, new RegExp(`Edit ${name}`));
    await act.fill(m, { name: 'Aura Name', value: `${name} edited` }); // required, so named "*Aura Name" there (R4); Cancel drops it
    const handle = await m.elementHandle();
    await act.click(m, { name: 'Cancel' });
    await handle.waitForElementState('hidden', { timeout: 10_000 });
  }
});

// The repro on the component fixture: LightningAlert and LightningConfirm on the Aura Calls tab, read and closed as modals.
test('modal.open reads a LightningAlert and a LightningConfirm, and a click inside closes each', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  await nav.openTab(s, 'SfUiC_Aura_Calls');
  for (const [button, text, close] of [['SFUIC Open Alert', 'SFUIC alert message', 'OK'], ['SFUIC Open Confirm', 'SFUIC confirm message', 'Cancel']]) {
    await act.click(s.page, { name: button });
    const m = await modal.open(s, { timeout: 5_000, body: true });
    assert.ok(m, `${button}: no dialog found`);
    await m.getByText(text).waitFor({ timeout: 5_000 });
    await act.click(m, { name: close });
    await m.waitFor({ state: 'hidden', timeout: 10_000 }); // it fades out over about a second
    assert.equal(await modal.open(s, { timeout: 0 }), null, `${button}: still open after ${close}`);
  }
});

// No org: a click that starts a download (a file preview's Download) saves it and says what came down.
test('a click with download saves the file it starts, and refuses a click that starts none', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<main><a href="data:text/plain,hello" download="note.txt">Download</a><button>Plain</button></main>`)}`);
  const r = await act.click(page, { role: 'link', name: 'Download', download: true });
  assert.equal(r.download.name, 'note.txt');
  assert.equal(r.download.bytes, 5);
  assert.equal(require('node:fs').readFileSync(r.download.path, 'utf8'), 'hello');
  await assert.rejects(act.click(page, { name: 'Plain', download: true, timeout: 1_000 }), { code: 'NO_DOWNLOAD' });
  // A Salesforce file preview's Download opens a new tab that downloads; the file comes from that tab.
  await page.goto(`data:text/html,${encodeURIComponent(`<main><button onclick="const w = window.open('about:blank');
    w.document.write('<a id=a href=&quot;data:text/plain,popup&quot; download=&quot;p.txt&quot;>x</a>'); w.document.getElementById('a').click();">Download in tab</button></main>`)}`);
  const popup = await act.click(page, { name: 'Download in tab', download: true });
  assert.deepEqual([popup.download.name, popup.download.bytes], ['p.txt', 5]);
});

// No org: near's matches go stale between its list and its per-element reads (a LEX re-render), or its list throws
// (a closed page); the miss stays NOT_FOUND with its snapshot, in well under Playwright's 30 s default.
test('a near match that goes stale or a list that throws leaves the miss NOT_FOUND', { timeout: 90_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main><button class="gone">Report one</button><button>Save</button></main>')}`);
  const main = page.locator('main');
  const scope = (list) => ({ ariaSnapshot: (o) => main.ariaSnapshot(o), getByRole: (r, o) => {
    const l = main.getByRole(r, o);
    if (o.name instanceof RegExp) { const all = l.all.bind(l); l.all = () => list(all); }
    return l;
  } });
  // "Report" lists the .gone button, which is then removed; "Save" still matches after it.
  const stale = scope(async (all) => { const els = await all(); await page.evaluate(() => document.querySelectorAll('.gone').forEach((e) => e.remove())); return els; });
  for (const [what, at, near] of [['stale', stale, [{ name: 'button "Save"', hosts: [] }]], ['throws', scope(async () => { throw new Error('Target page, context or browser has been closed'); }), []]]) {
    const start = Date.now();
    const e = await act.click(at, { name: 'Report Save', timeout: 500 }).then(() => null, (x) => x);
    assert.equal(e?.code, 'NOT_FOUND', `${what}: ${e}`);
    assert.ok(Date.now() - start < 10_000, `${what}: ${Date.now() - start} ms`);
    assert.deepEqual(e.evidence.near, near, what);
    assert.match(e.evidence.snapshot, /button "Save"/, what);
  }
  // Marking "Save B" removes "Save A", so nth(1) shifts to "Save C" between reading B's hosts and its name.
  await page.goto(`data:text/html,${encodeURIComponent(`<main><button>Save A</button><button>Save B</button><button>Save C</button></main><script>
    new MutationObserver(() => { const [a, b] = document.querySelectorAll('button'); if (b.textContent === 'Save B' && b.hasAttribute('data-sf-ui-near')) a.remove(); })
      .observe(document.body, { subtree: true, attributeFilter: ['data-sf-ui-near'] });
  </script>`)}`);
  const shift = await act.click(page, { name: 'Save Changes', timeout: 500 }).then(() => null, (x) => x);
  assert.deepEqual(shift?.evidence.near.map((n) => n.name), ['button "Save A"', 'button "Save B"'], String(shift));
});

// No org: an element two asked words both match is listed once, on the button arm and the row arm.
test('near lists an element once however many asked words match it', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main><button>Save Order</button><table><tr><td>Item One</td><td>Attachment</td></tr></table></main>')}`);
  const button = await act.click(page, { name: 'Save Order Details order', timeout: 500 }).then(() => null, (x) => x);
  const row = await act.click(page, { name: '', row: 'Attachment Missing', timeout: 500 }).then(() => null, (x) => x);
  assert.deepEqual([button?.code, row?.code], ['NOT_FOUND', 'ROW_NOT_FOUND'], `${button} ${row}`);
  assert.deepEqual([button.evidence.near.map((n) => n.name), row.evidence.near.map((n) => n.name)], [['button "Save Order"'], ['row "Item One Attachment":']]);
  // A word asked twice, in any case, is searched once.
  const searched = [];
  const none = { first: () => ({ waitFor: async () => {} }), count: async () => 0, all: async () => [] };
  const stub = { ariaSnapshot: async () => '', getByRole: (r, o) => { if (o.name instanceof RegExp) searched.push(o.name.source); return none; } };
  await assert.rejects(act.click(stub, { name: 'Order ORDER order', timeout: 0 }), { code: 'NOT_FOUND' });
  assert.deepEqual(searched, ['order']);
});

// No org: near names the three innermost of four custom hosts, and a hidden text is not a near match.
test('near caps hosts at three and leaves out hidden text', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent(`<main><span style="display:none">Gate closed</span><span>Gate open</span><c-a></c-a></main><script>
    const host = (tag, html) => customElements.define(tag, class extends HTMLElement { connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = html; } });
    host('c-a', '<c-b></c-b>'); host('c-b', '<c-c></c-c>'); host('c-c', '<c-d></c-d>'); host('c-d', '<button>Deep</button>');
  </script>`)}`);
  const deep = await act.click(page, { name: 'Deep End', timeout: 500 }).then(() => null, (x) => x);
  assert.deepEqual(deep?.evidence.near, [{ name: 'button "Deep"', hosts: ['c-d', 'c-c', 'c-b'] }], String(deep));
  const gate = await act.click(page, { text: 'Gate shut', timeout: 500 }).then(() => null, (x) => x);
  assert.deepEqual(gate?.evidence.near, [{ name: 'text: Gate open', hosts: [] }], String(gate));
});

// No org: an open dialog makes the page behind it aria-hidden, which ariaSnapshot leaves out; near still names
// what matched there, by text and by role with includeHidden (as sf_on_top aims).
test('near names a match in an aria-hidden area behind a dialog', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<div aria-hidden="true"><main><span>Invoice  due</span><button>Save Order</button></main></div><div role="dialog" aria-label="M"><button>Close</button></div>')}`);
  const byText = await act.click(page, { text: 'Invoice overdue', timeout: 500 }).then(() => null, (x) => x);
  const byRole = await act.resolve(page, { name: 'Save Order Details', role: 'button', includeHidden: true, timeout: 500 }).then(() => null, (x) => x);
  assert.deepEqual([byText?.code, byRole?.code], ['NOT_FOUND', 'NOT_FOUND'], `${byText} ${byRole}`);
  assert.deepEqual([byText.evidence.near, byRole.evidence.near], [[{ name: 'Invoice due', hosts: [] }], [{ name: 'Save Order', hosts: [] }]]);
});

// No org: an SLDS radio, as a flow's radio buttons render it, is a 1px input under its faux circle; its label takes the click.
test('a visually hidden radio is clicked through its label', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const radio = (v) => `<span style="position:relative;display:block"><input type="radio" id="${v}" name="p" style="position:absolute;left:4px;top:4px;width:1px;height:1px;margin:0;opacity:0"><label for="${v}"><span style="position:relative;display:inline-block;width:16px;height:16px;border:1px solid"></span> ${v}</label></span>`;
  await page.goto(`data:text/html,${encodeURIComponent(`<main><c-radios></c-radios></main><script>
    customElements.define('c-radios', class extends HTMLElement { connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = '<fieldset><legend>Steps path</legend>${radio('Short')}${radio('Long')}</fieldset>'; } });
  </script>`)}`);
  await act.click(page, { role: 'radio', name: 'Long', timeout: 2_000 });
  const checked = await page.evaluate(() => [...document.querySelector('c-radios').shadowRoot.querySelectorAll('input')].map((i) => i.checked));
  assert.deepEqual(checked, [false, true]);
});

// No org: the same hidden radio inside an iframe (a Visualforce page); its label is marked and found in that frame.
test('a visually hidden radio in an iframe is clicked through its label', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const radio = (v) => `<span style="position:relative;display:block"><input type="radio" id="${v}" name="p" style="position:absolute;left:4px;top:4px;width:1px;height:1px;margin:0;opacity:0"><label for="${v}"><span style="position:relative;display:inline-block;width:16px;height:16px;border:1px solid"></span> ${v}</label></span>`;
  await page.setContent(`<iframe srcdoc="${`<fieldset><legend>Steps path</legend>${radio('Short')}${radio('Long')}</fieldset>`.replace(/"/g, '&quot;')}"></iframe>`);
  const frame = page.locator('iframe').contentFrame();
  await act.click(frame, { role: 'radio', name: 'Long', timeout: 2_000 });
  assert.equal(await frame.getByRole('radio', { name: 'Long' }).isChecked(), true);
});

// No org: hover with focus on a hidden radio focuses the radio itself, not the label standing in for its box.
test('hover with focus on a visually hidden radio focuses the radio', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const radio = (v) => `<span style="position:relative;display:block"><input type="radio" id="${v}" name="p" style="position:absolute;left:4px;top:4px;width:1px;height:1px;margin:0;opacity:0"><label for="${v}"><span style="position:relative;display:inline-block;width:16px;height:16px;border:1px solid"></span> ${v}</label></span>`;
  await page.setContent(`<main><fieldset><legend>Steps path</legend>${radio('Short')}${radio('Long')}</fieldset></main>`);
  await act.hover(page, { role: 'radio', name: 'Long', focus: true, timeout: 2_000 });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'Long');
});

// No org: a 1px input nothing covers, whose only label is hidden, is clicked itself, not through the hidden label.
test('a hidden input whose label does not show is clicked directly', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><input type="checkbox" id="c" aria-label="Opt in" style="width:1px;height:1px;margin:0"><label for="c" style="display:none">Opt in</label></main>');
  await act.click(page, { role: 'checkbox', name: 'Opt in', timeout: 2_000 });
  assert.equal(await page.locator('#c').isChecked(), true);
});

// No org: lightning-input-rich-text shows a read view until clicked, then swaps in its textbox, as on the org.
test('fill opens a rich text editor from its read view, then types', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><div role="group" aria-label="Story"><div role="toolbar" aria-label="Text Formatting"><button>Bold</button></div><lightning-formatted-rich-text style="display:block;min-height:40px">Tell it</lightning-formatted-rich-text></div></main><script>
    document.querySelector('lightning-formatted-rich-text').addEventListener('click', (e) => e.target.outerHTML = '<div role="textbox" aria-label="Story" contenteditable="true" style="min-height:40px" oninput="window.typed = this.textContent"></div>');
  </script>`);
  await act.fill(page, { name: 'Story', value: 'Once upon', timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.typed), 'Once upon');
  await assert.rejects(act.fill(page, { name: 'Plot', value: 'x', timeout: 500 }), { code: 'NOT_FOUND' });
  // The editor already open: an nth past its one textbox is a miss, not a closed editor, so nothing is clicked.
  await page.evaluate(() => { window.clicked = 0; document.querySelector('[role=group][aria-label=Story]').addEventListener('click', () => { window.clicked += 1; }); });
  await assert.rejects(act.fill(page, { name: 'Story', value: 'x', nth: 2, timeout: 500 }), (e) => e.code === 'NOT_FOUND' && e.evidence.count === 1);
  assert.equal(await page.evaluate(() => window.clicked), 0);
});

// No org: a closed editor opens only when nothing matched by name: any match, an nth past 1 or an aim by row or column
// is a miss of its own, and nothing on the page is clicked.
test('fill opens a closed rich text editor only when nothing else matched', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const closed = (before) => page.setContent(`<main>${before}<div role="group" aria-label="Story"><div role="toolbar" aria-label="Text Formatting"><button>Bold</button></div><lightning-formatted-rich-text style="display:block;min-height:40px">Tell it</lightning-formatted-rich-text></div></main><script>
    window.clicked = 0;
    document.querySelector('[role=group][aria-label=Story]').addEventListener('click', () => { window.clicked += 1; });
    document.querySelector('lightning-formatted-rich-text').addEventListener('click', (e) => e.target.outerHTML = '<div role="textbox" aria-label="Story" contenteditable="true" style="min-height:40px"></div>');
  </script>`);
  for (const [before, aim, count] of [
    ['', { nth: 2 }, 0],
    ['<input aria-label="Story">', { nth: 2 }, 1],
    ['', { column: 'Nope' }, 0],
    ['<table><tr><td>Acme</td></tr></table>', { row: 'Acme' }, 0],
  ]) {
    await closed(before);
    await assert.rejects(act.fill(page, { name: 'Story', value: 'x', timeout: 500, ...aim }), (e) => e.code === 'NOT_FOUND' && e.evidence.count === count, JSON.stringify(aim));
    assert.equal(await page.evaluate(() => window.clicked), 0, JSON.stringify(aim));
  }
});

// No org: two cards each with a "Invoice" button and no table to narrow by; nth picks the second in page order.
test('nth picks one of several same-named buttons outside a table', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><article>Part 1 <button onclick="window.hit = 1">Invoice</button></article><article>Part 2 <button onclick="window.hit = 2">Invoice</button></article></main>');
  await assert.rejects(act.click(page, { name: 'Invoice', timeout: 500 }), { code: 'AMBIGUOUS' });
  await act.click(page, { name: 'Invoice', nth: 2, timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.hit), 2);
  // nth past the matches is not there, so NOT_FOUND naming the nth asked for, not AMBIGUOUS over too few.
  await assert.rejects(act.click(page, { name: 'Invoice', nth: 3, timeout: 500 }), { code: 'NOT_FOUND', message: 'NOT_FOUND: 2 buttons named "Invoice", so no number 3' });
  // One match and nth past it: refused at once, not a 30 s wait on a second element that is not there.
  await page.setContent('<main><article>Part 1 <button>Invoice</button></article></main>');
  const start = Date.now();
  await assert.rejects(act.click(page, { name: 'Invoice', nth: 2, timeout: 500 }), { code: 'NOT_FOUND', message: 'NOT_FOUND: 1 buttons named "Invoice", so no number 2' });
  // Nothing matched at all: the name missed, so the message does not blame nth.
  await assert.rejects(act.click(page, { name: 'Refund', nth: 2, timeout: 500 }), { code: 'NOT_FOUND', message: 'NOT_FOUND: 0 buttons named "Refund"' });
  assert.ok(Date.now() - start < 5_000, `${Date.now() - start} ms`);
});

// No org: a list view names each row's checkbox by its position ("Select Item 2"), so a route picks it by row and role.
test('row and role with no name reach the row\'s one element of that role', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const tr = (n, name) => `<tr><td><input type="checkbox" aria-label="Select Item ${n}"></td><th scope="row">${name}</th><td><button>Edit ${name}</button></td></tr>`;
  await page.setContent(`<main><table><tbody>${tr(1, 'Order one')}${tr(2, 'Order two')}</tbody></table></main>`);
  await act.click(page, { row: 'Order two', role: 'checkbox', timeout: 2_000 });
  assert.deepEqual(await page.getByRole('checkbox').evaluateAll((c) => c.map((x) => x.checked)), [false, true]);
  await assert.rejects(act.click(page, { role: 'checkbox', timeout: 500 }), { code: 'BAD_ARGS' });
  await page.setContent(`<main><table><tbody><tr><td><input type="checkbox" aria-label="a"><input type="checkbox" aria-label="b"></td><th>Order one</th></tr></tbody></table></main>`);
  await assert.rejects(act.click(page, { row: 'Order one', role: 'checkbox', timeout: 500 }), { code: 'AMBIGUOUS' });
});

// No org: a quick action's dialog shows its frame and close button first and its fields a moment later.
test('modal.find with body returns a dialog once its body has drawn, not at its bare frame', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<div role="dialog" aria-modal="true" aria-label="Bump" id="d"><button title="Cancel and close">Cancel and close</button><input style="display:none"></div>
    <script>setTimeout(() => document.getElementById('d').insertAdjacentHTML('beforeend', '<input aria-label="Count"><button>Save</button>'), 800);</script>`);
  const t0 = Date.now();
  const d = await modal.find({ page }, { timeout: 5_000, body: true });
  assert.equal(await d.getByRole('textbox', { name: 'Count' }).count(), 1, 'Count drawn by the time find returns');
  assert.ok(Date.now() - t0 < 3_000, `a hidden field already in the frame is not waited on: ${Date.now() - t0} ms`);
});

// No org: what counts as a dialog's body, how long a dialog with none costs, and that a step inside one never waits.
test('modal.find body: an icon close or a Cancel is not the body, a frame is, text alone costs the timeout, 0 checks once', { timeout: 60_000 }, async (t) => {
  const page = await localPage(t);
  const later = (html) => `<script>setTimeout(() => document.getElementById('d').insertAdjacentHTML('beforeend', '${html}'), 800);</script>`;
  const timed = async (html, opts = { timeout: 3_000, body: true }) => { await page.setContent(html); const t0 = Date.now(); await modal.find({ page }, opts); return Date.now() - t0; };
  const closers = '<button title="Close"><svg></svg></button><button title="Cancel and close"><svg></svg></button><button>Cancel</button>';
  const icon = await timed(`<div role="dialog" aria-modal="true" id="d">${closers}</div>${later('<input aria-label="Count">')}`);
  assert.ok(icon >= 700 && icon < 2_500, `waited for the field past icon closes and a Cancel: ${icon} ms`);
  const frame = await timed('<div role="dialog" aria-modal="true" id="d"><button title="Close">Close</button><iframe srcdoc="<p>vf</p>"></iframe></div>');
  assert.ok(frame < 1_000, `a Visualforce frame is the body: ${frame} ms`);
  const text = '<div role="dialog" aria-modal="true" id="d"><button title="Close">Close</button><p>Record saved.</p></div>';
  const alone = await timed(text);
  assert.ok(alone >= 2_500 && alone < 4_500, `a text-only dialog costs the caller's timeout and no more: ${alone} ms`);
  const once = await timed(text, { timeout: 0, body: true });
  assert.ok(once < 1_000, `timeout 0 checks once instead of waiting for ever: ${once} ms`);
  await page.setContent('<main></main>');
  assert.equal(await modal.open({ page }, { timeout: 0 }), null, 'timeout 0 with no dialog answers null at once');
  // The frame and the body share one deadline: a frame at 1 s whose body never draws returns by the 2 s asked for.
  const late = await timed(`<main></main><script>setTimeout(() => document.querySelector('main').outerHTML = '${text}', 1000);</script>`, { timeout: 2_000, body: true });
  assert.ok(late >= 1_800 && late < 2_800, `frame and body within one timeout: ${late} ms`);
  const step = await timed(text, { timeout: 3_000 });
  assert.ok(step < 1_000, `without body (a step inside the dialog) find returns at the frame: ${step} ms`);
});

// No org: checking that a dialog closed must not cost a 30 s timeout; open answers null after its short wait.
test('modal.open answers null soon when no dialog shows, and the dialog when one does', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><button>Go</button></main>');
  const start = Date.now();
  assert.equal(await modal.open({ page }, { timeout: 500 }), null);
  assert.ok(Date.now() - start < 3_000, `${Date.now() - start} ms`);
  await page.setContent('<div role="dialog" aria-label="Edit Qty"><button>Close</button></div>');
  assert.equal(await (await modal.open({ page }, { timeout: 500 })).getAttribute('aria-label'), 'Edit Qty');
});

// No org: a box that reads its value on change (a Lightning date input) takes typed text only once focus leaves it.
test('press sends a key to the focused element, and refuses a key name it does not know', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><label>Visit date <input onchange="window.changed = this.value"></label><button>Next</button></main>');
  await act.fill(page, { name: 'Visit date', value: 'Oct 20, 2026' });
  assert.equal(await page.evaluate(() => window.changed), undefined, 'fill alone fires no change');
  await act.press(page, { key: 'Tab' });
  assert.equal(await page.evaluate(() => window.changed), 'Oct 20, 2026');
  await assert.rejects(act.press(page, { key: 'Tabb' }), { code: 'BAD_ARGS' });
});

// No org: a column with no row aims at a cell in every row; a miss there still shows the table to re-aim from.
test('a column miss with no row carries a snapshot', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main><table><thead><tr><th scope="col">Name</th><th scope="col">Act</th></tr></thead><tbody><tr><td>Order one</td><td><button>Save Order</button></td></tr><tr><td>Order two</td><td><button>Save Order</button></td></tr></tbody></table></main>')}`);
  const miss = await act.click(page, { name: 'Save Trp', column: 'Act', timeout: 500 }).then(() => null, (x) => x);
  assert.equal(miss?.code, 'NOT_FOUND', String(miss));
  assert.match(miss.evidence.snapshot, /row "Order two Save Order"/);
});

// No org: a local page shows text 700 ms late and stamps when it did and its own click, on this machine's clock.
test('click and waitFor return when the click happened and when the text showed', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><button onclick="window.clickedAt = Date.now()">Go</button></main>');
  await page.evaluate(() => setTimeout(() => { document.querySelector('main').append('late text'); window.shownAt = Date.now(); }, 700));
  const { [AT]: { seen } } = await act.waitFor(page.locator('body'), { text: 'late text' });
  const shownAt = await page.evaluate(() => window.shownAt);
  assert.ok(Date.parse(seen) >= shownAt && Date.parse(seen) - shownAt < 1000, JSON.stringify({ shownAt, seen }));
  const { [AT]: { clicked } } = await act.click(page.locator('body'), { name: 'Go' });
  const inPage = await page.evaluate(() => window.clickedAt);
  assert.ok(Date.parse(clicked) >= inPage && Date.parse(clicked) - inPage < 1000, JSON.stringify({ inPage, clicked }));
});

// No org: waitFor with any on local pages, one per case. A toast is the force:showToast event the recorder hears.
test('waitFor any returns the first condition that holds, and toasts', { timeout: 60_000 }, async (t) => {
  const browser = (await localPage(t)).context().browser();
  const page = async (html = '<main></main>') => { const p = await localPage(t, browser); await p.goto(`data:text/html,${encodeURIComponent(html)}`); return p; };
  const toast = (p, title) => p.evaluate((x) => window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'error', title: x } })), title);
  const later = (p, ms, js) => p.evaluate(([m, j]) => setTimeout(() => { eval(j); window.doneAt = Date.now(); }, m), [ms, js]);

  await t.test('the second condition holding first is matched, and seen is when it showed', async () => {
    const p = await page();
    await later(p, 700, "document.querySelector('main').append('second text')");
    const start = new Date().toISOString();
    const r = await act.waitFor(p.locator('body'), { any: [{ text: 'never there' }, { text: 'second text' }] });
    const end = new Date().toISOString();
    const doneAt = await p.evaluate(() => window.doneAt);
    assert.deepEqual(r.matched, { index: 1, text: 'second text' });
    assert.ok(start <= r[AT].seen && r[AT].seen <= end, JSON.stringify({ start, seen: r[AT].seen, end }));
    assert.ok(Date.parse(r[AT].seen) >= doneAt && Date.parse(r[AT].seen) - doneAt < 500, JSON.stringify({ doneAt, seen: r[AT].seen }));
  });

  await t.test('a gone condition holds only once the text has left', async () => {
    const p = await page('<main><p>Processing</p></main>');
    await later(p, 300, "document.querySelector('p').remove()");
    const r = await act.waitFor(p.locator('body'), { any: [{ text: 'never there' }, { text: 'Processing', gone: true }] });
    assert.deepEqual(r.matched, { index: 1, text: 'Processing', gone: true });
    assert.equal(await p.getByText('Processing').count(), 0);
  });

  // The toast shows 300 to 600 ms, gone long before the text at 1500 ms; the page was never armed before the wait.
  await t.test('a toast that came and went during the wait is matched before a later text', async () => {
    const p = await page();
    await later(p, 300, "window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'error', title: 'Document Scan Error' } }))");
    await later(p, 1500, "document.querySelector('main').append('Fields filled')");
    const r = await act.waitFor(p.locator('body'), { any: [{ text: 'Fields filled' }, { toast: 'Scan Error' }] });
    assert.deepEqual(r.matched, { index: 1, toast: 'Scan Error' });
    assert.deepEqual(r.toasts.map((x) => x.title), ['Document Scan Error']);
  });

  // An action arms (clears) the recorder, so its toast is matched even if it was raised before the wait began,
  // and a toast from the action before it is not.
  await t.test('a toast since the last action matches; one from before that action does not', async () => {
    const p = await page();
    await act.armToasts(p);
    await toast(p, 'Old error');
    await act.armToasts(p);
    await toast(p, 'Scan Error');
    const r = await act.waitFor(p.locator('body'), { any: [{ text: 'never there' }, { toast: 'Scan Error' }], timeout: 1_000 });
    assert.deepEqual([r.matched.index, r.toasts.map((x) => x.title)], [1, ['Scan Error']]);
    await assert.rejects(act.waitFor(p.locator('body'), { any: [{ toast: 'Old error' }], timeout: 500 }), { code: 'TIMEOUT' });
  });

  // The list is kept in Node, so a full document load between the toast and the wait does not drop it.
  await t.test('a toast raised before a reload still matches after it', async () => {
    const p = await page();
    await p.goto('data:text/html,<main>loaded</main>');
    await act.armToasts(p);
    await toast(p, 'Before reload');
    await p.evaluate(() => { window.marker = 1; });
    await p.reload();
    assert.equal(await p.evaluate(() => window.marker), undefined, 'the control: the document was replaced');
    const r = await act.waitFor(p.locator('body'), { any: [{ text: 'never there' }, { toast: 'Before reload' }], timeout: 2_000 });
    assert.deepEqual(r.matched, { index: 1, toast: 'Before reload' });
  });

  // A page script, a quick action or a fill raises a toast with no click before it: recorded all the same.
  await t.test('a toast with no click, save or upload before it is recorded', async () => {
    const p = await page();
    await toast(p, 'Unprompted');
    assert.deepEqual((await act.toasts(p, { timeout: 2_000 })).map((x) => x.title), ['Unprompted']);
  });

  // As a text condition matches: case and runs of whitespace are ignored.
  await t.test('a toast matches whatever its case and spacing', async () => {
    const p = await page();
    await toast(p, 'Document  Scan\nERROR');
    const r = await act.waitFor(p.locator('body'), { any: [{ toast: ' scan error' }], timeout: 1_000 });
    assert.deepEqual(r.matched, { index: 0, toast: ' scan error' });
  });

  // Real navigations from a local server (Chrome blocks a page sending itself to a data: URL). /next shows
  // "arrived"; /loop shows "marker" and reloads every 120 ms, so the text is never gone for two polls in a row.
  await t.test('a wait keeps waiting across a navigation, and a closed page fails at once', async () => {
    const send = { '/': '<main>before</main><script>setTimeout(() => { location.href = "/next"; }, 300)</script>',
      '/next': '<main>arrived</main>', '/loop': '<main>marker</main><script>setTimeout(() => location.reload(), 120)</script>' };
    const server = require('node:http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(send[q.url] || ''); }).listen(0);
    await require('node:events').once(server, 'listening');
    t.after(() => server.close());
    const url = `http://127.0.0.1:${server.address().port}`;
    const moving = await page();
    await moving.goto(`${url}/`);
    await act.waitFor(moving.locator('body'), { text: 'arrived', timeout: 5_000 });
    assert.equal(moving.url(), `${url}/next`);
    const loop = await page();
    await loop.goto(`${url}/loop`);
    await assert.rejects(act.waitFor(loop.locator('body'), { text: 'marker', gone: true, timeout: 2_000 }), { code: 'TIMEOUT' });
    const p = await page();
    await p.close();
    const start = Date.now();
    await assert.rejects(act.waitFor(p.locator('body'), { text: 'x', timeout: 5_000 }), /has been closed/);
    assert.ok(Date.now() - start < 2_000, `failed after ${Date.now() - start} ms, not at once`);
  });

  // A scope whose count follows a script, so a swap's lone zero lands on a known poll: 1,0,1,0 never holds gone,
  // and 1,1,0,0 holds it with seen at the first zero.
  await t.test('gone holds only on two zero counts in a row, seen at the first', async () => {
    const scripted = (counts, polls) => ({ page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '',
      getByText: () => ({ locator: () => ({ nth: () => ({ evaluate: async () => ({ covered: [], checked: 1 }) }), // a painted copy
        count: async () => { polls.push(Date.now()); return counts[polls.length - 1] ?? counts.at(-1); } }) }) });
    const flicker = [];
    await assert.rejects(act.waitFor(scripted([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], flicker), { text: 'x', gone: true, timeout: 800 }), { code: 'TIMEOUT' });
    const polls = [];
    const { [AT]: { seen } } = await act.waitFor(scripted([1, 1, 0, 0], polls), { text: 'x', gone: true, timeout: 2_000 });
    assert.ok(polls.length === 4 && Date.parse(seen) >= polls[2] && Date.parse(seen) < polls[3], JSON.stringify({ polls, seen }));
    // A 0 counted while the document was replaced (a reload under load) is no 0: every read here straddles a swap.
    const swapping = { ...scripted([0], []), page: () => { let d = 0; return { context: () => ({}), evaluate: async () => (d += 1) }; } };
    await assert.rejects(act.waitFor(swapping, { text: 'x', gone: true, timeout: 500 }), { code: 'TIMEOUT' });
    // Two document reads that both fail (a closing page) are no evidence the 0 was one document's, so no gone either.
    const unread = { ...scripted([0], []), page: () => ({ context: () => ({}), evaluate: async () => { throw new Error('page closing'); } }) };
    await assert.rejects(act.waitFor(unread, { text: 'x', gone: true, timeout: 500 }), { code: 'TIMEOUT' });
  });

  // Per-text count scripts, one count per condition per poll. The first condition to hold wins, the lower index on the
  // same poll; a lower gone whose first zero is that poll gets one poll to confirm, and seen is never later than first held.
  await t.test('the first condition to hold wins, a gone confirmed a poll late keeps its tie, and waits stop one poll late', { timeout: 10_000 }, async () => {
    const per = (scripts, calls = {}) => { const n = {}; return { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '',
      getByText: (x) => ({ locator: () => ({ nth: () => ({ evaluate: async () => ({ covered: [], checked: 0 }) }), count: async () => { n[x] = (n[x] || 0) + 1; (calls[x] ||= []).push(Date.now()); const c = scripts[x]; return c[n[x] - 1] ?? c.at(-1); } }) }) }; };
    const pick = async (scripts, any, calls) => (await act.waitFor(per(scripts, calls), { any, timeout: 2_000 }));
    const [A, B, C, D, E] = [{ text: 'A', gone: true }, { text: 'B', gone: true }, { text: 'C' }, { text: 'D', gone: true }, { text: 'E' }];
    // a tie: A's first zero and C on poll 0, A confirms on poll 1, so A wins with seen at poll 0
    assert.deepEqual((await pick({ A: [0, 0], C: [1, 1] }, [A, C])).matched, { index: 0, ...A });
    // A does not confirm, so C wins, with seen at its first poll, not the second
    const calls = {};
    const c = await pick({ A: [0, 1], C: [1, 1] }, [A, C], calls);
    assert.deepEqual(c.matched, { index: 1, ...C });
    assert.ok(Date.parse(c[AT].seen) < calls.C[1], 'seen is the poll C first held');
    // C held on poll 0; D confirms on poll 1 with seen poll 0 but a higher index, E holds only from poll 1: C still wins
    assert.deepEqual((await pick({ A: [0, 1], C: [1, 0], D: [0, 0] }, [A, C, D])).matched, { index: 1, ...C });
    assert.deepEqual((await pick({ A: [0, 1], C: [1, 0], E: [1] }, [A, C, E])).matched, { index: 1, ...C });
    // D's zeros start on poll 0 and confirm on poll 1; C at a lower index only shows on poll 1, so D held first and wins
    assert.deepEqual((await pick({ C: [0, 1], D: [0, 0] }, [C, D])).matched, { index: 1, ...D });
    // B's first zero comes after C held, so C wins at once, not when B confirms
    const t1 = Date.now();
    assert.deepEqual((await pick({ A: [0, 1], B: [1, 0, 0], C: [1] }, [A, B, C])).matched, { index: 2, ...C });
    assert.ok(Date.now() - t1 < 1_000, `returned after ${Date.now() - t1} ms`);
    // two gones pending either side of C: A (lower) confirms and wins; a gone pending only above C does not hold it
    assert.deepEqual((await pick({ A: [0, 0], C: [1], B: [0, 0] }, [A, C, B])).matched, { index: 0, ...A });
    const k3 = {};
    assert.deepEqual((await pick({ C: [1], B: [0, 0] }, [C, B], k3)).matched, { index: 0, ...C });
    assert.equal(k3.B.length, 1, 'a gone above C held it a poll');
    // at timeout 0: a gone's first zero gets its confirming poll; a plain miss gets none; a hold on that poll still returns
    assert.deepEqual((await act.waitFor(per({ A: [0, 0] }), { any: [A], timeout: 0 })).matched, { index: 0, ...A });
    const k4 = {};
    await assert.rejects(act.waitFor(per({ C: [0] }, k4), { any: [C], timeout: 0 }), { code: 'TIMEOUT' });
    assert.equal(k4.C.length, 1, 'a plain miss got an extra poll');
    // a lower gone pending on the deadline winner's poll still gets its confirming poll
    assert.deepEqual((await act.waitFor(per({ A: [0, 0], C: [1] }), { any: [A, C], timeout: 0 })).matched, { index: 0, ...A });
    assert.deepEqual((await act.waitFor(per({ A: [1, 0], C: [0, 1], B: [0, 1] }), { any: [A, C, B], timeout: 0 })).matched, { index: 1, ...C });
    // the same condition object twice is two conditions: one zero confirms neither
    await assert.rejects(act.waitFor(per({ A: [0, 0, 1] }), { any: [A, A], timeout: 300 }), { code: 'TIMEOUT' }); // A is read twice a poll
    // two gones that alternate past the deadline get one extra poll, not an endless wait
    const t0 = Date.now();
    const alt = (start) => Array.from({ length: 40 }, (_, i) => (i + start) % 2);
    // ... and alternating lower gones never keep a held C waiting: it returns on the next poll
    const t2 = Date.now();
    assert.deepEqual((await pick({ A: alt(0), B: alt(1), C: [1] }, [A, B, C])).matched, { index: 2, ...C });
    assert.ok(Date.now() - t2 < 1_000, `held C returned after ${Date.now() - t2} ms`);
    await assert.rejects(act.waitFor(per({ a: alt(0), b: alt(1) }), { any: [{ text: 'a', gone: true }, { text: 'b', gone: true }], timeout: 0 }), { code: 'TIMEOUT' });
    assert.ok(Date.now() - t0 < 1_000, `stopped after ${Date.now() - t0} ms`);
  });

  // near: stale matches that each burn their read timeout stop at the whole search's 3 s; a closed page keeps the
  // partial list, and any other error (a bug) surfaces instead of an empty near.
  await t.test('near stops at 3 s over stale matches, keeps a closed page partial, and surfaces a bug', { timeout: 20_000 }, async () => {
    const stale = { evaluate: (fn, arg, { timeout }) => new Promise((_, no) => setTimeout(() => no(new Error('Timeout')), timeout)) };
    const t0 = Date.now();
    assert.deepEqual(await act.near('Order', () => ({ all: async () => Array(10).fill(stale) })), []);
    assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`); // 3 s plus one 1 s read
    assert.deepEqual(await act.near('Order', () => ({ all: async () => { throw new Error('Target page, context or browser has been closed'); } })), []);
    await assert.rejects(act.near('Order', () => ({ all: async () => { throw new TypeError('boom'); } })), /boom/);
  });

  // One match whose evaluate honours the timeout it is given; without one it answers painted after 3 s (a real stall is 30 s).
  await t.test('a match whose covered read is lost is skipped until the time is up, then shown; any other error surfaces', { timeout: 10_000 }, async () => {
    const vanishing = (fail) => ({ page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '',
      getByText: () => ({ locator: () => ({ count: async () => 1, nth: () => ({ evaluate: (fn, arg, o) => (o?.timeout ? Promise.reject(fail) : new Promise((r) => setTimeout(r, 3_000, { covered: [], checked: 1 }))) }) }) }) });
    // A busy page, or a match gone since the count, loses every read: the text in the DOM is shown as on main, but only at the deadline.
    const t0 = Date.now();
    const e = await act.waitFor(vanishing(Object.assign(new Error('Timeout 250ms exceeded'), { name: 'TimeoutError' })), { text: 'x', timeout: 600 }).then((r) => r, (x) => x);
    const took = Date.now() - t0;
    assert.equal(e?.coverUnchecked, true, String(e));
    assert.ok(took >= 550 && took < 5_000, `took ${took} ms`);
    // With any, a lost read is weighed after the polls, so another condition's slow poll cannot carry it past the deadline.
    const anyLost = await act.waitFor(vanishing(Object.assign(new Error('Timeout'), { name: 'TimeoutError' })), { any: [{ toast: 'never' }, { text: 'x' }], timeout: 300 });
    assert.deepEqual([anyLost.matched, anyLost.coverUnchecked], [{ index: 1, text: 'x' }, true]);
    // A save that navigates destroys the context mid-read: that match is skipped too, not an error.
    const nav = new Error('locator.evaluate: Execution context was destroyed, most likely because of a navigation');
    assert.equal((await act.waitFor(vanishing(nav), { text: 'x', timeout: 600 })).coverUnchecked, true);
    assert.equal((await act.waitFor(vanishing(new Error('locator.evaluate: Frame was detached')), { text: 'x', timeout: 600 })).coverUnchecked, true);
    // One copy collapsed, the other's read lost on every poll: the lost copy is unread, so shown with coverUnchecked.
    const half = { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '', getByText: () => ({ locator: () => ({ count: async () => 2,
      nth: (i) => ({ evaluate: (fn, arg, o) => (i ? new Promise((_, no) => setTimeout(no, o.timeout, Object.assign(new Error('Timeout'), { name: 'TimeoutError' })))
        : Promise.resolve({ covered: [], checked: 0, clipped: true })) }) }) }) };
    assert.equal((await act.waitFor(half, { text: 'x', timeout: 300 }).then((r) => r, (x) => x))?.coverUnchecked, true);
    // Covered on the early polls, every read skipped on the last: the cover seen last still names the failure.
    let reads = 0;
    const late = { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '', getByText: () => ({ locator: () => ({ count: async () => 1,
      nth: () => ({ evaluate: async () => { if ((reads += 1) > 2) throw Object.assign(new Error('Timeout 1000ms exceeded'), { name: 'TimeoutError' }); return { covered: [{ text: 'x', top: { tag: 'span', label: '' } }], checked: 1 }; } }) }) }) };
    assert.equal((await act.waitFor(late, { text: 'x', timeout: 600 }).then(() => null, (x) => x))?.code, 'TEXT_COVERED');
    await assert.rejects(act.waitFor(vanishing(new Error('boom')), { text: 'x', timeout: 600 }), (x) => x.message === 'boom');
    await assert.rejects(act.waitFor(vanishing(new Error('canvas context lost')), { text: 'x', timeout: 600 }), (x) => x.message === 'canvas context lost'); // a page bug, not a navigation
    // Three slow matches on a short wait: each read gets the time left, not a full second, so the wait ends near its timeout.
    const slow = { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '', getByText: () => ({ locator: () => ({ count: async () => 3,
      nth: () => ({ evaluate: (fn, arg, o) => new Promise((_, no) => setTimeout(no, o.timeout, Object.assign(new Error('Timeout'), { name: 'TimeoutError' }))) }) }) }) };
    const t1 = Date.now();
    assert.equal((await act.waitFor(slow, { text: 'x', timeout: 300 })).coverUnchecked, true);
    assert.ok(Date.now() - t1 < 2_000, `took ${Date.now() - t1} ms`);
    // timeoutMs 0 checks once: a lost read is shown at once, not a TIMEOUT for a text the DOM has.
    assert.equal((await act.waitFor(vanishing(Object.assign(new Error('Timeout'), { name: 'TimeoutError' })), { text: 'x', timeout: 0 })).coverUnchecked, true);
    // A read that has found its match but runs on in the page: Playwright's timeout no longer applies, the time left does.
    const stuck = { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '', getByText: () => ({ locator: () => ({ count: async () => 1, nth: () => ({ evaluate: () => new Promise(() => {}) }) }) }) };
    const t2 = Date.now();
    const out = await Promise.race([act.waitFor(stuck, { text: 'x', timeout: 300 }).then((r) => r, (x) => x), new Promise((r) => { setTimeout(r, 4_000, 'still reading').unref(); })]);
    assert.equal(out?.coverUnchecked, true, String(out));
    assert.ok(Date.now() - t2 < 2_000, `took ${Date.now() - t2} ms`);
  });

  // Both hold on the first poll, in either order: the lower index wins.
  await t.test('a tie goes to the lower index', async () => {
    const p = await page('<main>Done</main>');
    await toast(p, 'Saved');
    const [toastFirst, textFirst] = [[{ toast: 'Saved' }, { text: 'Done' }], [{ text: 'Done' }, { toast: 'Saved' }]];
    assert.deepEqual((await act.waitFor(p.locator('body'), { any: toastFirst, timeout: 1_000 })).matched, { index: 0, toast: 'Saved' });
    assert.deepEqual((await act.waitFor(p.locator('body'), { any: textFirst, timeout: 1_000 })).matched, { index: 0, text: 'Done' });
  });

  await t.test('no conditions, one with neither text nor toast, or a gone toast is BAD_ARGS', async () => {
    const p = await page();
    for (const any of [[], [{}], [{ gone: true }], [{ text: 'x' }, {}]]) {
      await assert.rejects(act.waitFor(p.locator('body'), { any, timeout: 300 }), { code: 'BAD_ARGS' }, JSON.stringify(any));
    }
    // A toast is recorded, never removed, so a gone toast would only be a slow match: refused instead.
    await assert.rejects(act.waitFor(p.locator('body'), { any: [{ toast: 'Saved', gone: true }], timeout: 300 }), { code: 'BAD_ARGS', message: /gone is for text/ });
    await assert.rejects(act.waitFor(p.locator('body'), { any: [{ text: 'x' }], gone: true, timeout: 300 }), { code: 'BAD_ARGS' }, 'a top-level gone beside any');
  });

  await t.test('TIMEOUT names every condition and carries the toasts', async () => {
    const p = await page('<main><p>still here</p></main>');
    await act.armToasts(p);
    await toast(p, 'Unrelated');
    const any = [{ text: 'first missing' }, { text: 'still here', gone: true }, { toast: 'third toast' }];
    const e = await act.waitFor(p.locator('body'), { any, timeout: 500 }).then(() => null, (x) => x);
    assert.equal(e?.code, 'TIMEOUT', String(e));
    for (const word of ['"first missing" to show', '"still here" to go', 'a toast with "third toast"']) assert.ok(e.message.includes(word), e.message);
    assert.deepEqual([e.evidence.conditions, e.evidence.toasts.map((x) => x.title)], [any, ['Unrelated']]);
    await assert.rejects(act.waitFor(p.locator('body'), { any: [{ text: 'x', toast: 'y' }] }), { code: 'BAD_ARGS' });
  });

  // Playwright read 0 as no limit; here it is one check, so a text that is not there yet fails at once.
  await t.test('timeout 0 checks once', async () => {
    const p = await page('<main>here now</main>');
    assert.equal(Object.keys(await act.waitFor(p.locator('body'), { text: 'here now', timeout: 0 })).length, 0);
    const outcome = act.waitFor(p.locator('body'), { any: [{ text: 'not yet' }], timeout: 0 }).then(() => 'held', (e) => e.code);
    assert.equal(await Promise.race([outcome, new Promise((r) => setTimeout(() => r('still waiting'), 2_000))]), 'TIMEOUT');
  });

  await t.test('a single text call returns and fails as before, with no matched or toasts', async () => {
    const p = await page('<main>here now</main>');
    const r = await act.waitFor(p.locator('body'), { text: 'here now' });
    assert.deepEqual([Object.keys(r), Object.getOwnPropertySymbols(r)], [[], [AT]]);
    const e = await act.waitFor(p.locator('body'), { text: 'not here', timeout: 300 }).then(() => null, (x) => x);
    assert.deepEqual([e?.code, Object.keys(e.evidence)], ['TIMEOUT', ['text', 'gone', 'timeout', 'snapshot']]);
  });
});

// act.hover on a local page: a hover colour, a tooltip shown only while the mouse is over its wrapper, and a focus
// outline; the control for each is the same reading before the hover, or after a hover without focus.
test('act hover, no org', async (t) => {
  const page = await localPage(t);
  await page.setContent(`<style>button.h:hover{background:rgb(255,0,0)} button.h:focus{outline:3px solid rgb(0,0,255)}
    .tip{display:none} .wrap:hover .tip{display:block} a.v{outline:none} a.v:focus-visible{outline:2px dashed rgb(0,128,0)}</style>
    <div class="wrap"><button class="h">Go</button><span class="tip">Tip text</span></div><button>Other</button>
    <a class="v" href="#x">Visible ring</a><span class="icon">Info</span>`);
  const body = page.locator('body');
  const { layer } = require('..');
  const read = async () => {
    const r = (await layer.measure(body, { selector: 'button.h', styles: ['background-color', 'outline-style'] })).elements[0].styles;
    return [r['background-color'], r['outline-style'], (await layer.measure(body, { selector: '.tip' })).rendered];
  };

  await t.test('hover applies the hover style and shows the tooltip, without focus', async () => {
    const before = await read();
    assert.notEqual(before[0], 'rgb(255, 0, 0)');
    assert.equal(before[2], 0);
    const r = await act.hover(body, { name: 'Go' });
    assert.ok(r[AT].hovered);
    assert.deepEqual(await read(), ['rgb(255, 0, 0)', before[1], 1]);
  });

  await t.test('focus adds the focus outline, and the hover moves with the next hover', async () => {
    await act.hover(body, { name: 'Go', focus: true });
    assert.equal((await read())[1], 'solid');
    await act.hover(body, { name: 'Other' });
    const after = await read();
    assert.deepEqual([after[0] !== 'rgb(255, 0, 0)', after[2]], [true, 0], JSON.stringify(after));
  });

  // After a mouse click Chrome draws no :focus-visible ring on a programmatic focus; the keyboard press restores it.
  await t.test('a focus-visible ring shows after an earlier click', async () => {
    await act.click(body, { name: 'Other' });
    await act.hover(body, { name: 'Visible ring', role: 'link', focus: true });
    const ring = (await layer.measure(body, { selector: 'a.v', styles: ['outline-style'] })).elements[0].styles['outline-style'];
    assert.equal(ring, 'dashed');
  });

  await t.test('the keypress reaches the focused target, not what held focus before', async () => {
    await page.evaluate(() => {
      const i = document.createElement('input'); i.setAttribute('aria-label', 'Earlier box'); document.body.append(i);
      window.keysOnEarlier = 0; i.addEventListener('keydown', () => { window.keysOnEarlier += 1; });
    });
    await act.click(body, { name: 'Earlier box', role: 'textbox' });
    await act.hover(body, { name: 'Go', focus: true });
    assert.equal(await page.evaluate(() => window.keysOnEarlier), 0);
  });

  await t.test('focus on an element that cannot hold it throws NOT_FOCUSABLE', async () => {
    await act.click(body, { name: 'Earlier box', role: 'textbox' });
    const keys = await page.evaluate(() => window.keysOnEarlier);
    await assert.rejects(act.hover(body, { text: 'Info', focus: true }), (e) => e.code === 'NOT_FOCUSABLE' && /focus is on input/.test(e.message));
    assert.equal(await page.evaluate(() => window.keysOnEarlier), keys, 'a refused focus sends no key to what holds focus');
    await act.hover(body, { text: 'Info' }); // a hover alone is fine there
  });
});

// No org: the clip card's label holds its hidden hover card, so the label's text is its own plus the card's (F-flow-21).
test('hover by text reaches a label that holds a hidden hover card, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<style>.card{display:none} .host:hover .card{display:block}</style>
    <span class="host">Shipment<span class="card">Hover card: three parcels, one pallet</span></span><p>Shipment details</p>`);
  const body = page.locator('body');
  const { layer } = require('..');
  assert.equal((await layer.measure(body, { selector: '.card' })).rendered, 0);
  await act.hover(body, { text: 'Shipment', timeout: 1_000 });
  assert.equal((await layer.measure(body, { selector: '.card' })).rendered, 1, 'the mouse is on the label, so its card opens');
  await act.hover(body, { text: 'Shipment details', timeout: 1_000 }); // a plain exact text still aims at its own element
  assert.equal((await layer.measure(body, { selector: '.card' })).rendered, 0);
  await assert.rejects(act.hover(body, { text: 'Shipmen', timeout: 1_000 }), (e) => e.code === 'NOT_FOUND'); // still exact
});

// No org: a row named by a text across two cells ("Todo 60"), as the error's rows print it (F-flow-27).
test('row text that crosses a cell boundary finds its one row, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const tr = (n, kind, score) => `<tr><td>Item ${n}</td><td>${kind}</td><td>${score}</td><td><input type=checkbox aria-label="Select Item ${n}"></td></tr>`;
  await page.setContent(`<table>${tr(1, 'Todo', 6)}${tr(2, 'Todo', 60)}${tr(3, 'Done', 60)}</table>`);
  const checked = () => page.$$eval('input', (els) => els.map((e) => e.checked));
  await act.click(page, { role: 'checkbox', row: 'Todo 60', timeout: 1_000 });
  assert.deepEqual(await checked(), [false, true, false]);
  await act.hover(page, { role: 'checkbox', row: 'todo  60', timeout: 1_000 }); // case and spaces as before
  await act.click(page, { role: 'checkbox', row: 'Item 2Todo', timeout: 1_000 }); // the cells run together still match
  assert.deepEqual(await checked(), [false, false, false]);
  await assert.rejects(act.click(page, { role: 'checkbox', row: 'Todo 6', timeout: 500 }),
    (e) => e.code === 'AMBIGUOUS_ROW' && /2 of 3 rows/.test(e.message) && e.evidence.rows[1] === 'Item 2 Todo 60');
  await assert.rejects(act.click(page, { role: 'checkbox', row: 'Todo 61', timeout: 500 }), (e) => e.code === 'ROW_NOT_FOUND');
});

// No org: sf_on_top and sf_measure aim with includeHidden, which adds aria-hidden text to a name: a column header's
// hidden sort label, a required box's asterisk. The name the page shows still finds them (F-fixtures-11, -21).
test('with includeHidden, a name the page shows finds its element, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<table><thead><tr><th scope="col">SFUIC Email<span aria-hidden="true">Sort</span></th><th scope="col">SFUIC Amount</th></tr></thead>
    <tr><td><a href="#">Email two@example.com</a></td><td>$250.00</td></tr></table>
    <label for="n"><abbr title="required" aria-hidden="true">*</abbr>Name</label><input id="n" required>
    <div aria-hidden="true"><button>Behind</button></div>`);
  const { layer } = require('..');
  const hidden = { timeout: 1_000, includeHidden: true };
  const at = (o) => act.resolve(page, { ...hidden, ...o }).then((l) => l.evaluate((e) => e.localName));
  assert.equal(await at({ role: 'link', name: 'Email two@example.com', row: 'two@example.com', column: 'SFUIC Email' }), 'a');
  assert.equal(await at({ role: 'textbox', name: 'Name' }), 'input');
  assert.equal(await at({ role: 'button', name: 'Behind' }), 'button', 'an aria-hidden area still resolves');
  assert.equal((await layer.onTop(page, { text: '$250.00', row: 'two@example.com', column: 'SFUIC Amount', timeout: 1_000 })).visible, 1);
  await assert.rejects(act.resolve(page, { ...hidden, role: 'textbox', name: 'Nam' }), (e) => e.code === 'NOT_FOUND'); // still exact
});

// No org: two tables share a column label; the row names one table, so its own header is the column (F-fixtures-12).
test('a column label shared by two tables is the one in the row\'s table, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<table role="treegrid"><thead><tr><th scope="col">SFUIC Name</th><th scope="col">SFUIC Amount</th></tr></thead>
    <tr><td>SFUIC Row One</td><td>$100.00</td></tr></table>
    <table><thead><tr><th scope="col">SFUIC Note</th><th scope="col">SFUIC Name</th><th scope="col">SFUIC Amount</th></tr></thead>
    <tr><td>$250.00</td><td>SFUIC Row Two</td><td><button>$250.00</button></td></tr></table>`);
  const at = (o) => act.resolve(page, { timeout: 1_000, ...o }).then((l) => l.evaluate((e) => e.outerHTML));
  assert.equal(await at({ text: '$250.00', row: 'SFUIC Row Two', column: 'SFUIC Amount' }), '<button>$250.00</button>');
  assert.equal(await at({ text: '$100.00', row: 'SFUIC Row One', column: 'SFUIC Amount' }), '<td>$100.00</td>');
  await act.hover(page, { role: 'button', name: '$250.00', row: 'SFUIC Row Two', column: 'SFUIC Amount', timeout: 1_000 });
  // With no row, nothing names a table: the shared label is still AMBIGUOUS.
  await assert.rejects(act.resolve(page, { text: '$250.00', column: 'SFUIC Amount', timeout: 500 }), (e) => e.code === 'AMBIGUOUS' && /2 columnheaders/.test(e.message));
});

// No org: the target is the cell under the column itself, aimed by its own role (F-fixtures-22, a chart's table).
test('a cell aimed by its own role with row and column is that cell, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<table><tr><th scope="col">Date</th><th scope="col">New</th><th scope="col">Total</th></tr>
    <tr><th scope="row">Jul 12</th><td>3</td><td>8</td></tr><tr><th scope="row">Jul 13</th><td>12</td><td>39</td></tr></table>
    <div role="grid"><div role="row"><span role="columnheader">Part</span><span role="columnheader">Stock</span></div>
    <div role="row"><span role="rowheader">Washer</span><span role="gridcell"><button>2</button></span></div></div>`);
  const at = (o) => act.resolve(page, { timeout: 1_000, ...o }).then((l) => l.evaluate((e) => e.outerHTML));
  assert.equal(await at({ role: 'cell', name: '39', row: 'Jul 13', column: 'Total' }), '<td>39</td>');
  assert.equal(await at({ role: 'rowheader', name: 'Washer', row: 'Washer', column: 'Part' }), '<span role="rowheader">Washer</span>');
  assert.equal(await at({ role: 'gridcell', name: '2', row: 'Washer', column: 'Stock' }), '<span role="gridcell"><button>2</button></span>');
  // What the cell holds is still found below it, and a cell of another name is still a miss.
  assert.equal(await at({ role: 'button', name: '2', row: 'Washer', column: 'Stock' }), '<button>2</button>');
  await assert.rejects(act.resolve(page, { role: 'cell', name: '12', row: 'Jul 13', column: 'Total', timeout: 500 }), (e) => e.code === 'NOT_FOUND');
  await act.hover(page, { role: 'cell', name: '39', row: 'Jul 13', column: 'Total', timeout: 1_000 });
});

// The repro on the component fixture: the Aura page's tree grid and datatable both have "SFUIC Amount".
test('a column label shared by a tree grid and a datatable aims in the row\'s table', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const app = await session.openApp(s, 'SfUiC_App').catch((e) => { if (e.code === 'APP_UNAVAILABLE') return null; throw e; });
  if (!app) return t.skip('the org has no test/fixture-components app SfUiC_App');
  await nav.openTab(s, 'SfUiC_Aura_Nav');
  // The currency symbol is the org's locale ("$250.00", "₱250.00"), so the amount is matched without it.
  const aim = { text: /250\.00/, row: 'SFUIC Row Two', column: 'SFUIC Amount', timeout: 15_000 };
  assert.match(await (await act.resolve(s.page, aim)).innerText(), /^\D*250\.00$/);
  await act.hover(s.page, aim);
});

// No org: a validation line that collapses on blur moves the button up between press and release, as on the
// fixture's Check code, so no click reaches it; a click that lands and then moves its own button is not a miss.
test('a click whose target moved before the release is TARGET_MOVED; one that lands and moves is not', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><input aria-label="Code" onblur="document.getElementById('err').style.display = 'none'">
    <div id="err" style="height:18px">Use three capital letters</div>
    <button onclick="window.clicks = (window.clicks || 0) + 1">Check code</button>
    <button onclick="window.moves = (window.moves || 0) + 1; this.before(Object.assign(document.createElement('div'), { style: 'height:40px' }))">Grow</button></main>`);
  await page.getByRole('textbox', { name: 'Code' }).focus();
  await assert.rejects(act.click(page, { name: 'Check code', timeout: 2_000 }), (e) => {
    assert.equal(e.code, 'TARGET_MOVED', e.message);
    assert.ok(e.evidence.before.y - e.evidence.after.y > 10, JSON.stringify(e.evidence));
    return true;
  });
  assert.equal(await page.evaluate(() => window.clicks), undefined, 'the button never got the click');
  await act.click(page, { name: 'Check code', timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.clicks), 1, 'with the line gone, the same click lands');
  await act.click(page, { name: 'Grow', timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.moves), 1);
  // A container that takes the click on the way down keeps it from the button, but nothing moved: not a layout shift.
  await page.evaluate(() => {
    const wrap = Object.assign(document.createElement('div'), { innerHTML: '<button>Guarded</button>' });
    wrap.addEventListener('click', (e) => { window.taken = true; e.stopPropagation(); }, { capture: true });
    document.querySelector('main').append(wrap);
  });
  await act.click(page, { name: 'Guarded', timeout: 2_000 });
  assert.equal(await page.evaluate(() => window.taken), true);
  // A press that opens a layer over a button that does not move: the release lands on the layer, so no click either.
  await page.setContent(`<button onmousedown="document.body.insertAdjacentHTML('beforeend', '<div id=veil style=&quot;position:fixed;inset:0&quot;></div>')"
    onclick="window.veiled = true">Veiled</button>`);
  await assert.rejects(act.click(page, { name: 'Veiled', timeout: 2_000 }), (e) => e.code === 'CLICK_MISSED' && e.evidence.box.width > 0 && e.evidence.over?.tag === 'div' && /a layer the press opened over it/.test(e.message));
  assert.equal(await page.evaluate(() => window.veiled), undefined, 'the button never got the click');
  // A blur handler that disables the button at the press: no click reached it either, and no layer is to blame.
  await page.setContent('<input id=a onblur="document.getElementById(\'b\').disabled = true"><button id=b onclick="window.hit = 1">Go</button>');
  await page.focus('#a');
  await assert.rejects(act.click(page, { name: 'Go', timeout: 2_000 }), (e) => e.code === 'CLICK_MISSED' && e.evidence.disabled === true && /disabled/.test(e.message) && !/layer/.test(e.message));
});

// No org: a white span painted over a status line. The text is in the DOM and visible to Playwright, but a user sees
// nothing, so waitFor must not call it shown.
test('waitFor does not take covered text as shown, no org', { timeout: 60_000 }, async (t) => {
  const browser = (await localPage(t)).context().browser();
  const page = async (html) => { const p = await localPage(t, browser); await p.setContent(html); return p; };
  const covered = '<main><p style="position:relative">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p></main>';
  const clean = '<main><p style="position:relative">Size chosen: Large</p></main>';
  const text = 'Size chosen: Large';

  await t.test('covered text rejects TEXT_COVERED naming what covers it', async () => {
    const p = await page(covered);
    const e = await act.waitFor(p.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x);
    assert.equal(e?.code, 'TEXT_COVERED', String(e));
    assert.equal(e.evidence.reason, 'covered');
    assert.deepEqual([e.evidence.covered.length, e.evidence.covered[0].index, e.evidence.covered[0].text, e.evidence.covered[0].top.tag], [1, 0, text, 'span']);
    assert.match(e.message, /"Size chosen: Large" is on the page but covered by span$/);
  });

  await t.test('covered text in an aria-hidden subtree is not weighed (pinned)', async () => {
    const p = await page('<main><p style="position:relative"><b aria-hidden="true">Size chosen: </b><b aria-hidden="true">Large</b><span style="position:absolute;inset:0;background:#fff"></span></p></main>');
    await act.waitFor(p.locator('body'), { text, timeout: 500 });
  });

  // The fixture's utility bar: text under a fixed bottom bar at this scroll is shown once scrolled to; a fixed layer
  // over the whole window still covers it after the scroll.
  await t.test('text under a fixed bar is shown once scrolled to; a fixed layer over the window still covers it', async () => {
    const under = `<main style="height:3000px"><p style="position:absolute;top:calc(100vh - 30px);margin:0">${text}</p></main>`;
    const bar = '<footer style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff">To Do List</footer>';
    const p = await page(under + bar);
    await act.waitFor(p.locator('body'), { text, timeout: 1_000 });
    const q = await page(under + '<div style="position:fixed;inset:0;background:#fff"></div>');
    assert.equal((await act.waitFor(q.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x))?.code, 'TEXT_COVERED');
    // Off-screen where it sits (below the fold, or scrolled out of an inner box) is scrolled to and read, not passed unread.
    const cover = '<div style="position:fixed;inset:0;background:#fff"></div>';
    const below = await page(`<main style="height:3000px"><p style="position:absolute;top:2000px;margin:0">${text}</p></main>${cover}`);
    assert.equal((await act.waitFor(below.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x))?.code, 'TEXT_COVERED');
    const inner = await page(`<div style="height:200px;overflow:auto"><div style="height:1500px"></div><p>${text}</p></div>${cover}`);
    assert.equal((await act.waitFor(inner.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x))?.code, 'TEXT_COVERED');
    const side = await page(`<div style="width:200px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:1500px"></span><span>${text}</span></div>${cover}`);
    assert.equal((await act.waitFor(side.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x))?.code, 'TEXT_COVERED');
    // With nothing over it, off-screen text is scrolled to and shown.
    const free = await page(`<main style="height:3000px"><p style="position:absolute;top:2000px;margin:0">${text}</p></main>`);
    await act.waitFor(free.locator('body'), { text, timeout: 1_000 });
    assert.equal(await free.evaluate(() => window.scrollY), 0, 'the read puts the page back where it was');
    // Shown where it sits: the wait reads it and leaves the page at its scroll.
    const shown = await page(`<main style="height:3000px"><p style="position:absolute;top:calc(50vh + 100px);margin:0">${text}</p></main>`);
    await act.waitFor(shown.locator('body'), { text, timeout: 1_000 });
    assert.equal(await shown.evaluate(() => window.scrollY), 0);
  });

  // Scrolled sideways, the text sits under a fixed side rail; centring it clears the rail as a user's scroll would.
  await t.test('text under a fixed side rail is shown once centred sideways', async () => {
    const p = await page(`<main style="width:3000px;height:100px"><p style="position:absolute;left:1500px;top:20px;margin:0">${text}</p></main><aside style="position:fixed;left:0;top:0;bottom:0;width:200px;background:#fff"></aside>`);
    await p.evaluate(() => window.scrollTo(1400, 0));
    await act.waitFor(p.locator('body'), { text, timeout: 1_000 });
  });

  await t.test('any: covered text rejects TEXT_COVERED when no condition held', async () => {
    const p = await page(covered);
    await assert.rejects(act.waitFor(p.locator('body'), { any: [{ toast: 'x' }, { text }], timeout: 500 }), (e) => e.code === 'TEXT_COVERED' && e.evidence.covered.length === 1 && e.evidence.covered[0].index === 1);
  });

  // The tool promises the conditions and the toasts raised so far on any miss; a goto keeps the toast recorder, setContent drops it.
  await t.test('any: TEXT_COVERED carries the conditions and the toasts, as TIMEOUT does', async () => {
    const p = await localPage(t, browser);
    await p.goto(`data:text/html,${encodeURIComponent(covered)}`);
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('force:showToast', { detail: { type: 'info', title: 'Unrelated' } })));
    const any = [{ text }, { toast: 'x' }];
    const e = await act.waitFor(p.locator('body'), { any, timeout: 500 }).then(() => null, (x) => x);
    assert.equal(e?.code, 'TEXT_COVERED', String(e));
    assert.deepEqual([e.evidence.conditions, e.evidence.toasts.map((x) => x.title)], [any, ['Unrelated']]);
    const single = await act.waitFor(p.locator('body'), { text, timeout: 500 }).then(() => null, (x) => x);
    assert.equal('conditions' in single.evidence, false, 'a single text keeps its evidence as it was');
  });

  await t.test('a match with one text covered and one shown counts as shown', async () => {
    const p = await page('<main><p>Size chosen: <b style="position:relative">Large<span style="position:absolute;inset:0;background:#fff"></span></b></p></main>');
    await act.waitFor(p.locator('body'), { text, timeout: 500 });
  });

  // The 4th copy is the only one a user sees; the first three sit under overlays.
  await t.test('a shown 4th copy of the text holds when the first three are covered', async () => {
    const one = '<p style="position:relative;margin:0">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p>';
    const p = await page(`<main>${one.repeat(3)}<p style="margin:0">Size chosen: Large</p></main>`);
    await act.waitFor(p.locator('body'), { text, timeout: 1_000 });
  });

  // Ten covered copies, each read slow: the wait reads the first, then only while it has time, and the rest are unread.
  await t.test('no copy is read past the wait\'s deadline', async (st) => {
    const one = '<p style="position:relative;margin:0">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p>';
    const p = await page(`<main>${one.repeat(10)}</main>`);
    await p.evaluate(() => {
      const was = Document.prototype.elementFromPoint;
      Document.prototype.elementFromPoint = function slow(...a) { for (const t0 = performance.now(); performance.now() - t0 < 300;); return was.apply(this, a); };
    });
    const proto = Object.getPrototypeOf(p.locator('body'));
    const real = proto.evaluate;
    let reads = 0;
    st.mock.method(proto, 'evaluate', function counted(fn, arg, ...rest) { if (arg?.covered) reads += 1; return real.call(this, fn, arg, ...rest); });
    const r = await act.waitFor(p.locator('body'), { text, timeout: 1_000 }).then((x) => x, (x) => x);
    assert.equal(r.coverUnchecked, true, `the unread copies are not all covered: ${r.code}`);
    assert.ok(reads >= 1 && reads <= 5, `${reads} reads in a 1 s wait`);
  });

  // Copy 0 is covered and its read outlasts the deadline, so copy 1 (shown) is never read: that is not "all copies covered".
  await t.test('a copy left unread at the deadline is coverUnchecked, not TEXT_COVERED', async () => {
    const one = '<p style="position:relative;margin:0">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p>';
    const p = await page(`<main>${one}<p style="margin:0">Size chosen: Large</p></main>`);
    await p.evaluate(() => {
      const was = Document.prototype.elementFromPoint;
      Document.prototype.elementFromPoint = function slow(...a) { for (const t0 = performance.now(); performance.now() - t0 < 150;); return was.apply(this, a); };
    });
    const r = await act.waitFor(p.locator('body'), { text, timeout: 100 }).then((x) => x, (x) => x);
    assert.equal(r?.code, undefined, `threw ${r?.code}`);
    assert.equal(r.coverUnchecked, true);
  });

  // Both copies read covered on the first poll; the last poll is cut after copy 0 at the deadline: the earlier covers stand.
  await t.test('a poll cut at the deadline keeps the covers an earlier complete poll proved', async (st) => {
    const one = '<p style="position:relative;margin:0">Size chosen: Large<span style="position:absolute;inset:0;background:#fff"></span></p>';
    const p = await page(`<main>${one.repeat(2)}</main>`);
    const proto = Object.getPrototypeOf(p.locator('body'));
    const real = proto.evaluate;
    let reads = 0;
    const stop = Date.now() + 320;
    st.mock.method(proto, 'evaluate', async function late(fn, arg, ...rest) {
      if (arg?.covered && ++reads === 3) await new Promise((ok) => setTimeout(ok, Math.max(0, stop - Date.now()))); // copy 0 of the last poll ends past the deadline
      return real.call(this, fn, arg, ...rest);
    });
    const r = await act.waitFor(p.locator('body'), { text, timeout: 300 }).then((x) => x, (x) => x);
    assert.ok(reads >= 3, `${reads} reads`);
    assert.equal(r?.code, 'TEXT_COVERED', String(r?.coverUnchecked ?? r));
  });

  await t.test('a host whose shadow root cannot list layers is weighed as itself, not an error', async () => {
    const p = await page('<main><div style="position:relative"><p>Size chosen: Large</p><x-odd style="position:absolute;inset:0"></x-odd></div></main>');
    await p.evaluate(() => Object.defineProperty(document.querySelector('x-odd'), 'shadowRoot', { value: { elementFromPoint: () => null } }));
    await act.waitFor(p.locator('body'), { text, timeout: 500 });
  });

  await t.test('control: uncovered text resolves', async () => {
    await act.waitFor((await page(clean)).locator('body'), { text, timeout: 500 });
  });

  await t.test('control: gone on covered text is not taken as gone', async () => {
    await assert.rejects(act.waitFor((await page(covered)).locator('body'), { text, gone: true, timeout: 500 }), { code: 'TIMEOUT' });
  });

  await t.test('control: text that is absent is TIMEOUT, not TEXT_COVERED', async () => {
    await assert.rejects(act.waitFor((await page(covered)).locator('body'), { text: 'never there', timeout: 500 }), { code: 'TIMEOUT' });
  });
});

// No org: a snapshot lists covered text after the cut, and a page with nothing covered is byte for byte as before.
test('snapshot marks covered text, no org', { timeout: 60_000 }, async (t) => {
  const browser = (await localPage(t)).context().browser();
  const page = async (html) => { const p = await localPage(t, browser); await p.setContent(html); return p; };
  const plain = (p) => p.getByRole('main').ariaSnapshot().then((x) => act.cut(x, 3000));
  const over = '<span style="position:absolute;inset:0;background:#fff"></span>';

  await t.test('the T1 overlay page ends with the covered line', async () => {
    const p = await page(`<main><p style="position:relative">Size chosen: Large${over}</p></main>`);
    assert.equal(await act.snapshot(p), `${await plain(p)}\n- covered: "Size chosen: Large" under span`);
    assert.match(await act.snapshot(p.getByRole('main'), 6000), /\n- covered: "Size chosen: Large" under span$/);
  });

  await t.test('a clean page with assistive text and shadow text equals the aria snapshot exactly', async () => {
    // The assistive span is 1px and clipped, with an opaque overlay on its corner: a 1px rule that is dropped reads it as covered.
    const p = await page(`<main><h1>Plain heading</h1><span style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Assistive only</span>
      <div style="position:absolute;left:0;top:0;width:60px;height:30px;background:#fff"></div><x-host></x-host></main>`);
    await p.evaluate(() => { document.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow words</p>'; });
    assert.equal(await act.snapshot(p), await plain(p));
  });

  await t.test('a transparent layer over a painting one covers, and the painting one is named', async () => {
    // SLDS: section.slds-modal is fixed, transparent and on top; the .slds-backdrop under it paints.
    const p = await page('<main><p>Behind the modal</p></main><div class="slds-backdrop" style="position:fixed;inset:0;background:rgba(8,7,7,.6)"></div><section style="position:fixed;inset:0"></section>');
    assert.match(await act.snapshot(p.locator('main')), /\n- covered: "Behind the modal" under div$/);
    await assert.rejects(act.waitFor(p.locator('main'), { text: 'Behind the modal', timeout: 500 }), { code: 'TEXT_COVERED' });
  });

  await t.test('an overlay that paints only through ::before covers', async () => {
    const p = await page(`<style>.ov::before { content: ''; position: absolute; inset: 0; background: #fff; }</style>
      <main><div style="position:relative"><h3>Card two</h3><div class="ov" style="position:absolute;inset:0"></div></div></main>`);
    assert.match(await act.snapshot(p), /\n- covered: "Card two" under div$/);
  });

  await t.test('a pseudo that is a nubbin or a divider, not a full-box fill, does not cover', async () => {
    const p = await page(`<style>.nub::after { content: ''; position: absolute; right: 0; top: 0; width: 8px; height: 8px; background: #fff; }</style>
      <main><div style="position:relative"><h3>Field value</h3><div class="nub" style="position:absolute;inset:0"></div></div></main>`);
    assert.equal(await act.snapshot(p), await plain(p));
  });

  await t.test('a full-box pseudo on an overlay with a border still covers', async () => {
    const p = await page(`<style>.veil::after { content: ''; position: absolute; inset: 0; background: #fff; }</style>
      <main><div style="position:relative"><h3>Veiled</h3><div class="veil" style="position:absolute;inset:0;border:3px solid #000"></div></div></main>`);
    assert.match(await act.snapshot(p), /\n- covered: "Veiled" under div$/);
  });

  await t.test('an invisible input or text over the text does not cover it', async () => {
    for (const over of ['<input type="file" style="position:absolute;inset:0;opacity:0">', '<div style="position:absolute;inset:0;opacity:0">hidden tip</div>']) {
      const p = await page(`<main><div style="position:relative"><p>Drop files here</p>${over}</div></main>`);
      assert.equal(await act.snapshot(p), await plain(p), over);
    }
  });

  await t.test('a full-box pseudo at opacity 0 (shown on hover) does not cover', async () => {
    const p = await page(`<style>.hov::after { content: ''; position: absolute; inset: 0; background: #fff; opacity: 0; }</style>
      <main><div style="position:relative"><h3>Hover card</h3><div class="hov" style="position:absolute;inset:0"></div></div></main>`);
    assert.equal(await act.snapshot(p), await plain(p));
  });

  await t.test('a modal inside a shadow root covers the page behind it', async () => {
    const p = await page('<main><p>Behind the shadow modal</p></main><x-modal></x-modal>');
    await p.evaluate(() => { document.querySelector('x-modal').attachShadow({ mode: 'open' }).innerHTML = '<div style="position:fixed;inset:0;background:rgba(8,7,7,.6)"></div><section style="position:fixed;inset:0"></section>'; });
    assert.match(await act.snapshot(p.locator('main')), /\n- covered: "Behind the shadow modal" under div$/);
  });

  await t.test('text that takes no hits weighs only the hit, not the layers under it', async () => {
    const p = await page(`<main><div style="position:relative;height:40px"><div style="position:absolute;inset:0;background:#eee"></div>
      <p style="position:relative;margin:0;pointer-events:none">Floating label</p><div style="position:absolute;inset:0"></div></div></main>`);
    assert.equal(await act.snapshot(p), await plain(p));
  });

  await t.test('covered text inside an open shadow root is marked', async () => {
    const p = await page('<main><x-host></x-host></main>');
    await p.evaluate((o) => { document.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML = `<p style="position:relative">Shadow status${o}</p>`; }, over);
    assert.match(await act.snapshot(p), /\n- covered: "Shadow status" under span$/);
  });

  // A slot straight under a shadow root has no box, so its text is walked up to the host past the root, which is no element.
  await t.test('covered fallback text of a slot directly in a shadow root is marked', async () => {
    const p = await page('<main><x-host style="display:block;position:relative;width:200px;height:30px"></x-host></main>');
    await p.evaluate((o) => { document.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML = `<slot>Fallback words</slot>${o}`; }, over);
    assert.match(await act.snapshot(p), /\n- covered: "Fallback words" under span$/);
  });

  await t.test('a sibling overlay with its own text marks the text under it', async () => {
    const p = await page('<main><p style="position:relative">Under text</p><div style="position:absolute;left:0;top:0;width:300px;height:300px;background:#fff"></div></main>');
    assert.match(await act.snapshot(p), /\n- covered: "Under text" under div$/);
  });

  await t.test('a stretched link, and text under pointer-events: none in a button, are not covered', async () => {
    const link = await page('<main><div style="position:relative"><h3>Card title</h3><a href="#x" style="position:absolute;inset:0"></a></div></main>');
    assert.equal(await act.snapshot(link), await plain(link), 'a transparent hit with no text paints nothing');
    await act.waitFor(link.locator('body'), { text: 'Card title', timeout: 500 });
    const button = await page('<main><button><span style="pointer-events:none">Save it</span></button></main>');
    assert.equal(await act.snapshot(button), await plain(button), 'the button is an ancestor of the text');
    await act.waitFor(button.locator('body'), { text: 'Save it', timeout: 500 });
  });

  await t.test('a descendant over the text is not another layer', async () => {
    const p = await page('<main><p style="margin:0;height:20px">Words<span style="position:relative;display:block;top:-1.3em;height:1.3em;background:#ddd"></span></p></main>');
    assert.equal(await act.snapshot(p), await plain(p));
  });

  await t.test('an overlay that paints by a gradient, by its own text, or as a replaced element covers the text', async () => {
    const cases = {
      div: '<div style="position:absolute;left:0;top:0;width:300px;height:300px;background-image:linear-gradient(red,blue)"></div>',
      span: '<span style="position:relative;display:block;top:-1.2em;color:red">Over the words</span>',
      canvas: '<canvas style="position:relative;display:block;top:-20px" width="200" height="20"></canvas>',
    };
    for (const [tag, html] of Object.entries(cases)) {
      const p = await page(`<main><p style="margin:0;line-height:20px">Under</p>${html}</main>`);
      assert.match(await act.snapshot(p), new RegExp(`\\n- covered: "Under" under ${tag}( |$)`), tag);
    }
  });

  await t.test('text behind an open modal backdrop is not reported', async () => {
    const p = await page(`<div aria-hidden="true"><p>Behind the modal</p></div><div style="position:fixed;inset:0;background:#000"></div>
      <div role="dialog" aria-label="Edit" style="position:fixed;left:50px;top:50px;background:#fff"><p>Dialog text</p></div>`);
    assert.equal(await act.snapshot(p), await act.cut(await p.locator('body').ariaSnapshot(), 3000));
  });

  await t.test('at most 10 covered lines print, then a count of the rest, and the stop line stays last', async () => {
    const wall = '<div style="position:absolute;left:0;top:0;width:600px;height:900px;background:#fff"></div>';
    const some = await page(`<main>${Array.from({ length: 12 }, (_, i) => `<p style="margin:0">text ${i}</p>`).join('')}${wall}</main>`);
    const lines = (await act.snapshot(some)).split('\n').filter((l) => /^- (covered|and)/.test(l));
    assert.deepEqual([lines.length, lines.filter((l) => l.startsWith('- covered:')).length, lines.at(-1)], [11, 10, '- and 2 more covered']);
    const many = await page(`<main>${Array.from({ length: 120 }, (_, i) => `<p style="margin:0;font-size:4px;line-height:4px">line ${i}</p>`).join('')}${wall}</main>`);
    assert.match(await act.snapshot(many), /\n- and 90 more covered\n- covered check stopped at 100 texts$/);
  });

  await t.test('more than 100 candidate texts print the stop line', async () => {
    const p = await page(`<main>${Array.from({ length: 120 }, (_, i) => `<p style="margin:0;font-size:4px;line-height:4px">line ${i}</p>`).join('')}</main>`);
    assert.match(await act.snapshot(p), /\n- covered check stopped at 100 texts$/);
  });
});

// No browser: a covered check that throws or runs past 2 s says it did not run, not a snapshot with nothing covered.
test('a covered check that fails or runs past 2 s says so in the snapshot', { timeout: 10_000 }, async () => {
  const failing = { evaluate: async () => { throw new Error('Execution context was destroyed\nmore'); } };
  assert.equal(await act.marked(failing, 'snap'), 'snap\n- covered check not run: Execution context was destroyed');
  const hung = { evaluate: () => new Promise(() => {}) };
  const alive = setInterval(() => {}, 500); // the race timer is unref'd and a stub holds no browser, so keep the loop open
  try { assert.equal(await act.marked(hung, 'snap'), 'snap\n- covered check not run: ran past 2 s'); } finally { clearInterval(alive); }
  const clean = { evaluate: async () => ({ covered: [], stopped: false }) };
  assert.equal(await act.marked(clean, 'snap'), 'snap'); // control: a check that ran and found nothing adds nothing
  assert.equal(await act.marked(failing, ''), '', 'an empty snapshot gets no covered line');
  const malformed = { evaluate: async () => ({}) }; // a pass with no covered list: a bug, which surfaces
  await assert.rejects(act.marked(malformed, 'snap'), TypeError);
});

// No org: a real click and a real press each start a new toast window, so a toast from before them is gone after.
test('click and press clear the toasts raised before them, no org', { timeout: 30_000 }, async (t) => {
  const { localPage } = require('./helpers');
  const page = await localPage(t); // its context records toasts
  await page.goto('data:text/html,<button>Go</button><input aria-label="Box">');
  const toast = (title) => page.evaluate((x) => window.dispatchEvent(new CustomEvent('force:showToast', { detail: { title: x } })), title);
  await toast('Old');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(act.raised(page).map((x) => x.title), ['Old'], 'control: the toast was recorded');
  await act.click(page, { name: 'Go' });
  assert.deepEqual(act.raised(page), [], 'the click cleared it');
  await toast('Old');
  await new Promise((r) => setTimeout(r, 100));
  await page.getByRole('textbox', { name: 'Box' }).focus();
  await act.press(page, { key: 'Tab' });
  assert.deepEqual(act.raised(page), [], 'the press cleared it');
});

// No org: fill reads the box back, so text a maxlength cut or a handler refused is VALUE_NOT_SET, not typed.
test('fill reads the value back: a cut or refused text is VALUE_NOT_SET, a rich text\'s paragraphs are not', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><label>Code<input maxlength="3"></label><label>Quiet<input oninput="this.value=''"></label>
    <label>Remarks<textarea></textarea></label><div role="textbox" aria-label="Story" contenteditable="true" oninput="this.innerHTML=this.innerText.split('\\n').filter(Boolean).map((l)=>'<p>'+l+'</p>').join('')"></div>
    <label>Group By<select><option> Detail </option><option>Kind</option></select></label>
    <label>Rate<input value="10%" onfocus="this.value=this.value.replace('%','')"></label><label>Level<input type="range" min="0" max="10" value="2"></label></main>`);
  await assert.rejects(act.fill(page, { name: 'Code', value: 'ABCDEF' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === 'ABC');
  await assert.rejects(act.fill(page, { name: 'Quiet', value: 'x' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.got === '');
  await act.fill(page, { name: 'Code', value: 'ABC' }); // control: a value that fits
  await act.fill(page, { name: 'Remarks', value: 'a\r\nb' });
  await act.fill(page, { name: 'Story', value: 'two\nlines' });
  await act.fill(page, { role: 'combobox', name: 'Group By', value: 'Detail' });
  await act.fill(page, { name: 'Rate', value: '35' }); // a box that drops its % on focus (as the org's do) gets 35, not 1035
  await act.fill(page, { role: 'slider', name: 'Level', value: '7' }); // a slider is filled, never cleared first
});

// No org (F-flow-1, F-flow-2, F-fixtures-6): a Lightning date, time or number box parses its text only on blur, so text
// it then drops reads back as typed. Stand-ins hold the component's value as LWC does, set by the input's blur.
test('fill leaves a Lightning date, time or number box and is VALUE_NOT_SET when the component kept no value, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><lightning-datepicker><label>Day<input onblur="this.parentNode.parentNode.value = /^[A-Z][a-z]{2} \\d/.test(this.value) ? '2026-12-31' : null"></label></lightning-datepicker>
    <lightning-input id="n"><label>Count<input type="number" oninput="this.parentNode.parentNode.value = this.validity.valid ? this.value : ''"></label></lightning-input>
    <label>Plain<input onblur="this.value = ''"></label></main>`);
  await page.evaluate(() => { document.getElementById('n').type = 'number'; });
  await assert.rejects(act.fill(page, { name: 'Day', value: '2026-12-31' }), (e) => e.code === 'VALUE_NOT_SET' && e.evidence.want === '2026-12-31');
  await act.fill(page, { name: 'Day', value: 'Dec 31, 2026' }); // control: the format the component takes
  await act.fill(page, { role: 'spinbutton', name: 'Count', value: '1000' });
  await act.fill(page, { name: 'Plain', value: 'x' }); // a box with no Lightning parser is not left: its blur never runs
});

test('fill on a flow screen is VALUE_NOT_SET for a date or time the component drops', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const opened = await nav.openTab(s, 'SFUIC Screens').catch((e) => { if (e.code === 'TAB_UNAVAILABLE') return null; throw e; });
  if (!opened) return t.skip('the org has no test/fixture-components flow tab SFUIC Screens');
  const { main } = opened;
  await act.click(main, { role: 'checkbox', name: 'SFUIC Checkbox' });
  await assert.rejects(act.fill(main, { name: 'SFUIC Date', value: '2026-12-31' }), (e) => e.code === 'VALUE_NOT_SET');
  await act.fill(main, { name: 'SFUIC Date', value: 'Dec 31, 2026' }); // control
  await act.fill(main, { name: 'Date', value: 'Dec 31, 2026' });
  await assert.rejects(act.fill(main, { role: 'combobox', name: 'Time', value: '14:30' }), (e) => e.code === 'VALUE_NOT_SET');
  await act.fill(main, { role: 'combobox', name: 'Time', value: '2:30 PM' }); // control
  await assert.rejects(act.fill(main, { role: 'spinbutton', name: 'SFUIC Currency', value: '12abc' }), (e) => e.code === 'VALUE_NOT_SET');
  await act.fill(main, { role: 'spinbutton', name: 'SFUIC Currency', value: '1000' }); // control
});

// F-flow-3, F-fixtures-5: a select a Lightning component renders (flow picklist, multi-select, Aura lightning:select)
// listed no options, so every value was VALUE_NOT_FOUND with options [].
test('fill chooses an option in a native select that a Lightning component renders', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const tab = (label) => nav.openTab(s, label).catch((e) => { if (e.code === 'TAB_UNAVAILABLE') return null; throw e; });
  const flow = await tab('SFUIC Screens');
  if (!flow) return t.skip('the org has no test/fixture-components flow tab SFUIC Screens');
  await act.click(flow.main, { role: 'checkbox', name: 'SFUIC Checkbox' });
  await act.click(flow.main, { name: 'Next' });
  await act.waitFor(flow.main, { text: 'Flow: Picklist', timeout: 30_000 });
  await act.fill(flow.main, { role: 'combobox', name: 'SFUIC Picklist', value: 'SFUIC Two' });
  await act.fill(flow.main, { role: 'listbox', name: 'SFUIC Multi Pick', value: 'SFUIC Two' });
  await assert.rejects(act.fill(flow.main, { role: 'combobox', name: 'SFUIC Picklist', value: 'SFUIC Nine' }), // a miss still names the options
    (e) => e.code === 'VALUE_NOT_FOUND' && e.evidence.options.includes('SFUIC Three'));
  const aura = await tab('SFUIC Aura Inputs');
  if (!aura) return t.skip('the org has no test/fixture-components tab SFUIC Aura Inputs');
  await act.fill(aura.main, { role: 'combobox', name: 'SFUIC Select', value: 'SFUIC Blue' });
  await act.waitFor(aura.main, { text: 'Select: blue', timeout: 10_000 });
});

// No org: fill selects, then types, so a colour box fills, a box sees one input event (no empty one first), and a
// box that locks on its first input event still takes the typed value (a clear first left it blank).
test('fill replaces a value with one input event, a colour box included, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><label>Hue<input type="color" value="#112233"></label>
    <label>Query<input value="Acme" oninput="(window.seen ||= []).push(this.value)"></label><label>Once<input value="old" oninput="this.readOnly = true"></label></main>`);
  await act.fill(page, { name: 'Hue', value: '#445566' });
  await act.fill(page, { name: 'Query', value: 'Globex' });
  assert.deepEqual(await page.evaluate(() => window.seen), ['Globex']);
  await act.fill(page, { name: 'Once', value: 'new', timeout: 1_500 });
  assert.equal(await page.getByLabel('Once').inputValue(), 'new');
});

// No org: text a collapsed box (height or width 0) cuts to nothing is visible to Playwright, but a user sees none.
test('waitFor does not take text clipped to a box of height 0 as shown, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><div style="height:0;overflow:hidden"><p>Saved text</p></div></main>');
  const e = await act.waitFor(page.locator('body'), { text: 'Saved text', timeout: 500 }).then(() => null, (x) => x);
  assert.equal(e?.code, 'TIMEOUT', String(e));
  await page.setContent('<main><div style="height:0"><p>Saved text</p></div></main>'); // control: overflow that still draws
  await act.waitFor(page.locator('body'), { text: 'Saved text', timeout: 500 });
  await page.setContent('<main><div style="width:0;overflow:hidden"><span style="white-space:nowrap">Saved text</span></div></main>'); // collapsed sideways
  assert.equal(await page.getByText('Saved text').locator('visible=true').count(), 1); // control: Playwright sees it
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Saved text', timeout: 500 }).then(() => null, (x) => x))?.code, 'TIMEOUT');
  // Visually hidden (slds-assistive-text: a 1x1 box) and scrolled out of a scroller are not collapsed: shown, as on main.
  await page.setContent(`<main><span style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);border:0;padding:0;white-space:nowrap">Assist only</span>
    <div style="height:40px;overflow:auto"><div style="height:400px"></div><span>Scrolled away</span></div></main>`);
  await act.waitFor(page.locator('body'), { text: 'Assist only', timeout: 500 });
  await act.waitFor(page.locator('body'), { text: 'Scrolled away', timeout: 500 });
  // An inline overflow:hidden box (a record page's owner name in span.slds-truncate) clips nothing: shown, and not gone.
  await page.setContent('<main><span style="overflow:hidden">Owner span</span> <a href="#" style="overflow:hidden">Owner link</a></main>');
  await act.waitFor(page.locator('body'), { text: 'Owner span', timeout: 500 });
  await act.waitFor(page.locator('body'), { text: 'Owner link', timeout: 500 });
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Owner span', gone: true, timeout: 500 }).then(() => null, (x) => x))?.code, 'TIMEOUT');
  // A box positioned out of the collapsed one (its containing block is above it) is not cut by it: the file preview's case.
  await page.setContent(`<main style="position:relative"><div style="height:0;overflow:auto"><p style="position:absolute">Out of it</p>
    <p style="position:fixed;top:40px">Fixed out</p></div></main>`);
  await act.waitFor(page.locator('body'), { text: 'Out of it', timeout: 500 });
  await act.waitFor(page.locator('body'), { text: 'Fixed out', timeout: 500 });
  await page.setContent('<main><div style="position:relative;height:0;overflow:hidden"><div style="position:absolute"><p style="position:fixed;top:40px">Fixed in abs</p></div></div></main>');
  await act.waitFor(page.locator('body'), { text: 'Fixed in abs', timeout: 500 }); // the viewport, not the box, is its containing block
  await page.setContent('<main><div style="position:relative;height:0;overflow:hidden"><p style="position:absolute">In it</p></div></main>');
  assert.equal((await act.waitFor(page.locator('body'), { text: 'In it', timeout: 500 }).then(() => null, (x) => x))?.code, 'TIMEOUT'); // its own containing block
});

// No org: a carousel's off-stage slide (F-fixtures-10) is cut off by an overflow:hidden stage the user cannot scroll.
test('waitFor does not take text on an off-stage carousel slide as shown, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const stage = (overflow) => `<main><div id="stage" style="width:300px;overflow:${overflow}"><div id="track" style="display:flex">
    ${['One', 'Two', 'Three'].map((n) => `<div style="flex:0 0 300px"><p>Slide ${n}</p></div>`).join('')}</div></div></main>`;
  const code = (p) => p.then(() => null, (x) => x?.code ?? String(x));
  const body = page.locator('body');
  await page.setContent(stage('hidden'));
  await act.waitFor(body, { text: 'Slide One', timeout: 500 }); // control: the slide on stage
  assert.equal(await code(act.waitFor(body, { text: 'Slide Three', timeout: 500 })), 'TIMEOUT');
  assert.equal(await code(act.waitFor(body, { any: [{ text: 'Slide Two' }, { text: 'zz-control-none' }], timeout: 500 })), 'TIMEOUT');
  assert.equal(await page.evaluate(() => document.getElementById('stage').scrollLeft), 0); // the stage is left where it was
  await page.evaluate(() => { document.getElementById('track').style.transform = 'translateX(-300px)'; });
  await act.waitFor(body, { text: 'Slide Two', timeout: 500 });
  const r = await act.waitFor(body, { any: [{ text: 'Slide One', gone: true }, { text: 'Slide One' }], timeout: 1_500 });
  assert.equal(r.matched.index, 0);
  await page.setContent(stage('auto')); // control: a stage the user can scroll shows the slide, as a scroller does
  await act.waitFor(body, { text: 'Slide Three', timeout: 500 });
});

// No org: a label and its value in two block elements (F-fixtures-16), which the snapshot prints as one text line.
test('waitFor sees a text that spans two block elements, as the snapshot prints it, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  const code = (p) => p.then(() => null, (x) => x?.code ?? String(x));
  const body = page.locator('body');
  await page.setContent('<main><div><div>Stage</div><div>Working</div></div><p>Other text</p></main>');
  assert.match(await body.ariaSnapshot(), /- text: Stage Working/); // the snapshot's own line
  await act.waitFor(body, { text: 'Stage Working', timeout: 500 });
  assert.equal((await act.waitFor(body, { any: [{ text: 'Stage Working' }, { text: 'Other text' }], timeout: 500 })).matched.index, 0);
  assert.equal(await code(act.waitFor(body, { text: 'Stage Working', gone: true, timeout: 500 })), 'TIMEOUT');
  // Controls: two inline spans read "StageWorking", a hidden value and a box collapsed to nothing are not shown.
  await page.setContent('<main><span>Stage</span><span>Working</span></main>');
  assert.equal(await code(act.waitFor(body, { text: 'Stage Working', timeout: 500 })), 'TIMEOUT');
  await page.setContent('<main><div><div>Stage</div><div style="display:none">Working</div></div></main>');
  assert.equal(await code(act.waitFor(body, { text: 'Stage Working', timeout: 500 })), 'TIMEOUT');
  assert.equal((await act.waitFor(body, { text: 'Stage Working', gone: true, timeout: 500 })).neverSeen, true);
  await page.setContent('<main><div style="height:0;overflow:hidden"><div>Stage</div><div>Working</div></div></main>');
  assert.equal(await code(act.waitFor(body, { text: 'Stage Working', timeout: 500 })), 'TIMEOUT');
});

// No org: an SLDS assistive label (1x1, margin -1px) sits just outside its overflow:hidden box, as the App Launcher's
// search label does; it had nothing a stage could cut, so it stays shown as it was before the carousel rule.
test('waitFor still takes an assistive label at the edge of an overflow:hidden box as shown, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent(`<main><div style="position:relative;overflow:hidden;width:300px">
    <label for="q" style="position:absolute;margin:-1px;border:0;padding:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Search apps and items...</label>
    <input id="q"></div></main>`);
  await act.waitFor(page.locator('body'), { text: 'Search apps and items...', timeout: 500 });
  // The App Launcher's own shape (measured on an org): the 1x1 label cuts its own text, whose line starts 1 px below it.
  await page.setContent(`<main><div style="overflow:auto;width:320px;height:330px"><div style="position:relative">
    <label for="q" style="position:absolute;margin:-1px;border:0;padding:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;font:12px/18px sans-serif">Search apps and items...</label>
    <input id="q"></div></div></main>`);
  await act.waitFor(page.locator('body'), { text: 'Search apps and items...', timeout: 500 });
});

// No org: a gone wait's lost read is no sighting, so text collapsed on every read that returned is still neverSeen.
test('a gone wait does not count a lost read as seeing the text, no org', { timeout: 30_000 }, async () => {
  let reads = 0;
  const lost = () => new Promise((_, no) => setTimeout(no, 20, Object.assign(new Error('Timeout'), { name: 'TimeoutError' })));
  const scope = { page: () => ({ context: () => ({}), evaluate: async () => 1 }), ariaSnapshot: async () => '', getByText: () => ({ locator: () => ({ count: async () => 1,
    nth: () => ({ evaluate: () => (reads++ === 0 ? lost() : Promise.resolve({ covered: [], checked: 0, clipped: true })) }) }) }) };
  const r = await act.waitFor(scope, { text: 'x', gone: true, timeout: 1_500 });
  assert.ok(reads > 1, `reads ${reads}`); // control: the first read was lost and later ones returned
  assert.equal(r.neverSeen, true);
});

// No org: gone keeps its pass for text that never showed, and says so with neverSeen; text that left has none.
test('waitFor gone marks neverSeen when the text was at no time on the page, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><p>Loading</p></main>');
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Saving', gone: true, timeout: 1_000 })).neverSeen, true);
  assert.equal((await act.waitFor(page.locator('body'), { any: [{ toast: 'x' }, { text: 'Saving', gone: true }], timeout: 1_000 })).neverSeen, true);
  await page.evaluate(() => setTimeout(() => document.querySelector('p').remove(), 300));
  const left = await act.waitFor(page.locator('body'), { text: 'Loading', gone: true, timeout: 2_000 });
  assert.equal(left.neverSeen, undefined, 'the text was there, then left');
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Gone already', timeout: 0 }).then(() => null, (x) => x))?.code, 'TIMEOUT'); // control: a plain wait is unchanged
  // Shown and gone agree on text a collapsed box cuts to nothing: it is gone, and no user saw it, so neverSeen.
  await page.setContent('<main><div id="acc" style="overflow:hidden"><p>Details</p></div></main>');
  await page.evaluate(() => setTimeout(() => { document.getElementById('acc').style.height = '0'; }, 300));
  const shut = await act.waitFor(page.locator('body'), { text: 'Details', gone: true, timeout: 2_000 });
  assert.equal(shut.neverSeen, undefined, 'it showed, then the box collapsed');
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Details', gone: true, timeout: 1_000 })).neverSeen, true);
  await page.setContent(`<main><div style="height:0;overflow:hidden">${'<p>Row</p>'.repeat(10)}</div><p>Row</p></main>`);
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Row', gone: true, timeout: 1_000 }).then(() => null, (x) => x))?.code, 'TIMEOUT', 'an 11th copy shows');
  // Eleven copies all collapsed, one removed later: the 11th was never read, so it is no sighting either.
  await page.setContent(`<main><div id="c" style="height:0;overflow:hidden">${'<p>Row</p>'.repeat(11)}</div></main>`);
  await page.evaluate(() => setTimeout(() => document.querySelector('#c p').remove(), 600));
  assert.equal((await act.waitFor(page.locator('body'), { text: 'Row', gone: true, timeout: 3_000 })).neverSeen, true);
});

// No org, the delta-B's row 18: a miss by a pattern name (sf_list mass's "Show N more actions") keeps that pattern in
// its evidence as text, where JSON would make a RegExp {}.
test('a click missed by a pattern name keeps the pattern in its evidence, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.setContent('<main><button>Edit</button></main>');
  const miss = await act.click(page, { name: /^Show (\d+ )?more actions$/, timeout: 500 }).then(() => null, (x) => x);
  assert.equal(miss?.code, 'NOT_FOUND', String(miss));
  assert.equal(JSON.parse(JSON.stringify(miss.evidence)).name, '/^Show (\\d+ )?more actions$/');
});

// An LWC ShowToastEvent with messageData never reaches the window as force:showToast: Lightning renders the toast
// itself, so the recorder reads it off the page. A plain one still comes once, from its force:showToast.
test('toasts records an LWC toast that carries messageData', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const tab = await nav.openTab(s, 'SFUIC Panel').catch((e) => { if (e.code === 'TAB_UNAVAILABLE') return null; throw e; });
  if (!tab) return t.skip('the org has no test/fixture-components tab SFUIC Panel');
  const seen = async () => (await act.toasts(s.page, { timeout: 4_000 })).map(({ type, title, message }) => ({ type, title, message }));
  await act.click(tab.main, { name: 'Toast with link' });
  const r = await act.waitFor(tab.main, { any: [{ toast: 'link' }, { text: 'SFUIC link toast' }], timeout: 4_000 });
  assert.equal(r.matched.index, 0, JSON.stringify(r));
  assert.deepEqual(await seen(), [{ type: 'success', title: 'SFUIC link toast', message: 'Open SFUIC Shapes' }]);
  await act.click(tab.main, { name: 'Toast success' });
  await new Promise((done) => setTimeout(done, 2_000)); // a second copy, read off the page, would come after the event
  assert.deepEqual(await seen(), [{ type: 'success', title: 'SFUIC success toast', message: 'A success toast' }]);
});

// No org: the same two shapes on a local page, the toast markup as Lightning renders it.
test('toasts reads a rendered toast that no force:showToast announced, once, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main><c-panel></c-panel></main>')}`);
  const raise = (title, event) => page.evaluate(([x, e]) => {
    document.querySelector('c-panel').dispatchEvent(new CustomEvent('lightning__showtoast', { detail: { label: x }, bubbles: true, composed: true }));
    if (e) window.dispatchEvent(new CustomEvent('force:showToast', { detail: { data: { type: 'info', title: x, message: 'From the event' } } }));
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', `<div data-key="success" class="forceToastMessage"><div class="toastTitle">${x}</div>
      <span class="toastMessage">Open <a href="#"><div>SFUIC  Shapes</div></a></span></div>`), 300);
  }, [title, event]);
  await act.armToasts(page);
  await raise('Linked', false);
  assert.deepEqual((await act.toasts(page, { timeout: 2_000 })).map(({ type, title, message }) => ({ type, title, message })),
    [{ type: 'success', title: 'Linked', message: 'Open SFUIC Shapes' }]);
  await act.armToasts(page);
  await raise('Plain', true);
  await new Promise((done) => setTimeout(done, 1_000));
  assert.deepEqual((await act.toasts(page)).map(({ type, title, message }) => ({ type, title, message })),
    [{ type: 'info', title: 'Plain', message: 'From the event' }]);
});

// F-cascade-34: the favorites star's toast is a template whose last entry has no label; it read "...  undefined".
test('toasts records the favorites star toast as the page shows it', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const Name = `BREAK fix favorite ${stamp()}`;
  await nav.openRecord(s, await probe(s, t, { Name }));
  await act.click(s.page.locator('body'), { name: 'Add favorite' });
  try {
    const seen = await act.toasts(s.page);
    assert.deepEqual(seen.map((x) => x.message), [`"${Name}" was added to your favorites.`], JSON.stringify(seen));
  } finally {
    await act.click(s.page.locator('body'), { name: 'Remove favorite' });
  }
});

// No org, F-cascade-34: a template entry with no label, or no entry at all, fills as nothing, not "undefined".
test('toasts fills a template entry with no label as nothing, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main></main>')}`);
  const raise = (messageTemplate, messageTemplateData) => page.evaluate(([m, d]) => window.dispatchEvent(new CustomEvent('force:showToast',
    { detail: { type: 'success', messageTemplate: m, messageTemplateData: d } })), [messageTemplate, messageTemplateData]);
  await act.armToasts(page);
  await raise('"{0}" was added to your favorites.  {1}', [{ label: 'Alpha' }, { url: '/x' }]);
  await raise('"{0}" was added to your favorites.  {1}', ['Beta']);
  await raise('{0} of {1} saved', [2, { label: 'three' }]);
  assert.deepEqual((await act.toasts(page)).map((x) => x.message),
    ['"Alpha" was added to your favorites.', '"Beta" was added to your favorites.', '2 of three saved']);
});

// A lightning/toast toast fires no force:showToast and no .forceToastMessage: it renders as a lightning-toast inside
// lightning-toastContainer's shadow, so the recorder reads it there. A sticky one still on screen is not read again.
test('toasts records a toast shown with the lightning/toast module', { skip, timeout: 180_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const tab = await nav.openTab(s, 'SfUiC_Modules').catch((e) => { if (e.code === 'TAB_UNAVAILABLE') return null; throw e; });
  if (!tab) return t.skip('the org has no test/fixture-components tab SfUiC_Modules');
  const seen = async () => (await act.toasts(s.page, { timeout: 4_000 })).map(({ type, title, message }) => ({ type, title, message }));
  await act.click(tab.main, { name: 'SFUIC Show Sticky Toast' });
  assert.deepEqual(await seen(), [{ type: 'warning', title: 'SFUIC Sticky Toast 1', message: 'SFUIC sticky toast' }]);
  await act.click(tab.main, { name: 'SFUIC Show Toast' });
  const r = await act.waitFor(tab.main, { any: [{ toast: 'SFUIC Toast 2' }, { text: 'never on this page' }], timeout: 4_000 });
  assert.equal(r.matched.index, 0, JSON.stringify(r));
  assert.deepEqual(await seen(), [{ type: 'success', title: 'SFUIC Toast 2', message: 'SFUIC lightning/toast message' }]);
});

// No org: the same shape on a local page, lightning-toast in the container in the overlay container, as Lightning nests it.
test('toasts reads a lightning/toast toast in its container, once, no org', { timeout: 30_000 }, async (t) => {
  const page = await localPage(t);
  await page.goto(`data:text/html,${encodeURIComponent('<main><c-modules></c-modules></main><lightning-overlay-container></lightning-overlay-container>')}`);
  await act.armToasts(page);
  await page.evaluate(() => {
    document.querySelector('c-modules').dispatchEvent(new CustomEvent('lightning__showtoast',
      { detail: { label: 'Sticky', message: 'It stays', variant: 'warning', mode: 'sticky' }, bubbles: true, composed: true }));
    setTimeout(() => {
      const toast = document.createElement('lightning-toast');
      toast.attachShadow({ mode: 'open' }).innerHTML = `<div role="alert"><div class="slds-notify slds-notify_toast slds-theme_warning">
        <div class="slds-notify__content"><h2 class="slds-text-heading_small"><slot>Sticky</slot></h2><slot name="message">It  stays</slot>
        <span class="slds-assistive-text">Press Command + F6 to navigate to the next toast notification or focusable region.</span></div></div></div>`;
      const box = document.createElement('lightning-toast-container');
      box.attachShadow({ mode: 'open' }).append(toast);
      document.querySelector('lightning-overlay-container').attachShadow({ mode: 'open' }).append(box);
    }, 300);
  });
  await new Promise((done) => setTimeout(done, 1_000)); // a second copy would come from a later look
  assert.deepEqual((await act.toasts(page, { timeout: 2_000 })).map(({ type, title, message }) => ({ type, title, message })),
    [{ type: 'warning', title: 'Sticky', message: 'It stays' }]);
});
