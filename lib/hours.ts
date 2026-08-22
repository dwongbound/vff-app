// Tach/Hobbs arithmetic and flight-log totals.
//
// Why both meters: the tachometer runs proportionally to RPM (so it under-reads
// taxi and idle time) and is what most clubs bill on; the Hobbs runs on
// oil pressure — real elapsed time, which is what you log as flight time.
// Recording both catches a mis-read meter, which is the single most common
// error in a club flight log.

/** Round to the tenth a meter actually displays, without float dust. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to hundredths — meters read to 0.01 on some tachs. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The four readings, each of which may be missing.
 *
 * Every one is optional because a log entry now spans a whole session and can
 * legitimately be looked at halfway through it. A row with a start and no end
 * is an airplane that hasn't come back; a row with an end and no start is a
 * flight closed out by somebody who never walked the preflight card. Both are
 * better records than no row, so the arithmetic here answers "unknown" rather
 * than refusing to run — see `tachHours` returning null.
 */
export interface Meters {
  tachStart?: number | null;
  tachEnd?: number | null;
  hobbsStart?: number | null;
  hobbsEnd?: number | null;
}

/** A reading that is actually a reading — not null, not NaN, not a blank box. */
function reading(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Billable tach time for one flight, or null when either end is unknown.
 *
 * Null rather than 0, and the difference is the whole reason this returns a
 * nullable: zero hours is a claim ("the airplane ran and logged nothing"),
 * while an open session is the absence of one. Totals treat null as
 * contributing nothing; the ledger refuses to bill it at all.
 */
export function tachHours(m: Pick<Meters, "tachStart" | "tachEnd">): number | null {
  const start = reading(m.tachStart);
  const end = reading(m.tachEnd);
  if (start == null || end == null) return null;
  return round2(end - start);
}

/** Both tach readings are in — the flight has a measurable span. */
export function hasTachSpan(m: Pick<Meters, "tachStart" | "tachEnd">): boolean {
  return tachHours(m) !== null;
}

/** Hobbs (elapsed) time, or null when the airplane has no Hobbs entry. */
export function hobbsHours(
  m: Pick<Meters, "hobbsStart" | "hobbsEnd">
): number | null {
  const start = reading(m.hobbsStart);
  const end = reading(m.hobbsEnd);
  if (start == null || end == null) return null;
  return round2(end - start);
}

/**
 * Validate a set of meter readings. Returns a member-facing message or null.
 *
 * Every reading is OPTIONAL here, which is the change a flight session brings:
 * a row is looked at (and saved) at three different points in its life, and
 * only the last of them has all four numbers. What this checks is that the
 * readings which ARE present make sense together — a missing one is a state,
 * not a mistake. "Did you give me enough to FILE this?" is a different question
 * and is asked separately by whoever is filing — `POST /api/flights` insists on
 * a tach END, because that is the number the pilot has just read off the panel,
 * and deliberately does not insist on a start.
 *
 * The "Hobbs is much smaller than tach" check is the mis-read catcher: Hobbs
 * counts wall-clock time including taxi, so it is essentially always ≥ tach.
 * A Hobbs that comes in below tach means one of the four numbers was typed
 * wrong (usually a transposed digit).
 */
export function validateMeters(m: Meters): string | null {
  const tachStart = reading(m.tachStart);
  const tachEnd = reading(m.tachEnd);
  const hobbsStart = reading(m.hobbsStart);
  const hobbsEnd = reading(m.hobbsEnd);

  // A reading that was given has to be a real one. Note this catches the
  // Number("abc") case the old `Number.isFinite` pair caught, while a field
  // that was simply never filled in now passes straight through.
  for (const value of [tachStart, tachEnd, hobbsStart, hobbsEnd]) {
    if (value != null && value < 0) return "Meter readings can't be negative.";
  }
  if (m.tachStart != null && tachStart == null) return "That tach start isn't a number.";
  if (m.tachEnd != null && tachEnd == null) return "That tach end isn't a number.";

  const tach = tachHours(m);
  if (tach != null) {
    if (tach < 0) {
      return "Tach end is lower than tach start — check the readings.";
    }
    if (tach === 0) {
      return "Tach start and end are the same — no flight time recorded.";
    }
    if (tach > 12) {
      return "That's over 12 hours of tach time — check for a typo.";
    }
  }

  // The "one Hobbs and not the other" catcher, and it only applies to a flight
  // with both ends recorded. Half a Hobbs pair on a half-recorded flight is the
  // half that HAS been read: a session in progress has a start and no end
  // because the airplane is still out, and an entry closed out without a
  // preflight has an end and no start because nobody read the panel first.
  if (tachStart != null && tachEnd != null) {
    if ((hobbsStart == null) !== (hobbsEnd == null)) {
      return "Enter both Hobbs readings, or neither.";
    }
  }

  const hobbs = hobbsHours(m);
  if (hobbs != null) {
    if (hobbs < 0) {
      return "Hobbs end is lower than Hobbs start — check the readings.";
    }
    // Allow a small margin for a tach that runs fast at cruise RPM.
    if (tach != null && hobbs + 0.2 < tach) {
      return "Hobbs time is well below tach time — double-check both meters.";
    }
  }

  return null;
}

export interface FlightLike {
  tachStart?: number | null;
  tachEnd?: number | null;
  hobbsStart?: number | null;
  hobbsEnd?: number | null;
  landings?: number;
  flownOn?: string | Date;
  fuelAddedGal?: number | null;
  fuelCostCents?: number | null;
}

/**
 * Total tach hours across a set of flights.
 *
 * A flight with no measurable span contributes nothing rather than dropping the
 * total: "hours flown this month" is a sum over what is known, and a session
 * still in the air has nothing to add to it yet.
 */
export function totalTachHours(flights: FlightLike[]): number {
  return round1(flights.reduce((sum, f) => sum + (tachHours(f) ?? 0), 0));
}

/** One month of flying, for the Plane Status utilisation chart. */
export interface MonthlyHours {
  /** First of the month, local — the bucket's identity and its sort key. */
  month: Date;
  /** "Aug", for the axis. */
  label: string;
  hours: number;
}

/**
 * Tach hours per calendar month, oldest first, for the last `months` months
 * INCLUDING the current one.
 *
 * Empty months are returned as zeroes rather than skipped: a gap in the club's
 * flying is the most interesting thing this chart can show, and dropping the
 * bucket would silently redraw a quiet winter as a continuous run of activity.
 *
 * Buckets are local calendar months (the club's timezone, see instrumentation)
 * so a late-evening flight lands in the day the pilot flew it.
 */
export function monthlyTachHours(
  flights: FlightLike[],
  months: number,
  now: Date = new Date()
): MonthlyHours[] {
  const buckets: MonthlyHours[] = [];
  const index = new Map<string, MonthlyHours>();

  for (let i = months - 1; i >= 0; i--) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const bucket: MonthlyHours = {
      month,
      label: month.toLocaleDateString(undefined, { month: "short" }),
      hours: 0,
    };
    buckets.push(bucket);
    index.set(`${month.getFullYear()}-${month.getMonth()}`, bucket);
  }

  for (const flight of flights) {
    if (!flight.flownOn) continue;
    const d = new Date(flight.flownOn);
    if (Number.isNaN(d.getTime())) continue;
    const bucket = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    // Flights older than the window (or dated into the future) simply have no
    // bucket — that's the window doing its job, not an error.
    if (bucket) bucket.hours += tachHours(flight) ?? 0;
  }

  for (const bucket of buckets) bucket.hours = round1(bucket.hours);
  return buckets;
}

export function totalLandings(flights: FlightLike[]): number {
  return flights.reduce((sum, f) => sum + (f.landings ?? 0), 0);
}

/** Flights whose `flownOn` falls in [from, to). */
export function inRange<T extends FlightLike>(
  flights: T[],
  from: Date,
  to: Date
): T[] {
  return flights.filter((f) => {
    if (!f.flownOn) return false;
    const t = new Date(f.flownOn).getTime();
    return t >= from.getTime() && t < to.getTime();
  });
}

/**
 * What a flight costs at the aircraft's wet rate.
 *
 * Null when no rate is set, and null again when the flight has no measurable
 * span — an open session costs nothing YET, which is a different answer from
 * $0.00 and is worth showing as one.
 */
export function flightCostCents(
  f: FlightLike,
  hourlyRateCents: number | null | undefined
): number | null {
  if (hourlyRateCents == null) return null;
  const hours = tachHours(f);
  if (hours == null) return null;
  return Math.round(hours * hourlyRateCents);
}

/** "1.4" — hours as pilots write them, always to one decimal. */
export function formatHours(hours: number): string {
  return hours.toFixed(1);
}

/** "$182.50" from whole cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
