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
// DISCRIMINATION PROOF, take two. The first version of this test "proved"
// itself by perturbing a DATA value in memory. That was unsound: the render
// path reads DATA, so perturbing DATA moves the rendered value AND the
// expected value together — both sides are downstream of the same object.
// The test would still pass. All that proved was "render follows DATA",
// which is not the same claim as "this test can fail."
//
// The fix: mutate the RENDER PATH itself, one bug at a time, in a separate
// vm sandbox built from the same extracted source with exactly one function
// body patched (index off-by-one, a fixed constant instead of a lookup, a
// reversed sort, a fabricated number instead of the em dash). The "expected"
// side keeps using the pristine, unpatched courseTeeIndex/baseTee — so each
// scenario proves the comparison loop actually notices when the render path
// disagrees with DATA, and names the specific player/course/tee (or card)
// responsible. Every scenario is restored (a fresh, never-mutated sandbox)
// and reconfirmed clean afterward.
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

// Named, in order, so a scenario can patch exactly one piece by name and
// leave the rest — including courseTeeIndex/baseTee, always used unpatched
// for the "expected" side — untouched.
const pieceList = [
  { name: 'DATA', text: 'const DATA = ' + dataText + ';' },
  { name: 'cx', text: extract('cx', /const cx=\{\}; DATA\.hcp\.courses\.forEach\(c=>cx\[c\.name\]=c\);/) },
  { name: 'esc', text: extract('esc', /function esc\(s\)\{[^\n]*\}/) },
  { name: 'isL', text: extract('isL', /function isL\(t\)\{[^\n]*\}/) },
  { name: 'isM', text: extract('isM', /function isM\(t\)\{[^\n]*\}/) },
  { name: 'baseTee', text: extract('baseTee', /function baseTee\(t\)\{[^\n]*\}/) },
  { name: 'courseTeeIndex', text: extract('courseTeeIndex', /function courseTeeIndex\(course,base,female\)\{[\s\S]*?\n\}/) },
  { name: 'ramp', text: extract('ramp', /function ramp\(f\)\{[^\n]*\}/) },
  { name: 'clamp01', text: extract('clamp01', /function clamp01\(f\)\{[^\n]*\}/) },
  { name: 'prowHTML', text: extract('prowHTML', /function prowHTML\(opts\)\{[\s\S]*?\n\}/) },
  { name: 'segHTML', text: extract('segHTML', /function segHTML\(items,activeIdx,attrName\)\{[\s\S]*?\n\}/) },
  { name: 'defaultTeeIdx', text: extract('defaultTeeIdx', /function defaultTeeIdx\(course\)\{[\s\S]*?\n\}/) },
  { name: 'tc', text: extract('tc', /function tc\(s\)\{[^\n]*\}/) },
  { name: 'hcpTee', text: extract('hcpTee', /let hcpTee=\{\};/) },
  { name: 'hcpPlayerRowHTML', text: extract('hcpPlayerRowHTML', /function hcpPlayerRowHTML\(p,courseName,teeSlot\)\{[\s\S]*?\n\}/) },
  { name: 'renderTables', text: extract('renderTables', /function renderTables\(\)\{[\s\S]*?\n\}/) },
];

// Builds a fresh, isolated vm context from the extracted pieces. `patches`
// is an optional {pieceName: (originalSource) => mutatedSource} map — used
// only by the discrimination scenarios below. Throws if a patch doesn't
// actually change anything, so a typo in a patch's search string fails loud
// instead of silently testing the unmutated render path.
function buildSandbox(patches) {
  patches = patches || {};
  const usedPieces = pieceList.map((p) => {
    if (!patches[p.name]) return p.text;
    const patched = patches[p.name](p.text);
    if (patched === p.text) {
      throw new Error(`patch for "${p.name}" did not change anything — search string not found`);
    }
    return patched;
  });
  const tablesEl = { innerHTML: '' };
  const sandbox = {
    document: { getElementById: (id) => (id === 'tables' ? tablesEl : { innerHTML: '' }) },
    ME_FULL: null,
    console,
  };
  const script = usedPieces.join('\n') + '\nthis.__exports = {DATA, cx, courseTeeIndex, baseTee, hcpTee, renderTables};';
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return Object.assign({ tablesEl }, sandbox.__exports);
}

const pristine = buildSandbox();
const { DATA, courseTeeIndex, baseTee } = pristine;

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

// ---- drive a given render path for every (course, tee) and compare ----
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

// Drives renderTablesFn once per (course, tee), reading rendered rows out of
// tablesElObj, and compares every row against DATA. "Expected" is always
// computed via courseTeeIndexFn/baseTeeFn — passed in separately from
// renderTablesFn so a mutation scenario can drive a patched render path
// while still checking it against the pristine, unpatched ground truth.
function checkAllCombinations({ courseTeeIndexFn, baseTeeFn, renderTablesFn, hcpTeeObj, tablesElObj }) {
  let checked = 0;
  let dashCount = 0;
  const mismatches = [];
  const sortFailures = [];

  courses.forEach((course) => {
    const teeCount = teeCountByCourse[course];
    for (let ti = 0; ti < teeCount; ti++) {
      hcpTeeObj[course] = ti;
      renderTablesFn();
      const teeSlot = DATA.sc[course].tees[ti];
      const block = extractCourseBlock(tablesElObj.innerHTML, course);
      if (!block) { mismatches.push({ course, tee: teeSlot.label, issue: 'course block not found in render' }); continue; }
      const rows = parseRows(block);

      // sorted by index ascending, checked against the SAME rendered sub
      // text (not re-sorting DATA ourselves — this checks what rendered)
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

        const idx = teeSlot.sheet ? courseTeeIndexFn(course, baseTeeFn(teeSlot.sheet), p.gender === 'F') : -1;
        const expectedCh = idx > -1 ? p.h[course][idx] : null;
        const expectedStr = expectedCh !== null && expectedCh !== undefined ? String(expectedCh) : '—';

        if (expectedStr === '—') dashCount++;

        if (row.value !== expectedStr) {
          mismatches.push({ course, tee: teeSlot.label, player: p.name, issue: 'value mismatch', rendered: row.value, expected: expectedStr });
        }
      });
    }
  });

  return { checked, dashCount, mismatches, sortFailures };
}

// ---- main conformance check, against the real, unpatched render path ----
const main = checkAllCombinations({
  courseTeeIndexFn: courseTeeIndex,
  baseTeeFn: baseTee,
  renderTablesFn: pristine.renderTables,
  hcpTeeObj: pristine.hcpTee,
  tablesElObj: pristine.tablesEl,
});

report(main.checked === expectedTotal, `enumerated ${main.checked} combinations, matches expected total ${expectedTotal}`);
report(main.mismatches.length === 0, `all rendered values match DATA -> ${main.mismatches.length} mismatch(es)`);
if (main.mismatches.length) console.log(JSON.stringify(main.mismatches.slice(0, 10), null, 1));
report(main.sortFailures.length === 0, `rows sorted by index ascending within every course card -> ${main.sortFailures.length} violation(s)`);
if (main.sortFailures.length) console.log(JSON.stringify(main.sortFailures.slice(0, 10), null, 1));
console.log(`Combinations rendering as "—" (no gender-appropriate rating): ${main.dashCount}`);
report(main.dashCount > 0, 'at least one "no gender-appropriate rating" combination exists and renders as em dash, not a fabricated number');

// ---- prove the test discriminates: mutate the RENDER PATH, one bug at a time ----
console.log('\n--- discrimination check: mutating the RENDER PATH, one bug at a time ---');
console.log('(Not DATA — DATA feeds both the render and the "expected" side, so perturbing');
console.log(' it moves both together and proves nothing. These mutations patch one function');
console.log(' body in a fresh, isolated sandbox; "expected" keeps using the pristine,');
console.log(' unpatched courseTeeIndex/baseTee, so a real disagreement has to show up.)\n');

function runMutationScenario(label, patches, failureKind) {
  const mutated = buildSandbox(patches);
  const result = checkAllCombinations({
    courseTeeIndexFn: courseTeeIndex,
    baseTeeFn: baseTee,
    renderTablesFn: mutated.renderTables,
    hcpTeeObj: mutated.hcpTee,
    tablesElObj: mutated.tablesEl,
  });

  if (failureKind === 'mismatch') {
    report(result.mismatches.length > 0, `[${label}] mutation causes ${result.mismatches.length} value mismatch(es) (0 would mean this test can't catch it)`);
    const first = result.mismatches.find((m) => m.player && m.course);
    report(!!first, `[${label}] failure names a specific player/course/tee -> ${first ? `${first.player} / ${first.course} / tee "${first.tee}"` : 'NONE FOUND'}`);
  } else {
    report(result.sortFailures.length > 0, `[${label}] mutation causes ${result.sortFailures.length} sort violation(s) (0 would mean this test can't catch it)`);
    const first = result.sortFailures[0];
    report(!!first, `[${label}] failure names a specific card -> ${first ? `${first.course}, tee "${first.tee}" (player ${first.player} broke ascending order)` : 'NONE FOUND'}`);
  }

  // restore: rerun the SAME check against the pristine (never-mutated) render
  // path and confirm it's clean again — proving the failure above came from
  // the mutation, not from some leftover state.
  const restored = checkAllCombinations({
    courseTeeIndexFn: courseTeeIndex,
    baseTeeFn: baseTee,
    renderTablesFn: pristine.renderTables,
    hcpTeeObj: pristine.hcpTee,
    tablesElObj: pristine.tablesEl,
  });
  report(restored.mismatches.length === 0 && restored.sortFailures.length === 0, `[${label}] restored (pristine render path) -> 0 mismatches, 0 sort failures`);
}

// (a) shift the tee index by one in the handicap lookup
runMutationScenario('a: tee-index off-by-one', {
  hcpPlayerRowHTML: (src) => src.replace(
    "const idx = teeSlot? courseTeeIndex(courseName,baseTee(teeSlot.sheet),p.gender==='F') : -1;",
    "const idx = (teeSlot? courseTeeIndex(courseName,baseTee(teeSlot.sheet),p.gender==='F') : -1) + 1;"
  ),
}, 'mismatch');

// (b) return a fixed constant instead of the looked-up value
runMutationScenario('b: fixed constant (99) instead of lookup', {
  hcpPlayerRowHTML: (src) => src.replace(
    'const ch = idx>-1? p.h[courseName][idx] : null;',
    'const ch = idx>-1? 99 : null;'
  ),
}, 'mismatch');

// (c) reverse the row sort within a course card
runMutationScenario('c: row sort reversed', {
  renderTables: (src) => src.replace(
    'const ps=DATA.hcp.players.slice().sort((a,b)=>a.index-b.index);',
    'const ps=DATA.hcp.players.slice().sort((a,b)=>b.index-a.index);'
  ),
}, 'sort');

// (d) render a number in an em-dash cell instead of the dash
const dashMutation = runMutationScenarioForDash();
function runMutationScenarioForDash() {
  const label = 'd: fabricated number instead of em dash';
  const mutated = buildSandbox({
    hcpPlayerRowHTML: (src) => src.replace(
      "value: has? String(ch) : '—',",
      "value: has? String(ch) : '0',"
    ),
  });
  const result = checkAllCombinations({
    courseTeeIndexFn: courseTeeIndex,
    baseTeeFn: baseTee,
    renderTablesFn: mutated.renderTables,
    hcpTeeObj: mutated.hcpTee,
    tablesElObj: mutated.tablesEl,
  });
  report(result.mismatches.length > 0, `[${label}] mutation causes ${result.mismatches.length} value mismatch(es) (0 would mean this test can't catch it)`);
  report(result.mismatches.length === main.dashCount, `[${label}] mismatch count (${result.mismatches.length}) equals the known dash-case count (${main.dashCount}) -- exactly the em-dash cells, nothing else`);
  const first = result.mismatches.find((m) => m.player && m.course);
  report(!!first, `[${label}] failure names a specific player/course/tee -> ${first ? `${first.player} / ${first.course} / tee "${first.tee}"` : 'NONE FOUND'}`);

  const restored = checkAllCombinations({
    courseTeeIndexFn: courseTeeIndex,
    baseTeeFn: baseTee,
    renderTablesFn: pristine.renderTables,
    hcpTeeObj: pristine.hcpTee,
    tablesElObj: pristine.tablesEl,
  });
  report(restored.mismatches.length === 0 && restored.sortFailures.length === 0, `[${label}] restored (pristine render path) -> 0 mismatches, 0 sort failures`);
}

console.log(`\n${failures} failure(s).`);
process.exit(failures ? 1 : 0);
