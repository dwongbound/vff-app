// The MCP tools an access key gets: one per section of the snapshot, plus the
// whole thing — and, for a key made "can book and file", five that write.
// Declared here (not in the route) because a route.ts may only export Next's
// own handlers, and the unit test pins the list.
import type { McpTool } from "./mcp";
import { PURPOSES } from "./constants";

/** The snapshot's sections (lib/agentSnapshot.ts), one tool each. */
export const AGENT_SECTIONS = ["aircraft", "bookings", "flying", "money"] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];

export interface AgentTool extends McpTool {
  /** The snapshot section it returns; null = all of them. */
  section: AgentSection | null;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "get_club_snapshot",
    title: "Everything at once",
    description:
      "All of the below in one call: the airplanes' status, the next 30 days of bookings, the member's flying and their balance.",
    section: null,
  },
  {
    name: "get_aircraft_status",
    title: "Airplane status",
    description:
      "Each club airplane: AIRWORTHY, IN_MAINTENANCE or GROUNDED (and why), tach and Hobbs, hourly rate, open squawks, and the maintenance sheet most urgent first.",
    section: "aircraft",
  },
  {
    name: "get_bookings",
    title: "Bookings",
    description:
      "Every booking on the club's airplanes for the next 30 days, marked `yours` for the member's own and `youAreTheInstructor` for lessons they teach.",
    section: "bookings",
  },
  {
    name: "get_my_flying",
    title: "My flying",
    description:
      "The member's own flight log (latest 15), hours this year and in the last 12 months, landing currency and whether they may fly solo by day and at night under the club's operating rules.",
    section: "flying",
  },
  {
    name: "get_my_balance",
    title: "My balance",
    description:
      "What the member owes the club (or is owed), with the unpaid lines behind it. Null for an instructor-only account, which has no statement.",
    section: "money",
  },
];

/** What a writing tool does — the MCP route maps each to one app route. */
export type AgentAction = "book" | "update-booking" | "cancel" | "file" | "update-flight";

export interface AgentWriteTool extends McpTool {
  action: AgentAction;
}

/** A clock time at the club, as the tools take it. */
const CLUB_TIME = {
  type: "string",
  description:
    "Club local time, \"YYYY-MM-DDTHH:mm\" (America/Los_Angeles), or an ISO instant with an offset.",
};
const TAIL = {
  type: "string",
  description: "The airplane's tail number, e.g. N8318B. May be left out while the club has one airplane.",
};
const INSTRUCTOR = {
  type: "string",
  description: "The CFI's name as the club roster has it (first name is enough if it's unique).",
};

export const AGENT_WRITE_TOOLS: AgentWriteTool[] = [
  {
    name: "book_airplane",
    title: "Book the airplane",
    description:
      "Book a club airplane for the member, exactly as the app's New booking does: the club's booking rules and the conflict check apply, and a Google-linked airplane's calendar gets the event and the invite. Confirm the times with the member before calling.",
    action: "book",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        startsAt: CLUB_TIME,
        endsAt: CLUB_TIME,
        purpose: { type: "string", enum: PURPOSES, description: "Defaults to LOCAL." },
        tailNumber: TAIL,
        instructor: { ...INSTRUCTOR, description: `${INSTRUCTOR.description} Only for TRAINING.` },
        notes: { type: "string" },
      },
      required: ["startsAt", "endsAt"],
      additionalProperties: false,
    },
  },
  {
    name: "update_booking",
    title: "Change a booking",
    description:
      "Change one of the member's own bookings (the `id` from get_bookings, where `yours` is true), exactly as editing it in the app does: name only what changes. New times go through the club's booking rules and the conflict check again, and a Google-linked airplane's calendar event is updated. Confirm the change with the member before calling.",
    action: "update-booking",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        bookingId: { type: "string" },
        startsAt: { ...CLUB_TIME, description: `${CLUB_TIME.description} Left out, the booking keeps its start.` },
        endsAt: { ...CLUB_TIME, description: `${CLUB_TIME.description} Left out, the booking keeps its end.` },
        purpose: { type: "string", enum: PURPOSES },
        instructor: {
          ...INSTRUCTOR,
          description: `${INSTRUCTOR.description} Only for TRAINING; "" removes the instructor.`,
        },
        notes: { type: "string", description: "Replaces the notes; \"\" clears them." },
      },
      required: ["bookingId"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_booking",
    title: "Cancel a booking",
    description:
      "Cancel one of the member's own bookings (the `id` from get_bookings, where `yours` is true). Confirm with the member first.",
    action: "cancel",
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { bookingId: { type: "string" } },
      required: ["bookingId"],
      additionalProperties: false,
    },
  },
  {
    name: "file_flight",
    title: "File a flight",
    description:
      "File a flight in the member's log, the way Quick Log does: it closes out the flight they have open on that airplane if there is one, advances the airplane's tach and Hobbs, and bills it. Needs the tach reading at shutdown. Read the numbers back to the member before calling.",
    action: "file",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        flownOn: { type: "string", description: "The day flown, YYYY-MM-DD at the club. Defaults to today." },
        tachEnd: { type: "number" },
        tachStart: { type: "number", description: "Left out, the open flight's or nothing." },
        hobbsStart: { type: "number" },
        hobbsEnd: { type: "number" },
        landings: { type: "integer", minimum: 0, description: "Defaults to 1." },
        nightLandings: { type: "integer", minimum: 0 },
        departure: { type: "string", description: "Airport identifier, e.g. KTOA." },
        arrival: { type: "string" },
        route: { type: "string" },
        purpose: { type: "string", enum: PURPOSES },
        tailNumber: TAIL,
        instructor: INSTRUCTOR,
        fuelAddedGal: { type: "number" },
        fuelCostDollars: { type: "number" },
        fuelPaidPersonally: {
          type: "boolean",
          description: "True (the default) if the member paid for the fuel and is owed it back; false on the club's card.",
        },
        notes: { type: "string" },
        requestId: {
          type: "string",
          description: "Any unique string; send the same one on a retry and the flight is filed once.",
        },
      },
      required: ["tachEnd"],
      additionalProperties: false,
    },
  },
  {
    name: "update_flight",
    title: "Correct a log entry",
    description:
      "Correct one of the member's own flight log entries (the `id` from get_my_flying), the way the log's Edit does: name only what changes. Meter corrections re-bill the flight. `logEntry` is the pilot's own write-up (markdown: bold, italic, lists). Read the change back to the member before calling.",
    action: "update-flight",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        flightId: { type: "string" },
        flownOn: { type: "string", description: "The day flown, YYYY-MM-DD at the club." },
        tachStart: { type: ["number", "null"], description: "null clears a reading nobody knows." },
        tachEnd: { type: ["number", "null"] },
        hobbsStart: { type: ["number", "null"] },
        hobbsEnd: { type: ["number", "null"] },
        landings: { type: "integer", minimum: 0 },
        nightLandings: { type: "integer", minimum: 0 },
        departure: { type: "string" },
        arrival: { type: "string" },
        route: { type: "string" },
        purpose: { type: "string", enum: PURPOSES },
        instructor: { ...INSTRUCTOR, description: `${INSTRUCTOR.description} "" removes the instructor.` },
        fuelAddedGal: { type: "number" },
        fuelCostDollars: { type: "number" },
        fuelPaidPersonally: { type: "boolean" },
        notes: { type: "string", description: "Replaces the notes; \"\" clears them." },
        logEntry: { type: "string", description: "Replaces the write-up; \"\" clears it." },
      },
      required: ["flightId"],
      additionalProperties: false,
    },
  },
];

/** What a club-data tool returns (lib/agentClub.ts). */
export type AgentClubRead = "flights" | "pilots";

export interface AgentClubTool extends McpTool {
  read: AgentClubRead;
}

/** Listed only for a key an admin made with "club data" ticked. */
export const AGENT_CLUB_TOOLS: AgentClubTool[] = [
  {
    name: "get_club_flights",
    title: "Club flight log",
    description:
      "Every flight in the club's log over the last 90 days, newest first, each naming its pilot: airplane, tach and Hobbs hours, landings, route, type and instructor.",
    read: "flights",
  },
  {
    name: "get_pilots",
    title: "Pilots",
    description:
      "Every club member and instructor: their certificate/ratings and declared total time (as they entered them on their profile, null when blank), plus flights, landings and hours in the club's log over the last 90 days, hours in the last 12 months, when they last flew, and whether the club's operating rules let them fly solo.",
    read: "pilots",
  },
];

/**
 * The tools a key lists: the readers always, the club readers for a club-data
 * key, the writers only when it may write.
 */
export function agentToolsFor(canWrite: boolean, canReadClub = false): McpTool[] {
  const tools: McpTool[] = [...AGENT_TOOLS];
  if (canReadClub) tools.push(...AGENT_CLUB_TOOLS);
  if (canWrite) tools.push(...AGENT_WRITE_TOOLS);
  return tools;
}

const READ_ONLY_INSTRUCTIONS =
  "Access to one member's view of the Varda Free Flyers club app (vardafreeflyers.com): " +
  "the club's airplanes, bookings, maintenance and squawks, and the member's own flight log and balance. " +
  "Times are ISO instants; show them in the club's time zone (America/Los_Angeles). ";

const CLUB_INSTRUCTIONS =
  "This key also reads the whole club: the flight log with every pilot named (get_club_flights) and each pilot's ratings, total time and recent landings (get_pilots). ";

/** Shown once at initialize; says what this particular key may do. */
export function agentInstructions(canWrite: boolean, canReadClub = false): string {
  const intro = READ_ONLY_INSTRUCTIONS + (canReadClub ? CLUB_INSTRUCTIONS : "");
  if (!canWrite) {
    return intro + "This key is read-only: nothing here can book, file or pay; send the member to the app for that.";
  }
  return (
    intro +
    "This key may also book the airplane, change or cancel the member's own bookings, and file or correct their own flights, as the member. " +
    "Confirm what you are about to do with the member before every write. Nothing here can pay or change anything else."
  );
}
