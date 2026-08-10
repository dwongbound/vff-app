import { describe, expect, it } from "vitest";
import {
  chargesForFlight,
  currentPeriod,
  flightCharge,
  formatMoney,
  formatPeriod,
  fuelCredit,
  isBillablePeriod,
  isPeriod,
  membersBilledBy,
  parseDollars,
  periodEnd,
  periodOf,
  servicingCredit,
  periodStart,
  recentPeriods,
  ruleAppliesTo,
  shiftPeriod,
  totals,
  type RecurringRule,
} from "@/lib/finance";

describe("periods", () => {
  it("recognises a period and rejects nonsense", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-00")).toBe(false);
    expect(isPeriod("august")).toBe(false);
    expect(isPeriod(8)).toBe(false);
  });

  // Local month, not UTC: a flight at 6pm on the 31st belongs to that month on
  // the club's calendar even though it's already the 1st in UTC.
  it("uses the local month", () => {
    expect(periodOf(new Date(2026, 7, 31, 18, 0))).toBe("2026-08");
    expect(periodOf(new Date(2026, 0, 1, 0, 0))).toBe("2026-01");
  });

  it("brackets a month", () => {
    expect(periodStart("2026-08").getMonth()).toBe(7);
    expect(periodStart("2026-08").getDate()).toBe(1);
    // Exclusive end = the first instant of September.
    expect(periodEnd("2026-08").getMonth()).toBe(8);
    expect(periodEnd("2026-12").getFullYear()).toBe(2027);
  });

  it("shifts across year boundaries", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-08", 0)).toBe("2026-08");
  });

  it("lists recent periods newest first", () => {
    const list = recentPeriods(3, new Date(2026, 7, 4));
    expect(list).toEqual(["2026-08", "2026-07", "2026-06"]);
  });

  it("formats a heading", () => {
    expect(formatPeriod("2026-08")).toBe("August 2026");
  });

  // The page can look at next month; the books must not be written for it.
  it("never bills the future", () => {
    const now = new Date(2026, 7, 4);
    expect(isBillablePeriod("2026-08", now)).toBe(true);
    expect(isBillablePeriod("2026-07", now)).toBe(true);
    expect(isBillablePeriod("2026-09", now)).toBe(false);
    expect(currentPeriod(now)).toBe("2026-08");
  });
});

describe("money", () => {
  it("formats dollars and credits", () => {
    expect(formatMoney(25_000)).toBe("$250.00");
    expect(formatMoney(-6_500)).toBe("-$65.00");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(123_456_78)).toBe("$123,456.78");
  });

  it("parses dollars into whole cents, rounding", () => {
    expect(parseDollars("250")).toBe(25_000);
    expect(parseDollars("65.49")).toBe(6_549);
    // Round, don't truncate — 12.345 is 1235 cents.
    expect(parseDollars("12.345")).toBe(1_235);
    expect(parseDollars("-40")).toBe(-4_000);
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars(null)).toBeNull();
  });
});

describe("totals", () => {
  const line = (amountCents: number, voided = false) => ({ amountCents, voided });

  it("splits charges from credits and nets them", () => {
    const sums = totals([line(25_000), line(29_700), line(-6_500)]);
    expect(sums.chargedCents).toBe(54_700);
    expect(sums.creditedCents).toBe(6_500);
    expect(sums.balanceCents).toBe(48_200);
  });

  // A voided line stays on the statement for the audit trail but must not
  // move the balance.
  it("ignores voided lines", () => {
    const sums = totals([line(25_000), line(10_000, true), line(-6_500, true)]);
    expect(sums.chargedCents).toBe(25_000);
    expect(sums.creditedCents).toBe(0);
    expect(sums.balanceCents).toBe(25_000);
  });

  it("can go negative when the club owes the member", () => {
    expect(totals([line(-6_500)]).balanceCents).toBe(-6_500);
  });

  it("is zero for an empty month", () => {
    expect(totals([])).toEqual({
      chargedCents: 0,
      creditedCents: 0,
      balanceCents: 0,
    });
  });
});

describe("what a flight costs", () => {
  const flight = {
    id: "f1",
    tachStart: 4819.4,
    tachEnd: 4821.6,
    flownOn: new Date(2026, 7, 1, 12),
    fuelCostCents: 6_500,
  };

  it("bills tach hours at the club's rate", () => {
    const charge = flightCharge(flight, 13_500, "N8318B");
    // 2.2 tach hours x $135
    expect(charge?.amountCents).toBe(29_700);
    expect(charge?.kind).toBe("FLIGHT");
    expect(charge?.period).toBe("2026-08");
    expect(charge?.description).toContain("N8318B");
    expect(charge?.description).toContain("2.2");
  });

  it("bills nothing when the airplane has no rate", () => {
    expect(flightCharge(flight, null, "N8318B")).toBeNull();
    expect(flightCharge(flight, 0, "N8318B")).toBeNull();
  });

  it("bills nothing for a flight that logged no time", () => {
    expect(
      flightCharge({ ...flight, tachEnd: flight.tachStart }, 13_500, "N8318B")
    ).toBeNull();
  });

  it("credits fuel back as a negative line", () => {
    const credit = fuelCredit(flight, "N8318B");
    expect(credit?.amountCents).toBe(-6_500);
    expect(credit?.kind).toBe("FUEL_CREDIT");
  });

  it("has no credit when the pilot bought no fuel", () => {
    expect(fuelCredit({ ...flight, fuelCostCents: null }, "N8318B")).toBeNull();
    expect(fuelCredit({ ...flight, fuelCostCents: 0 }, "N8318B")).toBeNull();
  });

  // The example from the club: $65 of gas comes off what you owe.
  it("nets the hours charge against the fuel credit", () => {
    const lines = chargesForFlight(flight, 13_500, "N8318B");
    expect(lines).toHaveLength(2);
    expect(totals(lines.map((l) => ({ ...l, voided: false }))).balanceCents).toBe(
      29_700 - 6_500
    );
  });
});

describe("recurring rules", () => {
  const rule: RecurringRule = {
    id: "r1",
    label: "Monthly membership",
    amountCents: 25_000,
    memberId: null,
    startsOn: new Date(2026, 5, 15), // mid-June
    endsOn: null,
    active: true,
  };

  // A rule starting on the 15th still bills the whole of that month — clubs
  // charge dues by the month, not pro rata.
  it("applies from its starting month, whole", () => {
    expect(ruleAppliesTo(rule, "2026-05")).toBe(false);
    expect(ruleAppliesTo(rule, "2026-06")).toBe(true);
    expect(ruleAppliesTo(rule, "2026-08")).toBe(true);
  });

  it("stops at its end month and when switched off", () => {
    const ended = { ...rule, endsOn: new Date(2026, 6, 3) };
    expect(ruleAppliesTo(ended, "2026-07")).toBe(true);
    expect(ruleAppliesTo(ended, "2026-08")).toBe(false);
    expect(ruleAppliesTo({ ...rule, active: false }, "2026-08")).toBe(false);
  });

  const roster = [
    { id: "old", joinedAt: new Date(2025, 0, 1) },
    { id: "new", joinedAt: new Date(2026, 7, 20) },
    { id: "future", joinedAt: new Date(2026, 11, 1) },
  ];

  it("bills every member for a club-wide rule", () => {
    expect(membersBilledBy(rule, "2026-08", roster).sort()).toEqual(["new", "old"]);
  });

  // Back-filling an old statement must not invent dues for someone who wasn't
  // in the club yet.
  it("skips members who hadn't joined", () => {
    expect(membersBilledBy(rule, "2026-06", roster)).toEqual(["old"]);
  });

  it("bills only the named member for a private rule", () => {
    const personal = { ...rule, memberId: "old" };
    expect(membersBilledBy(personal, "2026-08", roster)).toEqual(["old"]);
    const gone = { ...rule, memberId: "nobody" };
    expect(membersBilledBy(gone, "2026-08", roster)).toEqual([]);
  });

  it("bills nobody when the rule doesn't apply", () => {
    expect(membersBilledBy({ ...rule, active: false }, "2026-08", roster)).toEqual([]);
  });
});

// Fuel that went in with no flight attached. The one thing this can ask that
// the flight version can't is whose card it went on.
describe("servicingCredit", () => {
  const base = {
    id: "s1",
    servicedAt: new Date(2026, 7, 9, 12),
    fuelCostCents: 8_400,
    paidPersonally: true,
  };

  it("credits fuel bought on the member's own card", () => {
    const line = servicingCredit(base, "N8318B")!;
    expect(line.kind).toBe("FUEL_CREDIT");
    // Stored negative, like every other credit, so a balance is one addition.
    expect(line.amountCents).toBe(-8_400);
    expect(line.description).toBe("Fuel bought for N8318B");
    expect(line.period).toBe("2026-08");
    // No flight produced it.
    expect(line.flightId).toBeNull();
  });

  // The club buying its own fuel is a real event worth recording and nobody's
  // debt — this is the distinction the flight-borne version cannot make, and
  // the reason the club's sheet has the column at all.
  it("credits nothing when the club's card paid", () => {
    expect(servicingCredit({ ...base, paidPersonally: false }, "N8318B")).toBeNull();
  });

  it("credits nothing when no cost was recorded", () => {
    // Fuel added but no receipt entered — a real entry, just not a debt.
    expect(servicingCredit({ ...base, fuelCostCents: null }, "N8318B")).toBeNull();
    expect(servicingCredit({ ...base, fuelCostCents: 0 }, "N8318B")).toBeNull();
  });

  it("lands on the statement for the month it was bought", () => {
    const december = servicingCredit(
      { ...base, servicedAt: new Date(2026, 11, 31, 23) },
      "N8318B"
    )!;
    expect(december.period).toBe("2026-12");
  });
});
