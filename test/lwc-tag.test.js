'use strict';

// No org: the host tag lwc.nested looks for, on local pages; test/lwc.test.js covers discover too, so these live here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { lwc } = require('..');
const { localPage } = require('./helpers');

// A custom component named card is c-card or acme-card, never the platform's lightning-card.
test('lwc nested: a platform base component is not a custom component of the same name', async (t) => {
  const page = await localPage(t);
  await page.setContent('<lightning-card>platform</lightning-card><force-card>platform</force-card>');
  await assert.rejects(lwc.nested({ page }, 'Some_Page', 'card', { timeout: 1_000 }), (e) => e.code === 'NOT_ON_PAGE');
  await page.setContent('<lst-object-home>platform</lst-object-home><laf-progressive-container>platform</laf-progressive-container>'); // seen on a list view and a related list
  await assert.rejects(lwc.nested({ page }, 'Some_Page', 'objectHome', { timeout: 1_000 }), (e) => e.code === 'NOT_ON_PAGE');
  await assert.rejects(lwc.nested({ page }, 'Some_Page', 'progressiveContainer', { timeout: 1_000 }), (e) => e.code === 'NOT_ON_PAGE');
  await page.setContent('<lightning-card>platform</lightning-card><acme-card>custom</acme-card>'); // control: a namespace
  assert.equal((await lwc.nested({ page }, 'Some_Page', 'card', { timeout: 2_000 })).foundBy.tag, 'acme-card');
});

// The name is the model's input: '.*' is a name with no component, not a pattern for any component.
test('lwc nested: a name is matched as written, not as a pattern', async (t) => {
  const page = await localPage(t);
  await page.setContent('<acme-card>custom</acme-card>');
  await assert.rejects(lwc.nested({ page }, 'Some_Page', '.*', { timeout: 1_000 }), (e) => e.code === 'NOT_ON_PAGE');
  assert.equal((await lwc.nested({ page }, 'Some_Page', 'card', { timeout: 2_000 })).foundBy.tag, 'acme-card'); // control
});

// A recordId that is no id would match any record URL and skip the open: refused before the page is touched.
test('lwc locate: a recordId that is not a record id is BAD_ARGS', async () => {
  const page = { url: () => 'https://x.lightning.force.com/lightning/r/SfUiProbe__c/a01C1000004XyZ9MAK/view' };
  for (const recordId of ['.', 'a01', undefined]) {
    await assert.rejects(lwc.locate({ page }, recordId, 'sfUiProbe'), (e) => e.code === 'BAD_ARGS', String(recordId));
  }
});
