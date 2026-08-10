import { describe, expect, it } from "vitest";
import {
  flightCostCents,
  formatCents,
  formatHours,
  hobbsHours,
  inRange,
  tachHours,
  totalLandings,
  totalTachHours,
  validateMeters,
  monthlyTachHours,
} from "@/lib/hours";

describe("tachHours / hobbsHours", () => {
  it("subtracts without float dust", () => {
    // 4821.6 - 4819.4 is 2.1999999999998 in binary floating point.
    expect(tachHours({ tachStart: 4819.4, tachEnd: 4821.6 })).toBe(2.2);
  });

  it("returns null when the airplane has no Hobbs entry", () => {
    expect(hobbsHours({ hobbsStart: null, hobbsEnd: null })).toBeNull();
    expect(hobbsHours({ hobbsStart: 100, hobbsEnd: null })).toBeNull();
  });
});

describe("validateMeters", () => {
  const good = { tachStart: 100, tachEnd: 102, hobbsStart: 200, hobbsEnd: 202.4 };

  it("accepts a normal entry", () => {
    expect(validateMeters(good)).toBeNull();
  });

  it("rejects a tach that runs backwards", () => {
    expect(validateMeters({ ...good, tachEnd: 99 })).toMatch(/lower than tach start/);
  });

  it("rejects a zero-length flight", () => {
    expect(validateMeters({ ...good, tachEnd: 100 })).toMatch(/no flight time/);
  });

  it("rejects an implausible 20-hour tach entry", () => {
    expect(validateMeters({ ...good, tachEnd: 120 })).toMatch(/typo/);
  });

  it("insists on both Hobbs readings or neither", () => {
    expect(validateMeters({ ...good, hobbsEnd: null })).toMatch(/both Hobbs/);
    expect(
      validateMeters({ tachStart: 100, tachEnd: 102, hobbsStart: null, hobbsEnd: null })
    ).toBeNull();
  });

  // The mis-read catcher: Hobbs counts wall-clock time including taxi, so it
  // is essentially always at least tach time.
  it("flags Hobbs time well below tach time", () => {
    expect(
      validateMeters({ tachStart: 100, tachEnd: 102, hobbsStart: 200, hobbsEnd: 201 })
    ).toMatch(/double-check both meters/);
  });

  it("tolerates a tach that runs slightly fast at cruise", () => {
    expect(
      validateMeters({ tachStart: 100, tachEnd: 102, hobbsStart: 200, hobbsEnd: 201.9 })
    ).toBeNull();
  });
});

describe("totals", () => {
  const flights = [
    { tachStart: 100, tachEnd: 101.4, landings: 3, fuelAddedGal: 12.2, flownOn: "2026-08-02" },
    { tachStart: 101.4, tachEnd: 103.1, landings: 1, fuelAddedGal: 9.9, flownOn: "2026-08-20" },
    { tachStart: 103.1, tachEnd: 104.0, landings: 2, fuelAddedGal: null, flownOn: "2026-09-04" },
  ];

  it("adds tach hours to one decimal", () => {
    expect(totalTachHours(flights)).toBe(4);
  });

  it("adds landings", () => {
    expect(totalLandings(flights)).toBe(6);
  });

  it("filters to a date window, end-exclusive", () => {
    const august = inRange(
      flights,
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-09-01T00:00:00Z")
    );
    expect(august).toHaveLength(2);
  });
});

describe("cost", () => {
  it("bills tach time at the aircraft's rate", () => {
    expect(
      flightCostCents({ tachStart: 100, tachEnd: 102 }, 16_500)
    ).toBe(33_000);
  });

  it("returns null when the airplane has no rate set", () => {
    expect(flightCostCents({ tachStart: 100, tachEnd: 102 }, null)).toBeNull();
  });

  it("formats for humans", () => {
    expect(formatCents(33_000)).toBe("$330.00");
    expect(formatHours(2)).toBe("2.0");
  });
});

// The Plane Status utilisation chart. Buckets are LOCAL calendar months and
// empty ones are kept — a quiet month is the most interesting thing the chart
// has to say, and dropping it would redraw a gap as continuous flying.
describe("monthlyTachHours", () => {
  const at = (iso: string, hours: number) => ({
    flownOn: iso,
    tachStart: 100,
    tachEnd: 100 + hours,
  });
  // Mid-month so no timezone offset can push the fixture into a neighbour.
  const now = new Date(2026, 7, 15); // 15 Aug 2026

  it("returns one bucket per month, oldest first, including the current one", () => {
    const months = monthlyTachHours([], 6, now);
    expect(months).toHaveLength(6);
    expect(months.map((m) => m.month.getMonth())).toEqual([2, 3, 4, 5, 6, 7]);
    expect(months[5].label).toBe(
      new Date(2026, 7, 1).toLocaleDateString(undefined, { month: "short" })
    );
  });

  it("keeps empty months as zeroes rather than skipping them", () => {
    const months = monthlyTachHours([at("2026-08-10T12:00:00", 2)], 3, now);
    expect(months.map((m) => m.hours)).toEqual([0, 0, 2]);
  });

  it("sums every flight that lands in the same bucket", () => {
    const months = monthlyTachHours(
      [at("2026-08-02T12:00:00", 1.5), at("2026-08-20T12:00:00", 2.25)],
      2,
      now
    );
    expect(months[1].hours).toBe(3.8); // rounded to one decimal
  });

  it("ignores flights outside the window instead of folding them into an edge", () => {
    const months = monthlyTachHours(
      [at("2020-01-01T12:00:00", 99), at("2030-01-01T12:00:00", 99)],
      3,
      now
    );
    expect(months.every((m) => m.hours === 0)).toBe(true);
  });

  it("survives a flight with no or an unparseable date", () => {
    const months = monthlyTachHours(
      [
        { tachStart: 1, tachEnd: 2 },
        { flownOn: "not-a-date", tachStart: 1, tachEnd: 2 },
      ],
      2,
      now
    );
    expect(months.every((m) => m.hours === 0)).toBe(true);
  });
});
