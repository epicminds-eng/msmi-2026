// Run: node tests/app-version.test.js
//
// v2.0.0 split the one version string sw.js used to serve into two: CACHE_
// VERSION (bumps on every commit that touches index.html, no longer user-
// visible) and APP_VERSION (what the footer displays, changes only when
// deliberately bumped). This test reads APP_VERSION straight out of sw.js
// (never hand-copied) and asserts that exact literal string does NOT also
// appear inside index.html as a second hardcoded constant — the two-copies-
// drift bug this project has hit twice already, now guarded for the string
// that's actually user-facing. Also confirms index.html actually asks the
// service worker for it (postMessage GET_VERSION / VERSION) rather than
// defining its own copy, and that sw.js replies with APP_VERSION, not
// CACHE_VERSION. Not loaded by index.html, not in sw.js's PRECACHE_URLS,
// doesn't affect the app.

const fs = require('fs');
const path = require('path');

const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const cacheM = swSrc.match(/const CACHE_VERSION = '([^']+)';/);
if (!cacheM) { console.error('FAIL: CACHE_VERSION not found in sw.js'); process.exit(1); }
console.log('CACHE_VERSION read from sw.js:', cacheM[1]);

const appM = swSrc.match(/const APP_VERSION = '([^']+)';/);
if (!appM) { console.error('FAIL: APP_VERSION not found in sw.js'); process.exit(1); }
const version = appM[1];
console.log('APP_VERSION read from sw.js:', version);

let failures = 0;

// index.html must not contain the literal APP_VERSION string anywhere in
// actual CODE — the only legitimate way it should reach the page is via the
// VERSION message from the worker at runtime, never baked in. Block comments
// are stripped first: this codebase's own /* ... */ comments legitimately
// say things like "v2.0.0 dropped the separate full-width variant" when
// documenting what changed in that release, which is prose about history,
// not a second copy of the runtime constant — searching them would make this
// test punish normal code comments instead of catching the real bug.
const htmlCodeOnly = htmlSrc.replace(/\/\*[\s\S]*?\*\//g, '');
const literalOccurrences = (htmlCodeOnly.match(new RegExp(version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
const noHardcodedCopy = literalOccurrences === 0;
console.log(`${noHardcodedCopy ? 'PASS' : 'FAIL'}  index.html contains no hardcoded copy of '${version}' outside comments -> ${literalOccurrences} occurrence(s)`);
if (!noHardcodedCopy) failures++;

const asksServiceWorker = /postMessage\(\{type:'GET_VERSION'\}\)/.test(htmlSrc);
console.log(`${asksServiceWorker ? 'PASS' : 'FAIL'}  index.html posts GET_VERSION to the controller -> ${asksServiceWorker}`);
if (!asksServiceWorker) failures++;

const handlesVersionReply = /e\.data\.type===['"]VERSION['"]/.test(htmlSrc);
console.log(`${handlesVersionReply ? 'PASS' : 'FAIL'}  index.html handles the VERSION reply -> ${handlesVersionReply}`);
if (!handlesVersionReply) failures++;

const swReplies = /event\.data\.type === 'GET_VERSION'/.test(swSrc) && /type: 'VERSION', version: APP_VERSION/.test(swSrc);
console.log(`${swReplies ? 'PASS' : 'FAIL'}  sw.js replies with APP_VERSION, not CACHE_VERSION or a copy -> ${swReplies}`);
if (!swReplies) failures++;

const doesNotReplyCacheVersion = !/type: 'VERSION', version: CACHE_VERSION/.test(swSrc);
console.log(`${doesNotReplyCacheVersion ? 'PASS' : 'FAIL'}  sw.js no longer replies with CACHE_VERSION -> ${doesNotReplyCacheVersion}`);
if (!doesNotReplyCacheVersion) failures++;

const noControllerRendersNothing = /if\(!\('serviceWorker' in navigator\) \|\| !navigator\.serviceWorker\.controller\) return;/.test(htmlSrc);
console.log(`${noControllerRendersNothing ? 'PASS' : 'FAIL'}  no-controller case returns early (renders nothing) -> ${noControllerRendersNothing}`);
if (!noControllerRendersNothing) failures++;

console.log(`\n${6} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
