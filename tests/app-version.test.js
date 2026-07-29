// Run: node tests/app-version.test.js
//
// Reads CACHE_VERSION straight out of sw.js (never hand-copied) and asserts
// that exact literal string does NOT also appear inside index.html as a
// second hardcoded constant — the two-copies-drift bug this project has hit
// twice already. Also confirms index.html actually asks the service worker
// for it (postMessage GET_VERSION / VERSION), rather than defining its own
// copy. Not loaded by index.html, not in sw.js's PRECACHE_URLS, doesn't
// affect the app.

const fs = require('fs');
const path = require('path');

const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const m = swSrc.match(/const CACHE_VERSION = '([^']+)';/);
if (!m) { console.error('FAIL: CACHE_VERSION not found in sw.js'); process.exit(1); }
const version = m[1];
console.log('CACHE_VERSION read from sw.js:', version);

let failures = 0;

// index.html must not contain the literal version string anywhere OUTSIDE of
// this test file's own concern — the only legitimate way it should reach the
// page is via the VERSION message from the worker at runtime, never baked in.
const literalOccurrences = (htmlSrc.match(new RegExp(version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
const noHardcodedCopy = literalOccurrences === 0;
console.log(`${noHardcodedCopy ? 'PASS' : 'FAIL'}  index.html contains no hardcoded copy of '${version}' -> ${literalOccurrences} occurrence(s)`);
if (!noHardcodedCopy) failures++;

const asksServiceWorker = /postMessage\(\{type:'GET_VERSION'\}\)/.test(htmlSrc);
console.log(`${asksServiceWorker ? 'PASS' : 'FAIL'}  index.html posts GET_VERSION to the controller -> ${asksServiceWorker}`);
if (!asksServiceWorker) failures++;

const handlesVersionReply = /e\.data\.type===['"]VERSION['"]/.test(htmlSrc);
console.log(`${handlesVersionReply ? 'PASS' : 'FAIL'}  index.html handles the VERSION reply -> ${handlesVersionReply}`);
if (!handlesVersionReply) failures++;

const swReplies = /event\.data\.type === 'GET_VERSION'/.test(swSrc) && /type: 'VERSION', version: CACHE_VERSION/.test(swSrc);
console.log(`${swReplies ? 'PASS' : 'FAIL'}  sw.js replies with its own CACHE_VERSION, not a copy -> ${swReplies}`);
if (!swReplies) failures++;

const noControllerRendersNothing = /if\(!\('serviceWorker' in navigator\) \|\| !navigator\.serviceWorker\.controller\) return;/.test(htmlSrc);
console.log(`${noControllerRendersNothing ? 'PASS' : 'FAIL'}  no-controller case returns early (renders nothing) -> ${noControllerRendersNothing}`);
if (!noControllerRendersNothing) failures++;

console.log(`\n${5} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
