// What a squawk's status MEANS — the one place that answers it.
//
// The club keeps a single Status column on its squawk sheet, so the app does
// too (prisma enum SquawkStatus). Everything downstream — the red grounded
// banner, the Plane Status cards, which squawks show on a checkout, whether the
// Squawks tab lets you edit a row — is derived from that one value here rather
// than re-deduced at each call site. Adding a status is: name it in the enum,
// give it a label + tone below, and decide which of the two predicates it
// satisfies. Nothing else should ever switch on a status string.
import type { BadgeTone } from "@/components/common/Badge";

export const SQUAWK_STATUS_LABELS = {
  NEW: "New",
  REVIEWED_OK_TO_FLY: "Reviewed — okay to fly",
  REVIEWED_IN_WORK: "Reviewed — in work",
  REVIEWED_GROUNDED: "Reviewed — aircraft grounded",
  CLOSED: "Closed",
} as const;

export type SquawkStatus = keyof typeof SQUAWK_STATUS_LABELS;

/** In the order an officer walks a squawk through. */
export const SQUAWK_STATUSES = Object.keys(SQUAWK_STATUS_LABELS) as SquawkStatus[];

/**
 * Short forms, for a badge in a narrow table cell. The long labels above are
 * what the picker and the detail view use — a phone column can't carry
 * "Reviewed — aircraft grounded" without wrapping to three lines.
 */
export const SQUAWK_STATUS_SHORT: Record<SquawkStatus, string> = {
  NEW: "New",
  REVIEWED_OK_TO_FLY: "Okay to fly",
  REVIEWED_IN_WORK: "In work",
  REVIEWED_GROUNDED: "Grounded",
  CLOSED: "Closed",
};

export const SQUAWK_STATUS_TONES: Record<SquawkStatus, BadgeTone> = {
  // Untriaged is not "fine" — it's unknown, and amber is the honest colour for
  // a squawk nobody qualified has looked at yet.
  NEW: "amber",
  REVIEWED_OK_TO_FLY: "green",
  REVIEWED_IN_WORK: "amber",
  REVIEWED_GROUNDED: "red",
  CLOSED: "gray",
};

/** What the officer had to say when they moved it here. */
export const SQUAWK_STATUS_HINTS: Record<SquawkStatus, string> = {
  NEW: "Filed by a member and waiting on the Safety Officer.",
  REVIEWED_OK_TO_FLY: "Looked at. The airplane flies with this as-is.",
  REVIEWED_IN_WORK: "Being fixed. The airplane is in maintenance.",
  REVIEWED_GROUNDED: "The airplane does not fly until this is signed off.",
  CLOSED: "Done with — off the working list.",
};

/**
 * Worst-first, for any list that doubles as "can we fly?".
 *
 * NOT the same as the enum's declaration order, and deliberately so: Postgres
 * sorts an enum column by declaration, which runs NEW → CLOSED and would put
 * the grounded squawks at the BOTTOM of the list. Anything ordering squawks
 * for a reader sorts by this instead.
 */
export const SQUAWK_TRIAGE_ORDER: SquawkStatus[] = [
  "REVIEWED_GROUNDED",
  "REVIEWED_IN_WORK",
  "NEW",
  "REVIEWED_OK_TO_FLY",
  "CLOSED",
];

/** Narrow an arbitrary string (a query param, a request body) to a status. */
export function isSquawkStatus(value: unknown): value is SquawkStatus {
  return typeof value === "string" && value in SQUAWK_STATUS_LABELS;
}

/**
 * Still on the working list. Everything except CLOSED — including
 * REVIEWED_OK_TO_FLY, which is reviewed but not fixed, and so is exactly the
 * kind of thing the next pilot should read before they walk out.
 */
export function isOpen(status: SquawkStatus): boolean {
  return status !== "CLOSED";
}

/** The airplane does not fly. The only status that stops dispatch. */
export function isGrounding(status: SquawkStatus): boolean {
  return status === "REVIEWED_GROUNDED";
}

/** The airplane is in the shop — worth saying, but not a stop-flying answer. */
export function isInMaintenance(status: SquawkStatus): boolean {
  return status === "REVIEWED_IN_WORK";
}

/** Waiting on triage: what the Safety Officer's tab should surface first. */
export function isAwaitingReview(status: SquawkStatus): boolean {
  return status === "NEW";
}
