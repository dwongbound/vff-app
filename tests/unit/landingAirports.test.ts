import { describe, expect, it } from "vitest";
import { landingAirportsError, parseLandingAirports } from "@/lib/landingAirports";

describe("parseLandingAirports", () => {
  it("turns a comma-separated line into codes, a count and a route", () => {
    const parsed = parseLandingAirports("KTOA, KSMO, KTOA");
    expect(parsed.codes).toEqual(["KTOA", "KSMO", "KTOA"]);
    expect(parsed.landings).toBe(3);
    expect(parsed.arrival).toBe("KTOA");
    expect(parsed.route).toBe("KTOA → KSMO → KTOA");
  });

  // The whole reason the count is entries rather than distinct fields.
  it("counts a repeated field every time it was landed at", () => {
    const pattern = parseLandingAirports("KTOA KTOA KTOA KTOA KTOA KTOA");
    expect(pattern.landings).toBe(6);
    expect(new Set(pattern.codes).size).toBe(1);
  });

  it("normalises case and takes whatever separator was typed", () => {
    for (const line of [
      "ktoa, ksmo",
      "ktoa ksmo",
      "KTOA->KSMO",
      "ktoa → ksmo",
      "KTOA / KSMO",
      "  ktoa ,, ksmo  ",
    ]) {
      expect(parseLandingAirports(line).codes, line).toEqual(["KTOA", "KSMO"]);
    }
  });

  // An entry with no landing recorded is a gap, not a zero-landing claim and
  // not an error — the same rule the missing tach start follows.
  it("treats an empty box as nothing recorded", () => {
    for (const line of ["", "   ", ",,"]) {
      const parsed = parseLandingAirports(line);
      expect(parsed.codes, JSON.stringify(line)).toEqual([]);
      expect(parsed.landings).toBe(0);
      expect(parsed.arrival).toBeNull();
      expect(parsed.route).toBeNull();
    }
  });

  it("keeps the last field as the arrival", () => {
    expect(parseLandingAirports("KTOA, KWHP, KSMO").arrival).toBe("KSMO");
  });

  it("accepts the identifier shapes small fields actually carry", () => {
    expect(parseLandingAirports("TOA, L35, 1C5, 9CL2").codes).toEqual([
      "TOA",
      "L35",
      "1C5",
      "9CL2",
    ]);
  });
});

describe("landingAirportsError", () => {
  it("passes anything that reads as an identifier", () => {
    expect(landingAirportsError("KTOA, KSMO, L35")).toBeNull();
    expect(landingAirportsError("")).toBeNull();
  });

  // Prose in the box would otherwise be logged as a landing somewhere that
  // isn't a place. Naming the offending token is the point.
  it("names the token it can't read", () => {
    const error = landingAirportsError("KTOA, practice area");
    expect(error).toMatch(/PRACTICE/);
    expect(landingAirportsError("KT")).toMatch(/"KT"/);
    expect(landingAirportsError("KTOARONNE")).toMatch(/KTOARONNE/);
  });
});
