// The database half of lib/flightSession.ts: finding a member's open session,
// opening one from a signed-off card, and closing one out.
//
// In lib/ rather than beside the routes because three of them need it and a
// `route.ts` may only export Next's own handlers — the same reason
// lib/instructors.ts and lib/checkoutCleanup.ts live here.
//
// The invariant everything below holds: A MEMBER HAS AT MOST ONE OPEN SESSION
// PER AIRPLANE. It's the same shape as the "at most one open run per card"
// invariant the checkout cleanup keeps, and for the same reason — the moment
// there can be two, every sign-off has to pick one, and picking is a coin flip
// nobody can see happening.
import { prisma } from "./prisma";
import {
  SESSION_WINDOW_HOURS,
  cardDay,
  endFromTurnoff,
  resolveTimes,
  startFromPreflight,
  startFromRunway,
} from "./flightSession";
import type { Values } from "./checkouts";
import type { CheckoutKind } from "./checkouts";

/** The columns a session lookup returns — everything the callers prefill from. */
export const SESSION_SELECT = {
  id: true,
  userId: true,
  aircraftId: true,
  flownOn: true,
  filedAt: true,
  tachStart: true,
  tachEnd: true,
  hobbsStart: true,
  hobbsEnd: true,
  startedAt: true,
  endedAt: true,
  reservationId: true,
  createdAt: true,
} as const;

/** One open session, as every caller of this module sees it. */
export interface OpenSession {
  id: string;
  userId: string;
  aircraftId: string;
  flownOn: Date;
  filedAt: Date | null;
  tachStart: number | null;
  tachEnd: number | null;
  hobbsStart: number | null;
  hobbsEnd: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  reservationId: string | null;
  createdAt: Date;
}

/**
 * The session this member currently has open on this airplane, if any.
 *
 * Bounded by `SESSION_WINDOW_HOURS` in the QUERY rather than filtered after it,
 * so a member who walked a card three weeks ago and never flew doesn't have
 * that row handed back to today's flight. An older open session is left exactly
 * where it is — it's a real record of a walk that happened, and the flight log
 * shows it as unfinished until somebody closes it out or deletes it.
 */
export async function findOpenSession(args: {
  userId: string;
  aircraftId: string;
  now?: Date;
}): Promise<OpenSession | null> {
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - SESSION_WINDOW_HOURS * 3_600_000);

  return prisma.flight.findFirst({
    where: {
      userId: args.userId,
      aircraftId: args.aircraftId,
      filedAt: null,
      createdAt: { gte: since },
    },
    select: SESSION_SELECT,
    // Newest first: if two ever existed, the one being flown now is the one
    // that was opened last.
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Advance the airplane's last-known meters, never backwards.
 *
 * Called when a flight is FILED and at no other time — see the note in
 * `attachCheckoutToSession` for why a preflight walk deliberately doesn't move
 * them, even though it reads the panel. The `>` guard is what makes this safe:
 * filing an old flight late, or fixing a typo downwards, can't wind the
 * airplane back.
 */
export async function advanceMeters(args: {
  aircraftId: string;
  tach?: number | null;
  hobbs?: number | null;
}) {
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: args.aircraftId },
    select: { lastTach: true, lastHobbs: true },
  });
  if (!aircraft) return;

  const update: { lastTach?: number; lastHobbs?: number } = {};
  if (args.tach != null && (aircraft.lastTach == null || args.tach > aircraft.lastTach)) {
    update.lastTach = args.tach;
  }
  if (
    args.hobbs != null &&
    (aircraft.lastHobbs == null || args.hobbs > aircraft.lastHobbs)
  ) {
    update.lastHobbs = args.hobbs;
  }
  if (Object.keys(update).length === 0) return;

  await prisma.aircraft.update({ where: { id: args.aircraftId }, data: update });
}

/**
 * Sign-off of a before-the-flight card: open a session, or join the one that's
 * already open, and hang the card off it.
 *
 * This is the whole "no matter what, a checkout updates the flight log" rule,
 * in one function, called from both the POST and the PATCH that can complete a
 * run. What it returns is the session's id, which the page shows as a link into
 * the log.
 *
 *   PREFLIGHT with nothing open → open one, with the meters and the clock the
 *                                 walk just read.
 *   PREFLIGHT with one open     → join it, and FILL IN anything it is still
 *                                 missing. Overwriting what's there would let a
 *                                 second walk of the same card quietly restate
 *                                 the start of a flight already under way. A
 *                                 member who really did mis-read the panel
 *                                 corrects it where corrections belong: the
 *                                 post-flight form's start box, or the log
 *                                 entry itself.
 *   RUNWAY with nothing open    → open one anyway. Skipping the preflight card
 *                                 is a thing members do, and the flight still
 *                                 wants a row; it just starts with no meters.
 *   RUNWAY with one open        → join it, and take the flight timer's start
 *                                 time, which is a truer "off" than the
 *                                 preflight's reading at the wing.
 */
export async function attachCheckoutToSession(args: {
  checkoutId: string;
  userId: string;
  aircraftId: string;
  kind: CheckoutKind;
  values: Values;
  now?: Date;
}): Promise<string | null> {
  if (args.kind !== "PREFLIGHT" && args.kind !== "RUNWAY") return null;

  const now = args.now ?? new Date();
  const day = cardDay(now);
  const existing = await findOpenSession({
    userId: args.userId,
    aircraftId: args.aircraftId,
    now,
  });

  const start =
    args.kind === "PREFLIGHT"
      ? startFromPreflight(args.values, day)
      : { ...startFromRunway(args.values, day), tachStart: null, hobbsStart: null };

  let flightId: string;

  if (existing) {
    // Fill the gaps only — except for the runway card's timer, which is
    // allowed to replace the preflight's clock reading because it is the same
    // fact measured better. See the header comment.
    const data: Record<string, unknown> = {};
    if (existing.tachStart == null && start.tachStart != null) {
      data.tachStart = start.tachStart;
    }
    if (existing.hobbsStart == null && start.hobbsStart != null) {
      data.hobbsStart = start.hobbsStart;
    }
    if (start.startedAt != null) {
      const better = args.kind === "RUNWAY" || existing.startedAt == null;
      if (better) data.startedAt = start.startedAt;
    }
    if (Object.keys(data).length > 0) {
      await prisma.flight.update({ where: { id: existing.id }, data });
    }
    flightId = existing.id;
  } else {
    const created = await prisma.flight.create({
      data: {
        aircraftId: args.aircraftId,
        userId: args.userId,
        // Local midday, the same convention the post-flight form files with:
        // a date-only field stored at noon can't be dragged into the previous
        // day by a timezone.
        flownOn: middayOn(now),
        filedAt: null,
        // `?? undefined`, not the null itself: Prisma's create input takes
        // "leave it out" rather than "write NULL" for a nullable column, and
        // the two spellings are the same row.
        tachStart: start.tachStart ?? undefined,
        hobbsStart: start.hobbsStart ?? undefined,
        startedAt: start.startedAt ?? undefined,
      },
      select: { id: true },
    });
    flightId = created.id;
  }

  await prisma.checkout.update({
    where: { id: args.checkoutId },
    data: { flightId },
  });

  // Deliberately NOT advancing the airplane's stored meters from a preflight
  // reading. It's tempting — a start reading above `lastTach` means somebody
  // flew and didn't file, which the club would like to know — but the airplane
  // hasn't flown yet, and a fat-fingered 15070.5 on one member's card would
  // become every other member's prefill with nothing to catch it. The
  // disagreement is worth SHOWING, not adopting: the post-flight form's meter
  // hints already name which reading a box came from, and only a FILED flight
  // moves the airplane (see `advanceMeters`, called from the flights route).
  return flightId;
}

/** Local midday of the day `at` falls on — the club's date-only convention. */
function middayOn(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12, 0, 0, 0);
}

/**
 * The end of the flight, off the turn-off card, ready to write.
 *
 * Split out from the route so the same three readings are pulled from the same
 * three fields whether the flight is being filed for the first time or
 * corrected afterwards.
 */
export function endOfSession(turnoffValues: Values, flownOn: Date) {
  return endFromTurnoff(turnoffValues, cardDay(flownOn));
}

/** `resolveTimes`, re-exported so routes need only this module. */
export { resolveTimes };
