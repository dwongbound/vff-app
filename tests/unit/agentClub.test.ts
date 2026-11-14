import { describe, expect, it } from "vitest";
import { clubLastFlight, clubPilot, type ClubPilotFlight } from "@/lib/agentView";
import { AGENT_CLUB_TOOLS, AGENT_TOOLS, AGENT_WRITE_TOOLS, agentInstructions, agentToolsFor } from "@/lib/agentTools";

const now = new Date("2026-11-13T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const flight = (over: Partial<ClubPilotFlight> = {}): ClubPilotFlight => ({ flownOn: daysAgo(10), landings: 3, ...over });
const person = { name: "Alex Rivera", certificate: "Private Pilot ASEL", totalTimeHours: 240 };

describe("clubPilot", () => {
  it("is only ratings, total time and 90-day landings", () => {
    const p = clubPilot(
      person,
      [flight(), flight({ flownOn: daysAgo(80), landings: 2 }), flight({ flownOn: daysAgo(120), landings: 9 })],
      now
    );
    expect(p).toEqual({
      name: "Alex Rivera",
      certificate: "Private Pilot ASEL",
      declaredTotalTimeHours: 240,
      landingsLast90Days: 5,
    });
  });

  it("counts a flight with no landing count as one landing", () => {
    const p = clubPilot(person, [flight({ landings: null }), flight({ landings: undefined }), flight({ landings: 0 })], now);
    expect(p.landingsLast90Days).toBe(2);
  });

  it("says null for what a pilot never entered, and zero landings for one who hasn't flown", () => {
    const p = clubPilot({ ...person, certificate: null, totalTimeHours: null }, [], now);
    expect(p.certificate).toBeNull();
    expect(p.declaredTotalTimeHours).toBeNull();
    expect(p.landingsLast90Days).toBe(0);
  });
});

describe("clubLastFlight", () => {
  it("is only the airplane, who flew it and the day", () => {
    expect(
      clubLastFlight({ flownOn: daysAgo(2), aircraft: { tailNumber: "N8318B" }, pilot: { name: "Alex Rivera" } })
    ).toEqual({ tailNumber: "N8318B", pilot: "Alex Rivera", flownOn: daysAgo(2).toISOString() });
  });
});

describe("agentToolsFor", () => {
  const names = (canWrite: boolean, club: boolean) => agentToolsFor(canWrite, club).map((t) => t.name);
  it("lists the club tools only for a club-data key, and no flight-by-flight tool", () => {
    expect(AGENT_CLUB_TOOLS.map((t) => t.name)).toEqual(["get_pilots", "get_last_flown"]);
    expect(names(false, false)).not.toContain("get_pilots");
    expect(names(true, false)).not.toContain("get_pilots");
    expect(names(false, true)).toEqual(expect.arrayContaining(["get_pilots", "get_last_flown"]));
    expect(names(true, true)).toHaveLength(AGENT_TOOLS.length + AGENT_CLUB_TOOLS.length + AGENT_WRITE_TOOLS.length);
  });

  it("tells the assistant about club data only when the key has it", () => {
    expect(agentInstructions(false, true)).toContain("get_pilots");
    expect(agentInstructions(false)).not.toContain("get_pilots");
  });
});
