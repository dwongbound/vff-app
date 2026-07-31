// Edit or cancel one booking. Members own their own; admins can move or
// cancel anyone's (someone has to be able to clear the board for maintenance).
//
// DELETE marks the row CANCELED rather than removing it, so the calendar
// history stays honest and a canceled slot can still be explained.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeReservation } from "@/lib/serialize";
import { findConflict, validateReservation } from "@/lib/reservations";
import { PURPOSE_LABELS, type Purpose } from "@/lib/constants";
import { formatTimeRange } from "@/lib/dates";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  flight: { select: { id: true } },
} as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findUnique({
    where: { id },
    include: INCLUDE,
  });
  if (!existing) {
    return NextResponse.json({ error: "That booking is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your booking." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const startsAt = body.startsAt ? new Date(String(body.startsAt)) : existing.startsAt;
  const endsAt = body.endsAt ? new Date(String(body.endsAt)) : existing.endsAt;

  // Only re-validate the window when it actually moved — otherwise editing the
  // notes on a booking that already started would fail the "not in the past"
  // rule.
  const timesChanged =
    startsAt.getTime() !== existing.startsAt.getTime() ||
    endsAt.getTime() !== existing.endsAt.getTime();

  if (timesChanged) {
    const invalid = validateReservation({ startsAt, endsAt });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const neighbors = await prisma.reservation.findMany({
      where: {
        aircraftId: existing.aircraftId,
        status: "CONFIRMED",
        endsAt: { gt: startsAt },
        startsAt: { lt: endsAt },
      },
      include: INCLUDE,
    });
    const conflict = findConflict(neighbors, { startsAt, endsAt }, existing.id);
    if (conflict) {
      return NextResponse.json(
        {
          error:
            `${conflict.user.name} already has the airplane from ` +
            `${formatTimeRange(conflict.startsAt, conflict.endsAt)}.`,
        },
        { status: 409 }
      );
    }
  }

  const data: Record<string, unknown> = { startsAt, endsAt };
  if (typeof body.purpose === "string" && body.purpose in PURPOSE_LABELS) {
    data.purpose = body.purpose as Purpose;
  }
  if ("notes" in body) data.notes = body.notes ? String(body.notes).trim() : null;
  if (body.status === "CONFIRMED" || body.status === "CANCELED") {
    data.status = body.status;
  }

  const updated = await prisma.reservation.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeReservation(updated, user.id));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "That booking is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your booking." }, { status: 403 });
  }

  const canceled = await prisma.reservation.update({
    where: { id },
    data: { status: "CANCELED" },
    include: INCLUDE,
  });

  return NextResponse.json(serializeReservation(canceled, user.id));
}
