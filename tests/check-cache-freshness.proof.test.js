// Run: node tests/check-cache-freshness.proof.test.js
//
// Proves check-cache-freshness.js actually discriminates, rather than
// always passing or always failing by construction (the same class of bug
// the first version of check-data-vs-sheet.js had). Uses manifest.json as
// the guinea pig -- a real, in-scope, precached content file -- and restores
// its exact bytes and mtime afterward no matter what happens, via finally.
//
// Sequence: baseline should currently pass (sw.js was the last file this
// task touched, so it's the newest thing in the repo) -> edit manifest.json
// without touching sw.js, confirm the check now fails and names
// manifest.json -> touch sw.js (simulating a CACHE_VERSION bump), confirm
// the check passes again.

const fs = require('fs');
const path = require('path');
const { runCheck } = require('./check-cache-freshness');

const ROOT = path.join(__dirname, '..');
const GUINEA_PIG = path.join(ROOT, 'manifest.json');
const SW = path.join(ROOT, 'sw.js');

const originalContent = fs.readFileSync(GUINEA_PIG);
const originalMtime = fs.statSync(GUINEA_PIG).mtime;
const swOriginalMtime = fs.statSync(SW).mtime;

let clock = Date.now();
function touch(file) {
  clock += 1000;
  const d = new Date(clock);
  fs.utimesSync(file, d, d);
}

let failures = 0;

try {
  const baseline = runCheck();
  const baselinePass = baseline.failures === 0;
  console.log(`${baselinePass ? 'PASS' : 'FAIL'}  baseline (current repo state) has no stale files -> stale: [${baseline.staleFiles.join(', ')}]`);
  if (!baselinePass) failures++;

  fs.appendFileSync(GUINEA_PIG, ' ');
  touch(GUINEA_PIG);
  const afterEdit = runCheck();
  const caughtStaleness = afterEdit.failures > 0 && afterEdit.staleFiles.includes('manifest.json');
  console.log(`${caughtStaleness ? 'PASS' : 'FAIL'}  editing manifest.json without bumping sw.js is caught -> stale: [${afterEdit.staleFiles.join(', ')}]`);
  if (!caughtStaleness) failures++;

  touch(SW);
  const afterBump = runCheck();
  const bumpClears = afterBump.failures === 0;
  console.log(`${bumpClears ? 'PASS' : 'FAIL'}  touching sw.js afterward (simulated bump) clears the failure -> stale: [${afterBump.staleFiles.join(', ')}]`);
  if (!bumpClears) failures++;
} finally {
  fs.writeFileSync(GUINEA_PIG, originalContent);
  fs.utimesSync(GUINEA_PIG, originalMtime, originalMtime);
  fs.utimesSync(SW, swOriginalMtime, swOriginalMtime);
}

console.log(`\n${3} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
