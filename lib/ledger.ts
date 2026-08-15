// The database half of the club's books. lib/finance.ts decides WHAT a line
// should be; this decides when to write it.
//
// Two kinds of line are derived rather than typed in, and both are kept in
// step here so the statement can never drift from the flight log:
//
//   • a filed flight's hours charge and fuel credit — rebuilt whenever the
//     flight is filed or corrected, deleted with it (cascade).
//   • the monthly dues — materialised the first time anyone reads a statement
//     for that month, idempotently, so the club needs no cron job.
//
// Lives in lib/ because a route module may only export Next's own handlers.
import {
  chargesForFlight,
  isBillablePeriod,
  membersBilledBy,
  servicingCredit,
  type BillableServicing,
  type Period,
  type RecurringRule,
} from "./finance";
import { prisma } from "./prisma";

/** Everything the derivation needs about a flight. */
export interface FlightForBilling {
  id: string;
  userId: string;
  tachStart: number;
  tachEnd: number;
  flownOn: Date;
  fuelCostCents: number | null;
  landingFeeCents?: number | null;
  arrival?: string | null;
  aircraft: { tailNumber: string; hourlyRateCents: number | null };
}

/**
 * Rewrite a flight's derived charges to match the flight as it now stands.
 *
 * Called on file and on every correction. Deleting and re-creating (rather
 * than updating in place) is deliberate: a correction can make a line vanish
 * entirely — a tach typo fixed to zero hours, or a fuel receipt removed — and
 * "delete then write whatever is right now" handles that without a special
 * case per field.
 *
 * Voided lines are left alone. If an officer has already unwound a flight's
 * charge by hand, a later edit to the flight must not quietly resurrect it.
 */
/** Everything the derivation needs about a fill-up. */
export interface ServicingForBilling extends BillableServicing {
  userId: string;
  aircraft: { tailNumber: string };
}

/**
 * Rebuild the fuel credit for one standalone fill-up.
 *
 * Same contract as `syncFlightCharges`: derived lines are rebuilt from the
 * source row on every write, and any line an officer has VOIDED is left alone
 * — unvoiding by editing the thing it came from would undo a deliberate
 * decision without anyone deciding it.
 *
 * Note this can legitimately end up writing nothing: a fill-up on the club's
 * card, or one with no cost recorded, owes the member nothing. Deleting first
 * and writing second is what makes "I ticked the wrong card" fix the books.
 */
export async function syncServicingCharges(servicing: ServicingForBilling) {
  const existing = await prisma.charge.findMany({
    where: { servicingId: servicing.id },
    select: { kind: true, voided: true },
  });
  const voidedKinds = new Set(existing.filter((c) => c.voided).map((c) => c.kind));

  await prisma.charge.deleteMany({
    where: { servicingId: servicing.id, voided: false },
  });

  const line = servicingCredit(servicing, servicing.aircraft.tailNumber);
  if (!line || voidedKinds.has(line.kind)) return;

  await prisma.charge.create({
    data: {
      memberId: servicing.userId,
      kind: line.kind,
      amountCents: line.amountCents,
      description: line.description,
      period: line.period,
      incurredOn: line.incurredOn,
      servicingId: servicing.id,
    },
  });
}

export async function syncFlightCharges(flight: FlightForBilling) {
  const existing = await prisma.charge.findMany({
    where: { flightId: flight.id },
    select: { id: true, kind: true, voided: true },
  });
  const voidedKinds = new Set(
    existing.filter((c) => c.voided).map((c) => c.kind)
  );

  await prisma.charge.deleteMany({
    where: { flightId: flight.id, voided: false },
  });

  const lines = chargesForFlight(
    flight,
    flight.aircraft.hourlyRateCents,
    flight.aircraft.tailNumber
  ).filter((line) => !voidedKinds.has(line.kind));

  if (lines.length === 0) return;

  await prisma.charge.createMany({
    data: lines.map((line) => ({
      memberId: flight.userId,
      kind: line.kind,
      amountCents: line.amountCents,
      description: line.description,
      period: line.period,
      incurredOn: line.incurredOn,
      flightId: line.flightId,
    })),
  });
}

/**
 * Make sure every standing rule has produced its line for this month.
 *
 * Idempotent by construction: the unique index on
 * (memberId, recurringChargeId, period) means a second run inserts nothing, so
 * this can safely be called on every read of a statement. That's why the club
 * doesn't need a scheduled job to "run billing" — reading August's page IS
 * running August's billing, and reading it twice charges once.
 *
 * Future months are never materialised (see `isBillablePeriod`): you can look
 * ahead at next month, but nothing lands on the books until it's been reached.
 */
export async function ensureRecurringCharges(period: Period) {
  if (!isBillablePeriod(period)) return;

  const rules = await prisma.recurringCharge.findMany({
    where: { active: true },
    select: {
      id: true,
      label: true,
      amountCents: true,
      memberId: true,
      startsOn: true,
      endsOn: true,
      active: true,
    },
  });
  if (rules.length === 0) return;

  const members = await prisma.user.findMany({
    select: { id: true, createdAt: true },
  });
  const roster = members.map((m) => ({ id: m.id, joinedAt: m.createdAt }));

  // The first of the month is when dues are incurred, regardless of when
  // anyone happens to open the page.
  const [year, month] = period.split("-").map(Number);
  const incurredOn = new Date(year, month - 1, 1, 12, 0, 0, 0);

  const rows: {
    memberId: string;
    kind: "DUES";
    amountCents: number;
    description: string;
    period: string;
    incurredOn: Date;
    recurringChargeId: string;
  }[] = [];

  for (const rule of rules as RecurringRule[]) {
    for (const memberId of membersBilledBy(rule, period, roster)) {
      rows.push({
        memberId,
        kind: "DUES",
        amountCents: rule.amountCents,
        description: rule.label,
        period,
        incurredOn,
        recurringChargeId: rule.id,
      });
    }
  }

  if (rows.length === 0) return;
  // skipDuplicates is what makes the second call a no-op rather than an error.
  await prisma.charge.createMany({ data: rows, skipDuplicates: true });
}
