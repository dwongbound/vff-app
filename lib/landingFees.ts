// What it costs to put the wheels down somewhere.
//
// A TABLE rather than a single constant, even though the club only knows one
// number today. The fee is a fact about an AIRPORT, not about this club — KTOA
// charges $6, Catalina charges considerably more, and most fields the airplane
// visits charge nothing at all. Writing it as a lookup means the second entry
// is a line of data rather than a refactor of every call site.
//
// This is deliberately only a DEFAULT. What the club actually bills is the
// number stored on the flight (`Flight.landingFeeCents`), because the fee is
// something the pilot was charged at a desk and not something the app can
// know: rates change, a waiver applies, the FBO forgets to collect. So the two
// forms that file a flight open the box at this figure and let the pilot
// correct it — a prefill, never a stamp, the same rule the preflight oil hint
// and the W&B fuel box follow.
//
// Per FLIGHT, not per landing. A pattern session with eight touch-and-goes is
// one visit as far as the desk is concerned, and multiplying by the landings
// count would quietly bill a member $48 for a lesson. If a field really does
// charge per landing, the pilot types what they paid.

/** Airport identifier → the fee in whole cents. */
export const LANDING_FEES_CENTS: Record<string, number> = {
  // Zamperini Field, Torrance — the club's home base.
  KTOA: 600,
};

/**
 * Normalise an airport identifier the way the flight API stores one: trimmed
 * and upper-case, so "ktoa " off a phone keyboard finds the same row as "KTOA".
 */
export function normalizeAirport(airport: string | null | undefined): string {
  return (airport ?? "").trim().toUpperCase();
}

/**
 * The landing fee for an airport, or null when there isn't one to prefill.
 *
 * Null rather than 0 on purpose, and the distinction is the whole reason a
 * caller can trust this: 0 would mean "this field is free", which is a claim
 * about the airport. Null means "nothing to prefill" — which covers both an
 * unknown identifier and an empty box, and leaves the pilot's own figure alone.
 */
export function landingFeeFor(airport: string | null | undefined): number | null {
  const key = normalizeAirport(airport);
  if (!key) return null;
  return LANDING_FEES_CENTS[key] ?? null;
}

/**
 * The prefill for the fee box, in DOLLARS as a form string — "6.00", or "" when
 * the airport has no fee on file.
 *
 * Lives here rather than in the two pages so they can't drift: the post-flight
 * form and the by-hand entry modal have to agree about what lands in the box,
 * and a member who files the same flight two ways should be billed once, the
 * same amount, either way.
 */
export function landingFeeInputFor(airport: string | null | undefined): string {
  const cents = landingFeeFor(airport);
  return cents == null ? "" : (cents / 100).toFixed(2);
}
