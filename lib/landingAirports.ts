// Where you landed, as a list of fields rather than a count.
//
// "Landings: 3" is the number the FAA cares about and the number the currency
// card counts, but it is not the thing a pilot knows at shutdown. What they
// know is where they went — Torrance, Santa Monica, Torrance — and the count
// falls out of that for free. Asking for the count instead throws away the
// route and then asks the pilot to do arithmetic about their own flight.
//
// So the box takes a list and this file turns it into the three columns the
// `Flight` row already has: `landings` (how many), `arrival` (the last one,
// which is where the airplane now is) and `route` (the whole thing, written
// out). No schema change, and the flight log renders it exactly as it renders
// a route typed by hand on the post-flight form.
//
// Repeats are NOT collapsed, and that's the whole reason this counts entries
// rather than distinct fields: KTOA → KSMO → KTOA is three landings at two
// airports, and the number that matters is three. Pattern work is the same
// story from the other end — six circuits at your home field is "KTOA" six
// times, which is exactly what the pilot would write in a paper logbook.

/** What one line of airports comes to, in the columns a Flight row holds. */
export interface LandingAirports {
  /** Every field, in the order they were landed at. Uppercase, no blanks. */
  codes: string[];
  /** How many landings that is — the count the currency rules read. */
  landings: number;
  /** Where the airplane ended up: the last code, or null if there are none. */
  arrival: string | null;
  /** The whole run, written the way the flight log shows a route. */
  route: string | null;
}

/**
 * Anything a person might reasonably put between two airport identifiers.
 *
 * Commas are what the field's placeholder asks for, but people type what they
 * type: arrows because that's how a route is written on a whiteboard, slashes,
 * or just spaces. Accepting all of them costs one regex and saves a validation
 * error that would be about punctuation rather than about flying.
 */
const SEPARATORS = /[\s,;/]+|->|→|>/g;

/**
 * An airport identifier, loosely.
 *
 * Deliberately loose: ICAO (KTOA), the FAA three-letter form people actually
 * say (TOA), and the alphanumeric identifiers small fields carry (L35, 1C5,
 * 9CL2). What it rejects is prose — somebody typing "the practice area" into
 * the box should be told, not silently logged as a landing there.
 */
const IDENTIFIER = /^[A-Z0-9]{3,5}$/;

/** Uppercase, punctuation-free, one code per entry. */
function tokenize(input: string): string[] {
  return input
    .toUpperCase()
    .replace(SEPARATORS, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * The list, as the three columns a flight stores.
 *
 * An empty box is a legitimate answer — a flight with no landing recorded is
 * an entry with a gap, the same way a missing tach start is, and the app's
 * rule everywhere else is that a gap beats a guess. It comes back as zero
 * landings and two nulls.
 */
export function parseLandingAirports(input: string): LandingAirports {
  const codes = tokenize(input);
  return {
    codes,
    landings: codes.length,
    arrival: codes.length ? codes[codes.length - 1] : null,
    route: codes.length ? codes.join(" → ") : null,
  };
}

/**
 * What's wrong with the line, or null.
 *
 * Only ever complains about a token it cannot read as an identifier, and names
 * it — "'PRACTICE' doesn't look like an airport" tells you which of the four
 * things you typed to fix, where "invalid input" does not.
 */
export function landingAirportsError(input: string): string | null {
  const bad = tokenize(input).find((token) => !IDENTIFIER.test(token));
  if (!bad) return null;
  return `"${bad}" doesn't look like an airport identifier — use codes like KTOA or L35, separated by commas.`;
}
