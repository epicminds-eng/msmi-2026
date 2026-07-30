// Run: node tests/overlay-rotation.test.js
//
// READ THIS BEFORE TRUSTING A GREEN RESULT.
//
// This is a regression guard, not proof the bug is fixed. Resizing a desktop
// Chromium viewport is not a rotation: it does not reproduce iOS/WebKit's
// 100vh staleness, does not change env(safe-area-inset-*) the way a real
// notch does on rotation, and does not exercise touch/momentum scrolling.
// Every assertion below passed against the pre-fix code (bare vh on both
// .picker and .sheetbox) in this Chromium-based harness — the harness cannot
// see this class of bug at all, in either direction. That was checked by
// hand this session: the same rotation sequence was run against commits
// e589431 (v21, before the update bar existed), 975b73c (v22, bar just
// added), and HEAD before this fix, all with identical results (scroll
// always worked). So a PASS here does not mean the phone is fixed, and would
// not have caught the original bug either. What it DOES guard against:
// someone re-introducing a body/html scroll lock, removing overflow-y:auto,
// breaking the flex sizing, or regressing the basic "does this element have
// a scrollable area at all" property — real ways this could break again that
// a plain resize CAN observe.
//
// The only thing that actually proves the fix: Chad rotating a real,
// installed, notched iPhone through the exact repro in the bug report.
//
// This script automates the non-browser parts (starting the static server)
// and prints the exact browser-console steps + assertions, following the
// pattern in tests/update-bar.integration.test.js. No headless-browser
// package (puppeteer/playwright) is installed in this repo, and installing
// one is a real dependency change to a project that has been single-file/
// no-build-step throughout, so this does not silently add one.
//
// Not loaded by index.html, not in sw.js's PRECACHE_URLS, doesn't affect the
// app.

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8934;

console.log('--- Overlay rotation regression guard ---\n');
console.log('LIMITATION: this environment cannot reproduce the WebKit defect the bug');
console.log('report describes (confirmed by hand across three historical commits before');
console.log('writing this file). Every check below is a regression guard, not proof.\n');

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });

setTimeout(() => {
  console.log(`Server running at http://localhost:${PORT}/\n`);
  console.log(`
=== Run in a real browser devtools console, at http://localhost:${PORT}/ ===

// 0. clean slate
await (async()=>{
  localStorage.clear();
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r=>r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map(k=>caches.delete(k)));
})();
location.reload();

// resize the devtools viewport to 390x844 (portrait) before continuing.

// === PICKER, bar hidden (default state on a fresh load) ===
{
  const picker = document.getElementById('picker');
  console.assert(picker.scrollHeight > picker.clientHeight, 'FAIL: picker should have scrollable overflow in portrait');
  // resize devtools to 844x390 (landscape), THEN run:
  // console.assert(picker.scrollHeight > picker.clientHeight, 'FAIL: not scrollable in landscape');
  // picker.scrollTop = 100; console.assert(picker.scrollTop === 100, 'FAIL: scrollTop did not land in landscape');
  // resize devtools BACK to 390x844 (portrait), THEN run:
  // console.assert(picker.scrollHeight > picker.clientHeight, 'FAIL: not scrollable after rotate-and-return');
  // picker.scrollTop = 300; console.assert(picker.scrollTop === 300, 'FAIL: scrollTop did not land after rotate-and-return');
  picker.scrollTop = 0;
}

// === PICKER, bar forced visible (simulates a real waiting-worker state) ===
{
  document.getElementById('updateBar').hidden = false;
  // repeat the exact three resize + assert steps above with the bar visible.
  document.getElementById('updateBar').hidden = true;
}

// === SCORECARD SHEET, bar hidden ===
{
  hidePicker();
  localStorage.setItem('msmi-who','NICK ALBERS'); setIdentity('NICK ALBERS'); bootApp();
  openSheet('MASTERPIECE', null, 'mon-am');
  const box = document.getElementById('sheetbox');
  console.assert(box.scrollHeight > box.clientHeight, 'FAIL: sheet should be scrollable in portrait');
  // repeat the same landscape / rotate-back / scrollTop checks as the picker, against #sheetbox.
  closeSheet();
}

// === SCORECARD SHEET, bar forced visible ===
{
  document.getElementById('updateBar').hidden = false;
  openSheet('MASTERPIECE', null, 'mon-am');
  // repeat the same checks against #sheetbox.
  closeSheet();
  document.getElementById('updateBar').hidden = true;
}

// === no leftover scroll lock, checked in BOTH orientations ===
{
  showPicker(); hidePicker();
  console.assert(getComputedStyle(document.body).overflow !== 'hidden', 'FAIL: body left overflow:hidden');
  console.assert(getComputedStyle(document.body).position !== 'fixed', 'FAIL: body left position:fixed');
  console.assert(getComputedStyle(document.documentElement).overflow !== 'hidden', 'FAIL: html left overflow:hidden');
  console.assert(getComputedStyle(document.documentElement).position !== 'fixed', 'FAIL: html left position:fixed');
  // resize to landscape (844x390) and repeat the four asserts above.
}

console.log('If every console.assert above was silent, nothing regressed that this');
console.log('harness can see. This does NOT mean the iOS bug is fixed — only a real');
console.log('device rotation proves that.');
`);
  server.kill();
  process.exit(0);
}, 500);
