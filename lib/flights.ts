// What each flight query pulls out of the database.
//
// In lib/ rather than beside the routes because three of them need these and a
// `route.ts` may only export Next's own handlers — the same reason
// MEMBER_SELECT lives in lib/members.ts.
//
// The split is the point. A log ROW shows a date, meters, a pilot, and two
// badges ("has photos", "has an open squawk"); it never shows the photos or
// the squawks themselves. Loading them anyway meant `GET /api/flights?limit=300`
// — which Plane Status and Preflight both issue — carried every photo record,
// every squawk, every squawk's photos and two user objects per squawk, to draw
// a utilisation chart and read one tach reading. The counts answer the badges
// at a fraction of the size, and the objects come from the detail endpoint the
// modal calls when a member actually opens an entry.

/** Everything a log ROW draws, with photos and squawks counted, not loaded. */
export const FLIGHT_LIST_SELECT = {
  aircraft: { select: { id: true, tailNumber: true } },
  pilot: { select: { id: true, name: true, email: true } },
  instructor: { select: { id: true, name: true, email: true } },
  signedBy: { select: { id: true, name: true, email: true } },
  _count: {
    select: {
      photos: true,
      // Only the OPEN ones — the badge asks whether this entry still has
      // something wrong hanging off it, not how many it ever had. Kept in step
      // with lib/squawks.ts `isOpen`, which is the same rule in TypeScript.
      squawks: { where: { status: { not: "CLOSED" as const } } },
    },
  },
} as const;

/** The same flight with everything attached — GET /api/flights/[id]. */
export const FLIGHT_DETAIL_INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  pilot: { select: { id: true, name: true, email: true } },
  instructor: { select: { id: true, name: true, email: true } },
  signedBy: { select: { id: true, name: true, email: true } },
  photos: true,
  squawks: {
    include: {
      reportedBy: { select: { id: true, name: true, email: true } },
      resolvedBy: { select: { id: true, name: true, email: true } },
      photos: true,
    },
  },
} as const;

// ── Money off a request body ───────────────────────────────────────────────
//
// Both flight routes read these two amounts, and both accept EITHER spelling:
// the forms send dollars (that's what the receipt and the landing desk say)
// while the columns store whole cents. Shared here rather than written twice
// because they were written twice, and drifted — POST took `fuelCostDollars`
// while PATCH only ever looked at `fuelCostCents`, so correcting a fuel receipt
// from a form that sent dollars silently changed nothing.

/** A finite number, or null for "" / null / undefined / not a number. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read an amount that may arrive in cents or in dollars.
 *
 * Cents wins when both are present: it's the exact one, and a client sending
 * both has already made the decision. Deliberately plain branches rather than a
 * chain of ternaries — there are three answers here (cents, dollars, nothing)
 * and a reader should be able to see all three at once.
 */
function moneyFrom(
  body: Record<string, unknown>,
  centsKey: string,
  dollarsKey: string
): number | null {
  const cents = toNumber(body[centsKey]);
  if (cents !== null) return Math.round(cents);

  const dollars = toNumber(body[dollarsKey]);
  if (dollars !== null) return Math.round(dollars * 100);

  return null;
}

/** Was this amount mentioned at all? A PATCH only touches what it names. */
export function mentionsLandingFee(body: Record<string, unknown>): boolean {
  return "landingFeeCents" in body || "landingFeeDollars" in body;
}

/** What the pilot paid for fuel, in whole cents. */
export function fuelCostCentsFrom(body: Record<string, unknown>): number | null {
  return moneyFrom(body, "fuelCostCents", "fuelCostDollars");
}

/**
 * What the field charged to land, in whole cents.
 *
 * A negative fee is refused rather than clamped to zero — the club does not pay
 * you to land somewhere, so a minus sign is a typo, and quietly turning it into
 * a credit is the one rounding a member would never notice. A recorded ZERO is
 * kept: "they waived it" is a real answer, and it is not the same as leaving
 * the box empty.
 */
export function landingFeeCentsFrom(body: Record<string, unknown>): number | null {
  const cents = moneyFrom(body, "landingFeeCents", "landingFeeDollars");
  if (cents === null) return null;
  if (cents < 0) return null;
  return cents;
}
