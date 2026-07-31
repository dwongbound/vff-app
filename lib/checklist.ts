// The preflight checklist: the club's I'M SAFE self-assessment, a Cessna 172S
// walkaround in POH order (cabin → empennage → right wing → nose → left wing →
// before start), and the 5 Ps before leaving the runup.
//
// Every item carries a `why`: what the check actually means and what it's
// there to catch. The preflight page hangs an (i) off each row and shows that
// text, so a newer member can learn the airplane while working down it instead
// of ticking boxes they don't understand.
//
// This is business logic, not schema: a PreflightCheck row stores answers as a
// { itemId: boolean } JSON map keyed by the ids below, so editing the checklist
// is a code change rather than a migration. Bump CHECKLIST_VERSION whenever
// item ids change so old runs stay interpretable (the row records the version
// it was answered against).
//
// Item ids are `<section>.<item>` and must never be reused for a different
// check — that's what would silently rewrite history.
import { FIVE_PS, IM_SAFE } from "./operatingRules";

// v2 added the I'M SAFE and 5 Ps sections from the club's operating rules.
export const CHECKLIST_VERSION = 2;

export interface ChecklistItem {
  id: string;
  label: string;
  /** The "…what exactly am I looking at?" line, shown under the label. */
  detail?: string;
  /** What this catches and why it matters — the (i) popover. */
  why: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  /** Where you're standing for this section. */
  subtitle?: string;
  items: ChecklistItem[];
}

// The club's I'M SAFE check, rendered as real checklist items so it can't be
// skipped by scrolling past it. Built from the operating rules so the wording
// lives in exactly one place.
const IM_SAFE_SECTION: ChecklistSection = {
  id: "imsafe",
  title: "I'M SAFE",
  subtitle: "Before you touch the airplane — are you fit to fly?",
  items: IM_SAFE.map((entry) => ({
    id: `imsafe.${entry.label.toLowerCase()}`,
    label: entry.label,
    why: entry.detail,
  })),
};

// The 5 Ps, run before you leave the runup pad.
const FIVE_PS_SECTION: ChecklistSection = {
  id: "fiveps",
  title: "5 Ps",
  subtitle: "Before you leave the runup",
  items: FIVE_PS.map((entry) => ({
    id: `fiveps.${entry.label.toLowerCase()}`,
    label: entry.label,
    why: entry.detail,
  })),
};

const WALKAROUND: ChecklistSection[] = [
  {
    id: "cabin",
    title: "Cabin",
    subtitle: "Before you step back outside",
    items: [
      {
        id: "cabin.docs",
        label: "Airworthiness documents aboard",
        detail: "ARROW — airworthiness, registration, radio (intl), POH, weight & balance",
        why: "Without them the airplane isn't legally airworthy, and you're the one who signs for that as PIC. Ten seconds now beats a ramp check conversation later.",
      },
      {
        id: "cabin.poh",
        label: "POH & checklists accessible",
        why: "The numbers you'd want in a hurry — best glide, emergency procedures — are in there. In the baggage compartment they may as well be at home.",
      },
      {
        id: "cabin.gust-lock",
        label: "Control wheel lock — removed",
        why: "A gust lock left in is a takeoff roll with no elevator authority. It's killed people; it's why this is item three.",
      },
      {
        id: "cabin.ignition",
        label: "Ignition switch — OFF, key out",
        why: "You're about to put your hands on the propeller. Treat the prop as live until the key is in your pocket.",
      },
      {
        id: "cabin.avionics",
        label: "Avionics master — OFF",
        why: "Protects the radios and the GPS from the voltage spike when the engine starts.",
      },
      {
        id: "cabin.fuel-gauges",
        label: "Master ON — fuel quantity & annunciators checked, then master OFF",
        detail: "Note the indicated fuel; you'll confirm it visually at the tanks",
        why: "Light-airplane fuel gauges are only required to be accurate at empty. This gives you a number to compare against what you actually see in the tanks.",
      },
      {
        id: "cabin.static",
        label: "Alternate static source — OFF / pushed in",
        why: "Left open, your altimeter and airspeed read off cabin pressure and quietly lie to you.",
      },
      {
        id: "cabin.extinguisher",
        label: "Fire extinguisher — charged & secure",
        why: "The one piece of equipment you'll want instantly and can't improvise. Loose, it becomes a projectile.",
      },
      {
        id: "cabin.baggage",
        label: "Baggage door — secured & locked",
        why: "A baggage door that pops in flight is loud, distracting, and takes your attention exactly when you don't have any spare.",
      },
    ],
  },
  {
    id: "empennage",
    title: "Empennage",
    subtitle: "Tail",
    items: [
      {
        id: "empennage.gust-lock",
        label: "Rudder gust lock — removed",
        why: "Same reason as the control lock: a jammed rudder discovered on the roll is not recoverable at low speed.",
      },
      {
        id: "empennage.tiedown",
        label: "Tail tie-down — disconnected",
        why: "Taxiing against a tie-down rope damages the airframe and makes a memorable story you'd rather not star in.",
      },
      {
        id: "empennage.surfaces",
        label: "Rudder & elevator — free, secure, hinges and bolts intact",
        why: "You're checking the hinges and the bolts, not just that it wiggles. A missing cotter pin is the kind of thing that only gets found by someone looking.",
      },
      {
        id: "empennage.trim",
        label: "Elevator trim tab — condition & security",
        why: "A trim tab that's loose or mis-rigged gives you a control force you'll be fighting all flight.",
      },
      {
        id: "empennage.antennas",
        label: "Antennas & beacon — secure, undamaged",
        why: "A cracked antenna base is both a radio you'll lose and a piece about to depart the airplane.",
      },
    ],
  },
  {
    id: "right-wing",
    title: "Right wing",
    items: [
      {
        id: "right.aileron",
        label: "Aileron — free movement, hinges secure",
        why: "Move it and watch the other one respond — that confirms the whole cable run, not just this end.",
      },
      {
        id: "right.flap",
        label: "Flap — condition, attach points secure",
        why: "An asymmetric flap failure is a roll you have to fight. The attach points are where it starts.",
      },
      {
        id: "right.tiedown",
        label: "Wing tie-down — disconnected",
        why: "Easy to miss on the side you don't walk past on the way in.",
      },
      {
        id: "right.tire",
        label: "Main wheel — tire inflation & wear, brake pads and lines",
        why: "Brakes are what stop you on a short field. A wet spot on the inside of the wheel is hydraulic fluid, and that's a no-go.",
      },
      {
        id: "right.sump",
        label: "Fuel sumps — sampled, clear of water & debris",
        detail: "Both quick-drains on this side, into a clear tester",
        why: "Water sits at the bottom of the tank and goes through the engine as a dead stop. Sample after every refuel and after rain.",
      },
      {
        id: "right.fuel",
        label: "Fuel quantity — visually verified, cap secure, vent clear",
        why: "Your eyes, not the gauge. A cap that isn't seated siphons fuel out in flight through the low pressure over the wing.",
      },
      {
        id: "right.wingtip",
        label: "Wingtip & nav/strobe light — condition",
        why: "Fresh damage to a wingtip means somebody hit something and may not have said so.",
      },
    ],
  },
  {
    id: "nose",
    title: "Nose & engine",
    items: [
      {
        id: "nose.oil",
        label: "Engine oil — checked, dipstick & filler cap secure",
        detail: "Minimum 5 qts; 6–8 qts for extended flight",
        why: "The engine will fly happily until it runs out of oil, then it stops. A filler cap left loose empties the sump onto the belly.",
      },
      {
        id: "nose.strainer",
        label: "Fuel strainer — drained, sample clear",
        why: "The strainer is the low point of the whole fuel system — water the wing sumps missed collects here.",
      },
      {
        id: "nose.prop",
        label: "Propeller & spinner — no nicks, cracks, or oil leaks",
        why: "A nick is a stress riser, and a propeller that fails does so catastrophically. Run a finger along the leading edge.",
      },
      {
        id: "nose.airfilter",
        label: "Induction air filter — clear, unobstructed",
        why: "A blocked filter starves the engine of air, most obviously right when you ask for full power.",
      },
      {
        id: "nose.cowling",
        label: "Cowling & baffles — secure, no fluid leaks",
        why: "Baffles are what force cooling air over the cylinders. Loose fasteners here mean parts coming off in the slipstream.",
      },
      {
        id: "nose.nosewheel",
        label: "Nose wheel — strut extension, tire, shimmy damper",
        why: "A flat strut means you've been landing nose-first, and a bad shimmy damper turns the rollout into a shake you can't steer through.",
      },
      {
        id: "nose.chocks",
        label: "Chocks — removed",
        why: "Adding power against chocks is an expensive way to learn they're still there.",
      },
      {
        id: "nose.alternator",
        label: "Alternator belt & wiring — condition",
        why: "Lose the alternator and you're on battery — a countdown to no radios, no transponder, and no flaps.",
      },
    ],
  },
  {
    id: "left-wing",
    title: "Left wing",
    items: [
      {
        id: "left.tiedown",
        label: "Wing tie-down — disconnected",
        why: "Same as the other side, and just as easy to walk past.",
      },
      {
        id: "left.tire",
        label: "Main wheel — tire inflation & wear, brake pads and lines",
        why: "Compare it against the right side — an obvious difference in wear or inflation is worth a second look.",
      },
      {
        id: "left.sump",
        label: "Fuel sumps — sampled, clear of water & debris",
        why: "Both tanks feed the engine on BOTH. Contamination on either side is contamination in the engine.",
      },
      {
        id: "left.fuel",
        label: "Fuel quantity — visually verified, cap secure, vent clear",
        why: "A blocked vent stops fuel flowing out of the tank, and the engine notices long before you work out why.",
      },
      {
        id: "left.pitot",
        label: "Pitot tube — cover removed, opening clear & warm to heat",
        why: "A blocked pitot means no airspeed indication on takeoff. Insects build nests in there in a single afternoon.",
      },
      {
        id: "left.stall-warn",
        label: "Stall warning vane — free, horn sounds with master on",
        why: "It's the only stall warning this airplane has, and it's a simple reed you can test in two seconds.",
      },
      {
        id: "left.fuel-vent",
        label: "Fuel vent — unobstructed",
        why: "The vent lets air in as fuel leaves. Blocked, the tank forms a vacuum and fuel flow stops.",
      },
      {
        id: "left.lights",
        label: "Landing / taxi light & wingtip — condition",
        why: "Required for night flight, and worth having in the pattern by day so other traffic can see you.",
      },
    ],
  },
  {
    id: "before-start",
    title: "Before start",
    subtitle: "Back in the cabin",
    items: [
      {
        id: "start.wb",
        label: "Weight & balance — within limits for this load",
        why: "Four adults and full fuel does not fit in a 172. Aft CG is the loading that will actually hurt you.",
      },
      {
        id: "start.wx",
        label: "Weather, TFRs & NOTAMs — reviewed",
        why: "Club rules: lower-time members must call a briefer rather than self-brief. Check the minimums that apply to you today.",
      },
      {
        id: "start.squawks",
        label: "Open squawks — reviewed, airplane airworthy",
        why: "Club rules: if there's an open squawk and you're building time, call the Safety Officer before you fly it.",
      },
      {
        id: "start.seats",
        label: "Seats & belts — adjusted, locked, fastened",
        why: "A seat that slides back on rotation takes the yoke with it. Push against the rails to confirm the lock caught.",
      },
      {
        id: "start.doors",
        label: "Doors & windows — closed and latched",
        why: "A door popping open on climbout is startling and loud — fly the airplane, come back and land normally.",
      },
      {
        id: "start.brakes",
        label: "Brakes — tested and set",
        why: "Find out they're soft while stationary, not while rolling toward the fuel pumps.",
      },
      {
        id: "start.fuel-selector",
        label: "Fuel selector — BOTH",
        why: "BOTH for takeoff and landing, every time. It's also the G in GUMPS on the way back in.",
      },
    ],
  },
];

export const PREFLIGHT_CHECKLIST: ChecklistSection[] = [
  IM_SAFE_SECTION,
  ...WALKAROUND,
  FIVE_PS_SECTION,
];

/** Every item id on the checklist, in walkaround order. */
export function allItemIds(): string[] {
  return PREFLIGHT_CHECKLIST.flatMap((s) => s.items.map((i) => i.id));
}

export const TOTAL_ITEMS = allItemIds().length;

export type Answers = Record<string, boolean>;

/**
 * Normalize whatever came out of the db's JSON column into a plain
 * { itemId: true } map, dropping ids that are no longer on the checklist.
 */
export function parseAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = new Set(allItemIds());
  const out: Answers = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (valid.has(key) && value === true) out[key] = true;
  }
  return out;
}

/** How many items are ticked. */
export function countChecked(answers: Answers): number {
  return allItemIds().filter((id) => answers[id]).length;
}

/** Ticked items in one section — drives the per-section "4/9" counter. */
export function countSectionChecked(
  section: ChecklistSection,
  answers: Answers
): number {
  return section.items.filter((i) => answers[i.id]).length;
}

/** Items still outstanding, in checklist order. */
export function missingItems(answers: Answers): ChecklistItem[] {
  return PREFLIGHT_CHECKLIST.flatMap((s) =>
    s.items.filter((i) => !answers[i.id])
  );
}

/** A run may only be signed off once every item is ticked. */
export function isComplete(answers: Answers): boolean {
  return countChecked(answers) === TOTAL_ITEMS;
}
