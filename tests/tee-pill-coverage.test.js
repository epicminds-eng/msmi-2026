// Run: node tests/tee-pill-coverage.test.js
//
// Enumerates every distinct base tee name across all 7 handicapped courses in
// DATA.sc (gender-suffix stripped, same logic as baseTee() in index.html —
// duplicated here only because DATA and TEE_PILL_COLORS are plain object
// literals, not functions, so there's nothing to regex-extract and eval like
// the update-bar tests do; the values themselves are read straight out of
// index.html, never hand-copied) and asserts TEE_PILL_COLORS covers every one
// with no leftovers and no unused entries. Also guards the square-swatch
// bezel property added when the pill became a 22x22 square: BLACK keeps its
// own visible outline (#6E6E78, or it's indistinguishable from --card/--raise
// in every skin), the other six get a neutral translucent white so all seven
// read as the same physical object.
//
// v2.0.0 adds tee-LABEL coverage (distinct from the base-tee-NAME coverage
// above): DATA.sc labels are either "Colour / Marker" (e.g. "Black / Back")
// or a single colour word for courses whose tees ARE the colour (e.g.
// "Black" at Tradition). teeMarker(label), the real function extracted from
// index.html and eval'd here (not reimplemented), must resolve every label
// across the 7 handicap courses to a mapped colour and non-empty text, with
// no unmapped labels and no unused colour entries — the (L)-rated variants
// Dami Mui sees are already covered by construction, since labels never
// carry a gender suffix (only .sheet does; every player sees the same label
// for a given physical tee). Threetops (THE one course with no course
// handicap at all) uses positional words ("Back"/"Middle"/"Front") that
// aren't colours and are deliberately NOT part of this assertion — see the
// separate informational check below.
//
// Not loaded by index.html, not in sw.js's PRECACHE_URLS, doesn't affect the
// app.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const dataMatch = html.match(/const DATA = (\{.*?\});/s);
if (!dataMatch) { console.error('FAIL: could not find DATA in index.html'); process.exit(1); }
const DATA = JSON.parse(dataMatch[1]);

const colorsMatch = html.match(/const TEE_PILL_COLORS=(\{[\s\S]*?\n\});/);
if (!colorsMatch) { console.error('FAIL: could not find TEE_PILL_COLORS in index.html'); process.exit(1); }
const TEE_PILL_COLORS = new Function('return (' + colorsMatch[1] + ')')();

function baseTee(t) { return t.replace(' (M)', '').replace(' (L)', ''); }

function extract(name, pattern) {
  const m = html.match(pattern);
  if (!m) { console.error(`FAIL: could not find ${name} in index.html`); process.exit(1); }
  return m[0];
}
const teeMarkerSandbox = { console };
vm.createContext(teeMarkerSandbox);
vm.runInContext(
  colorsMatch[0] + '\n' +
    extract('teePillStyle', /function teePillStyle\(baseTeeName\)\{[\s\S]*?\n\}/) + '\n' +
    extract('teeMarker', /function teeMarker\(label\)\{[\s\S]*?\n\}/) +
    '\nthis.__exports = {teeMarker: teeMarker};',
  teeMarkerSandbox
);
const { teeMarker } = teeMarkerSandbox.__exports;

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

const NEUTRAL_BORDER = 'rgba(255,255,255,.22)';
const blackBorderOk = TEE_PILL_COLORS.BLACK && TEE_PILL_COLORS.BLACK.border === '#6E6E78';
console.log(`${blackBorderOk ? 'PASS' : 'FAIL'}  BLACK keeps its own bezel -> ${TEE_PILL_COLORS.BLACK && TEE_PILL_COLORS.BLACK.border}`);
if (!blackBorderOk) failures++;

const others = Object.keys(TEE_PILL_COLORS).filter(k => k !== 'BLACK');
const wrongNeutral = others.filter(k => TEE_PILL_COLORS[k].border !== NEUTRAL_BORDER);
const neutralOk = wrongNeutral.length === 0;
console.log(`${neutralOk ? 'PASS' : 'FAIL'}  every non-black swatch uses the neutral translucent-white bezel -> ${wrongNeutral.length ? wrongNeutral.join(', ') : '(none wrong)'}`);
if (!neutralOk) failures++;

// ---- v2.0.0: tee-label coverage (Colour / Marker parsing) across the 7 hcp courses ----
const hcpCourseNames = new Set(DATA.hcp.courses.map(c => c.name));
const labelsByCourse = {};
hcpCourseNames.forEach(course => {
  labelsByCourse[course] = DATA.sc[course].tees.map(t => t.label);
});
const allLabels = new Set();
Object.values(labelsByCourse).forEach(labels => labels.forEach(l => allLabels.add(l)));

console.log(`\nDistinct tee labels across the ${hcpCourseNames.size} handicap courses:`, [...allLabels].sort().join(', '));

const labelResults = [...allLabels].map(label => ({ label, ...teeMarker(label) }));
const unmappedLabels = labelResults.filter(r => !r.color);
const emptyTextLabels = labelResults.filter(r => !r.text);

const noUnmappedLabels = unmappedLabels.length === 0;
console.log(`${noUnmappedLabels ? 'PASS' : 'FAIL'}  every tee label resolves to a mapped colour -> ${unmappedLabels.length ? unmappedLabels.map(r => r.label).join(', ') : '(none unmapped)'}`);
if (!noUnmappedLabels) failures++;

const noEmptyText = emptyTextLabels.length === 0;
console.log(`${noEmptyText ? 'PASS' : 'FAIL'}  every tee label resolves to non-empty marker text -> ${emptyTextLabels.length ? emptyTextLabels.map(r => r.label).join(', ') : '(none empty)'}`);
if (!noEmptyText) failures++;

const labelColorsUsed = new Set(labelResults.map(r => r.color));
const unusedColorsForLabels = [...mapped].filter(k => !labelColorsUsed.has(k));
const noUnusedColorsForLabels = unusedColorsForLabels.length === 0;
console.log(`${noUnusedColorsForLabels ? 'PASS' : 'FAIL'}  every mapped colour is used by at least one label -> ${unusedColorsForLabels.length ? unusedColorsForLabels.join(', ') : '(none unused)'}`);
if (!noUnusedColorsForLabels) failures++;

console.log('\nLabel -> {colour, text}:');
labelResults.forEach(r => console.log(`  "${r.label}" -> colour=${r.color}, text="${r.text}"`));

// informational only, not asserted: Threetops has no course handicap and its
// tee words ("Back"/"Middle"/"Front") aren't colours at all, so they resolve
// with no swatch colour by design (see teeMarker's own comment in index.html)
const threetopsLabels = DATA.sc.THREETOPS.tees.map(t => t.label);
const threetopsResults = threetopsLabels.map(label => ({ label, ...teeMarker(label) }));
console.log(`\nThreetops (no course handicap, not one of the 7) — informational, not asserted:`);
threetopsResults.forEach(r => console.log(`  "${r.label}" -> colour=${r.color} (expected null — not a real tee colour)`));

console.log(`\n${7} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
