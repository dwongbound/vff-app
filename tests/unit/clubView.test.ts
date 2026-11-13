import { describe, expect, it } from "vitest";
import { clubFlight, clubPilot, type ClubFlightRow, type ClubMemberRow } from "@/lib/clubView";

const now = new Date("2026-11-13T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function flight(over: Partial<ClubFlightRow>): ClubFlightRow {
  return {
    id: "f1",
    userId: "u1",
    user: { name: "Alex Pilot" },
    flownOn: daysAgo(1),
    filedAt: daysAgo(1),
    tachStart: 1000,
    tachEnd: 1001.5,
    hobbsStart: null,
    hobbsEnd: null,
    landings: 3,
    nightLandings: 0,
    purpose: "LOCAL",
    departure: "KTOA",
    arrival: "KTOA",
    route: null,
    notes: "Left brake soft",
    logEntry: "Felt rusty on the flare.",
    aircraft: { tailNumber: "N8318B" },
    instructor: null,
    signedAt: null,
    ...over,
  };
}

const member: ClubMemberRow = {
  id: "u1",
  name: "Alex Pilot",
  email: "alex@example.com",
  certificate: "Private Pilot ASEL",
  totalTimeHours: 250,
  positions: [],
  clubMember: true,
};

describe("clubFlight", () => {
  it("says who flew it and leaves the pilot's own words out", () => {
    const f = clubFlight(flight({}));
    expect(f.pilot).toBe("Alex Pilot");
    expect(f.id).toBe("f1");
    expect(f.tachHours).toBe(1.5);
    expect(f).not.toHaveProperty("notes");
    expect(f).not.toHaveProperty("logEntry");
  });
});

describe("clubPilot", () => {
  it("counts landings and hours inside 90 days only, night landings included in the total", () => {
    const p = clubPilot(
      member,
      [
        flight({ flownOn: daysAgo(5), landings: 3, nightLandings: 1 }),
        flight({ flownOn: daysAgo(80), landings: 2, tachStart: 900, tachEnd: 901 }),
        flight({ flownOn: daysAgo(120), landings: 6, tachStart: 800, tachEnd: 802 }),
      ],
      now
    );
    expect(p.landingsLast90Days).toBe(5);
    expect(p.nightLandingsLast90Days).toBe(1);
    expect(p.flightsLast90Days).toBe(2);
    expect(p.hoursInClubLogLast90Days).toBe(2.5);
    expect(p.hoursInClubLogLast12Months).toBe(4.5);
    expect(p.lastFlownOn).toBe(daysAgo(5).toISOString());
  });
  it("presents the certificate and declared total time as entered", () => {
    const p = clubPilot(member, [], now);
    expect(p.certificate).toBe("Private Pilot ASEL");
    expect(p.declaredTotalTimeHours).toBe(250);
    expect(p.landingsLast90Days).toBe(0);
    expect(p.lastFlownOn).toBeNull();
    expect(p.clubCurrency.maySoloByDay).toBe(false);
  });
});
