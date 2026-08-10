// The instructor's signature on a flight-log entry.
//
// A CFI signing a lesson off is the club's paper endorsement moved into the
// app, and the thing that makes it worth anything is that it names a version:
// an entry edited AFTER it was signed is not the entry the instructor read.
// Everything here exists to make that comparison, and the states below are the
// only vocabulary the UI uses for it.
//
// The db half is app/api/flights/[id]/sign; this file is the rules, and is
// what the unit tests exercise.
import type { BadgeTone } from "@/components/common/Badge";

/** Where one entry stands with its instructor. */
export type SignatureState =
  /** Nobody is expected to sign this — it isn't a training flight. */
  | "NOT_APPLICABLE"
  /** An instructor is named and hasn't signed yet. */
  | "AWAITING"
  /** Signed, and untouched since. */
  | "SIGNED"
  /**
   * Signed, and then the entry was corrected.
   *
   * Not an error and not something the app blocks — a pilot fixing a tach digit
   * a week later is doing the right thing. But the signature no longer covers
   * what's on screen, and a reader comparing the two dates is entitled to know
   * that without doing the arithmetic themselves.
   */
  | "SIGNED_THEN_EDITED";

/**
 * How each state reads, and its colour. Kept next to the states themselves for
 * the same reason lib/squawks.ts holds the squawk tones: a label table living
 * apart from the predicate that produces it is how the two drift.
 */
export const SIGNATURE_LABELS: Record<SignatureState, string> = {
  NOT_APPLICABLE: "No instructor",
  AWAITING: "Awaiting signature",
  SIGNED: "Signed",
  SIGNED_THEN_EDITED: "Signed, then edited",
};

export const SIGNATURE_TONES: Record<SignatureState, BadgeTone> = {
  NOT_APPLICABLE: "gray",
  AWAITING: "amber",
  SIGNED: "green",
  // Amber, not red: a corrected entry is somebody doing the right thing, and
  // the club needs to look at it, not to treat it as a failure.
  SIGNED_THEN_EDITED: "amber",
};

/**
 * As much of a flight as the signature rules need.
 *
 * The CFI is accepted in either of the two shapes this app already has for
 * them — `instructorId` on a database row, `instructor` on the wire — so one
 * set of rules serves the API route and the pages without either side
 * reshaping a flight before it can ask a question about it.
 */
export interface SignableFlight {
  /** The CFI expected to sign, as a database row spells it. */
  instructorId?: string | null;
  /** The same, as ApiFlight spells it. */
  instructor?: { id: string } | null;
  signedAt: Date | string | null;
  /** When the entry's content was last corrected; null = never. */
  editedAt: Date | string | null;
}

/** Whichever way this caller spells the instructor. */
function instructorOf(flight: SignableFlight): string | null {
  return flight.instructorId ?? flight.instructor?.id ?? null;
}

/** Dates cross the wire as ISO strings and come out of Prisma as Dates. */
function at(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Where this entry stands.
 *
 * A flight with no instructor named is NOT_APPLICABLE even if it was flown
 * with one: `withInstructor` is the pilot's assertion for the operating rules,
 * and nobody can be waiting on a signature from a person the entry doesn't
 * name.
 */
export function signatureState(flight: SignableFlight): SignatureState {
  if (!instructorOf(flight)) return "NOT_APPLICABLE";
  const signed = at(flight.signedAt);
  if (signed == null) return "AWAITING";
  const edited = at(flight.editedAt);
  return edited != null && edited > signed ? "SIGNED_THEN_EDITED" : "SIGNED";
}

/** Is this entry waiting on somebody's signature? */
export function isAwaitingSignature(flight: SignableFlight): boolean {
  return signatureState(flight) === "AWAITING";
}

/** Is this entry waiting on THIS person's signature? */
export function isAwaitingSignatureFrom(
  flight: SignableFlight,
  userId: string
): boolean {
  return instructorOf(flight) === userId && isAwaitingSignature(flight);
}

/**
 * Why this person can't sign this entry, or null when they can.
 *
 * The rule is deliberately narrow: the instructor NAMED on the entry signs it,
 * and nobody else — not another CFI, and not an admin. A signature that any
 * officer could apply on someone's behalf is not a signature, it's a status
 * flag with a person's name printed next to it, and the club would be relying
 * on it for exactly the endorsements where that distinction matters.
 *
 * Admins are not exempted here even though they hold every capability
 * elsewhere in the app, which is the single deliberate exception to the rule in
 * lib/positions.ts. The reason that rule exists — the club must never be
 * blocked by one member being away — doesn't apply: a signature nobody is
 * available to give is supposed to stay ungiven.
 */
export function signatureError(
  flight: SignableFlight,
  signer: { id: string }
): string | null {
  const instructorId = instructorOf(flight);
  if (!instructorId) {
    return "That flight has no instructor on it to sign for.";
  }
  if (instructorId !== signer.id) {
    return "Only the instructor named on the flight can sign it.";
  }
  if (at(flight.signedAt) != null) {
    return "That flight is already signed.";
  }
  return null;
}

/** Why this person can't WITHDRAW their signature, or null when they can. */
export function unsignError(
  flight: SignableFlight,
  signer: { id: string }
): string | null {
  if (at(flight.signedAt) == null) return "That flight isn't signed.";
  if (instructorOf(flight) !== signer.id) {
    return "Only the instructor named on the flight can withdraw a signature.";
  }
  return null;
}
