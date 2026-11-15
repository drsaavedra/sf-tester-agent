'use strict';
// cascade reads triggers and record-triggered flows under every metadata root of a package, <folder>/main/default too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { onSave, rootsOf } = require('../src/cascade');
const { resolveCI } = require('../src/verify');

test('onSave finds a trigger and a record-triggered flow under <package>/<folder>/main/default, beside main/default', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-roots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
  put('force-app/sales/main/default/triggers/T.trigger', 'trigger T on Foo__c (before insert) {}');
  put('force-app/sales/main/default/flows/F.flow-meta.xml', '<Flow>\n    <label>F</label>\n    <start><object>Foo__c</object><triggerType>RecordBeforeSave</triggerType></start>\n    <status>Active</status>\n</Flow>');
  put('force-app/main/default/triggers/U.trigger', 'trigger U on Foo__c (before insert) {}');
  const proj = { root, dirs: ['force-app'], namespace: null };
  assert.deepEqual(onSave(proj, 'Foo__c', resolveCI), ['flows/F', 'triggers/T', 'triggers/U']);
  assert.deepEqual(rootsOf(proj, 'force-app'), ['force-app/main/default', 'force-app', 'force-app/sales/main/default']);
});
