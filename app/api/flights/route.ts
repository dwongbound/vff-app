// The flight log.
//
// GET  /api/flights?aircraftId=&mine=1&open=1&limit=  — newest first.
//      `open=1` narrows to sessions still in progress (see below); with
//      `mine=1` that's "have I got the airplane out right now", which is what
//      the post-flight form asks as it loads.
// POST /api/flights  — the post-flight form's submit. It FILES a session:
//      normally the one the member's preflight walk opened, which the route
//      finds for itself, and otherwise a fresh row for a flight nobody walked
//      a card for. Besides writing the log line it advances the aircraft's
//      last-known meter readings, which is what lets the next pilot's form
//      prefill "tach start" instead of guessing.
//
// A log row is created by whichever of the three cards is walked FIRST, so
// "file a flight" here means "stamp filedAt on the row and fill in the end of
// it" at least as often as it means "insert". Both paths run the same
// validation, the same put-away derivation and the same billing, because they
// are the same event arriving with different amounts of the row already
// written. See lib/flightSession.ts.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeFlight, serializeFlightSummary } from "@/lib/serialize";
import {
  FLIGHT_DETAIL_INCLUDE,
  FLIGHT_LIST_SELECT,
  fuelCostCentsFrom,
  landingFeeCentsFrom,
} from "@/lib/flights";
import { validateMeters } from "@/lib/hours";
import {
  TURNOFF_CHECKOUT,
  derivePutAway,
  parseAnswers,
  parseValues,
} from "@/lib/checkouts";
import { syncFlightCharges } from "@/lib/ledger";
import { resolveInstructor, resolutionFailed } from "@/lib/instructors";
import {
  SESSION_SELECT,
  advanceMeters,
  endOfSession,
  findOpenSession,
  resolveTimes,
  type OpenSession,
} from "@/lib/flightSessions";
import { normalizeLogEntry } from "@/lib/markdown";


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

/**
 * Which row this submission is closing out, if any.
 *
 * Three answers, in order of how much the caller knows:
 *   • `standalone: true` — the caller is adding a HISTORICAL entry by hand and
 *     is not closing anything out. Checked first, since it overrides the rest.
 *   • a `flightId` on the body — the form loaded the session and is finishing
 *     it. Checked for ownership and for being open, so a stale tab can't file
 *     over somebody else's flight or re-file one already in the log.
 *   • no id, but this member has a session open on this airplane — adopt it.
 *     This is the case that makes the feature work on a shared iPad.
 *   • nothing open — a brand new row, which is the post-flight-without-
 *     preflight entry.
 */
async function resolveSession(args: {
  userId: string;
  aircraftId: string;
  flightId: unknown;
  standalone: boolean;
  isAdmin: boolean;
}): Promise<{ flight: OpenSession | null } | { error: string; status: number }> {
  // "This is a flight from last month, not the one I'm standing next to."
  // FlightEntryModal says so, and it has to: adopting today's open session for
  // a hop somebody flew in June would close out the wrong flight with the
  // wrong numbers, and the member filling in the paper log would never see it.
  if (args.standalone) return { flight: null };

  if (args.flightId) {
    const named = await prisma.flight.findUnique({
      where: { id: String(args.flightId) },
      select: SESSION_SELECT,
    });
    if (!named) {
      return { error: "That flight session is gone.", status: 404 };
    }
    if (named.userId !== args.userId && !args.isAdmin) {
      return { error: "That's someone else's flight.", status: 403 };
    }
    if (named.filedAt) {
      return {
        error: "That flight has already been filed. Edit it from the log instead.",
        status: 409,
      };
    }
    if (named.aircraftId !== args.aircraftId) {
      return { error: "That session is for a different airplane.", status: 400 };
    }
    return { flight: named };
  }

  return {
    flight: await findOpenSession({
      userId: args.userId,
      aircraftId: args.aircraftId,
    }),
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const mine = url.searchParams.get("mine") === "1";
  // An instructor's own view of the log: the lessons they're named on. Their
  // "Mine" tab is this rather than "flights I was the pilot of", because a CFI
  // teaching in the club airplane isn't logging PIC time in it — the entries
  // that are theirs are the ones waiting on their signature.
  const instructing = url.searchParams.get("instructing") === "1";
  // Sessions still in progress — the airplane is out and nobody has closed the
  // entry. `mine=1&open=1` is the post-flight form asking whether it's here to
  // finish something rather than to start something.
  const openOnly = url.searchParams.get("open") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const rows = await prisma.flight.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
      ...(instructing ? { instructorId: user.id } : {}),
      ...(openOnly ? { filedAt: null } : {}),
    },
    include: FLIGHT_LIST_SELECT,
    // Open sessions first, then by day. A flight that hasn't been closed out is
    // the one thing in this list somebody has to DO something about, and it
    // sorts by `flownOn` into the middle of an ordinary day's flying otherwise.
    orderBy: [{ filedAt: { sort: "asc", nulls: "first" } }, { flownOn: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json(rows.map((f) => serializeFlightSummary(f, user.id)));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    // tailNumber + rate come along for the billing lines this flight produces.
    select: { id: true, tailNumber: true, hourlyRateCents: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  // The session being closed out.
  //
  // The client may name one (the post-flight form does, having loaded it to
  // prefill from), but the route looks for itself as well: a member who walked
  // the preflight card on the clubhouse iPad and files from their phone has an
  // open session the phone never heard of, and filing a second row for the
  // same flight is exactly the bug this whole feature exists to remove.
  const session = await resolveSession({
    userId: user.id,
    aircraftId,
    flightId: body.flightId,
    standalone: body.standalone === true,
    isAdmin: user.isAdmin,
  });
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const open = session.flight;

  // Tach START may be absent — a flight closed out by somebody who never
  // walked a preflight card genuinely doesn't know where the airplane began,
  // and a log row with an end and no start is a better record than none. What
  // it costs is the hours line: nothing bills until both ends are known, and
  // filling the start in later from the log entry bills it then.
  //
  // Tach END is required by DEFAULT, because on the post-flight form it is the
  // number the pilot has just read off the panel and the whole reason the form
  // is open — filing without it there is almost always a slip.
  //
  // `acknowledgeIncomplete` is the way past it, and it is the same bargain the
  // checkouts route strikes over a half-ticked card: the member may file what
  // they actually know, but only by saying so explicitly, so a stale client
  // can't drop the reading by accident. The entry lands FILED with a gap —
  // which `isIncompleteEntry` makes findable in the log and every later write
  // re-bills — rather than staying open and leaving the airplane looking like
  // it never came back.
  const tachStart = num(body.tachStart) ?? open?.tachStart ?? null;
  const tachEnd = num(body.tachEnd);
  if (tachEnd == null && body.acknowledgeIncomplete !== true) {
    return NextResponse.json(
      { error: "Enter the tach reading at shutdown." },
      { status: 400 }
    );
  }
  const hobbsStart = num(body.hobbsStart) ?? open?.hobbsStart ?? null;
  const hobbsEnd = num(body.hobbsEnd);

  const meterError = validateMeters({ tachStart, tachEnd, hobbsStart, hobbsEnd });
  if (meterError) return NextResponse.json({ error: meterError }, { status: 400 });

  // Reservations can only be closed out by the person who made them (or an
  // admin), and only once — the unique constraint would otherwise surface as a
  // raw Prisma error.
  let reservationId: string | null = null;
  // The CFI this flight is to be signed off by. Inherited from the booking
  // when there is one — the member picked an instructor when they booked the
  // lesson and shouldn't have to say so twice — and otherwise taken from the
  // body, which is how a lesson that was never booked in the app gets one.
  let bookedInstructorId: string | null = null;
  if (body.reservationId) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: String(body.reservationId) },
      select: {
        id: true,
        userId: true,
        aircraftId: true,
        purpose: true,
        instructorId: true,
        flight: { select: { id: true } },
      },
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
    // Only a TRAINING booking carries an instructor at all (the reservation
    // routes enforce that), so this is already null for every other purpose.
    bookedInstructorId = reservation.instructorId;
  }

  const instructor = await resolveInstructor(
    bookedInstructorId ?? body.instructorId ?? null
  );
  if (resolutionFailed(instructor)) {
    return NextResponse.json({ error: instructor.error }, { status: 400 });
  }

  const flownOn = body.flownOn ? new Date(String(body.flownOn)) : new Date();
  if (Number.isNaN(flownOn.getTime())) {
    return NextResponse.json({ error: "Invalid flight date." }, { status: 400 });
  }

  // The turn-off checkout is the source of truth for the two put-away flags
  // when it's been answered at all. A flight filed without it (someone closing
  // out a hop from days ago) keeps the old body-boolean behaviour, so late
  // filings aren't nagged for a checkout they were never shown.
  const turnoffAnswers = parseAnswers("TURNOFF", body.turnoffAnswers);
  const turnoffValues = parseValues("TURNOFF", body.turnoffValues);
  const answeredTurnoff = Object.keys(turnoffAnswers).length > 0;
  const putAway = derivePutAway(turnoffAnswers);

  // Out and in. The clocks come off the cards where they were read — the
  // preflight's or the runway card's for the start (already on the session, put
  // there when that card was signed off), the turn-off card's for the end. The
  // body may override either, which is how the flight log's own edit works.
  const end = endOfSession(turnoffValues, flownOn);
  const times = resolveTimes(
    instant(body.startedAt) ?? open?.startedAt ?? null,
    instant(body.endedAt) ?? end.endedAt
  );

  const landings = Math.max(0, Math.round(num(body.landings) ?? 1));
  const data = {
    flownOn,
    // Filing is the stamp that turns a session into a log entry. Everything
    // else on this row could be corrected later; this is the moment it stops
    // being a flight in progress.
    filedAt: new Date(),
    tachStart,
    tachEnd,
    hobbsStart,
    hobbsEnd,
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    landings,
    // Night landings count toward currency only when they're a subset of the
    // flight's landings — clamp rather than reject, since the pilot is
    // reporting one number they already know.
    nightLandings: Math.min(Math.max(0, Math.round(num(body.nightLandings) ?? 0)), landings),
    // The pilot's own assertion, for the operating rules' third column…
    withInstructor: body.withInstructor === true || instructor.instructorId != null,
    // …and the named CFI, who is the one who can sign this entry off. A
    // flight filed against a lesson booking is `withInstructor` whether or
    // not the form's box was ticked: the club knows who was on board.
    instructorId: instructor.instructorId,
    departure: body.departure ? String(body.departure).trim().toUpperCase() : null,
    arrival: body.arrival ? String(body.arrival).trim().toUpperCase() : null,
    route: body.route ? String(body.route).trim() : null,
    fuelAddedGal: num(body.fuelAddedGal),
    fuelCostCents: fuelCostCentsFrom(body),
    // Whose card, and it defaults to the MEMBER's when the client says
    // nothing. That's the column's own default and it's the compatible
    // answer: every form that predates the toggle meant "pay me back",
    // because recording a cost was the only way to ask.
    fuelPaidPersonally: body.fuelPaidPersonally !== false,
    landingFeeCents: landingFeeCentsFrom(body),
    oilAddedQts: num(body.oilAddedQts),
    tiedDown: answeredTurnoff ? putAway.tiedDown : body.tiedDown !== false,
    cabinClean: answeredTurnoff ? putAway.cabinClean : body.cabinClean !== false,
    turnoffAnswers,
    turnoffValues,
    turnoffCheckoutVersion: answeredTurnoff ? TURNOFF_CHECKOUT.version : null,
    notes: body.notes ? String(body.notes).trim() : null,
    logEntry: normalizeLogEntry(body.logEntry),
  };

  // One write either way: fill in the session this flight has been living in
  // since the preflight card, or open and close a row in the same breath for a
  // flight nobody walked a card for. A booking is only attached when one was
  // named — an open session may already carry one, and overwriting it with null
  // would quietly un-close-out the reservation.
  const created = open
    ? await prisma.flight.update({
        where: { id: open.id },
        data: reservationId ? { ...data, reservationId } : data,
        include: FLIGHT_DETAIL_INCLUDE,
      })
    : await prisma.flight.create({
        data: { ...data, aircraftId, userId: user.id, reservationId },
        include: FLIGHT_DETAIL_INCLUDE,
      });

  // Advance the airplane's meters, never backwards — see `advanceMeters`. This
  // used to be written out here; it moved to lib/ when the preflight card
  // started doing the same thing at the other end of the flight.
  await advanceMeters({ aircraftId, tach: tachEnd, hobbs: hobbsEnd });

  // Filing a flight is what bills it: tach hours at the airplane's rate, and a
  // credit back for any fuel the pilot bought. See lib/ledger.ts. A flight
  // filed with no start reading bills no hours (it has no measurable span) but
  // still credits the fuel — the receipt is real either way.
  await syncFlightCharges({
    id: created.id,
    userId: created.userId,
    tachStart: created.tachStart,
    tachEnd: created.tachEnd,
    flownOn: created.flownOn,
    fuelCostCents: created.fuelCostCents,
    // Whose card, and it MUST be passed: `BillableFlight.fuelPaidPersonally`
    // is optional and absent-means-true, so a caller that forgets it gets
    // the permissive answer and credits the member for the club's own
    // fuel. That is exactly what happened here until an e2e test caught it.
    fuelPaidPersonally: created.fuelPaidPersonally,
    landingFeeCents: created.landingFeeCents,
    arrival: created.arrival,
    aircraft: {
      tailNumber: aircraft.tailNumber,
      hourlyRateCents: aircraft.hourlyRateCents,
    },
  });

  return NextResponse.json(serializeFlight(created, user.id), { status: 201 });
}
