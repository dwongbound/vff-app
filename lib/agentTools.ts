// The MCP tools an access key gets: one per section of the snapshot, plus the
// whole thing. Declared here (not in the route) because a route.ts may only
// export Next's own handlers, and the unit test pins the list.
import type { McpTool } from "./mcp";

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

export const AGENT_INSTRUCTIONS =
  "Read-only access to one member's view of the Varda Free Flyers club app (vardafreeflyers.com): " +
  "the club's airplanes, bookings, maintenance and squawks, and the member's own flight log and balance. " +
  "Times are ISO instants; show them in the club's time zone (America/Los_Angeles). " +
  "Nothing here can book, file or pay; send the member to the app for that.";
