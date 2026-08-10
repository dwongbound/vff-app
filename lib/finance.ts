// The club's books, as pure logic.
//
// A member's statement for a month is a list of Charge lines:
//
//   + dues        the monthly membership fee, from a RecurringCharge rule
//   + flight      tach hours x the aircraft's hourly rate, per filed flight
//   + one-off     whatever the Finance Officer adds (a checkout fee, a fine)
//   - fuel credit gas the member bought out of pocket, refunded to them
//
// and the balance is simply their sum. Credits are stored as NEGATIVE cents
// rather than as a separate "credits" list, so the balance is one addition and
// there is no way for the two halves to disagree about a sign.
//
// Everything here is arithmetic on plain objects: the database work lives in
// the API routes, which call these to decide what to write.
import { tachHours } from "./hours";

/** A statement period: a calendar month, as "YYYY-MM". */
export type Period = string;

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && PERIOD_PATTERN.test(value);
}

/**
 * The period a date falls in.
 *
 * Uses the date's LOCAL month, because the server runs in the club's timezone
 * (APP_TZ, see instrumentation.ts) and a flight flown at 6pm on the 31st
 * belongs to that month on the club's calendar, not UTC's.
 */
export function periodOf(date: Date): Period {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

/** The current period. */
export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(now);
}

/** First instant of a period, local time. */
export function periodStart(period: Period): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

/** First instant of the NEXT period — the exclusive end of this one. */
export function periodEnd(period: Period): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month, 1, 0, 0, 0, 0);
}

/** Shift a period by n months (negative for earlier). */
export function shiftPeriod(period: Period, months: number): Period {
  const start = periodStart(period);
  return periodOf(new Date(start.getFullYear(), start.getMonth() + months, 1));
}

/** "August 2026" — the statement's heading. */
export function formatPeriod(period: Period): string {
  return periodStart(period).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** The last n periods, newest first, for the month picker. */
export function recentPeriods(count: number, now: Date = new Date()): Period[] {
  const current = currentPeriod(now);
  return Array.from({ length: count }, (_, i) => shiftPeriod(current, -i));
}

export type ChargeKind = "DUES" | "FLIGHT" | "FUEL_CREDIT" | "ONE_OFF";

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  DUES: "Dues",
  FLIGHT: "Flight time",
  FUEL_CREDIT: "Fuel credit",
  ONE_OFF: "Charge",
};

/** The shape the totals below need — a subset of a Charge row. */
export interface ChargeLike {
  amountCents: number;
  voided: boolean;
}

export interface Totals {
  /** Everything owed, before credits. */
  chargedCents: number;
  /** Credits, as a POSITIVE number — what's being handed back. */
  creditedCents: number;
  /** What the member actually owes: charged - credited. May be negative. */
  balanceCents: number;
}

/**
 * Add up a statement.
 *
 * Voided lines are skipped but kept in the list: the statement still shows them
 * struck through, because "this was charged and then unwound" is information a
 * member is entitled to see.
 */
export function totals(charges: ChargeLike[]): Totals {
  let chargedCents = 0;
  let creditedCents = 0;
  for (const charge of charges) {
    if (charge.voided) continue;
    if (charge.amountCents >= 0) chargedCents += charge.amountCents;
    else creditedCents += -charge.amountCents;
  }
  return {
    chargedCents,
    creditedCents,
    balanceCents: chargedCents - creditedCents,
  };
}

/** Money, as the statement prints it: "$1,234.56", "-$65.00". */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const amount = Math.abs(cents) / 100;
  return `${sign}$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Dollars typed into a form → whole cents. Null when it isn't a number. */
export function parseDollars(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  // Round rather than truncate: 12.345 dollars is 1235 cents, not 1234.
  return Math.round(value * 100);
}

/** The meter readings and money a flight contributes to the books. */
export interface BillableFlight {
  id: string;
  tachStart: number;
  tachEnd: number;
  flownOn: Date;
  fuelCostCents: number | null;
}

export interface DerivedCharge {
  kind: ChargeKind;
  amountCents: number;
  description: string;
  incurredOn: Date;
  period: Period;
  /** The flight that produced it — null for a standalone fill-up. */
  flightId: string | null;
}

/**
 * What a filed flight owes the club, at the rate in force.
 *
 * Billed on TACH time — engine hours, the club's stated basis — not Hobbs and
 * not block time. Returns null when the airplane has no rate set or the flight
 * logged no time, because a $0 line on a statement is noise.
 */
export function flightCharge(
  flight: BillableFlight,
  hourlyRateCents: number | null | undefined,
  tailNumber: string
): DerivedCharge | null {
  if (!hourlyRateCents || hourlyRateCents <= 0) return null;
  const hours = tachHours({
    tachStart: flight.tachStart,
    tachEnd: flight.tachEnd,
  });
  if (!(hours > 0)) return null;
  const amountCents = Math.round(hours * hourlyRateCents);
  if (amountCents <= 0) return null;
  return {
    kind: "FLIGHT",
    amountCents,
    description: `${tailNumber} — ${hours.toFixed(1)} tach hr @ ${formatMoney(
      hourlyRateCents
    )}/hr`,
    incurredOn: flight.flownOn,
    period: periodOf(flight.flownOn),
    flightId: flight.id,
  };
}

/**
 * What the club owes the member for that flight's fuel.
 *
 * The pilot pays at the pump and the club pays them back, so this is stored as
 * a negative charge against the same statement the flight lands on.
 */
export function fuelCredit(
  flight: BillableFlight,
  tailNumber: string
): DerivedCharge | null {
  const spent = flight.fuelCostCents;
  if (!spent || spent <= 0) return null;
  return {
    kind: "FUEL_CREDIT",
    amountCents: -spent,
    description: `Fuel bought for ${tailNumber}`,
    incurredOn: flight.flownOn,
    period: periodOf(flight.flownOn),
    flightId: flight.id,
  };
}

/**
 * What the club owes a member for a standalone fill-up.
 *
 * The same credit `fuelCredit` produces for a flight, for fuel that had no
 * flight attached — and gated on whose card it went on, which is the one thing
 * the flight version cannot ask. Fuel bought on the CLUB's card is the club
 * buying fuel: a real event worth recording, and nobody's debt.
 */
export function servicingCredit(
  servicing: BillableServicing,
  tailNumber: string
): DerivedCharge | null {
  if (!servicing.paidPersonally) return null;
  const spent = servicing.fuelCostCents;
  if (!spent || spent <= 0) return null;
  return {
    kind: "FUEL_CREDIT",
    amountCents: -spent,
    description: `Fuel bought for ${tailNumber}`,
    incurredOn: servicing.servicedAt,
    period: periodOf(servicing.servicedAt),
    flightId: null,
  };
}

/** A fill-up, as far as the books are concerned. */
export interface BillableServicing {
  id: string;
  servicedAt: Date;
  fuelCostCents: number | null;
  paidPersonally: boolean;
}

/** Both of a flight's derived lines, in statement order. */
export function chargesForFlight(
  flight: BillableFlight,
  hourlyRateCents: number | null | undefined,
  tailNumber: string
): DerivedCharge[] {
  return [
    flightCharge(flight, hourlyRateCents, tailNumber),
    fuelCredit(flight, tailNumber),
  ].filter((c): c is DerivedCharge => c !== null);
}

/** A standing rule, as far as this module is concerned. */
export interface RecurringRule {
  id: string;
  label: string;
  amountCents: number;
  memberId: string | null;
  startsOn: Date;
  endsOn: Date | null;
  active: boolean;
}

/**
 * Does this rule apply to the given month?
 *
 * Compared period-to-period rather than date-to-date: a rule starting on the
 * 15th still bills the whole of that month, which is how a club actually
 * charges dues. An inactive rule bills nothing going forward but the lines it
 * already produced stay put.
 */
export function ruleAppliesTo(rule: RecurringRule, period: Period): boolean {
  if (!rule.active) return false;
  if (period < periodOf(rule.startsOn)) return false;
  if (rule.endsOn && period > periodOf(rule.endsOn)) return false;
  return true;
}

/**
 * Which members a rule bills for a month, given the club's roster.
 *
 * A rule with no member is the club-wide one (dues); a rule with one is a
 * private arrangement. Members who joined after the month ended are skipped,
 * so back-filling an old statement doesn't invent dues for someone who wasn't
 * in the club yet.
 */
export function membersBilledBy(
  rule: RecurringRule,
  period: Period,
  members: { id: string; joinedAt: Date }[]
): string[] {
  if (!ruleAppliesTo(rule, period)) return [];
  const end = periodEnd(period);
  const eligible = members.filter((m) => m.joinedAt < end);
  if (rule.memberId) {
    return eligible.some((m) => m.id === rule.memberId) ? [rule.memberId] : [];
  }
  return eligible.map((m) => m.id);
}

/**
 * Never bill the future.
 *
 * The statement page lets you look ahead, but materialising next month's dues
 * would put a charge on the books that hasn't been incurred yet.
 */
export function isBillablePeriod(
  period: Period,
  now: Date = new Date()
): boolean {
  return period <= currentPeriod(now);
}
