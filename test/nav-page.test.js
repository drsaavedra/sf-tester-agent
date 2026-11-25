'use strict';

// nav's coded failures on a local page shaped like Lightning's, no org.

const test = require('node:test');
const assert = require('node:assert/strict');
const nav = require('../src/nav');
const { localPage } = require('./helpers');

const ORIGIN = 'https://x.lightning.force.com';
async function page(t, body) {
  const p = await localPage(t);
  await p.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${body}</body></html>` }));
  return { page: p, origin: ORIGIN };
}

test('openRecord names a page that draws no record page NO_HIGHLIGHTS, not a raw timeout', async (t) => {
  const s = await page(t, '<div role="main">a page with no highlights</div>');
  await assert.rejects(nav.openRecord(s, 'a03000000000001AAA', { timeout: 500 }), (e) => e.code === 'NO_HIGHLIGHTS' && e.evidence.recordId === 'a03000000000001AAA');
});

// F-flow-31, F-fixtures-25: a record page on a template with no panel draws its record home and nothing more.
test('openRecord opens a record page with no Highlights Panel, highlights false', async (t) => {
  const s = await page(t, '<one-record-home-flexipage2><div>region main</div></one-record-home-flexipage2>');
  const r = await nav.openRecord(s, 'a03000000000001AAA', { objectApiName: 'Thing__c', timeout: 20_000 });
  assert.deepEqual(r, { recordId: 'a03000000000001AAA', objectApiName: 'Thing__c', url: `${ORIGIN}/lightning/r/Thing__c/a03000000000001AAA/view`, highlights: false });
});

test('openRecord waits for a Highlights Panel that draws after the record home', async (t) => {
  const s = await page(t, `<style>records-highlights2 { display: block; height: 10px }</style>
    <one-record-home-flexipage2><div>region main</div></one-record-home-flexipage2>
    <script>setTimeout(() => document.body.append(document.createElement('records-highlights2')), 1000)</script>`);
  const r = await nav.openRecord(s, 'a03000000000001AAA', { objectApiName: 'Thing__c', timeout: 20_000 });
  assert.equal(r.highlights, undefined);
});

test('search names a search that opens no results page SEARCH_FAILED', async (t) => {
  const s = await page(t, '<input placeholder="Search..."><button>Search</button>');
  await s.page.goto(`${ORIGIN}/lightning/page/home`);
  await assert.rejects(nav.search(s, 'nothing', { timeout: 500 }), (e) => e.code === 'SEARCH_FAILED' && e.evidence.text === 'nothing');
});
