// Run: node tests/overlay-rotation.test.js
//
// READ THIS BEFORE TRUSTING A GREEN RESULT.
//
// This is a regression guard, not proof the bug is fixed. Resizing a desktop
// Chromium viewport is not a rotation: it does not reproduce WebKit's stale-
// scroller-geometry defect (a scroller that fails to recompute its scrollable
// area until an unrelated repaint forces a relayout), does not change
// env(safe-area-inset-*) the way a real notch does on rotation, and does not
// exercise touch/momentum scrolling.
//
// History, so the next person doesn't re-litigate it: the first attempt at
// this fix (35a0c76) treated it as a stale-vh-height problem and either
// removed or dvh-guarded the viewport units. Real-device testing afterward
// showed that was the WRONG diagnosis — a wrong measured height is
// deterministic (broken every time); Chad's phone showed the scorecard sheet
// dead in landscape outright, AND the picker recovering scroll on its own
// after a delay. A scroller that self-recovers is WebKit failing to
// recalculate scrollable area, not a wrong number. This fix (this commit)
// restructures both overlays so the fixed positioner (overflow:hidden) and
// the actual scroller (a separate, non-fixed descendant) are different
// elements, and adds a resize/orientationchange-triggered relayout nudge
// (toggle overflow-y off/on to force a synchronous reflow) as a second line
// of defense CSS alone could not provide.
//
// This Chromium harness could not see the ORIGINAL bug (confirmed by hand
// across three historical commits — e589431, 975b73c, HEAD-before-35a0c76 —
// all passed identically before any fix existed) and there is no reason to
// believe it can see THIS variant either. So a PASS here does not mean the
// phone is fixed. What it DOES prove: the new DOM/CSS structure exists as
// designed, both scrollers work at two different viewport sizes, the relayout
// handler fires without throwing and without disturbing scroll position, and
// no scroll lock is left on body/html. Those are real properties worth
// guarding even though none of them is the acceptance test.
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

console.log('--- Overlay rotation regression guard (v2 — stale-scroller-geometry fix) ---\n');
console.log('LIMITATION: this environment cannot reproduce the WebKit defect. Every check');
console.log('below is a regression guard, not proof. See the file header for why.\n');

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

// resize devtools to 390x844 (portrait) before continuing.

// === STRUCTURE: fixed positioner and scroller must be different elements ===
{
  const picker = document.getElementById('picker');
  const pickwrap = document.querySelector('.pickwrap');
  console.assert(getComputedStyle(picker).position === 'fixed', 'FAIL: #picker should be the fixed positioner');
  console.assert(getComputedStyle(picker).overflowY === 'hidden', 'FAIL: #picker should not scroll itself');
  console.assert(getComputedStyle(pickwrap).position !== 'fixed', 'FAIL: .pickwrap must not be position:fixed');
  console.assert(getComputedStyle(pickwrap).overflowY === 'auto', 'FAIL: .pickwrap should be the scroller');
}

// === PICKER SCROLLER (.pickwrap, NOT #picker), bar hidden ===
{
  const pickwrap = document.querySelector('.pickwrap');
  console.assert(pickwrap.scrollHeight > pickwrap.clientHeight, 'FAIL: picker scroller has no overflow in portrait');
  pickwrap.scrollTop = 300;
  console.assert(pickwrap.scrollTop === 300, 'FAIL: scrollTop did not land in portrait');
  pickwrap.scrollTop = 0;
  // resize devtools to 844x390 (landscape) and repeat the three asserts above —
  // landscape is a first-class case here, not just rotate-and-return.
}

// === PICKER, bar forced visible (simulates a real waiting-worker state) ===
{
  document.getElementById('updateBar').hidden = false;
  // repeat the .pickwrap checks above with the bar visible, at both sizes.
  document.getElementById('updateBar').hidden = true;
}

// === SCORECARD SHEET STRUCTURE + SCROLLER, bar hidden ===
{
  hidePicker();
  localStorage.setItem('msmi-who','NICK ALBERS'); setIdentity('NICK ALBERS'); bootApp();
  openSheet('MASTERPIECE', null, 'mon-am');
  const sheet = document.getElementById('sheet');
  const box = document.getElementById('sheetbox');
  console.assert(getComputedStyle(sheet).overflowY === 'hidden', 'FAIL: #sheet should not scroll itself');
  console.assert(getComputedStyle(box).overflowY === 'auto', 'FAIL: #sheetbox should be the scroller');
  console.assert(box.scrollHeight > box.clientHeight, 'FAIL: sheet scroller has no overflow in portrait');
  box.scrollTop = 50; console.assert(box.scrollTop === 50, 'FAIL: scrollTop did not land in portrait');
  box.scrollTop = 0;
  // resize devtools to 844x390 and repeat — the sheet has a landscape-specific
  // max-height:100dvh override (was max-height:92vh/dvh tuned for portrait,
  // which left almost no room once ~390px tall); confirm it's still
  // scrollHeight > clientHeight there too, not just "less clipped."
  closeSheet();
}

// === SCORECARD SHEET, bar forced visible ===
{
  document.getElementById('updateBar').hidden = false;
  openSheet('MASTERPIECE', null, 'mon-am');
  // repeat the #sheetbox checks above with the bar visible, at both sizes.
  closeSheet();
  document.getElementById('updateBar').hidden = true;
}

// === relayout handler: safe with nothing open, never throws, preserves scrollTop ===
{
  hidePicker(); closeSheet(); // nothing open
  let threw = false;
  try{
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
  }catch(e){ threw = true; }
  console.assert(!threw, 'FAIL: relayout handler threw with no overlay open');

  showPicker();
  const pickwrap = document.querySelector('.pickwrap');
  pickwrap.scrollTop = 250;
  window.dispatchEvent(new Event('resize'));
  console.assert(pickwrap.scrollTop === 250, 'FAIL: relayout handler moved scrollTop');
  // wait ~450ms (the handler's own delayed second pass fires at 350ms) and
  // recheck pickwrap.scrollTop === 250 — it should still hold.
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

// === horizontal overflow, all three skins ===
{
  showPicker();
  ['teal','char','epicminds'].forEach(skin=>{
    applySkin(skin,false);
    document.querySelectorAll('#picker *').forEach(el=>{
      console.assert(!(el.scrollWidth > el.clientWidth+1 && getComputedStyle(el).display!=='none'),
        'FAIL: horizontal overflow in ' + skin + ' on ' + el.className);
    });
  });
  applySkin('teal',false);
  hidePicker();
}

console.log('If every console.assert above was silent, nothing regressed that this');
console.log('harness can see. This does NOT mean the iOS bug is fixed — only a real');
console.log('device rotation, in both the picker AND the scorecard sheet, proves that.');
`);
  server.kill();
  process.exit(0);
}, 500);
