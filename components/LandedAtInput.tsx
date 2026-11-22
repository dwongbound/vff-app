"use client";
// "Landed at" — every field landed at, in order, on the forms that also keep
// a Landings count (post-flight, add flight, edit flight). The Quick Log box
// is the same idea with no count beside it.
//
// The line is optional. Filled in, it's what the club's landings-by-airport
// report counts (the landing-fee reimbursement claim), and the form copies its
// count into Landings and its last field into To, so the pilot types the
// route once. Left empty, the count and To are whatever the pilot typed, and
// the report counts those landings as "assumed" at the arrival field.
import Input from "@/components/common/Input";
import {
  landingAirportsError,
  parseLandingAirports,
  type LandingAirports,
} from "@/lib/landingAirports";

export default function LandedAtInput({
  value,
  onChange,
  hint,
}: {
  value: string;
  /** The new text, and what it parses to (null while it has a bad token). */
  onChange: (value: string, parsed: LandingAirports | null) => void;
  /** Shown while the box is empty, in place of the default. */
  hint?: string;
}) {
  const error = landingAirportsError(value);
  const parsed = parseLandingAirports(value);

  /** The line under the box: an empty-box prompt, or the list counted back. */
  function hintText(): string {
    if (parsed.landings === 0) {
      return hint ?? "Every field you landed at, in order — fills in Landings and To";
    }
    const plural = parsed.landings === 1 ? "landing" : "landings";
    return `${parsed.landings} ${plural} · ends at ${parsed.arrival}`;
  }

  return (
    <Input
      label="Landed at"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next, landingAirportsError(next) ? null : parseLandingAirports(next));
      }}
      placeholder="KTOA, KSMO, KTOA"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      className="uppercase"
      error={error}
      hint={hintText()}
    />
  );
}

/**
 * The `landingAirports` a form sends for its "Landed at" line: the codes, or
 * an empty list when the box is empty or unreadable (the box shows the error,
 * and the submit refuses on it first).
 */
export function landedAtCodes(value: string): string[] {
  if (landingAirportsError(value)) return [];
  return parseLandingAirports(value).codes;
}
