// The flight log.
//
// GET  /api/flights?aircraftId=&mine=1&limit=  — newest first.
// POST /api/flights  — the post-flight form's submit. Besides writing the log
//      line it advances the aircraft's last-known meter readings, which is what
//      lets the next pilot's form prefill "tach start" instead of guessing.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeFlight } from "@/lib/serialize";
import { validateMeters } from "@/lib/hours";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  pilot: { select: { id: true, name: true, email: true } },
  photos: true,
  squawks: {
    include: {
      reportedBy: { select: { id: true, name: true, email: true } },
      resolvedBy: { select: { id: true, name: true, email: true } },
      photos: true,
    },
  },
} as const;

/** Number, or null for "" / null / undefined / unparseable. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * What the fuel cost, in whole cents.
 *
 * The post-flight form asks for dollars (that's what the receipt says) while
 * the column stores cents, so both spellings are accepted here rather than
 * making the client do money arithmetic.
 */
function fuelCostCents(body: Record<string, unknown>): number | null {
  const cents = num(body.fuelCostCents);
  if (cents != null) return Math.round(cents);

  const dollars = num(body.fuelCostDollars);
  if (dollars != null) return Math.round(dollars * 100);

  return null;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const mine = url.searchParams.get("mine") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const rows = await prisma.flight.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
    },
    include: INCLUDE,
    orderBy: [{ flownOn: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json(rows.map((f) => serializeFlight(f, user.id)));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true, lastTach: true, lastHobbs: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  const tachStart = num(body.tachStart);
  const tachEnd = num(body.tachEnd);
  if (tachStart == null || tachEnd == null) {
    return NextResponse.json({ error: "Enter both tach readings." }, { status: 400 });
  }
  const hobbsStart = num(body.hobbsStart);
  const hobbsEnd = num(body.hobbsEnd);

  const meterError = validateMeters({ tachStart, tachEnd, hobbsStart, hobbsEnd });
  if (meterError) return NextResponse.json({ error: meterError }, { status: 400 });

  // Reservations can only be closed out by the person who made them (or an
  // admin), and only once — the unique constraint would otherwise surface as a
  // raw Prisma error.
  let reservationId: string | null = null;
  if (body.reservationId) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: String(body.reservationId) },
      select: { id: true, userId: true, aircraftId: true, flight: { select: { id: true } } },
    });
    if (!reservation) {
      return NextResponse.json({ error: "That booking is gone." }, { status: 400 });
    }
    if (reservation.userId !== user.id && !user.isAdmin) {
      return NextResponse.json({ error: "That's not your booking." }, { status: 403 });
    }
    if (reservation.flight) {
      return NextResponse.json(
        { error: "A flight has already been filed against that booking." },
        { status: 409 }
      );
    }
    if (reservation.aircraftId !== aircraftId) {
      return NextResponse.json(
        { error: "That booking is for a different airplane." },
        { status: 400 }
      );
    }
    reservationId = reservation.id;
  }

  const flownOn = body.flownOn ? new Date(String(body.flownOn)) : new Date();
  if (Number.isNaN(flownOn.getTime())) {
    return NextResponse.json({ error: "Invalid flight date." }, { status: 400 });
  }

  const created = await prisma.flight.create({
    data: {
      aircraftId,
      userId: user.id,
      reservationId,
      flownOn,
      tachStart,
      tachEnd,
      hobbsStart,
      hobbsEnd,
      landings: Math.max(0, Math.round(num(body.landings) ?? 1)),
      // Night landings count toward currency only when they're a subset of the
      // flight's landings — clamp rather than reject, since the pilot is
      // reporting one number they already know.
      nightLandings: Math.min(
        Math.max(0, Math.round(num(body.nightLandings) ?? 0)),
        Math.max(0, Math.round(num(body.landings) ?? 1))
      ),
      withInstructor: body.withInstructor === true,
      departure: body.departure ? String(body.departure).trim().toUpperCase() : null,
      arrival: body.arrival ? String(body.arrival).trim().toUpperCase() : null,
      route: body.route ? String(body.route).trim() : null,
      fuelAddedGal: num(body.fuelAddedGal),
      fuelCostCents: fuelCostCents(body),
      oilAddedQts: num(body.oilAddedQts),
      tiedDown: body.tiedDown !== false,
      cabinClean: body.cabinClean !== false,
      notes: body.notes ? String(body.notes).trim() : null,
    },
    include: INCLUDE,
  });

  // Advance the airplane's meters. Guarded with `>` so filing an older flight
  // late (or fixing a typo) can't wind the airplane backwards.
  const meterUpdate: Record<string, number> = {};
  if (aircraft.lastTach == null || tachEnd > aircraft.lastTach) {
    meterUpdate.lastTach = tachEnd;
  }
  if (hobbsEnd != null && (aircraft.lastHobbs == null || hobbsEnd > aircraft.lastHobbs)) {
    meterUpdate.lastHobbs = hobbsEnd;
  }
  if (Object.keys(meterUpdate).length > 0) {
    await prisma.aircraft.update({ where: { id: aircraftId }, data: meterUpdate });
  }

  return NextResponse.json(serializeFlight(created, user.id), { status: 201 });
}
