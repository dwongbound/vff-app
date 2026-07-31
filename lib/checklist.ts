// The preflight checklist itself — a Cessna 172S walkaround in POH order
// (cabin → empennage → right wing → nose → left wing → before start).
//
// This is business logic, not schema: a PreflightCheck row stores answers as a
// { itemId: boolean } JSON map keyed by the ids below, so editing this file is
// a code change rather than a migration. Bump CHECKLIST_VERSION whenever item
// ids change so old runs stay interpretable (the row records the version it
// was answered against).
//
// Item ids are `<section>.<item>` and must never be reused for a different
// check — that's what would silently rewrite history.

export const CHECKLIST_VERSION = 1;

export interface ChecklistItem {
  id: string;
  label: string;
  /** The "…what exactly am I looking at?" line, shown under the label. */
  detail?: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  /** Where you're standing for this section. */
  subtitle?: string;
  items: ChecklistItem[];
}

export const PREFLIGHT_CHECKLIST: ChecklistSection[] = [
  {
    id: "cabin",
    title: "Cabin",
    subtitle: "Before you step back outside",
    items: [
      {
        id: "cabin.docs",
        label: "Airworthiness documents aboard",
        detail: "ARROW — airworthiness, registration, radio (intl), POH, weight & balance",
      },
      { id: "cabin.poh", label: "POH & checklists accessible" },
      { id: "cabin.gust-lock", label: "Control wheel lock — removed" },
      { id: "cabin.ignition", label: "Ignition switch — OFF, key out" },
      { id: "cabin.avionics", label: "Avionics master — OFF" },
      {
        id: "cabin.fuel-gauges",
        label: "Master ON — fuel quantity & annunciators checked, then master OFF",
        detail: "Note the indicated fuel; you'll confirm it visually at the tanks",
      },
      { id: "cabin.static", label: "Alternate static source — OFF / pushed in" },
      { id: "cabin.extinguisher", label: "Fire extinguisher — charged & secure" },
      { id: "cabin.baggage", label: "Baggage door — secured & locked" },
    ],
  },
  {
    id: "empennage",
    title: "Empennage",
    subtitle: "Tail",
    items: [
      { id: "empennage.gust-lock", label: "Rudder gust lock — removed" },
      { id: "empennage.tiedown", label: "Tail tie-down — disconnected" },
      {
        id: "empennage.surfaces",
        label: "Rudder & elevator — free, secure, hinges and bolts intact",
      },
      { id: "empennage.trim", label: "Elevator trim tab — condition & security" },
      { id: "empennage.antennas", label: "Antennas & beacon — secure, undamaged" },
    ],
  },
  {
    id: "right-wing",
    title: "Right wing",
    items: [
      { id: "right.aileron", label: "Aileron — free movement, hinges secure" },
      { id: "right.flap", label: "Flap — condition, attach points secure" },
      { id: "right.tiedown", label: "Wing tie-down — disconnected" },
      {
        id: "right.tire",
        label: "Main wheel — tire inflation & wear, brake pads and lines",
      },
      {
        id: "right.sump",
        label: "Fuel sumps — sampled, clear of water & debris",
        detail: "Both quick-drains on this side, into a clear tester",
      },
      {
        id: "right.fuel",
        label: "Fuel quantity — visually verified, cap secure, vent clear",
      },
      { id: "right.wingtip", label: "Wingtip & nav/strobe light — condition" },
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
      },
      { id: "nose.strainer", label: "Fuel strainer — drained, sample clear" },
      {
        id: "nose.prop",
        label: "Propeller & spinner — no nicks, cracks, or oil leaks",
      },
      { id: "nose.airfilter", label: "Induction air filter — clear, unobstructed" },
      { id: "nose.cowling", label: "Cowling & baffles — secure, no fluid leaks" },
      { id: "nose.nosewheel", label: "Nose wheel — strut extension, tire, shimmy damper" },
      { id: "nose.chocks", label: "Chocks — removed" },
      { id: "nose.alternator", label: "Alternator belt & wiring — condition" },
    ],
  },
  {
    id: "left-wing",
    title: "Left wing",
    items: [
      { id: "left.tiedown", label: "Wing tie-down — disconnected" },
      {
        id: "left.tire",
        label: "Main wheel — tire inflation & wear, brake pads and lines",
      },
      { id: "left.sump", label: "Fuel sumps — sampled, clear of water & debris" },
      {
        id: "left.fuel",
        label: "Fuel quantity — visually verified, cap secure, vent clear",
      },
      { id: "left.pitot", label: "Pitot tube — cover removed, opening clear & warm to heat" },
      { id: "left.stall-warn", label: "Stall warning vane — free, horn sounds with master on" },
      { id: "left.fuel-vent", label: "Fuel vent — unobstructed" },
      { id: "left.lights", label: "Landing / taxi light & wingtip — condition" },
    ],
  },
  {
    id: "before-start",
    title: "Before start",
    subtitle: "Back in the cabin",
    items: [
      { id: "start.wb", label: "Weight & balance — within limits for this load" },
      { id: "start.wx", label: "Weather, TFRs & NOTAMs — reviewed" },
      { id: "start.squawks", label: "Open squawks — reviewed, airplane airworthy" },
      { id: "start.seats", label: "Seats & belts — adjusted, locked, fastened" },
      { id: "start.doors", label: "Doors & windows — closed and latched" },
      { id: "start.brakes", label: "Brakes — tested and set" },
      { id: "start.fuel-selector", label: "Fuel selector — BOTH" },
    ],
  },
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
