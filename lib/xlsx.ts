// Rows -> .xlsx, so a club sheet can be opened in the spreadsheet it came from.
//
// Written by hand rather than pulled from a package, for the same reason
// lib/ics.ts is: the slice of the format we need is small and completely
// static, while every xlsx package on npm is a megabyte of formula parsing,
// styling and reader support we would never call. An .xlsx is a ZIP of a few
// XML parts; what follows is those parts and a ZIP writer that stores rather
// than compresses.
//
// Deliberately narrow, and the narrowness is the point:
//   - values are strings and numbers. No dates, no formulas, no styles - the
//     callers in lib/exports.ts format their own dates, because a real date
//     cell means serial numbers, the 1900 leap-year bug and a number-format
//     table, and none of that survives the trip to Google Sheets any better
//     than "7/30/2026" does.
//   - strings are written INLINE (t="inlineStr") rather than into a shared
//     string table. A table saves bytes when the same text repeats thousands
//     of times; a club's log is hundreds of rows, and inline strings mean one
//     less part that can disagree with the sheet indexing it.
//   - entries are STORED, not deflated. There is no synchronous deflate in the
//     browser, and the whole point of this file is that it runs on the device
//     with no round trip. A few hundred KB of XML is a download nobody notices.
//
// Everything here is a pure transform - see tests/unit/xlsx.test.ts.

/** What a cell may hold. `null`/`undefined` both mean "leave it empty". */
export type CellValue = string | number | null | undefined;

export interface Sheet {
  /** The tab's name. Sanitised - Excel refuses several characters outright. */
  name: string;
  /** Row-major. Ragged rows are fine; a short row just ends early. */
  rows: CellValue[][];
}

/**
 * Escape the five XML metacharacters, and drop the bytes Excel rejects.
 *
 * The control-character strip is not defensive tidying: those code points are
 * not legal in XML 1.0 at all, and Excel reports a file containing one as
 * corrupt rather than skipping it. Tab, newline and carriage return are the
 * three that ARE legal, and are deliberately left in.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A zero-based column index as its spreadsheet letters: 0 -> A, 25 -> Z,
 * 26 -> AA.
 *
 * Bijective base-26 (there is no "zero" digit), which is why this subtracts one
 * before each division rather than after.
 */
export function columnName(index: number): string {
  let name = "";
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/**
 * Make a string safe to use as a tab name.
 *
 * Excel's rules, not ours: 31 characters, and none of [ ] : * ? / \. A file
 * breaking either opens with a "we found a problem" dialog, so this clamps
 * rather than trusting the caller.
 */
export function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return cleaned.slice(0, 31) || "Sheet1";
}

/** One <c> element, or "" for an empty cell (which is simply omitted). */
function cellXml(value: CellValue, ref: string): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    // A non-finite number has no XML representation Excel will read, so it
    // degrades to text rather than writing <v>NaN</v> and corrupting the part.
    if (!Number.isFinite(value)) {
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
    }
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return (
    `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">` +
    `${escapeXml(value)}</t></is></c>`
  );
}

function worksheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((cells, r) => {
      const body = cells
        .map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`))
        .join("");
      // An entirely empty row still gets its <row>: dropping it would shift
      // every row below it up, and the summary bands these exports open with
      // use a blank row as their separator.
      return `<row r="${r + 1}">${body}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** The workbook's parts, as name -> text. */
function workbookParts(sheets: Sheet[]): { name: string; text: string }[] {
  const names = sheets.map((s) => sheetName(s.name));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
          `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/></Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    names
      .map(
        (name, i) =>
          `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" ` +
          `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
          `Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `</Relationships>`;

  return [
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rootRels },
    { name: "xl/workbook.xml", text: workbook },
    { name: "xl/_rels/workbook.xml.rels", text: workbookRels },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: worksheetXml(sheet),
    })),
  ];
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE), which every ZIP entry carries and readers do check. */
export function crc32(bytes: Uint8Array): number {
  let table = crcTable;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crcTable = table;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A growable little-endian byte sink - the whole ZIP is written through one. */
class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  bytes(chunk: Uint8Array) {
    this.parts.push(chunk);
    this.length += chunk.length;
  }

  u16(value: number) {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number) {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ])
    );
  }

  // The buffer parameter is spelled out rather than left to inference: a
  // bare `Uint8Array` widens to `ArrayBufferLike`, which is not a `BlobPart`,
  // and the error surfaces in the component that builds the download rather
  // than here.
  done(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/**
 * A ZIP archive with every entry STORED (method 0).
 *
 * The DOS timestamp is a fixed 1980-01-01 rather than "now": the bytes are then
 * a pure function of the rows, which is what lets a test assert on them, and no
 * reader has ever shown a member the mtime inside an .xlsx.
 */
function zip(files: { name: string; text: string }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const out = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; at: number }[] = [];

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const at = out.length;

    out.u32(0x04034b50); // local file header
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method: stored
    out.u16(0); // mod time
    out.u16(0x0021); // mod date: 1980-01-01
    out.u32(crc);
    out.u32(data.length); // compressed size == uncompressed, being stored
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // extra field length
    out.bytes(name);
    out.bytes(data);

    central.push({ name, crc, size: data.length, at });
  }

  const centralAt = out.length;
  for (const entry of central) {
    out.u32(0x02014b50); // central directory header
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method
    out.u16(0); // mod time
    out.u16(0x0021); // mod date
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.at);
    out.bytes(entry.name);
  }
  const centralSize = out.length - centralAt;

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk holding the central directory
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralAt);
  out.u16(0); // comment length

  return out.done();
}

/** The MIME type an .xlsx blob has to carry for the OS to open it correctly. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build a whole workbook. One tab per sheet, in the order given. */
export function buildXlsx(sheets: Sheet[]): Uint8Array<ArrayBuffer> {
  const safe = sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] }];
  return zip(workbookParts(safe));
}

/** A filename-safe slug, for the downloaded file. Mirrors `icsFilename`. */
export function xlsxFilename(parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "export"}.xlsx`;
}
