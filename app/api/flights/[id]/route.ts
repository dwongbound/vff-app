// One flight-log entry, in full.
//
// GET    — the entry with its photos and squawks. The list endpoint returns
//          neither (see lib/flights.ts), so this is what FlightDetailModal
//          fetches when a member opens a row.
// PATCH  — fix it. Pilots can correct their own; admins can correct anyone's
//          (a mis-keyed tach reading throws off the club's billing until
//          someone fixes it). Stamps `editedAt`.
//
//          Two things about it are not "just another field". `logEntry` — the
//          pilot's write-up — is the AUTHOR'S ALONE, admin or not: the rest of
//          the entry is the club's record of an airplane, and this is one
//          member's account of their flight. And every meter and time may be
//          CLEARED as well as set, which is why they're read with `in body`
//          rather than coalesced against what's stored: "I typed that tach in
//          from memory and I was wrong" has to be expressible, and a route that
//          only ever fills fields in makes a guess permanent.
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
import { canEditLogEntry, resolveTimes } from "@/lib/flightSession";
import { advanceMeters } from "@/lib/flightSessions";
import { normalizeLogEntry } from "@/lib/markdown";

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

/** An ISO instant off the body, or null for anything that isn't one. */
function instant(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  // Everything PATCH can write, because `editedAt` is decided by comparing what
  // arrives against what is stored — see the bottom of this handler.
  const existing = await prisma.flight.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      filedAt: true,
      flownOn: true,
      tachStart: true,
      tachEnd: true,
      hobbsStart: true,
      hobbsEnd: true,
      startedAt: true,
      endedAt: true,
      logEntry: true,
      landings: true,
      nightLandings: true,
      departure: true,
      arrival: true,
      route: true,
      notes: true,
      fuelAddedGal: true,
      fuelCostCents: true,
      fuelPaidPersonally: true,
      landingFeeCents: true,
      oilAddedQts: true,
      tiedDown: true,
      cabinClean: true,
      withInstructor: true,
      instructorId: true,
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
  // before checking — patching only tachEnd still has to make sense. All four
  // read through `in body`, so sending null empties one: a member correcting an
  // entry they filed with a tach they'd misremembered needs to be able to say
  // "I don't know" and have the log show a gap rather than a wrong number.
  const meters = {
    tachStart: "tachStart" in body ? num(body.tachStart) : existing.tachStart,
    tachEnd: "tachEnd" in body ? num(body.tachEnd) : existing.tachEnd,
    hobbsStart: "hobbsStart" in body ? num(body.hobbsStart) : existing.hobbsStart,
    hobbsEnd: "hobbsEnd" in body ? num(body.hobbsEnd) : existing.hobbsEnd,
  };
  const meterError = validateMeters(meters);
  if (meterError) return NextResponse.json({ error: meterError }, { status: 400 });

  const data: Record<string, unknown> = { ...meters };

  // Out and in. Same `in body` rule, and the same overnight fix the file path
  // applies (`resolveTimes`) so a leg that lands after midnight reads as two
  // and a half hours rather than as minus twenty-one.
  if ("startedAt" in body || "endedAt" in body) {
    const times = resolveTimes(
      "startedAt" in body ? instant(body.startedAt) : existing.startedAt,
      "endedAt" in body ? instant(body.endedAt) : existing.endedAt
    );
    data.startedAt = times.startedAt;
    data.endedAt = times.endedAt;
  }

  // The write-up. Author-only — see the module comment — and refused rather
  // than silently dropped, because an admin who typed a paragraph into
  // somebody's log deserves to be told it didn't go anywhere.
  if ("logEntry" in body) {
    if (!canEditLogEntry(existing, { id: user.id })) {
      return NextResponse.json(
        { error: "A flight's write-up belongs to the pilot who flew it." },
        { status: 403 }
      );
    }
    data.logEntry = normalizeLogEntry(body.logEntry);
  }

  // Closing out a session from the log rather than from the post-flight form:
  // the entry stops being a flight in progress. One-way on purpose — there is
  // no un-filing a log entry, and a row put back into "in progress" would go
  // looking for a post-flight form nobody is standing in front of.
  if (body.filed === true && !existing.filedAt) {
    data.filedAt = new Date();
  }
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
  // Whose card, correctable like anything else on the entry — getting this
  // wrong is the difference between being paid back and not, and it re-bills
  // through `syncFlightCharges` the same way a corrected receipt does. Only
  // touched when the body names it: a PATCH from a form that has never heard
  // of the field must not silently flip it.
  if ("fuelPaidPersonally" in body) {
    data.fuelPaidPersonally = body.fuelPaidPersonally !== false;
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
  // The signature is deliberately NOT cleared: an instructor's endorsement
  // isn't withdrawn by somebody else's edit, it just stops covering what's on
  // screen, and the flight log says so rather than quietly erasing a signature
  // that was really given.
  //
  // What it is stamped BY is "did a field a reader would call the log entry
  // actually change", compared against the stored row rather than inferred from
  // which keys the client happened to send. Two reasons, and both are bugs the
  // key-counting version had:
  //
  //   • The detail modal PATCHes the WHOLE form on every Save, so "which fields
  //     were sent" is always "all of them" and tells you nothing. Pressing Save
  //     having changed your mind about changing anything would stamp the entry
  //     as edited and quietly demote an instructor's signature to
  //     "signed, then edited".
  //   • The four meters are always in `data` regardless — they're merged over
  //     the stored values so `validateMeters` can see the whole set.
  //
  // `logEntry` is excluded from the comparison, which is the one deliberate
  // exception: what a CFI endorses is the FLIGHT — meters, landings, route, who
  // was on board — while the write-up is the pilot's own account, added and
  // rewritten for as long as the entry exists. Treating a debrief typed up a
  // week later as a change to the endorsed version would mark every signed
  // lesson in the club "signed, then edited" for a paragraph the instructor
  // never signed for in the first place.
  // Two fields are compared at the precision the FORM offers rather than the
  // precision the column keeps, or every Save would report a change it didn't
  // make: `flownOn` is a date-only input (the modal sends local midday, while
  // an API-filed flight carries the clock it was filed at), and the two time
  // fields are `datetime-local`, which has no seconds.
  const dayKey = (d: unknown) =>
    d instanceof Date ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
  const minuteKey = (d: unknown) =>
    d instanceof Date ? Math.floor(d.getTime() / 60_000) : null;

  const stored = existing as Record<string, unknown>;
  const changed = Object.keys(data).some((key) => {
    if (key === "logEntry" || key === "editedAt" || key === "filedAt") return false;
    // The turn-off answers are JSON and only ever land here when the card was
    // re-answered, so their presence IS the change.
    if (key.startsWith("turnoff")) return true;

    const next = data[key];
    const prev = stored[key];
    if (key === "flownOn") return dayKey(next) !== dayKey(prev);
    if (next instanceof Date || prev instanceof Date) {
      return minuteKey(next) !== minuteKey(prev);
    }
    return next !== prev;
  });
  if (changed) data.editedAt = new Date();

  const updated = await prisma.flight.update({
    where: { id },
    data,
    include: FLIGHT_DETAIL_INCLUDE,
  });

  // A corrected end reading is where the airplane now stands. Guarded by `>`
  // inside `advanceMeters`, so fixing a typo DOWNWARDS can't wind the fleet
  // back — and this is what makes "close the entry out from the log" leave the
  // airplane in the same state the post-flight form would have.
  await advanceMeters({
    aircraftId: updated.aircraftId,
    tach: updated.tachEnd,
    hobbs: updated.hobbsEnd,
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
    // Whose card, and it MUST be passed: `BillableFlight.fuelPaidPersonally`
    // is optional and absent-means-true, so a caller that forgets it gets
    // the permissive answer and credits the member for the club's own
    // fuel. That is exactly what happened here until an e2e test caught it.
    fuelPaidPersonally: updated.fuelPaidPersonally,
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
