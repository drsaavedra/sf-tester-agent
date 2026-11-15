'use strict';

// Every function throws only coded errors, with what it saw attached, so an agent can branch on `code`.
class SfUiError extends Error {
  constructor(code, message, evidence = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.evidence = evidence;
  }
}

// Node's fetch rejects with a bare "fetch failed" and the reason (ENOTFOUND, ECONNRESET...) in cause; keep that code.
// The body read can reject the same way (a reset mid-body), so text and json are coded too.
function coded(e, url, init) {
  if (!e.cause) throw e; // not a network fault: a bug keeps its own error
  const cause = e.cause?.code ?? e.cause?.message;
  throw new SfUiError('API_ERROR', `${init?.method ?? 'GET'} ${new URL(url).pathname}: ${e.message}${cause ? ` (${cause})` : ''}`, { cause });
}
async function fetchCoded(url, init) {
  let r;
  try { r = await fetch(url, init); } catch (e) { coded(e, url, init); }
  for (const read of ['text', 'json']) {
    if (typeof r[read] !== 'function') continue; // a stub response may carry only one reader
    const own = r[read].bind(r);
    r[read] = () => own().catch((e) => coded(e, url, init));
  }
  return r;
}

// A tool's own moments (clicked, seen...) ride on its result or error under this key, never in its JSON,
// so they cannot collide with an answer's own fields; the server's wrapper merges them into at.
const AT = Symbol('at');

module.exports = { SfUiError, fetchCoded, AT };
