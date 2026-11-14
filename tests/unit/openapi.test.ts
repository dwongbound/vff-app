// lib/openapi.json is written by hand, so these hold it to the code it
// describes: every field the key routes return, every tool, every label.
import { describe, expect, it } from "vitest";
import spec from "@/lib/openapi.json";
import { agentAircraft, agentBooking, agentFlight, agentMoney, clubLastFlown, clubPilot } from "@/lib/agentView";
import { agentToolsFor } from "@/lib/agentTools";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@/lib/mcp";
import { PURPOSE_LABELS } from "@/lib/constants";
import { MAINTENANCE_STATE_LABELS } from "@/lib/maintenance";
import { SQUAWK_STATUS_LABELS } from "@/lib/squawks";
import { CHARGE_KIND_LABELS } from "@/lib/finance";
import { TIER_LABELS } from "@/lib/operatingRules";

type Schema = { required?: string[]; properties: Record<string, { enum?: unknown[] }> };
const schemas = spec.components.schemas as unknown as Record<string, Schema>;
/** A schema's field names, in the order the spec lists them. */
const fields = (name: string) => Object.keys(schemas[name].properties).sort();
const now = new Date("2026-11-10T20:00:00Z");

describe("the OpenAPI document", () => {
  it("describes exactly the fields each section returns", () => {
    const aircraft = agentAircraft(
      {
        tailNumber: "N8318B",
        model: "Cessna 172",
        homeBase: "KTOA",
        hourlyRateCents: 13500,
        lastTach: 1500,
        lastHobbs: null,
        squawks: [{ title: "Cabin light", status: "NEW", createdAt: now }],
        maintenance: [
          {
            label: "Annual",
            intervalHours: null,
            intervalMonths: 12,
            lastDoneTach: null,
            lastDoneOn: now,
            requiredByReg: true,
          },
        ],
      },
      now
    );
    expect(fields("Aircraft")).toEqual(Object.keys(aircraft).sort());
    expect(fields("Squawk")).toEqual(Object.keys(aircraft.openSquawks[0]).sort());
    expect(fields("MaintenanceItem")).toEqual(Object.keys(aircraft.maintenance[0]).sort());

    const booking = agentBooking(
      {
        id: "b1",
        startsAt: now,
        endsAt: now,
        allDay: false,
        purpose: "LOCAL",
        title: null,
        notes: null,
        userId: "u1",
        instructorId: null,
        user: { name: "A Member" },
        instructor: null,
        aircraft: { tailNumber: "N8318B" },
      },
      "u1"
    );
    expect(fields("Booking")).toEqual(Object.keys(booking).sort());

    const flight = agentFlight({
      id: "f1",
      flownOn: now,
      filedAt: now,
      tachStart: 1,
      tachEnd: 2,
      hobbsStart: null,
      hobbsEnd: null,
      landings: 1,
      nightLandings: 0,
      purpose: null,
      departure: null,
      arrival: null,
      route: null,
      notes: null,
      logEntry: null,
      aircraft: { tailNumber: "N8318B" },
      instructor: null,
      signedAt: null,
    });
    expect(fields("Flight")).toEqual(Object.keys(flight).sort());

    const pilot = clubPilot({ name: "A Member", certificate: null }, [], now);
    expect(fields("Pilot")).toEqual(Object.keys(pilot).sort());
    expect(fields("LastFlown")).toEqual(Object.keys(clubLastFlown({ tailNumber: "N8318B", flight: null })).sort());

    const money = agentMoney([{ kind: "DUES", amountCents: 100, description: "Dues", incurredOn: now }]);
    expect(fields("Money")).toEqual(Object.keys(money).sort());
    expect(fields("MoneyLine")).toEqual(Object.keys(money.unpaidLines[0]).sort());
  });

  it("lists the snapshot's sections", () => {
    expect(fields("Snapshot")).toEqual(
      ["aircraft", "bookings", "clubTimeZone", "flying", "generatedAt", "member", "money"].sort()
    );
  });

  it("lists the club snapshot's sections", () => {
    expect(fields("ClubSnapshot")).toEqual(
      ["bookings", "clubTimeZone", "generatedAt", "lastFlown", "pilots"].sort()
    );
  });

  it("uses the app's own words for every label", () => {
    const enumOf = (schema: string, field: string) => schemas[schema].properties[field].enum;
    expect(enumOf("Booking", "purpose")).toEqual(Object.values(PURPOSE_LABELS));
    expect(enumOf("MaintenanceItem", "state")).toEqual(Object.values(MAINTENANCE_STATE_LABELS));
    expect(enumOf("Squawk", "status")).toEqual(Object.values(SQUAWK_STATUS_LABELS));
    expect(enumOf("MoneyLine", "kind")).toEqual(Object.values(CHARGE_KIND_LABELS));
    expect(enumOf("Flying", "operatingRulesColumn")).toEqual(Object.values(TIER_LABELS));
  });

  it("names every MCP tool and protocol version the server has", () => {
    const mcp = spec.paths["/api/mcp"].post.description;
    for (const tool of agentToolsFor(true, true)) expect(mcp).toContain(`\`${tool.name}\``);
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) expect(mcp).toContain(version);
  });
});
