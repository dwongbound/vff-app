// When the airplane is next due for something, and what that means.
//
// The club has kept this on a spreadsheet: ten columns per row, of which only
// four are typed in. The other six — hours remaining, days remaining, the tach
// it comes due at, the date it comes due, which item is next, and whether any
// of it is a problem — are formulas over those four. This file is those
// formulas, and it is the ONLY place that decides what "due" means.
//
// The four stored facts (see prisma MaintenanceItem):
//   intervalHours / intervalMonths — how long it's good for, in either unit
//   lastDoneTach   / lastDoneOn    — where the clocks were when it was signed off
//
// Two rules run through everything below.
//
//   1. The TIGHTER interval wins. An oil change is 50 hours or 4 calendar
//      months, whichever comes first, and an item that's fine on hours and out
//      of date on the calendar is out of date. Nothing here averages the two.
//   2. Calendar months run to the END of the month, which is how 14 CFR counts
//      them and how the club's sheet reads: done 8 Jul 2026 + 12 months is due
//      31 Jul 2027, not 8 Jul. `calendarMonthsFrom` already does exactly this
//      for flight reviews and medicals, so it's reused rather than re-derived.
import type { BadgeTone } from "@/components/common/Badge";
import { calendarMonthsFrom, startOfDay } from "./dates";

export const MAINTENANCE_CATEGORY_LABELS = {
  INSPECTION: "Inspection & recurrent maintenance",
  EQUIPMENT: "Equipment",
} as const;

export type MaintenanceCategory = keyof typeof MAINTENANCE_CATEGORY_LABELS;

/** In the order the club's own sheet lists its two blocks. */
export const MAINTENANCE_CATEGORIES = Object.keys(
  MAINTENANCE_CATEGORY_LABELS
) as MaintenanceCategory[];

/**
 * How close to the line counts as "due soon".
 *
 * Club policy, not regulation — nothing goes wrong at 10 hours or 30 days, and
 * these exist so an item that needs booking into a shop starts showing amber
 * while there's still time to book it. Ten hours is roughly a month of this
 * club's flying; thirty days is the notice an annual actually needs.
 *
 * They're also the UNIT the two dimensions are compared in — see `urgency`.
 */
export const DUE_SOON_HOURS = 10;
export const DUE_SOON_DAYS = 30;

/**
 * Where an item stands.
 *
 *   OVERDUE   — past one of its limits. For a `requiredByReg` item that means
 *               the airplane may not legally fly; for a club item it means the
 *               maintenance officer is late.
 *   DUE_SOON  — inside DUE_SOON_HOURS or DUE_SOON_DAYS of a limit.
 *   OK        — tracked, with room left.
 *   UNTRACKED — no interval, or no record of it ever being done. Deliberately
 *               its own state rather than folded into OK: "nothing is due" and
 *               "nobody knows" are different answers, and showing the second as
 *               the first is how an airplane flies out of annual.
 */
export type MaintenanceState = "OVERDUE" | "DUE_SOON" | "OK" | "UNTRACKED";

export const MAINTENANCE_STATE_LABELS: Record<MaintenanceState, string> = {
  OVERDUE: "Overdue",
  DUE_SOON: "Due soon",
  OK: "In limits",
  UNTRACKED: "Not tracked",
};

export const MAINTENANCE_STATE_TONES: Record<MaintenanceState, BadgeTone> = {
  OVERDUE: "red",
  DUE_SOON: "amber",
  OK: "green",
  UNTRACKED: "gray",
};

/** Which clock ran out first. */
export type MaintenanceLimit = "hours" | "calendar";

/** The stored half of a maintenance item — all this file needs to do its sums. */
export interface MaintenanceFacts {
  intervalHours: number | null;
  intervalMonths: number | null;
  lastDoneTach: number | null;
  /** ISO string on the wire, a Date off a row — both are accepted. */
  lastDoneOn: string | Date | null;
  /** Whether the LAW requires it; decides whether OVERDUE grounds the airplane. */
  requiredByReg?: boolean;
}

/** Everything derived, for one item, against one tach reading and one clock. */
export interface MaintenanceDue {
  state: MaintenanceState;
  /** The tach reading it comes due at, or null when there's no hour limit. */
  dueAtTach: number | null;
  /** The last day it's legal, or null when there's no calendar limit. */
  dueOn: Date | null;
  hoursRemaining: number | null;
  daysRemaining: number | null;
  /**
   * The limit that's closest — what the countdown should actually show. Null
   * when nothing is tracked.
   */
  limitedBy: MaintenanceLimit | null;
  /**
   * How close to due, in "due soon"s: 1 = exactly at the amber threshold, 0 =
   * due right now, negative = past it. Null when untracked. Comparable ACROSS
   * items and across the two units, which is the whole reason it exists —
   * see `urgencyOf` for why the naive comparisons don't work.
   */
  urgency: number | null;
  /**
   * The airplane may not fly: a legally-required item is past its limit.
   * Club-scheduled items never set this, however overdue they are.
   */
  grounds: boolean;
}

/** The tach reading an hour-limited item comes due at. */
export function dueAtTach(item: MaintenanceFacts): number | null {
  if (item.intervalHours == null || item.lastDoneTach == null) return null;
  // Rounded to a tenth: tach meters read in tenths, and 1523.2000000000003 in
  // a "due at" column looks like a bug in the app rather than floating point.
  return Math.round((item.lastDoneTach + item.intervalHours) * 10) / 10;
}

/** The last day a calendar-limited item is good for (end of that month). */
export function dueOn(item: MaintenanceFacts): Date | null {
  if (item.intervalMonths == null) return null;
  return calendarMonthsFrom(item.lastDoneOn, item.intervalMonths);
}

/**
 * Hours left before the hour limit, against the airplane's current tach.
 *
 * Null when the item has no hour interval, has never been done, or the
 * airplane has no tach reading — all three are "we can't say", and a zero
 * would read as "due now".
 */
export function hoursRemaining(
  item: MaintenanceFacts,
  currentTach: number | null | undefined
): number | null {
  const due = dueAtTach(item);
  if (due == null || currentTach == null) return null;
  return Math.round((due - currentTach) * 10) / 10;
}

/**
 * Whole days left before the calendar limit, counting the due day itself as
 * one you may still fly on — a calendar-month item is good THROUGH the last
 * day of its month, so "0 days remaining" means due today and still legal.
 * Both ends are taken at local midnight so the answer doesn't depend on the
 * time of day it's asked.
 */
export function daysRemaining(
  item: MaintenanceFacts,
  now: Date = new Date()
): number | null {
  const due = dueOn(item);
  if (due == null) return null;
  return Math.round(
    (startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000
  );
}

/**
 * Everything derived about one item.
 *
 * `currentTach` is the airplane's live meter (Aircraft.lastTach), which is what
 * makes the hours half of this a live number rather than a stored one.
 */
export function maintenanceDue(
  item: MaintenanceFacts,
  currentTach: number | null | undefined,
  now: Date = new Date()
): MaintenanceDue {
  const hours = hoursRemaining(item, currentTach);
  const days = daysRemaining(item, now);

  // In "due soon"s, so the two units can be compared at all. Note the
  // asymmetry at zero, and that it's deliberate: an hour interval is a budget
  // that has been spent (0 hours left = due), while a calendar month is good
  // through its last day (0 days left = due today, fly it).
  const hoursUrgency = hours == null ? null : hours / DUE_SOON_HOURS;
  const daysUrgency = days == null ? null : (days + 1) / DUE_SOON_DAYS;

  const candidates: { limit: MaintenanceLimit; urgency: number }[] = [];
  if (hoursUrgency != null) candidates.push({ limit: "hours", urgency: hoursUrgency });
  if (daysUrgency != null) candidates.push({ limit: "calendar", urgency: daysUrgency });

  if (candidates.length === 0) {
    return {
      state: "UNTRACKED",
      dueAtTach: dueAtTach(item),
      dueOn: dueOn(item),
      hoursRemaining: hours,
      daysRemaining: days,
      limitedBy: null,
      urgency: null,
      grounds: false,
    };
  }

  // The tighter limit wins — rule 1 at the top of this file.
  const tightest = candidates.reduce((a, b) => (b.urgency < a.urgency ? b : a));
  const state: MaintenanceState =
    tightest.urgency <= 0 ? "OVERDUE" : tightest.urgency <= 1 ? "DUE_SOON" : "OK";

  return {
    state,
    dueAtTach: dueAtTach(item),
    dueOn: dueOn(item),
    hoursRemaining: hours,
    daysRemaining: days,
    limitedBy: tightest.limit,
    urgency: tightest.urgency,
    grounds: state === "OVERDUE" && item.requiredByReg === true,
  };
}

/**
 * How urgent, for sorting. Untracked items sort last rather than first: they
 * have no countdown, and putting "we don't know" above a real 3-hours-left
 * would bury the thing that actually needs doing.
 */
function urgencyOf(due: MaintenanceDue): number {
  return due.urgency ?? Number.POSITIVE_INFINITY;
}

/**
 * The club's items, most urgent first.
 *
 * Sorting needs one number per item, and neither raw remaining-hours nor raw
 * remaining-days can be it: 20 hours and 20 days aren't the same amount of
 * "soon", and an annual with 300 days left would outrank an oil change with 3
 * hours left on any comparison that mixed the units naively. `urgency`
 * normalises both against the thresholds above, so the ordering means "closest
 * to needing attention" regardless of which clock is running out.
 */
export function byUrgency<T extends MaintenanceFacts>(
  items: T[],
  currentTach: number | null | undefined,
  now: Date = new Date()
): T[] {
  return [...items].sort(
    (a, b) =>
      urgencyOf(maintenanceDue(a, currentTach, now)) -
      urgencyOf(maintenanceDue(b, currentTach, now))
  );
}

/**
 * The one item the club is next due for — the sheet's own "Next-Due
 * Maintenance Item" box. Null when nothing is tracked closely enough to have a
 * countdown at all.
 */
export function nextDue<T extends MaintenanceFacts>(
  items: T[],
  currentTach: number | null | undefined,
  now: Date = new Date()
): T | null {
  const [first] = byUrgency(items, currentTach, now);
  if (!first) return null;
  return maintenanceDue(first, currentTach, now).urgency == null ? null : first;
}

/**
 * The items that stop the airplane flying: legally-required ones past a limit.
 *
 * This is the maintenance half of the same question the grounded-squawk banner
 * answers, and it's kept narrow on purpose. An oil change 3 hours over the
 * club's 50 is a real problem and the app says so loudly — but calling it a
 * grounding would put the word next to something that isn't one, and the next
 * time it appeared over an out-of-annual airplane it would carry less weight.
 */
export function grounding<T extends MaintenanceFacts>(
  items: T[],
  currentTach: number | null | undefined,
  now: Date = new Date()
): T[] {
  return byUrgency(items, currentTach, now).filter(
    (item) => maintenanceDue(item, currentTach, now).grounds
  );
}

/**
 * How far round a gauge the needle sits: 0 = just done, 1 = due now.
 *
 * The proportion of the interval that has been USED, on the clock that's
 * binding — honest and linear, because the needle is a measurement. What is
 * deliberately NOT linear is the colour behind it (see the gauge's gradient
 * stops): the first half of an oil change interval is uneventful and the last
 * tenth is the whole story, so the ramp holds green a long time and then goes
 * amber-to-red quickly. Putting the non-linearity in the colour rather than in
 * the needle keeps "the needle is halfway" meaning "half the interval is gone".
 *
 * Past due, it pins at 1: an overdue item is as far round as the gauge goes,
 * and the number in the middle says how far past.
 */
export function gaugePosition(due: MaintenanceDue): number | null {
  if (due.urgency == null) return null;
  return Math.max(0, Math.min(1, 1 - due.urgency / MAX_GAUGE_URGENCY));
}

/**
 * The urgency a gauge's empty end represents — how far out "nothing to worry
 * about" starts. Ten DUE_SOONs: an item further away than that is simply new,
 * and stretching the dial to fit a 24-month transponder check would leave every
 * other gauge pinned at the bottom.
 */
export const MAX_GAUGE_URGENCY = 10;

/** "19.3 hrs" / "112 days" — the countdown, in whichever unit is running out. */
export function formatRemaining(due: MaintenanceDue): string {
  if (due.limitedBy === "hours" && due.hoursRemaining != null) {
    const hours = due.hoursRemaining;
    if (hours < 0) return `${Math.abs(hours).toFixed(1)} hrs over`;
    return `${hours.toFixed(1)} hrs`;
  }
  if (due.limitedBy === "calendar" && due.daysRemaining != null) {
    const days = due.daysRemaining;
    if (days < 0) return `${Math.abs(days)} days over`;
    if (days === 0) return "due today";
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return "—";
}

/**
 * What's wrong with a maintenance item as submitted, or null if it's fine.
 *
 * Deliberately permissive about the intervals: an item with neither is legal
 * (the club is recording that the thing exists and when it was last touched),
 * and so is one that has never been done. The only hard requirement is a name,
 * because a row nobody can identify is worse than no row.
 */
export function maintenanceItemError(item: {
  label: string;
  intervalHours?: number | null;
  intervalMonths?: number | null;
  lastDoneTach?: number | null;
}): string | null {
  if (!item.label.trim()) return "Give the item a name.";
  if (item.label.trim().length > 80) return "That name is too long.";
  if (item.intervalHours != null && item.intervalHours <= 0) {
    return "An hour interval has to be more than zero.";
  }
  if (item.intervalMonths != null && item.intervalMonths <= 0) {
    return "A month interval has to be more than zero.";
  }
  if (item.lastDoneTach != null && item.lastDoneTach < 0) {
    return "A tach reading can't be negative.";
  }
  return null;
}

/**
 * A maintenance item's columns off a request body — the POST and the PATCH
 * read the same fields the same way, so they read them here.
 *
 * `partial` is the only difference between the two: a PATCH may carry one
 * field (which is exactly what "mark it done today" sends), while a POST has
 * to name the item. Everything else stays optional in both directions.
 *
 * In lib/ rather than beside the route because BOTH routes need it and a
 * `route.ts` may only export Next's own handlers.
 */
export function maintenanceFieldsFrom(
  body: Record<string, unknown>,
  partial = false
): { data: Record<string, unknown> } | { error: string } {
  const data: Record<string, unknown> = {};

  if (!partial || "label" in body) {
    const label = String(body.label ?? "").trim();
    const problem = maintenanceItemError({ label });
    if (problem) return { error: problem };
    data.label = label;
  }

  if ("category" in body) {
    const category = String(body.category ?? "");
    if (!(MAINTENANCE_CATEGORIES as string[]).includes(category)) {
      return { error: "That isn't one of the sheet's two sections." };
    }
    data.category = category;
  }

  if ("requiredByReg" in body) data.requiredByReg = Boolean(body.requiredByReg);
  if ("active" in body) data.active = Boolean(body.active);
  for (const field of ["reference", "notes"] as const) {
    if (field in body) {
      const value = body[field];
      data[field] = typeof value === "string" ? value.trim() || null : null;
    }
  }

  // The numbers. Blank CLEARS the limit rather than storing a zero: "this item
  // has no hour interval" and "this item is due every zero hours" are very
  // different claims, and only one of them is ever meant.
  for (const field of ["intervalHours", "intervalMonths", "lastDoneTach"] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null || raw === undefined || raw === "") {
      data[field] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: "That has to be a number." };
    data[field] = field === "intervalMonths" ? Math.round(value) : value;
  }

  const problem = maintenanceItemError({
    // A PATCH that doesn't touch the label still has to have its numbers
    // checked, so stand a valid one in for the name rule.
    label: typeof data.label === "string" ? data.label : "unchanged",
    intervalHours: data.intervalHours as number | null | undefined,
    intervalMonths: data.intervalMonths as number | null | undefined,
    lastDoneTach: data.lastDoneTach as number | null | undefined,
  });
  if (problem) return { error: problem };

  if ("lastDoneOn" in body) {
    if (body.lastDoneOn === null || body.lastDoneOn === "") {
      data.lastDoneOn = null;
    } else {
      const when = new Date(String(body.lastDoneOn));
      if (Number.isNaN(when.getTime())) {
        return { error: "That completion date isn't a date." };
      }
      data.lastDoneOn = when;
    }
  }

  return { data };
}
