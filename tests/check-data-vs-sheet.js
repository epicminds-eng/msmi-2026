// Run: node tests/check-data-vs-sheet.js <path-to-nicks-sheet.xlsx>
//
// PHASE 5 — DATA vs Nick's spreadsheet, direct. The Handicaps conformance
// test (tests/handicaps-render-conformance.test.js) proves the SCREEN
// matches DATA. Nothing before this proved DATA matches NICK. This reads
// his .xlsx directly (a zip of XML — tests/lib/xlsx-lite.js parses both with
// only Node's fs/zlib, no new dependency for Chad to install) and compares
// every value against DATA embedded in index.html, printing every mismatch
// as a readable change list: old (DATA) -> new (sheet), naming the player,
// course, and tee.
//
// Designed for REPEATED use — run it again whenever Nick sends an updated
// sheet, and the output IS the change list: every line is either something
// Nick changed that needs propagating into DATA, or something that already
// propagated and now agrees.
//
// SHEET CONVENTIONS THIS EXPECTS (adjust the constants below once you've
// seen Nick's actual file — a header that doesn't match fails LOUD, naming
// what was expected and what was actually found, never silently reading the
// wrong column):
//   "Players" sheet   — columns "Name", "Index"
//   one sheet per course, named exactly like DATA.hcp.courses[].name
//                     — column "Name", plus one column per tee named exactly
//                       like DATA.hcp.courses[].tees[].tee (e.g. "BLACK",
//                       "GOLD (M)", "GOLD (L)") — course handicap values
//   "Tees" sheet      — columns "Course", "Tee", "Slope", "Rating", "Par"
//   "Pairings" sheet  — columns "Round", "Group", "Player", "Format",
//                       "Tee Time", "Address"
//
// Yardages are NOT in Nick's sheet — they come from 18Birdies and are
// explicitly out of scope here, not silently skipped without comment.

const fs = require('fs');
const path = require('path');
const { readWorkbook } = require('./lib/xlsx-lite');

function readDATA(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/const DATA = (\{.*?\});/s);
  if (!m) throw new Error('could not find DATA in index.html');
  return JSON.parse(m[1]);
}

// ---------- fingerprint: print enough to make analysing the wrong file impossible to do silently ----------
function fingerprint(filePath, wb) {
  const stat = fs.statSync(filePath);
  console.log('=== FILE FINGERPRINT ===');
  console.log(`Path: ${filePath}`);
  console.log(`Size: ${stat.size} bytes, modified ${stat.mtime.toISOString()}`);
  console.log(`Sheets found (${wb.sheetNames.length}): ${wb.sheetNames.join(', ')}`);
  console.log(`Shared strings: ${wb.sharedStrings.length}`);

  // A cheap, stable content signature so two DIFFERENT files are trivially
  // distinguishable in the output even if their sheet names happen to match.
  let hash = 0;
  for (const s of wb.sharedStrings) for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  console.log(`Content signature: ${hash.toString(16)}`);

  // Heuristic search for anything that looks like a version/date marker, so
  // a human glancing at this can sanity-check "is this the sheet I think it is."
  const markers = wb.sharedStrings.filter(s => /\b(20\d{2}|v\d+(\.\d+)?|draft|final|rev\.?\s*\d+)\b/i.test(s));
  console.log(`Candidate version/date markers found in shared strings: ${markers.length ? markers.slice(0, 10).join(' | ') : '(none found — sheet may not carry an explicit version marker)'}`);
  console.log('========================\n');
}

// ---------- header-indexed row access ----------
// Never reads a column by position — always resolves a header name to an
// index first, failing loudly (naming the missing header and what WAS
// found) if a sheet doesn't have the column this checker expects.
function headerIndex(headerRow, label, sheetName) {
  const idx = headerRow.findIndex(h => String(h).trim().toLowerCase() === label.toLowerCase());
  if (idx === -1) {
    throw new Error(
      `sheet "${sheetName}" is missing expected header "${label}". ` +
      `Headers found: [${headerRow.map(h => `"${h}"`).join(', ')}]`
    );
  }
  return idx;
}

function rowsAsObjects(rows, sheetName, requiredHeaders) {
  const header = rows[0] || [];
  const idx = {};
  requiredHeaders.forEach(h => { idx[h] = headerIndex(header, h, sheetName); });
  return rows.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => {
      const obj = {};
      requiredHeaders.forEach(h => { obj[h] = r[idx[h]]; });
      return obj;
    });
}

function normName(n) { return String(n).trim().toUpperCase(); }

// ---------- comparisons ----------
function compareIndexes(DATA, wb, mismatches, errors) {
  let rows;
  try { rows = rowsAsObjects(wb.sheet('Players'), 'Players', ['Name', 'Index']); }
  catch (e) { errors.push(e.message); return; }
  const byName = new Map(rows.map(r => [normName(r.Name), r.Index]));
  DATA.hcp.players.forEach(p => {
    const sheetIndex = byName.get(normName(p.name));
    if (sheetIndex === undefined) { errors.push(`Players sheet has no row for "${p.name}"`); return; }
    if (Number(sheetIndex) !== Number(p.index)) {
      mismatches.push({ category: 'index', player: p.name, old: p.index, new: sheetIndex });
    }
  });
}

function compareCourseHandicaps(DATA, wb, mismatches, errors) {
  DATA.hcp.courses.forEach(course => {
    let rows;
    try { rows = rowsAsObjects(wb.sheet(course.name), course.name, ['Name', ...course.tees.map(t => t.tee)]); }
    catch (e) { errors.push(e.message); return; }
    const byName = new Map(rows.map(r => [normName(r.Name), r]));
    DATA.hcp.players.forEach(p => {
      const sheetRow = byName.get(normName(p.name));
      if (!sheetRow) { errors.push(`"${course.name}" sheet has no row for "${p.name}"`); return; }
      course.tees.forEach((tee, i) => {
        const oldVal = p.h[course.name] ? p.h[course.name][i] : undefined;
        const newVal = sheetRow[tee.tee];
        const oldNorm = (oldVal === null || oldVal === undefined) ? null : Number(oldVal);
        const newNorm = (newVal === null || newVal === undefined || newVal === '') ? null : Number(newVal);
        if (oldNorm !== newNorm) {
          mismatches.push({ category: 'course handicap', player: p.name, course: course.name, tee: tee.tee, old: oldNorm, new: newNorm });
        }
      });
    });
  });
}

function compareTeeMeta(DATA, wb, mismatches, errors) {
  let rows;
  try { rows = rowsAsObjects(wb.sheet('Tees'), 'Tees', ['Course', 'Tee', 'Slope', 'Rating', 'Par']); }
  catch (e) { errors.push(e.message); return; }
  const byKey = new Map(rows.map(r => [`${normName(r.Course)}::${normName(r.Tee)}`, r]));
  DATA.hcp.courses.forEach(course => {
    course.tees.forEach(tee => {
      const key = `${normName(course.name)}::${normName(tee.tee)}`;
      const sheetRow = byKey.get(key);
      if (!sheetRow) { errors.push(`"Tees" sheet has no row for ${course.name} / ${tee.tee}`); return; }
      ['slope', 'rating', 'par'].forEach(field => {
        const oldVal = Number(tee[field]);
        const newVal = Number(sheetRow[field.charAt(0).toUpperCase() + field.slice(1)]);
        if (oldVal !== newVal) {
          mismatches.push({ category: field, player: null, course: course.name, tee: tee.tee, old: oldVal, new: newVal });
        }
      });
    });
  });
}

function comparePairings(DATA, wb, mismatches, errors) {
  let rows;
  try { rows = rowsAsObjects(wb.sheet('Pairings'), 'Pairings', ['Round', 'Group', 'Player', 'Format', 'Tee Time', 'Address']); }
  catch (e) { errors.push(e.message); return; }

  const byRound = new Map();
  rows.forEach(r => {
    if (!byRound.has(r.Round)) byRound.set(r.Round, []);
    byRound.get(r.Round).push(r);
  });

  DATA.rounds.forEach(round => {
    // rounds with no assigned groups yet (TBD) legitimately have no Pairings
    // rows to compare against — that's not a structural error, it's just an
    // unassigned round, so skip it rather than reporting a false "missing" error.
    if (!round.groups || !round.groups.length) return;
    const sheetRows = byRound.get(round.id) || byRound.get(round.title);
    if (!sheetRows) { errors.push(`"Pairings" sheet has no rows for round "${round.id}"`); return; }

    if (round.fmt) {
      const sheetFmt = sheetRows[0].Format;
      if (sheetFmt && sheetFmt !== round.fmt) {
        mismatches.push({ category: 'format', round: round.id, old: round.fmt, new: sheetFmt });
      }
    }
    if (round.time) {
      const sheetTime = sheetRows[0]['Tee Time'];
      if (sheetTime && sheetTime !== round.time) {
        mismatches.push({ category: 'tee time', round: round.id, old: round.time, new: sheetTime });
      }
    }
    if (round.addr) {
      const sheetAddr = sheetRows[0].Address;
      if (sheetAddr && sheetAddr !== round.addr) {
        mismatches.push({ category: 'address', round: round.id, old: round.addr, new: sheetAddr });
      }
    }

    // group composition — DATA stores nicknames, translated to full names
    // via DATA.names for comparison, since a real Pairings sheet lists people
    // by name, not by this app's internal abbreviations.
    if (round.groups && round.groups.length) {
      const dataGroupsFull = round.groups.map(g => new Set(g.map(nick => normName(DATA.names[nick] || nick))));
      const sheetGroupNums = [...new Set(sheetRows.map(r => r.Group))];
      sheetGroupNums.forEach(groupNum => {
        const sheetPlayers = new Set(sheetRows.filter(r => r.Group === groupNum).map(r => normName(r.Player)));
        const matchesAny = dataGroupsFull.some(g => g.size === sheetPlayers.size && [...g].every(n => sheetPlayers.has(n)));
        if (!matchesAny) {
          mismatches.push({ category: 'group composition', round: round.id, old: '(see DATA.rounds groups)', new: `Group ${groupNum}: ${[...sheetPlayers].join(', ')}` });
        }
      });
    }
  });

  // round counts per player, derived from how many Pairings rows name them.
  // Compared against DATA's OWN group assignments (rounds where the player
  // actually appears in a group) — not p.rounds.length, which also counts
  // rounds a player is merely registered for but that have no groups yet
  // (TBD/unassigned rounds legitimately have no Pairings rows either).
  const roundCountByPlayer = new Map();
  rows.forEach(r => {
    const n = normName(r.Player);
    roundCountByPlayer.set(n, (roundCountByPlayer.get(n) || 0) + 1);
  });
  const dataGroupRoundCount = new Map();
  DATA.rounds.forEach(round => {
    if (!round.groups || !round.groups.length) return;
    const everyoneInRound = new Set(round.groups.flat().map(nick => normName(DATA.names[nick] || nick)));
    everyoneInRound.forEach(full => dataGroupRoundCount.set(full, (dataGroupRoundCount.get(full) || 0) + 1));
  });
  DATA.hcp.players.forEach(p => {
    const sheetCount = roundCountByPlayer.get(normName(p.name));
    const dataCount = dataGroupRoundCount.get(normName(p.name)) || 0;
    if (sheetCount !== undefined && sheetCount !== dataCount) {
      mismatches.push({ category: 'round count', player: p.name, old: dataCount, new: sheetCount });
    }
  });
}

function compareDataToWorkbook(DATA, wb) {
  const mismatches = [];
  const errors = [];
  compareIndexes(DATA, wb, mismatches, errors);
  compareCourseHandicaps(DATA, wb, mismatches, errors);
  compareTeeMeta(DATA, wb, mismatches, errors);
  comparePairings(DATA, wb, mismatches, errors);
  return { mismatches, errors };
}

function printReport(mismatches, errors) {
  console.log('=== YARDAGES ===');
  console.log('Not in Nick\'s sheet — sourced from 18Birdies, not compared here.\n');

  if (errors.length) {
    console.log(`=== ${errors.length} STRUCTURAL ERROR(S) (fix these before mismatches below can be trusted) ===`);
    errors.forEach(e => console.log(`  ! ${e}`));
    console.log('');
  }

  console.log(`=== ${mismatches.length} MISMATCH(ES) ===`);
  if (!mismatches.length) {
    console.log('DATA matches the sheet on everything this checker compares.');
  } else {
    mismatches.forEach(m => {
      const where = [m.player, m.course, m.tee, m.round].filter(Boolean).join(' / ');
      console.log(`  [${m.category}] ${where}: ${m.old} -> ${m.new}`);
    });
  }
}

function main() {
  const sheetPath = process.argv[2];
  if (!sheetPath) {
    console.error('Usage: node tests/check-data-vs-sheet.js <path-to-nicks-sheet.xlsx>');
    process.exit(2);
  }
  const DATA = readDATA(path.join(__dirname, '..', 'index.html'));
  const wb = readWorkbook(sheetPath);
  fingerprint(sheetPath, wb);
  const { mismatches, errors } = compareDataToWorkbook(DATA, wb);
  printReport(mismatches, errors);
  process.exit((mismatches.length || errors.length) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { compareDataToWorkbook, fingerprint, readDATA, headerIndex, rowsAsObjects };
