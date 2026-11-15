'use strict';

// Prove the page runs the build you deployed: look for text only the new build renders, and if it is missing,
// reload once with the HTTP cache disabled (cached component code survives deploys) before calling it stale.
// ponytail: the cache-disabled retry is untested; no stale bundle was available to test it against.
const { SfUiError } = require('./errors');
const lwc = require('./lwc');
const nav = require('./nav');

// The marker is a whole word, case included: V21 is in "Build V21, 12 Nov", not in V210, ÜV21 or v21. A boundary
// applies only on a side where the marker ends in a letter or digit (#21 is in Build#21); a space matches any run.
const WORD = '[\\p{L}\\p{N}_]';
function markerRe(marker) {
  const m = marker.trim();
  if (!m) throw new SfUiError('BAD_ARGS', 'the marker needs a non-space character', { marker });
  const edge = (c) => new RegExp(WORD, 'u').test(c);
  const body = m.split(/\s+/).map(lwc.escRe).join('\\s+');
  return new RegExp(`${edge([...m][0]) ? `(?<!${WORD})` : ''}${body}${edge([...m].at(-1)) ? `(?!${WORD})` : ''}`, 'u');
}

async function verifyLive(s, recordId, lwcApiName, marker, { timeout = 15_000 } = {}) {
  const re = markerRe(marker); // a blank marker is refused before the page is touched
  const seen = async () => {
    const host = await lwc.scope(s, recordId, lwcApiName);
    return host.getByText(re).first().waitFor({ timeout }).then(() => true, (e) => { if (e.name !== 'TimeoutError') throw e; return false; });
  };
  if (await seen()) return true;
  const cdp = await s.context.newCDPSession(s.page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  try {
    await nav.openRecord(s, recordId); // lwc.scope reuses an open page, so the retry reloads it itself
    if (await seen()) return true;
  } finally {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  }
  throw new SfUiError('STALE_BUILD', `${lwcApiName} does not render "${marker}" even with the cache disabled`, { recordId, lwcApiName, marker });
}

module.exports = { verifyLive, markerRe };
