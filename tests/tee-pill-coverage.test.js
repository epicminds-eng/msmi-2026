// Run: node tests/tee-pill-coverage.test.js
//
// Enumerates every distinct base tee name across all 7 handicapped courses in
// DATA.sc (gender-suffix stripped, same logic as baseTee() in index.html —
// duplicated here only because DATA and TEE_PILL_COLORS are plain object
// literals, not functions, so there's nothing to regex-extract and eval like
// the update-bar tests do; the values themselves are read straight out of
// index.html, never hand-copied) and asserts TEE_PILL_COLORS covers every one
// with no leftovers and no unused entries. Not loaded by index.html, not in
// sw.js's PRECACHE_URLS, doesn't affect the app.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const dataMatch = html.match(/const DATA = (\{.*?\});/s);
if (!dataMatch) { console.error('FAIL: could not find DATA in index.html'); process.exit(1); }
const DATA = JSON.parse(dataMatch[1]);

const colorsMatch = html.match(/const TEE_PILL_COLORS=(\{[\s\S]*?\n\});/);
if (!colorsMatch) { console.error('FAIL: could not find TEE_PILL_COLORS in index.html'); process.exit(1); }
const TEE_PILL_COLORS = new Function('return (' + colorsMatch[1] + ')')();

function baseTee(t) { return t.replace(' (M)', '').replace(' (L)', ''); }

const seen = new Set();
Object.keys(DATA.sc).forEach(course => {
  DATA.sc[course].tees.forEach(t => {
    if (t.sheet) seen.add(baseTee(t.sheet));
  });
});

const mapped = new Set(Object.keys(TEE_PILL_COLORS));
const unmapped = [...seen].filter(n => !mapped.has(n));
const unused = [...mapped].filter(n => !seen.has(n));

let failures = 0;
console.log('Distinct base tee names found in DATA.sc:', [...seen].sort().join(', '));
console.log('TEE_PILL_COLORS keys:', [...mapped].sort().join(', '));

const noUnmapped = unmapped.length === 0;
console.log(`${noUnmapped ? 'PASS' : 'FAIL'}  no unmapped tee names -> ${unmapped.length ? unmapped.join(', ') : '(none)'}`);
if (!noUnmapped) failures++;

const noUnused = unused.length === 0;
console.log(`${noUnused ? 'PASS' : 'FAIL'}  no unused map entries -> ${unused.length ? unused.join(', ') : '(none)'}`);
if (!noUnused) failures++;

console.log(`\n${2} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
