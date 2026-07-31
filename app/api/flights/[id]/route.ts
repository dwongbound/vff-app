// Fix or remove one flight-log entry. Pilots can correct their own; admins can
// correct anyone's (a mis-keyed tach reading throws off the club's billing
// until someone fixes it).
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

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.flight.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      tachStart: true,
      tachEnd: true,
      hobbsStart: true,
      hobbsEnd: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "That flight is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your flight." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Meters are validated as a set, so merge the edits over the stored values
  // before checking — patching only tachEnd still has to make sense.
  const meters = {
    tachStart: num(body.tachStart) ?? existing.tachStart,
    tachEnd: num(body.tachEnd) ?? existing.tachEnd,
    hobbsStart: "hobbsStart" in body ? num(body.hobbsStart) : existing.hobbsStart,
    hobbsEnd: "hobbsEnd" in body ? num(body.hobbsEnd) : existing.hobbsEnd,
  };
  const meterError = validateMeters(meters);
  if (meterError) return NextResponse.json({ error: meterError }, { status: 400 });

  const data: Record<string, unknown> = { ...meters };
  if ("landings" in body) {
    data.landings = Math.max(0, Math.round(num(body.landings) ?? 1));
  }
  for (const field of ["departure", "arrival"] as const) {
    if (field in body) {
      data[field] = body[field] ? String(body[field]).trim().toUpperCase() : null;
    }
  }
  for (const field of ["route", "notes"] as const) {
    if (field in body) data[field] = body[field] ? String(body[field]).trim() : null;
  }
  for (const field of ["fuelAddedGal", "oilAddedQts", "fuelCostCents"] as const) {
    if (field in body) data[field] = num(body[field]);
  }
  for (const field of ["tiedDown", "cabinClean"] as const) {
    if (typeof body[field] === "boolean") data[field] = body[field];
  }
  if (body.flownOn) {
    const flownOn = new Date(String(body.flownOn));
    if (Number.isNaN(flownOn.getTime())) {
      return NextResponse.json({ error: "Invalid flight date." }, { status: 400 });
    }
    data.flownOn = flownOn;
  }

  const updated = await prisma.flight.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeFlight(updated, user.id));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.flight.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "That flight is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your flight." }, { status: 403 });
  }

  // Photos cascade with the row; the bytes are cleaned up by the photo route
  // when a photo is deleted individually. Orphaned objects are harmless and
  // cheap, and keeping the delete synchronous keeps this endpoint fast.
  await prisma.flight.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
