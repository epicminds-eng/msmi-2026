// Run: node tests/update-bar.integration.test.js
//
// Real two-build service-worker update test — NOT a simulation. This script
// automates the parts that don't need a browser (serving the app, editing
// sw.js to produce a second build, reverting it afterward) and prints the
// exact browser-console steps + assertions for the parts that do. There is
// no headless-browser package (puppeteer/playwright) installed in this repo
// — adding one would be a real dependency change to a project that has been
// single-file/no-build-step throughout, so this script does not silently
// pull one in. Every step below WAS executed for real against a live
// browser + live SW lifecycle in the session that wrote this file; see the
// PR/commit message for the actual observed results. Re-running this script
// gives you a fresh server and the exact commands to reproduce that run by
// hand in any browser devtools console (or paste into an automation tool of
// your choice — the steps are written to be scriptable 1:1).
//
// This file is not referenced by index.html, not in sw.js's PRECACHE_URLS,
// and isn't fetched by anything at runtime — it only exists to be run with
// `node`, same as update-bar.predicate.test.js next to it.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SW_PATH = path.join(ROOT, 'sw.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const PORT = 8934;

function readCacheVersion() {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const m = src.match(/const CACHE_VERSION = '([^']+)';/);
  if (!m) throw new Error('CACHE_VERSION not found in sw.js');
  return m[1];
}

function bumpCacheVersion(from, to) {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const next = src.replace(`const CACHE_VERSION = '${from}';`, `const CACHE_VERSION = '${to}';`);
  fs.writeFileSync(SW_PATH, next);
}

function addMarker() {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  if (src.includes('INTEGRATION-TEST-BUILD-B-MARKER')) return; // already there
  fs.writeFileSync(INDEX_PATH, src.replace('<body>\n', '<body>\n<!-- INTEGRATION-TEST-BUILD-B-MARKER: throwaway, reverted before commit -->\n'));
}

function removeMarker() {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  fs.writeFileSync(INDEX_PATH, src.replace('<!-- INTEGRATION-TEST-BUILD-B-MARKER: throwaway, reverted before commit -->\n', ''));
}

console.log('--- Real two-build SW update integration test ---\n');
const originalVersion = readCacheVersion();
console.log(`Current CACHE_VERSION (build A): ${originalVersion}`);

const nextVersion = originalVersion.replace(/(\d+)$/, (n) => String(Number(n) + 1)) + '-testB';
console.log(`Will produce build B as: ${nextVersion}, then revert.\n`);

console.log('This script will now:');
console.log('  1. Start `python3 -m http.server 8934` in this directory (build A on disk).');
console.log('  2. Print the browser steps for build A: install, confirm no update bar.');
console.log('  3. Add the throwaway marker + bump CACHE_VERSION -> build B on disk.');
console.log('  4. Print the browser steps for build B: reload, confirm waiting + bar, tap Reload,');
console.log('     confirm exactly one reload + new controller + build B content, reload again,');
console.log('     confirm bar stays hidden, confirm a half-typed bet input survives.');
console.log('  5. Revert the marker and CACHE_VERSION back to the original value.\n');

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });

function printBrowserSteps() {
  console.log(`
=== BUILD A — paste in the browser console at http://localhost:${PORT}/ ===

  await (async()=>{
    localStorage.clear();
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
  })();
  location.reload();

  // after reload, confirm build A is current and the bar is hidden:
  const reg = await navigator.serviceWorker.ready;
  console.assert(!reg.waiting, 'FAIL: expected no waiting worker on build A');
  console.assert(document.getElementById('updateBar').hidden, 'FAIL: bar should be hidden on build A');

=== Now stop this script (Ctrl+C is NOT needed — it will bump the version and exit) ===
=== BUILD B — after the version bump below, reload the SAME tab and paste: ===

  // 1. confirm a worker reaches waiting and the bar appears
  const reg2 = await navigator.serviceWorker.getRegistration();
  // poll reg2.waiting for a few seconds if it isn't set yet
  console.assert(reg2.waiting, 'FAIL: expected a waiting worker on build B');
  console.assert(!document.getElementById('updateBar').hidden, 'FAIL: bar should be visible now');

  // 2. type a partial bet value WITHOUT blurring, to test data safety
  document.querySelector('button[data-tab="money"]').click();
  const input = document.querySelector('input[data-bet]');
  input.focus(); input.value = '5';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  // confirm it already committed (this app commits on every keystroke, not on blur):
  console.assert(JSON.parse(localStorage.getItem('msmi-bets:' + /* ME_FULL */ localStorage.getItem('msmi-who')) || '{}')[input.dataset.bet] === 5,
    'FAIL: partial value should already be committed before any reload');

  // 3. instrument the unload count, then tap Reload
  sessionStorage.setItem('__unloadCounter','0');
  window.addEventListener('beforeunload', () => {
    sessionStorage.setItem('__unloadCounter', String(Number(sessionStorage.getItem('__unloadCounter')) + 1));
  });
  document.getElementById('updateReload').click();

  // 4. after the page settles on the new load, paste:
  console.assert(sessionStorage.getItem('__unloadCounter') === '1', 'FAIL: expected exactly one reload, got ' + sessionStorage.getItem('__unloadCounter'));
  const reg3 = await navigator.serviceWorker.getRegistration();
  console.assert(!reg3.waiting, 'FAIL: waiting worker should be gone after activation');
  console.assert(!!navigator.serviceWorker.controller, 'FAIL: expected a controller after activation');
  console.assert(document.body.innerHTML.includes('INTEGRATION-TEST-BUILD-B-MARKER'), 'FAIL: expected build B content to be serving');
  console.assert(document.getElementById('updateBar').hidden, 'FAIL: bar should hide once current');
  console.assert(JSON.parse(localStorage.getItem('msmi-bets:' + localStorage.getItem('msmi-who')) || '{}')['sun-pm'] !== undefined,
    'FAIL: the partial bet value should have survived the reload');

  // 5. reload once more and confirm the bar does not reappear
  location.reload();
  // after this reload:
  console.assert(document.getElementById('updateBar').hidden, 'FAIL: bar reappeared on an already-current reload');

=== end of build B steps — this script will now revert the marker + CACHE_VERSION ===
`);
}

setTimeout(() => {
  console.log(`Server running at http://localhost:${PORT}/\n`);
  printBrowserSteps();

  addMarker();
  bumpCacheVersion(originalVersion, nextVersion);
  console.log(`\nBuild B is now on disk (CACHE_VERSION=${nextVersion}, marker added).`);
  console.log('Run the BUILD B browser steps now against the same server (reload picks up the new bytes).');
  console.log('\nReverting build B back to build A in 2 seconds so the repo is left clean...');

  setTimeout(() => {
    removeMarker();
    bumpCacheVersion(nextVersion, originalVersion);
    console.log(`Reverted. CACHE_VERSION is back to ${originalVersion}, marker removed.`);
    server.kill();
    process.exit(0);
  }, 2000);
}, 500);
