// Checkout runs — one pass over one of the airplane's cards.
//
// GET  /api/checkouts?aircraftId=&kind=&mine=1&limit=  — most recent first.
//      `kind` is PREFLIGHT or RUNWAY; omit it for both, newest first.
// POST /api/checkouts  { aircraftId, kind, answers, values, notes, complete }
//      `fuelOnBoardGal` / `oilQuarts` are NOT accepted: they're derived from
//      `values` (the readings recorded on the consumables items).
//      `complete: true` stamps completedAt, which is what makes a run count as
//      a signed-off checkout. A partial run can be posted too (you got
//      interrupted at the fuel truck) and finished later.
//
// The turn-off checkout is NOT here: it's answered on the post-flight form and
// stored on the Flight row, so it goes up through /api/flights.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeCheckout } from "@/lib/serialize";
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
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);

  // An unrecognised kind is a client bug, not "show me everything" — say so
  // rather than quietly returning the wrong card's runs.
  if (kind !== null && !isStoredKind(kind)) {
    return NextResponse.json(
      { error: "kind must be PREFLIGHT or RUNWAY." },
      { status: 400 }
    );
  }

  const rows = await prisma.checkout.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(kind ? { kind } : {}),
      ...(mine ? { userId: user.id } : {}),
    },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
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

  if (complete && !isComplete(kind, answers)) {
    return NextResponse.json(
      {
        error: `Every item has to be checked before you can sign off the ${checkout.title.toLowerCase()}.`,
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

  return NextResponse.json(serializeCheckout(created), { status: 201 });
}
