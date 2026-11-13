// The club-wide read an ADMIN's access key gets (GET /api/club), as pure
// shaping (unit-tested in tests/unit/clubView.test.ts). The db half is
// clubSnapshot.ts.
//
// Unlike the member snapshot (agentView.ts), this is about EVERY pilot: who
// flew the airplane, each member's experience and recent landings, and their
// certificate. It exists for a club officer's own tools, which is why only an
// admin's key reaches it.
import { soloEligibility, TIER_LABELS } from "./operatingRules";
import { totalTachHours } from "./hours";
import { agentFlight, type AgentFlightRow } from "./agentView";

/** The window "recent" means here: the FAA's 90 days for passenger currency. */
export const CLUB_WINDOW_DAYS = 90;

export interface ClubFlightRow extends AgentFlightRow {
  userId: string;
  user: { name: string };
}

/**
 * One log entry on the club's airplane, with who flew it. The notes and the
 * pilot's write-up stay out: they are that pilot's own words about the
 * flight, not the club's record of it.
 */
export function clubFlight(row: ClubFlightRow) {
  const { notes, logEntry, ...flight } = agentFlight(row);
  return { pilot: row.user.name, ...flight };
}

export interface ClubMemberRow {
  id: string;
  name: string;
  email: string | null;
  certificate: string | null;
  totalTimeHours: number | null;
  positions: string[];
  clubMember: boolean;
}

/**
 * One pilot: what they hold, how much they fly, and their landings. `flights`
 * is THEIR log from this club, newest first, at least the last 12 months.
 */
export function clubPilot(member: ClubMemberRow, flights: ClubFlightRow[], now: Date) {
  const cutoff = now.getTime() - CLUB_WINDOW_DAYS * 86_400_000;
  const recent = flights.filter((f) => f.flownOn.getTime() >= cutoff);
  const solo = soloEligibility({ totalTimeHours: member.totalTimeHours, flights, now });
  return {
    name: member.name,
    email: member.email,
    certificate: member.certificate,
    offices: member.positions,
    clubMember: member.clubMember,
    declaredTotalTimeHours: member.totalTimeHours,
    hoursInClubLogLast12Months: solo.recentHours,
    hoursInClubLogLast90Days: totalTachHours(recent),
    flightsLast90Days: recent.length,
    // `landings` is every landing, night ones included (see landingCurrency).
    landingsLast90Days: recent.reduce((sum, f) => sum + (f.landings ?? 0), 0),
    nightLandingsLast90Days: recent.reduce((sum, f) => sum + (f.nightLandings ?? 0), 0),
    lastFlownOn: flights[0]?.flownOn.toISOString() ?? null,
    operatingRulesColumn: TIER_LABELS[solo.tier],
    clubCurrency: {
      windowDays: solo.windowDays,
      maySoloByDay: solo.daySolo,
      maySoloAtNight: solo.nightSolo,
      why: [...solo.dayBlockers, ...solo.nightBlockers],
    },
  };
}
