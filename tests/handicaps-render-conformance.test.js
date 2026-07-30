// Run: node tests/handicaps-render-conformance.test.js
//
// DATA-to-render conformance test for the Handicaps screen. NOT a comparison
// against the old table (deleted in d715655, unrecoverable) — this instead
// drives the app's own real render path (renderTables -> hcpPlayerRowHTML ->
// prowHTML, extracted verbatim from index.html by regex, never hand-copied)
// for every course x tee combination, exactly as tapping each tee segment in
// the real UI would, and compares the RENDERED string against DATA for every
// player. The "expected" side calls the same real, extracted courseTeeIndex/
// baseTee the app itself defines (not a reimplementation of that gender-
// resolution logic — duplicating it would risk the test agreeing with its
// own copy of a bug instead of catching one), but through a separate call
// path than hcpPlayerRowHTML's own body, so a wiring bug inside the render
// functions (wrong course name, off-by-one index, garbled formatting) is
// still caught rather than the two sides trivially agreeing.
//
// Not loaded by index.html, not in sw.js's PRECACHE_URLS, doesn't affect the
// app — this test only reads index.html as text and evaluates the extracted
// pieces in a sandboxed Node context with a minimal document.getElementById
// shim (just enough for renderTables to write markup into a plain string).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function extract(name, pattern) {
  const m = html.match(pattern);
  if (!m) { console.error(`FAIL: could not find ${name} in index.html`); process.exit(1); }
  return m[0];
}

const dataText = extract('DATA', /const DATA = (\{.*?\});/s).replace(/^const DATA = /, '').replace(/;$/, '');
const pieces = [
  'const DATA = ' + dataText + ';',
  extract('cx', /const cx=\{\}; DATA\.hcp\.courses\.forEach\(c=>cx\[c\.name\]=c\);/),
  extract('esc', /function esc\(s\)\{[^\n]*\}/),
  extract('isL', /function isL\(t\)\{[^\n]*\}/),
  extract('isM', /function isM\(t\)\{[^\n]*\}/),
  extract('baseTee', /function baseTee\(t\)\{[^\n]*\}/),
  extract('courseTeeIndex', /function courseTeeIndex\(course,base,female\)\{[\s\S]*?\n\}/),
  extract('ramp', /function ramp\(f\)\{[^\n]*\}/),
  extract('clamp01', /function clamp01\(f\)\{[^\n]*\}/),
  extract('prowHTML', /function prowHTML\(opts\)\{[\s\S]*?\n\}/),
  extract('segHTML', /function segHTML\(items,activeIdx,attrName\)\{[\s\S]*?\n\}/),
  extract('defaultTeeIdx', /function defaultTeeIdx\(course\)\{[\s\S]*?\n\}/),
  extract('tc', /function tc\(s\)\{[^\n]*\}/),
  extract('hcpTee', /let hcpTee=\{\};/),
  extract('hcpPlayerRowHTML', /function hcpPlayerRowHTML\(p,courseName,teeSlot\)\{[\s\S]*?\n\}/),
  extract('renderTables', /function renderTables\(\)\{[\s\S]*?\n\}/),
];

// minimal DOM shim: renderTables only ever calls document.getElementById('tables').innerHTML = ...
const tablesEl = { innerHTML: '' };
const sandbox = {
  document: { getElementById: (id) => (id === 'tables' ? tablesEl : { innerHTML: '' }) },
  ME_FULL: null,
  console,
};
// vm's top-level const/let bindings are NOT reflected onto the context object
// (only `var` would be) — so expose what we need via an explicit assignment
// onto `this` (the global object for a non-strict top-level script) before
// reading it back off the sandbox from outside.
pieces.push('this.__exports = {DATA, cx, courseTeeIndex, baseTee, hcpTee, renderTables};');
vm.createContext(sandbox);
vm.runInContext(pieces.join('\n'), sandbox);

const { DATA, cx, courseTeeIndex, baseTee, hcpTee, renderTables } = sandbox.__exports;

let failures = 0;
function report(pass, label) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures++;
  return pass;
}

// ---- enumerate every course x tee x player combination ----
const courses = DATA.hcp.courses.map((c) => c.name);
let expectedTotal = 0;
const teeCountByCourse = {};
courses.forEach((course) => {
  const n = DATA.sc[course].tees.length;
  teeCountByCourse[course] = n;
  expectedTotal += n * DATA.hcp.players.length;
});
console.log(`Courses: ${courses.length}, players: ${DATA.hcp.players.length}`);
console.log(`Tee counts per course: ${courses.map((c) => `${c}=${teeCountByCourse[c]}`).join(', ')}`);
console.log(`Total course x tee x player combinations to check: ${expectedTotal}\n`);

// ---- drive the real render path for every (course, tee) and compare ----
function extractCourseBlock(fullHtml, courseName) {
  const marker = `data-hcpcourse="${courseName}"`;
  const start = fullHtml.indexOf(marker);
  if (start === -1) return null;
  const blockStart = fullHtml.lastIndexOf('<div class="card tblock"', start);
  const next = fullHtml.indexOf('<div class="card tblock"', start + marker.length);
  return next === -1 ? fullHtml.slice(blockStart) : fullHtml.slice(blockStart, next);
}

function parseRows(courseBlockHtml) {
  const rows = [];
  const chunks = courseBlockHtml.split('<button class="prow');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const nameAttr = chunk.match(/data-name="([^"]*)"/);
    const prname = chunk.match(/<span class="prname">([^<]*)<\/span>/);
    const prsub = chunk.match(/<span class="prsub">([^<]*)<\/span>/);
    const prval = chunk.match(/<span class="prval">([^<]*)<\/span>/);
    if (!nameAttr || !prname || !prval) continue;
    rows.push({
      dataName: nameAttr[1],
      name: prname[1],
      sub: prsub ? prsub[1] : '',
      value: prval[1],
    });
  }
  return rows;
}

let checked = 0;
let dashCount = 0;
const mismatches = [];
const sortFailures = [];

courses.forEach((course) => {
  const teeCount = teeCountByCourse[course];
  for (let ti = 0; ti < teeCount; ti++) {
    hcpTee[course] = ti;
    renderTables();
    const teeSlot = DATA.sc[course].tees[ti];
    const block = extractCourseBlock(tablesEl.innerHTML, course);
    if (!block) { mismatches.push({ course, tee: teeSlot.label, issue: 'course block not found in render' }); continue; }
    const rows = parseRows(block);

    // sorted by index ascending, checked against the SAME rendered sub text
    // (not re-sorting DATA ourselves — this checks what actually rendered)
    let lastIndex = -Infinity;
    rows.forEach((row) => {
      const idxMatch = row.sub.match(/^([\d.]+) index/);
      const idxVal = idxMatch ? parseFloat(idxMatch[1]) : null;
      if (idxVal !== null) {
        if (idxVal < lastIndex - 1e-9) {
          sortFailures.push({ course, tee: teeSlot.label, player: row.name, idxVal, lastIndex });
        }
        lastIndex = idxVal;
      }
    });

    DATA.hcp.players.forEach((p) => {
      checked++;
      const row = rows.find((r) => r.dataName === p.name.toLowerCase());
      if (!row) { mismatches.push({ course, tee: teeSlot.label, player: p.name, issue: 'row not found' }); return; }

      // "expected" via the app's own real courseTeeIndex/baseTee, called
      // independently of hcpPlayerRowHTML's own body
      const idx = teeSlot.sheet ? courseTeeIndex(course, baseTee(teeSlot.sheet), p.gender === 'F') : -1;
      const expectedCh = idx > -1 ? p.h[course][idx] : null;
      const expectedStr = expectedCh !== null && expectedCh !== undefined ? String(expectedCh) : '—';

      if (expectedStr === '—') dashCount++;

      if (row.value !== expectedStr) {
        mismatches.push({ course, tee: teeSlot.label, player: p.name, issue: 'value mismatch', rendered: row.value, expected: expectedStr });
      }
    });
  }
});

report(checked === expectedTotal, `enumerated ${checked} combinations, matches expected total ${expectedTotal}`);
report(mismatches.length === 0, `all rendered values match DATA -> ${mismatches.length} mismatch(es)`);
if (mismatches.length) console.log(JSON.stringify(mismatches.slice(0, 10), null, 1));
report(sortFailures.length === 0, `rows sorted by index ascending within every course card -> ${sortFailures.length} violation(s)`);
if (sortFailures.length) console.log(JSON.stringify(sortFailures.slice(0, 10), null, 1));
console.log(`Combinations rendering as "—" (no gender-appropriate rating): ${dashCount}`);
report(dashCount > 0, 'at least one "no gender-appropriate rating" combination exists and renders as em dash, not a fabricated number');

// ---- prove the test discriminates: perturb one real value, expect a named failure ----
console.log('\n--- discrimination check: perturbing one DATA value ---');
const target = { course: 'MASTERPIECE', playerName: 'CHAD SCHURECHT', teeIdx: 0 };
const targetPlayer = DATA.hcp.players.find((p) => p.name === target.playerName);
const teeSlotForTarget = DATA.sc[target.course].tees[target.teeIdx];
const idxForTarget = courseTeeIndex(target.course, baseTee(teeSlotForTarget.sheet), targetPlayer.gender === 'F');
const originalValue = targetPlayer.h[target.course][idxForTarget];
targetPlayer.h[target.course][idxForTarget] = originalValue + 7; // perturb

hcpTee[target.course] = target.teeIdx;
renderTables();
const perturbedBlock = extractCourseBlock(tablesEl.innerHTML, target.course);
const perturbedRows = parseRows(perturbedBlock);
const perturbedRow = perturbedRows.find((r) => r.dataName === target.playerName.toLowerCase());
const expectedAfterPerturb = String(originalValue + 7); // the render should reflect the perturbed DATA...
const stillExpectedOriginal = String(originalValue); // ...so comparing against the ORIGINAL value should now fail

const discriminates = perturbedRow.value === expectedAfterPerturb && perturbedRow.value !== stillExpectedOriginal;
report(discriminates, `perturbing ${target.playerName} at ${target.course} tee ${target.teeIdx} changes the rendered value (${stillExpectedOriginal} -> ${perturbedRow.value}), and comparing against the pre-perturb expectation now correctly disagrees`);

// restore
targetPlayer.h[target.course][idxForTarget] = originalValue;
hcpTee[target.course] = target.teeIdx;
renderTables();
const restoredBlock = extractCourseBlock(tablesEl.innerHTML, target.course);
const restoredRow = parseRows(restoredBlock).find((r) => r.dataName === target.playerName.toLowerCase());
report(restoredRow.value === stillExpectedOriginal, `restored after perturbation -> back to ${stillExpectedOriginal}`);

console.log(`\n${7} assertion groups, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
