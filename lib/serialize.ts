// Row → wire-shape mappers. Everything the API returns goes through here so
// dates become ISO strings in exactly one place and pages never see a Prisma
// type (or a Date that JSON.stringify already turned into a string behind
// TypeScript's back).
//
// The input types are written structurally rather than imported from the
// generated client: that keeps this file compiling before `prisma generate`
// has ever run, and documents precisely which columns each route must select.
import { parseAnswers, parseValues, type CheckoutKind } from "./checkouts";
import type { MaintenanceCategory } from "./maintenance";
import type {
  ApiAircraft,
  ApiCharge,
  ApiCheckout,
  ApiFlight,
  ApiFlightSummary,
  ApiMaintenanceItem,
  ApiMember,
  ApiPhoto,
  ApiRecurringCharge,
  ApiReservation,
  ApiServicing,
  ApiSignupCode,
  ApiSquawk,
  ApiUserSummary,
} from "./types";
import type { Purpose } from "./constants";
import { isGrounding, isInMaintenance, isOpen, type SquawkStatus } from "./squawks";
import type { ChargeKind } from "./finance";
import type { Position } from "./positions";
import type { SignupCodeKind } from "./signupCodes";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
}

interface PhotoRow {
  id: string;
  caption: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export function serializeUser(u: UserRow): ApiUserSummary {
  return { id: u.id, name: u.name, email: u.email };
}

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  certificate: string | null;
  isAdmin: boolean;
  positions: string[];
  clubMember: boolean;
  createdAt: Date;
}

/**
 * One row of the club roster. Note what is NOT selected: pilot paperwork stays
 * private to the member (see ApiMember), so it can't leak by adding a column
 * here later.
 */
export function serializeMember(u: MemberRow, viewerId: string): ApiMember {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    certificate: u.certificate,
    isAdmin: u.isAdmin,
    positions: u.positions as Position[],
    clubMember: u.clubMember,
    joinedAt: u.createdAt.toISOString(),
    me: u.id === viewerId,
  };
}

interface SignupCodeRow {
  id: string;
  code: string;
  kind: string;
  label: string | null;
  active: boolean;
  uses: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export function serializeSignupCode(c: SignupCodeRow): ApiSignupCode {
  return {
    id: c.id,
    code: c.code,
    kind: c.kind as SignupCodeKind,
    label: c.label,
    active: c.active,
    uses: c.uses,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

interface ChargeRow {
  id: string;
  member: UserRow;
  memberId: string;
  kind: string;
  amountCents: number;
  description: string;
  period: string;
  incurredOn: Date;
  flightId: string | null;
  recurringChargeId: string | null;
  voided: boolean;
  voidReason: string | null;
  paidAt: Date | null;
  paidBy?: UserRow | null;
  createdAt: Date;
}

export function serializeCharge(c: ChargeRow, viewerId: string): ApiCharge {
  return {
    id: c.id,
    member: serializeUser(c.member),
    kind: c.kind as ChargeKind,
    amountCents: c.amountCents,
    description: c.description,
    period: c.period,
    incurredOn: c.incurredOn.toISOString(),
    flightId: c.flightId,
    recurringChargeId: c.recurringChargeId,
    voided: c.voided,
    voidReason: c.voidReason,
    paidAt: c.paidAt?.toISOString() ?? null,
    paidBy: c.paidBy ? serializeUser(c.paidBy) : null,
    createdAt: c.createdAt.toISOString(),
    mine: c.memberId === viewerId,
  };
}

interface RecurringChargeRow {
  id: string;
  label: string;
  amountCents: number;
  member: UserRow | null;
  startsOn: Date;
  endsOn: Date | null;
  active: boolean;
  createdAt: Date;
}

export function serializeRecurringCharge(
  r: RecurringChargeRow
): ApiRecurringCharge {
  return {
    id: r.id,
    label: r.label,
    amountCents: r.amountCents,
    member: r.member ? serializeUser(r.member) : null,
    startsOn: r.startsOn.toISOString(),
    endsOn: r.endsOn?.toISOString() ?? null,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  };
}

export function serializePhoto(p: PhotoRow): ApiPhoto {
  return {
    id: p.id,
    caption: p.caption,
    contentType: p.contentType,
    sizeBytes: p.sizeBytes,
    createdAt: p.createdAt.toISOString(),
  };
}

interface AircraftRow {
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
  wbProfile: string | null;
  emptyWeightLbs: number | null;
  emptyMomentLbIn: number | null;
  weighedOn: Date | null;
  squawks?: { id: string; title: string; status: string }[];
  maintenance?: MaintenanceItemRow[];
}

interface MaintenanceItemRow {
  id: string;
  aircraftId: string;
  label: string;
  category: string;
  requiredByReg: boolean;
  reference: string | null;
  intervalHours: number | null;
  intervalMonths: number | null;
  lastDoneTach: number | null;
  lastDoneOn: Date | null;
  notes: string | null;
  active: boolean;
  updatedAt: Date;
}

/**
 * One row of the maintenance sheet, exactly as stored.
 *
 * Nothing derived crosses the wire — no hours remaining, no due date, no
 * state. Those are functions of the airplane's CURRENT tach and the reader's
 * clock (lib/maintenance.ts), so serialising them would freeze a countdown at
 * the moment the response was built and leave a page open overnight reporting
 * yesterday's answer.
 */
export function serializeMaintenanceItem(m: MaintenanceItemRow): ApiMaintenanceItem {
  return {
    id: m.id,
    aircraftId: m.aircraftId,
    label: m.label,
    category: m.category as MaintenanceCategory,
    requiredByReg: m.requiredByReg,
    reference: m.reference,
    intervalHours: m.intervalHours,
    intervalMonths: m.intervalMonths,
    lastDoneTach: m.lastDoneTach,
    lastDoneOn: m.lastDoneOn?.toISOString() ?? null,
    notes: m.notes,
    active: m.active,
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function serializeAircraft(a: AircraftRow): ApiAircraft {
  const summary = (s: { id: string; title: string; status: string }) => ({
    id: s.id,
    title: s.title,
    status: s.status as SquawkStatus,
  });
  const open = (a.squawks ?? []).filter((s) => isOpen(s.status as SquawkStatus));
  return {
    id: a.id,
    tailNumber: a.tailNumber,
    model: a.model,
    year: a.year,
    hourlyRateCents: a.hourlyRateCents,
    fuelCapacityGal: a.fuelCapacityGal,
    homeBase: a.homeBase,
    lastTach: a.lastTach,
    lastHobbs: a.lastHobbs,
    active: a.active,
    notes: a.notes,
    wbProfile: a.wbProfile,
    emptyWeightLbs: a.emptyWeightLbs,
    emptyMomentLbIn: a.emptyMomentLbIn,
    weighedOn: a.weighedOn?.toISOString() ?? null,
    groundingSquawks: open
      .filter((s) => isGrounding(s.status as SquawkStatus))
      .map(summary),
    inWorkSquawks: open
      .filter((s) => isInMaintenance(s.status as SquawkStatus))
      .map(summary),
    openSquawkCount: open.length,
    newSquawkCount: open.filter((s) => s.status === "NEW").length,
    // Absent (a route that didn't include them) reads as an empty sheet rather
    // than an error — the same shape a club that hasn't typed one in yet has.
    maintenance: (a.maintenance ?? [])
      .filter((m) => m.active)
      .map(serializeMaintenanceItem),
  };
}

interface ReservationRow {
  id: string;
  aircraftId: string;
  aircraft: { id: string; tailNumber: string };
  user: UserRow;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  purpose: string;
  notes: string | null;
  status: string;
  instructor?: UserRow | null;
  flight?: { id: string } | null;
}

export function serializeReservation(
  r: ReservationRow,
  viewerId: string
): ApiReservation {
  return {
    id: r.id,
    aircraftId: r.aircraftId,
    aircraft: { id: r.aircraft.id, tailNumber: r.aircraft.tailNumber },
    user: serializeUser(r.user),
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    purpose: r.purpose as Purpose,
    notes: r.notes,
    status: r.status as "CONFIRMED" | "CANCELED",
    instructor: r.instructor ? serializeUser(r.instructor) : null,
    hasFlight: Boolean(r.flight),
    mine: r.userId === viewerId,
  };
}

interface SquawkRow {
  id: string;
  aircraftId: string;
  title: string;
  description: string | null;
  status: string;
  reportedBy: UserRow;
  resolvedBy?: UserRow | null;
  resolvedAt: Date | null;
  resolution: string | null;
  photos?: PhotoRow[];
  createdAt: Date;
}

export function serializeSquawk(s: SquawkRow): ApiSquawk {
  return {
    id: s.id,
    aircraftId: s.aircraftId,
    title: s.title,
    description: s.description,
    status: s.status as SquawkStatus,
    reportedBy: serializeUser(s.reportedBy),
    resolvedBy: s.resolvedBy ? serializeUser(s.resolvedBy) : null,
    resolvedAt: s.resolvedAt?.toISOString() ?? null,
    resolution: s.resolution,
    photos: (s.photos ?? []).map(serializePhoto),
    createdAt: s.createdAt.toISOString(),
  };
}

interface FlightRow {
  id: string;
  aircraft: { id: string; tailNumber: string };
  pilot: UserRow;
  userId: string;
  reservationId: string | null;
  flownOn: Date;
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
  turnoffCheckoutVersion: number | null;
  turnoffAnswers: unknown;
  turnoffValues: unknown;
  notes: string | null;
  instructor?: UserRow | null;
  signedBy?: UserRow | null;
  signedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
}

/**
 * The scalar half of a log entry — everything both the list and the detail
 * view need. Split out so the two serializers below can't drift: a field added
 * here appears in both, which is the failure the split would otherwise invite.
 */
function serializeFlightFields(
  f: FlightRow,
  viewerId: string
): Omit<ApiFlightSummary, "photoCount" | "openSquawkCount"> {
  return {
    id: f.id,
    aircraft: { id: f.aircraft.id, tailNumber: f.aircraft.tailNumber },
    pilot: serializeUser(f.pilot),
    reservationId: f.reservationId,
    flownOn: f.flownOn.toISOString(),
    tachStart: f.tachStart,
    tachEnd: f.tachEnd,
    hobbsStart: f.hobbsStart,
    hobbsEnd: f.hobbsEnd,
    landings: f.landings,
    nightLandings: f.nightLandings,
    withInstructor: f.withInstructor,
    departure: f.departure,
    arrival: f.arrival,
    route: f.route,
    fuelAddedGal: f.fuelAddedGal,
    fuelCostCents: f.fuelCostCents,
    oilAddedQts: f.oilAddedQts,
    tiedDown: f.tiedDown,
    cabinClean: f.cabinClean,
    turnoffAnswers: parseAnswers("TURNOFF", f.turnoffAnswers),
    turnoffValues: parseValues("TURNOFF", f.turnoffValues),
    turnoffCheckoutVersion: f.turnoffCheckoutVersion,
    notes: f.notes,
    instructor: f.instructor ? serializeUser(f.instructor) : null,
    signedBy: f.signedBy ? serializeUser(f.signedBy) : null,
    signedAt: f.signedAt?.toISOString() ?? null,
    editedAt: f.editedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    mine: f.userId === viewerId,
  };
}

/**
 * A list row: the scalars plus the two counts the log draws badges from.
 *
 * The counts are computed by the database (`_count`), so a page showing 300
 * flights never pulls the photo and squawk rows themselves.
 */
export function serializeFlightSummary(
  f: FlightRow & { _count: { photos: number; squawks: number } },
  viewerId: string
): ApiFlightSummary {
  return {
    ...serializeFlightFields(f, viewerId),
    photoCount: f._count.photos,
    // The route counts only the OPEN ones (see its `_count` filter), which is
    // the only squawk question a log row asks.
    openSquawkCount: f._count.squawks,
  };
}

/** One flight with its photos and squawks — the detail endpoint. */
export function serializeFlight(
  f: FlightRow & { photos?: PhotoRow[]; squawks?: SquawkRow[] },
  viewerId: string
): ApiFlight {
  const photos = (f.photos ?? []).map(serializePhoto);
  const squawks = (f.squawks ?? []).map(serializeSquawk);
  return {
    ...serializeFlightFields(f, viewerId),
    photoCount: photos.length,
    openSquawkCount: squawks.filter((s) => isOpen(s.status)).length,
    photos,
    squawks,
  };
}

interface ServicingRow {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: UserRow;
  userId: string;
  servicedAt: Date;
  fuelAddedGal: number | null;
  fuelCostCents: number | null;
  oilAddedQts: number | null;
  paidPersonally: boolean;
  notes: string | null;
  createdAt: Date;
}

export function serializeServicing(
  s: ServicingRow,
  viewerId: string
): ApiServicing {
  return {
    id: s.id,
    aircraft: { id: s.aircraft.id, tailNumber: s.aircraft.tailNumber },
    user: serializeUser(s.user),
    servicedAt: s.servicedAt.toISOString(),
    fuelAddedGal: s.fuelAddedGal,
    fuelCostCents: s.fuelCostCents,
    oilAddedQts: s.oilAddedQts,
    paidPersonally: s.paidPersonally,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    mine: s.userId === viewerId,
  };
}

interface CheckoutRow {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: UserRow;
  kind: string;
  checkoutVersion: number;
  answers: unknown;
  values: unknown;
  fuelOnBoardGal: number | null;
  oilQuarts: number | null;
  notes: string | null;
  completedAt: Date | null;
  photos?: PhotoRow[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Answers are parsed against the row's OWN kind, which is what quietly drops
 * the ids of a superseded card version — the version stamp comes across
 * untouched so a reader can tell why an old run looks sparse.
 */
export function serializeCheckout(c: CheckoutRow): ApiCheckout {
  const kind = c.kind as CheckoutKind;
  return {
    id: c.id,
    aircraft: { id: c.aircraft.id, tailNumber: c.aircraft.tailNumber },
    user: serializeUser(c.user),
    kind,
    checkoutVersion: c.checkoutVersion,
    answers: parseAnswers(kind, c.answers),
    values: parseValues(kind, c.values),
    fuelOnBoardGal: c.fuelOnBoardGal,
    oilQuarts: c.oilQuarts,
    notes: c.notes,
    completedAt: c.completedAt?.toISOString() ?? null,
    photos: (c.photos ?? []).map(serializePhoto),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
