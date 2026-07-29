// Run: node tests/update-bar.predicate.test.js
//
// Extracts the REAL shouldShowUpdateBar() source out of ../index.html (regex,
// same technique used throughout this project to node --check the inline
// script) and evaluates that exact text — never a hand-copied duplicate — so
// a bug in the shipped function is a bug the test sees too. This file is not
// referenced by index.html, not in sw.js's PRECACHE_URLS, and isn't fetched
// by anything at runtime; it only exists to be run with `node`.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/function shouldShowUpdateBar\(state\)\{[\s\S]*?\n\}/);
if (!match) {
  console.error('FAIL: could not find shouldShowUpdateBar() in index.html — did it get renamed or removed?');
  process.exit(1);
}
const shouldShowUpdateBar = new Function('return (' + match[0] + ')')();

const cases = [
  { hasController: false, hasWaiting: false, dismissed: false, expected: false },
  { hasController: false, hasWaiting: false, dismissed: true,  expected: false },
  { hasController: false, hasWaiting: true,  dismissed: false, expected: false, note: 'first install' },
  { hasController: false, hasWaiting: true,  dismissed: true,  expected: false },
  { hasController: true,  hasWaiting: false, dismissed: false, expected: false, note: 'already current' },
  { hasController: true,  hasWaiting: false, dismissed: true,  expected: false },
  { hasController: true,  hasWaiting: true,  dismissed: false, expected: true },
  { hasController: true,  hasWaiting: true,  dismissed: true,  expected: false, note: 'dismissed' },
];

let failures = 0;
cases.forEach(({ hasController, hasWaiting, dismissed, expected, note }) => {
  const got = shouldShowUpdateBar({ hasController, hasWaiting, dismissed });
  const pass = got === expected;
  if (!pass) failures++;
  const label = `hasController=${hasController} hasWaiting=${hasWaiting} dismissed=${dismissed}`;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  -> ${got} (expected ${expected})${note ? '  // ' + note : ''}`);
});

// Confirm there is exactly one call site for the decision in the app script —
// otherwise this whole test file is asserting a function the UI doesn't
// actually use to decide anything.
const callSites = (html.match(/shouldShowUpdateBar\(\{/g) || []).length;
const callSitePass = callSites === 1;
console.log(`${callSitePass ? 'PASS' : 'FAIL'}  exactly one call site for shouldShowUpdateBar(...) -> found ${callSites}`);
if (!callSitePass) failures++;

console.log(`\n${cases.length + 1} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
