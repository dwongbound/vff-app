// Seed data: the club airplane, an admin login, a couple of demo members, and
// enough schedule/log history that every tab has something to show.
//
// Idempotent — safe to re-run (docker compose runs it on every dev boot).
// Rows are keyed by natural identifiers (email, tail number) and upserted;
// the demo bookings/flights are only created when the log is empty, so a
// reseed never piles duplicates onto a database you've been using.
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed.");
const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@vffclub.test";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "flyvff123";
const TAIL_NUMBER = process.env.SEED_TAIL_NUMBER ?? "N172VF";

// Demo members so the calendar isn't a single-colour wall of "You".
const MEMBERS = [
  { name: "Dana Ruiz", email: "dana@vffclub.test", certificate: "Private Pilot ASEL" },
  { name: "Sam Okafor", email: "sam@vffclub.test", certificate: "Student" },
  { name: "Priya Raman", email: "priya@vffclub.test", certificate: "CFI" },
];

/** Local midnight n days from today, at the given hour. */
function day(offsetDays: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { isAdmin: true },
    create: {
      email: ADMIN_EMAIL,
      username: ADMIN_EMAIL,
      name: "Club Admin",
      passwordHash,
      isAdmin: true,
      certificate: "Commercial ASEL",
    },
  });

  const members = [];
  for (const member of MEMBERS) {
    members.push(
      await prisma.user.upsert({
        where: { email: member.email },
        update: {},
        create: {
          email: member.email,
          username: member.email,
          name: member.name,
          // Every demo member shares the admin password, so you can sign in as
          // any of them while poking at the app.
          passwordHash,
          certificate: member.certificate,
        },
      })
    );
  }

  const aircraft = await prisma.aircraft.upsert({
    where: { tailNumber: TAIL_NUMBER },
    update: {},
    create: {
      tailNumber: TAIL_NUMBER,
      model: "Cessna 172S Skyhawk",
      year: 2004,
      // $165/hr wet — change it on the airplane once you know the club's rate.
      hourlyRateCents: 16_500,
      fuelCapacityGal: 53,
      homeBase: "KRHV",
      lastTach: 4821.6,
      lastHobbs: 5310.2,
      notes: "Orange and white. Keys in the clubhouse lockbox.",
    },
  });

  // Demo history, only on a fresh database.
  const existingFlights = await prisma.flight.count();
  if (existingFlights === 0) {
    await prisma.flight.create({
      data: {
        aircraftId: aircraft.id,
        userId: members[0].id,
        flownOn: day(-3, 12),
        tachStart: 4819.4,
        tachEnd: 4821.6,
        hobbsStart: 5307.7,
        hobbsEnd: 5310.2,
        landings: 3,
        departure: "KRHV",
        arrival: "KRHV",
        route: "KRHV → KWVI → practice area → KRHV",
        fuelAddedGal: 18.4,
        fuelCostCents: 11_040,
        oilAddedQts: 1,
        notes: "Smooth air over the valley. Topped both tanks after.",
      },
    });

    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: members[0].id,
        title: "Right brake feels soft",
        description:
          "Pedal travels most of the way before it bites. Airworthy, but worth a look.",
        severity: "MONITOR",
      },
    });
  }

  const existingReservations = await prisma.reservation.count();
  if (existingReservations === 0) {
    await prisma.reservation.createMany({
      data: [
        {
          aircraftId: aircraft.id,
          userId: admin.id,
          startsAt: day(1, 9),
          endsAt: day(1, 12),
          purpose: "LOCAL",
          notes: "Coastal loop if the fog burns off.",
        },
        {
          aircraftId: aircraft.id,
          userId: members[1].id,
          startsAt: day(2, 14),
          endsAt: day(2, 16),
          purpose: "TRAINING",
          notes: "Pattern work with Priya.",
        },
        {
          aircraftId: aircraft.id,
          userId: members[2].id,
          startsAt: day(5, 8),
          endsAt: day(5, 17),
          purpose: "CROSS_COUNTRY",
          notes: "KRHV → KSBP and back.",
        },
        {
          aircraftId: aircraft.id,
          userId: admin.id,
          startsAt: day(9, 8),
          endsAt: day(9, 18),
          purpose: "MAINTENANCE",
          notes: "Oil change + 100-hour.",
        },
      ],
    });
  }

  console.log(
    `Seeded ${aircraft.tailNumber}. Sign in as ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}` +
      ` (demo members share that password).`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
