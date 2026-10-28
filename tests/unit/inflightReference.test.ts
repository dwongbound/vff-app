import { describe, expect, it } from "vitest";
import { INFLIGHT_PHASES, manualSpeed } from "@/lib/inflightReference";

const phase = (id: string) => INFLIGHT_PHASES.find((p) => p.id === id)!;

describe("the in-flight reference", () => {
  it("is the club's five-line descent flow", () => {
    expect(phase("descent").items.map((i) => i.label)).toEqual([
      "ATIS",
      "Altimeter",
      "GUMPS",
      "Primer",
      "Seat belts",
    ]);
  });

  it("carries the manual's own climb speeds, in MPH with knots beside them", () => {
    const climb = Object.fromEntries(phase("climb").items.map((i) => [i.label, i.action]));
    // Off lib/pohReference.ts, not retyped: Vx 60, Vy 75, cruise climb 80–90.
    expect(climb["Vx — best angle"]).toBe("60 MPH · 52 kt");
    expect(climb["Vy — best rate"]).toBe("75 MPH · 65 kt");
    // A band converts inward, so the knots can only be narrower than the book.
    expect(climb["Cruise climb"]).toBe("80–90 MPH · 70–78 kt");
  });

  it("refuses a speed the manual doesn't have rather than inventing one", () => {
    expect(() => manualSpeed("no-such-speed")).toThrow();
  });
});
