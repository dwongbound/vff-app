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
