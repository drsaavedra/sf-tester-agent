'use strict';

// expect on a layout reading, against the fixture's probe modal and clip card. Green on the fixture as it ships; the
// patches in test/fixture/red-proofs each turn one test red (a modal 94 px above the window, a hover card cropped): git apply
// one, deploy that component to a scratch org, run this file, then git apply -R it and deploy again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, lwc, act, modal, layer, nav } = require('..');
const { expectReading } = require('../src/checks');
const { auth, env, skip, probe } = require('./helpers');

test('expect on layout readings', { skip, timeout: 300_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  await session.resize(s, session.VIEWPORT); // the numbers hold run to run
  const id = await probe(s, t);

  // Requirement: the dialog header shows whole inside the window.
  await t.test('the modal header is wholly in the window', async () => {
    await act.click(await lwc.scope(s, id, 'sfUiProbe'), { name: 'Open dialog' });
    const m = await modal.find(s);
    try {
      const head = await layer.measure(m, { selector: 'lightning-modal-header' });
      expectReading(head, { path: 'elements.0.visible', value: 1 });
      expectReading(head, { path: 'elements.0.clippedBy', value: null }); // nothing crops it
      expectReading(head, { path: 'elements.0.rect.height', value: head.elements[0].rect.height + 2, tolerance: 2 }); // a real px number within its tolerance
    } finally {
      await act.click(m, { name: 'Done with dialog' });
      await m.waitFor({ state: 'hidden' });
    }
  });

  // Requirement: the hover card opens whole below its label, not cut off by the card around it.
  await t.test('the hover card shows whole', async () => {
    await nav.openTab(s, 'SfUi_Clip_App');
    await s.page.locator('.hover-host').hover(); // the label opens the card
    expectReading(await layer.measure(s.page, { selector: '.hover-card' }), { path: 'elements.0.visible', value: 1 });
  });
});
