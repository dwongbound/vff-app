// One flight-log entry, in full.
//
// GET    — the entry with its photos and squawks. The list endpoint returns
//          neither (see lib/flights.ts), so this is what FlightDetailModal
//          fetches when a member opens a row.
// PATCH  — fix it. Pilots can correct their own; admins can correct anyone's
//          (a mis-keyed tach reading throws off the club's billing until
//          someone fixes it). Stamps `editedAt`.
// DELETE — remove it, and the bytes of any photos attached.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { purgePhotosFor } from "@/lib/photos";
import { serializeFlight } from "@/lib/serialize";
import { FLIGHT_DETAIL_INCLUDE } from "@/lib/flights";
import { validateMeters } from "@/lib/hours";
import {
  TURNOFF_CHECKOUT,
  derivePutAway,
  parseAnswers,
  parseValues,
} from "@/lib/checkouts";
import { syncFlightCharges } from "@/lib/ledger";
import {
  fuelCostCentsFrom,
  landingFeeCentsFrom,
  mentionsLandingFee,
} from "@/lib/flights";
import { resolveInstructor, resolutionFailed } from "@/lib/instructors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const flight = await prisma.flight.findUnique({
    where: { id },
    include: FLIGHT_DETAIL_INCLUDE,
  });
  if (!flight) {
    return NextResponse.json({ error: "That flight is gone." }, { status: 404 });
  }

  // Readable by any member: the flight log is the club's shared record, and
  // the list this is opened from already shows every flight to everyone.
  return NextResponse.json(serializeFlight(flight, user.id));
}

/** Number, or null for "" / null / undefined / unparseable. */
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
  for (const field of ["fuelAddedGal", "oilAddedQts"] as const) {
    if (field in body) data[field] = num(body[field]);
  }
  // The two money fields go through the same readers the POST route uses, so a
  // form that sends dollars is understood by both. See lib/flights.ts.
  if ("fuelCostCents" in body || "fuelCostDollars" in body) {
    data.fuelCostCents = fuelCostCentsFrom(body);
  }
  if (mentionsLandingFee(body)) {
    data.landingFeeCents = landingFeeCentsFrom(body);
  }
  if ("nightLandings" in body) {
    data.nightLandings = Math.max(0, Math.round(num(body.nightLandings) ?? 0));
  }
  for (const field of ["tiedDown", "cabinClean", "withInstructor"] as const) {
    if (typeof body[field] === "boolean") data[field] = body[field];
  }
  // Re-answering the turn-off checkout re-derives the put-away flags, so the
  // two can't drift apart (see the POST route for the same rule).
  if ("turnoffAnswers" in body) {
    const turnoffAnswers = parseAnswers("TURNOFF", body.turnoffAnswers);
    data.turnoffAnswers = turnoffAnswers;
    // The readings recorded ON those items (the tach, the flight timer) go
    // with them — they were being parsed and then dropped, which quietly wiped
    // the shutdown tach every time a filed flight was corrected.
    data.turnoffValues = parseValues("TURNOFF", body.turnoffValues);
    data.turnoffCheckoutVersion = TURNOFF_CHECKOUT.version;
    Object.assign(data, derivePutAway(turnoffAnswers));
  }
  if (body.flownOn) {
    const flownOn = new Date(String(body.flownOn));
    if (Number.isNaN(flownOn.getTime())) {
      return NextResponse.json({ error: "Invalid flight date." }, { status: 400 });
    }
    data.flownOn = flownOn;
  }
  // Changing WHO is to sign this entry is a correction like any other, and is
  // available for the same reason the rest of this route is: a lesson filed
  // with the wrong instructor (or none) otherwise has no way back.
  if ("instructorId" in body) {
    const instructor = await resolveInstructor(body.instructorId);
    if (resolutionFailed(instructor)) {
      return NextResponse.json({ error: instructor.error }, { status: 400 });
    }
    data.instructorId = instructor.instructorId;
  }

  // Stamp the content edit. This is what "last edited" reads, and what a
  // signature is compared against — see the column's comment in the schema for
  // why Prisma's own `updatedAt` can't do this job.
  //
  // Every branch above writes a field a reader would call the log entry, so
  // reaching here at all means the entry changed. The signature is deliberately
  // NOT cleared: an instructor's endorsement isn't withdrawn by somebody else's
  // edit, it just stops covering what's on screen, and the flight log says so
  // rather than quietly erasing a signature that was really given.
  data.editedAt = new Date();

  const updated = await prisma.flight.update({
    where: { id },
    data,
    include: FLIGHT_DETAIL_INCLUDE,
  });

  // A corrected tach reading or fuel receipt changes what this flight cost, so
  // its ledger lines are rebuilt from the flight as it now stands. Note this
  // re-prices at the airplane's CURRENT rate — correcting an old flight after
  // a rate change bills it at the new one.
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: updated.aircraftId },
    select: { tailNumber: true, hourlyRateCents: true },
  });
  if (aircraft) {
    await syncFlightCharges({
      id: updated.id,
      userId: updated.userId,
      tachStart: updated.tachStart,
      tachEnd: updated.tachEnd,
      flownOn: updated.flownOn,
      fuelCostCents: updated.fuelCostCents,
      landingFeeCents: updated.landingFeeCents,
      arrival: updated.arrival,
      aircraft,
    });
  }

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

  // The Photo ROWS cascade with the flight, but object storage doesn't know
  // about that — drop the bytes first or they'd sit in the bucket forever with
  // nothing left pointing at them. Squawks raised on this flight survive
  // (flightId is SetNull), so their photos are deliberately untouched.
  await purgePhotosFor({ flightId: id });
  await prisma.flight.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
