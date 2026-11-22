import { describe, expect, it } from "vitest";
import {
  UNKNOWN_AIRPORT,
  landingReport,
  landingsOf,
  type LandingReportFlight,
} from "@/lib/landingReport";
import { landingReportSheet } from "@/lib/exports";
import { landingAirportsFromBody } from "@/lib/landingAirports";

function flight(over: Partial<LandingReportFlight> = {}): LandingReportFlight {
  return {
    flownOn: new Date(2026, 9, 12, 12),
    landings: 1,
    landingAirports: [],
    arrival: null,
    homeBase: "KTOA",
    landingFeeCents: null,
    ...over,
  };
}

describe("landingsOf", () => {
  it("counts every listed landing, repeats included, none assumed", () => {
    expect(landingsOf(flight({ landings: 3, landingAirports: ["KTOA", "KSMO", "KTOA"] }))).toEqual([
      { airport: "KTOA", assumed: false },
      { airport: "KSMO", assumed: false },
      { airport: "KTOA", assumed: false },
    ]);
  });

  it("puts an unlisted entry's landings at its arrival, flagged assumed", () => {
    expect(landingsOf(flight({ landings: 2, arrival: "kcma" }))).toEqual([
      { airport: "KCMA", assumed: true },
      { airport: "KCMA", assumed: true },
    ]);
  });

  it("falls back to the home base, then to 'Not recorded'", () => {
    expect(landingsOf(flight({ landings: 1 }))[0].airport).toBe("KTOA");
    expect(landingsOf(flight({ landings: 1, homeBase: null }))[0].airport).toBe(UNKNOWN_AIRPORT);
  });

  it("gives a zero-landing flight nothing", () => {
    expect(landingsOf(flight({ landings: 0 }))).toEqual([]);
  });
});

describe("landingReport", () => {
  const october = (day: number) => new Date(2026, 9, day, 12);
  const november = (day: number) => new Date(2026, 10, day, 12);

  const report = landingReport([
    flight({ flownOn: october(3), landings: 3, landingAirports: ["KTOA", "KSMO", "KTOA"], landingFeeCents: 600 }),
    flight({ flownOn: october(10), landings: 6, landingAirports: Array(6).fill("KTOA") }),
    flight({ flownOn: october(20), landings: 2, arrival: "KTOA" }),
    flight({ flownOn: november(1), landings: 1, landingAirports: ["KCMA"] }),
  ]);

  it("lists months newest first", () => {
    expect(report.map((m) => m.period)).toEqual(["2026-11", "2026-10"]);
  });

  it("adds a month up by airport, busiest first", () => {
    const oct = report[1];
    expect(oct.airports.map((a) => a.airport)).toEqual(["KTOA", "KSMO"]);
    expect(oct.airports[0]).toEqual({
      airport: "KTOA",
      landings: 10,
      assumed: 2,
      flights: 3,
      feeCents: 600,
    });
    expect(oct.airports[1]).toMatchObject({ landings: 1, assumed: 0, flights: 1, feeCents: 0 });
  });

  it("counts a flight once in the month's total even when it visited two fields", () => {
    expect(report[1]).toMatchObject({ landings: 11, assumed: 2, flights: 3, feeCents: 600 });
  });

  it("charges a fee to the field the flight ended at", () => {
    const [nov] = landingReport([
      flight({ flownOn: november(2), landings: 2, landingAirports: ["KSMO", "KCMA"], landingFeeCents: 1500 }),
    ]);
    expect(nov.airports.find((a) => a.airport === "KCMA")?.feeCents).toBe(1500);
    expect(nov.airports.find((a) => a.airport === "KSMO")?.feeCents).toBe(0);
  });

  it("keeps 'Not recorded' last whatever its count", () => {
    const [month] = landingReport([
      flight({ landings: 5, homeBase: null }),
      flight({ landings: 1, landingAirports: ["KTOA"] }),
    ]);
    expect(month.airports.map((a) => a.airport)).toEqual(["KTOA", UNKNOWN_AIRPORT]);
  });

  it("is empty with no flights", () => {
    expect(landingReport([])).toEqual([]);
  });
});

describe("landingReportSheet", () => {
  it("writes one row per month and airport, oldest month first, fees in dollars", () => {
    const sheet = landingReportSheet(
      landingReport([
        flight({ flownOn: new Date(2026, 10, 1, 12), landingAirports: ["KCMA"] }),
        flight({ flownOn: new Date(2026, 9, 3, 12), landings: 2, landingAirports: ["KTOA", "KTOA"], landingFeeCents: 600 }),
      ])
    );
    expect(sheet.rows[0]).toEqual([
      "Month",
      "Airport",
      "Landings",
      "Assumed",
      "Flights",
      "Landing fees recorded",
    ]);
    expect(sheet.rows.slice(1)).toEqual([
      ["October 2026", "KTOA", 2, 0, 1, 6],
      ["November 2026", "KCMA", 1, 0, 1, 0],
    ]);
  });
});

describe("landingAirportsFromBody", () => {
  it("takes a list or a line, and stores them the same way", () => {
    expect(landingAirportsFromBody(["ktoa", "KSMO"])).toEqual({ codes: ["KTOA", "KSMO"] });
    expect(landingAirportsFromBody("ktoa → ksmo")).toEqual({ codes: ["KTOA", "KSMO"] });
  });

  it("reads nothing as an empty list", () => {
    expect(landingAirportsFromBody(undefined)).toEqual({ codes: [] });
    expect(landingAirportsFromBody(null)).toEqual({ codes: [] });
    expect(landingAirportsFromBody([])).toEqual({ codes: [] });
  });

  it("refuses a token that isn't an airport, naming it", () => {
    const result = landingAirportsFromBody(["KTOA", "practice area"]);
    expect("error" in result && result.error).toMatch(/PRACTICE/);
    expect("error" in landingAirportsFromBody([1, 2])).toBe(true);
  });
});
