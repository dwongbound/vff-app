import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, icsFilename, toIcsUtc } from "@/lib/ics";

describe("escapeText", () => {
  // These four are delimiters in iCalendar; unescaped they truncate or split
  // the property, and the calendar app silently drops the event.
  it("escapes the characters that would break a property", () => {
    expect(escapeText("a;b")).toBe("a\\;b");
    expect(escapeText("a,b")).toBe("a\\,b");
    expect(escapeText("a\\b")).toBe("a\\\\b");
    expect(escapeText("a\nb")).toBe("a\\nb");
    expect(escapeText("a\r\nb")).toBe("a\\nb");
  });

  it("escapes the backslash first, so an escape isn't re-escaped", () => {
    expect(escapeText("50%\\;")).toBe("50%\\\\\\;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeText("Pattern work with Priya")).toBe("Pattern work with Priya");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:N8318B")).toBe("SUMMARY:N8318B");
  });

  it("folds past 75 octets with a leading space on the continuation", () => {
    const line = "DESCRIPTION:" + "x".repeat(100);
    const folded = foldLine(line);
    expect(folded).toContain("\r\n ");
    const [first, ...rest] = folded.split("\r\n");
    expect(first.length).toBe(75);
    for (const part of rest) expect(part.startsWith(" ")).toBe(true);
    // Unfolding must give back exactly what went in.
    expect(folded.split("\r\n ").join("")).toBe(line);
  });

  // The limit is octets, not characters — a line of em dashes folds sooner
  // than its length suggests, and a multi-byte char must not be split.
  it("counts bytes, not characters", () => {
    const line = "SUMMARY:" + "—".repeat(40); // 3 bytes each
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split("\r\n ").join("")).toBe(line);
    // No mojibake: every dash survived intact.
    expect((folded.match(/—/g) ?? []).length).toBe(40);
  });
});

describe("toIcsUtc", () => {
  it("writes a zero-padded UTC stamp", () => {
    expect(toIcsUtc(new Date(Date.UTC(2026, 7, 4, 17, 30, 5)))).toBe("20260804T173005Z");
    expect(toIcsUtc(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("20260101T000000Z");
  });
});

describe("buildIcs", () => {
  const event = {
    uid: "reservation-abc@vffclub",
    start: new Date(Date.UTC(2026, 7, 4, 16, 0)),
    end: new Date(Date.UTC(2026, 7, 4, 19, 0)),
    summary: "N8318B — Local flight",
    description: "Booked by Dana Ruiz",
    location: "N8318B",
  };
  const ics = buildIcs([event], {
    calendarName: "VFF",
    now: new Date(Date.UTC(2026, 7, 4, 12, 0)),
  });

  it("wraps the events in a valid calendar", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("carries the times, uid and text", () => {
    expect(ics).toContain("UID:reservation-abc@vffclub");
    expect(ics).toContain("DTSTART:20260804T160000Z");
    expect(ics).toContain("DTEND:20260804T190000Z");
    expect(ics).toContain("DTSTAMP:20260804T120000Z");
    expect(ics).toContain("LOCATION:N8318B");
  });

  // RFC 5545 wants CRLF everywhere, including the last line. A bare \n is the
  // classic reason a file imports in one app and not another.
  it("uses CRLF line endings throughout", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("handles several events", () => {
    const two = buildIcs([event, { ...event, uid: "b@vffclub" }]);
    expect((two.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });

  it("omits optional properties that aren't set", () => {
    const bare = buildIcs([
      { uid: "u", start: event.start, end: event.end, summary: "s" },
    ]);
    expect(bare).not.toContain("DESCRIPTION:");
    expect(bare).not.toContain("LOCATION:");
  });
});

describe("icsFilename", () => {
  it("slugs the parts", () => {
    expect(icsFilename(["N8318B", "2026-08-04"])).toBe("n8318b-2026-08-04.ics");
    expect(icsFilename(["Cross-country!", null, undefined])).toBe("cross-country.ics");
  });

  it("falls back when there's nothing usable", () => {
    expect(icsFilename([])).toBe("reservation.ics");
    expect(icsFilename(["***"])).toBe("reservation.ics");
  });
});
