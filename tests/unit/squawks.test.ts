import { describe, expect, it } from "vitest";
import {
  SQUAWK_STATUSES,
  SQUAWK_STATUS_HINTS,
  SQUAWK_STATUS_LABELS,
  SQUAWK_STATUS_SHORT,
  squawkBanner,
  normalizeSquawkNote,
  MAX_SQUAWK_NOTE_CHARS,
  SQUAWK_STATUS_TONES,
  SQUAWK_TRIAGE_ORDER,
  isAwaitingReview,
  isGrounding,
  isInMaintenance,
  isOpen,
  isSquawkStatus,
  type SquawkStatus,
} from "@/lib/squawks";

describe("squawk statuses", () => {
  // The club's sheet has exactly these five. Adding one is a real decision
  // (it has to answer both predicates below), so it should break this test.
  it("is the club's controlled vocabulary, in enum order", () => {
    expect(SQUAWK_STATUSES).toEqual([
      "NEW",
      "REVIEWED_OK_TO_FLY",
      "REVIEWED_IN_WORK",
      "REVIEWED_GROUNDED",
      "CLOSED",
    ]);
  });

  it("gives every status a label, a short form, a tone and a hint", () => {
    for (const status of SQUAWK_STATUSES) {
      expect(SQUAWK_STATUS_LABELS[status], status).toBeTruthy();
      expect(SQUAWK_STATUS_SHORT[status], status).toBeTruthy();
      expect(SQUAWK_STATUS_TONES[status], status).toBeTruthy();
      expect(SQUAWK_STATUS_HINTS[status], status).toBeTruthy();
    }
  });

  it("narrows a status off the wire", () => {
    expect(isSquawkStatus("REVIEWED_GROUNDED")).toBe(true);
    expect(isSquawkStatus("OPEN")).toBe(false); // the old enum
    expect(isSquawkStatus("")).toBe(false);
    expect(isSquawkStatus(null)).toBe(false);
  });
});

// These four predicates are the whole reason the file exists: every banner,
// badge and dispatch decision reads them instead of comparing strings.
describe("what a status means", () => {
  it("treats everything except CLOSED as still open", () => {
    const open = SQUAWK_STATUSES.filter(isOpen);
    expect(open).toEqual([
      "NEW",
      "REVIEWED_OK_TO_FLY",
      "REVIEWED_IN_WORK",
      "REVIEWED_GROUNDED",
    ]);
    expect(isOpen("CLOSED")).toBe(false);
  });

  // "Reviewed — okay to fly" is reviewed but NOT fixed, so it stays on the
  // working list. That's the case most likely to get wrongly filtered out.
  it("keeps okay-to-fly on the working list", () => {
    expect(isOpen("REVIEWED_OK_TO_FLY")).toBe(true);
  });

  it("grounds the airplane for exactly one status", () => {
    expect(SQUAWK_STATUSES.filter(isGrounding)).toEqual(["REVIEWED_GROUNDED"]);
  });

  // In-work means the shop has it, not that it's unairworthy — the officer
  // grounds it explicitly if that's what they mean.
  it("does not treat in-work as a grounding", () => {
    expect(isGrounding("REVIEWED_IN_WORK")).toBe(false);
    expect(SQUAWK_STATUSES.filter(isInMaintenance)).toEqual(["REVIEWED_IN_WORK"]);
  });

  it("flags only untriaged squawks as awaiting review", () => {
    expect(SQUAWK_STATUSES.filter(isAwaitingReview)).toEqual(["NEW"]);
  });
});

describe("SQUAWK_TRIAGE_ORDER", () => {
  it("covers every status exactly once", () => {
    expect([...SQUAWK_TRIAGE_ORDER].sort()).toEqual([...SQUAWK_STATUSES].sort());
  });

  // The point of having a second order at all: a list sorted by the ENUM would
  // put the grounded squawks near the bottom, under everything harmless.
  it("puts what stops dispatch first and the closed ones last", () => {
    expect(SQUAWK_TRIAGE_ORDER[0]).toBe("REVIEWED_GROUNDED");
    expect(SQUAWK_TRIAGE_ORDER[SQUAWK_TRIAGE_ORDER.length - 1]).toBe("CLOSED");
  });

  it("differs from enum order — which is why it exists", () => {
    expect(SQUAWK_TRIAGE_ORDER).not.toEqual(SQUAWK_STATUSES);
  });

  it("sorts a mixed list worst-first", () => {
    const rows: SquawkStatus[] = [
      "CLOSED",
      "REVIEWED_OK_TO_FLY",
      "REVIEWED_GROUNDED",
      "NEW",
    ];
    rows.sort(
      (a, b) => SQUAWK_TRIAGE_ORDER.indexOf(a) - SQUAWK_TRIAGE_ORDER.indexOf(b)
    );
    expect(rows).toEqual([
      "REVIEWED_GROUNDED",
      "NEW",
      "REVIEWED_OK_TO_FLY",
      "CLOSED",
    ]);
  });
});

describe("squawkBanner", () => {
  const none = { grounded: 0, inWork: 0, unreviewed: 0, okToFly: 0 };

  it("is nothing with nothing open", () => {
    expect(squawkBanner(none)).toBeNull();
  });

  it("is red for a grounding, and says only that", () => {
    expect(squawkBanner({ ...none, grounded: 1, inWork: 2, unreviewed: 3 })).toEqual({
      tone: "red",
      text: "Do not fly — grounded by 1 squawk",
    });
  });

  it("puts everything else worth reading on ONE amber line, worst first", () => {
    expect(squawkBanner({ ...none, inWork: 1, unreviewed: 2 })).toEqual({
      tone: "amber",
      text: "In maintenance — 1 squawk being worked · 2 unreviewed squawks",
    });
    expect(squawkBanner({ ...none, unreviewed: 1 })?.text).toBe("1 unreviewed squawk");
  });

  // Reviewed and okay to fly is still OPEN — amber, not green.
  it("keeps okay-to-fly amber", () => {
    expect(squawkBanner({ ...none, okToFly: 2 })).toEqual({
      tone: "amber",
      text: "2 squawks reviewed, okay to fly",
    });
  });
});

describe("normalizeSquawkNote", () => {
  it("trims what the officer typed", () => {
    expect(normalizeSquawkNote("  Parts on order.  ")).toEqual({ note: "Parts on order." });
  });

  it("treats an empty box as removing the note", () => {
    expect(normalizeSquawkNote("   ")).toEqual({ note: null });
    expect(normalizeSquawkNote(null)).toEqual({ note: null });
  });

  it("refuses something that isn't text, or is far too long", () => {
    expect(normalizeSquawkNote(42)).toHaveProperty("error");
    expect(normalizeSquawkNote("x".repeat(MAX_SQUAWK_NOTE_CHARS + 1))).toHaveProperty("error");
  });
});
