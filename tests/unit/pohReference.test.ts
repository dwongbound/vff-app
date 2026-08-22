import { describe, expect, it } from "vitest";
import { DEFAULT_WB_PROFILE_ID, profileFor } from "@/lib/weightBalance";
import {
  AIRSPEED_UNIT,
  BANK_ANGLES,
  CLIMB_RATES,
  DISTANCES,
  FROM_ELSEWHERE,
  MANUAL_AIRSPEED_UNIT,
  REFERENCE_SECTIONS,
  STALL_SPEEDS,
  displaySpeed,
  knots,
  knotsRange,
  pohReferenceFor,
  stallKnots,
} from "@/lib/pohReference";

const reference = pohReferenceFor(DEFAULT_WB_PROFILE_ID)!;
const figures = REFERENCE_SECTIONS.flatMap((s) => s.figures);
const speeds = figures.filter((f) => f.mph != null);

describe("which airframes have a manual", () => {
  it("answers for the type the club flies", () => {
    expect(reference).not.toBeNull();
    expect(reference.type).toMatch(/Cessna 172/);
  });

  // The whole point of the null: another type's stall speed under this
  // airplane's tail number is worse than no page. Same rule as profileFor.
  it("refuses an unknown or missing profile rather than guessing", () => {
    expect(pohReferenceFor("piper-cherokee")).toBeNull();
    expect(pohReferenceFor(null)).toBeNull();
    expect(pohReferenceFor(undefined)).toBeNull();
    expect(pohReferenceFor("")).toBeNull();
  });

  // The two files are keyed together on purpose (see pohReference.ts). If one
  // ever gains a profile the other lacks, the page would show one airplane's
  // stations beside another's speeds — so pin the pairing.
  it("is keyed to the same profile the weight & balance tool uses", () => {
    expect(profileFor(reference.profileId)).not.toBeNull();
  });
});

// ── The conversion, which is the load-bearing arithmetic in this file ───────
//
// The manual is MPH; the airplane's instrument is knots. Getting the DIRECTION
// of the rounding wrong is the way this file could hurt somebody, so it is
// pinned harder than anything else here.
describe("MPH → knots", () => {
  it("rounds a ceiling DOWN, so a limit is never published above the book's", () => {
    expect(knots(160, "ceiling")).toBe(139); // Vne: 139.03 exact
    expect(knots(140, "ceiling")).toBe(121); // Vno: 121.66 exact
    expect(knots(100, "ceiling")).toBe(86); //  Vfe: 86.90 exact
  });

  it("rounds a floor UP, so a stall or approach speed is never published below it", () => {
    expect(knots(58, "floor")).toBe(51); // 50.40 exact
    expect(knots(52, "floor")).toBe(46); // 45.19 exact
    expect(knots(60, "floor")).toBe(53); // 52.14 exact
  });

  it("rounds a target to nearest — there is no safe side to a best-rate speed", () => {
    expect(knots(75, "target")).toBe(65);
    expect(knots(60, "target")).toBe(52);
  });

  // A converted band must never come out WIDER than the book's, which means
  // its bottom is a floor and its top a ceiling.
  it("narrows a range from both ends", () => {
    expect(knotsRange([59, 140])).toEqual([52, 121]);
    expect(knotsRange([55, 100])).toEqual([48, 86]);
  });

  it("never converts a ceiling upward or a floor downward, at any figure", () => {
    for (let mph = 40; mph <= 200; mph++) {
      const exact = mph / 1.15078;
      expect(knots(mph, "ceiling")).toBeLessThanOrEqual(exact);
      expect(knots(mph, "floor")).toBeGreaterThanOrEqual(exact);
    }
  });
});

describe("every figure can be checked and understood", () => {
  it("cites a source and explains itself", () => {
    for (const figure of figures) {
      expect(figure.why.length, `${figure.id} why`).toBeGreaterThan(40);
      expect(figure.source, `${figure.id} source`).toBeTruthy();
    }
  });

  // A figure is either an airspeed (converted) or a plain value (RPM, psi).
  // One or the other, never neither and never both — "both" would mean the
  // rendered number and the converted one could disagree.
  it("carries exactly one of an airspeed or a written value", () => {
    for (const figure of figures) {
      const hasSpeed = figure.mph != null;
      const hasValue = figure.value != null;
      expect(hasSpeed !== hasValue, `${figure.id}`).toBe(true);
      if (hasSpeed) expect(figure.kind, `${figure.id} kind`).toBeTruthy();
    }
  });

  it("has no duplicate ids across sections", () => {
    const ids = figures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sectionIds = REFERENCE_SECTIONS.map((s) => s.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  // Both units on every speed, always: knots because that is the instrument,
  // MPH because that is the book you check it against.
  it("shows knots and the manual's MPH for every airspeed", () => {
    expect(AIRSPEED_UNIT).toBe("kt");
    expect(MANUAL_AIRSPEED_UNIT).toBe("MPH");
    expect(speeds.length).toBeGreaterThan(10);
    for (const figure of speeds) {
      const shown = displaySpeed(figure);
      expect(shown.primary, `${figure.id} knots`).toMatch(/\d+.*kt$/);
      expect(shown.manual, `${figure.id} mph`).toMatch(/\d+ MPH$/);
    }
  });

  it("leaves a non-speed figure with no MPH line to disagree with", () => {
    const rpm = figures.find((f) => f.id === "rpm-max")!;
    expect(displaySpeed(rpm)).toEqual({ primary: "2700 RPM", manual: null });
  });

  it("keeps the speeds a pilot must not be missing", () => {
    for (const code of ["Vne", "Vno", "Vfe", "Vx", "Vy"]) {
      expect(figures.some((f) => f.code === code), code).toBe(true);
    }
  });
});

describe("the stall table", () => {
  it("gives a speed for every bank angle in every configuration", () => {
    for (const row of STALL_SPEEDS) {
      expect(row.mph, row.flaps).toHaveLength(BANK_ANGLES.length);
      expect(stallKnots(row), row.flaps).toHaveLength(BANK_ANGLES.length);
    }
  });

  // The reason the table is a matrix rather than a list of figures: the bank
  // axis is the lesson. 58 MPH clean and level is 82 in a 60° turn.
  it("rises with bank in every configuration", () => {
    for (const row of STALL_SPEEDS) {
      for (let i = 1; i < row.mph.length; i++) {
        expect(row.mph[i], `${row.flaps} at ${BANK_ANGLES[i]}°`).toBeGreaterThan(
          row.mph[i - 1]
        );
      }
    }
  });

  it("falls as flaps come out, at every bank angle", () => {
    const [clean, ten, forty] = STALL_SPEEDS.map((r) => r.mph);
    for (let i = 0; i < BANK_ANGLES.length; i++) {
      expect(ten[i]).toBeLessThan(clean[i]);
      expect(forty[i]).toBeLessThan(ten[i]);
    }
  });

  // The one conversion that could hurt somebody. A stall speed rounded DOWN
  // tells a pilot the airplane flies slower than it does.
  it("never converts a stall speed downward", () => {
    for (const row of STALL_SPEEDS) {
      const kt = stallKnots(row);
      row.mph.forEach((mph, i) => {
        expect(kt[i], `${row.flaps} ${mph} MPH`).toBeGreaterThanOrEqual(mph / 1.15078);
      });
    }
    expect(stallKnots(STALL_SPEEDS[0])).toEqual([51, 53, 58, 72]);
    expect(stallKnots(STALL_SPEEDS[2])).toEqual([46, 47, 52, 64]);
  });

  // The arcs on the dial and the table under them should describe one
  // airplane: the green arc starts at the clean stall, the white at the
  // full-flap one. The book is a little loose about it, so what's pinned is
  // that both arcs err the SAFE way — above the stall they correspond to.
  it("has arcs that sit at or just above the stalls they correspond to", () => {
    const arc = (id: string) => figures.find((f) => f.id === id)!.mph as [number, number];
    expect(arc("green-arc")[0]).toBeGreaterThanOrEqual(STALL_SPEEDS[0].mph[0]);
    expect(arc("green-arc")[0] - STALL_SPEEDS[0].mph[0]).toBeLessThanOrEqual(3);
    expect(arc("white-arc")[0]).toBeGreaterThanOrEqual(STALL_SPEEDS[2].mph[0]);
    expect(arc("white-arc")[0] - STALL_SPEEDS[2].mph[0]).toBeLessThanOrEqual(3);
  });
});

describe("the climb table", () => {
  it("climbs worse and slower the higher it gets", () => {
    for (let i = 1; i < CLIMB_RATES.length; i++) {
      expect(CLIMB_RATES[i].feetPerMinute).toBeLessThan(CLIMB_RATES[i - 1].feetPerMinute);
      expect(CLIMB_RATES[i].bestRateMph).toBeLessThan(CLIMB_RATES[i - 1].bestRateMph);
    }
  });

  it("starts at the sea-level Vy the airspeed section publishes", () => {
    const vy = figures.find((f) => f.code === "Vy")!;
    expect(CLIMB_RATES[0].bestRateMph).toBe(vy.mph);
    expect(CLIMB_RATES[0].feetPerMinute).toBe(660);
  });

  it("burns more fuel to reach each higher level", () => {
    for (let i = 1; i < CLIMB_RATES.length; i++) {
      expect(CLIMB_RATES[i].fuelUsedGal!).toBeGreaterThan(CLIMB_RATES[i - 1].fuelUsedGal!);
    }
  });
});

describe("figures the 1958 manual doesn't print", () => {
  it("covers the three a modern POH would have", () => {
    expect(FROM_ELSEWHERE.map((f) => f.id).sort()).toEqual(["descent", "glide", "va"]);
  });

  // The labelling is the load-bearing part. A reader must never be able to
  // mistake one of these for something out of N8318B's own book, so each one
  // has to say what the manual gives instead, where the number came from, and
  // why it can't just be adopted.
  it("says where each number came from and why it can't simply be adopted", () => {
    for (const gap of FROM_ELSEWHERE) {
      expect(gap.instead.length, `${gap.id} instead`).toBeGreaterThan(40);
      expect(gap.found.length, `${gap.id} found`).toBeGreaterThan(40);
      expect(gap.caution.length, `${gap.id} caution`).toBeGreaterThan(40);
      expect(gap.value, `${gap.id} value`).toBeTruthy();
    }
  });

  it("names a different airframe or a non-Cessna source for every borrowed figure", () => {
    for (const gap of FROM_ELSEWHERE) {
      expect(gap.found, `${gap.id}`).toMatch(/170B|1974|FAA|general-aviation/);
    }
  });

  // Va in particular: a figure presented as this airplane's own would be
  // believed, and it is the one number here that is not.
  it("still publishes no Va among the manual's own figures", () => {
    expect(figures.some((f) => f.code === "Va")).toBe(false);
    expect(FROM_ELSEWHERE.find((f) => f.id === "va")!.code).toBe("Va");
  });
});

describe("the distance table", () => {
  it("gets longer with altitude in every column", () => {
    for (let i = 1; i < DISTANCES.length; i++) {
      const prev = DISTANCES[i - 1];
      const row = DISTANCES[i];
      expect(row.takeoffGroundRun, row.altitude).toBeGreaterThan(prev.takeoffGroundRun);
      expect(row.takeoffOver50, row.altitude).toBeGreaterThan(prev.takeoffOver50);
      expect(row.landingGroundRoll, row.altitude).toBeGreaterThan(prev.landingGroundRoll);
      expect(row.landingOver50, row.altitude).toBeGreaterThan(prev.landingOver50);
    }
  });

  it("clears 50 ft in more room than it needs to stop rolling", () => {
    for (const row of DISTANCES) {
      expect(row.takeoffOver50).toBeGreaterThan(row.takeoffGroundRun);
      expect(row.landingOver50).toBeGreaterThan(row.landingGroundRoll);
    }
  });
});
