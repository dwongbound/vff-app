// The database half of checkout autosave: keeping unfinished runs from piling
// up.
//
// This exists because autosave changed the economics of an open Checkout row.
// It used to take a deliberate press of a Save button to create one, so there
// were few and each was something a member had chosen to keep. Now a row
// appears a couple of seconds after the first tick, for every walk anyone
// starts — including the ones abandoned thirty seconds later because the
// airplane was already booked. Left alone, `Checkout` would fill with runs
// nothing will ever read.
//
// Two rules keep it bounded, and between them the table looks after itself
// without a cron job the club would have to run:
//
//   1. ONE open run per member, per airplane, per card. Enforced when a new
//      draft is created — a second one can only mean the first was superseded.
//      This is a HARD bound: (members × aircraft × 2) open rows, which for this
//      club is a couple of dozen.
//   2. Abandoned runs are swept by age, on the query that goes looking for a
//      run to resume. Nobody picks up last Tuesday's walkaround, and a stale
//      row that survives rule 1 would otherwise sit there offering to resume
//      itself forever.
//
// Sweeping inside a read is a pattern this codebase already uses deliberately —
// see the finances routes, where reading a month is what materialises its dues.
// The same reasoning applies: the read happens exactly when the answer matters,
// which is why the club needs no scheduled job.
//
// In lib/ rather than beside the route because both handlers need it and a
// `route.ts` may only export Next's own handlers.
import { prisma } from "./prisma";
import { purgePhotosFor } from "./photos";
import { ABANDONED_DRAFT_MS } from "./checkoutDraft";

/** The kinds that get a row of their own. TURNOFF lives on Flight. */
type StoredKind = "PREFLIGHT" | "RUNWAY";

/**
 * Delete these runs, taking their stored photo bytes with them.
 *
 * Photos cascade in the database but not in object storage, so the bytes have
 * to go first or they'd sit in the bucket with nothing pointing at them —
 * exactly what `purgePhotosFor` exists to prevent. Squawks filed from a run
 * survive by design (`checkoutId` is SetNull): the airplane still has the fault
 * whether or not the walk that found it was ever finished.
 */
async function discardRuns(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  // Sequential rather than Promise.all: this is a handful of rows at most, and
  // each purge is itself a fan-out of storage deletes.
  //
  // Wrapped, because the sweep half of this file runs inside a GET that the
  // checkout pages fire on every load. `purgePhotosFor` reaches for
  // `getStorage()`, which THROWS on a deployment with photos switched off — and
  // housekeeping must never be able to turn "open the preflight page" into a
  // 500. A stray object in the bucket is the failure we accept here; it's the
  // same trade `purgePhotosFor` already makes internally per object.
  for (const id of ids) {
    try {
      await purgePhotosFor({ checkoutId: id });
    } catch (error) {
      console.error(`[checkouts] could not purge photos for ${id}`, error);
    }
  }
  const { count } = await prisma.checkout.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/**
 * Rule 1 — make room for a new draft by discarding the member's older ones.
 *
 * Called when a member starts a fresh run of a card they already had one open
 * for. That happens legitimately: they reset on one device and started again on
 * another, or their device's draft lost its server id and the client is
 * re-creating it (see `resolveResume`). Either way the older row is a walk
 * nobody is looking at, and keeping it would mean the next resume had to choose
 * between two.
 *
 * Only ever the CALLER'S OWN runs, and only the same airplane and card.
 */
export async function supersedeOpenRuns({
  userId,
  aircraftId,
  kind,
}: {
  userId: string;
  aircraftId: string;
  kind: StoredKind;
}): Promise<number> {
  const stale = await prisma.checkout.findMany({
    where: { userId, aircraftId, kind, completedAt: null },
    select: { id: true },
  });
  return discardRuns(stale.map((row) => row.id));
}

/**
 * Rule 2 — discard the caller's runs that have been sitting open too long.
 *
 * The cutoff is shared with the device's own sweep (ABANDONED_DRAFT_DAYS in
 * lib/checkoutDraft.ts) and that is the point of exporting it from there: if
 * the two halves disagreed, one store would keep offering to resume a walk the
 * other had already thrown away.
 *
 * Scoped to the caller for the same reason `supersedeOpenRuns` is. Deleting
 * another member's draft as a side effect of loading your own page would be a
 * surprise at best and a race at worst — and everyone's page runs this, so
 * every member's stale runs still get swept, just by their own owner.
 */
export async function sweepAbandonedRuns({
  userId,
  now = new Date(),
}: {
  userId: string;
  now?: Date;
}): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_DRAFT_MS);
  const stale = await prisma.checkout.findMany({
    // `updatedAt`, not `createdAt`: a walk that was picked up and added to
    // yesterday is three days old by one measure and one day idle by the
    // other, and it's idleness that makes a draft abandoned.
    where: { userId, completedAt: null, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  return discardRuns(stale.map((row) => row.id));
}
