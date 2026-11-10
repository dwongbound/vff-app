// Everything an access key reads, in ONE answer: the db half of agentView.ts.
// GET /api/agent returns it whole, and the MCP endpoint hands out its sections
// as tools. Read-only: no Google sync, no dues materialised, no sweeps — a read
// through a key changes nothing but the key's own "last used".
//
// What the member SEES is the rule for what's here: the fleet, every open
// squawk and the maintenance sheet (all open to members), the club's bookings
// (the calendar every member reads), THEIR OWN flight log and THEIR OWN money.
// Never another member's statement, paperwork or log.
import { prisma } from "./prisma";
import { can } from "./positions";
import { CLUB_TIME_ZONE } from "./constants";
import { soloEligibility, TIER_LABELS } from "./operatingRules";
import { totalTachHours } from "./hours";
import { agentAircraft, agentBooking, agentFlight, agentMoney } from "./agentView";
import type { KeyUser } from "./accessKeyAuth";
import { AGENT_SECTIONS, type AgentSection } from "./agentTools";

/** How far ahead the club's calendar is read. */
export const AGENT_BOOKING_DAYS = 30;
/** How many of the member's own flights come back, newest first. */
export const AGENT_RECENT_FLIGHTS = 15;

/** One section's data, by name — what each MCP tool returns. */
export async function agentSection(user: KeyUser, section: AgentSection, now = new Date()) {
  switch (section) {
    case "aircraft":
      return readAircraft(now);
    case "bookings":
      return readBookings(user, now);
    case "flying":
      return readFlying(user, now);
    case "money":
      return readMoney(user);
  }
}

/** The whole snapshot: who the key belongs to, and every section. */
export async function agentSnapshot(user: KeyUser, now = new Date()) {
  const [aircraft, bookings, flying, money] = await Promise.all(
    AGENT_SECTIONS.map((s) => agentSection(user, s, now))
  );
  return {
    generatedAt: now.toISOString(),
    clubTimeZone: CLUB_TIME_ZONE,
    member: { name: user.name, email: user.email, offices: user.positions, isAdmin: user.isAdmin },
    aircraft,
    bookings,
    flying,
    money,
  };
}

async function readAircraft(now: Date) {
  const rows = await prisma.aircraft.findMany({
    where: { active: true },
    orderBy: { tailNumber: "asc" },
    select: {
      tailNumber: true,
      model: true,
      homeBase: true,
      hourlyRateCents: true,
      lastTach: true,
      lastHobbs: true,
      squawks: {
        where: { status: { not: "CLOSED" } },
        orderBy: { createdAt: "desc" },
        select: { title: true, status: true, createdAt: true },
      },
      maintenance: { where: { active: true } },
    },
  });
  return rows.map((row) => agentAircraft(row, now));
}

async function readBookings(user: KeyUser, now: Date) {
  const until = new Date(now.getTime() + AGENT_BOOKING_DAYS * 86_400_000);
  const rows = await prisma.reservation.findMany({
    // Still running counts: a booking you're in the middle of is "upcoming"
    // to anyone asking what's next.
    where: { status: { not: "CANCELED" }, endsAt: { gt: now }, startsAt: { lt: until } },
    orderBy: { startsAt: "asc" },
    select: {
      startsAt: true,
      endsAt: true,
      allDay: true,
      purpose: true,
      title: true,
      notes: true,
      userId: true,
      instructorId: true,
      user: { select: { name: true } },
      instructor: { select: { name: true } },
      aircraft: { select: { tailNumber: true } },
    },
  });
  return {
    window: { from: now.toISOString(), to: until.toISOString() },
    bookings: rows.map((row) => agentBooking(row, user.id)),
  };
}

async function readFlying(user: KeyUser, now: Date) {
  const flights = await prisma.flight.findMany({
    where: { userId: user.id },
    orderBy: [{ flownOn: "desc" }, { createdAt: "desc" }],
    select: {
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
      signedAt: true,
      aircraft: { select: { tailNumber: true } },
      instructor: { select: { name: true } },
    },
  });
  const solo = soloEligibility({ totalTimeHours: user.totalTimeHours, flights, now });
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return {
    declaredTotalTimeHours: user.totalTimeHours,
    hoursInClubLogLast12Months: solo.recentHours,
    hoursInClubLogThisYear:
      Math.round(totalTachHours(flights.filter((f) => f.flownOn >= yearStart)) * 10) / 10,
    operatingRulesColumn: TIER_LABELS[solo.tier],
    landingCurrency: {
      windowDays: solo.windowDays,
      dayLandings: solo.dayLandings,
      nightLandings: solo.nightLandings,
      maySoloByDay: solo.daySolo,
      maySoloAtNight: solo.nightSolo,
      why: [...solo.dayBlockers, ...solo.nightBlockers],
      note: "From this club's log only; flying elsewhere isn't counted.",
    },
    recentFlights: flights.slice(0, AGENT_RECENT_FLIGHTS).map(agentFlight),
  };
}

async function readMoney(user: KeyUser) {
  // An instructor-only account has no statement — the same 403 Finances gives.
  if (!can(user, "finance:read-own")) return null;
  const unpaid = await prisma.charge.findMany({
    where: { memberId: user.id, deletedAt: null, voided: false, paidAt: null },
    select: { kind: true, amountCents: true, description: true, incurredOn: true },
  });
  return agentMoney(unpaid);
}
