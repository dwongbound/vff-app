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

export type ChargeKind =
  | "DUES"
  | "FLIGHT"
  | "FUEL_CREDIT"
  | "ONE_OFF"
  | "LANDING_FEE"
  | "PAYBACK";

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  DUES: "Dues",
  FLIGHT: "Flight time",
  FUEL_CREDIT: "Fuel credit",
  ONE_OFF: "Charge",
  LANDING_FEE: "Landing fee",
  PAYBACK: "Monthly payback",
};

/** The shape the totals below need — a subset of a Charge row. */
export interface ChargeLike {
  amountCents: number;
  voided: boolean;
  /** When the Finance Officer marked it settled; null/absent = unpaid. */
  paidAt?: string | Date | null;
}

export interface Totals {
  /** Everything owed, before credits. */
  chargedCents: number;
  /** Credits, as a POSITIVE number — what's being handed back. */
  creditedCents: number;
  /** What the member actually owes: charged - credited. May be negative. */
  balanceCents: number;
  /**
   * Of that, what has been marked settled — the net of paid lines, credits
   * included, so ticking off a charge and its fuel credit together nets out
   * exactly the way the balance does.
   */
  paidCents: number;
  /**
   * What's still owed: balance - paid. The number the Finance Officer chases,
   * and the one the club-wide figure shows.
   *
   * `balanceCents` deliberately still means "what this month came to",
   * unchanged by payments: the two answer different questions ("what did this
   * month cost" vs "what is left"), and collapsing them would make a settled
   * month look like a month with no flying in it.
   */
  outstandingCents: number;
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
  let paidCents = 0;
  for (const charge of charges) {
    if (charge.voided) continue;
    if (charge.amountCents >= 0) chargedCents += charge.amountCents;
    else creditedCents += -charge.amountCents;
    // Signed, so a settled credit reduces what's been settled — the paid
    // total is a net of the same lines the balance is.
    if (charge.paidAt) paidCents += charge.amountCents;
  }
  const balanceCents = chargedCents - creditedCents;
  return {
    chargedCents,
    creditedCents,
    balanceCents,
    paidCents,
    outstandingCents: balanceCents - paidCents,
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
  /**
   * Both ends are nullable now that a log entry can exist before the flight is
   * over. An entry with either end unknown has no measurable span, so it bills
   * no hours — see `flightCharge`. Fuel and landing fees are unaffected: those
   * are receipts, and a receipt is owed whether or not the meters were read.
   */
  tachStart: number | null;
  tachEnd: number | null;
  flownOn: Date;
  fuelCostCents: number | null;
  /**
   * Whose card that fuel went on. Optional and ABSENT-MEANS-TRUE, matching the
   * column's own default: every flight recorded before there was a choice
   * meant "the member paid", because recording a cost was the only way to
   * claim it back. A caller that forgets the field therefore bills exactly
   * what it billed before.
   */
  fuelPaidPersonally?: boolean;
  /**
   * What the destination charged to land, as recorded on the flight. Optional
   * so every caller that predates landing fees still type-checks and bills
   * exactly what it billed before — absent and null are both "no fee".
   */
  landingFeeCents?: number | null;
  /** Where it landed, so the statement line can name the field. */
  arrival?: string | null;
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
 *
 * "Logged no time" now covers a third case: an entry whose span isn't KNOWN,
 * because the airplane is still out or because nobody read the panel before
 * they left. `tachHours` answers null for those, and a flight the club can't
 * measure is one it can't bill — the member's statement gets the line the day
 * the missing reading is filled in, from the same code, because every write to
 * a flight re-runs this.
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
  if (hours == null || !(hours > 0)) return null;
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
  // Fuel on the CLUB's card is the club buying its own fuel: worth recording
  // — the airplane got fuel, and the club paid for it — but nobody is owed
  // anything, so there is no credit to write. Same rule `servicingCredit`
  // already applies to a fill-up with no flight attached.
  if (flight.fuelPaidPersonally === false) return null;
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
 * What the field charged to land, passed on to the pilot.
 *
 * A pass-through rather than a lookup: the amount billed is the one recorded on
 * the flight, which is what the pilot says they were actually charged. The
 * table in lib/landingFees.ts only decides what the form OPENS at — see the
 * note there about why the two are deliberately different jobs.
 *
 * Per flight, not per landing. Eight touch-and-goes is one visit to one desk.
 *
 * A recorded ZERO is meaningful and bills nothing: "they waived it" is a real
 * answer, and it should leave no line on the statement rather than a $0.00 one.
 */
export function landingFeeCharge(
  flight: BillableFlight,
  tailNumber: string
): DerivedCharge | null {
  const fee = flight.landingFeeCents;
  if (!fee || fee <= 0) return null;
  // The field is what a reader wants to see on a statement; the tail number is
  // the fallback, so the line still says which airplane put it there.
  const where = flight.arrival?.trim() || tailNumber;
  return {
    kind: "LANDING_FEE",
    amountCents: fee,
    description: `Landing fee — ${where}`,
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

/**
 * All of a flight's derived lines, in statement order: what it cost to fly,
 * what it cost to land, and what the club owes back for fuel. Debits before the
 * credit, so a statement reads as the bill it is.
 */
export function chargesForFlight(
  flight: BillableFlight,
  hourlyRateCents: number | null | undefined,
  tailNumber: string
): DerivedCharge[] {
  return [
    flightCharge(flight, hourlyRateCents, tailNumber),
    landingFeeCharge(flight, tailNumber),
    fuelCredit(flight, tailNumber),
  ].filter((c): c is DerivedCharge => c !== null);
}

/** A standing rule, as far as this module is concerned. */
export interface RecurringRule {
  id: string;
  label: string;
  /**
   * POSITIVE is a monthly charge (dues); NEGATIVE is a monthly PAYBACK — a
   * standing credit for the member who runs the website, mows the tiedown or
   * keeps the books. Same rule shape either way, because it is the same rule:
   * an amount, somebody to apply it to, a start and an optional end,
   * materialised once a month and never restated.
   */
  amountCents: number;
  memberId: string | null;
  startsOn: Date;
  endsOn: Date | null;
  active: boolean;
}

/**
 * Which kind of statement line a rule writes, from the sign of its amount.
 *
 * The SIGN is the whole distinction, and keeping the kinds separate is what
 * stops a payback reading as a negative due. A statement that showed the club
 * paying somebody $50 under "Dues" would be wrong twice over: wrong on the
 * line, and wrong in the dues half of every total that groups by kind.
 */
export function recurringKind(
  rule: Pick<RecurringRule, "amountCents">
): "DUES" | "PAYBACK" {
  return rule.amountCents < 0 ? "PAYBACK" : "DUES";
}

/** True for a rule that pays a member rather than billing them. */
export function isPayback(rule: Pick<RecurringRule, "amountCents">): boolean {
  return rule.amountCents < 0;
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
