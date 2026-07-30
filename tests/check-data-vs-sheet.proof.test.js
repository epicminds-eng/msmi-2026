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
//   1. runs the real comparison against the REAL file. The 4 pairing
//      reshuffles this checker's first run against this file detected (the
//      known-answer independently verified with openpyxl, July 28 vs July
//      27) have since been applied to DATA in their own commit, so this
//      confirms zero Handicaps differences, confirms none of those 4 still
//      show up, and confirms exactly one mismatch remains: the deliberate
//      Larry Presta/Captain addition to tue-pm, not reflected in any sheet
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

// ==================== 1. current state: the July 28 changes are now applied to DATA ====================
// The 4 pairing reshuffles this checker's earlier run detected have since
// been applied to DATA as their own, separately-authorized commit -- so
// comparing DATA against this SAME real file no longer shows any of them as
// mismatches. Confirmed explicitly below (not just "count went down") so a
// bug that accidentally reintroduced one wouldn't just look like "one fewer
// mismatch than expected somewhere else." The one remaining disagreement is
// deliberate: Larry Presta/Captain was added to tue-pm by direct
// confirmation from Nick, not through an updated sheet, and is recorded as
// a known exception (proven separately in section 5).
const wb = readWorkbook(REAL_FILE);
const { mismatches, errors } = compareDataToWorkbook(DATA, wb);

console.log(`Real file: ${mismatches.length} mismatch(es), ${errors.length} structural error(s).`);
report(errors.length === 0, 'real file: zero structural errors');

const handicapMismatches = mismatches.filter(m => ['index', 'course handicap', 'slope', 'rating', 'par'].includes(m.category));
report(handicapMismatches.length === 0, `Handicaps tab: zero differences -> found ${handicapMismatches.length}`);

const PREVIOUSLY_APPLIED = [
  { round: 'wed-pm', old: 'Group 1: LEFTY/EDDIE/CHAD/VINCE', new: 'Group 1: DAMI/JOE L/CHAD/VINCE' },
  { round: 'wed-pm', old: 'Group 2: RANDY/JIM L/DAMI/JOE L', new: 'Group 2: RANDY/JIM L/LEFTY/EDDIE' },
  { round: 'thu-am', old: 'Group 2: EDDIE/VINCE/NICK/JIM H', new: 'Group 2: EDDIE/VINCE/YEE/DAMI' },
  { round: 'thu-am', old: 'Group 3: YEE/DAMI/JIM L/JT', new: 'Group 3: NICK/JIM H/JIM L/JT' },
];
PREVIOUSLY_APPLIED.forEach(exp => {
  const stillPresent = mismatches.some(m => m.round === exp.round && m.old === exp.old && m.new === exp.new);
  report(!stillPresent, `previously-applied July 28 change no longer shows as a mismatch: ${exp.round} ${exp.old} -> ${exp.new}`);
});

const BASELINE_MISMATCH_COUNT = 1;
const EXPECTED_REMAINING = { category: 'group composition', round: 'tue-pm', old: 'Group 1: JOE D/RON T/JIM H/CAPTAIN', new: 'Group 1: JOE D/RON T/JIM H' };
report(mismatches.length === BASELINE_MISMATCH_COUNT, `exactly ${BASELINE_MISMATCH_COUNT} mismatch remains (the deliberate Captain deviation) -> found ${mismatches.length}`);
const foundRemaining = mismatches.find(m => m.category === EXPECTED_REMAINING.category && m.round === EXPECTED_REMAINING.round && m.old === EXPECTED_REMAINING.old && m.new === EXPECTED_REMAINING.new);
report(!!foundRemaining, `the one remaining mismatch is exactly the Captain deviation -> ${foundRemaining ? `${foundRemaining.old} -> ${foundRemaining.new}` : 'NOT FOUND'}`);

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
report(restoredResult.mismatches.length === BASELINE_MISMATCH_COUNT, `restored DATA -> back to exactly the baseline (${BASELINE_MISMATCH_COUNT} mismatch) again`);

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
  const { printReport, partitionMismatches: partitionForPrint } = require('./check-data-vs-sheet');
  const printed = [];
  const realLog = console.log;
  console.log = (...args) => { printed.push(args.join(' ')); };
  try {
    printReport(renamedResult.errors, partitionForPrint(renamedResult.mismatches, []), {});
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

// ==================== 5. exceptions mechanism: recording reality, not suppressing it ====================
{
  const { loadExceptions, partitionMismatches, EXCEPTIONS_PATH } = require('./check-data-vs-sheet');

  // DATA (post Larry Presta/Captain addition to tue-pm) now legitimately
  // disagrees with the sheet on exactly one cell -- re-derive it fresh here
  // rather than hard-coding, so this proof stays honest if the round-trip
  // above already changed anything.
  const freshWb = readWorkbook(REAL_FILE);
  const freshCompare = compareDataToWorkbook(DATA, freshWb);
  report(freshCompare.mismatches.length === 1, `DATA vs sheet currently has exactly 1 real disagreement (the Captain addition) -> found ${freshCompare.mismatches.length}`);

  report(fs.existsSync(EXCEPTIONS_PATH), `exceptions file exists at ${path.basename(EXCEPTIONS_PATH)}`);
  const exceptionsPresent = loadExceptions();
  const withException = partitionMismatches(freshCompare.mismatches, exceptionsPresent);
  report(withException.known.length === 1 && withException.unexpected.length === 0,
    `with the exception recorded: 1 known exception, 0 unexpected -> found ${withException.known.length} known, ${withException.unexpected.length} unexpected`);

  // Temporarily remove the file on disk (not just pass [] in memory) so this
  // exercises the SAME loadExceptions() the CLI calls, proving the mechanism
  // reflects what's actually on disk rather than something rigged in memory.
  const backupPath = EXCEPTIONS_PATH + '.bak';
  fs.renameSync(EXCEPTIONS_PATH, backupPath);
  let withoutException;
  try {
    const exceptionsAbsent = loadExceptions();
    report(exceptionsAbsent.length === 0, 'with the file removed, loadExceptions() returns zero exceptions (not an error)');
    withoutException = partitionMismatches(freshCompare.mismatches, exceptionsAbsent);
  } finally {
    fs.renameSync(backupPath, EXCEPTIONS_PATH);
  }
  report(fs.existsSync(EXCEPTIONS_PATH), 'exceptions file restored after the test');
  report(withoutException.known.length === 0 && withoutException.unexpected.length === 1,
    `with the file removed, the SAME mismatch now counts as unexpected -> found ${withoutException.known.length} known, ${withoutException.unexpected.length} unexpected`);
  report(withoutException.unexpected[0] && withoutException.unexpected[0].category === 'group composition' && withoutException.unexpected[0].round === 'tue-pm',
    'the now-unexpected mismatch is the exact same tue-pm group-composition cell, not a different one');
}

console.log(`\n${failures} failure(s).`);
process.exit(failures ? 1 : 0);
