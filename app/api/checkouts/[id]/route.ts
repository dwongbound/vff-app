// One checkout run, while it is still open.
//
// PATCH  /api/checkouts/[id]  { answers, values, notes, complete }
//        Updates the run in place. This is what makes "save progress" honest:
//        a member who gets interrupted at the fuel truck resumes the SAME row
//        rather than leaving a trail of half-finished ones behind. Passing
//        `complete: true` signs it off, exactly as POST does — which includes
//        opening (or joining) the flight session that sign-off belongs to. This
//        is the path the checkout pages actually take, because autosave has
//        almost always created the row before the member presses Complete.
// DELETE /api/checkouts/[id]
//        Discards an open run — the "start over" button. The row goes for real
//        rather than being marked abandoned: nothing reads a discarded
//        walkaround, and keeping them is how the table grows forever.
//
// Both refuse a run that has been SIGNED OFF, and both are the author's alone.
// A completed checkout is the airplane's record of what was walked and by whom;
// letting it be rewritten (or removed) afterwards would make the sign-off
// meaningless, so not even an admin gets an edit here.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { purgePhotosFor } from "@/lib/photos";
import { serializeCheckout } from "@/lib/serialize";
import {
  checkoutFor,
  deriveFuelOil,
  isCheckoutKind,
  isComplete,
  parseAnswers,
  parseValues,
} from "@/lib/checkouts";
import { attachCheckoutToSession } from "@/lib/flightSessions";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

/**
 * Load the run and check the caller may still change it.
 *
 * Returns either the row or the response to send instead, so both handlers
 * apply exactly the same three rules (exists / yours / still open) and can't
 * drift apart.
 */
async function openRunFor(id: string, userId: string) {
  const run = await prisma.checkout.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      aircraftId: true,
      kind: true,
      completedAt: true,
    },
  });
  if (!run) {
    return { error: NextResponse.json({ error: "That checkout is gone." }, { status: 404 }) };
  }
  if (run.userId !== userId) {
    return {
      error: NextResponse.json(
        { error: "That's someone else's checkout." },
        { status: 403 }
      ),
    };
  }
  if (run.completedAt) {
    return {
      error: NextResponse.json(
        { error: "That checkout has been signed off and can't be changed." },
        { status: 409 }
      ),
    };
  }
  return { run };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const found = await openRunFor(id, user.id);
  if (found.error) return found.error;
  const { run } = found;
  const aircraftId = run.aircraftId;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // The row's own kind decides which card the answers are parsed against — the
  // client doesn't get to relabel a runway run as a preflight one halfway
  // through and write the other card's ids into it.
  if (!isCheckoutKind(run.kind)) {
    return NextResponse.json({ error: "Unknown checkout kind." }, { status: 500 });
  }
  const kind = run.kind;

  const answers = parseAnswers(kind, body.answers);
  const values = parseValues(kind, body.values);
  const complete = body.complete === true;

  // Same rule as POST: an incomplete card may be completed, but only when the
  // client says the member confirmed it. See the comment there.
  if (complete && !isComplete(kind, answers) && body.acknowledgeIncomplete !== true) {
    return NextResponse.json(
      {
        error: `Every item has to be checked to complete the ${checkoutFor(
          kind
        ).title.toLowerCase()}, or the incomplete card has to be confirmed.`,
      },
      { status: 400 }
    );
  }

  // Same rule as POST: the columns Plane Status reads are derived from the
  // recorded values, never taken off the body.
  const { fuelOnBoardGal, oilQuarts } =
    kind === "PREFLIGHT"
      ? deriveFuelOil(values)
      : { fuelOnBoardGal: null, oilQuarts: null };

  const updated = await prisma.checkout.update({
    where: { id },
    data: {
      answers,
      values,
      fuelOnBoardGal,
      oilQuarts,
      notes: body.notes ? String(body.notes).trim() : null,
      completedAt: complete ? new Date() : null,
    },
    include: INCLUDE,
  });

  // Same rule as POST: signing off is what puts this card on a flight. See the
  // module comment on app/api/checkouts/route.ts.
  if (complete) {
    const flightId = await attachCheckoutToSession({
      checkoutId: updated.id,
      userId: user.id,
      aircraftId,
      kind,
      values,
    });
    if (flightId) updated.flightId = flightId;
  }

  return NextResponse.json(serializeCheckout(updated));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const found = await openRunFor(id, user.id);
  if (found.error) return found.error;

  // Photos taken during the run are cascaded away with it, so their bytes have
  // to go first or they'd sit in the bucket with nothing pointing at them.
  // Squawks filed from the run survive (checkoutId is SetNull) — the airplane
  // still has the fault whether or not the walk was finished.
  await purgePhotosFor({ checkoutId: id });
  await prisma.checkout.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
