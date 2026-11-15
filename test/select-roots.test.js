'use strict';
// select finds the metadata root of a file under <package>/<folder>/main/default, as verify and cascade do.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rootOf, select } = require('../src/select');

test('rootOf takes <package>/<folder>/main/default/ as a root, and a tab there selects the route that opens it', () => {
  assert.equal(rootOf('force-app/sales/main/default/tabs/X__c.tab-meta.xml', ['force-app']), 'force-app/sales/main/default/');
  assert.equal(rootOf('force-app/main/default/tabs/X__c.tab-meta.xml', ['force-app']), 'force-app/main/default/', 'control: main/default first');
  assert.equal(rootOf('other/sales/main/default/tabs/X__c.tab-meta.xml', ['force-app']), undefined, 'outside every package');
  // Two tab routes: only the first is in the smoke slice, so the second is selected only when the tab is read as a tab.
  const route = (id, tab) => ({ id, status: 'tested', container: 'tab', task: id, app: 'A', route: [{ tool: 'sf_open_tab', args: { tab } }] });
  const cat = { combinations: [route('open-y', 'Y__c'), route('open-x', 'X__c')] };
  const r = select(['force-app/sales/main/default/tabs/X__c.tab-meta.xml'], cat, cat, {}, ['force-app']);
  assert.ok(r.ids.includes('open-x'), JSON.stringify(r.reasons));
});
