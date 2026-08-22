import { describe, expect, it } from "vitest";
import {
  MAX_LOG_ENTRY_CHARS,
  escapeHtml,
  hasContent,
  markdownToText,
  normalizeLogEntry,
  renderMarkdown,
} from "@/lib/markdown";
import { applyTool } from "@/components/common/RichText";

describe("escapeHtml", () => {
  it("takes the teeth out of every metacharacter", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;"
    );
  });

  it("escapes the ampersand first, so nothing is double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("renderMarkdown — safety", () => {
  // The one property this module exists to hold. If any of these ever emits a
  // live tag, the write-up field is a stored-XSS hole on every member's log.
  it("never emits a tag the source asked for", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
    );
  });

  it("cannot be talked into an attribute", () => {
    // The whole input comes back as inert TEXT inside a paragraph. Asserting on
    // the exact output rather than on "doesn't contain onerror" because the
    // word onerror is allowed to appear — a member may write it — and what must
    // never appear is the `<` that would make it an attribute.
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).toBe(
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>"
    );
  });

  it("emits no tag outside the handful it knows", () => {
    const out = renderMarkdown("<img>\n\n- <script>\n\n**<b>**");
    // Every `<` in the output opens one of the emitted tags and nothing else.
    const tags = [...out.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(["p", "ul", "li", "strong"]));
  });

  it("escapes inside emphasis too", () => {
    expect(renderMarkdown("**<b>bold</b>**")).toBe(
      "<p><strong>&lt;b&gt;bold&lt;/b&gt;</strong></p>"
    );
  });

  it("escapes inside list items too", () => {
    expect(renderMarkdown("- <i>x</i>")).toBe("<ul><li>&lt;i&gt;x&lt;/i&gt;</li></ul>");
  });
});

describe("renderMarkdown — the subset", () => {
  it("is empty for nothing", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown("   \n  ")).toBe("");
  });

  it("wraps a plain line in a paragraph", () => {
    expect(renderMarkdown("Smooth flight.")).toBe("<p>Smooth flight.</p>");
  });

  it("keeps a single newline as a line break", () => {
    expect(renderMarkdown("one\ntwo")).toBe("<p>one<br>two</p>");
  });

  it("splits paragraphs on a blank line", () => {
    expect(renderMarkdown("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
  });

  it("bolds before it italicises", () => {
    expect(renderMarkdown("**very**")).toBe("<p><strong>very</strong></p>");
    expect(renderMarkdown("*quite*")).toBe("<p><em>quite</em></p>");
  });

  it("leaves snake_case alone", () => {
    expect(renderMarkdown("fuel_burn_gph was high")).toBe(
      "<p>fuel_burn_gph was high</p>"
    );
  });

  it("takes _underscores_ at word boundaries", () => {
    expect(renderMarkdown("_quite_")).toBe("<p><em>quite</em></p>");
  });

  it("builds a bullet list", () => {
    expect(renderMarkdown("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("builds a numbered list", () => {
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("keeps a bullet run and a numbered run as two lists", () => {
    expect(renderMarkdown("- a\n1. b")).toBe(
      "<ul><li>a</li></ul><ol><li>b</li></ol>"
    );
  });

  it("does not need a blank line before a list", () => {
    // The most common shape a debrief takes, and the one a stricter renderer
    // turns into a paragraph with hyphens in it.
    expect(renderMarkdown("The lesson:\n- steep turns\n- stalls")).toBe(
      "<p>The lesson:</p><ul><li>steep turns</li><li>stalls</li></ul>"
    );
  });

  it("marks up inside a list item", () => {
    expect(renderMarkdown("- **wind** was up")).toBe(
      "<ul><li><strong>wind</strong> was up</li></ul>"
    );
  });
});

describe("markdownToText", () => {
  it("strips the marks and keeps the shape", () => {
    expect(markdownToText("**a** and *b*\n- one\n- two")).toBe(
      "a and b\n• one\n• two"
    );
  });

  it("is empty for nothing", () => {
    expect(markdownToText(null)).toBe("");
  });
});

describe("normalizeLogEntry", () => {
  it("turns an empty write-up into null", () => {
    expect(normalizeLogEntry("")).toBeNull();
    expect(normalizeLogEntry("   \n ")).toBeNull();
    expect(normalizeLogEntry(undefined)).toBeNull();
    expect(normalizeLogEntry(42)).toBeNull();
  });

  it("normalises newlines and trims the ends", () => {
    expect(normalizeLogEntry("  a\r\nb  ")).toBe("a\nb");
  });

  it("caps a paste accident", () => {
    const huge = "x".repeat(MAX_LOG_ENTRY_CHARS + 500);
    expect(normalizeLogEntry(huge)!.length).toBe(MAX_LOG_ENTRY_CHARS);
  });
});

describe("hasContent", () => {
  it("treats whitespace as empty", () => {
    expect(hasContent(" \n ")).toBe(false);
    expect(hasContent("x")).toBe(true);
    expect(hasContent(null)).toBe(false);
  });
});

// ── The toolbar ────────────────────────────────────────────────────────────
//
// Pure, so the behaviour that matters is pinned here rather than driven
// through a textarea in an e2e test.

const BOLD = { kind: "wrap", id: "bold", label: "Bold", glyph: "B", marker: "**" } as const;
const BULLETS = {
  kind: "list",
  id: "bullets",
  label: "Bulleted list",
  glyph: "•",
  ordered: false,
} as const;
const NUMBERS = { ...BULLETS, id: "numbers", ordered: true } as const;

describe("applyTool — wrapping", () => {
  it("wraps the selection", () => {
    const out = applyTool(BOLD, "wind was up", 0, 4);
    expect(out.text).toBe("**wind** was up");
  });

  it("leaves the caret between the markers when nothing is selected", () => {
    const out = applyTool(BOLD, "", 0, 0);
    expect(out.text).toBe("****");
    expect(out.selectionStart).toBe(2);
    expect(out.selectionEnd).toBe(2);
  });

  it("unwraps on a second press", () => {
    const out = applyTool(BOLD, "**wind** was up", 0, 8);
    expect(out.text).toBe("wind was up");
  });
});

describe("applyTool — lists", () => {
  it("marks every line of the selection", () => {
    const out = applyTool(BULLETS, "one\ntwo", 0, 7);
    expect(out.text).toBe("- one\n- two");
  });

  it("numbers from one", () => {
    expect(applyTool(NUMBERS, "one\ntwo", 0, 7).text).toBe("1. one\n2. two");
  });

  it("snaps out to whole lines from a caret in the middle", () => {
    const out = applyTool(BULLETS, "one\ntwo", 5, 5);
    expect(out.text).toBe("one\n- two");
  });

  it("takes the markers off when every line already has one", () => {
    expect(applyTool(BULLETS, "- one\n- two", 0, 11).text).toBe("one\ntwo");
  });

  it("converts a bullet run to a numbered one", () => {
    expect(applyTool(NUMBERS, "- one\n- two", 0, 11).text).toBe("1. one\n2. two");
  });

  it("leaves blank lines unmarked", () => {
    expect(applyTool(BULLETS, "one\n\ntwo", 0, 8).text).toBe("- one\n\n- two");
  });
});
