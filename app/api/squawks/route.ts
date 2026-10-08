// Squawks — anything wrong with the airplane.
//
// GET  /api/squawks?aircraftId=&status=open|closed|all|<STATUS>
//      "open" (the default) is everything except CLOSED — including
//      REVIEWED_OK_TO_FLY, which is reviewed but not fixed and so is exactly
//      what the next pilot should read before walking out.
// POST /api/squawks  { aircraftId, title, description, flightId, checkoutId, requestId }
//
// Anyone in the club can raise one — that's the point, and it's why filing is
// NOT behind `squawk:manage`. A member never picks the status: everything
// lands at NEW and the Safety Officer triages it (see [id]/route.ts).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeSquawk } from "@/lib/serialize";
import {
  SQUAWK_TRIAGE_ORDER,
  isSquawkStatus,
  type SquawkStatus,
} from "@/lib/squawks";
import { isUniqueViolation, requestIdFrom } from "@/lib/idempotency";

const INCLUDE = {
  reportedBy: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

/** The squawk a retried request already filed, or null. See lib/idempotency. */
async function alreadyFiled(requestId: string, userId: string) {
  const row = await prisma.squawk.findUnique({
    where: { clientRequestId: requestId },
    include: INCLUDE,
  });
  if (!row) return null;
  if (row.reportedById !== userId) {
    return NextResponse.json(
      { error: "That request id belongs to another squawk." },
      { status: 409 }
    );
  }
  return NextResponse.json(serializeSquawk(row), { status: 200 });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const status = url.searchParams.get("status") ?? "open";

  // `open`/`closed`/`all` are the coarse buckets the pages ask for; an exact
  // status is allowed too, for the Squawks tab's filter. An unrecognised value
  // falls through to "open", which is the default the pages rely on.
  //
  // Written as a chain of plain cases rather than nested ternaries: this is the
  // query that decides which defects the next pilot is shown, and it should be
  // readable at a glance by someone who doesn't already know the vocabulary.
  function statusFilter() {
    if (isSquawkStatus(status)) return { status };
    if (status === "all") return {};
    if (status === "closed") return { status: "CLOSED" as const };
    return { status: { not: "CLOSED" as const } };
  }
  const where = statusFilter();

  const rows = await prisma.squawk.findMany({
    where: { ...(aircraftId ? { aircraftId } : {}), ...where },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  // Then re-sorted worst-first in the app rather than the query: the list
  // doubles as the "can we fly?" answer, so what stops dispatch belongs at the
  // top. This can't be an `orderBy` on the column — Postgres sorts an enum in
  // DECLARATION order, which runs NEW → … → CLOSED and would bury the grounded
  // ones at the bottom. `SQUAWK_TRIAGE_ORDER` is the deliberate order.
  rows.sort(
    (a, b) =>
      SQUAWK_TRIAGE_ORDER.indexOf(a.status as SquawkStatus) -
      SQUAWK_TRIAGE_ORDER.indexOf(b.status as SquawkStatus)
  );

  return NextResponse.json(rows.map(serializeSquawk));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // A retry of a squawk that already landed returns it rather than filing the
  // same fault twice. See lib/idempotency.ts.
  const requestId = requestIdFrom(body.requestId);
  const replay = requestId ? await alreadyFiled(requestId, user.id) : null;
  if (replay) return replay;

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

  // Status is deliberately NOT read off the body: a member filing a squawk is
  // reporting what they saw, not ruling on whether the airplane flies. It
  // starts at NEW (the column default) and only `squawk:manage` moves it.
  let created;
  try {
    created = await prisma.squawk.create({
      data: {
        aircraftId,
        reportedById: user.id,
        title,
        description: body.description ? String(body.description).trim() : null,
        flightId: body.flightId ? String(body.flightId) : null,
        checkoutId: body.checkoutId ? String(body.checkoutId) : null,
        clientRequestId: requestId,
      },
      include: INCLUDE,
    });
  } catch (error) {
    if (requestId && isUniqueViolation(error)) {
      const raced = await alreadyFiled(requestId, user.id);
      if (raced) return raced;
    }
    throw error;
  }

  return NextResponse.json(serializeSquawk(created), { status: 201 });
}
