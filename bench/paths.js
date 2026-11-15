'use strict';

// Where the bench keeps its files: bench.js writes them, and agents/guard.js keeps testers out of them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_ROOT = path.join(os.homedir(), '.sf-tester', 'bench');
const benchRoot = () => process.env.SF_TESTER_BENCH || DEFAULT_ROOT;
const beside = (suffix) => path.join(path.dirname(benchRoot()), `${path.basename(benchRoot())}-${suffix}`);

// The real path in its case on disk (macOS folders ignore case), of the nearest existing parent for a file not there.
const real = (p) => {
  let head = p, tail = '';
  while (!fs.existsSync(head)) { if (path.dirname(head) === head) return p; tail = path.join(path.basename(head), tail); head = path.dirname(head); }
  return path.join(fs.realpathSync.native(head), tail);
};
// Whether p is dir or inside it. The guard and bench.js both judge real paths with it, so a link cannot split them.
const within = (p, dir) => { const r = path.relative(dir, p); return r === '' || (r.split(path.sep)[0] !== '..' && !path.isAbsolute(r)); };

module.exports = { DEFAULT_ROOT, benchRoot, beside, real, within };
