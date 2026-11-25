'use strict';

// api.call answers as whoever the page runs as: Opportunity is readable for the admin and refused after Login As.

const test = require('node:test');
const assert = require('node:assert/strict');
const { session, api } = require('..');
const { auth, env, skip, record, stamp } = require('./helpers');

// No org: an error page that is not JSON keeps its status and API_ERROR, with its text as the body.
test('api, no org: a non-JSON error body is API_ERROR with its status', async (t) => {
  const server = require('node:http').createServer((req, res) => { res.writeHead(401, { 'Content-Type': 'text/html' }); res.end('\n  <html><body>Session expired</body></html>\n'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const s = { apiVersion: '60.0', instanceUrl: `http://127.0.0.1:${server.address().port}`, accessToken: 'x' };
  await assert.rejects(api.call(s, '/limits', { as: 'admin' }), (e) => e.code === 'API_ERROR' && e.evidence.status === 401 && e.evidence.body === '<html><body>Session expired</body></html>');
});

// No org: a refused connection keeps the reason Node puts in cause, not a bare "fetch failed".
test('api and session, no org: a failed fetch keeps its cause code', async () => {
  const server = require('node:http').createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  const s = { apiVersion: '60.0', instanceUrl: `http://127.0.0.1:${port}`, accessToken: 'x' };
  const refused = (e) => e.code === 'API_ERROR' && e.evidence.cause === 'ECONNREFUSED' && e.message.includes('(ECONNREFUSED)');
  await assert.rejects(api.call(s, '/limits', { as: 'admin' }), refused);
  await assert.rejects(session.latestVersion(s), refused); // bearer
  await assert.rejects(session.loginAsEnabled(s), refused);
});

test('api, no org: a connection reset while the body is read is API_ERROR with its cause', async (t) => {
  const server = require('node:http').createServer((req, res) => { res.writeHead(200, { 'Content-Length': 100 }); res.write('{"a":'); setTimeout(() => req.socket.destroy(), 20); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const s = { apiVersion: '60.0', instanceUrl: `http://127.0.0.1:${server.address().port}`, accessToken: 'x' };
  await assert.rejects(api.call(s, '/limits', { as: 'admin' }), (e) => e.code === 'API_ERROR' && !!e.evidence.cause && e.message.includes(e.evidence.cause), 'a reset body read');
});

test('api, no org: a fetch error with no cause is not recoded', async (t) => {
  const bug = new TypeError('Invalid header value');
  t.mock.method(globalThis, 'fetch', async () => { throw bug; });
  await assert.rejects(api.call({ apiVersion: '60.0', instanceUrl: 'http://127.0.0.1:1', accessToken: 'x' }, '/limits', { as: 'admin' }), (e) => e === bug);
});

// No org: the server reads the query as Salesforce does (+ is a space, a bad escape is a 400 page), so a raw literal must
// reach it whole. F-api-enc-1.
test('api, no org: a query literal with % + & or an escape reaches the server whole', async (t) => {
  const server = require('node:http').createServer((req, res) => {
    try {
      const params = req.url.split('?')[1].split('&').map((kv) => kv.split('=')).map(([k, v = '']) => [k, decodeURIComponent(v.replace(/\+/g, ' '))]);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: params.map(([k]) => k), q: params[0][1], url: req.url }));
    } catch { res.writeHead(400, { 'Content-Type': 'text/html' }); res.end('<html>Bad Request</html>'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const s = { apiVersion: '60.0', instanceUrl: `http://127.0.0.1:${server.address().port}`, accessToken: 'x' };
  const read = (path) => api.call(s, path, { as: 'admin' });
  for (const [path, q] of [
    ["/query?q=SELECT Id FROM Account WHERE Name LIKE 'x%'", "SELECT Id FROM Account WHERE Name LIKE 'x%'"],
    ['/queryAll?q=SELECT Id FROM Event WHERE StartDateTime > 2026-11-15T09:00:00+08:00', 'SELECT Id FROM Event WHERE StartDateTime > 2026-11-15T09:00:00+08:00'],
    ["/tooling/query?q=SELECT Id FROM Flow WHERE Description = 'A&B'", "SELECT Id FROM Flow WHERE Description = 'A&B'"],
    ['/search?q=FIND {50%}', 'FIND {50%}'],
    ['/search/?q=FIND {A&B}', 'FIND {A&B}'],
    ["/query?q=SELECT%20Id%20FROM%20Account%20WHERE%20Name%20LIKE%20'x%25'", "SELECT Id FROM Account WHERE Name LIKE 'x%'"],
    ["/query?q=SELECT Id FROM Account WHERE Name = '🚀 שלום'", "SELECT Id FROM Account WHERE Name = '🚀 שלום'"],
    ["/query?q=SELECT Id FROM Account WHERE Name = 'O\\'Brien'", "SELECT Id FROM Account WHERE Name = 'O\\'Brien'"],
  ]) {
    const r = await read(path);
    assert.deepEqual([r.q, r.keys], [q, ['q']], path);
  }
  assert.equal((await read('/ui-api/records/001x?fields=Account.Name&optionalFields=Account.Rating')).url, '/services/data/v60.0/ui-api/records/001x?fields=Account.Name&optionalFields=Account.Rating', 'another root keeps its &');
  for (const path of ["/query?q=SELECT Id FROM Account WHERE Name = '\ud800'", '/search?q=FIND {\ud800}']) {
    await assert.rejects(read(path), (e) => e.code === 'INVALID_VALUE', 'a lone surrogate is refused, not thrown as URIError');
  }
});

// No org: UI API sends a record's text entity-escaped, nested records too; SOQL sends it as typed. F-cascade-30, F-cascade-4.
test('api, no org: a UI API record read answers text as stored, a query as sent', async (t) => {
  const esc = (v) => ({ value: v, displayValue: null });
  const bodies = {
    '/ui-api/records/a00': { fields: { Name: esc('R&amp;D &lt;1&gt; O&#39;Neil &quot;q&quot; &amp;amp; x'), Count__c: { value: 5, displayValue: '5' },
      Owner: { displayValue: 'Tom &amp; Jerry', value: { fields: { Name: esc('Tom &amp; Jerry') } } } } },
    '/ui-api/list-records/X/__Recent': { records: [{ fields: { Name: esc('R&amp;D') } }] },
    '/query': { records: [{ attributes: { type: 'AggregateResult' }, value: 'R&amp;D' }] }, // SELECT MAX(Name) value
  };
  const server = require('node:http').createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(bodies[req.url.split('?')[0].replace(/^\/services\/data\/v[\d.]+/, '')])); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const s = { apiVersion: '60.0', instanceUrl: `http://127.0.0.1:${server.address().port}`, accessToken: 'x' };
  // as:'user' fetches in the page: a stand-in page fetches the same server.
  s.page = { evaluate: async (fn, arg) => { const r = await fetch(s.instanceUrl + arg.url, arg.init); return { status: r.status, text: await r.text() }; } };
  for (const as of ['admin', 'user']) {
    const { fields } = await api.call(s, '/ui-api/records/a00?fields=X.Name', { as });
    assert.equal(fields.Name.value, 'R&D <1> O\'Neil "q" &amp; x', `${as}: one pass, a typed &amp; stays`);
    assert.equal(fields.Owner.displayValue, 'Tom & Jerry', `${as}: a display value`);
    assert.equal(fields.Owner.value.fields.Name.value, 'Tom & Jerry', `${as}: a nested record`);
    assert.deepEqual(fields.Count__c, { value: 5, displayValue: '5' }, `${as}: a number stays a number`);
  }
  assert.equal((await api.call(s, '/ui-api/list-records/X/__Recent')).records[0].fields.Name.value, 'R&D', 'a list\'s records');
  assert.equal((await api.call(s, '/query?q=SELECT MAX(Name) value FROM X', { as: 'admin' })).records[0].value, 'R&amp;D', 'a query is not unescaped');
});

// The same text on an org: written through the token, read back through UI API as typed.
test('api, org: a UI API record read answers text with & < > \' " as stored', { skip, timeout: 60_000 }, async (t) => {
  const s = { apiVersion: '60.0', ...(await auth(env.org)) };
  const Name = `BREAK fix R&D <1> O'Neil "q" &amp; ${stamp()}`;
  const id = await record(s, t, 'Account', { Name, Description: 'Tom & Jerry <b>x</b>' });
  const { fields } = await api.call(s, `/ui-api/records/${id}?fields=Account.Name,Account.Description&optionalFields=Account.Owner.Name`, { as: 'admin' });
  assert.equal(fields.Name.value, Name);
  assert.equal(fields.Description.value, 'Tom & Jerry <b>x</b>');
  const contact = await record(s, t, 'Contact', { LastName: 'BREAK fix entities', AccountId: id });
  const read = await api.call(s, `/ui-api/records/${contact}?fields=Contact.AccountId&optionalFields=Contact.Account.Name`, { as: 'admin' });
  assert.equal(read.fields.Account.displayValue, Name, 'a lookup\'s display value');
  assert.equal(read.fields.Account.value.fields.Name.value, Name, 'a nested record');
});

// The same literals on an org, read through the token with no browser.
test('api, org: query literals with % + & answer as written', { skip, timeout: 60_000 }, async () => {
  const s = { apiVersion: '60.0', ...(await auth(env.org)) };
  const read = (path) => api.call(s, path, { as: 'admin' });
  assert.ok(Array.isArray((await read("/query?q=SELECT Id FROM Account WHERE Name LIKE 'sf-ui%' LIMIT 1")).records), '% in LIKE');
  assert.ok(Array.isArray((await read('/query?q=SELECT Id FROM Account WHERE CreatedDate > 2020-01-01T00:00:00+08:00 LIMIT 1')).records), '+ in an instant');
  assert.equal((await read("/query?q=SELECT Id FROM Account WHERE Name = 'A&B no such account'")).totalSize, 0, '& in a literal');
  assert.ok(Array.isArray((await read('/search?q=FIND {50%} IN NAME FIELDS RETURNING Account(Id)')).searchRecords), '% in FIND');
  await assert.rejects(read("/query?q=SELECT Id FROM Account WHERE Name = '\ud800'"), (e) => e.code === 'INVALID_VALUE');
});

test('api', { skip, timeout: 300_000 }, async (t) => {
  const target = await auth(env.user);
  const targetId = (await (await fetch(`${target.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${target.accessToken}` } })).json()).user_id;
  const s = await session.start(await auth(env.org));
  t.after(() => session.end(s));

  await t.test('reads UI API in the page as the admin', async () => {
    assert.equal((await api.call(s, '/ui-api/object-info/Opportunity')).apiName, 'Opportunity');
  });

  await t.test('the page session reaches UI API only; as admin, the token runs queries', async () => {
    await assert.rejects(api.call(s, '/query?q=SELECT Id FROM Account LIMIT 1'), (e) => e.code === 'API_ERROR' && e.evidence.status === 401);
    assert.equal((await api.call(s, '/query?q=SELECT Id FROM Account LIMIT 1', { as: 'admin' })).records.length, 1);
  });

  await t.test('throws API_ERROR 403 for the same read as the platform user', async () => {
    await session.loginAs(s, targetId);
    await assert.rejects(api.call(s, '/ui-api/object-info/Opportunity'), (e) => e.code === 'API_ERROR' && e.evidence.status === 403);
  });
});
