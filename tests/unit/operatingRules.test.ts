import { describe, expect, it } from "vitest";
import {
  CHECKOUT_AIRPORTS,
  EXPERIENCED_RECENT_HOURS,
  EXPERIENCED_TOTAL_HOURS,
  REQUIRED_LANDINGS,
  RULE_ROWS,
  hoursInLastYear,
  landingCurrency,
  pilotTier,
  ruleFor,
} from "@/lib/operatingRules";

describe("pilotTier", () => {
  // The rules' gate is an AND: over 200 hours total *and* 50 in the last year.
  it("needs both halves of the experience gate", () => {
    expect(pilotTier({ totalTimeHours: 250, recentHours: 60 })).toBe("EXPERIENCED");
    expect(pilotTier({ totalTimeHours: 250, recentHours: 40 })).toBe("BUILDING");
    expect(pilotTier({ totalTimeHours: 150, recentHours: 60 })).toBe("BUILDING");
  });

  it("treats the thresholds the way the rules are written", () => {
    // "> 200h", so exactly 200 is not enough; "50h in last 12 months" is a
    // floor, so exactly 50 is.
    expect(
      pilotTier({
        totalTimeHours: EXPERIENCED_TOTAL_HOURS,
        recentHours: EXPERIENCED_RECENT_HOURS,
      })
    ).toBe("BUILDING");
    expect(
      pilotTier({
        totalTimeHours: EXPERIENCED_TOTAL_HOURS + 0.1,
        recentHours: EXPERIENCED_RECENT_HOURS,
      })
    ).toBe("EXPERIENCED");
  });

  it("defaults an undeclared logbook to the tighter column", () => {
    expect(pilotTier({ totalTimeHours: null, recentHours: 80 })).toBe("BUILDING");
  });

  // An approved instructor supersedes the personal minimums entirely.
  it("puts an instructor flight in its own column regardless of experience", () => {
    expect(
      pilotTier({ totalTimeHours: 10, recentHours: 0, withInstructor: true })
    ).toBe("WITH_INSTRUCTOR");
    expect(
      pilotTier({ totalTimeHours: 2000, recentHours: 300, withInstructor: true })
    ).toBe("WITH_INSTRUCTOR");
  });
});

describe("the rules table", () => {
  it("gives every row a limit for all three columns and a reason", () => {
    for (const row of RULE_ROWS) {
      expect(row.experienced, row.id).toBeTruthy();
      expect(row.building, row.id).toBeTruthy();
      expect(row.withInstructor, row.id).toBeTruthy();
      // The (i) text is the whole point of putting the rules in the app.
      expect(row.why.length, row.id).toBeGreaterThan(40);
    }
  });

  it("has unique row ids", () => {
    const ids = RULE_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hands back the column that matches the tier", () => {
    const fuel = RULE_ROWS.find((r) => r.id === "fuel")!;
    expect(ruleFor(fuel, "EXPERIENCED")).toBe("1 h");
    expect(ruleFor(fuel, "BUILDING")).toBe("2 h");
  });

  it("keeps the checkout airports from the printed rules", () => {
    expect(CHECKOUT_AIRPORTS.map((a) => a.id)).toEqual(["KAVX", "KL35"]);
  });
});

describe("landingCurrency", () => {
  const now = new Date("2026-08-01T12:00:00");
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86_400_000).toISOString();

  it("counts landings inside the tier's window", () => {
    const rows = [
      { flownOn: daysAgo(5), landings: 2, nightLandings: 1 },
      { flownOn: daysAgo(20), landings: 1, nightLandings: 1 },
      { flownOn: daysAgo(60), landings: 4, nightLandings: 2 },
    ];

    // Building time: a 30-day window, so the 60-day-old flight doesn't count.
    const building = landingCurrency(rows, "BUILDING", now);
    expect(building.windowDays).toBe(30);
    expect(building.dayLandings).toBe(3);
    expect(building.dayCurrent).toBe(true);
    expect(building.nightLandings).toBe(2);
    expect(building.nightCurrent).toBe(false);

    // Experienced: 90 days, so everything counts.
    const experienced = landingCurrency(rows, "EXPERIENCED", now);
    expect(experienced.windowDays).toBe(90);
    expect(experienced.dayLandings).toBe(7);
    expect(experienced.nightLandings).toBe(4);
    expect(experienced.nightCurrent).toBe(true);
  });

  it("needs three landings, not two", () => {
    const rows = [{ flownOn: daysAgo(1), landings: REQUIRED_LANDINGS - 1 }];
    expect(landingCurrency(rows, "BUILDING", now).dayCurrent).toBe(false);
  });

  it("treats an empty log as not current rather than crashing", () => {
    const status = landingCurrency([], "BUILDING", now);
    expect(status.dayCurrent).toBe(false);
    expect(status.nightLandings).toBe(0);
  });
});

describe("hoursInLastYear", () => {
  const now = new Date("2026-08-01T12:00:00");

  it("adds tach time from the last 12 months only", () => {
    const rows = [
      { flownOn: "2026-07-01", tachStart: 100, tachEnd: 102 },
      { flownOn: "2026-01-15", tachStart: 102, tachEnd: 103.5 },
      // Older than a year — outside the window.
      { flownOn: "2025-06-01", tachStart: 90, tachEnd: 99 },
    ];
    expect(hoursInLastYear(rows, now)).toBe(3.5);
  });
});
