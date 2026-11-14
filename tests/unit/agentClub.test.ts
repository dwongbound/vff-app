import { describe, expect, it } from "vitest";
import { clubLastFlown, clubPilot, type ClubPilotFlight } from "@/lib/agentView";
import { AGENT_CLUB_TOOLS, AGENT_TOOLS, AGENT_WRITE_TOOLS, agentInstructions, agentToolsFor } from "@/lib/agentTools";

const now = new Date("2026-11-13T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const flight = (over: Partial<ClubPilotFlight> = {}): ClubPilotFlight => ({
  flownOn: daysAgo(10),
  landings: 3,
  tachStart: 1500,
  tachEnd: 1501,
  hobbsStart: 3000,
  hobbsEnd: 3001.3,
  ...over,
});
const person = { name: "Alex Rivera", certificate: "Private Pilot ASEL" };

describe("clubPilot", () => {
  it("is only ratings and 90-day landings, Hobbs and tach hours", () => {
    const p = clubPilot(
      person,
      [flight(), flight({ flownOn: daysAgo(80), landings: 2 }), flight({ flownOn: daysAgo(120), landings: 9 })],
      now
    );
    expect(p).toEqual({
      name: "Alex Rivera",
      certificate: "Private Pilot ASEL",
      landingsLast90Days: 5,
      hobbsHoursLast90Days: 2.6,
      tachHoursLast90Days: 2,
    });
  });

  it("works hours out from each flight's meters, skipping a missing reading", () => {
    const p = clubPilot(
      person,
      [
        flight({ hobbsStart: null, hobbsEnd: null }),
        flight({ tachEnd: null }),
        flight({ tachStart: 1510, tachEnd: 1511.25, hobbsStart: 3010, hobbsEnd: 3011.44 }),
      ],
      now
    );
    expect(p.hobbsHoursLast90Days).toBe(2.7);
    expect(p.tachHoursLast90Days).toBe(2.3);
  });

  it("counts a flight with no landing count as one landing", () => {
    const p = clubPilot(person, [flight({ landings: null }), flight({ landings: undefined }), flight({ landings: 0 })], now);
    expect(p.landingsLast90Days).toBe(2);
  });

  it("says null for what a pilot never entered, and zero landings for one who hasn't flown", () => {
    const p = clubPilot({ ...person, certificate: null }, [], now);
    expect(p.certificate).toBeNull();
    expect(p.landingsLast90Days).toBe(0);
    expect(p.hobbsHoursLast90Days).toBe(0);
    expect(p.tachHoursLast90Days).toBe(0);
  });
});

describe("clubLastFlown", () => {
  it("names the last pilot and the day, and nothing else about the flight", () => {
    expect(
      clubLastFlown({ tailNumber: "N8318B", flight: { flownOn: daysAgo(2), pilot: { name: "Alex Rivera" } } })
    ).toEqual({ tailNumber: "N8318B", pilot: "Alex Rivera", flownOn: daysAgo(2).toISOString() });
  });

  it("says null for an airplane nobody has flown here", () => {
    expect(clubLastFlown({ tailNumber: "N1234", flight: null })).toEqual({
      tailNumber: "N1234",
      pilot: null,
      flownOn: null,
    });
  });
});

describe("agentToolsFor", () => {
  const names = (canWrite: boolean, club: boolean) => agentToolsFor(canWrite, club).map((t) => t.name);
  it("lists the club tools only for a club-data key, and no flight-by-flight tool", () => {
    expect(AGENT_CLUB_TOOLS.map((t) => t.name)).toEqual(["get_last_flown", "get_pilots"]);
    for (const name of ["get_last_flown", "get_pilots"]) {
      expect(names(false, false)).not.toContain(name);
      expect(names(true, false)).not.toContain(name);
      expect(names(false, true)).toContain(name);
    }
    expect(names(true, true)).toHaveLength(AGENT_TOOLS.length + AGENT_CLUB_TOOLS.length + AGENT_WRITE_TOOLS.length);
  });

  it("tells the assistant about club data only when the key has it", () => {
    expect(agentInstructions(false, true)).toContain("get_pilots");
    expect(agentInstructions(false, true)).toContain("get_last_flown");
    expect(agentInstructions(false)).not.toContain("get_pilots");
  });
});
