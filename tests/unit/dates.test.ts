import { describe, expect, it } from "vitest";
import {
  calendarMonthsFrom,
  formatClock,
  formatDuration,
  fromDateInputValue,
  joinLocalDateTime,
  splitLocalDateTime,
  toDateInputValue,
  toLocalInputValue,
} from "@/lib/dates";

describe("input-value round trips", () => {
  // The whole point of these helpers: never let a date go through UTC on its
  // way to or from an <input>, or half the country loses a day.
  it("keeps a local date intact through toDateInputValue → fromDateInputValue", () => {
    const original = new Date(2026, 7, 2); // Aug 2 2026, local midnight
    const ymd = toDateInputValue(original);
    expect(ymd).toBe("2026-08-02");
    const back = fromDateInputValue(ymd)!;
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(7);
    expect(back.getDate()).toBe(2);
  });

  it("formats a datetime-local value in local time, not UTC", () => {
    expect(toLocalInputValue(new Date(2026, 7, 2, 9, 5))).toBe("2026-08-02T09:05");
  });

  it("rejects junk instead of inventing a date", () => {
    expect(fromDateInputValue("")).toBeNull();
    expect(fromDateInputValue("not-a-date")).toBeNull();
  });
});

describe("splitLocalDateTime / joinLocalDateTime", () => {
  it("splits a datetime-local value into its halves", () => {
    expect(splitLocalDateTime("2026-08-02T09:30")).toEqual({
      date: "2026-08-02",
      time: "09:30",
    });
  });

  // Some browsers hand back seconds; the pickers only deal in hh:mm.
  it("drops seconds", () => {
    expect(splitLocalDateTime("2026-08-02T09:30:00").time).toBe("09:30");
  });

  it("survives an empty value", () => {
    expect(splitLocalDateTime("")).toEqual({ date: "", time: "" });
  });

  it("only joins when both halves are present", () => {
    expect(joinLocalDateTime("2026-08-02", "09:30")).toBe("2026-08-02T09:30");
    expect(joinLocalDateTime("2026-08-02", "")).toBe("");
    expect(joinLocalDateTime("", "09:30")).toBe("");
  });
});

describe("formatClock", () => {
  it("renders a 24h value for humans", () => {
    // Locale-dependent, so assert on the parts that must be there rather than
    // an exact string.
    expect(formatClock("13:05")).toMatch(/1[:.]05|13[:.]05/);
  });

  it("passes junk straight through", () => {
    expect(formatClock("nope")).toBe("nope");
  });
});

describe("formatDuration", () => {
  it("uses minutes under an hour and hours above it", () => {
    const base = new Date(2026, 7, 2, 9, 0);
    expect(formatDuration(base, new Date(2026, 7, 2, 9, 45))).toBe("45 min");
    expect(formatDuration(base, new Date(2026, 7, 2, 12, 0))).toBe("3 hr");
    expect(formatDuration(base, new Date(2026, 7, 2, 11, 30))).toBe("2.5 hr");
  });
});

describe("calendarMonthsFrom", () => {
  // 14 CFR 61.56: a review on Jan 15 is good through the END of January two
  // years later, not the anniversary.
  it("runs to the last day of the Nth calendar month", () => {
    const due = calendarMonthsFrom("2026-01-15T12:00:00", 24)!;
    expect(due.getFullYear()).toBe(2028);
    expect(due.getMonth()).toBe(0);
    expect(due.getDate()).toBe(31);
  });

  it("returns null without a base date", () => {
    expect(calendarMonthsFrom(null, 24)).toBeNull();
  });
});
