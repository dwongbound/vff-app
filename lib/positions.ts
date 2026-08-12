// Club offices, and the powers each one carries.
//
// The club's permission model is two layers:
//
//   isAdmin    — runs the club. Manages the fleet, signs off squawks, edits
//                anyone's booking, hands out positions.
//   positions  — an office with a specific job attached. The Finance Officer
//                keeps the books.
//
// The rule that ties them together: **an admin can do anything a position
// holder can do.** So code never asks "is this person the Finance Officer" —
// it asks `can(user, "finance:manage")`, and admins pass every such check
// without being given the office. That keeps the club from locking itself out
// of its own books when the Finance Officer is on holiday.
//
// This file is the ONLY place that maps an office to a capability. Routes and
// pages ask `can()`; they never test a position directly.

export const POSITION_LABELS = {
  PRESIDENT: "President",
  VICE_PRESIDENT: "Vice President",
  SECRETARY: "Secretary",
  FINANCE_OFFICER: "Finance Officer",
  SAFETY_OFFICER: "Safety Officer",
  MAINTENANCE_OFFICER: "Maintenance Officer",
  INSTRUCTOR: "Flight Instructor (CFI)",
} as const;

export type Position = keyof typeof POSITION_LABELS;

/** Every office, in the order a club would list them. */
export const POSITIONS = Object.keys(POSITION_LABELS) as Position[];

/** What the office is for, shown under the name when an admin assigns it. */
export const POSITION_BLURBS: Record<Position, string> = {
  PRESIDENT: "Runs the club. No extra powers in the app beyond the title.",
  VICE_PRESIDENT: "Stands in for the President. Title only, in the app.",
  SECRETARY: "Keeps the minutes and the roster. Title only, in the app.",
  FINANCE_OFFICER:
    "Keeps the books: sees every member's charges, adds dues and one-off charges, and sets the hourly rate.",
  SAFETY_OFFICER:
    "The person to call about an open squawk — and the one who triages it: sets its status, and decides whether the airplane flies.",
  MAINTENANCE_OFFICER:
    "Keeps the airplane's maintenance sheet: what's due, when it was last done, and what comes next.",
  INSTRUCTOR:
    "A CFI who teaches here: can be named on a training booking, and signs off the flight-log entry afterwards.",
};

/**
 * A thing someone might be allowed to do.
 *
 * Adding a capability means adding it here, granting it below — from an office
 * or from membership, see the two tables — and checking it with `can()`.
 * Nothing else.
 */
export type Capability =
  /** See every member's statement, not just your own. */
  | "finance:read-all"
  /** Add, correct and void charges; manage recurring rules; set the rate. */
  | "finance:manage"
  /**
   * Triage a squawk: set its status, correct its wording, close it.
   *
   * Broader than the old "sign it off", because status IS the whole judgement
   * now — moving a squawk to REVIEWED_GROUNDED takes the airplane off the line
   * and moving it off again puts it back. Any member can FILE one (it lands as
   * NEW); deciding what it means belongs to the officer the checkouts already
   * tell members to call.
   */
  | "squawk:manage"
  /**
   * Sign a training flight's log entry as the instructor.
   *
   * Holding this is not enough on its own — the route also checks the signer
   * is the instructor named on THAT flight. This is "may sign flights at all",
   * which is what decides whether the app offers the affordance and whether a
   * name appears in the booking form's instructor picker.
   */
  | "flight:sign"
  /**
   * Keep the airplane's maintenance sheet: add an item, correct an interval,
   * record that something was signed off.
   *
   * Read is deliberately NOT gated — what the airplane is due for is the first
   * thing every member should see, and an item nobody may read is an item that
   * surprises somebody on a Saturday. This is the WRITE side: saying the annual
   * was done is a claim about the airplane's airworthiness, and it belongs to
   * the officer who deals with the shop (and to admins, like everything else).
   */
  | "maintenance:manage"
  /**
   * Book the airplane, and be billed for it.
   *
   * Granted by MEMBERSHIP rather than by an office: it's the answer to "does
   * this person fly here", not "what job do they hold". A visiting instructor
   * reads the schedule to see when their student has the airplane; they don't
   * take it out themselves, and they don't get a statement.
   */
  | "reservation:book"
  /**
   * Have a statement at this club at all — the Finances tab.
   *
   * Distinct from `finance:read-all`, which is the officer's power to read
   * EVERYONE's. This one is "there is a me-shaped statement to read", and an
   * instructor who isn't a member has none: no dues rule bills them and no
   * flight charge is raised against them, so a tab that can only ever say
   * "nothing here" is worse than no tab.
   */
  | "finance:read-own";

const POSITION_CAPABILITIES: Record<Position, Capability[]> = {
  PRESIDENT: [],
  VICE_PRESIDENT: [],
  SECRETARY: [],
  FINANCE_OFFICER: ["finance:read-all", "finance:manage"],
  SAFETY_OFFICER: ["squawk:manage"],
  MAINTENANCE_OFFICER: ["maintenance:manage"],
  INSTRUCTOR: ["flight:sign"],
};

/**
 * What being a flying member of the club carries, independent of any office.
 *
 * This exists so the instructor-only account has ONE explanation — "not a
 * member, so no booking and no statement" — rather than a scattering of
 * `if (!user.clubMember)` branches that each have to be found again when a
 * third kind of account turns up.
 */
const MEMBERSHIP_CAPABILITIES: Capability[] = [
  "reservation:book",
  "finance:read-own",
];

/** Every capability that exists — what an admin implicitly holds. */
export const ALL_CAPABILITIES: Capability[] = [
  "finance:read-all",
  "finance:manage",
  "squawk:manage",
  "flight:sign",
  "maintenance:manage",
  "reservation:book",
  "finance:read-own",
];

/** The minimum a permission check needs to know about someone. */
export interface Principal {
  isAdmin: boolean;
  positions: Position[];
  /**
   * Whether they fly here (User.clubMember). Optional, and absent means TRUE:
   * every account that existed before instructor accounts did is a flying
   * member, and so is every row whose column has defaulted. A caller that
   * simply hasn't selected the column gets the historical behaviour rather
   * than a silent loss of the booking form.
   */
  clubMember?: boolean;
}

/**
 * Everything this person may do.
 *
 * Admins get the full set, which is the whole point: the club's admins are a
 * superset of its officers, so there is never a job only one absent member can
 * perform. (An admin is a flying member by definition here — someone running
 * the club can always book its airplane.)
 */
export function capabilitiesFor(user: Principal): Set<Capability> {
  if (user.isAdmin) return new Set(ALL_CAPABILITIES);
  const out = new Set<Capability>();
  for (const position of user.positions ?? []) {
    for (const capability of POSITION_CAPABILITIES[position] ?? []) {
      out.add(capability);
    }
  }
  if (user.clubMember !== false) {
    for (const capability of MEMBERSHIP_CAPABILITIES) out.add(capability);
  }
  return out;
}

/** Is this person allowed to do that? Admins always are. */
export function can(user: Principal, capability: Capability): boolean {
  if (user.isAdmin) return true;
  return capabilitiesFor(user).has(capability);
}

/** Offices that actually carry powers — used to explain the roster's badges. */
export function isEmpowered(position: Position): boolean {
  return POSITION_CAPABILITIES[position].length > 0;
}

/**
 * Does this person hold the CFI office?
 *
 * The one place in the app that tests a position directly, and the exception
 * proves the rule: every OTHER caller wants to know "may you do X", which is
 * `can()`, and `can()` says yes to an admin for everything. That is right for
 * permissions and wrong here, because this answers a ROSTER question — who are
 * the club's instructors, for the booking form's picker and the "awaiting your
 * signature" list. Running it through `can(user, "flight:sign")` would put
 * every club admin in the instructor dropdown, which is a factual claim about
 * people's certificates rather than a permission.
 *
 * Kept in this file rather than at the call sites so the office and the
 * question about it stay together.
 */
export function isInstructor(user: { positions: Position[] }): boolean {
  return (user.positions ?? []).includes("INSTRUCTOR");
}

/**
 * Normalize whatever arrived in a request body into a clean list of offices,
 * dropping anything unrecognised and any duplicates.
 */
export function parsePositions(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(POSITIONS);
  const out: Position[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const position = entry as Position;
    if (valid.has(position) && !out.includes(position)) out.push(position);
  }
  // Keep the club's canonical order regardless of what the client sent.
  return POSITIONS.filter((p) => out.includes(p));
}
