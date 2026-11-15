'use strict';

// The resolver scored against the page the browser renders, for every assignment case of the fixture.
// It logs in as the platform user and gives it the SfUi_Probe set (it opens the app), so run it alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { session, api } = require('..');
const { calibrate, overrides, profileName, resolvePage } = require('../src/page');
const { auth, env, skip, record } = require('./helpers');
const CASES = require('./page-cases');

const DEF = path.join(__dirname, 'fixture', 'force-app', 'main', 'default');
const read = (rel) => fs.readFileSync(path.join(DEF, rel), 'utf8');

test('page resolver against the rendered page', { skip, timeout: 600_000 }, async (t) => {
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));
  const rest = async (soql) => (await api.call(s, `/query?q=${encodeURIComponent(soql)}`, { as: 'admin' })).records;
  const userId = (await rest(`SELECT Id FROM User WHERE Username = '${env.user}'`))[0].Id;
  const set = (await rest("SELECT Id FROM PermissionSet WHERE Name = 'SfUi_Probe'"))[0].Id;
  if (!(await rest(`SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSetId = '${set}'`)).length) {
    await api.call(s, '/sobjects/PermissionSetAssignment', { method: 'POST', as: 'admin', body: { AssigneeId: userId, PermissionSetId: set } });
  }
  const ids = new Map();
  for (const c of CASES) {
    const key = `${c.object}/${c.recordType}`;
    if (ids.has(key)) continue;
    const rt = c.recordType && (await rest(`SELECT Id FROM RecordType WHERE SobjectType = '${c.object}' AND DeveloperName = '${c.recordType}'`))[0].Id;
    ids.set(key, await record(s, t, c.object, { Name: `calibrate ${key}`, ...(rt && { RecordTypeId: rt }) }));
  }
  const cases = CASES.map((c) => ({ ...c, recordId: ids.get(`${c.object}/${c.recordType}`), as: c.profile === 'System Administrator' ? 'admin' : userId }));
  const resolve = (c) => {
    const xml = read(`applications/${c.app}.app-meta.xml`);
    const app = { actionOverrides: overrides(xml, 'actionOverrides'), profileActionOverrides: overrides(xml, 'profileActionOverrides') };
    const objectOverrides = overrides(read(`objects/${c.object}/${c.object}.object-meta.xml`), 'actionOverrides');
    return resolvePage({ app, objectOverrides }, { object: c.object, profile: profileName(c.profile), recordType: c.recordType }).page;
  };
  const r = await calibrate(s, session, cases, resolve);
  console.log(`checked ${r.checked}, matched ${r.matched}`);
  assert.deepEqual(r.rows.filter((x) => !x.ok).map((x) => [x.app, x.object, x.profile, x.recordType, x.resolved, x.rendered]), []);
  assert.equal(r.checked, CASES.length);
});
