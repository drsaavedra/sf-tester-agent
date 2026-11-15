'use strict';

// What the tester agent could not do, or could do only by a workaround, kept across sessions so the tools and
// their area catalogue grow from real testing. Lives outside the repo (entries can name client components);
// SF_TESTER_IMPROVEMENTS moves it. A repeat of the same area and what counts up, so the most seen rise to the top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SfUiError } = require('./errors');

const KINDS = ['missing', 'broken', 'workaround', 'flaky'];
const defaultFile = () => process.env.SF_TESTER_IMPROVEMENTS || path.join(os.homedir(), '.sf-tester', 'improvements.jsonl');
const fold = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
const key = (e) => `${fold(e.area)}\u0000${fold(e.what)}`;
const inArea = (area) => (e) => fold(e.area) === fold(area); // an area matches in any case or spacing, as key() does

// A line that does not parse (a write cut short, a hand edit) is skipped and kept in entries.bad, and every
// write puts it back as it was, so one bad line neither stops the log nor gets lost from it.
function read(file) {
  const entries = Object.assign([], { bad: [] });
  if (!fs.existsSync(file)) return entries;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let e;
    try { e = JSON.parse(line); } catch { e = null; }
    if (e && typeof e === 'object' && !Array.isArray(e)) entries.push(e); else entries.bad.push(line);
  }
  return entries;
}

const write = (file, entries) => fs.writeFileSync(file, [...entries.map((e) => JSON.stringify(e)), ...entries.bad].join('\n') + '\n');

function record({ area, kind, what, sameAs, tried, evidence, suggestion }, { file = defaultFile() } = {}) {
  if (!area || !what || !KINDS.includes(kind)) {
    throw new SfUiError('BAD_ARGS', `an improvement needs an area, what happened, and a kind of ${KINDS.join(', ')}`, { area, kind, what });
  }
  const entries = read(file);
  const now = new Date().toISOString();
  const entry = { area, kind, what, tried, evidence, suggestion };
  // A reworded repeat names the entry it repeats in sameAs; exact wording alone missed those.
  const found = entries.find((e) => key(e) === key({ area, what: sameAs || what }));
  if (sameAs && !found) throw new SfUiError('NOT_FOUND', `no improvement in ${area} reads "${sameAs}"`, { area, known: entries.filter(inArea(area)).map((e) => e.what) });
  // A repeat keeps its first wording and takes the latest details, so the log shows the current state.
  const saved = found
    ? Object.assign(found, Object.fromEntries(Object.entries({ kind, tried, evidence, suggestion }).filter(([, v]) => v)), { seen: found.seen + 1, lastSeen: now })
    : { ...entry, seen: 1, firstSeen: now, lastSeen: now };
  if (saved.fixed) { saved.reopened = saved.fixed; delete saved.fixed; }
  if (!found) entries.push(saved);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  write(file, entries);
  return saved;
}

// Marks an entry fixed by a commit, so list stops offering it; recording it again reopens it as a regression.
function fix({ area, what, fixedBy }, { file = defaultFile() } = {}) {
  if (!area || !what || !fixedBy) throw new SfUiError('BAD_ARGS', 'a fix needs the entry\'s area and what, and fixedBy (a commit)', { area, what, fixedBy });
  const entries = read(file);
  const found = entries.find((e) => key(e) === key({ area, what }));
  if (!found) throw new SfUiError('NOT_FOUND', `no improvement in ${area} reads "${what}"`, { area, open: entries.filter((e) => inArea(area)(e) && !e.fixed).map((e) => e.what) });
  found.fixed = { by: fixedBy, at: new Date().toISOString() };
  write(file, entries);
  return found;
}

// The array carries skipped (not enumerable, so it compares as a plain list): the lines that did not parse.
function list({ area, all = false, file = defaultFile() } = {}) {
  const entries = read(file);
  const out = entries.filter((e) => (!area || inArea(area)(e)) && (all || !e.fixed)).sort((a, b) => b.seen - a.seen);
  return Object.defineProperty(out, 'skipped', { value: entries.bad.length });
}

module.exports = { record, fix, list, KINDS };
