import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  buildXlsx,
  columnName,
  crc32,
  escapeXml,
  sheetName,
  xlsxFilename,
} from "@/lib/xlsx";

/**
 * Read a STORED zip back out, the way a spreadsheet would.
 *
 * Deliberately a real parse of the central directory rather than a regex over
 * the bytes: the thing most likely to be wrong in a hand-written archive is an
 * offset or a length, and only walking the structure catches that. `inflateRaw`
 * is here so a future switch to deflate doesn't silently pass.
 */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // Find the end-of-central-directory record, scanning back from the tail.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralAt = view.getUint32(eocd + 16, true);
  // The directory has to end exactly where the EOCD begins, which is the
  // assertion that catches an off-by-one in the sizes written above it.
  expect(centralAt + centralSize).toBe(eocd);

  const out = new Map<string, string>();
  let at = centralAt;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const storedCrc = view.getUint32(at + 16, true);
    const compSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));

    // Now follow the pointer into the local header and read the payload.
    expect(view.getUint32(localAt, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(localAt + 26, true);
    const localExtraLen = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataAt, dataAt + compSize);

    const data = method === 0 ? raw : inflateRawSync(raw);
    expect(crc32(data)).toBe(storedCrc);
    out.set(name, decoder.decode(data));

    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("escapeXml", () => {
  it("escapes the five metacharacters", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    );
  });

  it("strips the control characters Excel calls corruption", () => {
    expect(escapeXml("a\u0000b\u0007c\u001Fd")).toBe("abcd");
  });

  it("keeps tab, newline and carriage return, which are legal XML", () => {
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
});

describe("columnName", () => {
  it("counts in bijective base-26", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    // The case a plain base-26 conversion gets wrong: there is no zero digit.
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
    expect(columnName(701)).toBe("ZZ");
    expect(columnName(702)).toBe("AAA");
  });
});

describe("sheetName", () => {
  it("clamps to Excel's 31 characters", () => {
    expect(sheetName("x".repeat(40))).toHaveLength(31);
  });

  it("replaces the characters Excel refuses outright", () => {
    expect(sheetName("a/b\\c[d]e:f*g?h")).toBe("a b c d e f g h");
  });

  it("falls back rather than producing an empty tab name", () => {
    expect(sheetName("  ///  ")).toBe("Sheet1");
  });
});

describe("crc32", () => {
  it("matches the known IEEE check value", () => {
    // "123456789" -> 0xCBF43926 is the standard CRC-32 test vector.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for no bytes", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildXlsx", () => {
  const workbook = buildXlsx([
    {
      name: "Flight Log",
      rows: [
        ["Date", "PIC", "Total Tach"],
        ["7/30/2026", "Geo & Co <test>", 1.2],
        [],
        [null, undefined, ""],
      ],
    },
    { name: "Second", rows: [["only"]] },
  ]);

  const parts = readZip(workbook);

  it("writes a zip whose every entry checksums", () => {
    // readZip asserts the CRC of each entry as it goes; this pins the parts.
    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  });

  it("starts with the local file header signature, so it sniffs as a zip", () => {
    expect(Array.from(workbook.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("names every sheet in the workbook and points a rel at each", () => {
    const book = parts.get("xl/workbook.xml")!;
    expect(book).toContain('name="Flight Log"');
    expect(book).toContain('name="Second"');
    expect(book).toContain('r:id="rId2"');
    expect(parts.get("xl/_rels/workbook.xml.rels")!).toContain(
      'Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"'
    );
  });

  it("declares a content type for every worksheet part", () => {
    const types = parts.get("[Content_Types].xml")!;
    expect(types).toContain("/xl/worksheets/sheet1.xml");
    expect(types).toContain("/xl/worksheets/sheet2.xml");
  });

  it("writes strings inline and numbers as values", () => {
    const sheet = parts.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Date');
    // A number is bare, so the cell arrives as a number rather than as text.
    expect(sheet).toContain('<c r="C2"><v>1.2</v></c>');
  });

  it("escapes cell text rather than breaking the part", () => {
    expect(parts.get("xl/worksheets/sheet1.xml")!).toContain(
      "Geo &amp; Co &lt;test&gt;"
    );
  });

  it("keeps blank rows, so a summary band cannot shift the table under it", () => {
    const sheet = parts.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<row r="3"></row>');
    // Empty cells are omitted, but the row they were on still numbers 4.
    expect(sheet).toContain('<row r="4"></row>');
  });

  it("still produces a valid book when given no sheets at all", () => {
    const empty = readZip(buildXlsx([]));
    expect(empty.get("xl/workbook.xml")).toContain('name="Sheet1"');
  });
});

describe("xlsxFilename", () => {
  it("slugs the parts it is given", () => {
    expect(xlsxFilename(["N8318B", "flight log"])).toBe("n8318b-flight-log.xlsx");
  });

  it("drops the empty parts rather than leaving a double dash", () => {
    expect(xlsxFilename(["N8318B", null, "mine"])).toBe("n8318b-mine.xlsx");
  });

  it("falls back when nothing usable is left", () => {
    expect(xlsxFilename([null, "---"])).toBe("export.xlsx");
  });
});
