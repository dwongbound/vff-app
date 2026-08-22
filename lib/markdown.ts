// The flight log's write-up field, as text the club owns.
//
// A log entry's write-up wants to be formattable — a lesson debrief is a list
// of things that happened, a trip report has emphasis in it — and the two ways
// to get that are a rich-text editor storing HTML, or plain text with a
// formatting convention. This is the second, and the reason is that the first
// one ends with a column full of markup somebody else's browser produced, which
// then has to be sanitised on every read forever. Store what the member typed;
// decide what it MEANS here.
//
// Deliberately a small subset, and hand-written for the same reason
// lib/xlsx.ts and lib/ics.ts are: what's needed is bold, italic and two kinds
// of list, which is a hundred lines, and a markdown dependency brings a parser
// that accepts raw HTML by default — the exact thing this exists to avoid.
//
// The safety rule is one line long and load-bearing: EVERYTHING IS ESCAPED
// FIRST, and the only tags that can appear in the output are the ones written
// literally in this file. There is no path from input text to a tag.

/** The tags this renderer will ever emit. Nothing here takes an attribute. */
const EMITTED = ["p", "br", "strong", "em", "ul", "ol", "li"] as const;

/** HTML-escape. Runs before anything else, on every character of input. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Inline marks, applied to text that has ALREADY been escaped.
 *
 * Bold before italic, because `**x**` has to be claimed by the two-star rule
 * before the one-star rule can get at it — run the other way round, `**x**`
 * comes out as an empty emphasis wrapped round a starred word.
 *
 * The `_x_` spelling is accepted for italic but only at word boundaries, so a
 * snake_case identifier in a write-up (`fuel_burn_gph`) stays what it was
 * rather than turning its middle into emphasis.
 */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "<em>$1</em>")
    .replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "<em>$1</em>");
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul" | "ol"; items: string[] };

/**
 * Split the source into blocks: paragraphs, and runs of list items.
 *
 * A list does not need a blank line before it — people don't type one, and a
 * renderer that insists on it turns the most common shape a debrief takes ("the
 * lesson:" followed immediately by four dashes) into one long paragraph with
 * hyphens in it.
 */
function blocks(source: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) out.push({ type: "p", lines: paragraph });
    paragraph = [];
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    const type = bullet ? "ul" : ordered ? "ol" : null;

    if (type) {
      flush();
      const last = out[out.length - 1];
      const item = (bullet ?? ordered)![1];
      // Consecutive items of the SAME kind are one list; a bullet run followed
      // by a numbered run is two, which is what the member typed.
      if (last && last.type === type) last.items.push(item);
      else out.push({ type, items: [item] });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return out;
}

/**
 * Render the write-up to HTML.
 *
 * Safe to put through `dangerouslySetInnerHTML` — that is the whole contract of
 * this function, and it holds because `escapeHtml` runs on every line before
 * any tag is added and no input ever reaches an attribute position. A line
 * break inside a paragraph becomes `<br>`: someone laying out a route or a
 * squawk list one-per-line meant those lines.
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (!source || !source.trim()) return "";
  return blocks(source)
    .map((block) => {
      if (block.type === "p") {
        return `<p>${block.lines.map((l) => inline(escapeHtml(l))).join("<br>")}</p>`;
      }
      const items = block.items
        .map((item) => `<li>${inline(escapeHtml(item))}</li>`)
        .join("");
      return `<${block.type}>${items}</${block.type}>`;
    })
    .join("");
}

/**
 * The write-up as plain text — marks stripped, list markers kept.
 *
 * For the places a log entry is quoted rather than rendered: the spreadsheet
 * export, a one-line preview in the log list. Markers are kept because "• fuel
 * slow to fill" read as a line of a list is the shape the member gave it, and
 * flattening it to a run-on sentence loses that.
 */
export function markdownToText(source: string | null | undefined): string {
  if (!source) return "";
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1")
    .replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

/** Does this write-up have anything in it? Whitespace-only is empty. */
export function hasContent(source: string | null | undefined): boolean {
  return Boolean(source && source.trim().length > 0);
}

/**
 * How long a write-up may be, in characters.
 *
 * Generous — this is a debrief, and a member typing a long one is the feature
 * working. The cap is there so a paste accident can't put a megabyte in a
 * column that renders on every open of the log entry.
 */
export const MAX_LOG_ENTRY_CHARS = 20_000;

/**
 * Clean a write-up on its way to the column: normalise newlines, trim the ends,
 * cap the length, and turn an empty one into null.
 *
 * Null rather than "" so "has this entry got a write-up?" is one check against
 * the column, in SQL and in TypeScript alike.
 */
export function normalizeLogEntry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_LOG_ENTRY_CHARS);
  return text.length ? text : null;
}

export { EMITTED as EMITTED_TAGS };
