// The writing MCP tools' arguments, as pure rules (unit-tested in
// tests/unit/agentWrites.test.ts): what an assistant sent → the body the app's
// own route takes, or a sentence saying what's wrong. The MCP route resolves
// the names (tail number, instructor) and then calls the SAME route handler
// the app does, so every booking rule, conflict check, Google write and bill
// is the app's own — nothing here decides whether a booking is allowed.
import { clubDateKey, clubInstant } from "./dates";
import { isPurpose, type Purpose } from "./constants";
import { normalizeTailNumber } from "./aircraft";

type Args = Record<string, unknown>;
type Parsed<T> = { value: T } | { error: string };

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A time an assistant sent → an instant. "2026-11-14T09:00" is read as the
 * CLUB's clock, never the server's (which is UTC on Vercel — reading it there
 * would book the airplane eight hours off). An ISO string with an offset is
 * taken as the instant it names. Anything else is null.
 */
export function parseClubTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const local = LOCAL_TIME.exec(text);
  if (local) return clubInstant(local[1], local[2]);
  if (!HAS_OFFSET.test(text)) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** An optional string argument, trimmed; blank is absent. */
function text(args: Args, key: string): string | null {
  const v = args[key];
  if (typeof v !== "string") return null;
  return v.trim() || null;
}

/** An optional number argument. A string of digits is accepted too. */
function number(args: Args, key: string): number | null | "invalid" {
  const v = args[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "invalid";
}

/** The purpose argument: absent → the fallback, unknown → an error. */
function purposeArg(args: Args, fallback: Purpose | null): Parsed<Purpose | null> {
  const v = args.purpose;
  if (v === undefined || v === null || v === "") return { value: fallback };
  if (isPurpose(v)) return { value: v };
  return { error: `Unknown purpose "${String(v)}".` };
}

export interface BookingRequest {
  startsAt: Date;
  endsAt: Date;
  purpose: Purpose;
  tailNumber: string | null;
  instructor: string | null;
  notes: string | null;
}

/** book_airplane's arguments. The route still runs the club's booking rules. */
export function parseBookingArgs(args: Args): Parsed<BookingRequest> {
  const startsAt = parseClubTime(args.startsAt);
  const endsAt = parseClubTime(args.endsAt);
  if (!startsAt || !endsAt) {
    return { error: 'Give startsAt and endsAt as club time, "YYYY-MM-DDTHH:mm".' };
  }
  const purpose = purposeArg(args, "LOCAL");
  if ("error" in purpose) return purpose;
  return {
    value: {
      startsAt,
      endsAt,
      purpose: purpose.value ?? "LOCAL",
      tailNumber: text(args, "tailNumber"),
      instructor: text(args, "instructor"),
      notes: text(args, "notes"),
    },
  };
}

/** cancel_booking's one argument. */
export function parseCancelArgs(args: Args): Parsed<{ bookingId: string }> {
  const bookingId = text(args, "bookingId");
  if (!bookingId) return { error: "Give the bookingId (the `id` from get_bookings)." };
  return { value: { bookingId } };
}

export interface FlightRequest {
  /** The body for POST /api/flights, less aircraftId and instructorId. */
  body: Record<string, unknown>;
  tailNumber: string | null;
  instructor: string | null;
}

const FLIGHT_NUMBERS = [
  "tachStart",
  "tachEnd",
  "hobbsStart",
  "hobbsEnd",
  "landings",
  "nightLandings",
  "fuelAddedGal",
  "fuelCostDollars",
] as const;

/**
 * file_flight's arguments. `flownOn` is a club DAY and goes to the route as
 * that day's club midnight — the same instant the app's own forms send.
 * tachEnd is required here, as it is on the post-flight form: an assistant
 * filing a flight with no reading is a slip, not an honest gap.
 */
export function parseFlightArgs(args: Args, now: Date = new Date()): Parsed<FlightRequest> {
  const body: Record<string, unknown> = {};
  for (const key of FLIGHT_NUMBERS) {
    const n = number(args, key);
    if (n === "invalid") return { error: `${key} has to be a number.` };
    if (n !== null) body[key] = n;
  }
  if (body.tachEnd === undefined) return { error: "Give tachEnd, the tach reading at shutdown." };

  const day = text(args, "flownOn") ?? clubDateKey(now);
  if (!DAY.test(day)) return { error: "Give flownOn as YYYY-MM-DD." };
  const flownOn = clubInstant(day, "00:00");
  if (!flownOn) return { error: "Give flownOn as YYYY-MM-DD." };
  body.flownOn = flownOn.toISOString();

  const purpose = purposeArg(args, null);
  if ("error" in purpose) return purpose;
  if (purpose.value) body.purpose = purpose.value;

  for (const key of ["departure", "arrival", "route", "notes"] as const) {
    const v = text(args, key);
    if (v) body[key] = v;
  }
  if (typeof args.fuelPaidPersonally === "boolean") body.fuelPaidPersonally = args.fuelPaidPersonally;
  const requestId = text(args, "requestId");
  if (requestId) body.requestId = requestId;

  return {
    value: { body, tailNumber: text(args, "tailNumber"), instructor: text(args, "instructor") },
  };
}

/**
 * The airplane a tool means: the one named, or the only active one when none
 * is. Matching goes through `normalizeTailNumber`, so "n8318b" finds N8318B.
 */
export function pickAircraft<T extends { tailNumber: string }>(
  fleet: T[],
  tailNumber: string | null
): Parsed<T> {
  if (tailNumber) {
    const wanted = normalizeTailNumber(tailNumber);
    const found = fleet.find((a) => normalizeTailNumber(a.tailNumber) === wanted);
    if (found) return { value: found };
    return { error: `No active club airplane is ${wanted}.` };
  }
  if (fleet.length === 1) return { value: fleet[0] };
  if (fleet.length === 0) return { error: "The club has no active airplane." };
  return { error: `Say which airplane: ${fleet.map((a) => a.tailNumber).join(", ")}.` };
}

/**
 * The instructor a tool names, off the club's CFIs: an exact full name first,
 * then a unique first name, then a unique partial match. Ambiguity is an error
 * naming the candidates, never a guess — a lesson booked with the wrong CFI
 * invites the wrong person.
 */
export function pickInstructor<T extends { id: string; name: string }>(
  instructors: T[],
  name: string
): Parsed<T> {
  const wanted = name.trim().toLowerCase();
  const tiers = [
    (i: T) => i.name.toLowerCase() === wanted,
    (i: T) => i.name.toLowerCase().split(/\s+/)[0] === wanted,
    (i: T) => i.name.toLowerCase().includes(wanted),
  ];
  for (const matches of tiers) {
    const hits = instructors.filter(matches);
    if (hits.length === 1) return { value: hits[0] };
    if (hits.length > 1) {
      return { error: `More than one instructor matches "${name}": ${hits.map((i) => i.name).join(", ")}.` };
    }
  }
  return { error: `No club instructor is called "${name}".` };
}

export interface BookingUpdate {
  bookingId: string;
  /** The fields for PATCH /api/reservations/[id], less instructorId. */
  body: Record<string, unknown>;
  /** A CFI's name to resolve; "" = clear the instructor; null = leave it. */
  instructor: string | null;
}

/**
 * update_booking's arguments. Only what's named changes: a time left out keeps
 * the booking's own, so moving the end alone is one argument. The route still
 * re-runs the booking rules and the conflict check when the times move.
 */
export function parseBookingUpdateArgs(args: Args): Parsed<BookingUpdate> {
  const bookingId = text(args, "bookingId");
  if (!bookingId) return { error: "Give the bookingId (the `id` from get_bookings)." };
  const body: Record<string, unknown> = {};
  for (const key of ["startsAt", "endsAt"] as const) {
    if (args[key] === undefined || args[key] === null || args[key] === "") continue;
    const at = parseClubTime(args[key]);
    if (!at) return { error: `Give ${key} as club time, "YYYY-MM-DDTHH:mm".` };
    body[key] = at.toISOString();
  }
  const purpose = purposeArg(args, null);
  if ("error" in purpose) return purpose;
  if (purpose.value) body.purpose = purpose.value;
  // Notes can be emptied, so "" is an answer here rather than "absent".
  if (typeof args.notes === "string") body.notes = args.notes.trim() || null;

  let instructor: string | null = null;
  if (typeof args.instructor === "string") instructor = args.instructor.trim();
  if (Object.keys(body).length === 0 && instructor === null) {
    return { error: "Say what to change: startsAt, endsAt, purpose, instructor or notes." };
  }
  return { value: { bookingId, body, instructor } };
}

export interface FlightUpdate {
  flightId: string;
  /** The fields for PATCH /api/flights/[id], less instructorId. */
  body: Record<string, unknown>;
  /** A CFI's name to resolve; "" = clear the instructor; null = leave it. */
  instructor: string | null;
}

/** The meters: a number sets one, null empties it (an honest gap). */
const FLIGHT_METERS = ["tachStart", "tachEnd", "hobbsStart", "hobbsEnd"] as const;
const FLIGHT_COUNTS = ["landings", "nightLandings", "fuelAddedGal", "fuelCostDollars"] as const;
const FLIGHT_TEXTS = ["departure", "arrival", "route", "notes", "logEntry"] as const;

/**
 * update_flight's arguments: a correction to one of the member's own log
 * entries, the way the log's Edit does. Only what's named is sent, so the
 * route's "did anything really change" check — which decides whether a
 * signed lesson reads "signed, then edited" — sees exactly the correction.
 */
export function parseFlightUpdateArgs(args: Args): Parsed<FlightUpdate> {
  const flightId = text(args, "flightId");
  if (!flightId) return { error: "Give the flightId (the `id` from get_my_flying)." };
  const body: Record<string, unknown> = {};

  for (const key of FLIGHT_METERS) {
    if (!(key in args)) continue;
    if (args[key] === null) {
      body[key] = null;
      continue;
    }
    const n = number(args, key);
    if (n === "invalid" || n === null) return { error: `${key} has to be a number, or null to clear it.` };
    body[key] = n;
  }
  for (const key of FLIGHT_COUNTS) {
    const n = number(args, key);
    if (n === "invalid") return { error: `${key} has to be a number.` };
    if (n !== null) body[key] = n;
  }
  // Text can be emptied, so "" is an answer here rather than "absent".
  for (const key of FLIGHT_TEXTS) {
    if (typeof args[key] === "string") body[key] = (args[key] as string).trim() || null;
  }
  if (typeof args.fuelPaidPersonally === "boolean") body.fuelPaidPersonally = args.fuelPaidPersonally;

  const day = text(args, "flownOn");
  if (day) {
    const flownOn = DAY.test(day) ? clubInstant(day, "00:00") : null;
    if (!flownOn) return { error: "Give flownOn as YYYY-MM-DD." };
    body.flownOn = flownOn.toISOString();
  }
  const purpose = purposeArg(args, null);
  if ("error" in purpose) return purpose;
  if (purpose.value) body.purpose = purpose.value;

  let instructor: string | null = null;
  if (typeof args.instructor === "string") instructor = args.instructor.trim();
  if (Object.keys(body).length === 0 && instructor === null) {
    return { error: "Say what to change on the entry." };
  }
  return { value: { flightId, body, instructor } };
}
