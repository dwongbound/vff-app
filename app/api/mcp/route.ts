// POST /api/mcp — the club app as an MCP server, for a member's own assistant
// (Jarvis). Stateless Streamable HTTP: one JSON-RPC message (or batch) per
// POST, a plain JSON reply, tools only. Protocol rules in lib/mcp.ts, tools in
// lib/agentTools.ts, data in lib/agentSnapshot.ts.
//
// Authenticated by `Authorization: Bearer vff_…` ONLY, like /api/agent. Every
// key gets the reading tools; a club-data key (an admin's) also gets
// get_last_flown and get_pilots; a key made "can book and file" also gets
// book_airplane, update_booking, cancel_booking, file_flight and
// update_flight, which call the app's OWN
// route handlers with the same key — so the booking rules, the conflict check,
// the Google Calendar write and the bill are exactly the app's, and the key
// acts as a plain member there (lib/accessKeyAuth.ts `getActingUser`).
import { NextResponse } from "next/server";
import { getKeyUser, type KeyUser } from "@/lib/accessKeyAuth";
import { agentSection, agentSnapshot } from "@/lib/agentSnapshot";
import { readLastFlown, readPilots } from "@/lib/agentClub";
import {
  AGENT_CLUB_TOOLS,
  AGENT_TOOLS,
  AGENT_WRITE_TOOLS,
  agentInstructions,
  agentToolsFor,
  type AgentAction,
} from "@/lib/agentTools";
import {
  parseBookingArgs,
  parseBookingUpdateArgs,
  parseCancelArgs,
  parseFlightArgs,
  parseFlightUpdateArgs,
  pickAircraft,
  pickInstructor,
} from "@/lib/agentWrites";
import { handleMcp, parseErrorReply } from "@/lib/mcp";
import { prisma } from "@/lib/prisma";
import { PURPOSE_LABELS, type Purpose } from "@/lib/constants";
import { POST as bookRoute } from "../reservations/route";
import { DELETE as cancelRoute, PATCH as editBookingRoute } from "../reservations/[id]/route";
import { POST as fileRoute } from "../flights/route";
import { PATCH as editFlightRoute } from "../flights/[id]/route";

export async function POST(req: Request) {
  const user = await getKeyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Send a personal access key: Authorization: Bearer vff_… (make one on your profile)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="vff"' } }
    );
  }

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json(parseErrorReply(), { status: 400 });

  const replies = await handleMcp(
    {
      name: "vff-app",
      version: "1",
      instructions: agentInstructions(user.canWrite, user.canReadClub),
      tools: agentToolsFor(user.canWrite, user.canReadClub),
      callTool: async (name, args) => {
        const reader = AGENT_TOOLS.find((t) => t.name === name);
        if (reader) return reader.section ? agentSection(user, reader.section) : agentSnapshot(user);
        // Listed only for a club-data key, like the writers below.
        if (name === "get_last_flown") return readLastFlown();
        if (AGENT_CLUB_TOOLS.some((t) => t.name === name)) return readPilots(new Date());
        // handleMcp only calls a tool it listed, and writers are only listed
        // for a key that may write.
        const writer = AGENT_WRITE_TOOLS.find((t) => t.name === name)!;
        return runWrite(req, user, writer.action, args);
      },
    },
    body
  );
  // Only notifications: accepted, nothing to say.
  if (replies === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(replies, { headers: { "Cache-Control": "no-store" } });
}

/**
 * No server-to-client stream: the spec lets a server that never pushes answer
 * GET with 405, and a client then simply POSTs.
 */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

/** One writing tool: parse, resolve names, then hand it to the app's route. */
async function runWrite(req: Request, user: KeyUser, action: AgentAction, args: Record<string, unknown>) {
  switch (action) {
    case "book":
      return book(req, args);
    case "update-booking":
      return updateBooking(req, args);
    case "cancel":
      return cancel(req, args);
    case "file":
      return file(req, user, args);
    case "update-flight":
      return updateFlight(req, args);
  }
}

/** Throws the sentence the model reads when a parse or lookup failed. */
function unwrap<T>(parsed: { value: T } | { error: string }): T {
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.value;
}

async function activeFleet() {
  return prisma.aircraft.findMany({
    where: { active: true },
    orderBy: { tailNumber: "asc" },
    select: { id: true, tailNumber: true },
  });
}

async function instructorId(name: string | null): Promise<string | null> {
  if (!name) return null;
  const instructors = await prisma.user.findMany({
    where: { positions: { has: "INSTRUCTOR" } },
    select: { id: true, name: true },
  });
  return unwrap(pickInstructor(instructors, name)).id;
}

/**
 * A request to one of the app's own routes, carrying THIS request's key — the
 * route authenticates it again, which is the point: it can't be talked into
 * anything the key couldn't do by calling it directly.
 */
function inner(req: Request, path: string, method: string, json?: unknown) {
  return new Request(new URL(path, req.url), {
    method,
    headers: {
      authorization: req.headers.get("authorization") ?? "",
      "content-type": "application/json",
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

/** The route's reply, or a throw carrying its own error sentence. */
async function readReply(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The app refused that (HTTP ${res.status}).`);
  return data;
}

async function book(req: Request, args: Record<string, unknown>) {
  const request = unwrap(parseBookingArgs(args));
  const aircraft = unwrap(pickAircraft(await activeFleet(), request.tailNumber));
  const cfi = request.purpose === "TRAINING" ? await instructorId(request.instructor) : null;
  const res = await bookRoute(
    inner(req, "/api/reservations", "POST", {
      aircraftId: aircraft.id,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      purpose: request.purpose,
      notes: request.notes,
      instructorId: cfi,
    })
  );
  const created = await readReply(res);
  return {
    booked: true,
    bookingId: created.id,
    tailNumber: aircraft.tailNumber,
    startsAt: request.startsAt.toISOString(),
    endsAt: request.endsAt.toISOString(),
    purpose: PURPOSE_LABELS[request.purpose],
  };
}

/**
 * The instructorId to send for a name the tool was given: "" clears it, a name
 * is matched on the roster. Absent (null) sends nothing, so the route keeps the
 * one already there.
 */
async function instructorPatch(name: string | null): Promise<Record<string, unknown>> {
  if (name === null) return {};
  if (name === "") return { instructorId: null };
  return { instructorId: await instructorId(name) };
}

async function updateBooking(req: Request, args: Record<string, unknown>) {
  const request = unwrap(parseBookingUpdateArgs(args));
  const res = await editBookingRoute(
    inner(req, `/api/reservations/${encodeURIComponent(request.bookingId)}`, "PATCH", {
      ...request.body,
      ...(await instructorPatch(request.instructor)),
    }),
    { params: Promise.resolve({ id: request.bookingId }) }
  );
  const booking = await readReply(res);
  return {
    updated: true,
    bookingId: request.bookingId,
    startsAt: booking.startsAt ?? null,
    endsAt: booking.endsAt ?? null,
    purpose: booking.purpose ? (PURPOSE_LABELS[booking.purpose as Purpose] ?? booking.purpose) : null,
    instructor: booking.instructor?.name ?? null,
    notes: booking.notes ?? null,
  };
}

async function cancel(req: Request, args: Record<string, unknown>) {
  const { bookingId } = unwrap(parseCancelArgs(args));
  const res = await cancelRoute(inner(req, `/api/reservations/${encodeURIComponent(bookingId)}`, "DELETE"), {
    params: Promise.resolve({ id: bookingId }),
  });
  await readReply(res);
  return { cancelled: true, bookingId };
}

async function file(req: Request, user: KeyUser, args: Record<string, unknown>) {
  const request = unwrap(parseFlightArgs(args));
  const aircraft = unwrap(pickAircraft(await activeFleet(), request.tailNumber));
  const res = await fileRoute(
    inner(req, "/api/flights", "POST", {
      ...request.body,
      aircraftId: aircraft.id,
      instructorId: await instructorId(request.instructor),
    })
  );
  const flight = await readReply(res);
  return {
    filed: true,
    flightId: flight.id,
    pilot: user.name,
    tailNumber: aircraft.tailNumber,
    tachStart: flight.tachStart ?? null,
    tachEnd: flight.tachEnd ?? null,
  };
}

async function updateFlight(req: Request, args: Record<string, unknown>) {
  const request = unwrap(parseFlightUpdateArgs(args));
  const res = await editFlightRoute(
    inner(req, `/api/flights/${encodeURIComponent(request.flightId)}`, "PATCH", {
      ...request.body,
      ...(await instructorPatch(request.instructor)),
    }),
    { params: Promise.resolve({ id: request.flightId }) }
  );
  const flight = await readReply(res);
  return {
    updated: true,
    flightId: request.flightId,
    tachStart: flight.tachStart ?? null,
    tachEnd: flight.tachEnd ?? null,
    hobbsStart: flight.hobbsStart ?? null,
    hobbsEnd: flight.hobbsEnd ?? null,
    landings: flight.landings ?? null,
    route: flight.route ?? null,
  };
}
