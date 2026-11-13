import { describe, expect, it } from "vitest";
import { clubFlight, clubPilot, type ClubPilotFlight } from "@/lib/agentView";
import { AGENT_CLUB_TOOLS, AGENT_TOOLS, AGENT_WRITE_TOOLS, agentInstructions, agentToolsFor } from "@/lib/agentTools";

const now = new Date("2026-11-13T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const flight = (over: Partial<ClubPilotFlight> = {}): ClubPilotFlight => ({
  flownOn: daysAgo(10),
  tachStart: 1500,
  tachEnd: 1501.2,
  hobbsStart: 2000,
  hobbsEnd: 2001.5,
  landings: 3,
  nightLandings: 0,
  ...over,
});
const person = {
  id: "u1",
  name: "Alex Rivera",
  email: "alex@example.test",
  certificate: "Private Pilot ASEL",
  totalTimeHours: 240,
  clubMember: true,
  positions: [] as string[],
};

describe("clubPilot", () => {
  it("counts only the last 90 days in last90Days, and reports when they last flew", () => {
    const p = clubPilot(
      person,
      [flight(), flight({ flownOn: daysAgo(80), landings: 2, nightLandings: 1 }), flight({ flownOn: daysAgo(120), landings: 9 })],
      now
    );
    expect(p.certificate).toBe("Private Pilot ASEL");
    expect(p.declaredTotalTimeHours).toBe(240);
    expect(p.last90Days).toEqual({ flights: 2, landings: 5, nightLandings: 1, tachHours: 2.4, hobbsHours: 3 });
    expect(p.lastFlewOn).toBe(daysAgo(10).toISOString());
    expect(p.isInstructor).toBe(false);
  });

  it("says null rather than zero for what a pilot never entered or never flew", () => {
    const p = clubPilot({ ...person, certificate: null, totalTimeHours: null, positions: ["INSTRUCTOR"] }, [], now);
    expect(p.certificate).toBeNull();
    expect(p.declaredTotalTimeHours).toBeNull();
    expect(p.lastFlewOn).toBeNull();
    expect(p.last90Days.landings).toBe(0);
    expect(p.isInstructor).toBe(true);
  });
});

describe("clubFlight", () => {
  it("names the pilot and leaves out their write-up", () => {
    const f = clubFlight({
      ...flight(),
      id: "f1",
      filedAt: now,
      purpose: null,
      departure: "KTOA",
      arrival: "KTOA",
      route: null,
      notes: null,
      logEntry: "My own account",
      signedAt: null,
      aircraft: { tailNumber: "N8318B" },
      instructor: null,
      pilot: { name: "Alex Rivera" },
    });
    expect(f.pilot).toBe("Alex Rivera");
    expect(f.hobbsHours).toBe(1.5);
    expect(f).not.toHaveProperty("logEntry");
  });
});

describe("agentToolsFor", () => {
  const names = (canWrite: boolean, club: boolean) => agentToolsFor(canWrite, club).map((t) => t.name);
  it("lists the club readers only for a club-data key", () => {
    for (const t of AGENT_CLUB_TOOLS) {
      expect(names(false, false)).not.toContain(t.name);
      expect(names(true, false)).not.toContain(t.name);
      expect(names(false, true)).toContain(t.name);
    }
    expect(names(false, true)).toHaveLength(AGENT_TOOLS.length + AGENT_CLUB_TOOLS.length);
    expect(names(true, true)).toHaveLength(AGENT_TOOLS.length + AGENT_CLUB_TOOLS.length + AGENT_WRITE_TOOLS.length);
  });

  it("tells the assistant about club data only when the key has it", () => {
    expect(agentInstructions(false, true)).toContain("get_pilots");
    expect(agentInstructions(false)).not.toContain("get_pilots");
  });
});
