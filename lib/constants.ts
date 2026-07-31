// App-wide labels and tunables. Anything a club might want to change without
// touching a page lives here.

import type { BadgeTone } from "@/components/common/Badge";

// The club's name, used on the splash, the login card, and the manifest.
export const CLUB_NAME = "VFF Flying Club";
export const CLUB_SHORT_NAME = "VFF";

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

// Squawk severity (Prisma enum SquawkSeverity).
export const SEVERITY_LABELS = {
  NOTE: "Note",
  MONITOR: "Monitor",
  GROUNDING: "Grounding",
} as const;

export type Severity = keyof typeof SEVERITY_LABELS;

export const SEVERITIES = Object.keys(SEVERITY_LABELS) as Severity[];

export const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  NOTE: "gray",
  MONITOR: "amber",
  GROUNDING: "red",
};

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
