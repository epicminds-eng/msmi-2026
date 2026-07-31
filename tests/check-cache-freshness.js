// Run: node tests/check-cache-freshness.js
//
// The service worker's fetch handler cache-firsts EVERY same-origin GET
// request, not just the files listed in PRECACHE_URLS (see the header
// comment in sw.js). That means any git-tracked file this app actually
// serves can go stale on a returning visitor's device until CACHE_VERSION
// changes -- that's exactly how install/index.html went stale twice: it was
// never even in PRECACHE_URLS, yet still got runtime-cached on first visit,
// and CACHE_VERSION wasn't bumped alongside either commit that changed it.
//
// This check is deliberately broader than PRECACHE_URLS: it watches every
// git-tracked file at the repo root except sw.js itself (self-referential --
// its own mtime is the thing being compared against) and the tests/
// directory (the test suite is dev tooling, never fetched by a player's
// phone). If any watched file's mtime is newer than sw.js's, CACHE_VERSION
// is presumed stale relative to it.
//
// Caveat: this compares filesystem mtimes, not git history. A fresh clone or
// checkout resets every file's mtime to roughly the same moment, so this is
// a local pre-commit sanity check against your working tree's real edit
// times, not a CI gate you can run against an arbitrary checkout.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function getWatchedFiles() {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(f => f !== 'sw.js' && !f.startsWith('tests/'));
}

function runCheck() {
  const files = getWatchedFiles();
  const swMtime = fs.statSync(path.join(ROOT, 'sw.js')).mtimeMs;
  const staleFiles = files.filter(f => fs.statSync(path.join(ROOT, f)).mtimeMs > swMtime);
  return { files, staleFiles, failures: staleFiles.length };
}

if (require.main === module) {
  const { files, staleFiles, failures } = runCheck();
  if (failures) {
    console.error(`FAIL: ${staleFiles.length} file(s) changed more recently than sw.js -- CACHE_VERSION likely needs a bump:`);
    staleFiles.forEach(f => console.error('  - ' + f));
  } else {
    console.log(`PASS: no watched file is newer than sw.js (${files.length} file(s) checked)`);
  }
  console.log(`\n${failures} failure(s).`);
  process.exit(failures ? 1 : 0);
}

module.exports = { runCheck, getWatchedFiles };
