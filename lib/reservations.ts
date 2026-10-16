// Pure booking logic: overlap detection and the rules a reservation must
// satisfy. Kept free of prisma/react so it can be unit-tested directly and
// reused by both the API route and the client form (same message either way).
import { MAX_ADVANCE_DAYS, MAX_RESERVATION_HOURS } from "./constants";

export interface Interval {
  startsAt: string | Date;
  endsAt: string | Date;
}

function ms(v: string | Date): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/**
 * Do two bookings collide?
 *
 * Intervals are half-open [start, end): a 10:00–12:00 booking and a 12:00–14:00
 * booking do NOT overlap, which is what makes back-to-back handoffs bookable.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return ms(a.startsAt) < ms(b.endsAt) && ms(b.startsAt) < ms(a.endsAt);
}

/**
 * The first existing booking that collides with `candidate`, or null.
 * `ignoreId` skips a row by id so editing a booking doesn't conflict with
 * itself.
 */
export function findConflict<T extends Interval & { id: string }>(
  existing: T[],
  candidate: Interval,
  ignoreId?: string
): T | null {
  for (const row of existing) {
    if (ignoreId && row.id === ignoreId) continue;
    if (overlaps(row, candidate)) return row;
  }
  return null;
}

/**
 * Club rules for a new/edited booking. Returns a member-facing message, or
 * null when the booking is fine.
 *
 * `now` is injected rather than read from the clock so this is deterministic
 * in tests.
 */
export function validateReservation(
  candidate: Interval,
  now: Date = new Date()
): string | null {
  const start = ms(candidate.startsAt);
  const end = ms(candidate.endsAt);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "Pick a start and end time.";
  }
  if (end <= start) {
    return "The end time has to be after the start time.";
  }

  const hours = (end - start) / 3_600_000;
  if (hours > MAX_RESERVATION_HOURS) {
    return `Bookings top out at ${MAX_RESERVATION_HOURS} hours — split a longer trip into legs.`;
  }

  // A little slack (5 min) so a form submitted right at the start time isn't
  // rejected by the round-trip.
  if (end <= now.getTime()) {
    return "That block is already in the past.";
  }
  if (start < now.getTime() - 5 * 60_000) {
    return "Start time is in the past.";
  }

  const daysAhead = (start - now.getTime()) / 86_400_000;
  if (daysAhead > MAX_ADVANCE_DAYS) {
    return `You can book up to ${MAX_ADVANCE_DAYS} days ahead.`;
  }

  return null;
}

/**
 * Bookings that haven't ended yet, soonest first — the mobile list view and
 * the "your next flight" card both want exactly this.
 */
export function upcoming<T extends Interval>(rows: T[], now: Date = new Date()): T[] {
  return rows
    .filter((r) => ms(r.endsAt) > now.getTime())
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}

/**
 * Who (or what) a booking is, in words. Most bookings belong to a member; one
 * typed straight into the airplane's Google Calendar by somebody without an
 * account here has only its own title ("Strut Maintanence").
 */
export function bookedBy(r: {
  user: { name: string } | null;
  title?: string | null;
}): string {
  return r.user?.name ?? r.title ?? "Someone";
}

/** The refusal for a booking that collides with `conflict`. */
export function conflictMessage(
  conflict: Interval & { user: { name: string } | null; title?: string | null },
  tailNumber: string,
  range: string
): string {
  return conflict.user
    ? `${conflict.user.name} already has ${tailNumber} from ${range}.`
    : `${tailNumber} is already booked from ${range} ("${bookedBy(conflict)}").`;
}

/**
 * How long an all-day booking runs, in days: "All day", "3 days". Its times
 * are club midnights, so this is a count of days rather than a clock range.
 */
export function allDayLabel(r: Interval): string {
  const days = Math.max(1, Math.round((ms(r.endsAt) - ms(r.startsAt)) / 86_400_000));
  return days === 1 ? "All day" : `${days} days`;
}

/**
 * The local days a booking covers, as midnights — so a three-day trip shows on
 * all three days of the calendar rather than only the first. A booking ending
 * exactly at midnight doesn't cover the day it ends on. Capped, because a
 * mistyped year on a Google event shouldn't paint the whole grid.
 */
export function daysCovered(r: Interval, maxDays = 62): Date[] {
  const start = new Date(ms(r.startsAt));
  const end = ms(r.endsAt);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const out: Date[] = [];
  while (day.getTime() < end && out.length < maxDays) {
    out.push(new Date(day));
    day.setDate(day.getDate() + 1);
  }
  return out.length ? out : [new Date(start.getFullYear(), start.getMonth(), start.getDate())];
}

/** Past bookings, most recent first. */
export function past<T extends Interval>(rows: T[], now: Date = new Date()): T[] {
  return rows
    .filter((r) => ms(r.endsAt) <= now.getTime())
    .sort((a, b) => ms(b.startsAt) - ms(a.startsAt));
}
