// What an access key reads, as pure shaping (unit-tested in
// tests/unit/agentView.test.ts): rows in, the plain JSON an assistant reads out.
// The db half is agentSnapshot.ts.
//
// The output is written for a reader that ISN'T this app: every value says
// what it is in words ("GROUNDED", "Training"), money is in dollars, times
// are ISO instants with the club's time zone named alongside, and nothing here
// is a code the reader would have to look up.
import { CHARGE_KIND_LABELS, type ChargeKind } from "./finance";
import { PURPOSE_LABELS, type Purpose } from "./constants";
import {
  MAINTENANCE_STATE_LABELS,
  byUrgency,
  formatRemaining,
  maintenanceDue,
  type MaintenanceFacts,
} from "./maintenance";
import { SQUAWK_STATUS_LABELS, isGrounding, isInMaintenance, type SquawkStatus } from "./squawks";
import { tachHours } from "./hours";
import { bookedBy } from "./reservations";

const dollars = (cents: number) => Math.round(cents) / 100;

// ── The airplane ───────────────────────────────────────────────────────────

export interface AgentAircraftRow {
  tailNumber: string;
  model: string;
  homeBase: string | null;
  hourlyRateCents: number | null;
  lastTach: number | null;
  lastHobbs: number | null;
  squawks: { title: string; status: SquawkStatus; createdAt: Date }[];
  maintenance: (MaintenanceFacts & { label: string })[];
}

/**
 * One airplane: can it fly, and why not. GROUNDED is the app's own two
 * reasons — a grounding squawk, or a legally required inspection past due —
 * and IN_MAINTENANCE is a squawk being worked, which the app is careful to say
 * is NOT a grounding. Open squawks and the maintenance sheet come with it,
 * most urgent first.
 */
export function agentAircraft(row: AgentAircraftRow, now: Date = new Date()) {
  const reasons: string[] = [];
  for (const s of row.squawks) {
    if (isGrounding(s.status)) reasons.push(`Squawk: ${s.title}`);
  }
  const maintenance = byUrgency(row.maintenance, row.lastTach, now).map((item) => {
    const due = maintenanceDue(item, row.lastTach, now);
    if (due.grounds) reasons.push(`Inspection overdue: ${item.label}`);
    return {
      item: item.label,
      state: MAINTENANCE_STATE_LABELS[due.state],
      remaining: formatRemaining(due),
      dueOn: due.dueOn?.toISOString() ?? null,
      dueAtTach: due.dueAtTach,
      requiredByRegulation: item.requiredByReg ?? false,
      groundsTheAirplane: due.grounds,
    };
  });

  let status = "AIRWORTHY";
  if (reasons.length > 0) status = "GROUNDED";
  else if (row.squawks.some((s) => isInMaintenance(s.status))) status = "IN_MAINTENANCE";

  return {
    tailNumber: row.tailNumber,
    model: row.model,
    homeBase: row.homeBase,
    hourlyRateDollars: row.hourlyRateCents == null ? null : dollars(row.hourlyRateCents),
    tach: row.lastTach,
    hobbs: row.lastHobbs,
    status,
    groundedBecause: reasons,
    openSquawks: row.squawks.map((s) => ({
      title: s.title,
      status: SQUAWK_STATUS_LABELS[s.status],
      reportedOn: s.createdAt.toISOString(),
    })),
    maintenance,
  };
}

// ── Bookings ───────────────────────────────────────────────────────────────

export interface AgentBookingRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  purpose: Purpose;
  title: string | null;
  notes: string | null;
  userId: string | null;
  instructorId: string | null;
  user: { name: string } | null;
  instructor: { name: string } | null;
  aircraft: { tailNumber: string };
}

/** One booking, saying whether it's the key holder's own (or their lesson to teach). */
export function agentBooking(row: AgentBookingRow, meId: string) {
  return {
    // What cancel_booking takes, for a key that may write.
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    tailNumber: row.aircraft.tailNumber,
    bookedBy: bookedBy(row),
    purpose: PURPOSE_LABELS[row.purpose],
    instructor: row.instructor?.name ?? null,
    notes: row.notes,
    yours: row.userId === meId,
    youAreTheInstructor: row.instructorId === meId,
  };
}

// ── Flying ─────────────────────────────────────────────────────────────────

export interface AgentFlightRow {
  id: string;
  flownOn: Date;
  filedAt: Date | null;
  tachStart: number | null;
  tachEnd: number | null;
  hobbsStart: number | null;
  hobbsEnd: number | null;
  landings: number;
  nightLandings: number;
  purpose: Purpose | null;
  departure: string | null;
  arrival: string | null;
  route: string | null;
  notes: string | null;
  logEntry: string | null;
  aircraft: { tailNumber: string };
  instructor: { name: string } | null;
  signedAt: Date | null;
}

/** One log entry. `inProgress` is an airplane still out (no `filedAt`). */
export function agentFlight(row: AgentFlightRow) {
  return {
    // What update_flight takes, for a key that may write.
    id: row.id,
    flownOn: row.flownOn.toISOString(),
    tailNumber: row.aircraft.tailNumber,
    tachHours: tachHours(row),
    tachStart: row.tachStart,
    tachEnd: row.tachEnd,
    hobbsStart: row.hobbsStart,
    hobbsEnd: row.hobbsEnd,
    landings: row.landings,
    nightLandings: row.nightLandings,
    type: row.purpose ? PURPOSE_LABELS[row.purpose] : null,
    route: row.route ?? ([row.departure, row.arrival].filter(Boolean).join(" → ") || null),
    instructor: row.instructor?.name ?? null,
    instructorSigned: row.signedAt != null,
    inProgress: row.filedAt == null,
    notes: row.notes,
    // The pilot's own write-up, markdown.
    logEntry: row.logEntry,
  };
}

// ── The club (a club-data key only) ───────────────────────────────────────

/** How far back a pilot's landings are counted. */
export const CLUB_RECENT_DAYS = 90;

export interface ClubPilotRow {
  name: string;
  certificate: string | null;
  totalTimeHours: number | null;
}

export interface ClubPilotFlight {
  flownOn: Date;
  /** Null or missing counts as one landing: every flight lands at least once. */
  landings: number | null | undefined;
}

/**
 * One pilot, and only what the club officer asked for: their ratings and
 * total time (both self-entered on their profile, null when blank) and how
 * many landings the club's log shows in the last 90 days. No flight-by-flight
 * detail leaves the app through this. `flights` is this pilot's, any order.
 */
export function clubPilot(row: ClubPilotRow, flights: ClubPilotFlight[], now: Date) {
  const cutoff = now.getTime() - CLUB_RECENT_DAYS * 86_400_000;
  return {
    name: row.name,
    certificate: row.certificate,
    declaredTotalTimeHours: row.totalTimeHours,
    landingsLast90Days: flights
      .filter((f) => f.flownOn.getTime() >= cutoff)
      .reduce((sum, f) => sum + (f.landings ?? 1), 0),
  };
}

export interface ClubLastFlightRow {
  flownOn: Date;
  aircraft: { tailNumber: string };
  pilot: { name: string };
}

/** Who flew an airplane most recently, and on what day. Nothing else about the flight. */
export function clubLastFlight(row: ClubLastFlightRow) {
  return { tailNumber: row.aircraft.tailNumber, pilot: row.pilot.name, flownOn: row.flownOn.toISOString() };
}

// ── Money ──────────────────────────────────────────────────────────────────

export interface AgentChargeRow {
  kind: ChargeKind;
  amountCents: number;
  description: string;
  incurredOn: Date;
}

/**
 * What the member owes the club right now, across every month: the same rule
 * as the Finances page's headline (standing, unpaid, not deleted — the caller
 * selects those rows). Positive = they owe; negative = the club owes them.
 */
export function agentMoney(unpaid: AgentChargeRow[]) {
  const total = unpaid.reduce((sum, c) => sum + c.amountCents, 0);
  return {
    outstandingDollars: dollars(total),
    meaning:
      total > 0
        ? "The member owes the club this much."
        : total < 0
          ? "The club owes the member this much."
          : "Nothing is owed either way.",
    unpaidLines: [...unpaid]
      .sort((a, b) => b.incurredOn.getTime() - a.incurredOn.getTime())
      .map((c) => ({
        date: c.incurredOn.toISOString(),
        kind: CHARGE_KIND_LABELS[c.kind],
        description: c.description,
        amountDollars: dollars(c.amountCents),
      })),
  };
}
