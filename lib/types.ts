// Shapes the API returns to the client. Prisma's own types describe db rows
// (Date objects, every column); these describe what actually crosses the wire
// after JSON.stringify — dates as ISO strings, relations flattened to what the
// UI needs.
import type { Purpose, Severity } from "./constants";

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
  /** Open GROUNDING squawks — non-empty means the airplane is down. */
  groundingSquawks: ApiSquawkSummary[];
  openSquawkCount: number;
}

export interface ApiSquawkSummary {
  id: string;
  title: string;
  severity: Severity;
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
  notes: string | null;
  photos: ApiPhoto[];
  squawks: ApiSquawk[];
  createdAt: string;
  mine: boolean;
}

export interface ApiSquawk {
  id: string;
  aircraftId: string;
  title: string;
  description: string | null;
  severity: Severity;
  status: "OPEN" | "RESOLVED";
  reportedBy: ApiUserSummary;
  resolvedBy: ApiUserSummary | null;
  resolvedAt: string | null;
  resolution: string | null;
  photos: ApiPhoto[];
  createdAt: string;
}

export interface ApiPreflight {
  id: string;
  aircraft: { id: string; tailNumber: string };
  user: ApiUserSummary;
  checklistVersion: number;
  answers: Record<string, boolean>;
  fuelOnBoardGal: number | null;
  oilQuarts: number | null;
  notes: string | null;
  completedAt: string | null;
  photos: ApiPhoto[];
  createdAt: string;
}

/** GET /api/me — the signed-in member's own profile. */
export interface ApiMe {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
  certificate: string | null;
  totalTimeHours: number | null;
  medicalExpiresOn: string | null;
  flightReviewOn: string | null;
}
