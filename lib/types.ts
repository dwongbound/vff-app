// Shapes the API returns to the client. Prisma's own types describe db rows
// (Date objects, every column); these describe what actually crosses the wire
// after JSON.stringify — dates as ISO strings, relations flattened to what the
// UI needs.
import type { CheckoutKind, Values } from "./checkouts";
import type { Purpose } from "./constants";
import type { SquawkStatus } from "./squawks";
import type { ChargeKind } from "./finance";
import type { Capability, Position } from "./positions";
import type { SignupCodeKind } from "./signupCodes";

export interface ApiUserSummary {
  id: string;
  name: string;
  email: string | null;
}

export interface ApiAircraft {
  id: string;
  tailNumber: string;
  model: string;
  year: number | null;
  hourlyRateCents: number | null;
  fuelCapacityGal: number | null;
  homeBase: string | null;
  lastTach: number | null;
  lastHobbs: number | null;
  active: boolean;
  notes: string | null;
  /**
   * Weight & balance. `wbProfile` is an id into lib/weightBalance.ts (the
   * type's stations and envelope); the other three are this airframe's own
   * basis, off its latest W&B revision. All null on an airplane nobody has
   * entered a basis for, which is what makes the tool say so.
   */
  wbProfile: string | null;
  emptyWeightLbs: number | null;
  emptyMomentLbIn: number | null;
  weighedOn: string | null;
  /** Squawks at REVIEWED_GROUNDED — non-empty means the airplane is down. */
  groundingSquawks: ApiSquawkSummary[];
  /** Squawks at REVIEWED_IN_WORK — the airplane is in the shop. */
  inWorkSquawks: ApiSquawkSummary[];
  /** Everything not CLOSED. */
  openSquawkCount: number;
  /** Filed but not yet triaged — what the Safety Officer owes the club. */
  newSquawkCount: number;
}

export interface ApiSquawkSummary {
  id: string;
  title: string;
  status: SquawkStatus;
}

export interface ApiReservation {
  id: string;
  aircraftId: string;
  aircraft: { id: string; tailNumber: string };
  user: ApiUserSummary;
  startsAt: string;
  endsAt: string;
  purpose: Purpose;
  notes: string | null;
  status: "CONFIRMED" | "CANCELED";
  /**
   * The CFI this lesson is booked with. Only ever set on a TRAINING booking —
   * changing the purpose to anything else clears it server-side.
   */
  instructor: ApiUserSummary | null;
  /** Whether a post-flight entry has been filed against this booking. */
  hasFlight: boolean;
  /** True when the signed-in member owns this booking. */
  mine: boolean;
}

export interface ApiPhoto {
  id: string;
  caption: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ApiFlight {
  id: string;
  aircraft: { id: string; tailNumber: string };
  pilot: ApiUserSummary;
  reservationId: string | null;
  flownOn: string;
  tachStart: number;
  tachEnd: number;
  hobbsStart: number | null;
  hobbsEnd: number | null;
  landings: number;
  nightLandings: number;
  withInstructor: boolean;
  departure: string | null;
  arrival: string | null;
  route: string | null;
  fuelAddedGal: number | null;
  fuelCostCents: number | null;
  oilAddedQts: number | null;
  tiedDown: boolean;
  cabinClean: boolean;
  /** The turn-off checkout — after landing / shutdown / parking — as { itemId: true }. */
  turnoffAnswers: Record<string, boolean>;
  /** Which version of the turn-off checkout those answers were given against. */
  turnoffCheckoutVersion: number | null;
  /** Readings recorded on the turn-off items (tach, flight timer). */
  turnoffValues: Values;
  notes: string | null;
  photos: ApiPhoto[];
  squawks: ApiSquawk[];
  /**
   * The instructor's endorsement of this entry.
   *
   * `instructor` is who is expected to sign; `signedBy`/`signedAt` are who did
   * and when. Both names are kept because they can differ in the trail even
   * though only the named instructor may sign today.
   */
  instructor: ApiUserSummary | null;
  signedBy: ApiUserSummary | null;
  signedAt: string | null;
  /**
   * When the entry's CONTENT was last corrected; null = never since filing.
   * Read against `signedAt` to tell whether a signature still covers what's on
   * screen — see lib/flightSignature.ts.
   */
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
}

export interface ApiSquawk {
  id: string;
  aircraftId: string;
  title: string;
  description: string | null;
  status: SquawkStatus;
  reportedBy: ApiUserSummary;
  resolvedBy: ApiUserSummary | null;
  resolvedAt: string | null;
  resolution: string | null;
  photos: ApiPhoto[];
  createdAt: string;
}

/** One run of one card — GET/POST /api/checkouts. */
export interface ApiCheckout {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: ApiUserSummary;
  /** Which card: PREFLIGHT or RUNWAY. The turn-off one rides on ApiFlight. */
  kind: CheckoutKind;
  checkoutVersion: number;
  answers: Record<string, boolean>;
  /** Readings recorded on the items, keyed by field id. */
  values: Values;
  /** PREFLIGHT only — nothing is measured on the runway checkout. */
  fuelOnBoardGal: number | null;
  oilQuarts: number | null;
  notes: string | null;
  completedAt: string | null;
  photos: ApiPhoto[];
  createdAt: string;
}

/**
 * GET /api/members — one row of the club roster.
 *
 * Contact details are shared club-wide on purpose (members swap bookings with
 * each other), but pilot paperwork — medical, flight review, total time — is
 * not: that stays on the member's own profile, behind /api/me.
 */
export interface ApiMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  certificate: string | null;
  isAdmin: boolean;
  /** Club offices held. Public to the roster — this is who to call. */
  positions: Position[];
  /**
   * Whether they fly here, as opposed to only teaching here. False is the
   * instructor-only account: no bookings, no statement. Admin-editable from
   * this same roster.
   */
  clubMember: boolean;
  joinedAt: string;
  /** True when this row is the signed-in member. */
  me: boolean;
}

/** GET /api/me — the signed-in member's own profile. */
export interface ApiMe {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
  positions: Position[];
  /** Whether they fly here — see ApiMember. Drives the tabs an account gets. */
  clubMember: boolean;
  /**
   * What this member may do, resolved server-side (admins hold everything).
   * The client shows or hides officer tools on this rather than re-deriving
   * permissions from isAdmin + positions and getting it subtly wrong.
   */
  capabilities: Capability[];
  certificate: string | null;
  totalTimeHours: number | null;
  medicalExpiresOn: string | null;
  flightReviewOn: string | null;
  /** When they finished or skipped the guided tour; null = never shown. */
  tourSeenAt: string | null;
}

/**
 * One fill-up — GET/POST /api/servicing.
 *
 * Deliberately NOT a flight with zero hours: nothing was flown, so it must not
 * appear in the log, count toward anyone's currency, or bill an hourly rate.
 */
export interface ApiServicing {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: ApiUserSummary;
  servicedAt: string;
  fuelAddedGal: number | null;
  fuelCostCents: number | null;
  oilAddedQts: number | null;
  /** Member's own card (so the club owes them) rather than the club's. */
  paidPersonally: boolean;
  notes: string | null;
  createdAt: string;
  /** True when the signed-in member filed it. */
  mine: boolean;
}

/** One line on a member's statement. Negative cents = a credit to them. */
export interface ApiCharge {
  id: string;
  member: ApiUserSummary;
  kind: ChargeKind;
  amountCents: number;
  description: string;
  period: string;
  incurredOn: string;
  flightId: string | null;
  recurringChargeId: string | null;
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
  /** True when the line belongs to the signed-in member. */
  mine: boolean;
}

/** A standing monthly rule — the club's dues, or a private arrangement. */
export interface ApiRecurringCharge {
  id: string;
  label: string;
  amountCents: number;
  /** Null = billed to every member. */
  member: ApiUserSummary | null;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  createdAt: string;
}

/** One member's month: their lines and what they add up to. */
export interface ApiStatement {
  member: ApiUserSummary;
  period: string;
  charges: ApiCharge[];
  chargedCents: number;
  creditedCents: number;
  balanceCents: number;
}

/**
 * One code off the club's sign-up lists — GET/POST /api/signup-codes.
 *
 * Admin-only in both directions. The code itself is returned in full: an admin
 * managing the list has to be able to read one out to the person joining, so
 * there is nothing to be gained by masking it behind a route only admins can
 * reach in the first place.
 */
export interface ApiSignupCode {
  id: string;
  code: string;
  kind: SignupCodeKind;
  label: string | null;
  active: boolean;
  /** How many accounts this code has created. Not a limit — see the schema. */
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
}

/** GET /api/finances — your own statement, or everyone's for an officer. */
export interface ApiFinances {
  period: string;
  /** True when these are all the club's statements rather than just yours. */
  clubWide: boolean;
  statements: ApiStatement[];
}
