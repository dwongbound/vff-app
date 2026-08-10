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

export interface Meters {
  tachStart: number;
  tachEnd: number;
  hobbsStart?: number | null;
  hobbsEnd?: number | null;
}

/** Billable tach time for one flight. */
export function tachHours(m: Pick<Meters, "tachStart" | "tachEnd">): number {
  return round2(m.tachEnd - m.tachStart);
}

/** Hobbs (elapsed) time, or null when the airplane has no Hobbs entry. */
export function hobbsHours(
  m: Pick<Meters, "hobbsStart" | "hobbsEnd">
): number | null {
  if (m.hobbsStart == null || m.hobbsEnd == null) return null;
  return round2(m.hobbsEnd - m.hobbsStart);
}

/**
 * Validate a post-flight meter entry. Returns a member-facing message or null.
 *
 * The "Hobbs is much smaller than tach" check is the mis-read catcher: Hobbs
 * counts wall-clock time including taxi, so it is essentially always ≥ tach.
 * A Hobbs that comes in below tach means one of the four numbers was typed
 * wrong (usually a transposed digit).
 */
export function validateMeters(m: Meters): string | null {
  if (!Number.isFinite(m.tachStart) || !Number.isFinite(m.tachEnd)) {
    return "Enter both tach readings.";
  }
  if (m.tachStart < 0 || m.tachEnd < 0) {
    return "Meter readings can't be negative.";
  }
  if (m.tachEnd < m.tachStart) {
    return "Tach end is lower than tach start — check the readings.";
  }
  if (tachHours(m) === 0) {
    return "Tach start and end are the same — no flight time recorded.";
  }
  if (tachHours(m) > 12) {
    return "That's over 12 hours of tach time — check for a typo.";
  }

  const hasStart = m.hobbsStart != null;
  const hasEnd = m.hobbsEnd != null;
  if (hasStart !== hasEnd) {
    return "Enter both Hobbs readings, or neither.";
  }

  const hobbs = hobbsHours(m);
  if (hobbs != null) {
    if (hobbs < 0) {
      return "Hobbs end is lower than Hobbs start — check the readings.";
    }
    // Allow a small margin for a tach that runs fast at cruise RPM.
    if (hobbs + 0.2 < tachHours(m)) {
      return "Hobbs time is well below tach time — double-check both meters.";
    }
  }

  return null;
}

export interface FlightLike {
  tachStart: number;
  tachEnd: number;
  hobbsStart?: number | null;
  hobbsEnd?: number | null;
  landings?: number;
  flownOn?: string | Date;
  fuelAddedGal?: number | null;
  fuelCostCents?: number | null;
}

/** Total tach hours across a set of flights. */
export function totalTachHours(flights: FlightLike[]): number {
  return round1(flights.reduce((sum, f) => sum + tachHours(f), 0));
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
    if (bucket) bucket.hours += tachHours(flight);
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

/** What a flight costs at the aircraft's wet rate. Null when no rate is set. */
export function flightCostCents(
  f: FlightLike,
  hourlyRateCents: number | null | undefined
): number | null {
  if (hourlyRateCents == null) return null;
  return Math.round(tachHours(f) * hourlyRateCents);
}

/** "1.4" — hours as pilots write them, always to one decimal. */
export function formatHours(hours: number): string {
  return hours.toFixed(1);
}

/** "$182.50" from whole cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
