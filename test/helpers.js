'use strict';

const { spawnSync } = require('node:child_process');
const { session, api, act } = require('..');

const auth = (alias) => session.fromAlias(alias);

// Integration tests need a scratch org with test/fixture deployed and its platform user created (both defs are
// in test/fixture/config); without one they skip rather than fail.
const env = {
  org: process.env.SF_TESTER_ORG,
  user: process.env.SF_TESTER_USER,
};
const skip = !(env.org && env.user) && 'set SF_TESTER_ORG and SF_TESTER_USER to a scratch org with test/fixture deployed';
// The org tests write as the admin (a user's permission sets and language), so they stop before any test on production.
if (!skip) {
  const sf = spawnSync('sf', ['data', 'query', '--query', session.ORG_QUERY, '--target-org', env.org, '--json'], { encoding: 'utf8', timeout: 60_000 });
  const row = JSON.parse(sf.stdout || '{}').result?.records?.[0];
  if (!row) throw new Error(`could not read the org behind ${env.org}: ${sf.stdout || sf.error}`);
  if (session.isProduction(row)) throw new Error(`${env.org} is a production org: the org tests run only on a scratch org with test/fixture deployed`);
}

// A record the test file owns: created through the API as the admin, deleted when the file ends.
async function record(s, t, sobject, body) {
  const { id } = await api.call(s, `/sobjects/${sobject}`, { method: 'POST', as: 'admin', body });
  // A parent's delete can take a child with it (an Account its Contacts), so already gone is fine.
  t.after(() => api.call(s, `/sobjects/${sobject}/${id}`, { method: 'DELETE', as: 'admin' }).catch((e) => { if (!e.evidence || e.evidence.status !== 404) throw e; }));
  return id;
}

const stamp = () => `${Date.now()}`.slice(-7);

// A local Chrome page with no org, for DOM shapes the fixture org cannot show (native shadow, a namespace).
// Its context records toasts as session.start's does (goto a data: URL: setContent drops the listener);
// pass browser for another page with a list of its own.
async function localPage(t, browser) {
  if (!browser) {
    browser = await require('playwright-core').chromium.launch({ channel: session.browserChannel(), headless: true });
    t.after(() => browser.close());
  }
  const context = await browser.newContext();
  await act.recordToasts(context);
  return context.newPage();
}
const account = (s, t, fields = {}) => record(s, t, 'Account', { Name: `sf-ui account ${stamp()}`, Rating: 'Warm', ...fields });
const probe = (s, t, fields = {}) => record(s, t, 'SfUiProbe__c', { Name: `sf-ui probe ${stamp()}`, Tags__c: 'Alpha', ...fields });

module.exports = { auth, env, skip, record, account, probe, stamp, localPage };
