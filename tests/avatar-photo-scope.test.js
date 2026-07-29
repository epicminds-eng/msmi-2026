// Run: node tests/avatar-photo-scope.test.js
//
// Static-analysis regression test: extracts the actual photo-storage
// functions (photoFor, removePhotoFor, storePhotoFile) out of index.html by
// regex and asserts the ONLY localStorage key prefix they ever reference is
// 'msmi-photo:' — none of the other five protected keys (msmi-who,
// msmi-bets:, msmi-tee:, msmi-skin, msmi-group, msmi-maps) appear anywhere
// in that code. This can't catch a browser-only concern like layout, but it
// directly encodes "this feature must never touch those keys" as something
// that fails loudly if a future edit accidentally does. Not loaded by
// index.html, not in sw.js's PRECACHE_URLS, doesn't affect the app.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const fnNames = ['photoFor', 'removePhotoFor', 'storePhotoFile', 'avatarHTML'];
const blocks = {};
let missing = [];
fnNames.forEach(name => {
  const m = html.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
  if (m) blocks[name] = m[0];
  else missing.push(name);
});

let failures = 0;

if (missing.length) {
  console.log(`FAIL  all four functions found in index.html -> missing: ${missing.join(', ')}`);
  failures++;
} else {
  console.log(`PASS  all four functions found in index.html -> ${fnNames.join(', ')}`);
}

const combined = Object.values(blocks).join('\n');
const protectedKeys = ['msmi-who', 'msmi-bets:', 'msmi-tee:', 'msmi-skin', 'msmi-group', 'msmi-maps'];
const touched = protectedKeys.filter(k => combined.includes(k));
const noProtectedKeysTouched = touched.length === 0;
console.log(`${noProtectedKeysTouched ? 'PASS' : 'FAIL'}  no protected key referenced in photo functions -> ${touched.length ? touched.join(', ') : '(none)'}`);
if (!noProtectedKeysTouched) failures++;

const usesPhotoKey = combined.includes('msmi-photo:');
console.log(`${usesPhotoKey ? 'PASS' : 'FAIL'}  msmi-photo: prefix is actually used -> ${usesPhotoKey}`);
if (!usesPhotoKey) failures++;

// confirm storePhotoFile's setItem call is wrapped in try/catch (graceful
// QuotaExceededError handling, no half-written key)
const hasTryCatch = /try\{[\s\S]*?localStorage\.setItem\('msmi-photo:'[\s\S]*?\}catch/.test(blocks.storePhotoFile || '');
console.log(`${hasTryCatch ? 'PASS' : 'FAIL'}  storePhotoFile's setItem is wrapped in try/catch -> ${hasTryCatch}`);
if (!hasTryCatch) failures++;

console.log(`\n${4} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
