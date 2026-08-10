// Weight & balance: the airplane's loading stations as data, and the
// arithmetic a pilot does on the back of the checklist before every flight.
//
// TWO SOURCES, deliberately kept apart, because they change on completely
// different clocks:
//
//   • The PROFILE below is a fact about the TYPE — where the seats, tanks and
//     baggage floor sit relative to the datum, what the airplane may weigh,
//     and where its CG may be. Transcribed from N8318B's 1958 Cessna 172
//     Owner's Manual (Section IV "Weight and Balance" p.38, the loading graph
//     and CG envelope on p.37). It changes when the type's paperwork changes,
//     which is to say almost never — so it lives in code, next to the
//     checkouts, rather than in a table someone has to keep filled in.
//
//   • The BASIS — this airframe's empty weight and empty moment — lives on the
//     Aircraft row, because it changes every time an A&P signs a Weight/Balance
//     & Equipment List Revision. N8318B's current one is 27 Nov 2021 (Van Ness
//     Enterprises): 1353.48 lb at 38.72 in, useful load 846.51 lb. A radio
//     swap moves that number, and a club must not need a deploy to record it.
//
// Where the arms come from. The POH prints a loading GRAPH rather than a
// station table, so the arms below are recovered from the worked example on
// p.38, which is the same graph read off by its own author:
//
//   oil        15 lb  →  −0.3 (thousand lb-in)  →  −20 in   (8 qt = 15 lb)
//   front seats 340 lb →  +12.2                 →   36 in
//   fuel     37 gal/222 lb → +10.7              →   48 in   (6 lb/gal)
//   rear seats 290 lb  →  +20.3                 →   70 in
//   baggage     43 lb  →   +4.1                 →   95 in
//
// Every one of those divides out to a round station, which is the check that
// they were read correctly.
//
// Nothing here replaces the airplane's own paperwork: this is the same sum a
// pilot would do by hand, done faster and without a transposed digit. The page
// says so, and says what it was computed from.

/** What the pilot types into a station. */
export type LoadUnit = "lb" | "gal" | "qt";

export interface Station {
  id: string;
  label: string;
  /** Inches aft of the datum. Negative is forward of it (the oil tank). */
  arm: number;
  unit: LoadUnit;
  /** Pounds per unit — 1, 6 lb/gal of avgas, 1.875 lb/qt of oil. */
  lbPerUnit: number;
  /** Placard or tank limit, in the station's own unit. */
  max?: number;
  /** What the field starts at (a full tank is the common case). */
  preset?: number;
  /** Grouping header on the form, so four seats don't read as four stations. */
  group: string;
  /** The (i) popover: what this station is and why it matters. */
  why: string;
}

export interface WeightBalanceProfile {
  id: string;
  label: string;
  /** Where the numbers came from, shown on the page. */
  source: string;
  /** Normal-category gross weight. */
  maxGrossLbs: number;
  /** Forward and aft CG limits, in inches aft of datum. See cgLimitsAt(). */
  forwardCgIn: number;
  aftCgIn: number;
  /** The lightest weight the POH's envelope is drawn for — the chart's floor. */
  envelopeFloorLbs: number;
  stations: Station[];
  /** Anything a pilot should read once, shown under the result. */
  notes: string[];
}

const C172_1958: WeightBalanceProfile = {
  id: "c172-1958",
  label: "Cessna 172 (1958, Continental O-300-A)",
  source: "1958 Cessna 172 Owner's Manual, Section IV — loading graph and CG envelope (pp. 37–38)",
  maxGrossLbs: 2200,

  // The CG envelope is printed as a graph of weight against moment, with the
  // forward limit tapering forward at lighter weights. It is modelled here as
  // the limits at GROSS, held constant all the way down:
  //
  //   • the aft limit is constant on the real envelope anyway, and
  //   • holding the forward limit at its strictest value can only ever be
  //     conservative — the tool may call a very light, very nose-heavy load
  //     out of limits when the tapered envelope would still allow it, and can
  //     never do the reverse.
  //
  // Erring in that direction is the whole point. If the club wants the taper,
  // it belongs here as a weight → limits function, not as a looser constant.
  forwardCgIn: 35.0,
  aftCgIn: 45.5,
  envelopeFloorLbs: 1500,

  stations: [
    {
      id: "pilot",
      label: "Pilot",
      group: "Front seats",
      arm: 36,
      unit: "lb",
      lbPerUnit: 1,
      why: "You, dressed for the flight, with whatever is in your pockets and on your lap. The front seats are the one station nobody can leave out.",
    },
    {
      id: "frontPassenger",
      label: "Front passenger",
      group: "Front seats",
      arm: 36,
      unit: "lb",
      lbPerUnit: 1,
      why: "The right front seat, at the same station as the pilot's. An empty right seat is simply a zero here.",
    },
    {
      id: "rearLeft",
      label: "Rear left",
      group: "Rear seats",
      arm: 70,
      unit: "lb",
      lbPerUnit: 1,
      why: "The rear bench sits 34 inches behind the front seats, so a passenger back there moves the CG roughly twice as far as the same weight up front. It is usually the first station to run out of room.",
    },
    {
      id: "rearRight",
      label: "Rear right",
      group: "Rear seats",
      arm: 70,
      unit: "lb",
      lbPerUnit: 1,
      why: "Same station as the rear left seat — the POH treats the bench as one place, so which side someone sits on doesn't change the sum.",
    },
    {
      id: "baggage",
      label: "Baggage",
      group: "Baggage",
      arm: 95,
      unit: "lb",
      lbPerUnit: 1,
      max: 120,
      why: "The compartment behind the rear seat, and the furthest aft anything gets loaded. 120 lb is the placarded maximum; the CG limit often bites before that.",
    },
    {
      id: "fuel",
      label: "Fuel",
      group: "Fuel and oil",
      arm: 48,
      unit: "gal",
      lbPerUnit: 6,
      max: 37,
      preset: 37,
      why: "37 gallons usable, 18.5 a side, at 6 lb per gallon. The tanks are slightly aft of most loadings, so burning fuel walks the CG FORWARD — which is why this page checks where you land as well as where you take off.",
    },
    {
      id: "oil",
      label: "Engine oil",
      group: "Fuel and oil",
      arm: -20,
      unit: "qt",
      lbPerUnit: 1.875,
      max: 8,
      preset: 0,
      why: "Only fill this in if your empty weight is a LICENSED empty weight, which excludes oil — the POH's own example adds 8 qt (15 lb) separately. A modern basic empty weight, like the one on N8318B's 2021 revision, already includes full oil, and entering it again double-counts 15 lb at the far forward end of the airplane.",
    },
  ],

  notes: [
    "Normal category only. The utility category (aerobatic training manoeuvres) has a lower gross weight of 1950 lb and requires the rear seat and baggage compartment to be empty — this page does not compute it.",
    "The POH's stalling speeds, take-off and landing distances all assume 2200 lb. At anything less the airplane performs better than the chart; at anything more the chart no longer applies at all.",
  ],
};

export const WB_PROFILES: Record<string, WeightBalanceProfile> = {
  [C172_1958.id]: C172_1958,
};

/** The profile a club would pick for a new airplane of this club's type. */
export const DEFAULT_WB_PROFILE_ID = C172_1958.id;

/**
 * The profile an aircraft row names, or null.
 *
 * Null on purpose when the id is missing or unknown: an airplane with no
 * profile gets "no weight & balance data for this aircraft", never another
 * type's seats. A Piper silently loaded against a 172's arms is the one
 * failure mode this whole file exists to prevent.
 */
export function profileFor(id: string | null | undefined): WeightBalanceProfile | null {
  if (!id) return null;
  return WB_PROFILES[id] ?? null;
}

/** This airframe's empty weight and moment — from its latest W&B revision. */
export interface WeightBalanceBasis {
  emptyWeightLbs: number;
  emptyMomentLbIn: number;
}

/** How much of each station is aboard, in that station's own unit. */
export type Loading = Record<string, number>;

export interface StationLine {
  station: Station;
  /** What the pilot entered, in the station's unit. */
  amount: number;
  weightLbs: number;
  momentLbIn: number;
}

export type LimitProblem =
  | { kind: "OVER_GROSS"; overByLbs: number }
  | { kind: "FORWARD_OF_LIMIT"; cgIn: number; limitIn: number }
  | { kind: "AFT_OF_LIMIT"; cgIn: number; limitIn: number }
  | { kind: "STATION_OVER"; station: Station; overBy: number };

export interface WeightBalanceResult {
  lines: StationLine[];
  emptyWeightLbs: number;
  emptyMomentLbIn: number;
  emptyArmIn: number;
  totalWeightLbs: number;
  totalMomentLbIn: number;
  /** Null only when the airplane somehow weighs nothing. */
  cgIn: number | null;
  /** Everything that isn't the airframe: what you loaded. */
  loadedLbs: number;
  /** Gross minus empty — what the airplane can carry at all. */
  usefulLoadLbs: number;
  /** Useful load still unused. Negative means over gross. */
  remainingLbs: number;
  problems: LimitProblem[];
  withinLimits: boolean;
}

/** The CG limits at a given weight. A function so a tapered envelope is data. */
export function cgLimitsAt(
  profile: WeightBalanceProfile,
  _weightLbs: number
): { forwardIn: number; aftIn: number } {
  return { forwardIn: profile.forwardCgIn, aftIn: profile.aftCgIn };
}

/** Pounds aboard at one station, from what the pilot typed. */
export function stationWeightLbs(station: Station, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return round(amount * station.lbPerUnit, 2);
}

/**
 * The whole sum: every station, the totals, the CG, and what's wrong with it.
 *
 * Deliberately returns the LINES as well as the verdict. A pilot checking the
 * app against their own arithmetic needs to see the same table they'd write
 * out by hand, and a bare "within limits" is not something anyone should be
 * asked to take on faith.
 */
export function computeWeightBalance(
  profile: WeightBalanceProfile,
  basis: WeightBalanceBasis,
  loading: Loading
): WeightBalanceResult {
  const lines: StationLine[] = profile.stations.map((station) => {
    const amount = Number.isFinite(loading[station.id]) ? loading[station.id] : 0;
    const weightLbs = stationWeightLbs(station, amount);
    return {
      station,
      amount: amount > 0 ? amount : 0,
      weightLbs,
      momentLbIn: round(weightLbs * station.arm, 2),
    };
  });

  const loadedLbs = round(
    lines.reduce((sum, l) => sum + l.weightLbs, 0),
    2
  );
  const totalWeightLbs = round(basis.emptyWeightLbs + loadedLbs, 2);
  const totalMomentLbIn = round(
    lines.reduce((sum, l) => sum + l.momentLbIn, basis.emptyMomentLbIn),
    2
  );
  const cgIn = totalWeightLbs > 0 ? round(totalMomentLbIn / totalWeightLbs, 2) : null;

  const problems: LimitProblem[] = [];

  if (totalWeightLbs > profile.maxGrossLbs) {
    problems.push({
      kind: "OVER_GROSS",
      overByLbs: round(totalWeightLbs - profile.maxGrossLbs, 1),
    });
  }

  if (cgIn !== null) {
    const { forwardIn, aftIn } = cgLimitsAt(profile, totalWeightLbs);
    if (cgIn < forwardIn) {
      problems.push({ kind: "FORWARD_OF_LIMIT", cgIn, limitIn: forwardIn });
    } else if (cgIn > aftIn) {
      problems.push({ kind: "AFT_OF_LIMIT", cgIn, limitIn: aftIn });
    }
  }

  // A station over its own placard is a separate fault from being over gross:
  // 130 lb of baggage in a light airplane breaks the compartment's limit while
  // the totals still look fine.
  for (const line of lines) {
    if (line.station.max != null && line.amount > line.station.max) {
      problems.push({
        kind: "STATION_OVER",
        station: line.station,
        overBy: round(line.amount - line.station.max, 1),
      });
    }
  }

  return {
    lines,
    emptyWeightLbs: basis.emptyWeightLbs,
    emptyMomentLbIn: basis.emptyMomentLbIn,
    emptyArmIn:
      basis.emptyWeightLbs > 0
        ? round(basis.emptyMomentLbIn / basis.emptyWeightLbs, 2)
        : 0,
    totalWeightLbs,
    totalMomentLbIn,
    cgIn,
    loadedLbs,
    usefulLoadLbs: round(profile.maxGrossLbs - basis.emptyWeightLbs, 2),
    remainingLbs: round(profile.maxGrossLbs - totalWeightLbs, 2),
    problems,
    withinLimits: problems.length === 0,
  };
}

/**
 * The same airplane with a station emptied — the landing check.
 *
 * The tanks sit at 48 in, aft of where a normally-loaded 172's CG ends up, so
 * fuel burn walks the CG FORWARD in flight. A load that is legal at the pump
 * and out of limits on the last gallon is exactly the case a takeoff-only
 * calculator misses, so the page computes both ends.
 */
export function withStationEmptied(loading: Loading, stationId: string): Loading {
  return { ...loading, [stationId]: 0 };
}

export type Blocker = "gross" | "aft-cg" | "forward-cg" | "station-max";

export interface StationHeadroom {
  station: Station;
  /** How much MORE fits here, in the station's own unit. Never negative. */
  maxAdditional: number;
  /** Which limit stops it. Null when nothing more fits for several reasons. */
  blockedBy: Blocker;
}

/**
 * "How much more could I put in this seat?" — the question a pilot actually
 * asks, once they know the load is legal but not by how much.
 *
 * Adding w lb at arm a moves the CG toward a, so which limit bites depends on
 * where the station is relative to each one:
 *
 *   aft limit      M + a·w ≤ aft·(W + w)   binds only when a > aft
 *   forward limit  M + a·w ≥ fwd·(W + w)   binds only when a < fwd
 *   gross          W + w ≤ maxGross        always binds
 *
 * Baggage at 95 in is far aft of the 45.5 in aft limit, which is why the
 * compartment's real limit is almost always the CG rather than its placard.
 */
export function stationHeadroom(
  profile: WeightBalanceProfile,
  basis: WeightBalanceBasis,
  loading: Loading,
  stationId: string
): StationHeadroom | null {
  const station = profile.stations.find((s) => s.id === stationId);
  if (!station) return null;

  const current = computeWeightBalance(profile, basis, loading);
  const W = current.totalWeightLbs;
  const M = current.totalMomentLbIn;
  const { forwardIn, aftIn } = cgLimitsAt(profile, W);

  const bounds: { lbs: number; blockedBy: Blocker }[] = [
    { lbs: profile.maxGrossLbs - W, blockedBy: "gross" },
  ];

  if (station.arm > aftIn) {
    bounds.push({ lbs: (aftIn * W - M) / (station.arm - aftIn), blockedBy: "aft-cg" });
  }
  if (station.arm < forwardIn) {
    bounds.push({
      lbs: (M - forwardIn * W) / (forwardIn - station.arm),
      blockedBy: "forward-cg",
    });
  }

  const tightest = bounds.reduce((a, b) => (b.lbs < a.lbs ? b : a));
  let maxAdditional = Math.max(0, tightest.lbs) / station.lbPerUnit;
  let blockedBy = tightest.blockedBy;

  // A tank or a placarded compartment can't take more than it holds, however
  // much the CG would allow.
  if (station.max != null) {
    const already = Number.isFinite(loading[stationId]) ? loading[stationId] : 0;
    const spare = Math.max(0, station.max - Math.max(0, already));
    if (spare < maxAdditional) {
      maxAdditional = spare;
      blockedBy = "station-max";
    }
  }

  return { station, maxAdditional: round(maxAdditional, 1), blockedBy };
}

/** Every station's headroom, for the "room left" panel. */
export function allHeadroom(
  profile: WeightBalanceProfile,
  basis: WeightBalanceBasis,
  loading: Loading
): StationHeadroom[] {
  return profile.stations
    .map((s) => stationHeadroom(profile, basis, loading, s.id))
    .filter((h): h is StationHeadroom => h !== null);
}

/**
 * The envelope as a closed polygon in (CG, weight) space, for the chart.
 *
 * Plotted against CG rather than the POH's moment axis on purpose: the limits
 * are stated in inches, so a chart with inches along the bottom can be checked
 * against the printed numbers by eye. The POH's own graph trades that away for
 * the convenience of not dividing, which a computer doesn't need.
 */
export function envelopePolygon(
  profile: WeightBalanceProfile
): { cgIn: number; weightLbs: number }[] {
  const { forwardCgIn, aftCgIn, envelopeFloorLbs, maxGrossLbs } = profile;
  return [
    { cgIn: forwardCgIn, weightLbs: envelopeFloorLbs },
    { cgIn: forwardCgIn, weightLbs: maxGrossLbs },
    { cgIn: aftCgIn, weightLbs: maxGrossLbs },
    { cgIn: aftCgIn, weightLbs: envelopeFloorLbs },
  ];
}

/** One line of plain English per problem, for the verdict banner. */
export function describeProblem(problem: LimitProblem): string {
  switch (problem.kind) {
    case "OVER_GROSS":
      return `Over gross weight by ${formatQuantity(problem.overByLbs)} lb.`;
    case "FORWARD_OF_LIMIT":
      return `CG is ${problem.cgIn} in — forward of the ${problem.limitIn} in limit. Move weight aft.`;
    case "AFT_OF_LIMIT":
      return `CG is ${problem.cgIn} in — aft of the ${problem.limitIn} in limit. Move weight forward.`;
    case "STATION_OVER":
      return `${problem.station.label} is ${formatQuantity(problem.overBy)} ${
        problem.station.unit
      } over its ${problem.station.max} ${problem.station.unit} limit.`;
  }
}

/** Why a station won't take another pound. */
export function describeBlocker(blocker: Blocker): string {
  switch (blocker) {
    case "gross":
      return "gross weight";
    case "aft-cg":
      return "the aft CG limit";
    case "forward-cg":
      return "the forward CG limit";
    case "station-max":
      return "the station's own limit";
  }
}

/**
 * "1,353.5" — one decimal, which is all a scale (or a fuel gauge) is good for.
 * Unit-agnostic on purpose: the same figure is shown in pounds, gallons and
 * quarts depending on the station, and the caller supplies the unit.
 */
export function formatQuantity(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Moments are big and boring; the POH prints them in thousands. */
export function formatMoment(lbIn: number): string {
  return (lbIn / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Round to n decimals without the binary-float dust (0.1 + 0.2 problem). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
