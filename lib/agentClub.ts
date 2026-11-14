// What a CLUB-DATA key reads beyond a member's own view (GET /api/agent/club,
// and the get_pilots / get_last_flown MCP tools): who flew each airplane last,
// every pilot's ratings, total time and landings in the last 90 days, and the
// schedule. The db half; the shaping is clubLastFlown / clubPilot in
// agentView.ts.
//
// Deliberately narrow: it answers what the club officer asked and no more —
// no flight-by-flight log, no hours, no email. Only a key made by an admin
// with "club data" ticked, whose member is STILL an admin, gets here
// (`canReadClub` in lib/accessKeyAuth.ts). Read-only like the rest.
import { prisma } from "./prisma";
import { CLUB_TIME_ZONE } from "./constants";
import { CLUB_RECENT_DAYS, clubLastFlown, clubPilot, type ClubPilotFlight } from "./agentView";
import { readBookings } from "./agentSnapshot";
import type { KeyUser } from "./accessKeyAuth";

/** Each active airplane and the last FILED flight on it: who flew it, and which day. */
export async function readLastFlown() {
  const planes = await prisma.aircraft.findMany({
    where: { active: true },
    orderBy: { tailNumber: "asc" },
    select: {
      tailNumber: true,
      flights: {
        // An open session hasn't come back yet: "flew it last" means a filed flight.
        where: { filedAt: { not: null } },
        orderBy: [{ flownOn: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { flownOn: true, pilot: { select: { name: true } } },
      },
    },
  });
  return planes.map((p) => clubLastFlown({ tailNumber: p.tailNumber, flight: p.flights[0] ?? null }));
}

/** Every member and instructor: ratings, total time, landings in the last 90 days. */
export async function readPilots(now: Date) {
  const from = new Date(now.getTime() - CLUB_RECENT_DAYS * 86_400_000);
  const [people, flights] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ clubMember: true }, { positions: { has: "INSTRUCTOR" } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, certificate: true },
    }),
    prisma.flight.findMany({
      // Filed flights only: an open session is a flight still in the air.
      where: { flownOn: { gte: from }, filedAt: { not: null } },
      select: {
        userId: true,
        flownOn: true,
        landings: true,
        tachStart: true,
        tachEnd: true,
        hobbsStart: true,
        hobbsEnd: true,
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
      "Certificate is what each pilot entered on their profile (null when blank). " +
      `Landings, Hobbs hours and tach hours are from this club's filed flights over the last ${CLUB_RECENT_DAYS} days; ` +
      "a flight with no landing count counts as 1, and a flight missing a meter reading adds no hours to that meter.",
    pilots: people.map((p) => clubPilot(p, byPilot.get(p.id) ?? [], now)),
  };
}

/** Everything GET /api/agent/club answers: who flew last, the pilots and the schedule. */
export async function clubSnapshot(user: KeyUser, now = new Date()) {
  const [lastFlown, pilots, schedule] = await Promise.all([
    readLastFlown(),
    readPilots(now),
    readBookings(user, now),
  ]);
  return {
    generatedAt: now.toISOString(),
    clubTimeZone: CLUB_TIME_ZONE,
    lastFlown,
    pilots,
    bookings: schedule,
  };
}
