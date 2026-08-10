import { describe, expect, it } from "vitest";
import {
  DEFAULT_WB_PROFILE_ID,
  allHeadroom,
  computeWeightBalance,
  cgLimitsAt,
  describeBlocker,
  describeProblem,
  envelopePolygon,
  profileFor,
  stationHeadroom,
  stationWeightLbs,
  withStationEmptied,
  type Loading,
  type WeightBalanceBasis,
} from "@/lib/weightBalance";

const profile = profileFor(DEFAULT_WB_PROFILE_ID)!;

/**
 * N8318B as it actually stands: the Weight/Balance & Equipment List Revision
 * of 27 Nov 2021 (Van Ness Enterprises), which supersedes the figures pencilled
 * into the back of the 1958 owner's manual.
 */
const N8318B: WeightBalanceBasis = {
  emptyWeightLbs: 1353.48,
  emptyMomentLbIn: 52406.81,
};

/** Nothing loaded — every station explicitly zero. */
const EMPTY: Loading = {
  pilot: 0,
  frontPassenger: 0,
  rearLeft: 0,
  rearRight: 0,
  baggage: 0,
  fuel: 0,
  oil: 0,
};

describe("profileFor", () => {
  it("finds the club's 1958 172", () => {
    expect(profile.maxGrossLbs).toBe(2200);
    expect(profile.forwardCgIn).toBe(35);
    expect(profile.aftCgIn).toBe(45.5);
  });

  // The one failure this file exists to prevent: another type's seats.
  it("refuses to guess for an aircraft with no profile", () => {
    expect(profileFor(null)).toBeNull();
    expect(profileFor("")).toBeNull();
    expect(profileFor("piper-cherokee")).toBeNull();
  });
});

describe("the profile's arms", () => {
  // Recovered from the POH's worked example (p.38). Each one divides out to a
  // round station, which is what says they were read off the graph correctly.
  it("matches the POH loading graph", () => {
    const arm = (id: string) => profile.stations.find((s) => s.id === id)!.arm;
    expect(arm("pilot")).toBe(36);
    expect(arm("frontPassenger")).toBe(36);
    expect(arm("rearLeft")).toBe(70);
    expect(arm("rearRight")).toBe(70);
    expect(arm("fuel")).toBe(48);
    expect(arm("baggage")).toBe(95);
    expect(arm("oil")).toBe(-20);
  });

  it("reproduces the POH example's moments", () => {
    // 340 lb of front seat → +12.2 thousand lb-in, and so on down the example.
    const moment = (id: string, amount: number) => {
      const s = profile.stations.find((x) => x.id === id)!;
      return (stationWeightLbs(s, amount) * s.arm) / 1000;
    };
    expect(moment("pilot", 340)).toBeCloseTo(12.2, 1);
    expect(moment("rearLeft", 290)).toBeCloseTo(20.3, 1);
    expect(moment("fuel", 37)).toBeCloseTo(10.7, 1);
    expect(moment("baggage", 43)).toBeCloseTo(4.1, 1);
    expect(moment("oil", 8)).toBeCloseTo(-0.3, 1);
  });

  it("converts gallons and quarts to pounds", () => {
    const fuel = profile.stations.find((s) => s.id === "fuel")!;
    const oil = profile.stations.find((s) => s.id === "oil")!;
    expect(stationWeightLbs(fuel, 37)).toBe(222); // 6 lb/gal
    expect(stationWeightLbs(oil, 8)).toBe(15); // 8 qt = 15 lb, per the POH
  });

  // Entering oil on top of a modern basic empty weight double-counts 15 lb at
  // the far forward end of the airplane, so the field starts empty and the
  // page explains when to fill it in.
  it("starts fuel full and oil empty", () => {
    const preset = (id: string) => profile.stations.find((s) => s.id === id)!.preset;
    expect(preset("fuel")).toBe(37);
    expect(preset("oil")).toBe(0);
  });

  it("ignores blank and negative entries rather than crediting them", () => {
    const pilot = profile.stations.find((s) => s.id === "pilot")!;
    expect(stationWeightLbs(pilot, Number.NaN)).toBe(0);
    expect(stationWeightLbs(pilot, -50)).toBe(0);
  });
});

describe("computeWeightBalance", () => {
  it("agrees with the airplane's own W&B revision on useful load", () => {
    // The sheet states 846.514 lb of useful load against a 1353.48 lb empty
    // weight — which is the same statement as "gross is 2200".
    const result = computeWeightBalance(profile, N8318B, EMPTY);
    expect(result.usefulLoadLbs).toBeCloseTo(846.51, 1);
    expect(result.emptyArmIn).toBeCloseTo(38.72, 2);
  });

  it("does the pilot's arithmetic for a typical two-up load", () => {
    const result = computeWeightBalance(profile, N8318B, {
      ...EMPTY,
      pilot: 170,
      frontPassenger: 150,
      baggage: 20,
      fuel: 37,
    });

    // 170+150 at 36, 20 at 95, 222 lb of fuel at 48.
    expect(result.loadedLbs).toBe(562);
    expect(result.totalWeightLbs).toBe(1915.48);
    expect(result.totalMomentLbIn).toBeCloseTo(76482.81, 2);
    expect(result.cgIn).toBeCloseTo(39.93, 2);
    expect(result.remainingLbs).toBeCloseTo(284.52, 2);
    expect(result.withinLimits).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("catches an over-gross load", () => {
    const result = computeWeightBalance(profile, N8318B, {
      ...EMPTY,
      pilot: 200,
      frontPassenger: 200,
      rearLeft: 180,
      rearRight: 180,
      fuel: 37,
    });
    expect(result.totalWeightLbs).toBeGreaterThan(profile.maxGrossLbs);
    expect(result.problems).toContainEqual({
      kind: "OVER_GROSS",
      overByLbs: expect.any(Number),
    });
    expect(result.remainingLbs).toBeLessThan(0);
    expect(describeProblem(result.problems[0])).toMatch(/Over gross weight by/);
  });

  it("catches a load that is legal on the scales but too far aft", () => {
    // Two big people in the back and nothing up front: under gross, out of
    // limits. This is the load a "does it weigh too much" check waves through.
    const result = computeWeightBalance(profile, N8318B, {
      ...EMPTY,
      pilot: 130,
      rearLeft: 200,
      rearRight: 200,
      baggage: 60,
      fuel: 37,
    });
    expect(result.totalWeightLbs).toBeLessThan(profile.maxGrossLbs);
    expect(result.cgIn!).toBeGreaterThan(profile.aftCgIn);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].kind).toBe("AFT_OF_LIMIT");
    expect(describeProblem(result.problems[0])).toMatch(/aft of the 45.5 in limit/);
  });

  it("catches a nose-heavy load", () => {
    // Unreachable on N8318B, whose empty CG is already 38.7 — so it's checked
    // against a hypothetical airframe rather than pretended away.
    const noseHeavy: WeightBalanceBasis = {
      emptyWeightLbs: 1300,
      emptyMomentLbIn: 1300 * 33,
    };
    const result = computeWeightBalance(profile, noseHeavy, EMPTY);
    expect(result.problems[0]).toEqual({
      kind: "FORWARD_OF_LIMIT",
      cgIn: 33,
      limitIn: 35,
    });
    expect(describeProblem(result.problems[0])).toMatch(/Move weight aft/);
  });

  it("flags a station over its own placard separately from gross", () => {
    const result = computeWeightBalance(profile, N8318B, {
      ...EMPTY,
      pilot: 170,
      baggage: 130, // 10 lb over the compartment's 120 lb placard
      fuel: 20,
    });
    expect(result.totalWeightLbs).toBeLessThan(profile.maxGrossLbs);
    const stationProblem = result.problems.find((p) => p.kind === "STATION_OVER");
    expect(stationProblem).toBeDefined();
    expect(describeProblem(stationProblem!)).toMatch(/Baggage is 10.0 lb over/);
  });

  it("counts every station even when the form left one blank", () => {
    const result = computeWeightBalance(profile, N8318B, { pilot: 180 });
    expect(result.lines).toHaveLength(profile.stations.length);
    expect(result.totalWeightLbs).toBe(1533.48);
  });
});

describe("withStationEmptied — the landing check", () => {
  // The tanks are at 48 in, aft of where a loaded 172's CG sits, so burning
  // fuel walks the CG forward. Takeoff and landing are different points.
  it("moves the CG forward as the fuel goes", () => {
    const loading: Loading = {
      ...EMPTY,
      pilot: 170,
      frontPassenger: 150,
      rearLeft: 120,
      fuel: 37,
    };
    const takeoff = computeWeightBalance(profile, N8318B, loading);
    const landing = computeWeightBalance(
      profile,
      N8318B,
      withStationEmptied(loading, "fuel")
    );

    expect(landing.totalWeightLbs).toBe(takeoff.totalWeightLbs - 222);
    expect(landing.cgIn!).toBeLessThan(takeoff.cgIn!);
    // ...and it must not leave the original loading mutated.
    expect(loading.fuel).toBe(37);
  });
});

describe("stationHeadroom", () => {
  const twoUp: Loading = {
    ...EMPTY,
    pilot: 170,
    frontPassenger: 150,
    baggage: 20,
    fuel: 37,
  };

  it("stops at the baggage compartment's own placard when that binds first", () => {
    const room = stationHeadroom(profile, N8318B, twoUp, "baggage")!;
    expect(room.maxAdditional).toBe(100); // 120 lb placard, 20 already aboard
    expect(room.blockedBy).toBe("station-max");
    expect(describeBlocker(room.blockedBy)).toBe("the station's own limit");
  });

  it("stops at gross weight for a front seat", () => {
    // The front seats are at 36 in, inside both limits, so nothing but gross
    // can ever stop them.
    const room = stationHeadroom(profile, N8318B, twoUp, "frontPassenger")!;
    expect(room.maxAdditional).toBeCloseTo(284.5, 1);
    expect(room.blockedBy).toBe("gross");
  });

  it("stops at the aft CG limit for the back seat when that binds first", () => {
    const aftHeavy: Loading = {
      ...EMPTY,
      pilot: 130,
      rearLeft: 200,
      fuel: 37,
    };
    const room = stationHeadroom(profile, N8318B, aftHeavy, "rearRight")!;
    expect(room.blockedBy).toBe("aft-cg");

    // The answer is a real limit, not a slogan: loading exactly that much
    // leaves the CG on the limit, and a pound more breaks it.
    const atLimit = computeWeightBalance(profile, N8318B, {
      ...aftHeavy,
      rearRight: room.maxAdditional,
    });
    expect(atLimit.cgIn!).toBeLessThanOrEqual(profile.aftCgIn);
    const overLimit = computeWeightBalance(profile, N8318B, {
      ...aftHeavy,
      rearRight: room.maxAdditional + 5,
    });
    expect(overLimit.withinLimits).toBe(false);
  });

  it("never offers room in an airplane that is already over its limits", () => {
    const overloaded: Loading = {
      ...EMPTY,
      pilot: 220,
      frontPassenger: 220,
      rearLeft: 200,
      rearRight: 200,
      baggage: 100,
      fuel: 37,
    };
    for (const room of allHeadroom(profile, N8318B, overloaded)) {
      expect(room.maxAdditional).toBe(0);
    }
  });

  it("has an answer for every station on the form", () => {
    expect(allHeadroom(profile, N8318B, twoUp)).toHaveLength(profile.stations.length);
    expect(stationHeadroom(profile, N8318B, twoUp, "nonexistent")).toBeNull();
  });
});

describe("envelopePolygon", () => {
  it("is the closed limit box the chart draws", () => {
    const points = envelopePolygon(profile);
    expect(points).toHaveLength(4);
    expect(Math.min(...points.map((p) => p.cgIn))).toBe(profile.forwardCgIn);
    expect(Math.max(...points.map((p) => p.cgIn))).toBe(profile.aftCgIn);
    expect(Math.max(...points.map((p) => p.weightLbs))).toBe(profile.maxGrossLbs);
  });

  // The forward limit is held at its strictest (gross-weight) value all the
  // way down, so the tool can only ever be conservative about a light,
  // nose-heavy load — never permissive.
  it("uses the same limits at every weight", () => {
    expect(cgLimitsAt(profile, 2200)).toEqual(cgLimitsAt(profile, 1500));
  });
});
