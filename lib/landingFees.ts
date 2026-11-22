// What it costs to put the wheels down somewhere.
//
// The fees live in the club's own Airport table, edited from Club settings ›
// Airports by an admin (it started with KTOA at $6). The fee is a fact about
// an AIRPORT, not about this club, and most fields the airplane visits charge
// nothing, so it's a lookup rather than a constant. This file is the pure half:
// the table arrives as a plain map (`FeeTable`, built by `feeTableFrom`) and
// the forms get it through `useLandingFees` (components/useLandingFees.ts).
//
// This is deliberately only a DEFAULT. What the club actually bills is the
// number stored on the flight (`Flight.landingFeeCents`), because the fee is
// something the pilot was charged at a desk and not something the app can
// know: rates change, a waiver applies, the FBO forgets to collect. So the
// forms that file a flight open the box at this figure and let the pilot
// correct it — a prefill, never a stamp, the same rule the preflight oil hint
// and the W&B fuel box follow. Changing a fee in settings never restates a
// flight already filed.
//
// Per FLIGHT, not per landing. A pattern session with eight touch-and-goes is
// one visit as far as the desk is concerned, and multiplying by the landings
// count would quietly bill a member $48 for a lesson. If a field really does
// charge per landing, the pilot types what they paid.

import { parseDollars } from "./finance";

/** Airport identifier → the fee in whole cents (null = listed, no fee on file). */
export type FeeTable = Record<string, number | null>;

/** The table as a map, from the airport rows the API hands back. */
export function feeTableFrom(
  airports: { code: string; landingFeeCents: number | null }[]
): FeeTable {
  const table: FeeTable = {};
  for (const airport of airports) table[normalizeAirport(airport.code)] = airport.landingFeeCents;
  return table;
}

/**
 * What's wrong with an airport identifier typed into settings, or null.
 * The same loose shape the Landed at line accepts (lib/landingAirports.ts).
 */
export function airportCodeError(code: string): string | null {
  const key = normalizeAirport(code);
  if (!key) return "Enter the airport's identifier, like KTOA.";
  if (!/^[A-Z0-9]{3,5}$/.test(key)) {
    return `"${key}" doesn't look like an airport identifier — use codes like KTOA or L35.`;
  }
  return null;
}

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
export function landingFeeFor(
  airport: string | null | undefined,
  table: FeeTable
): number | null {
  const key = normalizeAirport(airport);
  if (!key) return null;
  return table[key] ?? null;
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
export function landingFeeInputFor(
  airport: string | null | undefined,
  table: FeeTable
): string {
  const cents = landingFeeFor(airport, table);
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/**
 * A fee off a request body, in cents: null for an empty box, a refusal for a
 * negative or unreadable one. Zero is kept — "this field charges nothing".
 */
export function feeFromBody(body: Record<string, unknown>): number | null | "invalid" {
  const raw = body.landingFeeDollars;
  if (raw === null || raw === undefined || raw === "") return null;
  const cents = parseDollars(raw);
  if (cents == null || cents < 0) return "invalid";
  return cents;
}
