'use strict';

// as:'user' (default) runs fetch inside the Lightning page, so it answers as whoever the page runs as,
// Login As target included; that cookie reaches UI API only (query, describe, tooling answer 401).
// as:'admin' uses the session's token from Node, for queries and metadata the user cannot read.
const { randomBytes } = require('node:crypto');
const { SfUiError, fetchCoded } = require('./errors');
const { unxml } = require('./xml');

async function call(s, path, { method = 'GET', body, as = 'user', signal } = {}) {
  if (method === 'GET') assertRead(path); // object names and ids reach this path from tool arguments
  const url = `/services/data/v${s.apiVersion}${encodeQuery(path)}`;
  const init = { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined };
  let res;
  if (as === 'admin') {
    const r = await fetchCoded(s.instanceUrl + url, { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${s.accessToken}` } }); // signal: admin only
    res = { status: r.status, text: await r.text() };
  } else {
    res = await s.page.evaluate(async ({ url, init }) => {
      const r = await fetch(url, init);
      return { status: r.status, text: await r.text() };
    }, { url, init });
  }
  let json = null;
  // An HTML error page (a 401, a 500) is not JSON: its text goes in evidence, so status and code survive.
  try { json = res.text ? JSON.parse(res.text) : null; } catch { json = undefined; }
  if (res.status >= 300 || json === undefined) {
    const errorCode = Array.isArray(json) && json[0] ? json[0].errorCode : undefined;
    throw new SfUiError('API_ERROR', `${method} ${path} as ${as} answered ${res.status}${errorCode ? ` ${errorCode}` : ''}${json === undefined ? ', not JSON' : ''}`, { status: res.status, errorCode, body: json ?? res.text.trim().slice(0, 500) });
  }
  return /^ui-api\/(list-)?records(\/|$)/.test(routeOf(path)) ? asStored(json) : json;
}

// UI API sends a record's text entity-escaped (R&amp;D), in a list's records and nested ones too, where SOQL sends it
// as stored (measured, F-cascade-30): each string value and displayValue is unescaped in one pass, so a typed &amp; stays.
const asStored = (x) => (Array.isArray(x) ? x.map(asStored) : x && typeof x === 'object'
  ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (k === 'value' || k === 'displayValue') && typeof v === 'string' ? unxml(v) : asStored(v)])) : x);

// For calls that must not move with the org's release; a live session uses its own version. A route's app and FlexiPage
// hashes are read at this version, so a change here moves those baselines.
const PINNED_VERSION = '60.0';

// What a GET may reach, for every caller. A list of what passes, not of what is refused: /tooling/executeAnonymous runs Apex on a GET.
const READ_ROOTS = ['query', 'queryAll', 'tooling/query', 'tooling/queryAll', 'sobjects', 'tooling/sobjects', 'recent', 'limits', 'search', 'ui-api'];
const BASE = `/services/data/v${randomBytes(4).toString('hex')}`; // a path cannot spell it, so it cannot step out and back in

// The URL parser reads the path as fetch will send it, so .. and a backslash cannot step out of a root. A server could
// decode an escape before it routes, so the decoded path is judged too; what will not decode is refused.
// routeOf is the route a path reaches, '' for one that leaves the root or cannot be judged; the budget gate shares it.
function routeOf(path) {
  const { pathname } = new URL(`https://x${BASE}${path}`);
  let text = ';';
  try { text = decodeURIComponent(pathname); } catch { /* stays refused */ }
  if (!pathname.startsWith(`${BASE}/`) || /[;%\\\x00-\x1f]|(^|\/)\.\.(\/|$)/.test(text)) return '';
  return pathname.slice(BASE.length + 1);
}
// A query root takes one q, so all after ?q= is its value: sent encoded, so a literal's % + & # survives. An encoded q
// is decoded first; a raw literal that is also an escape (LIKE 'A%20B') decodes too. A lone surrogate cannot be encoded.
const Q_ROOTS = ['query', 'queryAll', 'tooling/query', 'tooling/queryAll', 'search'];
function encodeQuery(path) {
  const at = path.indexOf('?q=');
  if (at < 0 || !Q_ROOTS.includes(routeOf(path.slice(0, at)).replace(/\/$/, ''))) return path;
  const raw = path.slice(at + 3);
  if (!raw.isWellFormed()) throw new SfUiError('INVALID_VALUE', 'q holds a lone surrogate, which no URL can carry', { path });
  let text = raw;
  try { text = decodeURIComponent(raw); } catch { /* a % that is no escape: sent as typed */ }
  return `${path.slice(0, at + 3)}${encodeURIComponent(text)}`;
}
function assertRead(path) {
  const route = routeOf(path);
  if (!READ_ROOTS.some((r) => route === r || route.startsWith(`${r}/`))) {
    throw new SfUiError('PATH_REFUSED', `a read reaches only ${READ_ROOTS.map((r) => `/${r}`).join(', ')}, not ${path}`, { path });
  }
}

module.exports = { call, assertRead, routeOf, READ_ROOTS, PINNED_VERSION };
