// Row → wire-shape mappers. Everything the API returns goes through here so
// dates become ISO strings in exactly one place and pages never see a Prisma
// type (or a Date that JSON.stringify already turned into a string behind
// TypeScript's back).
//
// The input types are written structurally rather than imported from the
// generated client: that keeps this file compiling before `prisma generate`
// has ever run, and documents precisely which columns each route must select.
import { parseAnswers } from "./checklist";
import type {
  ApiAircraft,
  ApiFlight,
  ApiPhoto,
  ApiPreflight,
  ApiReservation,
  ApiSquawk,
  ApiUserSummary,
} from "./types";
import type { Purpose, Severity } from "./constants";

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
  squawks?: { id: string; title: string; severity: string; status: string }[];
}

export function serializeAircraft(a: AircraftRow): ApiAircraft {
  const open = (a.squawks ?? []).filter((s) => s.status === "OPEN");
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
    groundingSquawks: open
      .filter((s) => s.severity === "GROUNDING")
      .map((s) => ({ id: s.id, title: s.title, severity: s.severity as Severity })),
    openSquawkCount: open.length,
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
    hasFlight: Boolean(r.flight),
    mine: r.userId === viewerId,
  };
}

interface SquawkRow {
  id: string;
  aircraftId: string;
  title: string;
  description: string | null;
  severity: string;
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
    severity: s.severity as Severity,
    status: s.status as "OPEN" | "RESOLVED",
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
  notes: string | null;
  photos?: PhotoRow[];
  squawks?: SquawkRow[];
  createdAt: Date;
}

export function serializeFlight(f: FlightRow, viewerId: string): ApiFlight {
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
    notes: f.notes,
    photos: (f.photos ?? []).map(serializePhoto),
    squawks: (f.squawks ?? []).map(serializeSquawk),
    createdAt: f.createdAt.toISOString(),
    mine: f.userId === viewerId,
  };
}

interface PreflightRow {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: UserRow;
  checklistVersion: number;
  answers: unknown;
  fuelOnBoardGal: number | null;
  oilQuarts: number | null;
  notes: string | null;
  completedAt: Date | null;
  photos?: PhotoRow[];
  createdAt: Date;
}

export function serializePreflight(p: PreflightRow): ApiPreflight {
  return {
    id: p.id,
    aircraft: { id: p.aircraft.id, tailNumber: p.aircraft.tailNumber },
    user: serializeUser(p.user),
    checklistVersion: p.checklistVersion,
    answers: parseAnswers(p.answers),
    fuelOnBoardGal: p.fuelOnBoardGal,
    oilQuarts: p.oilQuarts,
    notes: p.notes,
    completedAt: p.completedAt?.toISOString() ?? null,
    photos: (p.photos ?? []).map(serializePhoto),
    createdAt: p.createdAt.toISOString(),
  };
}
