// Squawks — anything wrong with the airplane.
//
// GET  /api/squawks?aircraftId=&status=OPEN|RESOLVED|all
// POST /api/squawks  { aircraftId, title, description, severity, flightId,
//                      preflightId }
//
// Anyone in the club can raise one (that's the point); only admins sign them
// off (see [id]/route.ts).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeSquawk } from "@/lib/serialize";
import { SEVERITY_LABELS, type Severity } from "@/lib/constants";

const INCLUDE = {
  reportedBy: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const status = url.searchParams.get("status") ?? "OPEN";

  const rows = await prisma.squawk.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(status === "all" ? {} : { status: status === "RESOLVED" ? "RESOLVED" : "OPEN" }),
    },
    include: INCLUDE,
    // Grounding items first, then newest — the list doubles as the "can we
    // fly?" answer.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(rows.map(serializeSquawk));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Give the squawk a short title." }, { status: 400 });
  }

  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  const severity: Severity =
    typeof body.severity === "string" && body.severity in SEVERITY_LABELS
      ? (body.severity as Severity)
      : "NOTE";

  const created = await prisma.squawk.create({
    data: {
      aircraftId,
      reportedById: user.id,
      title,
      description: body.description ? String(body.description).trim() : null,
      severity,
      flightId: body.flightId ? String(body.flightId) : null,
      preflightId: body.preflightId ? String(body.preflightId) : null,
    },
    include: INCLUDE,
  });

  return NextResponse.json(serializeSquawk(created), { status: 201 });
}
