// Checkout runs — one pass over one of the airplane's cards.
//
// GET  /api/checkouts?aircraftId=&kind=&mine=1&open=1&limit=  — newest first.
//      `kind` is PREFLIGHT or RUNWAY; omit it for both, newest first.
//      `open=1` returns only runs that were never signed off — with `mine=1`,
//      that's the walk you left half-done, which the pages offer to resume.
//      That exact combination also SWEEPS the caller's abandoned runs; see
//      lib/checkoutCleanup.ts for why the housekeeping rides on this read.
// POST /api/checkouts  { aircraftId, kind, answers, values, notes, complete }
//      `fuelOnBoardGal` / `oilQuarts` are NOT accepted: they're derived from
//      `values` (the readings recorded on the consumables items).
//      `complete: true` stamps completedAt, which is what makes a run count as
//      a signed-off checkout. A partial run can be posted too — that's the
//      checkout pages autosaving; it is then finished, or discarded, through
//      PATCH/DELETE on /api/checkouts/[id], so one walkaround stays one row
//      however many times it gets put down and picked back up. Posting a
//      partial run RETIRES any the caller already had open on that card, which
//      is the invariant the resume logic depends on: at most one.
//
// SIGNING OFF A CARD WRITES TO THE FLIGHT LOG. Completing the preflight opens a
// flight session — a log row carrying the meters and the clock that walk just
// read — and completing the runway card joins the one already open (or opens
// one, for a member who skipped the preflight). The response carries the
// session's `flightId`, which is what the pages link to. See
// lib/flightSession.ts for the rules and lib/flightSessions.ts for the writes.
//
// The turn-off checkout is NOT here: it's answered on the post-flight form and
// stored on the Flight row, so it goes up through /api/flights.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeCheckout } from "@/lib/serialize";
import { supersedeOpenRuns, sweepAbandonedRuns } from "@/lib/checkoutCleanup";
import { attachCheckoutToSession } from "@/lib/flightSessions";
import {
  checkoutFor,
  deriveFuelOil,
  isComplete,
  parseAnswers,
  parseValues,
} from "@/lib/checkouts";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

/** The kinds that get a row of their own. TURNOFF lives on Flight. */
type StoredKind = "PREFLIGHT" | "RUNWAY";

function isStoredKind(value: unknown): value is StoredKind {
  return value === "PREFLIGHT" || value === "RUNWAY";
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const kind = url.searchParams.get("kind");
  const mine = url.searchParams.get("mine") === "1";
  // Runs that were saved but never signed off. With `mine=1` this is how the
  // checkout pages find the walk you left half-done and offer to resume it.
  const openOnly = url.searchParams.get("open") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);

  // An unrecognised kind is a client bug, not "show me everything" — say so
  // rather than quietly returning the wrong card's runs.
  if (kind !== null && !isStoredKind(kind)) {
    return NextResponse.json(
      { error: "kind must be PREFLIGHT or RUNWAY." },
      { status: 400 }
    );
  }

  // "Find the walk I left half-done" is exactly when the runs nobody will ever
  // resume are worth clearing out, so the sweep rides on this query rather than
  // on a scheduled job the club would have to keep running. Own rows only, and
  // only ones that have been idle for a week — see lib/checkoutCleanup.ts.
  if (mine && openOnly) {
    await sweepAbandonedRuns({ userId: user.id });
  }

  const rows = await prisma.checkout.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(kind ? { kind } : {}),
      ...(mine ? { userId: user.id } : {}),
      ...(openOnly ? { completedAt: null } : {}),
    },
    include: INCLUDE,
    // `updatedAt` when hunting for a run to resume: a walk begun on Monday and
    // added to this morning is the one you want back, and ordering by when it
    // was STARTED would hand you a staler row with `limit=1`.
    orderBy: openOnly ? { updatedAt: "desc" } : { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(rows.map(serializeCheckout));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const kind: unknown = body.kind;
  if (!isStoredKind(kind)) {
    return NextResponse.json(
      { error: "Say which checkout this is: PREFLIGHT or RUNWAY." },
      { status: 400 }
    );
  }

  const aircraftId = String(body.aircraftId ?? "");
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  // Drop anything that isn't a live id on THIS card — a stale client (or a
  // typo, or the other checkout's answers) shouldn't be able to write junk
  // keys into the answers column.
  const answers = parseAnswers(kind, body.answers);
  // Same treatment for the recorded readings: ids that aren't on this card are
  // dropped, and a number that won't parse never reaches the column.
  const values = parseValues(kind, body.values);
  const complete = body.complete === true;
  const checkout = checkoutFor(kind);

  // Completing a card with items still unticked is ALLOWED, and it is the
  // member's call rather than the app's — an item that doesn't apply, or a
  // check that couldn't be made today, shouldn't leave the club with no record
  // of the walk that did happen. What it isn't is accidental: the client has to
  // say it meant it, having asked the member in a modal that lists what's
  // missing. Without that flag this is still the old 400, so a stale client (or
  // a bug) can't quietly file a half-walked card as done. The answers column
  // records exactly which items were left, so "completed" never means more than
  // it should.
  if (complete && !isComplete(kind, answers) && body.acknowledgeIncomplete !== true) {
    return NextResponse.json(
      {
        error: `Every item has to be checked to complete the ${checkout.title.toLowerCase()}, or the incomplete card has to be confirmed.`,
      },
      { status: 400 }
    );
  }

  // Fuel and oil are the preflight walkaround's findings. DERIVED from the
  // recorded values rather than read off the body, so the columns can't
  // disagree with what the pilot actually wrote on the card — the same rule
  // `derivePutAway` follows for the flight log's put-away flags. The runway
  // checkout has nothing to measure, so it records neither.
  const { fuelOnBoardGal, oilQuarts } =
    kind === "PREFLIGHT"
      ? deriveFuelOil(values)
      : { fuelOnBoardGal: null, oilQuarts: null };

  // Any run posted for this card supersedes the caller's OPEN ones on it.
  //
  // This holds the "at most one open run per member per airplane per card"
  // invariant that `resolveResume` depends on. Without it, autosave POSTing a
  // fresh draft — because the device's copy had lost track of its row — would
  // quietly fork one walk into two, and the next resume would have to pick.
  //
  // It applies to a COMPLETE post too, which is not a contradiction of "a
  // sign-off never deletes anything": what it retires is an unfinished DRAFT of
  // the same card by the same member, which is the same walk by definition, and
  // never a signed-off record (`supersedeOpenRuns` filters on
  // `completedAt: null`). That case is reachable when a member ticks the last
  // box and signs off inside the autosave debounce, so the sign-off POSTs
  // without knowing a draft row had just been created for it — and without this,
  // the walk they just signed for would greet them as "picking up where you
  // left off" on their next visit.
  await supersedeOpenRuns({ userId: user.id, aircraftId, kind });

  const created = await prisma.checkout.create({
    data: {
      aircraftId,
      userId: user.id,
      kind,
      checkoutVersion: checkout.version,
      answers,
      values,
      fuelOnBoardGal,
      oilQuarts,
      notes: body.notes ? String(body.notes).trim() : null,
      completedAt: complete ? new Date() : null,
    },
    include: INCLUDE,
  });

  // A SIGNED-OFF card belongs to a flight. A draft doesn't yet — half a
  // walkaround is not a flight anyone has committed to, and opening a log row
  // on the first tick would fill the club's log with sessions for members who
  // changed their minds at the fuel truck.
  if (complete) {
    const flightId = await attachCheckoutToSession({
      checkoutId: created.id,
      userId: user.id,
      aircraftId,
      kind,
      values,
    });
    if (flightId) created.flightId = flightId;
  }

  return NextResponse.json(serializeCheckout(created), { status: 201 });
}
