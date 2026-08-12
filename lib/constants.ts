// App-wide labels and tunables. Anything a club might want to change without
// touching a page lives here.

import type { BadgeTone } from "@/components/common/Badge";

// The club's name, used on the splash, the login card, and the manifest.
export const CLUB_NAME = "VFF Flying Club";
export const CLUB_SHORT_NAME = "VFF";

/**
 * The club's home timezone — where the airplane physically is.
 *
 * The SERVER already runs in this zone (APP_TZ, copied onto TZ by
 * instrumentation.ts), so anything rendered from a stored instant is in club
 * time already. This constant is for the other direction: a clock reading
 * being written DOWN in the browser, which would otherwise come out in
 * whatever zone the member's phone happens to be set to. A time written on
 * N8318B's card means field time at KTOA, not the time in the seat 30,000 ft
 * above it, so those readings are stamped from here rather than from the
 * device. See `clubTimeNow` in lib/dates.ts.
 */
export const CLUB_TIME_ZONE = "America/Los_Angeles";

// What a member is doing with the airplane (Prisma enum ReservationPurpose).
export const PURPOSE_LABELS = {
  LOCAL: "Local flight",
  CROSS_COUNTRY: "Cross-country",
  TRAINING: "Training (with CFI)",
  CHECKRIDE: "Checkride",
  MAINTENANCE: "Maintenance",
} as const;

export type Purpose = keyof typeof PURPOSE_LABELS;

export const PURPOSES = Object.keys(PURPOSE_LABELS) as Purpose[];

// Calendar chip / list accent per purpose. Maintenance reads amber so a shop
// block is obviously not someone's flight.
export const PURPOSE_TONES: Record<Purpose, BadgeTone> = {
  LOCAL: "indigo",
  CROSS_COUNTRY: "blue",
  TRAINING: "green",
  CHECKRIDE: "gray",
  MAINTENANCE: "amber",
};

// Squawk status labels/tones used to live here, next to the other enums. They
// moved to lib/squawks.ts when severity and status collapsed into one value:
// that file also has to answer "is this grounding / in work / still open", and
// a label table split from the predicates that read it is how the two drift.

// Longest single booking, and how far ahead members may book. Both are club
// policy rather than physics — change them here.
export const MAX_RESERVATION_HOURS = 12;
export const MAX_ADVANCE_DAYS = 180;

// Default booking length the new-reservation form opens with.
export const DEFAULT_RESERVATION_HOURS = 2;

// Flight review currency: good through the last day of the 24th calendar month
// after the review (14 CFR 61.56).
export const FLIGHT_REVIEW_MONTHS = 24;

// Photo uploads. 12 MB covers a modern phone photo without letting someone
// push a video through the image endpoint.
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
