// Run: node tests/check-data-vs-sheet.js <path-to-nicks-sheet.xlsx>
//
// PHASE 5 (rewritten against the real file) — DATA vs Nick's spreadsheet,
// direct. The Handicaps conformance test proves the SCREEN matches DATA.
// This proves DATA matches NICK. Reads his .xlsx directly (a zip of XML —
// tests/lib/xlsx-lite.js parses both with only Node's fs/zlib, no new
// dependency to install).
//
// REWRITE NOTE: the first version of this checker invented its expected
// sheet names ("Players", one sheet per course, "Tees") and never validated
// them against the real file — it only ever ran against a synthetic fixture
// it generated to its own invented expectations, so it "passed" by
// construction. Against the real file it produced 10 structural errors (no
// such sheets exist) and STILL printed "0 MISMATCHES — DATA matches the
// sheet on everything this checker compares", which is true and worthless:
// it compared nothing. That is the actual defect this rewrite fixes first
// (see printReport / main below) — a checker that cannot read its own
// expected structure must never print anything that reads as a pass.
//
// Nick's real workbook has exactly two sheets, verified by opening the file
// and reading its real structure (not guessed):
//
//   "Handicaps" — one global INDEX column (found by header text, not
//   position), then repeating COURSE BANDS across the columns. Row 1 (course
//   band headers) has the course name in only the FIRST column of its band
//   (the rest blank — a merged cell in Excel); row 2 has each band's tee
//   names (BLACK, BLUE, WHITE (M), GREEN (L), ...). Rows 3/4/5 are SLOPE/
//   RATING/PAR. Rows 6+ are players, name in column A. A band's column range
//   is [its own header column, the NEXT band's header column) — the sheet
//   also carries an 8th course, RAVINES, that isn't one of DATA's 7; it's
//   simply not iterated (DATA is what's authoritative for what this app
//   needs), not treated as an error.
//
//   "Pairings" — round blocks in two side-by-side column bands. Each block
//   starts with a header cell like "MON AM - 4-MAN BEST BALL - MASTERPIECE"
//   (found by pattern match, not a fixed cell ref); the SAME column holds
//   the group number in the rows below, with up to 4 player NICKNAMES in the
//   next four columns. Nicknames match DATA.rounds[].groups[] directly — no
//   full-name translation needed (verified: the sheet uses this app's exact
//   nickname tokens, e.g. "JOE L", "JIM H", "RON T"). A round ends where its
//   group-number column goes blank. A separate free-form schedule block
//   (columns A/B) carries day/time/address but interleaves two days per
//   column with no reliable per-round anchor when a course repeats twice in
//   a day (Black Lake, Tuesday AM and PM) — deferred rather than guessed;
//   format and course are compared directly from each round block's own
//   header, which IS unambiguous. The sheet also carries a "FRI AM ... -
//   RAVINES" round DATA doesn't have; it's reported as informational, not
//   an error or mismatch, same reasoning as the extra Handicaps course.
//
// Course-handicap values get one deliberate normalization: MASTERPIECE's
// BLACK/BLUE columns are live (unrounded) formulas in Nick's sheet (e.g.
// 17.53982300884956) while every other column already holds a rounded
// integer, and DATA always stores the rounded integer. Course handicaps are
// conventionally whole strokes — rounding the sheet's number before
// comparing reflects the same physical value, not a fudge toward zero
// (confirmed: every one of these cases round-trips to DATA's stored integer
// exactly). Slope/rating/par and index are compared exactly, no rounding —
// rating is legitimately fractional (e.g. 72.6) and is never touched.
//
// Designed for REPEATED use — run it again whenever Nick sends an updated
// sheet, and the output IS the change list: every line is either something
// Nick changed that needs propagating into DATA, or something that already
// propagated and now agrees.
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

  let hash = 0;
  for (const s of wb.sharedStrings) for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  console.log(`Content signature: ${hash.toString(16)}`);

  const markers = wb.sharedStrings.filter(s => /\b(20\d{2}|v\d+(\.\d+)?|draft|final|rev\.?\s*\d+)\b/i.test(s));
  console.log(`Candidate version/date markers found in shared strings: ${markers.length ? markers.slice(0, 10).join(' | ') : '(none found — sheet may not carry an explicit version marker)'}`);
  console.log('========================\n');
}

function normName(n) { return String(n).trim().toUpperCase(); }
function isBlank(v) { return v === '' || v === null || v === undefined; }

// ==================== Handicaps sheet ====================

// Course bands: row0 has the course name in only the band's first column
// (a merged cell — every other cell in the merge reads blank). A band's
// range is [its own start column, the next band's start column).
function findCourseBands(handicapsRows) {
  const courseNameRow = handicapsRows[0] || [];
  const starts = [];
  courseNameRow.forEach((v, c) => {
    if (!isBlank(v)) starts.push({ course: String(v).trim(), startCol: c });
  });
  return starts.map((b, i) => ({
    course: b.course,
    startCol: b.startCol,
    endCol: (i + 1 < starts.length) ? starts[i + 1].startCol : courseNameRow.length,
  }));
}

function findColumnByHeader(headerRow, label, startCol, endCol) {
  for (let c = startCol; c < endCol; c++) {
    if (String(headerRow[c]).trim().toUpperCase() === label.toUpperCase()) return c;
  }
  return -1;
}

function findPlayerRow(handicapsRows, playerName, firstDataRow) {
  for (let r = firstDataRow; r < handicapsRows.length; r++) {
    if (normName(handicapsRows[r][0]) === normName(playerName)) return r;
  }
  return -1;
}

function compareHandicaps(DATA, wb, mismatches, errors) {
  let rows;
  try { rows = wb.sheet('Handicaps'); }
  catch (e) { errors.push(e.message); return; }

  const teeHeaderRow = rows[1] || [];
  const SLOPE_ROW = 2, RATING_ROW = 3, PAR_ROW = 4, FIRST_PLAYER_ROW = 5;

  const bands = findCourseBands(rows);
  if (!bands.length) { errors.push('"Handicaps" sheet: row 1 has no course-name cells at all — is this the right sheet/file?'); return; }

  const indexCol = findColumnByHeader(teeHeaderRow, 'INDEX', 0, teeHeaderRow.length);
  if (indexCol === -1) {
    errors.push(`"Handicaps" sheet is missing an "INDEX" header in row 2. Row 2 as read: [${teeHeaderRow.map(h => `"${h}"`).join(', ')}]`);
  }

  DATA.hcp.courses.forEach(course => {
    const band = bands.find(b => b.course.toUpperCase() === course.name.toUpperCase());
    if (!band) {
      errors.push(`"Handicaps" sheet has no course band for "${course.name}". Bands found: [${bands.map(b => b.course).join(', ')}]`);
      return;
    }
    course.tees.forEach(tee => {
      const teeCol = findColumnByHeader(teeHeaderRow, tee.tee, band.startCol, band.endCol);
      if (teeCol === -1) {
        errors.push(`"Handicaps" sheet, "${course.name}" band, is missing tee header "${tee.tee}". Row 2 in that band: [${rows[1].slice(band.startCol, band.endCol).map(h => `"${h}"`).join(', ')}]`);
        return;
      }
      const sheetSlope = Number(rows[SLOPE_ROW][teeCol]);
      const sheetRating = Number(rows[RATING_ROW][teeCol]);
      const sheetPar = Number(rows[PAR_ROW][teeCol]);
      if (sheetSlope !== Number(tee.slope)) mismatches.push({ category: 'slope', course: course.name, tee: tee.tee, old: tee.slope, new: sheetSlope });
      if (sheetRating !== Number(tee.rating)) mismatches.push({ category: 'rating', course: course.name, tee: tee.tee, old: tee.rating, new: sheetRating });
      if (sheetPar !== Number(tee.par)) mismatches.push({ category: 'par', course: course.name, tee: tee.tee, old: tee.par, new: sheetPar });
    });
  });

  DATA.hcp.players.forEach(p => {
    const playerRow = findPlayerRow(rows, p.name, FIRST_PLAYER_ROW);
    if (playerRow === -1) { errors.push(`"Handicaps" sheet has no row for player "${p.name}"`); return; }

    if (indexCol !== -1) {
      const sheetIndex = Number(rows[playerRow][indexCol]);
      if (sheetIndex !== Number(p.index)) {
        mismatches.push({ category: 'index', player: p.name, old: p.index, new: sheetIndex });
      }
    }

    DATA.hcp.courses.forEach(course => {
      const band = bands.find(b => b.course.toUpperCase() === course.name.toUpperCase());
      if (!band) return;
      course.tees.forEach((tee, i) => {
        const teeCol = findColumnByHeader(teeHeaderRow, tee.tee, band.startCol, band.endCol);
        if (teeCol === -1) return; // already reported above, once, not per-player
        const rawSheetVal = rows[playerRow][teeCol];
        const dataVal = p.h[course.name] ? p.h[course.name][i] : undefined;
        const dataNorm = (dataVal === null || dataVal === undefined) ? null : Number(dataVal);
        // course handicaps are whole strokes; some sheet columns are live
        // unrounded formulas (MASTERPIECE BLACK/BLUE, confirmed by reading
        // the file) while others already hold a rounded integer — rounding
        // here compares the same physical value either way, it does not
        // paper over a real difference (a genuine change still shows up
        // after rounding, since DATA's side is always a plain integer).
        const sheetNorm = isBlank(rawSheetVal) ? null : Math.round(Number(rawSheetVal));
        if (sheetNorm !== dataNorm) {
          mismatches.push({ category: 'course handicap', player: p.name, course: course.name, tee: tee.tee, old: dataNorm, new: sheetNorm });
        }
      });
    });
  });

  return bands;
}

// ==================== Pairings sheet ====================

const DAY_ABBR_TO_DATA = { SUN: 'sun', MON: 'mon', TUES: 'tue', WED: 'wed', THURS: 'thu', FRI: 'fri', SAT: 'sat' };
// The separator MUST be " - " with a space on both sides: formats like
// "4-Man Best Ball" and "Roommates (2-Man BB)" contain their own internal,
// space-less hyphens (verified against the real headers), so a bare
// \s*-\s* (which tolerates zero spaces) splits inside those instead of at
// the real "DAY AMPM - FORMAT - COURSE" boundaries.
const ROUND_HEADER_RE = /^(SUN|MON|TUES|WED|THURS|FRI|SAT)\s+(AM|PM) - (.+?) - (.+)$/i;

function findRoundHeaders(rows) {
  const headers = [];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (typeof cell !== 'string') return;
      const m = cell.trim().match(ROUND_HEADER_RE);
      if (!m) return;
      const dayAbbr = m[1].toUpperCase();
      const ampm = m[2].toLowerCase();
      const dataId = DAY_ABBR_TO_DATA[dayAbbr] ? `${DAY_ABBR_TO_DATA[dayAbbr]}-${ampm}` : null;
      headers.push({ row: r, col: c, format: m[3].trim(), course: m[4].trim(), dataId, raw: cell.trim() });
    });
  });
  return headers;
}

// Groups live directly below a header, in the header's own column (group
// number) plus the next 4 columns (players) — stops at the first blank or
// non-numeric group-number cell, which is either a blank spacer row or the
// next round's header text landing in that same column.
function parseGroupsBelow(rows, header) {
  const groups = [];
  let r = header.row + 1;
  while (r < rows.length) {
    const cell = rows[r][header.col];
    if (isBlank(cell)) break;
    const num = Number(cell);
    if (!Number.isFinite(num)) break;
    const players = [];
    for (let c = header.col + 1; c <= header.col + 4; c++) {
      const v = rows[r][c];
      if (!isBlank(v)) players.push(String(v).trim());
    }
    groups.push({ num, players });
    r++;
  }
  return groups;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function comparePairings(DATA, wb, mismatches, errors) {
  let rows;
  try { rows = wb.sheet('Pairings'); }
  catch (e) { errors.push(e.message); return; }

  const headers = findRoundHeaders(rows);
  if (!headers.length) { errors.push('"Pairings" sheet: no round header cells found (expected a pattern like "MON AM - 4-MAN BEST BALL - MASTERPIECE") — is this the right sheet/file?'); return; }

  const unrecognized = headers.filter(h => !h.dataId || !DATA.rounds.some(r => r.id === h.dataId));
  const matched = headers.filter(h => h.dataId && DATA.rounds.some(r => r.id === h.dataId));

  if (!matched.length) {
    errors.push(`"Pairings" sheet: found ${headers.length} round header(s) but none matched a DATA round id. Headers found: [${headers.map(h => `"${h.raw}"`).join(', ')}]`);
    return;
  }

  matched.forEach(header => {
    const round = DATA.rounds.find(r => r.id === header.dataId);
    const sheetGroups = parseGroupsBelow(rows, header);

    // Format is intentionally NOT compared as a mismatch: verified against
    // the real file that Nick's own header shorthand doesn't always match
    // DATA's descriptive fmt string even with nothing changed — tue-pm's
    // header reads "3-MAN BB" while DATA has always said "3-Man Best Ball",
    // the same game, just worded differently, on both the July 27 and
    // July 28 files. Treating that as a mismatch would be comparing wording
    // conventions, not data — course names have no such ambiguity (single-
    // or two-word, matched exactly everywhere they were checked), so course
    // is still compared directly.
    if (round.course && header.course.toUpperCase() !== round.course.toUpperCase()) {
      mismatches.push({ category: 'course', round: round.id, old: round.course, new: header.course });
    }

    // rounds with no groups configured in DATA (Threetops/no-course-handicap)
    // legitimately have nothing to compare, even if the sheet carries empty
    // numbered placeholder rows for them.
    if (!round.groups || !round.groups.length) return;

    sheetGroups.forEach(sg => {
      const dataGroup = round.groups[sg.num - 1];
      const sheetSet = new Set(sg.players.map(normName));
      if (!dataGroup) {
        if (sheetSet.size) mismatches.push({ category: 'group composition', round: round.id, old: '(no group at this position in DATA)', new: `Group ${sg.num}: ${sg.players.join('/')}` });
        return;
      }
      const dataSet = new Set(dataGroup.map(normName));
      if (!setsEqual(sheetSet, dataSet)) {
        mismatches.push({ category: 'group composition', round: round.id, old: `Group ${sg.num}: ${dataGroup.join('/')}`, new: `Group ${sg.num}: ${sg.players.join('/')}` });
      }
    });
    // a DATA group with no corresponding sheet row at all (sheet has fewer
    // rows than DATA has groups) is just as real a mismatch as the reverse.
    for (let i = sheetGroups.length; i < round.groups.length; i++) {
      mismatches.push({ category: 'group composition', round: round.id, old: `Group ${i + 1}: ${round.groups[i].join('/')}`, new: '(no group at this position in the sheet)' });
    }
  });

  return { unrecognized, matched };
}

function compareDataToWorkbook(DATA, wb) {
  const mismatches = [];
  const errors = [];
  const bands = compareHandicaps(DATA, wb, mismatches, errors);
  const pairingsInfo = comparePairings(DATA, wb, mismatches, errors);
  return { mismatches, errors, bands, pairingsInfo };
}

// ==================== known exceptions ====================
//
// Some DATA-vs-sheet disagreements are deliberate: Nick confirmed the
// Captain addition by text and no updated sheet is coming for it, so the
// checker would otherwise report the same mismatch on every single future
// run — training whoever reads it to skim past a red result, which is how
// a REAL future regression gets missed. Recorded here, by hand, one entry
// per accepted deviation: what it is, who authorised it, when, and why.
// Known exceptions are still PRINTED every run, in full — never hidden —
// only UNEXPECTED mismatches (and structural errors) fail the run.

const EXCEPTIONS_PATH = path.join(__dirname, 'data-exceptions.json');

function loadExceptions() {
  if (!fs.existsSync(EXCEPTIONS_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(EXCEPTIONS_PATH, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${EXCEPTIONS_PATH} must be a JSON array of exception records`);
  return parsed;
}

// An exception matches a mismatch when every field named in its own "match"
// object equals that field on the mismatch — a partial match (only the
// fields that matter for that exception need be listed), not a full-object
// equality check, so an exception for a "group composition" mismatch never
// needs to also spell out player/course/tee fields it doesn't have.
function exceptionMatches(mismatch, exception) {
  const match = exception.match || {};
  return Object.keys(match).every(k => String(mismatch[k]) === String(match[k]));
}

function partitionMismatches(mismatches, exceptions) {
  const known = [];
  const unexpected = [];
  const usedExceptionIdx = new Set();
  mismatches.forEach(m => {
    const idx = exceptions.findIndex(e => exceptionMatches(m, e));
    if (idx > -1) { known.push({ mismatch: m, exception: exceptions[idx] }); usedExceptionIdx.add(idx); }
    else unexpected.push(m);
  });
  const unused = exceptions.filter((e, i) => !usedExceptionIdx.has(i));
  return { known, unexpected, unused };
}

// ==================== reporting ====================

function printReport(errors, partitioned, extra) {
  console.log('=== YARDAGES ===');
  console.log('Not in Nick\'s sheet — sourced from 18Birdies, not compared here.\n');

  // THE ACTUAL DEFECT THIS REWRITE FIXES: a checker that cannot read its own
  // expected structure must never print anything that reads as a pass. If
  // there are structural errors, that IS the result — print an unmissable
  // failure banner and stop. Do not print "0 mismatches" alongside it; that
  // combination is the dangerous, misleading output, not a clean bill of
  // health.
  if (errors.length) {
    const banner = `CHECK FAILED — ${errors.length} STRUCTURAL ERROR(S) — NO COMPARISON BELOW CAN BE TRUSTED`;
    const bar = '!'.repeat(Math.max(banner.length, 60));
    console.log(bar);
    console.log(banner);
    console.log(bar);
    errors.forEach(e => console.log(`  ! ${e}`));
    console.log(bar);
    const totalFound = partitioned.known.length + partitioned.unexpected.length;
    console.log(`RESULT: FAIL. ${totalFound} value mismatch(es) were ALSO found among the parts that could still be read, but they are NOT reported as a clean result — fix the structural errors above and rerun before trusting anything.`);
    console.log(bar + '\n');
    return;
  }

  const { known, unexpected, unused } = partitioned;
  const fmt = m => `[${m.category}] ${[m.player, m.course, m.tee, m.round].filter(Boolean).join(' / ')}: ${m.old} -> ${m.new}`;

  console.log(`=== ${known.length} KNOWN EXCEPTION(S), ${unexpected.length} UNEXPECTED MISMATCH(ES) ===`);
  if (known.length) {
    console.log('Known exceptions (accepted deviations — printed every run, never hidden):');
    known.forEach(({ mismatch, exception }) => {
      console.log(`  ${fmt(mismatch)}`);
      console.log(`      accepted: ${exception.reason}`);
      console.log(`      authorized by ${exception.authorizedBy} on ${exception.date}`);
    });
  }
  if (unexpected.length) {
    console.log(known.length ? '\nUnexpected mismatches:' : 'Unexpected mismatches:');
    unexpected.forEach(m => console.log(`  ${fmt(m)}`));
  } else {
    console.log(known.length ? '\nPASS — no unexpected mismatches beyond the known exceptions above.' : 'PASS — DATA matches the sheet on everything this checker compares.');
  }
  if (unused.length) {
    console.log(`\n(informational) ${unused.length} known exception(s) in ${path.basename(EXCEPTIONS_PATH)} matched nothing this run — may be stale, worth a look:`);
    unused.forEach(e => console.log(`  - ${e.reason}`));
  }

  if (extra && extra.pairingsInfo && extra.pairingsInfo.unrecognized && extra.pairingsInfo.unrecognized.length) {
    console.log(`\n(informational, not an error or mismatch) ${extra.pairingsInfo.unrecognized.length} round header(s) in the sheet have no matching DATA round — extra/unused rounds, e.g. Friday at Ravines:`);
    extra.pairingsInfo.unrecognized.forEach(h => console.log(`  - "${h.raw}"`));
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
  const { mismatches, errors, pairingsInfo } = compareDataToWorkbook(DATA, wb);
  const exceptions = loadExceptions();
  const partitioned = partitionMismatches(mismatches, exceptions);
  printReport(errors, partitioned, { pairingsInfo });
  const failed = partitioned.unexpected.length > 0 || errors.length > 0;
  if (errors.length) {
    console.error(`\nEXIT 1 — structural errors prevented a trustworthy comparison (see above).`);
  } else if (partitioned.unexpected.length) {
    console.error(`\nEXIT 1 — ${partitioned.unexpected.length} unexpected mismatch(es) found (see above).`);
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { compareDataToWorkbook, fingerprint, readDATA, findCourseBands, findColumnByHeader, findRoundHeaders, parseGroupsBelow, printReport, loadExceptions, partitionMismatches, exceptionMatches, EXCEPTIONS_PATH };
