// Idempotency keys: how a retried submission is recognised as one the club has
// already handled.
//
// The failure this exists for is the LOST REPLY. A member presses File at the
// tail, the request reaches the club and the flight is written, and the answer
// never makes it back — the phone dropped off the clubhouse wifi a second too
// early. From the device's side that is indistinguishable from a request that
// never arrived, so the outbox (lib/outbox.ts) sends it again. Without a key the
// second copy is a second flight: the first one closed the open session, so the
// retry finds nothing open and inserts.
//
// The device mints one key per SUBMISSION (not per attempt) and sends it with
// every retry; each create route stores it in a unique `clientRequestId` column
// and, on seeing it again, returns the row it already wrote instead of writing
// another. A key from a client that predates the outbox is simply absent, and
// the routes behave exactly as they always did.

/**
 * The key off a request body, or null for anything that isn't one.
 *
 * Deliberately strict — it ends up in a unique index, so junk here is a
 * collision waiting to happen rather than a harmless extra field. A UUID (what
 * the outbox mints) is 36 characters of hex and dashes; the bounds leave room
 * for the fallback generator's shape without accepting a paragraph.
 */
export function requestIdFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]{8,100}$/.test(value) ? value : null;
}

/**
 * Prisma's unique-constraint error, for the one race the up-front lookup can't
 * close: two copies of the same request arriving together, both finding no row
 * and both trying to insert it. The loser lands here and re-reads the winner's.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
