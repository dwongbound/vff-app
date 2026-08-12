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
