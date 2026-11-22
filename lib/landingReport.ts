// How many landings the club made at each airport, month by month.
//
// It exists for one job: claiming landing fees back. Whoever reimburses the
// club wants "in October we landed at KTOA 41 times and at KSMO twice", so the
// report is a month × airport table of landings, plus the flights that made
// them and the fees pilots recorded, and it exports as the spreadsheet that
// goes with the claim.
//
// Where each landing was comes from `Flight.landingAirports` — one entry per
// landing, KTOA → KSMO → KTOA being three landings at two fields. Older
// entries, and any form left blank, don't have that list. Those landings are
// not dropped (the club did make them) and not silently given an airport
// either: they're counted at the flight's arrival field, or at the airplane's
// home base when there's no arrival, and flagged ASSUMED, so whoever files the
// claim can see which numbers are the pilots' and which are this file's.
// That's the same rule the rest of the app follows — a gap is shown as a gap,
// never quietly filled.
import { periodOf, type Period } from "./finance";

/** The columns of one flight this report reads. */
export interface LandingReportFlight {
  /** The calendar day flown (local midnight / midday — see `periodOf`). */
  flownOn: Date | string;
  landings: number;
  /** One entry per landing, in order; empty when the pilot didn't say. */
  landingAirports: string[];
  arrival: string | null;
  /** The airplane's home field, for an entry with no airport at all. */
  homeBase: string | null;
  /** What the pilot recorded paying to land, in cents. Null = nothing recorded. */
  landingFeeCents: number | null;
}

/** One airport's line inside a month. */
export interface AirportLandings {
  airport: string;
  /** Every landing counted here, assumed ones included. */
  landings: number;
  /** How many of `landings` came from an entry that didn't list its airports. */
  assumed: number;
  /** Flights that landed here at least once. */
  flights: number;
  /** Landing fees recorded on flights that ENDED here, in cents. */
  feeCents: number;
}

/** One month of the report. */
export interface LandingMonth {
  period: Period;
  /** Busiest airport first, then alphabetical. */
  airports: AirportLandings[];
  landings: number;
  assumed: number;
  flights: number;
  feeCents: number;
}

/** What an airport is called when nothing at all says where the airplane was. */
export const UNKNOWN_AIRPORT = "Not recorded";

/**
 * Where one flight's landings were, as (airport, assumed) pairs — one per
 * landing.
 *
 * The listed airports when there are any. Otherwise every landing at the
 * arrival field, then the home base, then `UNKNOWN_AIRPORT`, all marked
 * assumed. A flight with zero landings contributes nothing.
 */
export function landingsOf(
  flight: LandingReportFlight
): { airport: string; assumed: boolean }[] {
  if (flight.landingAirports.length > 0) {
    return flight.landingAirports.map((airport) => ({ airport, assumed: false }));
  }
  const count = Math.max(0, flight.landings);
  const airport = clean(flight.arrival) ?? clean(flight.homeBase) ?? UNKNOWN_AIRPORT;
  return Array.from({ length: count }, () => ({ airport, assumed: true }));
}

/** Upper-cased and trimmed, or null when there's nothing there. */
function clean(code: string | null): string | null {
  const trimmed = (code ?? "").trim().toUpperCase();
  return trimmed || null;
}

/**
 * The airport a flight's landing fee belongs to: where it ended up.
 *
 * The fee box on every form sits beside the arrival field and is prefilled
 * from it (lib/landingFees.ts), so that's the desk the pilot paid at.
 */
function feeAirport(flight: LandingReportFlight): string {
  const listed = flight.landingAirports[flight.landingAirports.length - 1];
  return clean(listed ?? null) ?? clean(flight.arrival) ?? clean(flight.homeBase) ?? UNKNOWN_AIRPORT;
}

/**
 * The report: every month that has a landing or a fee in it, newest first.
 */
export function landingReport(flights: LandingReportFlight[]): LandingMonth[] {
  const months = new Map<Period, Map<string, AirportLandings>>();

  /** The airport's line in a month, made on first use. */
  function lineFor(period: Period, airport: string): AirportLandings {
    let month = months.get(period);
    if (!month) {
      month = new Map();
      months.set(period, month);
    }
    let line = month.get(airport);
    if (!line) {
      line = { airport, landings: 0, assumed: 0, flights: 0, feeCents: 0 };
      month.set(airport, line);
    }
    return line;
  }

  for (const flight of flights) {
    const period = periodOf(new Date(flight.flownOn));
    const seen = new Set<string>();
    for (const landing of landingsOf(flight)) {
      const line = lineFor(period, landing.airport);
      line.landings += 1;
      if (landing.assumed) line.assumed += 1;
      if (!seen.has(landing.airport)) {
        line.flights += 1;
        seen.add(landing.airport);
      }
    }
    if (flight.landingFeeCents != null && flight.landingFeeCents > 0) {
      lineFor(period, feeAirport(flight)).feeCents += flight.landingFeeCents;
    }
  }

  // Flight count for the month as a whole: a flight that landed at two
  // airports is one flight, so it can't be the sum of the airport lines.
  const flightsPerMonth = new Map<Period, number>();
  for (const flight of flights) {
    if (landingsOf(flight).length === 0) continue;
    const period = periodOf(new Date(flight.flownOn));
    flightsPerMonth.set(period, (flightsPerMonth.get(period) ?? 0) + 1);
  }

  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([period, lines]) => {
      const airports = [...lines.values()].sort(byBusiest);
      return {
        period,
        airports,
        landings: sum(airports, (line) => line.landings),
        assumed: sum(airports, (line) => line.assumed),
        flights: flightsPerMonth.get(period) ?? 0,
        feeCents: sum(airports, (line) => line.feeCents),
      };
    });
}

/** Most landings first; ties alphabetical, with "Not recorded" always last. */
function byBusiest(a: AirportLandings, b: AirportLandings): number {
  if (a.airport === UNKNOWN_AIRPORT) return 1;
  if (b.airport === UNKNOWN_AIRPORT) return -1;
  if (a.landings !== b.landings) return b.landings - a.landings;
  return a.airport.localeCompare(b.airport);
}

/** Adds up one number off each line. */
function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}
