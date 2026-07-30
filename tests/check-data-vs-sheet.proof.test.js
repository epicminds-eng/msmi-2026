// Run: node tests/check-data-vs-sheet.proof.test.js
//
// Proof for the Phase 5 DATA-vs-Nick's-sheet checker (tests/check-data-vs-
// sheet.js), rewritten against the REAL file at nick-sheets/2026-07-28-
// FINAL.xlsx. The first version of this proof built a synthetic fixture to
// its own invented sheet structure ("Players", one sheet per course,
// "Tees") — it "passed" by construction and never once touched a real
// workbook, which is exactly how the checker's actual structural
// assumptions went unvalidated. This version:
//
//   1. runs the real comparison against the REAL file and asserts it
//      produces EXACTLY the known-answer independently verified with
//      openpyxl (July 28 vs July 27): zero Handicaps differences, and
//      exactly 4 Pairings group-composition mismatches across two rounds
//      (wed-pm groups 1/2, thu-am groups 2/3) — not "some mismatches", the
//      literal old/new values, nothing else
//   2. perturbs one DATA value in memory and reruns against the SAME real
//      file, asserting the checker catches it and names the exact player/
//      course/tee, then restores and confirms clean again
//   3. asserts the checker CANNOT silently pass: rebuilds the real file
//      with its "Handicaps" tab renamed (same zip bytes otherwise) and
//      confirms the checker exits fail with an unmissable banner and,
//      critically, that its printed output never contains the "0
//      mismatches / matches everything" success phrasing alongside a
//      structural error — that combination is what the original defect
//      printed, and it must never print again
//   4. a small, isolated regression test for the actual root cause: xlsx-
//      lite's cell parser used to treat a self-closing empty cell
//      (<c r="A1" s="43"/> — extremely common in real Excel output,
//      completely absent from anything our own synthetic writer ever
//      produced, which is why this went unnoticed) as an OPENING tag,
//      swallowing every real cell after it up to some later </c> as bogus
//      "inner content". Confirmed to be the actual mechanism that
//      corrupted the first read of Nick's real file.
//
// Does not touch index.html or sw.js and needs no CACHE_VERSION bump.

const fs = require('fs');
const path = require('path');
const { readZipEntries, readWorkbook, parseSheetXml } = require('./lib/xlsx-lite');
const { buildZip } = require('./lib/xlsx-write-lite');
const { compareDataToWorkbook, readDATA } = require('./check-data-vs-sheet');

let failures = 0;
function report(pass, label) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures++;
}

const REAL_FILE = path.join(__dirname, '..', 'nick-sheets', '2026-07-28-FINAL.xlsx');
if (!fs.existsSync(REAL_FILE)) {
  console.error(`FAIL: real file not found at ${REAL_FILE} — this proof requires Nick's actual sheet, not a synthetic stand-in.`);
  process.exit(1);
}

const DATA = readDATA(path.join(__dirname, '..', 'index.html'));

// ==================== 1. known-answer match against the real file ====================
const wb = readWorkbook(REAL_FILE);
const { mismatches, errors } = compareDataToWorkbook(DATA, wb);

console.log(`Real file: ${mismatches.length} mismatch(es), ${errors.length} structural error(s).`);
report(errors.length === 0, 'real file: zero structural errors');

const EXPECTED = [
  { category: 'group composition', round: 'wed-pm', old: 'Group 1: LEFTY/EDDIE/CHAD/VINCE', new: 'Group 1: DAMI/JOE L/CHAD/VINCE' },
  { category: 'group composition', round: 'wed-pm', old: 'Group 2: RANDY/JIM L/DAMI/JOE L', new: 'Group 2: RANDY/JIM L/LEFTY/EDDIE' },
  { category: 'group composition', round: 'thu-am', old: 'Group 2: EDDIE/VINCE/NICK/JIM H', new: 'Group 2: EDDIE/VINCE/YEE/DAMI' },
  { category: 'group composition', round: 'thu-am', old: 'Group 3: YEE/DAMI/JIM L/JT', new: 'Group 3: NICK/JIM H/JIM L/JT' },
];

report(mismatches.length === EXPECTED.length, `exactly ${EXPECTED.length} mismatches, no more, no less -> found ${mismatches.length}`);

const handicapMismatches = mismatches.filter(m => ['index', 'course handicap', 'slope', 'rating', 'par'].includes(m.category));
report(handicapMismatches.length === 0, `Handicaps tab: zero differences -> found ${handicapMismatches.length}`);

EXPECTED.forEach(exp => {
  const found = mismatches.find(m => m.category === exp.category && m.round === exp.round && m.old === exp.old && m.new === exp.new);
  report(!!found, `known-answer cell present exactly: [${exp.category}] ${exp.round}: ${exp.old} -> ${exp.new}`);
});

const unexpected = mismatches.filter(m => !EXPECTED.some(exp => exp.category === m.category && exp.round === m.round && exp.old === m.old && exp.new === m.new));
report(unexpected.length === 0, `no mismatches beyond the known-answer set -> ${unexpected.length ? JSON.stringify(unexpected) : '(none)'}`);

// ==================== 2. perturb DATA in memory against the real file, then restore ====================
const targetCourse = DATA.hcp.courses.find(c => c.name === 'MASTERPIECE');
const targetPlayer = DATA.hcp.players.find(p => p.name === 'CHAD SCHURECHT');
const targetTeeIdx = 2; // WHITE — not one of the live-formula BLACK/BLUE columns, keeps this test independent of the rounding rule
const originalValue = targetPlayer.h[targetCourse.name][targetTeeIdx];
targetPlayer.h[targetCourse.name][targetTeeIdx] = originalValue + 7;

const perturbedResult = compareDataToWorkbook(DATA, wb);
const hit = perturbedResult.mismatches.find(m => m.category === 'course handicap' && m.player === 'CHAD SCHURECHT' && m.course === 'MASTERPIECE' && m.tee === targetCourse.tees[targetTeeIdx].tee);
report(!!hit, `perturbing CHAD SCHURECHT's ${targetCourse.name}/${targetCourse.tees[targetTeeIdx].tee} handicap in memory is caught and named against the REAL file -> ${hit ? `${hit.old} -> ${hit.new}` : 'NOT FOUND'}`);
report(!!hit && hit.old === originalValue + 7 && hit.new === originalValue, 'reported old/new values are the correct pair (perturbed DATA -> real sheet value)');

targetPlayer.h[targetCourse.name][targetTeeIdx] = originalValue;
const restoredResult = compareDataToWorkbook(DATA, wb);
report(restoredResult.mismatches.length === EXPECTED.length, 'restored DATA -> back to exactly the known-answer set again');

// ==================== 3. cannot silently pass: rename the Handicaps tab on the REAL file's own bytes ====================
const buf = fs.readFileSync(REAL_FILE);
const files = readZipEntries(buf);
const workbookXml = files.get('xl/workbook.xml').toString('utf8');
const renamedXml = workbookXml.replace('name="Handicaps"', 'name="HandicapsRenamed"');
if (renamedXml === workbookXml) {
  console.error('FAIL: could not find name="Handicaps" in the real workbook.xml to rename — file structure changed?');
  failures++;
} else {
  const outFiles = [...files.entries()].map(([name, content]) => ({
    name,
    content: name === 'xl/workbook.xml' ? Buffer.from(renamedXml, 'utf8') : content,
  }));
  const renamedBuf = buildZip(outFiles);
  const renamedPath = path.join(__dirname, '..', '.tmp-renamed-tab-proof.xlsx');
  fs.writeFileSync(renamedPath, renamedBuf);

  const renamedWb = readWorkbook(renamedPath);
  const renamedResult = compareDataToWorkbook(DATA, renamedWb);
  report(renamedResult.errors.length > 0, `renamed "Handicaps" tab produces a structural error -> ${renamedResult.errors.length} error(s)`);
  report(
    renamedResult.errors.some(e => /Handicaps/.test(e) && /HandicapsRenamed/.test(e)),
    'the error names both the missing sheet and what was actually found'
  );

  // Capture what the CLI's own report function would print, and confirm the
  // dangerous combination (a success-reading line alongside a structural
  // error) never appears — this is the literal defect being fixed.
  const { printReport } = require('./check-data-vs-sheet');
  const printed = [];
  const realLog = console.log;
  console.log = (...args) => { printed.push(args.join(' ')); };
  try {
    printReport(renamedResult.mismatches, renamedResult.errors, {});
  } finally {
    console.log = realLog;
  }
  const fullOutput = printed.join('\n');
  report(/CHECK FAILED/.test(fullOutput), 'printed report shows an unmissable CHECK FAILED banner');
  report(!/matches the sheet on everything this checker compares/.test(fullOutput), 'printed report never claims a clean match while structural errors exist');
  report(!/^0 MISMATCH/m.test(fullOutput.toUpperCase()) || /CHECK FAILED/.test(fullOutput), 'no bare "0 mismatches" success framing appears without the failure banner beside it');

  fs.unlinkSync(renamedPath);
}

// ==================== 4. root-cause regression: self-closing cells must not swallow siblings ====================
{
  const sharedStrings = ['MASTERPIECE', 'SIGNATURE'];
  // A1 is self-closing and empty (no value at all) — exactly the shape that
  // corrupted the real file's first read. B1 and C1 are real, non-self-
  // closing cells with real values that must survive independently.
  const xml = '<sheetData>' +
    '<row r="1">' +
    '<c r="A1" s="43"/>' +
    '<c r="B1" t="s"><v>0</v></c>' +
    '<c r="C1" t="s"><v>1</v></c>' +
    '</row>' +
    '</sheetData>';
  const rows = parseSheetXml(xml, sharedStrings);
  report(rows[0][0] === '', `self-closing empty cell A1 reads as blank, not a swallowed neighbor's value -> "${rows[0][0]}"`);
  report(rows[0][1] === 'MASTERPIECE', `B1 (immediately after the self-closing cell) reads correctly -> "${rows[0][1]}"`);
  report(rows[0][2] === 'SIGNATURE', `C1 reads correctly, not consumed as A1's bogus inner content -> "${rows[0][2]}"`);
}

console.log(`\n${failures} failure(s).`);
process.exit(failures ? 1 : 0);
