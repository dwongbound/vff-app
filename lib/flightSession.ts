// A flight SESSION: one log entry, from the preflight walk to the shutdown.
//
// The club's three cards are walked at three different moments — standing at
// the wing, sitting at the hold-short line, standing at the tail — and each of
// them reads numbers off the panel that belong to the same flight. This module
// is the rule that says so: what a card contributes to the log entry, which
// entry a card joins, and what state that entry is in.
//
// Why the Flight row itself is the session, rather than a table above it: the
// three things the club wants to know about an airplane that is out — who has
// it, when they left, and what the tach read when they did — are three columns
// of the log entry that flight will BE. Opening a second row to hold them would
// mean deciding, at post-flight time, how to merge two records that were always
// about one flight; the merge is the bug, so there is only ever one row.
//
// Pure. Nothing here touches Prisma or the network — the db half is
// lib/flightSessions.ts, and this is what it (and the pages) ask.
import { clubDateKey, clubInstant } from "./dates";
import type { Values } from "./checkouts";

/**
 * How long an unfiled session stays attachable, in hours.
 *
 * The window exists because a member who walks a preflight and then doesn't fly
 * leaves a session open behind them, and the next card they walk — days later,
 * for a different flight — must not join it. A day is the honest limit for
 * "this is still the same trip": the club's airplane goes out and comes back
 * the same day, and a genuine overnight is the case the member can still close
 * out by hand from the log.
 */
export const SESSION_WINDOW_HOURS = 24;

/** Where a log entry is in its life. */
export type SessionState = "OPEN" | "FILED";

export interface SessionLike {
  filedAt?: string | Date | null;
  tachStart?: number | null;
  tachEnd?: number | null;
}

/**
 * OPEN = the airplane is out; FILED = this is the log entry.
 *
 * Keyed on `filedAt` alone, deliberately, rather than on "does it have an end
 * reading". A member is allowed to file an entry with meters they never managed
 * to read, and an entry filed with a blank tach end is still filed — it's a
 * record with a gap in it, not a flight in progress. Conflating the two would
 * put a finished flight back on the "still out" list forever.
 */
export function sessionState(flight: SessionLike): SessionState {
  return flight.filedAt ? "FILED" : "OPEN";
}

/** Is this entry still open — the airplane out, the flight unfinished? */
export function isOpenSession(flight: SessionLike): boolean {
  return sessionState(flight) === "OPEN";
}

/**
 * A FILED entry with a meter reading missing — a record with a gap in it.
 *
 * Deliberately a different question from `isOpenSession`, and the difference
 * is the point: an OPEN entry is a flight still happening, while this is a
 * finished flight the club knows it is missing a number from. Both look like
 * "no tach end" in the database, and only `filedAt` tells them apart.
 *
 * It exists because filing incomplete is ALLOWED — a member who never got the
 * shutdown reading should still be able to record that the flight happened,
 * since a row with a gap is a better record than no row. But "allowed" is only
 * half of it: an entry nobody can find is one nobody fixes, and an unfindable
 * gap bills nothing forever (`flightCharge` returns null on an unmeasurable
 * span). So the log badges these, and filling the reading in later re-bills
 * the flight, because every write re-runs `syncFlightCharges`.
 */
export function isIncompleteEntry(flight: SessionLike): boolean {
  if (isOpenSession(flight)) return false;
  return flight.tachStart == null || flight.tachEnd == null;
}

/** Which readings a filed entry is missing, for a badge or a prompt. */
export function missingMeters(flight: SessionLike): string[] {
  if (isOpenSession(flight)) return [];
  const missing: string[] = [];
  if (flight.tachStart == null) missing.push("tach start");
  if (flight.tachEnd == null) missing.push("tach end");
  return missing;
}

// ── What each card contributes to the log entry ────────────────────────────
//
// The field ids below are the club's own cards (lib/checkouts.ts). They are
// named here rather than reached for inline in a route so there is ONE list of
// "readings that become log columns" — a card growing a second tach field is
// then a change in one place, and renaming one of these is caught by the test
// that asserts they still exist on their card.

/** Preflight: read in the cockpit with the master on, before the walk. */
export const START_FIELDS = {
  tach: "cockpit.meters.tach",
  hobbs: "cockpit.meters.hobbs",
  clock: "cockpit.time.at",
} as const;

/** Runway: the flight timer, started as the engine comes alive. */
export const RUNWAY_FIELDS = {
  clock: "starting.timer.at",
} as const;

/** Turn-off: both meters and the timer, read before you get out. */
export const END_FIELDS = {
  tach: "shutdown.tach.hours",
  hobbs: "shutdown.tach.hobbs",
  clock: "shutdown.timer.at",
} as const;

/** A number off a card's `values`, or null for anything that isn't one. */
function numberValue(values: Values | undefined, id: string): number | null {
  const v = values?.[id];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** An "HH:MM" off a card's `values`, or null. */
function clockValue(values: Values | undefined, id: string): string | null {
  const v = values?.[id];
  return typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v : null;
}

export interface SessionStart {
  tachStart: number | null;
  hobbsStart: number | null;
  startedAt: Date | null;
}

export interface SessionEnd {
  tachEnd: number | null;
  hobbsEnd: number | null;
  endedAt: Date | null;
}

/**
 * What a signed-off PREFLIGHT card puts into the log entry it opens.
 *
 * `day` is the calendar day at the club the card was walked on, which is what
 * turns the card's "HH:MM" into an instant — see `clubInstant`. Anything the
 * member left blank comes back null and simply isn't written: a walk that
 * skipped the meter line opens a session with no start reading, which is
 * exactly what the log should then show.
 */
export function startFromPreflight(values: Values, day: string): SessionStart {
  const clock = clockValue(values, START_FIELDS.clock);
  return {
    tachStart: numberValue(values, START_FIELDS.tach),
    hobbsStart: numberValue(values, START_FIELDS.hobbs),
    startedAt: clock ? clubInstant(day, clock) : null,
  };
}

/**
 * What a signed-off RUNWAY card contributes.
 *
 * Only a time, and only the one the card actually starts: the flight timer goes
 * on as the engine does, which is a truer "off" time than the preflight's
 * clock reading twenty minutes earlier at the wing. Nothing else on this card
 * is a log column — there is no meter on it, because the meters were read
 * before the walk and will be read again at shutdown.
 */
export function startFromRunway(values: Values, day: string): { startedAt: Date | null } {
  const clock = clockValue(values, RUNWAY_FIELDS.clock);
  return { startedAt: clock ? clubInstant(day, clock) : null };
}

/** What the TURN-OFF card closes the entry with. */
export function endFromTurnoff(values: Values, day: string): SessionEnd {
  const clock = clockValue(values, END_FIELDS.clock);
  return {
    tachEnd: numberValue(values, END_FIELDS.tach),
    hobbsEnd: numberValue(values, END_FIELDS.hobbs),
    endedAt: clock ? clubInstant(day, clock) : null,
  };
}

/**
 * The out/in times of one entry, with an overnight leg handled.
 *
 * A flight that departs at 22:00 and shuts down at 00:30 has both clock
 * readings recorded against the day it took off on, so a naive pair reads as
 * minus twenty-one and a half hours. Rolling the end forward a day is the only
 * reading of those two numbers that describes a flight — and it is capped by
 * the same reasoning at one rollover, so a mistyped end time comes back as
 * itself rather than as a plausible-looking flight a day long.
 */
export function resolveTimes(
  startedAt: Date | null,
  endedAt: Date | null
): { startedAt: Date | null; endedAt: Date | null } {
  if (!startedAt || !endedAt) return { startedAt, endedAt };
  if (endedAt.getTime() >= startedAt.getTime()) return { startedAt, endedAt };
  return {
    startedAt,
    endedAt: new Date(endedAt.getTime() + 86_400_000),
  };
}

/**
 * May this member edit this log entry?
 *
 * The pilot's own entry, or an admin's correction of anyone's — the same rule
 * PATCH /api/flights/[id] enforces, kept here so the modal and the route can't
 * drift. It deliberately does NOT depend on the entry being filed: an open
 * session is a row in the log like any other, and a member who mistyped the
 * tach they walked in with should be able to fix it before they fly, not after.
 */
export function canEditFlight(
  flight: { userId?: string | null; pilot?: { id: string } | null },
  viewer: { id: string; isAdmin?: boolean } | null | undefined
): boolean {
  if (!viewer) return false;
  if (viewer.isAdmin) return true;
  const owner = flight.userId ?? flight.pilot?.id ?? null;
  return owner != null && owner === viewer.id;
}

/**
 * May this member write the log entry's write-up?
 *
 * The AUTHOR only, admin or not. The rest of the entry is the club's shared
 * record of an airplane — meters, landings, who flew — and an admin fixing a
 * transposed tach digit is fixing the club's books. The write-up is the pilot's
 * own account of their flight, and there is no version of "the club needed it
 * corrected" that ends with someone else's words under a member's name.
 */
export function canEditLogEntry(
  flight: { userId?: string | null; pilot?: { id: string } | null },
  viewer: { id: string } | null | undefined
): boolean {
  if (!viewer) return false;
  const owner = flight.userId ?? flight.pilot?.id ?? null;
  return owner != null && owner === viewer.id;
}

/**
 * The calendar day at the club a card was walked on, as `clubInstant` wants it.
 *
 * A thin name over `clubDateKey`, so the routes read as "the day this card
 * belongs to" rather than as a formatting call.
 */
export function cardDay(at: string | Date = new Date()): string {
  return clubDateKey(at);
}
