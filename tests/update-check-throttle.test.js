// Run: node tests/update-check-throttle.test.js
//
// Regression guard for the v2.0.0 foreground update-check fix. Before this,
// registration.update() only ever ran once, at launch: coming back from the
// background never re-checked, so a waiting update sat unnoticed until the
// next full reload — Chad had to force-quit the app to see the update bar.
// checkForUpdateOnForeground() (wired to visibilitychange) is meant to fix
// that, but the fix is only actually safe if it:
//   a) fires when the tab becomes visible again
//   b) is throttled, so flicking between apps repeatedly doesn't hammer
//      update() over and over
//   c) never throws even when update() itself rejects (this app runs
//      offline in Gaylord — a failed check must never surface an error)
//   d) never touches the update bar or scroll position directly (only
//      update() itself, which re-enters the existing renderUpdateBar() path
//      if — and only if — a new version is actually found)
//
// This drives the real function, extracted verbatim from index.html by
// regex, in a sandboxed Node vm — with a mocked document.visibilityState, a
// mocked swRegistration.update() that counts calls and can be made to
// reject, and a mocked Date.now() so the multi-minute throttle window can be
// crossed without an actual wait. Not loaded by index.html, not in sw.js's
// PRECACHE_URLS, doesn't affect the app.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name, pattern) {
  const m = html.match(pattern);
  if (!m) { console.error(`FAIL: could not find ${name} in index.html`); process.exit(1); }
  return m[0];
}

const pieces = [
  extract('UPDATE_CHECK_THROTTLE_MS', /const UPDATE_CHECK_THROTTLE_MS=[^\n]*;/),
  extract('lastUpdateCheckAt', /let lastUpdateCheckAt=0;/),
  extract('checkForUpdateOnForeground', /function checkForUpdateOnForeground\(\)\{[\s\S]*?\n\}/),
];

let updateCallCount = 0;
let updateShouldReject = false;
let mockNow = 0;

const sandbox = {
  document: { visibilityState: 'visible', addEventListener: () => {} },
  swRegistration: {
    update: () => {
      updateCallCount++;
      return updateShouldReject ? Promise.reject(new Error('offline')) : Promise.resolve();
    },
  },
  Date: { now: () => mockNow },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  pieces.join('\n') + '\nthis.__exports = {checkForUpdateOnForeground: checkForUpdateOnForeground};',
  sandbox
);
const { checkForUpdateOnForeground } = sandbox.__exports;

let failures = 0;
function report(pass, label) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures++;
}

// 1. fires on visible. Start mockNow well past the throttle window: the real
// lastUpdateCheckAt starts at 0, and a real Date.now() is always astronomically
// larger than that, so the first-ever real call is never throttled by the
// initial baseline — the mock has to honor that same assumption.
mockNow = 10 * 60 * 1000;
checkForUpdateOnForeground();
report(updateCallCount === 1, 'fires update() the first time visibilityState is visible');

// 2. respects throttle: an immediate second call must not call update() again
checkForUpdateOnForeground();
report(updateCallCount === 1, 'throttle: an immediate second call does not call update() again');

// 3. hidden -> never fires, regardless of throttle state
sandbox.document.visibilityState = 'hidden';
mockNow += 1000;
checkForUpdateOnForeground();
report(updateCallCount === 1, 'does not fire when document.visibilityState is hidden');

// 4. back to visible, but still inside the throttle window -> still no call
sandbox.document.visibilityState = 'visible';
checkForUpdateOnForeground();
report(updateCallCount === 1, 'still throttled just after becoming visible again, within the window');

// 5. advance past the throttle window -> fires again
mockNow += 5 * 60 * 1000 + 1;
checkForUpdateOnForeground();
report(updateCallCount === 2, 'fires again once the throttle window has fully elapsed');

// 6. simulate offline: update() rejects -> must not throw, must still have been called
updateShouldReject = true;
mockNow += 5 * 60 * 1000 + 1;
let threw = false;
try {
  checkForUpdateOnForeground();
} catch (e) {
  threw = true;
}
report(!threw, 'does not throw when update() rejects (simulated offline)');
report(updateCallCount === 3, 'still called update() once despite the eventual rejection');

console.log(`\n${7} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
