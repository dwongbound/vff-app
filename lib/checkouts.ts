// The club's checkouts, as data.
//
// A "checkout" is one pass over the airplane, start to finish, signed off by
// the member who walked it. There are three, and together they are N8318B's
// own laminated cards transcribed item for item:
//
//   PREFLIGHT_CHECKOUT — the preflight card (Rev C): homework, consumables,
//     cockpit, then the walk itself — left wing → nose → right wing →
//     fuselage/empennage — and the standard weather briefing.
//   RUNWAY_CHECKOUT — the front of the in-cockpit card: passengers, before
//     starting, the cold-start pre-lube, starting, the runup, and pre-takeoff.
//     From sitting down to releasing the brakes at the hold-short line.
//   TURNOFF_CHECKOUT — the back of the same card: after landing, shutdown, and
//     outside parking. Answered on the post-flight form, hours later.
//
// The cards are the spine; everything the club adds to them is marked
// `club: true`, so it's obvious which items came off the airplane and which
// came out of VFF-OR-A or out of the club's own practice: I'M SAFE at the top
// of the preflight, the open squawks review beside it, the 5 Ps at the end of
// the runup, the closing walkaround, the tach/Hobbs reading, the tail controls
// moving freely, the starter crank that ends the cold-start pre-lube, and the
// housekeeping line at the parking end that sets the flight log's "cabin clean"
// flag. Everything else is on a card.
//
// The reverse also happens: a line comes OFF when the card asks for something
// this airframe can't be asked. Both brake items lost "pads" — N8318B wears
// wheel fairings — and the starting flow lost its master switch line, which the
// before-start beacon item had already required.
//
// What is NOT here: takeoff, climb, cruise and descent. Those are read in the
// air with the app in somebody's pocket, so they live in lib/inflightReference
// as read-only data and can never be an unticked box blocking a sign-off.
//
// All three are keyed to N8318B, the club's 1957 Cessna 172: a carburetted
// Continental, so carb heat, a primer, and a hand pre-lube on a cold morning —
// and an airspeed indicator in MPH. Every RPM, pressure and temperature below
// is quoted from the airplane's own card rather than a generic 172.
//
// Every item carries a `why`: what the check actually means and what it's there
// to catch. The pages hang an (i) off each row and show that text, so a newer
// member can learn the airplane while working down it instead of ticking boxes
// they don't understand.
//
// This is business logic, not schema. A Checkout row stores answers as a
// { itemId: true } JSON map keyed by the ids below, so editing a card is a code
// change rather than a migration. Bump the matching `version` whenever item ids
// change, so old runs stay interpretable — every row records the version it was
// answered against.
//
// Item ids are `<section>.<item>` and must never be reused for a DIFFERENT
// check; that's what would silently rewrite history. Reusing one for the same
// physical check reworded is fine, and is what the version stamp is for.
import { clubTimeNow } from "./dates";
import { FIVE_PS, IM_SAFE } from "./operatingRules";

/** Which card is being walked. Stored on the row; see prisma CheckoutKind. */
export type CheckoutKind = "PREFLIGHT" | "RUNWAY" | "TURNOFF";

/**
 * A number the card asks you to WRITE DOWN, recorded on the item itself.
 *
 * Several items aren't really yes/no — "dip fuel tanks, record quantity",
 * "oil, minimum 4 quarts", "magnetos, max 100 RPM drop". Ticking those and
 * then typing the figure into a separate box further down the page is how a
 * reading gets transcribed wrong, so the field lives on the row that asks for
 * it.
 *
 * `expected` is the card's own figure. Falling outside it is a WARNING shown
 * under the field, never a block: the app's job is to tell you the reading is
 * unusual, not to decide whether you fly.
 */
export interface CheckoutField {
  /** `<itemId>.<name>` — the key these values are stored under. */
  id: string;
  label: string;
  /** "gal", "qts", "psi", "RPM drop". */
  unit?: string;
  kind: "number" | "time";
  step?: number;
  min?: number;
  max?: number;
  expected?: { min?: number; max?: number; note: string };
  /**
   * Start a fresh run with the current club time already in it (time fields
   * only — see `initialValues`).
   *
   * These are all "read the clock and write it down" moments, and the clock
   * they mean is the one at the field, so the default is stamped from
   * `CLUB_TIME_ZONE` rather than the device. It is a DEFAULT, not a stamp: the
   * pilot can type over it, and filling it does NOT tick the item, because
   * nobody has confirmed anything by opening a page.
   */
  defaultNow?: boolean;
}

export interface CheckoutItem {
  id: string;
  /** "Item — action", the way the card prints it. */
  label: string;
  /** Readings this item records. Rendered inline, under the label. */
  fields?: CheckoutField[];
  /** The "…what exactly am I looking at?" line, shown under the label. */
  detail?: string;
  /** What this catches and why it matters — the (i) popover. */
  why: string;
  /**
   * An item that doesn't apply to every flight (the card's "IFR only" line).
   * Stored when ticked, never counted toward sign-off.
   */
  optional?: boolean;
  /** Not on the card — the club's own addition. Rendered with a marker. */
  club?: boolean;
  /**
   * The page in this app that DOES this item's work.
   *
   * A few of these checks are arithmetic the app already knows how to do, and
   * a member standing at the wing with the card open shouldn't have to
   * remember which tab it was on. Static, and part of the card rather than of
   * a run: unlike the toned notes a page passes in as `itemNotes`, this says
   * nothing about today's airplane, so it lives here with the item.
   *
   * It never ticks anything and it never blocks a sign-off — the pilot still
   * confirms the row, because the app can compute the numbers and cannot know
   * you looked at them. (Rendered by CheckoutList only; TurnoffCheckout is
   * deliberately flat and drops `detail` for the same reason.)
   */
  link?: { href: string; label: string };
}

export interface CheckoutSection {
  id: string;
  title: string;
  /** Where you're standing, or when you run it. */
  subtitle?: string;
  /**
   * A whole section that doesn't apply to every flight — the cold-start
   * pre-lube. Same rule as an optional item: stored, never demanded. Anything
   * required on every flight must never be marked optional.
   */
  optional?: boolean;
  items: CheckoutItem[];
}

export interface Checkout {
  kind: CheckoutKind;
  /** What the page calls it. */
  title: string;
  /** One line: when you run this one. */
  tagline: string;
  /**
   * Version these answers were given against. Independent per checkout — they
   * live on different columns and move at different paces.
   */
  version: number;
  sections: CheckoutSection[];
}

// ── The club's two mnemonics, as real tickable items ──────────────────────
// Built from the operating rules so the wording lives in exactly one place,
// and rendered as items rather than prose so they can't be skipped by
// scrolling past them.

const IM_SAFE_SECTION: CheckoutSection = {
  id: "imsafe",
  title: "I'M SAFE",
  subtitle: "Before you touch the airplane — are you fit to fly?",
  items: IM_SAFE.map((entry) => ({
    id: `imsafe.${entry.label.toLowerCase()}`,
    label: entry.label,
    why: entry.detail,
    club: true,
  })),
};

const FIVE_PS_SECTION: CheckoutSection = {
  id: "fiveps",
  title: "5 Ps",
  subtitle: "Before you leave the runup",
  items: FIVE_PS.map((entry) => ({
    id: `fiveps.${entry.label.toLowerCase()}`,
    label: entry.label,
    why: entry.detail,
    club: true,
  })),
};

// ── Preflight checkout ─────────────────────────────────────────────────────
// N8318B's preflight card, Rev C. Section order is the card's own: the planning
// you did at home, then the consumables, then the cockpit, then a walk that
// goes left wing → nose → right wing → tail and puts you back at the door.

const PREFLIGHT_SECTIONS: CheckoutSection[] = [
  IM_SAFE_SECTION,
  {
    id: "homework",
    title: "Homework",
    subtitle: "Done before you drove to the field",
    items: [
      {
        id: "homework.wb",
        label: "Weight and balance — within limits for this load",
        why: "Four adults and full fuel does not fit in a 172. Aft CG is the loading that will actually hurt you, and it's the one that feels fine until the flare.",
        // The tool holds this airframe's own basis off its latest signed W&B
        // revision, so the answer it gives is N8318B's rather than a generic
        // 172's. Linked from here because this is where the question gets
        // asked — and it's also the row where somebody who did the numbers at
        // home wants to check the load that changed in the car park.
        link: { href: "/tools/weight-balance", label: "Run the numbers" },
      },
      {
        id: "homework.performance",
        label: "Takeoff / landing performance — computed for today",
        why: "Density altitude on a warm day turns the book numbers into fiction. Run them for the temperature and weight you actually have.",
      },
      {
        id: "homework.runways",
        label: "Runways — origin and destination",
        detail: "Lengths, surface, and the wind you expect on each",
        why: "Knowing the runway before you get there is what stops a downwind landing on a strip that was long enough only into wind.",
      },
      {
        id: "homework.fuel",
        label: "Fuel requirements — trip, reserve, and alternate",
        why: "Fuel exhaustion is a planning failure, not a flying one. Work out what you need on the ground where a calculator can help.",
      },
      {
        id: "homework.alternates",
        label: "Alternates — picked, with fuel to reach them",
        why: "The airport you divert to should be a decision you already made, not one you make at 1,500 feet with a lowering ceiling.",
      },
      {
        id: "homework.notams",
        label: "NOTAMs — checked",
        why: "Closed runways, unlit towers and TFRs all live here. It's the cheapest violation to avoid.",
      },
      {
        id: "homework.atc-delays",
        label: "Known ATC delays — checked",
        why: "A hold on the ground burns the reserve you planned. Better to know before you start the engine than while you're taxiing.",
      },
      {
        id: "homework.weather",
        label: "Weather — reviewed",
        detail: "Club rules: lower-time members call a briefer rather than self-brief",
        why: "The forecast is the go/no-go for most flights that shouldn't happen. Check it against the minimums that apply to YOU today, not the ones that apply to the airplane.",
      },
      {
        id: "homework.squawks",
        label: "Open squawks — reviewed, airplane airworthy",
        why: "Club rules: if there's an open squawk and you're still building time, call the Safety Officer before you fly it. The squawks are listed at the top of this page.",
        club: true,
      },
    ],
  },
  {
    id: "consumables",
    title: "Consumables",
    subtitle: "What the airplane runs on",
    items: [
      {
        id: "consumables.sumps",
        label: "Fuel sumps (×4) — contaminant free",
        detail: "All four quick-drains, into a clear tester",
        why: "Water sits at the bottom of the tank and goes through the engine as a dead stop. Sample all four after every refuel and after rain.",
      },
      {
        id: "consumables.dip",
        // A tank a side, recorded a side. You dip them separately — walk to
        // one wing, then the other — and a single total is a sum done on a
        // ladder from memory. It also makes a lopsided load visible: this
        // airplane feeds from BOTH in the cruise, and 30 gallons sitting 25/5
        // is a different airplane from one sitting 15/15.
        fields: [
          {
            id: "consumables.dip.left",
            label: "Left wing",
            unit: "gal",
            kind: "number",
            step: 0.5,
            min: 0,
            expected: { max: 21, note: "Each tank holds 21 gal (18.5 usable)." },
          },
          {
            id: "consumables.dip.right",
            label: "Right wing",
            unit: "gal",
            kind: "number",
            step: 0.5,
            min: 0,
            expected: { max: 21, note: "Each tank holds 21 gal (18.5 usable)." },
          },
        ],
        label: "Dip fuel tanks — record quantity each side, caps secure",
        why: "Your eyes, not the gauge — light-airplane fuel gauges are only required to be accurate at empty. A cap that isn't seated siphons fuel out in flight through the low pressure over the wing.",
      },
      {
        id: "consumables.oil",
        fields: [
          {
            id: "consumables.oil.qts",
            label: "Oil",
            unit: "qts",
            kind: "number",
            step: 0.5,
            min: 0,
            expected: { min: 4, note: "Below the card's 4-quart minimum." },
          },
        ],
        label: "Oil — minimum 4 quarts",
        why: "Four is this airplane's floor, not its target. The engine will fly happily until it runs out of oil, and then it stops.",
      },
      {
        id: "consumables.dipstick",
        label: "Dipstick & oil access door — seated",
        why: "A filler cap or access door left loose empties the sump onto the belly and coats the windscreen on the way past.",
      },
      {
        // No fields: the club checks the tires but doesn't log the gauge
        // reading. Nobody carries a gauge on every walkaround, so the honest
        // check is "do they look right" — and a psi box that gets left empty
        // on nine runs out of ten teaches people to skip boxes.
        id: "consumables.tires",
        label: "Tire pressure — nose 26 psi, mains 23 psi",
        why: "The card's numbers for this airplane. Soft mains make the airplane wander on the roll; a soft nose strut means you've been landing nose-first.",
      },
      {
        id: "consumables.ifr",
        label: "IFR only — VOR check (30 days), GPS database current",
        optional: true,
        why: "Only if you're going IFR: a VOR check inside 30 days and a current database are what make the navigation legal to fly an approach with. Skip it on a VFR day.",
      },
    ],
  },
  {
    id: "cockpit",
    title: "Cockpit",
    subtitle: "Sitting in it, before you step back outside",
    items: [
      {
        id: "cockpit.time",
        fields: [
          { id: "cockpit.time.at", label: "Time", kind: "time", defaultNow: true },
        ],
        label: "Time — recorded",
        why: "The clock reading you start from. Written down here, it can't be reconstructed wrongly in the car park afterwards.",
      },
      {
        id: "cockpit.brake-chocks",
        label: "Parking brake, chocks & tie-downs — checked",
        why: "Know what's still holding the airplane before you start it. Adding power against a chock or taxiing against a rope is an expensive way to find out.",
      },
      {
        id: "cockpit.mags",
        label: "Magnetos — OFF",
        why: "You're about to put your hands on the propeller. A magneto can fire a cylinder with the master off, so this is the switch that matters.",
      },
      {
        id: "cockpit.mixture",
        label: "Mixture — cut off",
        why: "The other half of making the propeller safe to touch: no fuel to fire on even if a magneto is live.",
      },
      {
        id: "cockpit.fuel-gauges",
        label: "Fuel gauges — verify quantity",
        why: "Compare what the gauges claim against what you saw in the tanks. Two sources agreeing is the point; two disagreeing is a squawk.",
      },
      {
        id: "cockpit.master-on",
        label: "Master switch — ON",
        why: "Just for the checks below. Everything from here to the second master item runs on the battery, so work through it without dawdling.",
      },
      {
        // Deliberately AFTER the master switch, though it's the club's own item
        // rather than the card's: the Hobbs is electric and reads nothing with
        // the master off, so asking for both meters before the switch is
        // asking for a number that isn't on the panel yet.
        id: "cockpit.meters",
        label: "Tach & Hobbs — recorded",
        fields: [
          {
            id: "cockpit.meters.tach",
            label: "Tach start",
            unit: "hrs",
            kind: "number",
            step: 0.1,
            min: 0,
          },
          {
            id: "cockpit.meters.hobbs",
            label: "Hobbs start",
            unit: "hrs",
            kind: "number",
            step: 0.1,
            min: 0,
          },
        ],
        detail: "Prefilled from the last filed flight — correct them against the panel",
        why: "The club's addition, not the card's: read the meters while you're sitting in front of them, with the master on so the Hobbs is alive. Prefilled from where the last flight left the airplane, so the common case is confirming two numbers — and a reading that DISAGREES with the prefill is worth chasing, because it usually means somebody flew and didn't file.",
        club: true,
      },
      {
        id: "cockpit.stall-warning",
        label: "Stall warning — check",
        why: "It's the only stall warning this airplane has, and it's a simple reed you can test in two seconds with the master on.",
      },
      {
        id: "cockpit.lights-exterior",
        label: "Lights: taxi, landing, nav, beacon — check",
        why: "Required for night flight, and worth having by day so the traffic on final can see you. Walk out and look rather than trusting the switch.",
      },
      {
        id: "cockpit.lights-panel",
        label: "Lights: panel lighting — check",
        why: "The one you only discover is dead after sunset, at which point you're flying an airplane whose instruments you can't read.",
      },
      {
        id: "cockpit.master-off",
        label: "Master switch — OFF",
        why: "Back off before you go outside. The starter wants the whole battery, and a master left on through a long walkaround is a flat one.",
      },
      {
        id: "cockpit.controls",
        label: "Flight controls — proper operation",
        why: "Free is only half of it: the surfaces have to move the RIGHT way. A mis-rigged control that's perfectly free will still roll you into the ground.",
      },
      {
        id: "cockpit.windows",
        label: "Windows — clean",
        detail: "Wipe only in the direction of airflow",
        why: "Across the airflow leaves scratches that catch the sun exactly where you look for traffic. This plexiglass is older than most of the club.",
      },
      {
        id: "cockpit.papers",
        label: "Papers — check ARROW",
        detail: "Airworthiness, registration, radio (intl), POH, weight & balance",
        why: "Without them the airplane isn't legally airworthy, and you're the one who signs for that as PIC. Ten seconds now beats a ramp check conversation later.",
      },
      {
        id: "cockpit.flaps",
        label: "Flaps — check all 4 notches, leave DOWN",
        why: "Run them through every notch so you'd notice one that hesitates, and leave them down: that's what puts the flap rollers and rods where you can actually see them on the walk.",
      },
    ],
  },
  {
    id: "left-wing",
    title: "Left wing",
    subtitle: "Start of the walk",
    items: [
      {
        id: "left.surface",
        label: "Surface condition — clear of ice, frost, snow",
        why: "Frost no thicker than sandpaper is enough to stop the wing flying. There is no acceptable amount to take off with.",
      },
      {
        id: "left.air-inlet",
        label: "Fresh air inlet — clear",
        why: "Blocked, you lose cabin ventilation — and whatever is blocking it is usually a nest that's been building for a while.",
      },
      {
        id: "left.fuel-vent",
        label: "Fuel vent — clear",
        why: "The vent lets air in as fuel leaves. Blocked, the tank forms a vacuum and fuel flow stops — this side's vent feeds both tanks on BOTH.",
      },
      {
        id: "left.landing-light",
        label: "Landing light lens — undamaged",
        why: "A cracked lens lets water into the fitting, and the light fails on the night you actually wanted it.",
      },
      {
        id: "left.pitot",
        label: "Pitot tube cover — removed, opening free",
        why: "A blocked pitot means no airspeed on takeoff, and this airplane's ASI reads in MPH — you want it working before you go looking for 55–60 on the roll. Insects build nests in there in a single afternoon.",
      },
      {
        id: "left.wingtip",
        label: "Nav light and wing tip — undamaged",
        why: "Fresh damage to a wingtip means somebody hit something and may not have said so.",
      },
      {
        id: "left.aileron",
        label: "Aileron — control rod, counterweights, cotter pins",
        why: "You're checking the hardware, not just that it wiggles. A missing cotter pin is the kind of thing only found by someone actually looking.",
      },
      {
        id: "left.flaps",
        label: "Flaps — rollers, control rod",
        why: "This is why you left them down. An asymmetric flap failure is a roll you have to fight, and it starts at these attach points.",
      },
      {
        id: "left.gear",
        label: "Landing gear and brake line — undamaged",
        why: "A wet spot anywhere along the brake line is hydraulic fluid, and that's a no-go rather than a maybe.",
      },
      {
        id: "left.brake",
        // No pads on this line, on purpose: N8318B wears wheel fairings, and
        // the pad stack is behind them. A card that asks for a check nobody
        // can make teaches members to tick things they haven't looked at.
        label: "Brake — leaks, disc",
        why: "Brakes are what stop you on a short field. The fairings hide the pads on this airplane, so what you have is the disc face and any wet spot around the caliper — take both seriously.",
      },
    ],
  },
  {
    id: "nose",
    title: "Nose",
    subtitle: "Round the front",
    items: [
      {
        id: "nose.static",
        label: "Static port — clear",
        why: "Blocked, the altimeter and the airspeed indicator both quietly lie to you, and they do it smoothly enough that you may believe them.",
      },
      {
        id: "nose.access-door",
        label: "Access door — check engine, confirm latched",
        why: "Your one look at the engine itself: oil on the case, chafed wires, anything hanging. Then latch it — a door that opens in flight takes paint and attention with it.",
      },
      {
        id: "nose.cowling",
        label: "Cowling fasteners — check",
        why: "The cowl is what forces cooling air over the cylinders. A missing fastener means parts departing into the slipstream and a prop behind them.",
      },
      {
        id: "nose.strut",
        label: "Nose gear strut — 4 fingers showing",
        why: "The card's own gauge for this airplane. Flat, and the shimmy on rollout is one you can't steer through.",
      },
      {
        id: "nose.prop",
        label: "Propeller and spinner — no nicks, dents",
        why: "A nick is a stress riser, and a propeller that fails does so catastrophically. Run a finger along the leading edge — you'll feel what you can't see.",
      },
      {
        id: "nose.air-filter",
        label: "Air filter — clear",
        why: "A blocked filter starves the engine of air, most obviously right when you ask for full power on the takeoff roll.",
      },
      {
        id: "nose.transponder-antenna",
        label: "Transponder antenna — check",
        why: "A cracked antenna base is both a transponder you'll lose in Class B and a piece about to leave the airplane.",
      },
      {
        id: "nose.gps-antenna",
        label: "GPS antenna — check",
        why: "Same check, and the one you'd miss because it sits flat on top where nobody looks.",
      },
    ],
  },
  {
    id: "right-wing",
    title: "Right wing",
    subtitle: "Down the other side",
    items: [
      {
        id: "right.surface",
        label: "Surface condition — clear of ice, frost, snow",
        why: "Check it even if the left wing was clean: one wing in shade and one in sun is exactly how you end up with lift on one side only.",
      },
      {
        id: "right.air-inlet",
        label: "Fresh air inlet — clear",
        why: "Same as the other side, and just as good a place for a nest.",
      },
      {
        id: "right.wingtip",
        label: "Nav light and wing tip — undamaged",
        why: "This is the side you didn't walk past on the way in, so it's the side where yesterday's damage is still waiting to be found.",
      },
      {
        id: "right.aileron",
        label: "Aileron — control rod, counterweights, cotter pins",
        why: "Move it and watch the other one respond — that confirms the whole cable run, not just this end.",
      },
      {
        id: "right.flaps",
        label: "Flaps — rollers, control rod",
        why: "Compare it against the left: flaps that don't sit symmetrically on the ground won't fly symmetrically either.",
      },
      {
        id: "right.gear",
        label: "Landing gear and brake line — undamaged",
        why: "Compare the wear and inflation against the other main. An obvious difference is worth a second look.",
      },
      {
        id: "right.brake",
        // Same reason as the left one: the pads are behind the fairing.
        label: "Brake — leaks, disc",
        why: "One weak brake is worse than two: it's what turns you off the centreline when you need the pedals most. Compare this disc and caliper against the left main — a difference between the two is the thing you can see without pulling a fairing.",
      },
    ],
  },
  {
    id: "empennage",
    title: "Fuselage / empennage",
    subtitle: "Down the side to the tail",
    items: [
      {
        id: "empennage.comm",
        label: "Comm antennas — check",
        why: "Secure at the base and undamaged. On a 1957 airframe the antenna mounts are as old as the airplane.",
      },
      {
        id: "empennage.elt",
        label: "ELT antenna — check",
        why: "The ELT is the thing that talks for you when you can't. A detached antenna means it transmits to nobody.",
      },
      {
        id: "empennage.nav-antenna",
        label: "NAV antenna — check",
        why: "Same check, and it's the one you'd want intact on the day the GPS gives up.",
      },
      {
        id: "empennage.stab",
        label: "Horizontal stabiliser — surface condition",
        why: "Ripples or fresh creases here mean the tail took a load it shouldn't have — a hangar rash story somebody didn't write up.",
      },
      {
        id: "empennage.elevator",
        // The trim tab hangs off the elevator and is inspected in the same
        // reach, so it's the same line rather than one more thing to walk to.
        label: "Elevator and trim tab — counterweights, nuts, cotter pins",
        why: "Elevator hardware is single-point: there is no second elevator. Look at the nuts and the pins, not just the movement — and give the trim tab the same look, including its own actuator rod and hinge.",
      },
      {
        id: "empennage.rudder",
        label: "Rudder — nuts, cotter pins",
        why: "The same rule as the elevator. A jammed or disconnected rudder found on the roll is not recoverable at low speed.",
      },
      {
        // The club's own line, and it follows the two hardware checks above on
        // purpose: those say everything is still attached, this says nothing is
        // binding. Two different failures, and looking at a hinge tells you
        // nothing about the second one — you have to move the surface.
        id: "empennage.controls-free",
        club: true,
        label: "Elevator, trim and rudder — move freely",
        why: "Move each one by hand through its full travel and let it go. Stiffness, a catch at one end, or a surface that won't come back is something binding behind the skin — and the takeoff roll is a bad place to discover which control you haven't got.",
      },
    ],
  },
  {
    // The club's own addition, and the only section that isn't on the card.
    //
    // Every item above it is a close look at ONE thing, with your nose a foot
    // from it. That's the right way to find a cracked bracket and the wrong
    // way to notice that the airplane is sitting a bit low on the left, or
    // that there's a puddle under it, or that the tow bar is still on the nose
    // wheel — the whole-airplane problems, which are the ones you see by
    // standing back. So the walk ends by stepping away from it and doing one
    // slow lap with no checklist in your hand.
    id: "walkaround",
    title: "Walkaround",
    subtitle: "Step back and do one slow lap",
    items: [
      {
        id: "walkaround.lap",
        label: "Full 360 — anything that looks wrong",
        detail: "From a few paces back, all the way round",
        club: true,
        why: "The catch-all, and the only check on the card with no list. You have just spent twenty minutes looking at parts; this is the one look at the whole airplane. If something makes you pause here, it is worth the time to find out what it was.",
      },
      {
        id: "walkaround.stance",
        label: "Stance — sits level, struts and tires even",
        club: true,
        why: "A soft tire or a flat strut is obvious from ten feet away and nearly invisible with your hand on it. An airplane that isn't sitting square is telling you something before you get in.",
      },
      {
        id: "walkaround.ground",
        label: "Ground underneath — no fresh fuel or oil, nothing left behind",
        club: true,
        why: "A wet patch under the airplane is the leak you didn't find, and it costs nothing to look. Same glance catches the tow bar, chocks, a fuel tester or a cowl plug still attached — every one of which has been flown with by somebody.",
      },
      {
        id: "walkaround.clear",
        label: "Around and above — clear to start and taxi",
        club: true,
        why: "Where the airplane is about to go, before anything is running: obstructions off the nose, other aircraft, the fuel truck, and anybody's cart parked behind a wing you're about to swing.",
      },
    ],
  },
  {
    id: "briefing",
    title: "Standard briefing",
    subtitle: "The weather picture, in the card's order",
    items: [
      {
        id: "briefing.departure",
        label: "Departure conditions and NOTAMs",
        why: "What you're taking off into, and what's closed or unlit where you're standing.",
      },
      {
        id: "briefing.destination",
        label: "Destination conditions and NOTAMs",
        why: "The half of the flight you can't see out of the window. It's also what decides whether the alternate you picked is the right one.",
      },
      {
        id: "briefing.tfrs",
        label: "TFRs",
        why: "They appear at short notice around sport, fires and visiting politicians, and the consequences of entering one are out of all proportion to the mistake.",
      },
      {
        id: "briefing.sigmets",
        label: "SIGMETs / AIRMETs",
        why: "The big-picture hazards — turbulence, icing, IFR conditions — across a whole region rather than one field.",
      },
      {
        id: "briefing.pireps",
        label: "PIREPs",
        why: "The only part of the briefing written by somebody who was actually up there today. Worth more than the forecast where the two disagree.",
      },
      {
        id: "briefing.tafs",
        label: "TAFs",
        why: "What the field is forecast to do while you're gone, which is what your fuel reserve is really for.",
      },
      {
        id: "briefing.winds",
        label: "Winds aloft",
        why: "Groundspeed and therefore endurance. A 25-knot headwind on a 90-knot airplane is a third of your range gone.",
      },
      {
        id: "briefing.surface",
        label: "Surface analysis",
        why: "Fronts and pressure systems tell you which way the day is moving — whether the weather you have is improving or is the good part.",
      },
      {
        id: "briefing.icing",
        label: "Icing — freezing levels, CIP/FIP",
        why: "This airplane has no anti-ice of any kind. Knowing where the freezing level is means knowing the altitude you must not climb into.",
      },
      {
        id: "briefing.area",
        label: "Area forecast — tops, bottoms, trends",
        why: "Where the cloud starts and stops, so a VFR-on-top decision is made on the ground rather than halfway up.",
      },
    ],
  },
];

// ── Runway checkout ────────────────────────────────────────────────────────
// The front of the in-cockpit card, from the cabin door to the hold-short line.
// The walkaround is behind you by this point: everything below happens sitting
// in the airplane.

const RUNWAY_SECTIONS: CheckoutSection[] = [
  {
    id: "passengers",
    title: "Passengers",
    subtitle: "Before anyone gets in",
    items: [
      {
        id: "passengers.brief",
        label: "Passenger brief — complete",
        detail: "Doors and exits, belts, sterile cockpit, don't touch the controls, no smoking",
        why: "Your passengers have no idea what's normal. Brief them once on the ground and they won't grab something at the worst moment, or sit quietly through a problem you'd have wanted to hear about.",
      },
      {
        id: "passengers.belts",
        label: "Seat belts — adjust and lock",
        why: "Everyone, every flight, snug enough to matter in turbulence. You are the one legally responsible for telling them to fasten it.",
      },
      {
        id: "passengers.atis",
        label: "Weather / ATIS — check",
        detail: "Current field conditions, altimeter setting, runway in use",
        why: "The forecast you read at home is not the wind you're about to take off into. This is the last look before you commit.",
      },
    ],
  },
  {
    id: "before-start",
    title: "Before starting engine",
    items: [
      {
        id: "start.preflight",
        label: "Preflight — complete",
        detail: "The preflight checkout, completed",
        why: "The card's own first item, and the hinge between the two checkouts: the airplane has been walked and signed for before anything electrical goes on.",
      },
      {
        id: "start.fuel-selector",
        label: "Fuel selector — BOTH",
        why: "BOTH for takeoff and landing, every time. It's also the G in GUMPS on the way back in.",
      },
      {
        id: "start.breakers",
        label: "Circuit breakers — check",
        why: "A breaker found popped on the ground is a fault that already happened once. Finding it now beats finding it when you need what's behind it.",
      },
      {
        id: "start.electrical",
        label: "Electrical equipment — OFF",
        why: "Everything off before the master goes on means the starter gets the whole battery, and nothing downstream eats the voltage spike when the engine catches.",
      },
      {
        id: "start.radios",
        label: "Radios / transponder — OFF",
        why: "Same reason: solid-state boxes don't enjoy being powered through a start. They go on afterwards, in the starting flow.",
      },
      {
        id: "start.beacon",
        label: "Beacon — ON",
        why: "The beacon is how everyone on the ramp knows this airplane is about to turn a propeller. It goes on before the master, not after the engine.",
      },
      {
        id: "start.brakes",
        label: "Brakes — test / set",
        why: "Find out they're soft while stationary, not while rolling toward the fuel pumps.",
      },
    ],
  },
  {
    id: "prelube",
    title: "Pre-lube",
    subtitle: "Cold start only — skip it on a warm engine",
    optional: true,
    items: [
      {
        id: "prelube.throttle",
        label: "Throttle — open 1/8″",
        why: "Set where you want it before your hands are outside at the propeller, so nothing has to be reached for afterwards.",
      },
      {
        id: "prelube.mixture",
        label: "Mixture — cutoff",
        why: "With the mixture cut there's no fuel to fire on, which is half of what makes hand-turning the propeller survivable.",
      },
      {
        id: "prelube.mags",
        label: "Magnetos — confirm OFF",
        why: "The other half. A magneto can fire a cylinder with the master off and the key out — confirm OFF, and still treat the propeller as live.",
      },
      {
        id: "prelube.prop",
        label: "Propeller area — clear, prop pulled through by hand",
        why: "Overnight the oil drains off the cylinder walls. Turning it through by hand gets oil moving before the starter spins a dry engine.",
      },
      {
        // Last of the pre-lube, and the reason the three items above it are
        // where they are: mixture cut and mags OFF is what makes it legal to
        // spin the engine without it starting.
        id: "prelube.crank",
        club: true,
        label: "Crank engine — ~2 full propeller rotations",
        why: "The starter turns the oil pump, which the hand pull doesn't. Two turns puts pressure back on the bearings before the first cold start of the day fires — with the mixture still cut, so it turns without catching.",
      },
    ],
  },
  {
    id: "starting",
    title: "Starting engine",
    items: [
      {
        id: "starting.timer",
        fields: [
          { id: "starting.timer.at", label: "Started", kind: "time", defaultNow: true },
        ],
        label: "Flight timer — start",
        why: "Start it here and it matches what you'll write in the log. Started late, every flight quietly under-reports.",
      },
      {
        id: "starting.mixture",
        label: "Mixture — rich",
        why: "The engine needs a rich mixture to catch. You'll lean it again in the cruise, not before.",
      },
      {
        id: "starting.primer",
        label: "Primer — 1 pump",
        why: "The primer squirts raw fuel into the cylinders — this engine has no fuel pump to do it for you. Left unlocked it can work out in flight and run the engine rich enough to quit.",
      },
      {
        id: "starting.throttle",
        label: "Throttle — open 1/8″",
        why: "Enough to keep it running once it catches, little enough that it doesn't leap forward against the brakes.",
      },
      {
        id: "starting.mags",
        label: "Magnetos — BOTH",
        why: "Both, so the start has two chances at every cylinder.",
      },
      {
        id: "starting.carb-heat",
        label: "Carb heat — cold",
        why: "Carb heat bypasses the air filter. On the ground that's unfiltered ramp dust straight into the engine, so it stays cold until you actually need it.",
      },
      {
        id: "starting.prop-clear",
        label: "Propeller area — clear",
        detail: "Look, call “CLEAR PROP”, then wait a beat",
        why: "The person walking up behind the wing can't see what you're about to do, and the pause is what gives them time to answer.",
      },
      // No master switch line here. The before-start flow above already has
      // "Beacon — ON", which can't be done with the master off — so by the time
      // anyone reaches the starter the switch is on, and a line asking for it
      // is a box ticked from memory rather than from the panel.
      {
        id: "starting.starter",
        label: "Starter — engage",
        why: "In short bursts. Grinding away at it overheats the starter and flattens the battery you'd want for a second attempt.",
      },
      {
        id: "starting.idle",
        label: "Throttle — under 800 RPM once it catches",
        why: "A cold engine at high RPM is metal moving fast with oil that hasn't reached it yet. Bring it down as soon as it's running.",
      },
      {
        id: "starting.oil-pressure",
        label: "Oil pressure — 30–80 PSI",
        why: "If the needle hasn't come off the peg within a few seconds, shut it down. An engine running without oil pressure is destroying itself while you watch.",
      },
      {
        // The panel's alternator warning light rather than an ammeter needle:
        // it's what this airplane actually has to tell you about its charging
        // system, and it reads the same way in sun as it does at night.
        id: "starting.ammeter",
        label: "Alternator light — not lit",
        why: "Lit means the alternator isn't carrying the load and everything electrical is coming out of the battery — a clock you can't see running down. It should go out once the engine is running; if it doesn't, it's a squawk before you taxi, not something to watch.",
      },
      {
        id: "starting.radios",
        label: "Radios — on / set / check (headsets on)",
        why: "Now that the spike is behind you. Set the frequencies you'll actually need before you start moving, not while taxiing.",
      },
      {
        id: "starting.transponder",
        label: "Transponder — ALT",
        why: "On and altitude-reporting from the moment the engine is running, so the airplane is visible to everyone looking for it — including the traffic systems watching the ramp — rather than only from the hold-short line. The pre-takeoff flow still verifies the code.",
      },
      // No flight-instruments line here: setting the altimeter and swinging
      // the HI belongs where the airplane is stopped and level for a minute,
      // which is the runup — and `runup.instruments` is that line. Asking
      // twice got the HI set while the airplane was about to taxi and then
      // re-set anyway, which teaches that the first one didn't count.
      {
        id: "starting.flaps",
        label: "Flaps — UP",
        why: "Up for taxi keeps them out of the gravel and the prop blast, and puts them where the pre-takeoff flow expects to find them.",
      },
      {
        id: "starting.warm-idle",
        label: "Throttle (when warm) — 900–1200 RPM",
        why: "Where this engine idles happily while you taxi and the oil comes up to temperature.",
      },
    ],
  },
  {
    id: "runup",
    title: "Before takeoff / runup",
    subtitle: "Stopped, into wind, nothing behind you",
    items: [
      {
        id: "runup.brakes",
        label: "Brakes — set",
        why: "You're about to put 1600 RPM through a stationary airplane. Held on the brakes and pointed away from other aircraft.",
      },
      {
        id: "runup.doors",
        label: "Cabin doors — latched",
        why: "Last chance to fix it on the ground. A door that pops on climbout is noise and distraction exactly when you have none to spare.",
      },
      {
        id: "runup.controls",
        label: "Flight controls — free & correct",
        why: "Free is only half of it: look out and confirm the surfaces move the right way. A mis-rigged control that's perfectly free will still roll you into the ground.",
      },
      {
        id: "runup.oil-temp-green",
        label: "Oil temperature — above 75 °F",
        why: "Cold oil is thick oil. Running it up before the temperature comes up is how you find out what a cold-worn engine sounds like. 75 °F is the club's gate for putting runup power through it, and it's the only oil-temperature gate on the ground — what the gauge does after that is a cruise instrument, not a box to tick.",
      },
      {
        id: "runup.mixture",
        label: "Mixture — rich",
        why: "Rich for the runup and the takeoff, so the checks you're about to make are the ones you'll actually fly with.",
      },
      {
        id: "runup.throttle",
        label: "Throttle — 1600 RPM",
        why: "The card's runup RPM for this airplane. Every drop figure below is measured from here, so the number matters.",
      },
      {
        id: "runup.oil-pressure",
        label: "Oil pressure — 30 to 40 psi minimum",
        why: "The last look at the oil system before you commit to a takeoff. Below the minimum, this flight is over.",
      },
      // No second oil-temperature line. `runup.oil-temp-green` above already
      // asks the only question that decides anything on the ground — is it warm
      // enough to run up — and asking again a few items later, in a band, made
      // the first one look provisional.
      {
        // Same instrument as `starting.ammeter`, so the same wording: this
        // airplane reports its charging system with a light.
        id: "runup.ammeter",
        label: "Alternator light — not lit",
        why: "Second look, under load and with the radios on. A charging system that was happy at idle and isn't now is a squawk, not a maybe.",
      },
      // Magnetos before carb heat, which is the order the mag check is actually
      // flown: L–BOTH–R–BOTH and back, then hot air. And neither records its
      // RPM drop any more — the numbers were three boxes to fill in while
      // holding 1600 RPM, and what the card asks for is a judgement made at the
      // tachometer ("is it inside the limit"), not a figure transcribed
      // afterwards. Anything outside the limits is a squawk, which is a place
      // the number can be written down in words.
      {
        id: "runup.mags",
        label: "Magnetos — max 100 RPM drop, and both drop",
        why: "Some drop on each is the point: no drop at all means a magneto is live when you think it's off, and that propeller can start the engine on its own.",
      },
      {
        id: "runup.carb-heat",
        label: "Carb heat — 50 to 100 RPM drop",
        why: "The drop is how you know hot air is actually reaching the carburettor — the one defence this engine has against carb ice. No drop means it isn't working.",
      },
      {
        id: "runup.idle",
        label: "Throttle — check idle, then above 600 RPM",
        why: "The idle check is a rehearsal for the power-off approach you're going to fly. An engine that quits at idle here will quit on short final.",
      },
      {
        id: "runup.instruments",
        label: "Flight instruments — altimeter, HI set",
        why: "Re-set the HI to the compass while you're stopped and level. It's the last time today it'll be either.",
      },
      {
        id: "runup.fuel-selector",
        label: "Fuel selector — proper tank",
        why: "Confirm it where you can still do something about it. The selector is the single item most often found wrong after a fuel-starvation event.",
      },
    ],
  },
  {
    id: "pretakeoff",
    // The club's own name for this one. It's the mnemonic members already say
    // out loud at the hold-short line, so the section header says it too rather
    // than making them map "Pre-takeoff" onto it.
    title: "Pre-takeoff (Lights, Camera, Action)",
    subtitle: "Holding short",
    // Item order IS the mnemonic, and each line says which word it answers.
    // Lights, then Camera (the transponder — what makes you visible to the
    // people who can't see you out of a window), then the three Action items
    // that configure the airplane, ending on mixture rich: the last thing
    // touched before the power comes in.
    items: [
      {
        id: "pretakeoff.lights",
        label: "Lights — as required (Lights)",
        why: "Landing and strobe lights on the runway make you visible to the traffic on final that hasn't seen you yet.",
      },
      {
        id: "pretakeoff.transponder",
        label: "Transponder — verify code, ALT (Camera)",
        why: "The code you were given, and out of standby. Nobody chases you for it until it's the reason a controller couldn't see you.",
      },
      {
        id: "pretakeoff.trim",
        label: "Elevator trim — takeoff (Action)",
        why: "Set wrong, the airplane either fights you off the ground or leaps off it before you're ready. Takeoff setting, every time.",
      },
      {
        id: "pretakeoff.flaps",
        label: "Flaps — as required (Action)",
        why: "Decide it here and set it here. A flap setting changed on the roll is a distraction you chose to give yourself.",
      },
      {
        id: "pretakeoff.mixture",
        label: "Mixture — rich (Action)",
        why: "Confirmed once more with the runway in front of you, because a lean mixture on a full-power climb is a very short flight. Last of the Action items, and the last thing you touch before the throttle.",
      },
    ],
  },
  FIVE_PS_SECTION,
];

// ── Turn-off checkout ──────────────────────────────────────────────────────
// The back of the card, answered on the post-flight form: what you did between
// clearing the runway and walking away from the airplane.

const TURNOFF_SECTIONS: CheckoutSection[] = [
  {
    id: "after-landing",
    title: "After landing",
    subtitle: "Clear of the runway, stopped",
    items: [
      {
        id: "after-landing.flaps",
        label: "Flaps — UP",
        why: "Clean up after you're clear of the runway, not on it, and look at the handle you're moving — reaching blind is how flaps get retracted on landing rollout.",
      },
      {
        id: "after-landing.lights",
        label: "Lights — as required",
        why: "Landing light off on the taxiway is a courtesy to everyone you're about to taxi towards.",
      },
      {
        id: "after-landing.trim",
        label: "Trim — takeoff",
        why: "Resetting it now means the next pilot finds the airplane the way the card says it should be.",
      },
      {
        id: "after-landing.carb-heat",
        label: "Carb heat — cold",
        why: "Back to cold puts the air filter back in the loop for the taxi, and leaves the control where the next start expects it.",
      },
    ],
  },
  {
    id: "shutdown",
    title: "Shutdown",
    subtitle: "On the spot, brakes set",
    items: [
      {
        id: "shutdown.cool",
        label: "Idle 600–800 RPM for 2–3 minutes",
        why: "Lets the cylinder head temperatures come down evenly. Shutting down straight off a taxi is what cracks cylinders over a fleet's lifetime — and it's the club's engine.",
      },
      {
        id: "shutdown.brakes",
        label: "Brakes — set",
        why: "Before your hands leave the panel, not after the airplane starts moving.",
      },
      {
        id: "shutdown.electrical",
        label: "Radios / electrical — OFF",
        why: "Off before the master, so nothing takes the spike on the way down and nothing is left quietly draining the battery.",
      },
      {
        id: "shutdown.transponder",
        label: "Transponder — OFF",
        why: "Part of the same sweep, and the one most often found still on ALT the next morning.",
      },
      {
        id: "shutdown.mixture",
        label: "Mixture — idle cutoff",
        why: "This is how the engine is stopped — starve it of fuel rather than cutting the ignition, so no fuel is left in a cylinder waiting for a spark.",
      },
      {
        id: "shutdown.mags",
        label: "Magnetos — OFF, key to dash",
        why: "Key out and visible on the dash is the club's convention: anyone walking up can see at a glance that the ignition is off.",
      },
      {
        id: "shutdown.master",
        label: "Master switch — OFF",
        why: "Last thing off. A master left on overnight is a flat battery and a member's cancelled morning.",
      },
      {
        id: "shutdown.timer",
        fields: [
          { id: "shutdown.timer.at", label: "Stopped", kind: "time", defaultNow: true },
        ],
        label: "Flight timer — stop & record",
        why: "Read it before you get out. Nobody has ever successfully remembered it in the car park.",
      },
      {
        id: "shutdown.tach",
        // Both meters, the same pair the preflight card's `cockpit.meters`
        // asks for at the other end of the flight. Recording only the tach
        // here meant the Hobbs end had to be typed again into the meter card
        // below — the one number on this page that was asked for twice.
        fields: [
          {
            id: "shutdown.tach.hours",
            label: "Tach",
            unit: "hrs",
            kind: "number",
            step: 0.1,
            min: 0,
          },
          {
            id: "shutdown.tach.hobbs",
            label: "Hobbs",
            unit: "hrs",
            kind: "number",
            step: 0.1,
            min: 0,
          },
        ],
        label: "Tach & Hobbs — record time in flight log",
        why: "The tach is what bills, and what the next pilot's start reading is checked against. Read both before you get out — they go straight into the log entry you're filling in right now, so the meter card below fills itself.",
      },
      {
        id: "shutdown.flight-plan",
        label: "Flight plan — closed",
        why: "Highlighted on the card for a reason: an unclosed flight plan launches a search for an airplane that's already tied down.",
      },
    ],
  },
  {
    id: "parking",
    title: "Outside parking",
    subtitle: "How the next member finds it",
    items: [
      {
        id: "parking.control-lock",
        label: "Control lock — in place",
        why: "Wind slamming the controls against their stops on the ramp is slow damage that nobody sees happen.",
      },
      {
        id: "parking.tiedowns",
        label: "Tie-downs — secure",
        why: "Both wings and the tail. This is the check the flight log records, because an untied airplane in an overnight gust is somebody else's problem by morning.",
      },
      {
        id: "parking.chocks",
        label: "Wheel chocks — in place",
        why: "Belt and braces with the tie-downs, and the reason the airplane is still where you left it.",
      },
      {
        id: "parking.cover",
        label: "Cover — secure",
        why: "A cover that comes loose flogs the paint all night and can end up wrapped somewhere worse.",
      },
      {
        id: "parking.cabin",
        label: "Cabin — trash and personal items removed",
        why: "The club's own rule rather than the card's: loose items become projectiles for the next pilot, and nobody wants to find your coffee cup.",
        club: true,
      },
    ],
  },
];

// ── The three checkouts ────────────────────────────────────────────────────
//
// Versions carry forward from what the columns already hold rather than
// restarting: PREFLIGHT continues the old preflight checklist (v3 was the
// generic-POH walkaround; v4 is this card), TURNOFF continues the securing
// checklist (v1 → v2), and RUNWAY is a new kind with no history, so it starts
// at 1. Rows stamped with an older version keep their stamp and are simply
// read against ids that no longer exist — which is exactly what the stamp is
// there to tell you.

export const PREFLIGHT_CHECKOUT: Checkout = {
  kind: "PREFLIGHT",
  title: "Preflight checkout",
  tagline: "Homework, consumables, cockpit, and the walk around the airplane.",
  // v5 added the club's tach/Hobbs reading to the cockpit section.
  //
  // v6 did three things. It split the fuel dip into left and right wing
  // (`consumables.dip.gal` → `.dip.left` + `.dip.right`) and dropped the
  // tire-pressure boxes — both FIELD ids rather than item ids, so no item's
  // history moved: older runs keep their `fuelOnBoardGal` column, which is
  // what the Status tab reads, and simply have no per-wing breakdown to show
  // because nobody recorded one. It also added the `walkaround` section, whose
  // four items are NEW ids, so a v5 run is legitimately missing them rather
  // than having failed them.
  //
  // v7 is the club reading its own card against the airplane it actually has.
  // The two brake lines lost "pads" — N8318B wears wheel fairings, so the pads
  // can't be seen without pulling one, and a line asking for a check nobody can
  // make is a line that gets ticked anyway. The elevator line gained the trim
  // tab (same reach, same hardware check), and a new `empennage.controls-free`
  // asks that the elevator, trim and rudder MOVE — the hardware items say
  // "attached", which is a different question from "not binding". Both brake
  // ids and the elevator id are unchanged: same physical checks, reworded, so
  // old runs keep their meaning. The bump is what discards half-walked drafts
  // written against a card with one item fewer.
  version: 7,
  sections: PREFLIGHT_SECTIONS,
};

export const RUNWAY_CHECKOUT: Checkout = {
  kind: "RUNWAY",
  title: "Runway checkout",
  tagline: "Sitting down to holding short: passengers, start, runup, pre-takeoff.",
  // v2 is the club reading the card against how it actually flies N8318B.
  //
  // Added: `prelube.crank`, ending the cold-start pre-lube — the hand pull
  // moves oil off the cylinder walls, but only the starter turns the pump.
  // Retired: `starting.master`, which asked for a switch the before-start
  // beacon item has already required; `starting.instruments`, because the
  // altimeter and HI are set where the airplane is stopped and level, which is
  // the runup — and `runup.instruments` was already asking for exactly that;
  // `runup.oil-temp`, the second oil-temperature line, which asked in a band
  // what `runup.oil-temp-green` had already gated a few items earlier; and
  // `runup.annunciators`. Three FIELDS went too, rather than items — the
  // magneto L/R drops and the carb-heat drop — so those items keep their ids
  // and their history and simply have no numbers hanging off them any more.
  // Reordered: magnetos before carb heat, the order the check is actually
  // flown. Reworded, same ids and same checks: `starting.transponder` goes to ALT
  // rather than standby (visible from the moment the engine is running, not
  // from the hold-short line), both ammeter lines read the alternator light
  // this airplane actually has, and the runup's oil temperature is the card's
  // own 75 °F.
  //
  // A new id is legitimately missing from a v1 run rather than failed by it; a
  // retired one is dropped from an old run's answers by `parseAnswers`. Both
  // are exactly what the version stamp is there to explain.
  version: 2,
  sections: RUNWAY_SECTIONS,
};

export const TURNOFF_CHECKOUT: Checkout = {
  kind: "TURNOFF",
  title: "Turn-off checkout",
  tagline: "Clear of the runway to walking away: after landing, shutdown, parking.",
  // v3 retired `after-landing.transponder`. The club now flies with the
  // transponder in ALT from the moment the engine is running (see
  // `starting.transponder` on the runway card), so putting it back to standby
  // while rolling clear isn't the club's procedure any more — and shutdown
  // switches it off a couple of items later regardless.
  version: 3,
  sections: TURNOFF_SECTIONS,
};

export const CHECKOUTS: Record<CheckoutKind, Checkout> = {
  PREFLIGHT: PREFLIGHT_CHECKOUT,
  RUNWAY: RUNWAY_CHECKOUT,
  TURNOFF: TURNOFF_CHECKOUT,
};

/** Narrow an arbitrary string (a query param, a db column) to a checkout kind. */
export function isCheckoutKind(value: unknown): value is CheckoutKind {
  return value === "PREFLIGHT" || value === "RUNWAY" || value === "TURNOFF";
}

/** The checkout for a kind. */
export function checkoutFor(kind: CheckoutKind): Checkout {
  return CHECKOUTS[kind];
}

// ── Answers ────────────────────────────────────────────────────────────────

export type Answers = Record<string, boolean>;

/**
 * Readings recorded ON the items, keyed by field id.
 *
 * Kept in a SEPARATE map from `answers` rather than widening that to
 * `boolean | number`: the boolean map is what sign-off arithmetic counts, and
 * a value living in it would either have to be coerced (making "0 psi" read as
 * unticked) or specially skipped at every call site. Two maps, two jobs.
 *
 * Times are stored as the "HH:MM" the input produces; numbers as numbers.
 */
export type Values = Record<string, number | string>;

/** Every field on a checkout, in card order. */
export function allFields(kind: CheckoutKind): CheckoutField[] {
  return checkoutFor(kind).sections.flatMap((s) =>
    s.items.flatMap((i) => i.fields ?? [])
  );
}

/** The field spec for an id, or undefined if it's no longer on the card. */
export function fieldById(
  kind: CheckoutKind,
  id: string
): CheckoutField | undefined {
  return allFields(kind).find((f) => f.id === id);
}

/**
 * Normalize the db's JSON into a clean values map: live field ids only, parsed
 * to the shape their `kind` promises. A number that won't parse is dropped
 * rather than stored as NaN, which JSON turns into null and every reader then
 * has to guard.
 */
export function parseValues(kind: CheckoutKind, raw: unknown): Values {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Values = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = fieldById(kind, key);
    if (!field) continue;
    if (field.kind === "number") {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/**
 * Is a recorded number outside the card's own figure? Returns the note to show
 * under the field, or null.
 *
 * Deliberately advisory: nothing here blocks a sign-off. A mag drop of 140 RPM
 * is a squawk the pilot needs to SEE, and a pilot who genuinely means to record
 * an out-of-limits reading must be able to.
 */
export function outOfRange(
  field: CheckoutField,
  value: number | string | undefined
): string | null {
  if (!field.expected || typeof value !== "number") return null;
  const { min, max, note } = field.expected;
  if (min != null && value < min) return note;
  if (max != null && value > max) return note;
  return null;
}

/**
 * The two readings the rest of the app already has columns for.
 *
 * Same shape of rule as `derivePutAway`: the Plane Status tab queries
 * `fuelOnBoardGal` / `oilQuarts` directly, so those columns stay the canonical
 * place for them — but the pilot now records them ON the card items, and the
 * API derives the columns from that rather than asking twice.
 */
export function deriveFuelOil(values: Values): {
  fuelOnBoardGal: number | null;
  oilQuarts: number | null;
} {
  const num = (id: string) => {
    const v = values[id];
    return typeof v === "number" ? v : null;
  };

  // Fuel is dipped a tank at a time; the column is the airplane's total.
  // A pilot who filled in one wing and not the other gets the side they
  // recorded rather than nothing — half an answer is still a reading, and
  // treating it as null would drop it off the Status tab's fuel meter
  // entirely. Both blank stays null: "nobody dipped it" and "it's empty" are
  // not the same fact.
  const left = num("consumables.dip.left");
  const right = num("consumables.dip.right");
  const fuelOnBoardGal =
    left === null && right === null ? null : (left ?? 0) + (right ?? 0);

  return {
    fuelOnBoardGal,
    oilQuarts: num("consumables.oil.qts"),
  };
}

/**
 * What a fresh run of a card starts with in its value boxes.
 *
 * Only the `defaultNow` time fields today. Seeded into the page's state rather
 * than filled in by the input, so it's a starting VALUE the pilot can type
 * over — and so it never runs through the change handler that would tick the
 * item along with it.
 */
export function initialValues(kind: CheckoutKind, now: Date = new Date()): Values {
  const out: Values = {};
  for (const field of allFields(kind)) {
    if (field.defaultNow && field.kind === "time") out[field.id] = clubTimeNow(now);
  }
  return out;
}


/** Every item id on a checkout, in order — including the optional ones. */
function itemIds(checkout: Checkout): string[] {
  return checkout.sections.flatMap((s) => s.items.map((i) => i.id));
}

/**
 * Ids that must be ticked before a run counts as complete. Optional sections
 * (the cold-start pre-lube) and optional items (the card's IFR-only line) are
 * stored when answered but never demanded.
 */
function requiredIds(checkout: Checkout): string[] {
  return checkout.sections
    .filter((s) => !s.optional)
    .flatMap((s) => s.items.filter((i) => !i.optional).map((i) => i.id));
}

/** Every item id on a checkout, in the order you work down the card. */
export function allItemIds(kind: CheckoutKind): string[] {
  return itemIds(checkoutFor(kind));
}

/** What a progress bar counts against — required items only. */
export function totalItems(kind: CheckoutKind): number {
  return requiredIds(checkoutFor(kind)).length;
}

/**
 * Normalize whatever came out of the db's JSON column into a plain
 * { itemId: true } map, dropping ids that aren't on this checkout — which is
 * also what quietly discards the answers of a superseded version.
 */
export function parseAnswers(kind: CheckoutKind, raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = new Set(allItemIds(kind));
  const out: Answers = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (valid.has(key) && value === true) out[key] = true;
  }
  return out;
}

/** How many required items are ticked. */
export function countChecked(kind: CheckoutKind, answers: Answers): number {
  return requiredIds(checkoutFor(kind)).filter((id) => answers[id]).length;
}

/** Ticked items in one section — drives the per-section "4/9" counter. */
export function countSectionChecked(
  section: CheckoutSection,
  answers: Answers
): number {
  return section.items.filter((i) => answers[i.id]).length;
}

/** Required items still outstanding, in card order. */
export function missingItems(
  kind: CheckoutKind,
  answers: Answers
): CheckoutItem[] {
  return checkoutFor(kind)
    .sections.filter((s) => !s.optional)
    .flatMap((s) => s.items.filter((i) => !i.optional && !answers[i.id]));
}

/** A run may only be signed off once every required item is ticked. */
export function isComplete(kind: CheckoutKind, answers: Answers): boolean {
  return missingItems(kind, answers).length === 0;
}

/**
 * The flight log's two put-away flags, read off the turn-off checkout.
 *
 * They used to be a pair of toggles the pilot set directly; now they're
 * derived, so "tied down" means the pilot actually ticked the tie-downs and
 * the chocks rather than left a default alone. Unticked therefore means
 * "not confirmed", which is how the flight log words it.
 */
export function derivePutAway(turnoff: Answers): {
  tiedDown: boolean;
  cabinClean: boolean;
} {
  return {
    tiedDown: Boolean(turnoff["parking.tiedowns"] && turnoff["parking.chocks"]),
    cabinClean: Boolean(turnoff["parking.cabin"]),
  };
}
