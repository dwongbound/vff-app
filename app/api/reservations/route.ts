// Reservations: list a window of the schedule, and book the airplane.
//
// GET  /api/reservations?aircraftId=&from=&to=&mine=1
//      `from`/`to` are ISO instants bounding the calendar month (or the
//      list's horizon on phones). Canceled bookings are excluded unless
//      ?includeCanceled=1, so the calendar shows the schedule as flown.
// POST /api/reservations  { aircraftId, startsAt, endsAt, purpose, notes }
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

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const mine = url.searchParams.get("mine") === "1";
  const includeCanceled = url.searchParams.get("includeCanceled") === "1";

  const rows = await prisma.reservation.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
      ...(includeCanceled ? {} : { status: "CONFIRMED" }),
      // A booking is "in the window" if it overlaps it at all, so a long
      // cross-country that starts before the window still shows up.
      ...(from ? { endsAt: { gt: new Date(from) } } : {}),
      ...(to ? { startsAt: { lt: new Date(to) } } : {}),
    },
    include: INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json(rows.map((r) => serializeReservation(r, user.id)));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const startsAt = new Date(String(body.startsAt ?? ""));
  const endsAt = new Date(String(body.endsAt ?? ""));
  const purpose = (String(body.purpose ?? "LOCAL") as Purpose) in PURPOSE_LABELS
    ? (String(body.purpose ?? "LOCAL") as Purpose)
    : "LOCAL";
  const notes = body.notes ? String(body.notes).trim() : null;

  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true, active: true, tailNumber: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }
  if (!aircraft.active) {
    return NextResponse.json(
      { error: `${aircraft.tailNumber} is retired and can't be booked.` },
      { status: 400 }
    );
  }

  // Same rule set the client form runs, re-checked here: the client can be
  // stale (or bypassed entirely).
  const invalid = validateReservation({ startsAt, endsAt });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  // Only bookings that could possibly touch this window need loading.
  const neighbors = await prisma.reservation.findMany({
    where: {
      aircraftId,
      status: "CONFIRMED",
      endsAt: { gt: startsAt },
      startsAt: { lt: endsAt },
    },
    include: INCLUDE,
  });

  const conflict = findConflict(neighbors, { startsAt, endsAt });
  if (conflict) {
    return NextResponse.json(
      {
        error:
          `${conflict.user.name} already has ${aircraft.tailNumber} from ` +
          `${formatTimeRange(conflict.startsAt, conflict.endsAt)}.`,
      },
      { status: 409 }
    );
  }

  const created = await prisma.reservation.create({
    data: { aircraftId, userId: user.id, startsAt, endsAt, purpose, notes },
    include: INCLUDE,
  });

  return NextResponse.json(serializeReservation(created, user.id), { status: 201 });
}
