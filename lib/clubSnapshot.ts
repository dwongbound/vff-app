// The db half of clubView.ts: everything GET /api/club returns. Read-only, like
// agentSnapshot.ts — no Google sync, nothing materialised.
import { prisma } from "./prisma";
import { CLUB_TIME_ZONE } from "./constants";
import { readAircraft, readBookings } from "./agentSnapshot";
import { CLUB_WINDOW_DAYS, clubFlight, clubPilot, type ClubFlightRow } from "./clubView";
import type { KeyUser } from "./accessKeyAuth";

const FLIGHT_SELECT = {
  id: true,
  userId: true,
  flownOn: true,
  filedAt: true,
  tachStart: true,
  tachEnd: true,
  hobbsStart: true,
  hobbsEnd: true,
  landings: true,
  nightLandings: true,
  purpose: true,
  departure: true,
  arrival: true,
  route: true,
  notes: true,
  logEntry: true,
  signedAt: true,
  user: { select: { name: true } },
  aircraft: { select: { tailNumber: true } },
  instructor: { select: { name: true } },
} as const;

export async function clubSnapshot(user: KeyUser, now = new Date()) {
  // A year of the whole log: the operating rules' recency is 12 months, and
  // the 90-day figures and the flight list are cut from the same rows.
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const [aircraft, schedule, flights, members] = await Promise.all([
    readAircraft(now),
    readBookings(user, now),
    prisma.flight.findMany({
      where: { flownOn: { gte: yearAgo } },
      orderBy: [{ flownOn: "desc" }, { createdAt: "desc" }],
      select: FLIGHT_SELECT,
    }) as Promise<ClubFlightRow[]>,
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        certificate: true,
        totalTimeHours: true,
        positions: true,
        clubMember: true,
      },
    }),
  ]);

  const byPilot = new Map<string, ClubFlightRow[]>();
  for (const f of flights) byPilot.set(f.userId, [...(byPilot.get(f.userId) ?? []), f]);
  const cutoff = now.getTime() - CLUB_WINDOW_DAYS * 86_400_000;

  return {
    generatedAt: now.toISOString(),
    clubTimeZone: CLUB_TIME_ZONE,
    windowDays: CLUB_WINDOW_DAYS,
    aircraft,
    schedule,
    // Members who fly here, and anyone else with a flight in the last year.
    pilots: members
      .filter((m) => m.clubMember || byPilot.has(m.id))
      .map((m) => clubPilot(m, byPilot.get(m.id) ?? [], now)),
    recentFlights: flights.filter((f) => f.flownOn.getTime() >= cutoff).map(clubFlight),
  };
}
