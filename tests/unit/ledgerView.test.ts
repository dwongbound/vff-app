import { describe, expect, it } from "vitest";
import {
  CLUB_ACCOUNT,
  exportPeriods,
  monthsSpanned,
  selectLines,
  statementsFor,
} from "@/lib/ledgerView";
import type { ApiCharge } from "@/lib/types";

const NOW = new Date(2026, 9, 9); // 9 Oct 2026, local

function line(over: Partial<ApiCharge>): ApiCharge {
  return {
    id: Math.random().toString(36).slice(2),
    member: { id: "alex", name: "Alex", email: null },
    kind: "DUES",
    amountCents: 25_000,
    description: "Monthly membership",
    period: "2026-10",
    incurredOn: new Date(2026, 9, 1).toISOString(),
    flightId: null,
    recurringChargeId: null,
    voided: false,
    voidReason: null,
    paidAt: null,
    paidBy: null,
    createdAt: new Date(2026, 9, 1).toISOString(),
    mine: false,
    ...over,
  };
}

describe("exportPeriods", () => {
  it("reads all time as no range at all", () => {
    expect(exportPeriods("all", null, NOW)).toBeNull();
  });

  it("counts this month as one of the last few", () => {
    expect(exportPeriods("this-month", null, NOW)).toEqual({ from: "2026-10", to: "2026-10" });
    expect(exportPeriods("last-3", null, NOW)).toEqual({ from: "2026-08", to: "2026-10" });
    expect(exportPeriods("last-12", null, NOW)).toEqual({ from: "2025-11", to: "2026-10" });
  });

  it("swaps a custom range given backwards rather than refusing it", () => {
    expect(exportPeriods("custom", { from: "2026-10", to: "2026-08" }, NOW)).toEqual({
      from: "2026-08",
      to: "2026-10",
    });
  });
});

describe("monthsSpanned", () => {
  it("counts both ends, across a year boundary", () => {
    expect(monthsSpanned("2026-10", "2026-10")).toBe(1);
    expect(monthsSpanned("2025-11", "2026-10")).toBe(12);
  });
});

describe("selectLines", () => {
  const alexDues = line({});
  const alexFlight = line({ kind: "FLIGHT", description: "N8318B — 1.0 tach hr" });
  const robinDues = line({ member: { id: "robin", name: "Robin", email: null } });
  const clubFunds = line({ member: null, kind: "ONE_OFF", amountCents: -120_000 });
  const all = [alexDues, alexFlight, robinDues, clubFunds];

  it("keeps everything when nothing narrows it", () => {
    expect(selectLines(all, null, null)).toEqual(all);
  });

  it("narrows by kind", () => {
    expect(selectLines(all, new Set(["FLIGHT"]), null)).toEqual([alexFlight]);
  });

  it("narrows by person, with the club's own money as a person of its own", () => {
    expect(selectLines(all, null, new Set(["alex"]))).toEqual([alexDues, alexFlight]);
    expect(selectLines(all, null, new Set([CLUB_ACCOUNT.id]))).toEqual([clubFunds]);
  });

  it("applies both at once", () => {
    expect(selectLines(all, new Set(["DUES"]), new Set(["robin"]))).toEqual([robinDues]);
  });
});

describe("statementsFor", () => {
  it("groups by member, the club's own lines first, then by name", () => {
    const statements = statementsFor(
      [
        line({ member: { id: "robin", name: "Robin", email: null } }),
        line({ member: null, kind: "ONE_OFF", amountCents: 500 }),
        line({}),
        line({ amountCents: 1000 }),
      ],
      "2026-10"
    );
    expect(statements.map((s) => s.member.name)).toEqual(["Club", "Alex", "Robin"]);
    expect(statements[1].charges).toHaveLength(2);
    expect(statements[1].balanceCents).toBe(26_000);
  });
});
