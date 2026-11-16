// A small PDF writer, by hand and with no dependency, for the same reason
// `xlsx.ts` and `ics.ts` are hand-written: the app needs one narrow kind of
// document (a printed statement), and that is a few hundred lines of text,
// not a library.
//
// Deliberately narrow: text in the two built-in Helvetica faces (every PDF
// reader ships them, so nothing is embedded), filled and stroked rectangles,
// and lines. Text is WinAnsi-encoded, which covers ASCII, Latin-1 and the few
// typographic marks the app writes (— · ’ “ ” …); anything else prints as "?"
// rather than breaking the file. Streams are left uncompressed, which keeps
// the writer synchronous and lets a test read the words straight out of the
// bytes.
//
// Coordinates are TOP-LEFT, in points, like the page you're picturing; the
// writer flips them into PDF's bottom-left space as it goes.

export type PdfFont = "regular" | "bold";

/** An RGB colour as "#rrggbb". */
export type PdfColor = string;

/** US Letter, in points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

// Advance widths (per 1000 em) for character codes 32–126, from Adobe's
// Helvetica and Helvetica-Bold font metrics. Needed to right-align money and
// to shorten a description that won't fit its column.
const REGULAR_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// The typographic marks outside Latin-1 that WinAnsi has a slot for, with
// their width (the same in both faces).
const WIN_ANSI_EXTRAS: Record<string, [code: number, width: number]> = {
  "—": [0x97, 1000], // — em dash
  "–": [0x96, 556], // – en dash
  "•": [0x95, 350], // • bullet
  "…": [0x85, 1000], // … ellipsis
  "‘": [0x91, 222], // ‘
  "’": [0x92, 222], // ’
  "“": [0x93, 333], // “
  "”": [0x94, 333], // ”
  "−": [0x2d, 333], // − minus, printed as a hyphen
};

/** One character → its WinAnsi byte and its width per 1000 em. */
function encodeChar(ch: string, font: PdfFont): [code: number, width: number] {
  const extra = WIN_ANSI_EXTRAS[ch];
  if (extra) return extra;
  const code = ch.codePointAt(0) ?? 63;
  if (code >= 32 && code <= 126) {
    const widths = font === "bold" ? BOLD_WIDTHS : REGULAR_WIDTHS;
    return [code, widths[code - 32]];
  }
  if (code === 0xb7) return [0xb7, 278]; // · middle dot
  // The rest of Latin-1 (accented names) maps straight across. Its widths
  // aren't tabled here; a lowercase-letter width is close enough to keep
  // right-aligned text right-aligned.
  if (code >= 0xa0 && code <= 0xff) return [code, 556];
  return [63, font === "bold" ? 611 : 556]; // "?"
}

/** How wide `text` is, in points, at `size` in `font`. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  let units = 0;
  for (const ch of text) units += encodeChar(ch, font)[1];
  return (units * size) / 1000;
}

/**
 * `text` cut down to fit `maxWidth`, ending in "…" when anything was cut.
 * Whole text when it already fits.
 */
export function fitText(text: string, font: PdfFont, size: number, maxWidth: number): string {
  if (textWidth(text, font, size) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && textWidth(chars.join("") + "…", font, size) > maxWidth) chars.pop();
  return chars.join("").trimEnd() + "…";
}

/** `text` broken into lines no wider than `maxWidth`, at word boundaries. */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, font, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => fitText(line, font, size, maxWidth));
}

/** A PDF literal string body: WinAnsi bytes, with ( ) \ escaped. */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = encodeChar(ch, "regular")[0];
    const c = String.fromCharCode(code);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** "#c64912" → "0.776 0.286 0.071", the operand form of a colour. */
function rgb(color: PdfColor): string {
  const hex = color.replace("#", "");
  const parts = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return parts.map((p) => (Number.isFinite(p) ? round(p) : 0)).join(" ");
}

/** Three decimals is far finer than any printer, and keeps the file small. */
function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export interface TextOptions {
  font?: PdfFont;
  size?: number;
  color?: PdfColor;
  /** Where `x` is: the text's left edge (default), right edge, or centre. */
  align?: "left" | "right" | "center";
}

/** A document being drawn, one page at a time. */
export class PdfDocument {
  private pages: string[][] = [];
  private current: string[] | null = null;

  constructor(private readonly title: string) {}

  /** Starts a new page and makes it the one being drawn on. */
  addPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Draw on an earlier page (0-based) — for "Page 1 of 3" footers. */
  usePage(index: number): void {
    this.current = this.pages[index];
  }

  private ops(): string[] {
    if (!this.current) this.addPage();
    return this.current!;
  }

  /** Text whose BASELINE sits at `y` from the top of the page. */
  text(x: number, y: number, text: string, opts: TextOptions = {}): void {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 10;
    const width = textWidth(text, font, size);
    let left = x;
    if (opts.align === "right") left = x - width;
    if (opts.align === "center") left = x - width / 2;
    this.ops().push(
      `BT /${font === "bold" ? "F2" : "F1"} ${round(size)} Tf ${rgb(opts.color ?? "#111111")} rg ` +
        `${round(left)} ${round(PAGE_HEIGHT - y)} Td (${literal(text)}) Tj ET`
    );
  }

  /** A rectangle whose TOP-LEFT corner is (x, y). */
  rect(x: number, y: number, w: number, h: number, opts: { fill?: PdfColor; stroke?: PdfColor; lineWidth?: number }): void {
    const parts: string[] = [];
    if (opts.fill) parts.push(`${rgb(opts.fill)} rg`);
    if (opts.stroke) parts.push(`${rgb(opts.stroke)} RG ${round(opts.lineWidth ?? 1)} w`);
    parts.push(`${round(x)} ${round(PAGE_HEIGHT - y - h)} ${round(w)} ${round(h)} re`);
    parts.push(opts.fill && opts.stroke ? "B" : opts.fill ? "f" : "S");
    this.ops().push(parts.join(" "));
  }

  /** A straight line. */
  line(x1: number, y1: number, x2: number, y2: number, color: PdfColor, lineWidth = 1): void {
    this.ops().push(
      `${rgb(color)} RG ${round(lineWidth)} w ${round(x1)} ${round(PAGE_HEIGHT - y1)} m ` +
        `${round(x2)} ${round(PAGE_HEIGHT - y2)} l S`
    );
  }

  /** The finished file. */
  toBytes(): Uint8Array<ArrayBuffer> {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [];
    // 1 catalog, 2 page tree, 3–4 fonts, 5 info; then a page + its content per page.
    const pageIds = this.pages.map((_, i) => 6 + i * 2);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[5] = `<< /Title (${literal(this.title)}) /Producer (${literal("VFF Flying Club app")}) >>`;
    this.pages.forEach((ops, i) => {
      const pageId = pageIds[i];
      const content = ops.join("\n");
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
      // Every character in `content` is a single byte (< 256), so its string
      // length IS its byte length.
      objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = out.length;
      out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) {
      out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(new ArrayBuffer(out.length));
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
