import { describe, expect, it } from "vitest";
import { agentAircraft, agentBooking, agentFlight, agentMoney } from "@/lib/agentView";

const now = new Date("2026-11-10T20:00:00Z");
const airplane = (over: Partial<Parameters<typeof agentAircraft>[0]> = {}) => ({
  tailNumber: "N8318B",
  model: "Cessna 172",
  homeBase: "KTOA",
  hourlyRateCents: 13500,
  lastTach: 1500,
  lastHobbs: null,
  squawks: [],
  maintenance: [],
  ...over,
});

describe("agentAircraft", () => {
  it("is airworthy with nothing open", () => {
    const a = agentAircraft(airplane(), now);
    expect(a.status).toBe("AIRWORTHY");
    expect(a.hourlyRateDollars).toBe(135);
  });

  it("is grounded by a grounding squawk, and says which", () => {
    const a = agentAircraft(
      airplane({ squawks: [{ title: "Cracked exhaust", status: "REVIEWED_GROUNDED", createdAt: now }] }),
      now
    );
    expect(a.status).toBe("GROUNDED");
    expect(a.groundedBecause).toEqual(["Squawk: Cracked exhaust"]);
  });

  it("is in maintenance, NOT grounded, for a squawk being worked", () => {
    const a = agentAircraft(
      airplane({ squawks: [{ title: "Radio static", status: "REVIEWED_IN_WORK", createdAt: now }] }),
      now
    );
    expect(a.status).toBe("IN_MAINTENANCE");
  });

  it("is grounded by a required inspection past due, and not by a club one", () => {
    const annual = {
      label: "Annual",
      intervalHours: null,
      intervalMonths: 12,
      lastDoneTach: null,
      lastDoneOn: new Date("2025-08-01T12:00:00Z"),
      requiredByReg: true,
    };
    const wash = { ...annual, label: "Wash", requiredByReg: false };
    expect(agentAircraft(airplane({ maintenance: [wash] }), now).status).toBe("AIRWORTHY");
    const a = agentAircraft(airplane({ maintenance: [annual] }), now);
    expect(a.status).toBe("GROUNDED");
    expect(a.maintenance[0]).toMatchObject({ item: "Annual", groundsTheAirplane: true });
  });
});

describe("agentBooking", () => {
  const row = {
    startsAt: now,
    endsAt: new Date(now.getTime() + 7_200_000),
    allDay: false,
    purpose: "TRAINING" as const,
    title: null,
    notes: null,
    userId: "u1",
    instructorId: "u2",
    user: { name: "Dylan Wong" },
    instructor: { name: "Matt" },
    aircraft: { tailNumber: "N8318B" },
  };
  it("names who booked it and whether it's yours or yours to teach", () => {
    expect(agentBooking(row, "u1")).toMatchObject({ bookedBy: "Dylan Wong", purpose: "Training (with CFI)", yours: true });
    expect(agentBooking(row, "u2")).toMatchObject({ yours: false, youAreTheInstructor: true });
  });
});

describe("agentFlight", () => {
  it("reads an unfiled session as in progress, with no made-up hours", () => {
    const f = agentFlight({
      flownOn: now,
      filedAt: null,
      tachStart: 1500,
      tachEnd: null,
      hobbsStart: null,
      hobbsEnd: null,
      landings: 1,
      nightLandings: 0,
      purpose: null,
      departure: "KTOA",
      arrival: "KSMO",
      route: null,
      aircraft: { tailNumber: "N8318B" },
      instructor: null,
      signedAt: null,
    });
    expect(f.inProgress).toBe(true);
    expect(f.tachHours).toBeNull();
    expect(f.route).toBe("KTOA → KSMO");
  });
});

describe("agentMoney", () => {
  it("adds up what's unpaid, newest line first, and says which way it runs", () => {
    const m = agentMoney([
      { kind: "DUES", amountCents: 25000, description: "Dues", incurredOn: new Date("2026-10-01") },
      { kind: "FUEL_CREDIT", amountCents: -4000, description: "Fuel", incurredOn: new Date("2026-11-02") },
    ]);
    expect(m.outstandingDollars).toBe(210);
    expect(m.meaning).toMatch(/owes the club/);
    expect(m.unpaidLines[0]).toMatchObject({ kind: "Fuel credit", amountDollars: -40 });
  });
  it("says when the club owes the member", () => {
    expect(
      agentMoney([{ kind: "REIMBURSEMENT", amountCents: -1000, description: "Oil", incurredOn: now }]).meaning
    ).toMatch(/club owes/);
  });
});
