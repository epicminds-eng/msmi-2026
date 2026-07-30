// Run: node tests/check-data-vs-sheet.proof.test.js
//
// Discrimination proof for the Phase 5 DATA-vs-Nick's-sheet checker
// (tests/check-data-vs-sheet.js). We don't have Nick's actual file in this
// repo (it lives in a gitignored folder, and isn't present in this
// environment either way), so this builds a SYNTHETIC .xlsx fixture
// (tests/lib/xlsx-write-lite.js, also built on Node's zlib/Buffer only)
// generated PROGRAMMATICALLY FROM DATA itself — every value in the fixture
// is read out of the real, parsed DATA object, never hand-typed — so a
// clean first run is expected to match exactly. It then:
//   1. runs the real comparison against that clean fixture and asserts zero
//      mismatches and zero structural errors
//   2. perturbs one DATA value IN MEMORY (not the fixture) and reruns,
//      asserting the checker FAILS and names the exact player/course/tee
//   3. restores, reruns, confirms clean again
//   4. renames one header cell in the fixture (simulating Nick reordering
//      or renaming a column) and reruns, asserting the checker fails LOUD
//      with a named missing-header error rather than silently reading the
//      wrong column
//   5. restores, reruns, confirms clean again
//
// This does not touch index.html or sw.js and needs no CACHE_VERSION bump —
// it reads DATA out of the shipped file but changes nothing in it.

const fs = require('fs');
const path = require('path');
const { writeWorkbook } = require('./lib/xlsx-write-lite');
const { compareDataToWorkbook, readDATA } = require('./check-data-vs-sheet');
const { readWorkbook } = require('./lib/xlsx-lite');

let failures = 0;
function report(pass, label) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures++;
}

const DATA = readDATA(path.join(__dirname, '..', 'index.html'));

// ---------- build a synthetic fixture programmatically from DATA ----------
function buildFixtureSheets(data) {
  const sheets = {};

  sheets.Players = [['Name', 'Index'], ...data.hcp.players.map(p => [p.name, p.index])];

  data.hcp.courses.forEach(course => {
    const header = ['Name', ...course.tees.map(t => t.tee)];
    const rows = data.hcp.players.map(p => [
      p.name,
      ...course.tees.map((tee, i) => {
        const v = p.h[course.name] ? p.h[course.name][i] : null;
        return v === null || v === undefined ? '' : v;
      }),
    ]);
    sheets[course.name] = [header, ...rows];
  });

  const teeRows = [];
  data.hcp.courses.forEach(course => {
    course.tees.forEach(tee => teeRows.push([course.name, tee.tee, tee.slope, tee.rating, tee.par]));
  });
  sheets.Tees = [['Course', 'Tee', 'Slope', 'Rating', 'Par'], ...teeRows];

  const pairingRows = [];
  data.rounds.forEach(round => {
    if (!round.groups || !round.groups.length) return;
    round.groups.forEach((group, gi) => {
      group.forEach(nick => {
        pairingRows.push([round.id, gi + 1, data.names[nick] || nick, round.fmt || '', round.time || '', round.addr || '']);
      });
    });
  });
  sheets.Pairings = [['Round', 'Group', 'Player', 'Format', 'Tee Time', 'Address'], ...pairingRows];

  return sheets;
}

const FIXTURE_PATH = path.join(__dirname, '..', '.tmp-fixture-proof.xlsx');
function writeFixture(sheets) {
  fs.writeFileSync(FIXTURE_PATH, writeWorkbook(sheets));
}
function runChecker() {
  const wb = readWorkbook(FIXTURE_PATH);
  return compareDataToWorkbook(DATA, wb);
}

// ---------- 1. clean fixture, expect zero mismatches ----------
const cleanSheets = buildFixtureSheets(DATA);
writeFixture(cleanSheets);
const cleanResult = runChecker();
console.log(`Clean fixture: ${cleanResult.mismatches.length} mismatch(es), ${cleanResult.errors.length} error(s).`);
if (cleanResult.mismatches.length) console.log(JSON.stringify(cleanResult.mismatches.slice(0, 10), null, 1));
if (cleanResult.errors.length) console.log(JSON.stringify(cleanResult.errors.slice(0, 10), null, 1));
report(cleanResult.mismatches.length === 0, 'clean, DATA-generated fixture matches DATA exactly -> 0 mismatches');
report(cleanResult.errors.length === 0, 'clean fixture has no structural errors (all expected sheets/headers present)');

// ---------- 2/3. perturb one DATA value in memory, expect a named failure, then restore ----------
const targetCourse = DATA.hcp.courses.find(c => c.name === 'MASTERPIECE');
const targetPlayer = DATA.hcp.players.find(p => p.name === 'CHAD SCHURECHT');
const targetTeeIdx = 0;
const originalValue = targetPlayer.h[targetCourse.name][targetTeeIdx];
targetPlayer.h[targetCourse.name][targetTeeIdx] = originalValue + 5;

const perturbedResult = runChecker(); // fixture still holds the ORIGINAL value; DATA in memory now disagrees
const hit = perturbedResult.mismatches.find(m => m.category === 'course handicap' && m.player === 'CHAD SCHURECHT' && m.course === 'MASTERPIECE' && m.tee === targetCourse.tees[targetTeeIdx].tee);
report(!!hit, `perturbing CHAD SCHURECHT's ${targetCourse.name}/${targetCourse.tees[targetTeeIdx].tee} handicap in memory is caught and named -> ${hit ? `${hit.old} -> ${hit.new}` : 'NOT FOUND'}`);
report(!!hit && hit.old === originalValue + 5 && hit.new === originalValue, 'the reported old/new values are the correct pair (perturbed DATA -> original fixture)');

targetPlayer.h[targetCourse.name][targetTeeIdx] = originalValue;
const restoredResult = runChecker();
report(restoredResult.mismatches.length === 0, 'restored DATA -> 0 mismatches again');

// ---------- 4/5. perturb a header in the fixture, expect a loud named error, then restore ----------
const headerPerturbedSheets = buildFixtureSheets(DATA);
headerPerturbedSheets.Players[0] = ['Name', 'HandicapIndex']; // renamed "Index" -> simulates Nick renaming a column
writeFixture(headerPerturbedSheets);
const headerResult = runChecker();
const headerError = headerResult.errors.find(e => /missing expected header "Index"/.test(e) && /Players/.test(e));
report(!!headerError, `renaming the "Index" header in the fixture fails loudly, naming the sheet and missing header -> ${headerError || 'NOT FOUND'}`);
report(headerResult.mismatches.length === 0, 'no mismatches are reported from a sheet that failed to even read (no silent wrong-column reads)');

writeFixture(cleanSheets);
const restoredHeaderResult = runChecker();
report(restoredHeaderResult.mismatches.length === 0 && restoredHeaderResult.errors.length === 0, 'restored fixture -> 0 mismatches, 0 errors again');

fs.unlinkSync(FIXTURE_PATH);

console.log(`\n${8} assertions, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
