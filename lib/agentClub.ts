// What a CLUB-DATA key reads beyond a member's own view (GET /api/agent/club,
// and the get_pilots MCP tool): every pilot's ratings, total time and landings
// in the last 90 days, and the schedule. The db half; the shaping is
// clubPilot in agentView.ts.
//
// Deliberately narrow: it answers what the club officer asked and no more —
// no flight-by-flight log, no hours, no email. Only a key made by an admin
// with "club data" ticked, whose member is STILL an admin, gets here
// (`canReadClub` in lib/accessKeyAuth.ts). Read-only like the rest.
import { prisma } from "./prisma";
import { CLUB_TIME_ZONE } from "./constants";
import { CLUB_RECENT_DAYS, clubPilot, type ClubPilotFlight } from "./agentView";
import { readBookings } from "./agentSnapshot";
import type { KeyUser } from "./accessKeyAuth";

/** Every member and instructor: ratings, total time, landings in the last 90 days. */
export async function readPilots(now: Date) {
  const from = new Date(now.getTime() - CLUB_RECENT_DAYS * 86_400_000);
  const [people, flights] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ clubMember: true }, { positions: { has: "INSTRUCTOR" } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, certificate: true, totalTimeHours: true },
    }),
    prisma.flight.findMany({
      where: { flownOn: { gte: from } },
      select: { userId: true, flownOn: true, landings: true },
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
      `Landings are from this club's log over the last ${CLUB_RECENT_DAYS} days; a flight with no landing count counts as 1.`,
    pilots: people.map((p) => clubPilot(p, byPilot.get(p.id) ?? [], now)),
  };
}

/** Everything GET /api/agent/club answers: the pilots and the schedule. */
export async function clubSnapshot(user: KeyUser, now = new Date()) {
  const [pilots, schedule] = await Promise.all([readPilots(now), readBookings(user, now)]);
  return {
    generatedAt: now.toISOString(),
    clubTimeZone: CLUB_TIME_ZONE,
    pilots,
    bookings: schedule,
  };
}
