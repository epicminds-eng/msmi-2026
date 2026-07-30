// Minimal .xlsx reader using ONLY Node built-ins (fs, zlib) — no new runtime
// dependency for Chad to install. An .xlsx is a ZIP file of XML parts; this
// implements just enough of both formats to read what the Phase 5 checker
// needs: the shared string table, the sheet name -> file mapping, and a
// sheet's cells as a plain row/column grid. It deliberately does NOT try to
// be a general-purpose spreadsheet library — no styles, no formulas, no
// merged cells, no zip64 (Nick's sheet is small). If a real file needs any
// of that, this will need extending, not replacing.

const fs = require('fs');
const zlib = require('zlib');

// ---------- ZIP reading ----------
// Walks the End Of Central Directory record backward from EOF (it can have a
// trailing comment of unknown length, so it isn't at a fixed offset), then
// walks the central directory it points to. Each entry's local header is
// read separately because the central directory doesn't itself contain the
// compressed bytes, only where to find them.
function readZipEntries(buf) {
  const EOCD_SIG = 0x06054b50;
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('not a valid zip/xlsx file: End Of Central Directory record not found');

  const entryCount = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  const entries = new Map();
  let p = cdOffset;
  const CD_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) throw new Error(`corrupt central directory entry at offset ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const files = new Map();
  const LOCAL_SIG = 0x04034b50;
  entries.forEach((info, name) => {
    const lp = info.localHeaderOffset;
    if (buf.readUInt32LE(lp) !== LOCAL_SIG) throw new Error(`corrupt local file header for ${name}`);
    const nameLen = buf.readUInt16LE(lp + 26);
    const extraLen = buf.readUInt16LE(lp + 28);
    const dataStart = lp + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + info.compSize);
    let content;
    if (info.method === 0) content = compressed;
    else if (info.method === 8) content = zlib.inflateRawSync(compressed);
    else throw new Error(`unsupported zip compression method ${info.method} for ${name}`);
    files.set(name, content);
  });
  return files;
}

// ---------- minimal XML text extraction (regex-based, not a real parser —
// fine here because xlsx XML is machine-generated with predictable shape) ----------
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm, text = '';
    while ((tm = tRe.exec(m[1]))) text += tm[1];
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

// "A1" -> {col: 0, row: 1}. Column letters are base-26 (A=0, Z=25, AA=26, ...).
function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`unrecognized cell reference "${ref}"`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) };
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  // Self-closing rows (<row .../>, entirely blank) exist in real workbooks —
  // tried as an alternative alongside the open/close form, self-closing
  // FIRST (see the cell regex comment below for why order matters here).
  const rowRe = /<row[^>]*r="(\d+)"[^>]*\/>|<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowIdx = parseInt(rm[1] || rm[2], 10) - 1;
    const rowXml = rm[3] || '';
    if (!rows[rowIdx]) rows[rowIdx] = [];
    /* Self-closing cells (<c r="A1" s="43"/>, a styled-but-empty cell — very
       common in real Excel output, e.g. merged-cell spans, never produced by
       our own synthetic writer) MUST be tried before the open/close
       alternative. [^>]* stops at the first ">" regardless, so it can never
       run past its own tag — but if the open/close branch is tried first, it
       still happily matches a self-closing cell's own "/>" as if it were a
       plain ">", then keeps scanning for the NEXT "</c>" anywhere ahead,
       swallowing every real cell in between as bogus "inner content" of the
       empty one. That's not a hypothetical: it's exactly what corrupted
       Nick's real sheet on first read (this file is full of self-closing
       formatted-but-empty cells; the synthetic fixture used to build and
       test this reader never had any, which is why it went unnoticed).
       Self-closing tried first is safe both ways: it can only match when a
       "/" truly precedes the closing ">", so real open/close cells still
       fall through to the second alternative untouched. */
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*)\/>|<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    const row = rows[rowIdx];
    while ((cm = cellRe.exec(rowXml))) {
      const ref = cm[1] || cm[3];
      const attrs = cm[1] ? (cm[2] || '') : (cm[4] || '');
      const inner = cm[1] ? '' : (cm[5] || '');
      const { col } = parseCellRef(ref);
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : 'n';
      let value = null;
      if (type === 'inlineStr') {
        const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vMatch ? vMatch[1] : null;
        if (raw === null) value = null;
        else if (type === 's') value = sharedStrings[parseInt(raw, 10)];
        else if (type === 'str' || type === 'b') value = raw;
        else value = raw === '' ? null : Number(raw);
      }
      row[col] = value;
    }
    rows[rowIdx] = row;
  }
  // normalize: replace holes (sparse rows/cols) with '' so callers can index
  // freely. A manual loop, not Array.prototype.map — map SKIPS holes in a
  // sparse array entirely (never invokes the callback for an unset index),
  // which would leave a row that was never captured — a genuinely blank row
  // Excel omitted from the XML entirely, not just one with blank cells — as
  // a hole in the OUTPUT too, instead of the padded empty row callers expect.
  const width = rows.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const outRow = new Array(width).fill('');
    for (let c = 0; c < r.length; c++) {
      const v = r[c];
      outRow[c] = (v === undefined || v === null) ? '' : v;
    }
    out.push(outRow);
  }
  return out;
}

function parseWorkbookSheetList(xml) {
  const sheets = [];
  const re = /<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) sheets.push({ name: decodeXmlEntities(m[1]), rId: m[2] });
  return sheets;
}

function parseWorkbookRels(xml) {
  const map = new Map();
  const re = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) map.set(m[1], m[2]);
  return map;
}

/* Reads the whole workbook into { sheetNames, sheet(name) -> rows[][] }.
   Cell values are plain strings/numbers; rows/columns are 0-indexed and
   padded to a rectangular grid so callers never have to guard for holes. */
function readWorkbook(filePath) {
  const buf = fs.readFileSync(filePath);
  const files = readZipEntries(buf);

  const sharedStringsXml = files.has('xl/sharedStrings.xml') ? files.get('xl/sharedStrings.xml').toString('utf8') : '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const workbookXml = files.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('xl/workbook.xml missing — not a valid .xlsx');
  const sheetList = parseWorkbookSheetList(workbookXml.toString('utf8'));

  const relsXml = files.get('xl/_rels/workbook.xml.rels');
  if (!relsXml) throw new Error('xl/_rels/workbook.xml.rels missing — not a valid .xlsx');
  const rels = parseWorkbookRels(relsXml.toString('utf8'));

  const sheetsByName = {};
  sheetList.forEach(({ name, rId }) => {
    const target = rels.get(rId);
    if (!target) return;
    const path = 'xl/' + target.replace(/^\/?xl\//, '');
    const sheetXml = files.get(path);
    if (!sheetXml) return;
    sheetsByName[name] = parseSheetXml(sheetXml.toString('utf8'), sharedStrings);
  });

  return {
    sheetNames: sheetList.map(s => s.name),
    sharedStrings,
    sheet(name) {
      if (!(name in sheetsByName)) throw new Error(`sheet "${name}" not found — sheets present: ${sheetList.map(s => s.name).join(', ')}`);
      return sheetsByName[name];
    },
  };
}

module.exports = { readZipEntries, parseSharedStrings, parseSheetXml, readWorkbook };
