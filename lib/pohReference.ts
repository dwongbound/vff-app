// N8318B's numbers — the speeds, arcs and limits a pilot has to have in their
// head, transcribed from the airplane's own book and converted to the unit on
// its own instrument.
//
// SOURCE, and why that matters more here than anywhere else in the app: the
// 1958 Cessna 172 Owner's Manual for this airframe, page numbers cited on
// every entry. It is a 1958 manual, which is to say it predates most of the
// vocabulary a pilot trained today will reach for — there is no "Vx" or "Vy"
// printed anywhere in it, only "best angle of climb speed" and "best rate of
// climb". The V-codes below are this file's LABELS for what the manual
// describes, not quotations of it, which is exactly why `source` names the
// page: anybody can go and check the reading.
//
// ── THE UNIT PROBLEM, which is the central fact about this file ────────────
//
// The manual is in MPH throughout, as a 1958 manual is. N8318B's airspeed
// indicator reads in KNOTS — the instrument has been changed at some point in
// sixty-eight years, as most of them have. So every airspeed here exists
// twice: the manual's own MPH figure, which is the authority and is what you
// check the book against, and the knots conversion, which is what you fly.
//
// Both are shown, always, and the conversion is COMPUTED (`knots()` below)
// rather than typed in — a hand-converted table is a table with one transposed
// digit in it, and the one that gets flown.
//
// The rounding is not "nearest". It rounds the way the number is used:
//
//   • a CEILING rounds DOWN, so this file can never publish a limit above the
//     one the book set (139 kt, not 140, for a 160 MPH Vne);
//   • a FLOOR — a stall speed, an approach speed — rounds UP, so it can never
//     publish one below the book's;
//   • a RANGE rounds inward from both ends, narrowing the band rather than
//     widening it;
//   • a TARGET with no safety direction (Vx, Vy) rounds to nearest, because
//     there isn't a conservative side to a best-rate-of-climb speed.
//
// Every one of those errs toward the airplane's limits and away from the edge.
//
// ── THE OTHER RULE: nothing is invented ────────────────────────────────────
//
// Where the manual doesn't publish a figure — and it publishes no manoeuvring
// speed, no best glide and no descent rate, all of which a modern POH would —
// the gap is DATA (`FROM_ELSEWHERE` below) rather than a hole quietly filled
// in. Those entries carry figures found ONLINE for related airframes, and they
// say so in as many words, on the card, every time. They are a starting point
// for a conversation with an instructor, not numbers this club has adopted.
//
// This is reference, like lib/inflightReference.ts and unlike lib/checkouts.ts:
// nothing here is tickable and nothing blocks a sign-off. It is the page you
// read the night before, and the one you check when somebody in the clubhouse
// says "what's the flap speed again".
//
// None of it replaces the airplane's own paperwork. The manual in the cabin is
// the authority; this is a faster index into it.

/** Where a figure came from, so any of it can be checked in a minute. */
const MANUAL = "1958 Cessna 172 Owner's Manual";

/** What the instrument in N8318B reads, and so what this page leads with. */
export const AIRSPEED_UNIT = "kt";
/** What the manual was written in, and so what every figure is checked against. */
export const MANUAL_AIRSPEED_UNIT = "MPH";

/** Statute miles per hour in one knot. */
const MPH_PER_KNOT = 1.15078;

/**
 * Which way a converted speed is allowed to be wrong.
 *
 * See the unit note at the top: the direction is a safety property, not a
 * formatting preference. `ceiling` is a speed you must stay below, `floor` one
 * you must stay above, `target` one with no dangerous side.
 */
export type SpeedKind = "ceiling" | "floor" | "target";

/** One MPH figure or an MPH band, as the manual prints it. */
export type Mph = number | [number, number];

/** MPH → knots, rounded the way this kind of speed has to be rounded. */
export function knots(mph: number, kind: SpeedKind): number {
  const exact = mph / MPH_PER_KNOT;
  if (kind === "ceiling") return Math.floor(exact);
  if (kind === "floor") return Math.ceil(exact);
  return Math.round(exact);
}

/**
 * A band converts INWARD — its bottom is a floor and its top a ceiling — so a
 * range can only ever come out narrower than the book's, never wider.
 */
export function knotsRange(mph: [number, number]): [number, number] {
  return [knots(mph[0], "floor"), knots(mph[1], "ceiling")];
}

/** "139 kt" / "52–121 kt", in the unit on the airplane's own dial. */
export function formatKnots(mph: Mph, kind: SpeedKind): string {
  if (Array.isArray(mph)) {
    const [low, high] = knotsRange(mph);
    return `${low}–${high} ${AIRSPEED_UNIT}`;
  }
  return `${knots(mph, kind)} ${AIRSPEED_UNIT}`;
}

/** "160 MPH" / "59–140 MPH", the manual's own figure, for checking the book. */
export function formatMph(mph: Mph): string {
  const body = Array.isArray(mph) ? `${mph[0]}–${mph[1]}` : String(mph);
  return `${body} ${MANUAL_AIRSPEED_UNIT}`;
}

/**
 * One reference figure: what it is, what it reads, and why a pilot cares.
 *
 * A figure carries EITHER `mph` (an airspeed, converted and shown both ways)
 * or `value` (everything that isn't a speed — RPM, psi, gallons, pounds).
 *
 * `why` is the (i) popover, and it is not optional — a number with no
 * explanation is a number that gets flown without being understood, and the
 * whole reason this page exists rather than a photograph of the placard is
 * that the placard can't tell you what it's for.
 */
export interface ReferenceFigure {
  id: string;
  /** The V-code where one applies — this file's label, not the manual's. */
  code?: string;
  label: string;
  /** An airspeed, in the manual's MPH. Converted to knots for display. */
  mph?: Mph;
  /** Which way the conversion must round. Required alongside `mph`. */
  kind?: SpeedKind;
  /** A figure that isn't an airspeed, written out with its own unit. */
  value?: string;
  /** The conditions it's true under. A speed without these is half a fact. */
  condition?: string;
  /** The (i): what this is and why it matters. */
  why: string;
  /** Page in the manual, so the reading can be checked. */
  source: string;
  /**
   * How hard the number bites. `limit` is a red line you may not cross,
   * `caution` is a yellow-arc / conditional figure. Drives the colour, and red
   * is reserved for the first kind.
   */
  severity?: "limit" | "caution";
}

export interface ReferenceSection {
  id: string;
  title: string;
  /** One line on what this section is for, above the list. */
  blurb: string;
  figures: ReferenceFigure[];
}

/** The knots figure and the manual's MPH, for anything that renders a speed. */
export function displaySpeed(figure: ReferenceFigure): {
  primary: string;
  manual: string | null;
} {
  if (figure.mph == null) {
    return { primary: figure.value ?? "", manual: null };
  }
  return {
    primary: formatKnots(figure.mph, figure.kind ?? "target"),
    manual: formatMph(figure.mph),
  };
}

// ── Airspeed indicator ──────────────────────────────────────────────────────
// Section IV, "Airspeed Limitations" (p.36). These four numbers ARE the
// coloured arcs, which is why they lead: a pilot who knows where the arcs start
// and stop knows most of the airplane's speed envelope without looking anything
// up. NOTE the arcs are painted in the dial's own unit; if the instrument was
// re-marked when it was changed to knots, the paint should agree with the
// left-hand column here, and a disagreement is worth a squawk.

const AIRSPEEDS: ReferenceSection = {
  id: "airspeeds",
  title: "Airspeed limits & arcs",
  blurb:
    "The four numbers that define the dial. Knots to match the instrument; the manual's own MPH beside each one.",
  figures: [
    {
      id: "vne",
      code: "Vne",
      label: "Never exceed",
      mph: 160,
      kind: "ceiling",
      condition: "Red line — glide or dive, smooth air only",
      why:
        "The structural limit. Above it the airplane can be damaged or destroyed by control inputs or turbulence, and the margin the designers left has run out. The manual reaches this speed only in a glide or a dive in SMOOTH air; in anything rough it is not a speed to be near.",
      source: `${MANUAL} p.36`,
      severity: "limit",
    },
    {
      id: "vno",
      code: "Vno",
      label: "Maximum structural cruising",
      mph: 140,
      kind: "ceiling",
      condition: "Top of the green arc; the yellow caution arc runs to Vne",
      why:
        "The fastest you should cruise, and the top of the range that is safe in rough air. The yellow arc above it is smooth-air-only: a gust hitting the airplane there can load it past what it is built for. Descending in bumps is where people find this arc without meaning to — and with no published Va, this is the honest speed to be under when it gets rough.",
      source: `${MANUAL} p.36`,
      severity: "caution",
    },
    {
      id: "green-arc",
      label: "Normal operating range",
      mph: [59, 140],
      kind: "target",
      condition: "Green arc — level flight or climb",
      why:
        "The everyday band. The bottom is the flaps-up stall at gross weight, the top is maximum structural cruising speed, and inside it the airplane is safe in the turbulence you would normally fly in.",
      source: `${MANUAL} p.36`,
    },
    {
      id: "vfe",
      code: "Vfe",
      label: "Maximum flaps extended",
      mph: 100,
      kind: "ceiling",
      condition: "Top of the white arc, which starts at the full-flap stall",
      why:
        "The fastest the flaps may be out. Past it the airloads can bend the flap or its tracks — and this is the limit people bust in the pattern, arriving fast and reaching for the flap handle to slow down. Slow first, then lower them. The manual's rule is the same figure from the other side: flaps may be raised or lowered whenever the airspeed is below this.",
      source: `${MANUAL} pp.12, 36`,
      severity: "limit",
    },
    {
      id: "white-arc",
      label: "Flap operating range",
      mph: [55, 100],
      kind: "target",
      condition: "White arc",
      why:
        "The band the flaps may be extended in. Its bottom is three MPH above the full-flap stall in the manual's own table — the book disagrees with itself slightly here, and the arc is the conservative one, so fly the arc.",
      source: `${MANUAL} p.36`,
    },
  ],
};

// ── Takeoff & climb ─────────────────────────────────────────────────────────
// Section II F/G (pp.25–26) plus the climb data of Figure 9 (p.41).

const TAKEOFF_CLIMB: ReferenceSection = {
  id: "takeoff",
  title: "Takeoff & climb",
  blurb: "What to see on the ASI from the roll to the top of the climb, at 2200 lb.",
  figures: [
    {
      id: "rotate",
      label: "Rotate / lift-off",
      mph: [55, 60],
      kind: "target",
      condition: "Normal takeoff, flaps up",
      why:
        "Where back pressure lifts the nosewheel. The manual's caution is worth as much as the number: do not raise the nose excessively high, because that only lengthens the takeoff run.",
      source: "N8318B card; see also Figure 9",
    },
    {
      id: "fifty-foot",
      label: "Speed over a 50 ft obstacle",
      mph: 69,
      kind: "floor",
      condition: "2200 lb — the speed every takeoff distance is figured at",
      why:
        "The speed the manual's takeoff distances assume you cross 50 feet at. It matters when the runway is short: reach the obstacle slower and you have not flown the chart, and the numbers in it no longer describe your airplane.",
      source: `${MANUAL} Figure 9, p.41`,
    },
    {
      id: "vx",
      code: "Vx",
      label: "Best angle of climb",
      mph: 60,
      kind: "target",
      condition: "Full throttle, flaps up",
      why:
        "The most height gained per foot of GROUND covered — the speed for clearing something at the end of the runway. It is slow, close to the stall, and hot on the cylinders, so it is held only until the obstacle is behind you and then traded for Vy.",
      source: `${MANUAL} pp.25–26`,
    },
    {
      id: "vy",
      code: "Vy",
      label: "Best rate of climb",
      mph: 75,
      kind: "target",
      condition: "Sea level, 2200 lb, full throttle, flaps up",
      why:
        "The most height gained per MINUTE — the speed for getting up to altitude once anything in the way is behind you. It falls with altitude: the manual's rule is about half an MPH slower per 1000 ft, which the climb table bears out. It is also, by the usual relationship for this airframe, very close to its best glide speed.",
      source: `${MANUAL} p.26, Figure 9 p.41`,
    },
    {
      id: "cruise-climb",
      label: "Normal / cruise climb",
      mph: [80, 90],
      kind: "target",
      condition: "Flaps up, full throttle, nothing to clear",
      why:
        "What the manual actually tells you to climb at when there is no obstacle: faster than Vy, so it climbs a little slower but cools far better and lets you see over the nose. On a hot day at Torrance this is the one that keeps the cylinder temperatures sensible.",
      source: `${MANUAL} pp.25–26`,
    },
    {
      id: "climb-mixture",
      label: "Mixture in the climb",
      value: "Full rich",
      condition: "Unless the engine runs rough from an over-rich mixture",
      why:
        "Fuel does the cooling in a climb. The manual leans only for maximum-performance takeoffs from high-elevation fields, and enriches again as soon as the climb is over — an O-300 climbing leaned at low altitude is an engine being cooked.",
      source: `${MANUAL} pp.2, 26`,
    },
  ],
};

// ── Approach & landing ──────────────────────────────────────────────────────
// Section II J/K (pp.26–27) and the landing diagram, Figure 11 (p.43).

const APPROACH_LANDING: ReferenceSection = {
  id: "landing",
  title: "Approach & landing",
  blurb: "Coming back. Every figure is power-off unless it says otherwise.",
  figures: [
    {
      id: "glide-clean",
      label: "Glide / approach, flaps up",
      mph: [70, 80],
      kind: "target",
      condition: "Before landing, flaps still up",
      why:
        "The speed to be at while you are getting the airplane ready to land — carb heat on, mixture rich, fuel on both. It is also the manual's power-off glide figure, which is the closest this book comes to publishing a best glide speed.",
      source: `${MANUAL} p.26`,
    },
    {
      id: "final-flaps",
      label: "Final, flaps extended",
      mph: [65, 75],
      kind: "target",
      condition: "Flaps as desired, below Vfe",
      why:
        "The normal approach band once the flaps are out. Slower than clean because the flaps have lowered the stall speed with them; trim for it and the airplane will hold it for you down final.",
      source: `${MANUAL} p.26`,
    },
    {
      id: "short-field",
      label: "Short field approach",
      mph: 60,
      kind: "floor",
      condition: "Power off, flaps 40° (fourth notch)",
      why:
        "The manual's short-field approach: full flap, power off, then the nosewheel lowered to the ground immediately after touchdown and heavy braking as required. It is only about seven knots above the full-flap stall, so it is flown precisely or not at all.",
      source: `${MANUAL} p.27`,
    },
    {
      id: "approach-heavy",
      label: "Approach speed the charts assume — at 2200 lb",
      mph: 64,
      kind: "floor",
      condition: "Power off, flaps 40°, hard surface",
      why:
        "The speed behind the landing-distance diagram at gross. Fly the approach faster than this and the distances in the table stop describing your landing.",
      source: `${MANUAL} Figure 11, p.43`,
    },
    {
      id: "approach-light",
      label: "Approach speed the charts assume — at 1600 lb",
      mph: 51,
      kind: "floor",
      condition: "Power off, flaps 40°, hard surface",
      why:
        "How far the light figure sits below the heavy one. A nearly empty airplane flown at the gross-weight number floats a long way down the runway, which is the usual reason a landing that should have fitted didn't.",
      source: `${MANUAL} Figure 11, p.43`,
    },
    {
      id: "crosswind",
      label: "Landing in a strong crosswind",
      value: "Minimum flap for the runway length",
      condition: "Wing-low, crab, or a combination",
      why:
        "Less flap means less for the wind to push against and a more positive touchdown. The manual pairs it with holding the runway heading on the steerable nosewheel and braking as needed — the drift has to be off before the wheels arrive.",
      source: `${MANUAL} p.27`,
    },
    {
      id: "slips",
      label: "Slips with full flap",
      value: "Prohibited",
      condition: "40° of flap",
      why:
        "The manual prohibits slips in full-flap approaches: a downward pitch is encountered under certain combinations of airspeed and sideslip angle. This is a limitation on a card, not a technique preference.",
      source: `${MANUAL} p.33`,
      severity: "limit",
    },
  ],
};

// ── Stall speeds ────────────────────────────────────────────────────────────
// Section III, "Stalling Speeds" (p.33): power off, MPH TIAS, forward CG,
// normal category, 2200 lb. Kept as a MATRIX rather than as figures, because
// the point of the table is what happens along the BANK axis — 58 becomes 82
// at 60° — and a list of eleven separate numbers hides that entirely.
//
// Stored in the manual's MPH and converted on the way out, rounding UP: a
// stall speed rounded down is the one conversion error that could hurt
// somebody.

export interface StallRow {
  /** Flap setting as the manual writes it. */
  flaps: string;
  /** The manual's own speeds, MPH, in BANK_ANGLES order. */
  mph: number[];
  why: string;
}

export const BANK_ANGLES = [0, 20, 40, 60] as const;

export const STALL_SPEEDS: StallRow[] = [
  {
    flaps: "Flaps up",
    mph: [58, 60, 66, 82],
    why:
      "Clean stall, and the bottom of the green arc. This is the number the airplane is flying against on a clean, slow base turn.",
  },
  {
    flaps: "Flaps 10°",
    mph: [56, 58, 64, 79],
    why:
      "First notch — the short-field takeoff setting, and only a knot or two of stall speed cheaper than clean.",
  },
  {
    flaps: "Flaps 40°",
    mph: [52, 54, 59, 73],
    why:
      "Full flap, the bottom of the white arc, and the lowest speed the airplane will fly at. About five knots below the clean figure, which is what a full-flap short-field landing is buying.",
  },
];

/** A stall row in knots — always rounded UP. See the note above. */
export function stallKnots(row: StallRow): number[] {
  return row.mph.map((mph) => knots(mph, "floor"));
}

export const STALL_CONDITIONS =
  "Power off, gross weight 2200 lb, forward CG, normal category. Any lighter and the airplane stalls slower than the table.";

export const STALL_NOTES = [
  "Stall speed rises with BANK, not with weight alone: about 50 kt clean and level becomes about 72 kt in a 60° turn. A steep, slow turn onto final is where that catches people.",
  "Knots are rounded UP from the manual's MPH throughout this table — a stall speed is the one figure that must never be rounded down. The MPH column is the book's own.",
  "The horn sounds 5–10 MPH before the stall and needs no silencing switch. It will not sound on a fast landing, and it cuts out on the ground.",
  "The manual notes slight elevator buffeting just before the stall with flaps down — the airplane's own warning, on top of the horn.",
  "The book disagrees with itself by three MPH at the bottom of the white arc: the flap range starts at 55 MPH while this table puts the full-flap stall at 52. The arc is the conservative one, so fly the arc.",
];

// ── Climb rate ──────────────────────────────────────────────────────────────
// Figure 9's CLIMB DATA (p.41) and the climb column of the takeoff diagram
// (Figure 8, p.40), at 2200 lb, full throttle, flaps up.
//
// Worth its own table rather than a figure, because the shape is the lesson:
// 660 ft/min at sea level is 240 by 10,000 ft and 30 by 15,000 — this airplane
// runs out of climb a long way below where a pilot used to a modern 172 might
// expect it to, and the 15,000 ft row is the service ceiling in all but name.

export interface ClimbRow {
  altitude: string;
  temperature: string;
  /** Best rate of climb speed at this altitude, in the manual's MPH. */
  bestRateMph: number;
  /** Rate of climb at that speed, feet per minute. */
  feetPerMinute: number;
  /** Gallons burned getting there from sea level, warm-up included. */
  fuelUsedGal: number | null;
}

export const CLIMB_RATES: ClimbRow[] = [
  { altitude: "Sea level", temperature: "59°F", bestRateMph: 75, feetPerMinute: 660, fuelUsedGal: 1.0 },
  { altitude: "5000 ft", temperature: "41°F", bestRateMph: 73, feetPerMinute: 445, fuelUsedGal: 2.6 },
  { altitude: "10,000 ft", temperature: "23°F", bestRateMph: 70, feetPerMinute: 240, fuelUsedGal: 4.7 },
  { altitude: "15,000 ft", temperature: "5°F", bestRateMph: 68, feetPerMinute: 30, fuelUsedGal: 10.9 },
];

export const CLIMB_CONDITIONS =
  "2200 lb, full throttle, flaps up, mixture leaned for smooth operation above 5000 ft. Fuel used is from sea level and includes warm-up and takeoff.";

export const CLIMB_NOTES = [
  "Thirty feet a minute at 15,000 ft is the service ceiling arriving: the manual's own figure for it is 15,100 ft, and the last few thousand take most of an hour.",
  "The best-rate SPEED falls with altitude as the rate does — the manual's rule of thumb is about half an MPH per 1000 ft, and the table is that rule worked out.",
  "Steep climbs at these speeds are short-duration only, because of poor engine cooling. The 80–90 MPH cruise climb is what the manual wants you in the rest of the time.",
];

// ── Engine & instruments ────────────────────────────────────────────────────

const ENGINE: ReferenceSection = {
  id: "engine",
  title: "Engine & instrument markings",
  blurb:
    "Continental O-300-A, 145 bhp at 2700 RPM. What the gauges should read, and where the red lines are.",
  figures: [
    {
      id: "rpm-max",
      label: "Maximum RPM",
      value: "2700 RPM",
      condition: "Red line",
      why:
        "The engine's limit, and the only place full rated power lives. It is reached on takeoff and nowhere else; a cruise setting anywhere near it is wearing the engine out for a few knots.",
      source: `${MANUAL} p.36`,
      severity: "limit",
    },
    {
      id: "rpm-cruise",
      label: "Normal operating range",
      value: "2200–2450 RPM at sea level",
      condition: "2200–2550 at 5000 ft · 2200–2650 at 10,000 ft",
      why:
        "The green arc, and it widens with altitude because thinner air makes the same RPM less power. The manual's recommended cruise is 2450–2650 depending on height, which produces roughly 70% power.",
      source: `${MANUAL} pp.26, 36`,
    },
    {
      id: "rpm-idle",
      label: "Idle",
      value: "600–800 RPM",
      condition: "Never below 600 for any length of time",
      why:
        "Below 600 RPM the engine cannot maintain satisfactory piston lubrication. It is also why the manual has you idle for two to three minutes before shutdown: the temperatures need to even out before the oil stops moving.",
      source: `${MANUAL} p.30`,
      severity: "caution",
    },
    {
      id: "runup",
      label: "Run-up",
      value: "1600 RPM · max 100 RPM mag drop",
      condition: "Each magneto separately, back to BOTH before continuing",
      why:
        "The pre-takeoff mag check. A drop bigger than 100 RPM, or a rough-running magneto, is the airplane telling you about an ignition fault before it has to fly on it. Static full throttle should give 2260–2360 RPM with carb heat off.",
      source: `${MANUAL} p.24`,
    },
    {
      id: "oil-pressure",
      label: "Oil pressure",
      value: "30–45 psi green · 5 psi min · 50 psi max",
      condition: "Red lines at both ends",
      why:
        "The first thing to look at after start: the manual gives it 30 seconds to show pressure in the summer, about twice that in very cold weather, and says stop the engine and investigate if it hasn't. The run-up expects 30–40 psi with a minimum of 10 at idle.",
      source: `${MANUAL} pp.24, 36`,
      severity: "limit",
    },
    {
      id: "oil-temp",
      label: "Oil temperature",
      value: "Green arc in cruise",
      condition: "Red line is the maximum allowable",
      why:
        "A cruise check, alongside oil pressure. Rising oil temperature with steady power is the airplane asking a question — usually about oil quantity or a cowling problem — well before anything else shows it.",
      source: `${MANUAL} pp.26, 36`,
    },
    {
      id: "carb-heat",
      label: "Carburettor heat",
      value: "Full on or full off",
      condition: "On before closing the throttle; off for takeoff",
      why:
        "Partial heat can be worse than none: it can warm ice-free air just enough to make ice where there was none. Full heat costs 250–500 RPM at full throttle, and if the engine then runs rough it needs leaning, because hot air is a richer mixture.",
      source: `${MANUAL} pp.2–3`,
    },
  ],
};

// ── Fuel, oil & weights ─────────────────────────────────────────────────────

const FUEL_OIL: ReferenceSection = {
  id: "fuel",
  title: "Fuel, oil & weights",
  blurb: "What the airplane holds, what it may weigh, and what it may pull.",
  figures: [
    {
      id: "fuel-capacity",
      label: "Fuel",
      value: "37 gal usable (2 × 21 gal tanks)",
      condition: "18.5 gal usable a side, 80 octane minimum",
      why:
        "Four gallons of the 42 aboard are not usable in all flight conditions, which is why the planning number is 37 and never 42. At around 8 gal/hr in cruise that is a bit over four hours before any reserve — and the manual's own range figures already assume you leave one.",
      source: `${MANUAL} pp.5, 39`,
    },
    {
      id: "fuel-selector",
      label: "Fuel selector",
      value: "BOTH ON for takeoff and landing",
      condition: "Takeoff on less than ½ tank is not recommended",
      why:
        "The placard on the valve itself. Both tanks feeding means an unported tank in a slip or a climb cannot quietly starve the engine at the worst moment of the flight.",
      source: `${MANUAL} pp.6–7, 24`,
      severity: "caution",
    },
    {
      id: "oil-capacity",
      label: "Oil",
      value: "8 qt capacity · 4 qt minimum",
      condition: "Fill to full for an extended flight; changed every 25 hours",
      why:
        "Do not operate on less than four quarts — that is the manual's wording, and it is a dispatch limit rather than advice. Add oil below six quarts. Grade is SAE 20 below 50°F outside air and SAE 40 above it.",
      source: `${MANUAL} pp.3–5`,
      severity: "limit",
    },
    {
      id: "gross",
      label: "Gross weight",
      value: "2200 lb (normal category)",
      condition: "1950 lb in the utility category",
      why:
        "Every performance figure in the manual is computed at 2200 lb, so past it the charts stop describing this airplane at all. The utility category is lower still and additionally requires the rear seat and the baggage compartment to be EMPTY — see Tools › Weight & Balance, which computes the normal category only.",
      source: `${MANUAL} pp.35, 38`,
      severity: "limit",
    },
    {
      id: "baggage",
      label: "Baggage",
      value: "120 lb maximum",
      condition: "Arm 95 in — the furthest aft anything loads",
      why:
        "The placarded limit, but the aft CG limit frequently bites before the weight does, which is what the weight & balance tool is for. In the utility category the compartment must be empty outright.",
      source: `${MANUAL} pp.35–38`,
      severity: "limit",
    },
    {
      id: "load-factors",
      label: "Flight load factors",
      value: "+3.8 / −1.52 g flaps up · +3.5 g flaps down",
      condition: "Normal category at 2200 lb",
      why:
        "What the structure is certified to, and the reason the yellow arc exists — a gust in rough air adds g you did not ask for. Utility category at 1950 lb is +4.4 / −1.76 flaps up.",
      source: `${MANUAL} p.35`,
      severity: "limit",
    },
    {
      id: "tyres",
      label: "Tyre & strut pressures",
      value: "Mains 23 psi · nose 26 psi · nose strut 35 psi",
      condition: "Nose strut inflated fully extended, wheel clear of the ground",
      why:
        "A soft nosewheel is the usual cause of a shimmy on the roll, and correct pressure is what gets the tyre life the manual assumes. Worth knowing on a walkaround when a tyre looks flatter than it did last week.",
      source: `${MANUAL} pp.47–48`,
    },
  ],
};

// ── Manoeuvres ──────────────────────────────────────────────────────────────

const MANOEUVRES: ReferenceSection = {
  id: "manoeuvres",
  title: "Manoeuvres & flaps",
  blurb: "What this airplane is approved to do, and the flap settings it does it with.",
  figures: [
    {
      id: "flap-settings",
      label: "Flap settings",
      value: "0° · 10° · 20° · 30° · 40°",
      condition: "Lowered or raised any time below Vfe",
      why:
        "Five detented positions. 10° is the short-field takeoff setting; 40° is the landing setting and the one full-flap slips are prohibited with. Flaps are NOT recommended for takeoff at 30° or 40° at any time.",
      source: `${MANUAL} pp.12, 32`,
    },
    {
      id: "aerobatics",
      label: "Approved manoeuvres",
      value: "Chandelles · lazy eights · steep turns · spins · stalls",
      condition: "Utility category only — rear seat and baggage empty",
      why:
        "The only manoeuvres the manual approves, and only in the utility category. Everything else, including anything that could impose an inverted load, is not approved in this airplane.",
      source: `${MANUAL} pp.35–36`,
      severity: "caution",
    },
    {
      id: "entry-speed",
      label: "Manoeuvre entry speed",
      mph: 115,
      kind: "ceiling",
      condition: "Chandelles, lazy eights, steep turns and spins",
      why:
        "The entry speed the manual prints for the approved manoeuvres (stalls are entered by slow deceleration instead). It is an entry speed and NOT a manoeuvring speed — see the Va card below, which this figure is easily mistaken for.",
      source: `${MANUAL} p.36`,
      severity: "caution",
    },
  ],
};

export const REFERENCE_SECTIONS: ReferenceSection[] = [
  AIRSPEEDS,
  TAKEOFF_CLIMB,
  APPROACH_LANDING,
  ENGINE,
  FUEL_OIL,
  MANOEUVRES,
];

// ── Figures this manual does not print ──────────────────────────────────────
//
// A 1958 owner's manual predates half of what a modern POH publishes. Three
// things a pilot trained today WILL go looking for are simply not in it: a
// manoeuvring speed, a best glide speed, and any descent rate at all.
//
// Leaving them blank was the first version of this and it wasn't good enough:
// a pilot who can't find Va does not conclude the airplane hasn't got one,
// they fill it in from somewhere and say nothing. So the figures below are
// filled in from PUBLISHED SOURCES FOR RELATED AIRFRAMES, found online, and
// every one of them is labelled as such wherever it renders.
//
// The labelling is the load-bearing part, and the rule for this block is that
// a reader must never be able to mistake one of these for something out of
// N8318B's book. They are a starting point for a conversation with an
// instructor and a figure for the club to adopt deliberately — not numbers
// this app has decided on the club's behalf.

export interface ElsewhereFigure {
  id: string;
  code?: string;
  label: string;
  /** The best available figure, already in knots where it is a speed. */
  value: string;
  /** The manual's own units, where the source published in MPH. */
  manualUnits?: string;
  /** What THIS manual gives you instead, if anything. */
  instead: string;
  /** Where the number came from — named airframe, named publication. */
  found: string;
  /** Why it can't simply be adopted, and what to do about that. */
  caution: string;
}

export const FROM_ELSEWHERE: ElsewhereFigure[] = [
  {
    id: "va",
    code: "Va",
    label: "Manoeuvring speed",
    value: "≈ 95–100 kt at 2200 lb",
    manualUnits: "≈ 109–115 MPH",
    instead:
      "This manual prints no Va at all. It gives a 115 MPH entry speed for approved manoeuvres and a 140 MPH top to the green arc, and neither of those is a manoeuvring speed.",
    found:
      "Two related airframes bracket it. The Cessna 170B — same Continental O-300, same 2200 lb gross — publishes Va at 115 MPH (100 kt) in its own limitations section, per the FAA type certificate data sheet. The 1974–75 Cessna 172 publishes 112 MPH (97 kt) at its 2300 lb gross; scaled to 2200 lb by the usual square-root-of-weight relationship that is about 109 MPH (95 kt).",
    caution:
      "Va is the fastest speed at which full deflection of a control stalls the wing before it breaks something — what you slow to in turbulence. It falls with WEIGHT and is specific to an airframe's certification, so neither figure above transfers cleanly: the 1974 airplane has a different wing, a different tail and a Vne 22 MPH higher. Treat 95 kt as the conservative end of an online estimate, confirm what the club flies with an instructor or the Safety Officer, and in the meantime use the manual's own honest limit — stay below the top of the green arc in rough air.",
  },
  {
    id: "glide",
    label: "Best glide speed",
    value: "≈ 65 kt at 2200 lb, roughly 8–9:1",
    manualUnits: "≈ 75 MPH",
    instead:
      "This manual publishes no best-glide speed and no glide ratio. The nearest thing in it is the before-landing glide: 70–80 MPH (61–69 kt) with flaps up, power at idle.",
    found:
      "The FAA's own Best Glide Speed and Distance guidance puts an early 172 at about 75 MPH (65 kt), and community sources for the O-300 airframes give the same figure, noting that best glide on these airplanes is essentially the same speed as best rate of climb — which for N8318B is the manual's own 75 MPH. A glide ratio around 8–9:1 is the usual quoted figure, about 1.5 nautical miles per 1000 ft above the ground.",
    caution:
      "Consistent across sources and consistent with this airplane's own Vy, which is why it is worth having — but it is still not certified data for this airframe, and glide performance depends on the propeller windmilling or stopped, on weight, and on how clean the airplane is. Fly it as a starting point, trim for it, and confirm the number and the ratio with an instructor before you plan a forced landing around it.",
  },
  {
    id: "descent",
    label: "Descent rate",
    value: "Pilot's choice — 500 ft/min is the usual planning figure",
    instead:
      "The manual gives no descent rate and no descent speed. Its entire let-down procedure is 'reduce power to obtain desired let down rate at cruising speed', with enough carburettor heat to prevent icing.",
    found:
      "500 ft/min is the standard general-aviation planning rate rather than anything published for this type — it is what ATC expects, what passengers' ears tolerate, and what makes the arithmetic easy (three miles per thousand feet at 90 kt).",
    caution:
      "The real constraint on this airplane is not the airframe, it is the ENGINE: a long descent at low power in cool air shock-cools an O-300 and is how cylinders crack. The manual's own instruction is to begin the descent far enough out that it can be made gradually WITH POWER ON and the mixture rich. Plan the descent early and fly it with the throttle in rather than diving at the field with the power at idle.",
  },
];

// ── Distances ───────────────────────────────────────────────────────────────
// Figures 8/9 (pp.40–41) and Figure 11 (p.43), at GROSS on a hard surface with
// no wind. The heavy column only: a chart the club can't fly to at its worst
// case is not a useful quick reference, and the manual is in the cabin for the
// rest.

export interface DistanceRow {
  altitude: string;
  temperature: string;
  takeoffGroundRun: number;
  takeoffOver50: number;
  landingGroundRoll: number;
  landingOver50: number;
}

export const DISTANCES: DistanceRow[] = [
  { altitude: "Sea level", temperature: "59°F", takeoffGroundRun: 725, takeoffOver50: 1650, landingGroundRoll: 870, landingOver50: 1115 },
  { altitude: "2500 ft", temperature: "50°F", takeoffGroundRun: 880, takeoffOver50: 2000, landingGroundRoll: 915, landingOver50: 1180 },
  { altitude: "5000 ft", temperature: "41°F", takeoffGroundRun: 1080, takeoffOver50: 2455, landingGroundRoll: 960, landingOver50: 1245 },
  { altitude: "7500 ft", temperature: "32°F", takeoffGroundRun: 1365, takeoffOver50: 3100, landingGroundRoll: 1010, landingOver50: 1310 },
];

export const DISTANCE_CONDITIONS =
  "2200 lb, hard surface, zero wind, flaps up for takeoff and 40° power-off for landing.";

export const DISTANCE_NOTES = [
  "Add 10% to every takeoff distance for each 25°F above the temperature in the row. A 90°F afternoon at Torrance is not the sea-level line.",
  "A 13 kt headwind cuts the sea-level takeoff run from 725 ft to 505 ft, and 26 kt cuts it to 315 ft. Reduce the landing distance 10% for each 4 kt of headwind. (The manual's chart is in MPH wind — 15 and 30 MPH for the takeoff figures, 5 MPH for the landing rule.)",
  "Grass, a soft surface or an uphill runway are not in these figures at all, and each of them costs more than the chart's margin.",
];

/**
 * The POH data for an airframe, or null if the app doesn't hold its type.
 *
 * Keyed on the SAME id the aircraft row names in `wbProfile`, which is the
 * app's one handle on "which type's book applies to this airframe". Sharing it
 * is deliberate rather than lazy: both sets of numbers are transcribed from
 * the same manual, and a club with two airplanes must not be able to pair one
 * type's stations with another type's speeds. If a second type ever lands here
 * with a W&B profile and no manual (or the reverse), that is when the column
 * earns a rename and the two get separate keys.
 *
 * Null on an unknown id, for exactly the reason `profileFor` is: another
 * type's stall speed presented under this airplane's tail number is worse than
 * no page at all.
 */
export interface PohReference {
  profileId: string;
  /** The type this describes, as the manual's own cover puts it. */
  type: string;
  manual: string;
  sections: ReferenceSection[];
}

const C172_1958_POH: PohReference = {
  profileId: "c172-1958",
  type: "Cessna 172 (1958, Continental O-300-A)",
  manual: `${MANUAL} — the book in this airplane`,
  sections: REFERENCE_SECTIONS,
};

export const POH_REFERENCES: Record<string, PohReference> = {
  [C172_1958_POH.profileId]: C172_1958_POH,
};

export function pohReferenceFor(id: string | null | undefined): PohReference | null {
  if (!id) return null;
  return POH_REFERENCES[id] ?? null;
}
