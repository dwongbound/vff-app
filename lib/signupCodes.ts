// Sign-up codes: the club's front door.
//
// This file is the pure half — normalising what someone typed, deciding what a
// code is worth, and saying what KIND of account each list produces. The
// database work is in app/api/signup-codes (admins managing the lists) and
// app/api/signup (redeeming one).
//
// The shape of the rule matters more than the code format: a code names a
// LIST, and the list decides what the new account is. The applicant types a
// string and gets whatever that string is worth — they never choose between
// "member" and "instructor" on the form, because a stranger picking their own
// account type is the entire control defeated.
import type { Position } from "./positions";

/** Which list a code came off. Mirrors the Prisma enum SignupCodeKind. */
export const SIGNUP_CODE_KIND_LABELS = {
  MEMBER: "Member",
  INSTRUCTOR: "Instructor (CFI)",
} as const;

export type SignupCodeKind = keyof typeof SIGNUP_CODE_KIND_LABELS;

export const SIGNUP_CODE_KINDS = Object.keys(
  SIGNUP_CODE_KIND_LABELS
) as SignupCodeKind[];

/** What each list is for, shown above it on the settings panel. */
export const SIGNUP_CODE_KIND_BLURBS: Record<SignupCodeKind, string> = {
  MEMBER:
    "Creates a full flying member: books the airplane, files flights, gets a monthly statement.",
  INSTRUCTOR:
    "Creates a CFI account: reads the schedule, signs training flights, and is not billed. Promote one to a flying member from the Members tab.",
};

/**
 * The same code however it was typed.
 *
 * Upper-cased and stripped of ALL whitespace, because a code gets read down a
 * phone or copied out of an email with a line break through the middle of it,
 * and "vff 2026" failing where "VFF2026" works is the club's problem to absorb
 * rather than the applicant's to debug. Internal punctuation is kept: a dash
 * is something the admin chose to put there and is part of the code.
 *
 * Stored normalised as well as compared normalised, so `@unique` on the column
 * means what it looks like it means — otherwise "vff2026" and "VFF2026" are two
 * rows, and retiring one of them does nothing.
 */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Longest a code may be. Long enough for a passphrase, short enough to read out. */
export const MAX_SIGNUP_CODE_LENGTH = 64;

/** Shortest. Four characters is already 1.6M combinations of the charset below. */
export const MIN_SIGNUP_CODE_LENGTH = 4;

/**
 * Why an admin's new code can't be used, or null when it's fine.
 *
 * Deliberately restrictive about the charset: a code is retyped from a piece of
 * paper by someone who has never seen it before, so anything that looks like
 * something else in a different font is a support call. Letters, digits, dash
 * and underscore only.
 */
export function signupCodeError(raw: unknown): string | null {
  const code = normalizeCode(raw);
  if (!code) return "Enter a code.";
  if (code.length < MIN_SIGNUP_CODE_LENGTH) {
    return `Use at least ${MIN_SIGNUP_CODE_LENGTH} characters.`;
  }
  if (code.length > MAX_SIGNUP_CODE_LENGTH) {
    return `Keep it under ${MAX_SIGNUP_CODE_LENGTH} characters.`;
  }
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return "Letters, numbers, dashes and underscores only.";
  }
  return null;
}

/** Narrow whatever arrived in a request body to a code kind. MEMBER by default. */
export function parseSignupCodeKind(raw: unknown): SignupCodeKind {
  return typeof raw === "string" && raw in SIGNUP_CODE_KIND_LABELS
    ? (raw as SignupCodeKind)
    : "MEMBER";
}

/** What a redeemed code turns into on the new User row. */
export interface NewAccountShape {
  positions: Position[];
  clubMember: boolean;
}

/**
 * The account a code of this kind creates.
 *
 * The ONE place the two ideas are tied together, so "what does an instructor
 * account look like" has a single answer that the sign-up route, the seed and
 * the tests all read rather than each restating.
 *
 * Note an INSTRUCTOR account is `clubMember: false` — it teaches here without
 * flying here. An admin flips that from the Members tab for a CFI who is also
 * a member, which is a different fact about the same person and is why it isn't
 * baked into the code's meaning.
 */
export function accountFromCodeKind(kind: SignupCodeKind): NewAccountShape {
  return kind === "INSTRUCTOR"
    ? { positions: ["INSTRUCTOR"], clubMember: false }
    : { positions: [], clubMember: true };
}

/**
 * Does this sign-up need a code?
 *
 * No, and only, when the club has no accounts at all. A fresh install has
 * nobody who could have created a code, so requiring one would lock the first
 * admin out of their own club with no way in short of editing the database by
 * hand. That first account becomes the admin (see app/api/signup), who then
 * creates the codes everyone after them types.
 *
 * Every later sign-up needs one, INCLUDING at a club that has members but has
 * never created a code — that club is simply closed to new accounts until an
 * admin opens it, which is the correct reading of "no codes exist".
 */
export function signupCodeRequired(memberCount: number): boolean {
  return memberCount > 0;
}

/** A code row, as much of it as the redemption rules care about. */
export interface RedeemableCode {
  code: string;
  kind: SignupCodeKind;
  active: boolean;
}

/**
 * Why this code won't let someone in, or null when it will.
 *
 * Retired and unrecognised codes deliberately give the SAME message. Telling a
 * stranger "that code exists but is switched off" confirms they guessed a real
 * one, and the difference is no use to the honest applicant either — both mean
 * "ask the club for a current code".
 */
export function redemptionError(
  code: RedeemableCode | null | undefined
): string | null {
  if (!code || !code.active) {
    return "That sign-up code isn't valid. Ask the club for a current one.";
  }
  return null;
}
