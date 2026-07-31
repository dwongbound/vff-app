// The club's operating rules (VFF-OR-A, set by the VFF Safety Officer on
// 2026-06-29), encoded so the app can show a pilot the limits that apply to
// *them* instead of a PDF they have to interpret at the tiedown.
//
// The rules split members into two experience tiers, with a third column for
// flying alongside an approved instructor (which supersedes the personal
// minimums). Everything here is club policy, not physics or regulation — when
// the Safety Officer revises the rules, this file and RULES_REVISION change.
//
// Nothing in here relaxes anything: where the club defers to the FARs the app
// says so, and the printed rules are explicit that a lower personal or FAA
// minimum always wins.

export const RULES_ID = "VFF-OR-A";
export const RULES_REVISION = "2026-06-29";

/** Which column of the table applies to a given flight. */
export type PilotTier = "EXPERIENCED" | "BUILDING" | "WITH_INSTRUCTOR";

export const TIER_LABELS: Record<PilotTier, string> = {
  EXPERIENCED: "Experienced member (solo or PIC)",
  BUILDING: "Building time (solo or PIC)",
  WITH_INSTRUCTOR: "With an approved flight instructor",
};

// The experience gate for the left-hand column.
export const EXPERIENCED_TOTAL_HOURS = 200;
export const EXPERIENCED_RECENT_HOURS = 50; // in the last 12 calendar months

/** One row of the operating-rules table. */
export interface RuleRow {
  id: string;
  label: string;
  /** What the rule means and why the club has it — the (i) popover text. */
  why: string;
  experienced: string;
  building: string;
  withInstructor: string;
}

export const RULE_ROWS: RuleRow[] = [
  {
    id: "experience",
    label: "Experience required",
    why:
      "Which column of these rules applies to you. Over 200 hours total AND 50 in the last 12 months puts you on the club's standard minimums; anyone else flies to the tighter set until they build that time.",
    experienced: `> ${EXPERIENCED_TOTAL_HOURS} h total, ${EXPERIENCED_RECENT_HOURS} h in the last 12 months`,
    building: "Anything less",
    withInstructor: "Any",
  },
  {
    id: "day-currency",
    label: "Day VFR currency",
    why:
      "Landings keep the picture of the sight picture fresh. The FARs ask for 3 in 90 days to carry passengers; the club asks lower-time members for 3 in 30, because skills fade fastest early on.",
    experienced: "FARs — 3 landings in the last 90 days",
    building: "3 landings in the last 30 days",
    withInstructor: "N/A",
  },
  {
    id: "night-currency",
    label: "Night VFR currency",
    why:
      "Night landings must be to a full stop — no touch-and-goes — because the go-around is the part that bites at night. The club tightens the window for lower-time members.",
    experienced: "FARs — 3 landings to a full stop in the last 90 days",
    building: "3 landings to a full stop in the last 30 days",
    withInstructor: "N/A",
  },
  {
    id: "ifr-currency",
    label: "IFR currency (rating required)",
    why:
      "Instrument flying is perishable in weeks, not months. The FARs allow 6 approaches in 6 months; the club asks lower-time members for 3 within the last month.",
    experienced: "FARs — 6 approaches in the last 6 months",
    building: "3 approaches within the last month",
    withInstructor: "N/A",
  },
  {
    id: "crosswind",
    label: "Crosswind maximum",
    why:
      "The 172's demonstrated crosswind component isn't a limit, it's what a test pilot managed on a good day. Lower-time members hold to 10 knots so a gusty afternoon doesn't turn into a bent airplane.",
    experienced: "As stated in the POH",
    building: "10 kt",
    withInstructor: "N/A",
  },
  {
    id: "gusts",
    label: "Gust spread maximum",
    why:
      "A wide gust spread means big, fast airspeed changes in the flare. ±8 knots keeps lower-time members out of conditions where the airplane arrives before they do.",
    experienced: "No limit",
    building: "± 8 kt",
    withInstructor: "N/A",
  },
  {
    id: "ceiling",
    label: "Ceiling minimum",
    why:
      "Room to turn around. The regs allow 1,000 ft broken/overcast; the club wants 3,000 for lower-time members so a lowering ceiling is an inconvenience rather than a trap.",
    experienced: "FARs — 1,000 ft BKN or OVC",
    building: "3,000 ft BKN or OVC",
    withInstructor: "N/A",
  },
  {
    id: "visibility",
    label: "Visibility minimum",
    why:
      "Seeing traffic and finding the field. 1 statute mile is legal; 10 is comfortable, and comfortable is the point while you're building experience.",
    experienced: "FARs — 1 sm",
    building: "10 sm",
    withInstructor: "N/A",
  },
  {
    id: "fuel",
    label: "Fuel reserve",
    why:
      "Fuel on landing, not fuel on takeoff. An hour in the tanks absorbs a diversion, a hold, or a headwind that showed up late; two hours does it with room to think.",
    experienced: "1 h",
    building: "2 h",
    withInstructor: "N/A",
  },
  {
    id: "overnight",
    label: "Overnight or > 100 nm",
    why:
      "Long trips add fatigue, unfamiliar fields, and pressure to get home. Talking the plan through with the Safety Officer is how the club catches the thing you hadn't considered.",
    experienced: "Plan it yourself",
    building: "Call the VFF Safety Officer to discuss your plan",
    withInstructor: "—",
  },
  {
    id: "squawks",
    label: "Flying with open squawks",
    why:
      "An open squawk means somebody found something. Deciding whether it's airworthy is a judgement call — one the club would rather its lower-time members make with the Safety Officer on the phone.",
    experienced: "Follow the FARs",
    building: "Call the VFF Safety Officer to discuss",
    withInstructor: "N/A",
  },
  {
    id: "offshore",
    label: "Maximum offshore distance",
    why:
      "A single engine over water is a glide-range problem. Stay within range of dry land unless you're on a flight plan or headed to Catalina.",
    experienced: "10 sm (unless on a flight plan or going to Catalina)",
    building: "5 sm (unless you can assure gliding to land)",
    withInstructor: "N/A",
  },
  {
    id: "weather",
    label: "Pre-flight weather",
    why:
      "A briefer will tell you about the AIRMET you scrolled past. Lower-time members call one every time; everyone else self-briefs.",
    experienced: "Self-brief",
    building: "Must call a briefer",
    withInstructor: "N/A",
  },
];

/** Airports that need a checkout or Safety Officer approval before you go. */
export const CHECKOUT_AIRPORTS = [
  { id: "KAVX", name: "Catalina Island Airport" },
  { id: "KL35", name: "Big Bear City Airport" },
];

/** Which column of the rules table applies. */
export interface TierInput {
  /** Total time from the member's profile, in hours. */
  totalTimeHours: number | null | undefined;
  /** Hours flown in the last 12 months (club log + declared time). */
  recentHours: number;
  /** True when this flight is with an approved instructor. */
  withInstructor?: boolean;
}

export function pilotTier(input: TierInput): PilotTier {
  if (input.withInstructor) return "WITH_INSTRUCTOR";
  const total = input.totalTimeHours ?? 0;
  if (
    total > EXPERIENCED_TOTAL_HOURS &&
    input.recentHours >= EXPERIENCED_RECENT_HOURS
  ) {
    return "EXPERIENCED";
  }
  return "BUILDING";
}

/** The applicable cell of a rule row for a tier. */
export function ruleFor(row: RuleRow, tier: PilotTier): string {
  if (tier === "EXPERIENCED") return row.experienced;
  if (tier === "BUILDING") return row.building;
  return row.withInstructor;
}

// ── Currency ───────────────────────────────────────────────────────────────
// What the club can actually check from its own flight log: landings. Anything
// needing an approach log or time in another airplane stays the pilot's call,
// and the UI says so rather than pretending to know.

/** Landing-currency windows, in days, per tier. */
export const CURRENCY_WINDOW_DAYS: Record<
  Exclude<PilotTier, "WITH_INSTRUCTOR">,
  number
> = {
  EXPERIENCED: 90,
  BUILDING: 30,
};

export const REQUIRED_LANDINGS = 3;

export interface CurrencyFlight {
  flownOn: string | Date;
  landings?: number;
  nightLandings?: number;
}

export interface CurrencyStatus {
  /** Landings inside the window that applies to this tier. */
  dayLandings: number;
  nightLandings: number;
  windowDays: number;
  dayCurrent: boolean;
  nightCurrent: boolean;
}

/**
 * Landing currency from the club's own log.
 *
 * Only counts flights in THIS club's airplanes — a member who flies elsewhere
 * may well be current without the app knowing, which is why the UI presents
 * this as "what the club log shows" rather than a verdict.
 */
export function landingCurrency(
  flights: CurrencyFlight[],
  tier: PilotTier,
  now: Date = new Date()
): CurrencyStatus {
  // An instructor on board makes currency moot for the flight itself, but the
  // window still has to come from somewhere — use the stricter one.
  const windowDays =
    tier === "EXPERIENCED"
      ? CURRENCY_WINDOW_DAYS.EXPERIENCED
      : CURRENCY_WINDOW_DAYS.BUILDING;

  const cutoff = now.getTime() - windowDays * 86_400_000;
  const recent = flights.filter(
    (f) => new Date(f.flownOn).getTime() >= cutoff
  );

  const nightLandings = recent.reduce((sum, f) => sum + (f.nightLandings ?? 0), 0);
  // `landings` is every landing on the flight, night ones included.
  const dayLandings = recent.reduce((sum, f) => sum + (f.landings ?? 0), 0);

  return {
    dayLandings,
    nightLandings,
    windowDays,
    dayCurrent: dayLandings >= REQUIRED_LANDINGS,
    nightCurrent: nightLandings >= REQUIRED_LANDINGS,
  };
}

/**
 * The question the rules exist to answer: can this member fly the airplane
 * solo (or as PIC) today, or do they need an approved instructor?
 *
 * Both halves come from what the club can actually see — the member's declared
 * total time, and this club's flight log for the recency and landings. A pilot
 * who fails the currency their column requires isn't grounded: the rules'
 * third column says they fly with an approved instructor instead.
 *
 * Night is answered separately because night landings must be to a full stop,
 * and a pilot can easily be current by day and not by night.
 */
export interface SoloEligibilityInput {
  /** Declared total time from the member's profile. */
  totalTimeHours: number | null | undefined;
  /** This member's flights from the club log. */
  flights: (CurrencyFlight & { tachStart: number; tachEnd: number })[];
  now?: Date;
}

export interface SoloEligibility {
  tier: Exclude<PilotTier, "WITH_INSTRUCTOR">;
  /** Hours in the last 12 months, from the club log. */
  recentHours: number;
  /** The landing-currency window their column gets: 90 or 30 days. */
  windowDays: number;
  dayLandings: number;
  nightLandings: number;
  /** May they fly solo/PIC by day? */
  daySolo: boolean;
  /** …and at night? */
  nightSolo: boolean;
  /** Plain-language reasons they can't, in the order they'd want to fix them. */
  dayBlockers: string[];
  nightBlockers: string[];
}

export function soloEligibility(input: SoloEligibilityInput): SoloEligibility {
  const now = input.now ?? new Date();
  const recentHours = hoursInLastYear(input.flights, now);
  const tier = pilotTier({
    totalTimeHours: input.totalTimeHours,
    recentHours,
  }) as Exclude<PilotTier, "WITH_INSTRUCTOR">;

  const currency = landingCurrency(input.flights, tier, now);

  const dayBlockers: string[] = [];
  if (!currency.dayCurrent) {
    dayBlockers.push(
      `${currency.dayLandings} of ${REQUIRED_LANDINGS} landings in the last ` +
        `${currency.windowDays} days.`
    );
  }

  const nightBlockers: string[] = [];
  if (!currency.nightCurrent) {
    nightBlockers.push(
      `${currency.nightLandings} of ${REQUIRED_LANDINGS} full-stop night ` +
        `landings in the last ${currency.windowDays} days.`
    );
  }

  return {
    tier,
    recentHours,
    windowDays: currency.windowDays,
    dayLandings: currency.dayLandings,
    nightLandings: currency.nightLandings,
    daySolo: dayBlockers.length === 0,
    nightSolo: nightBlockers.length === 0,
    dayBlockers,
    nightBlockers,
  };
}

/** Hours flown in the last 12 months, from the club log. */
export function hoursInLastYear(
  flights: { flownOn: string | Date; tachStart: number; tachEnd: number }[],
  now: Date = new Date()
): number {
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const total = flights
    .filter((f) => new Date(f.flownOn).getTime() >= cutoff.getTime())
    .reduce((sum, f) => sum + (f.tachEnd - f.tachStart), 0);
  return Math.round(total * 10) / 10;
}

// ── The mnemonic checklists the rules require ──────────────────────────────

export interface MnemonicItem {
  letter: string;
  label: string;
  detail: string;
}

/** Before starting the engine: am I fit to fly? */
export const IM_SAFE: MnemonicItem[] = [
  { letter: "I", label: "Illness", detail: "Anything that would keep you home from work keeps you out of the airplane." },
  { letter: "M", label: "Medication", detail: "Prescription or over the counter — check it against the FAA's list before you fly, not after." },
  { letter: "S", label: "Stress", detail: "A head full of something else is a head not flying the airplane." },
  { letter: "A", label: "Alcohol", detail: "8 hours bottle to throttle is the floor, not the goal; hangovers count as impairment." },
  { letter: "F", label: "Fatigue", detail: "The one pilots talk themselves past most often. Tired flying looks a lot like impaired flying." },
  { letter: "E", label: "Emotions", detail: "Anger, grief, or a fight before you left — all of it comes with you into the cockpit." },
];

/** Before leaving the runup. */
export const FIVE_PS: MnemonicItem[] = [
  { letter: "P", label: "Pilot", detail: "Did you complete I'M SAFE, and are you ready to go?" },
  { letter: "P", label: "Plane", detail: "Preflight and runup complete? Anything weird?" },
  { letter: "P", label: "Passengers", detail: "Briefed? Anxious? Can they help if you need them to?" },
  { letter: "P", label: "Plan", detail: "Can you describe the flight out loud — initial heading after departure, and the runway you expect at the destination?" },
  { letter: "P", label: "Programming", detail: "GPS, radios and ForeFlight set before you roll. Don't fiddle with them on takeoff." },
];

/** Before crossing a runway threshold or turning base. */
export const GUMPS: MnemonicItem[] = [
  { letter: "G", label: "Gas", detail: "Fuel selector on BOTH." },
  { letter: "U", label: "Undercarriage", detail: "Gear down (fixed on this airplane) and tires inflated." },
  { letter: "M", label: "Mixture", detail: "Full rich." },
  { letter: "P", label: "Prop", detail: "High RPM — not applicable to a fixed-pitch airplane." },
  { letter: "S", label: "Seat belts", detail: "On, everyone." },
];

/**
 * The club's cancellation policy, quoted where it matters most: on the
 * checklist, at the moment somebody is deciding whether to talk themselves
 * into a flight.
 */
export const CANCELLATION_POLICY =
  "You can always cancel with no penalty — personal minimums, weather, mechanical, PAVE or I'M SAFE. Flying is a hobby, and it stops being fun when something about the flight doesn't feel right.";
