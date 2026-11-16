import { describe, expect, it } from "vitest";
import { PdfDocument, fitText, textWidth, wrapText } from "@/lib/pdf";

/** The file as text: streams are uncompressed, so words can be read straight out. */
function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

describe("textWidth / fitText / wrapText", () => {
  it("measures with Helvetica's own widths", () => {
    // "W" is 944/1000 em in regular, "i" 222.
    expect(textWidth("W", "regular", 10)).toBeCloseTo(9.44);
    expect(textWidth("i", "regular", 10)).toBeCloseTo(2.22);
    expect(textWidth("A", "bold", 10)).toBeGreaterThan(textWidth("A", "regular", 10) - 0.01);
  });

  it("cuts text that won't fit, ending in an ellipsis", () => {
    expect(fitText("short", "regular", 10, 200)).toBe("short");
    const cut = fitText("a much longer description than the column", "regular", 10, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, "regular", 10)).toBeLessThanOrEqual(60);
  });

  it("wraps at word boundaries", () => {
    const lines = wrapText("one two three four five six", "regular", 10, 50);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, "regular", 10)).toBeLessThanOrEqual(50);
    expect(lines.join(" ")).toBe("one two three four five six");
  });
});

describe("PdfDocument", () => {
  it("writes a well-formed file whose xref offsets point at their objects", () => {
    const doc = new PdfDocument("Test");
    doc.text(50, 50, "Hello (world) \\ — “quoted”");
    doc.addPage();
    doc.rect(10, 10, 100, 20, { fill: "#c64912" });
    const text = asText(doc.toBytes());
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    // Parentheses and backslash escaped; the em dash and curly quotes as WinAnsi bytes.
    expect(text).toContain("(Hello \\(world\\) \\\\ \x97 \x93quoted\x94)");

    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = text
      .slice(xref)
      .split("\n")
      .filter((l) => / 00000 n $/.test(l))
      .map((l) => Number(l.slice(0, 10)));
    offsets.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("prints a character WinAnsi lacks as ? rather than breaking the file", () => {
    const doc = new PdfDocument("T");
    doc.text(0, 10, "日");
    expect(asText(doc.toBytes())).toContain("(?)");
  });
});
