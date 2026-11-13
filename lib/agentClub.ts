// What a CLUB-DATA key reads beyond a member's own view (GET /api/agent/club,
// and the get_club_flights / get_pilots MCP tools): the club's flight log with
// pilots named, and every pilot's ratings, total time and recent flying. The
// db half; the shaping is clubFlight / clubPilot in agentView.ts.
//
// Only a key made by an admin with "club data" ticked, whose member is STILL
// an admin, gets here (`canReadClub` in lib/accessKeyAuth.ts). Read-only like
// the rest: nothing is synced, materialised or swept.
import { prisma } from "./prisma";
import { CLUB_TIME_ZONE } from "./constants";
import { CLUB_RECENT_DAYS, clubFlight, clubPilot, type ClubPilotFlight } from "./agentView";
import { readAircraft, readBookings } from "./agentSnapshot";
import type { KeyUser } from "./accessKeyAuth";

/** The club's flights over the last `days` days, newest first, pilots named. */
export async function readClubFlights(now: Date, days = CLUB_RECENT_DAYS) {
  const from = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.flight.findMany({
    where: { flownOn: { gte: from } },
    orderBy: [{ flownOn: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
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
      aircraft: { select: { tailNumber: true } },
      instructor: { select: { name: true } },
      pilot: { select: { name: true } },
    },
  });
  return { window: { from: from.toISOString(), to: now.toISOString() }, flights: rows.map(clubFlight) };
}

/** Every member and instructor, with what they've told the club and what the log shows. */
export async function readPilots(now: Date) {
  const [people, flights] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ clubMember: true }, { positions: { has: "INSTRUCTOR" } }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        certificate: true,
        totalTimeHours: true,
        clubMember: true,
        positions: true,
      },
    }),
    // The whole log, a few columns of it: a club's worth of flights is small,
    // and "last flew" has to look past any window.
    prisma.flight.findMany({
      select: {
        userId: true,
        flownOn: true,
        tachStart: true,
        tachEnd: true,
        hobbsStart: true,
        hobbsEnd: true,
        landings: true,
        nightLandings: true,
      },
    }),
  ]);
  const byPilot = new Map<string, ClubPilotFlight[]>();
  for (const { userId, ...flight } of flights) {
    const list = byPilot.get(userId) ?? [];
    list.push(flight);
    byPilot.set(userId, list);
  }
  return {
    note:
      "Certificate and total time are what each pilot entered on their profile (null when blank). " +
      `Hours, landings and "last flew" come from this club's log only. Recent = the last ${CLUB_RECENT_DAYS} days.`,
    pilots: people.map((p) => clubPilot(p, byPilot.get(p.id) ?? [], now)),
  };
}

/** Everything GET /api/agent/club answers: the log, the pilots, the schedule, the airplanes. */
export async function clubSnapshot(user: KeyUser, now = new Date()) {
  const [log, pilots, schedule, aircraft] = await Promise.all([
    readClubFlights(now),
    readPilots(now),
    readBookings(user, now),
    readAircraft(now),
  ]);
  return {
    generatedAt: now.toISOString(),
    clubTimeZone: CLUB_TIME_ZONE,
    recentFlights: log,
    pilots,
    bookings: schedule,
    aircraft,
  };
}
