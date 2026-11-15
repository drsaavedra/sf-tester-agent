'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The shell words of one command, as bench/sf-read-guard.js lets it run and bench.js reads it back from a transcript.
// Shell words, refusing all the shell would expand or chain: unquoted, plain characters only; in double quotes, no $ ` \.
function words(cmd) {
  const out = [];
  let cur = null;
  for (let i = 0; i < cmd.length;) {
    const ch = cmd[i];
    if (ch === "'" || ch === '"') {
      const j = cmd.indexOf(ch, i + 1);
      if (j < 0) throw new Error('open quote');
      const s = cmd.slice(i + 1, j);
      if (ch === '"' && /[$`\\]/.test(s)) throw new Error('expansion'); // no ! : a non-interactive shell expands no history
      cur = (cur ?? '') + s;
      i = j + 1;
    } else if (ch === ' ' || ch === '\t') {
      if (cur !== null) out.push(cur);
      cur = null;
      i += 1;
    } else {
      if (!/[\w\-.,:=@/+]/.test(ch) || (ch === '=' && cur === null)) throw new Error('shell syntax'); // a leading = is zsh's =cmd
      cur = (cur ?? '') + ch;
      i += 1;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

// The sf CLI's org flags.
const ORG_FLAGS = ['-o', '--target-org'];
// The username an sf CLI alias names, from the CLI's own alias file; a username, or no alias file, comes back as given.
function username(org) {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.sfdx', 'alias.json'), 'utf8')).orgs?.[org] ?? org; } catch { return org; }
}

module.exports = { words, ORG_FLAGS, username };
