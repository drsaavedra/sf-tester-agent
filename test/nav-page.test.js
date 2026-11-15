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

test('openRecord names a record page with no Highlights Panel NO_HIGHLIGHTS, not a raw timeout', async (t) => {
  const s = await page(t, '<div role="main">a page with no highlights</div>');
  await assert.rejects(nav.openRecord(s, 'a03000000000001AAA', { timeout: 500 }), (e) => e.code === 'NO_HIGHLIGHTS' && e.evidence.recordId === 'a03000000000001AAA');
});

test('search names a search that opens no results page SEARCH_FAILED', async (t) => {
  const s = await page(t, '<input placeholder="Search..."><button>Search</button>');
  await s.page.goto(`${ORIGIN}/lightning/page/home`);
  await assert.rejects(nav.search(s, 'nothing', { timeout: 500 }), (e) => e.code === 'SEARCH_FAILED' && e.evidence.text === 'nothing');
});
