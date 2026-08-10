// Seed data: the club airplane, an admin login, a demo roster, and enough
// history behind them that every tab has something real to show — a year of
// flying, a statement with lines on it, squawks in every state of triage,
// signed-off checkouts and a schedule.
//
// Idempotent — safe to re-run (docker compose runs it on every dev boot).
// Rows are keyed by natural identifiers (email, tail number) and upserted;
// the demo bookings/flights are only created when the log is empty, so a
// reseed never piles duplicates onto a database you've been using.
//
// ONE thing here is transcribed rather than invented: FLIGHT_LOG, N8318B's own
// log off the club's Google Sheet. Everything around it — the people, the
// squawks, the earlier and later flights — is made up. See the comment on each.
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { chargesForFlight, periodOf, servicingCredit } from "../lib/finance";
import {
  PREFLIGHT_CHECKOUT,
  RUNWAY_CHECKOUT,
  TURNOFF_CHECKOUT,
  allItemIds,
  deriveFuelOil,
  derivePutAway,
  type Answers,
  type Values,
} from "../lib/checkouts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed.");
const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@vffclub.test";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "flyvff123";
const TAIL_NUMBER = process.env.SEED_TAIL_NUMBER ?? "N8318B";

/** Mirrors the `Position` enum in schema.prisma. */
type Position =
  | "PRESIDENT"
  | "VICE_PRESIDENT"
  | "SECRETARY"
  | "FINANCE_OFFICER"
  | "SAFETY_OFFICER"
  | "MAINTENANCE_OFFICER"
  | "INSTRUCTOR";

// The demo roster — INVENTED PEOPLE, and deliberately so.
//
// The club's flight sheet names the real members who flew each row, and the
// seed used to carry those names and their email addresses straight into every
// developer's database, every screenshot and every CI log. Demo data has no
// business holding somebody's contact details, so the roster below is fiction
// and the real log rows are attributed to it (see FLIGHT_LOG's `pic`).
//
// Phone numbers are 555-01xx, the block reserved for fiction, on Seattle's area
// code to match the home field. They are here because the roster is the club's
// phone list — "call the Safety Officer" only works if his number is on it.
//
// Offices are spread around so every capability in lib/positions.ts is held by
// somebody who is NOT an admin, which is the only way to see that the position
// checks do any work. The first member deliberately holds nothing at all: the
// e2e suite uses them as its plain-member account.
const MEMBERS: {
  name: string;
  email: string;
  phone: string;
  positions?: Position[];
  /** Absent means true — a flying member. */
  clubMember?: boolean;
  certificate?: string;
  totalTimeHours?: number;
  medicalExpiresOn?: Date;
  flightReviewOn?: Date;
}[] = [
  {
    name: "Alex Rivera",
    email: "alex@vffclub.test",
    phone: "(206) 555-0118",
    certificate: "Private Pilot ASEL",
    totalTimeHours: 412,
    medicalExpiresOn: new Date("2027-04-30T12:00:00Z"),
    flightReviewOn: new Date("2025-10-12T12:00:00Z"),
  },
  {
    name: "Sam Okafor",
    email: "sam@vffclub.test",
    phone: "(206) 555-0127",
    positions: ["SAFETY_OFFICER"],
    certificate: "Private Pilot ASEL / IR",
    totalTimeHours: 268,
    medicalExpiresOn: new Date("2026-11-30T12:00:00Z"),
    flightReviewOn: new Date("2026-02-08T12:00:00Z"),
  },
  {
    // The club's student, and the member the seeded lesson belongs to. Low
    // time on purpose: the operating rules read differently for them than for
    // everyone else, which is the whole point of the limits card.
    name: "Jamie Chen",
    email: "jamie@vffclub.test",
    phone: "(206) 555-0139",
    certificate: "Student",
    totalTimeHours: 58,
  },
  {
    name: "Robin Patel",
    email: "robin@vffclub.test",
    phone: "(206) 555-0146",
    positions: ["FINANCE_OFFICER"],
    certificate: "Private Pilot ASEL",
    totalTimeHours: 321,
    flightReviewOn: new Date("2025-06-21T12:00:00Z"),
  },
  {
    name: "Casey Nguyen",
    email: "casey@vffclub.test",
    phone: "(206) 555-0153",
    positions: ["PRESIDENT"],
    certificate: "Commercial ASEL",
    totalTimeHours: 690,
  },
  {
    name: "Morgan Ellis",
    email: "morgan@vffclub.test",
    phone: "(206) 555-0164",
    positions: ["MAINTENANCE_OFFICER"],
    certificate: "Private Pilot ASEL",
    totalTimeHours: 184,
  },
  {
    // A CFI who ALSO rents the airplane — the other half of the instructor
    // story from Priya below, and the case `clubMember` exists to tell apart:
    // he teaches here AND flies here, so he gets the full app.
    name: "Drew Kowalski",
    email: "drew@vffclub.test",
    phone: "(206) 555-0172",
    positions: ["INSTRUCTOR"],
    certificate: "CFI / Commercial ASEL",
    totalTimeHours: 1460,
  },
  {
    name: "Taylor Brooks",
    email: "taylor@vffclub.test",
    phone: "(206) 555-0185",
    certificate: "Private Pilot ASEL",
    totalTimeHours: 97,
  },
];

/** The roster's plain member — no admin flag, no office. Used by the e2e suite. */
const PLAIN_MEMBER = MEMBERS[0];
/** The student the seeded lesson was flown by. */
const STUDENT = MEMBERS[2];
/** The Safety Officer, who triages the seeded squawks. */
const SAFETY_OFFICER = MEMBERS[1];
/** The Finance Officer, who raised the seeded one-off lines. */
const FINANCE_OFFICER = MEMBERS[3];

// The club's visiting instructor: a CFI who teaches here without being a
// member, so she has no bookings of her own, no statement, and a read-only
// calendar. The reduced account in its pure form — Drew above is the other
// shape, a CFI who is a flying member too.
const INSTRUCTOR = {
  name: "Priya Raman",
  email: "priya@vffclub.test",
  phone: "(206) 555-0191",
  certificate: "CFI / CFII",
};

// Demo accounts from before the roster was fictionalised.
//
// They were named after real members of the club and carried their email
// addresses. Deleting them cascades their demo flights, charges, squawks and
// bookings away, which is what lets the blocks below rebuild the same history
// under the invented roster — so a dev database that predates this change ends
// up with the club the seed now describes rather than a mix of the two.
const RETIRED_DEMO_EMAILS = [
  "marat@vffclub.test",
  "geo@vffclub.test",
  "dylan@vffclub.test",
  "nikolai@vffclub.test",
];

/** A flight to seed, PIC named by their roster email. */
interface SeedFlight {
  pic: string;
  tachStart: number;
  tachEnd: number;
  landings?: number;
  nightLandings?: number;
  fuelGal?: number;
  fuelCents?: number;
  departure?: string;
  arrival?: string;
  /** Flown with the club's CFI, and (when signed) endorsed by her. */
  withInstructor?: boolean;
  signed?: boolean;
  note?: string;
}

// The year before the sheet — INVENTED.
//
// The club's transcribed log opens at a tach of 1488.0 with no explanation of
// where the airplane had been, which leaves every "hours in the last 12 months"
// question in the app answerable only for one week. These rows are made up to
// fill that in, and they chain EXACTLY into 1488.0 so the two halves read as
// one meter. Fixed calendar dates rather than relative ones: this is history,
// and history doesn't slide forward every time somebody reseeds.
const EARLIER_FLIGHTS: (SeedFlight & { on: [number, number, number] })[] = [
  { on: [2025, 9, 6], pic: "casey@vffclub.test", tachStart: 1441.2, tachEnd: 1442.6, landings: 3 },
  { on: [2025, 9, 21], pic: "alex@vffclub.test", tachStart: 1442.6, tachEnd: 1444.1, landings: 4 },
  {
    on: [2025, 10, 4],
    pic: "taylor@vffclub.test",
    tachStart: 1444.1,
    tachEnd: 1446.3,
    landings: 2,
    departure: "KBFI",
    arrival: "KCLM",
    fuelGal: 21.4,
    fuelCents: 15_301,
  },
  { on: [2025, 10, 18], pic: "sam@vffclub.test", tachStart: 1446.3, tachEnd: 1447.8, landings: 6 },
  {
    on: [2025, 11, 2],
    pic: "alex@vffclub.test",
    tachStart: 1447.8,
    tachEnd: 1450.6,
    landings: 2,
    nightLandings: 2,
    departure: "KBFI",
    arrival: "KPDX",
    note: "Back after dark; landing light worth a look.",
  },
  { on: [2025, 11, 15], pic: "robin@vffclub.test", tachStart: 1450.6, tachEnd: 1452, landings: 5 },
  {
    on: [2025, 11, 29],
    pic: "drew@vffclub.test",
    tachStart: 1452,
    tachEnd: 1453.2,
    landings: 4,
    fuelGal: 18.2,
    fuelCents: 13_286,
  },
  { on: [2025, 12, 13], pic: "casey@vffclub.test", tachStart: 1453.2, tachEnd: 1455.1, landings: 3 },
  { on: [2026, 1, 10], pic: "alex@vffclub.test", tachStart: 1455.1, tachEnd: 1456.7, landings: 4 },
  { on: [2026, 1, 24], pic: "morgan@vffclub.test", tachStart: 1456.7, tachEnd: 1458.3, landings: 3 },
  {
    on: [2026, 2, 7],
    pic: "taylor@vffclub.test",
    tachStart: 1458.3,
    tachEnd: 1461.4,
    landings: 2,
    departure: "KBFI",
    arrival: "KEAT",
    fuelGal: 24.8,
    fuelCents: 18_104,
  },
  { on: [2026, 2, 21], pic: "sam@vffclub.test", tachStart: 1461.4, tachEnd: 1463, landings: 5 },
  {
    on: [2026, 3, 7],
    pic: "jamie@vffclub.test",
    tachStart: 1463,
    tachEnd: 1464.2,
    landings: 9,
    withInstructor: true,
    signed: true,
    note: "First lesson in type. Pattern work.",
  },
  {
    on: [2026, 3, 21],
    pic: "jamie@vffclub.test",
    tachStart: 1464.2,
    tachEnd: 1465.5,
    landings: 11,
    withInstructor: true,
    signed: true,
    note: "Slow flight and stalls, then six in the pattern.",
  },
  {
    on: [2026, 4, 4],
    pic: "alex@vffclub.test",
    tachStart: 1465.5,
    tachEnd: 1468.1,
    landings: 2,
    departure: "KBFI",
    arrival: "KFHR",
  },
  { on: [2026, 4, 18], pic: "robin@vffclub.test", tachStart: 1468.1, tachEnd: 1469.9, landings: 4 },
  {
    on: [2026, 5, 2],
    pic: "casey@vffclub.test",
    tachStart: 1469.9,
    tachEnd: 1471.6,
    landings: 3,
    fuelGal: 20.1,
    fuelCents: 14_673,
  },
  {
    on: [2026, 5, 16],
    pic: "taylor@vffclub.test",
    tachStart: 1471.6,
    tachEnd: 1474.8,
    landings: 2,
    departure: "KBFI",
    arrival: "KSFF",
  },
  { on: [2026, 5, 30], pic: "morgan@vffclub.test", tachStart: 1474.8, tachEnd: 1476.2, landings: 5 },
  {
    on: [2026, 6, 13],
    pic: "alex@vffclub.test",
    tachStart: 1476.2,
    tachEnd: 1478.5,
    landings: 3,
    fuelGal: 22.6,
    fuelCents: 16_498,
  },
  { on: [2026, 6, 27], pic: "sam@vffclub.test", tachStart: 1478.5, tachEnd: 1480.4, landings: 4 },
  {
    on: [2026, 7, 4],
    pic: "jamie@vffclub.test",
    tachStart: 1480.4,
    tachEnd: 1481.9,
    landings: 12,
    withInstructor: true,
    signed: true,
    note: "Crosswind day. Twelve landings, two of them worth keeping.",
  },
  { on: [2026, 7, 11], pic: "drew@vffclub.test", tachStart: 1481.9, tachEnd: 1483.6, landings: 3 },
  {
    on: [2026, 7, 18],
    pic: "taylor@vffclub.test",
    tachStart: 1483.6,
    tachEnd: 1486,
    landings: 2,
    departure: "KBFI",
    arrival: "KHQM",
    fuelGal: 23.9,
    fuelCents: 17_447,
  },
  { on: [2026, 7, 25], pic: "alex@vffclub.test", tachStart: 1486, tachEnd: 1488, landings: 4 },
];

// N8318B's flight log, transcribed from the club's Google Sheet as it stood on
// 8 Aug 2026 (rows 4–11, oldest row first in the sheet's own order).
//
// Left EXACTLY as logged, including the two places the tach doesn't chain
// (1489 → 1489.98, and 1499.42 → 1499.49) and the one row the sheet carries no
// date for. Tidying those away here would hide precisely the kind of gap the
// app exists to surface — and they're also why the post-flight form prefills
// the tach rather than enforcing it.
//
// What the sheet does NOT record is not invented: landings (the column doesn't
// exist, so rows take the model's default of 1), Hobbs (this airplane's log is
// tach-only), routes, and oil. Row 4 has a price per gallon and a total but no
// quantity, so only the total is carried across.
//
// The one substitution: the sheet's PIC column names real people, so each row
// is attributed to the invented member who stands in for them (see MEMBERS).
const FLIGHT_LOG: (SeedFlight & { on: [number, number, number] })[] = [
  {
    on: [2026, 8, 1],
    pic: "alex@vffclub.test",
    tachStart: 1488,
    tachEnd: 1489,
    // $70.00 at $7/gal — about 10 gallons, but the sheet's quantity cell is
    // empty, so the gallons stay empty here too.
    fuelCents: 7_000,
  },
  { on: [2026, 7, 30], pic: "sam@vffclub.test", tachStart: 1489.98, tachEnd: 1491.17 },
  {
    on: [2026, 7, 31],
    pic: "alex@vffclub.test",
    tachStart: 1491.17,
    tachEnd: 1492.6,
    fuelGal: 26.89,
    fuelCents: 19_226, // 26.89 gal @ $7.15
  },
  {
    on: [2026, 8, 1],
    pic: "alex@vffclub.test",
    tachStart: 1492.6,
    tachEnd: 1497.38,
    fuelCents: 16_073,
  },
  { on: [2026, 8, 5], pic: "jamie@vffclub.test", tachStart: 1497.38, tachEnd: 1498.34 },
  {
    on: [2026, 8, 6],
    pic: "robin@vffclub.test",
    tachStart: 1498.34,
    tachEnd: 1499.42,
    fuelGal: 24.35,
    fuelCents: 17_897, // 24.35 gal @ $7.35
  },
  {
    // The sheet leaves this row's date blank. Its tach sits between the 8/6
    // and 8/7 flights, which is the only thing placing it — recorded here as
    // 8/6 with the guess stated rather than left out of the log entirely.
    on: [2026, 8, 6],
    pic: "alex@vffclub.test",
    tachStart: 1499.49,
    tachEnd: 1500.5,
    fuelGal: 0,
    note: "Date missing from the club sheet; placed here by its tach reading.",
  },
  { on: [2026, 8, 7], pic: "jamie@vffclub.test", tachStart: 1500.5, tachEnd: 1501.46, fuelGal: 0 },
];

// The last few days — INVENTED, and dated RELATIVE to whenever the seed runs,
// so a freshly seeded club always has current flying in it. That's what the
// landing-currency card and "hours this month" need to say anything.
//
// The tach picks up where the seeded lesson leaves off (LESSON_TACH below), and
// the day offsets keep these strictly after it, so the meter climbs in the same
// order as the calendar.
const RECENT_FLIGHTS: (SeedFlight & { daysAgo: number })[] = [
  {
    daysAgo: 2,
    pic: "taylor@vffclub.test",
    tachStart: 1502.86,
    tachEnd: 1504.5,
    landings: 3,
    departure: "KBFI",
    arrival: "KTIW",
    fuelGal: 22.4,
    fuelCents: 16_464,
    note: "Tacoma and back for lunch.",
  },
  {
    daysAgo: 1,
    pic: "alex@vffclub.test",
    tachStart: 1504.5,
    tachEnd: 1505.95,
    landings: 4,
    nightLandings: 3,
    note: "Night currency — three to a full stop.",
  },
];

/** The seeded lesson's meters, chaining out of the club sheet's last row. */
const LESSON_TACH = { start: 1501.46, end: 1502.86 };
/** Where the airplane's meter ends up once everything above is filed. */
const FINAL_TACH = RECENT_FLIGHTS[RECENT_FLIGHTS.length - 1].tachEnd;

// N8318B's weight & balance basis, transcribed from its Weight/Balance &
// Equipment List Revision — Van Ness Enterprises, W/B date 27 Nov 2021, which
// supersedes the figures in the back of the 1958 owner's manual:
//
//   empty weight 1353.48 lb · arm 38.7200476 in · moment 52406.81 lb-in
//   useful load 846.514 lb (= 2200 lb gross)
//
// The moment is stored rather than the arm, because the moment is what the
// sheet totals and what the sum actually uses; the arm is a division. The
// stations and CG envelope are NOT here — they belong to the type, and live in
// lib/weightBalance.ts under this profile id.
const WEIGHT_BALANCE = {
  wbProfile: "c172-1958",
  emptyWeightLbs: 1353.48,
  emptyMomentLbIn: 52406.81,
  // Noon UTC rather than midnight: this is a calendar date, and midnight UTC
  // renders as the day before anywhere west of Greenwich.
  weighedOn: new Date("2021-11-27T12:00:00Z"),
};

/**
 * Local NOON on a calendar date. Noon rather than midnight so no timezone the
 * app is read in can slide a logged flight onto the day before.
 */
function on([year, month, dayOfMonth]: [number, number, number]): Date {
  return new Date(year, month - 1, dayOfMonth, 12, 0, 0, 0);
}

/** Local midnight n days from today, at the given hour. */
function day(offsetDays: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** A completed run of a checkout card: every item on it ticked. */
function everyItem(kind: "PREFLIGHT" | "RUNWAY" | "TURNOFF"): Answers {
  return Object.fromEntries(allItemIds(kind).map((id) => [id, true]));
}

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Retire the demo accounts that were named after real people, before
  // anything else — see RETIRED_DEMO_EMAILS. `deleteMany` on a fresh database
  // matches nothing and costs one query.
  const retired = await prisma.user.deleteMany({
    where: { email: { in: RETIRED_DEMO_EMAILS } },
  });
  if (retired.count > 0) {
    console.log(
      `Removed ${retired.count} demo account(s) named after real club members;` +
        " their demo history goes with them and is rebuilt below."
    );
  }

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { isAdmin: true },
    create: {
      email: ADMIN_EMAIL,
      username: ADMIN_EMAIL,
      name: "Club Admin",
      phone: "(206) 555-0100",
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
          phone: member.phone,
          // Every seeded member shares the admin password, so you can sign in
          // as any of them while poking at the app.
          passwordHash,
          positions: member.positions ?? [],
          clubMember: member.clubMember ?? true,
          certificate: member.certificate ?? null,
          totalTimeHours: member.totalTimeHours ?? null,
          medicalExpiresOn: member.medicalExpiresOn ?? null,
          flightReviewOn: member.flightReviewOn ?? null,
        },
      })
    );
  }

  /** Roster lookup by email — how the seeded history names its pilots. */
  const byEmail = new Map(members.map((m) => [m.email!, m]));
  const memberBy = (email: string) => {
    const found = byEmail.get(email);
    if (!found) throw new Error(`No seeded member ${email}.`);
    return found;
  };

  // `update` rather than `{}`: a database seeded before instructor accounts
  // existed already has this row as a plain member, and the point of reseeding
  // is to end up with the club the seed describes.
  const instructor = await prisma.user.upsert({
    where: { email: INSTRUCTOR.email },
    update: { positions: ["INSTRUCTOR"], clubMember: false },
    create: {
      email: INSTRUCTOR.email,
      username: INSTRUCTOR.email,
      name: INSTRUCTOR.name,
      phone: INSTRUCTOR.phone,
      passwordHash,
      certificate: INSTRUCTOR.certificate,
      positions: ["INSTRUCTOR"],
      // Teaches here, doesn't fly here. An admin ticks "flying member" on the
      // Members tab if that ever changes.
      clubMember: false,
    },
  });

  // Sign-up codes, one per list, so a fresh install has a working front door
  // instead of a club nobody can join. Upserted by code: re-running the seed
  // must not resurrect a code an admin deliberately retired, which is why
  // `update` leaves `active` alone.
  for (const code of [
    { code: "VFF-MEMBER", kind: "MEMBER" as const, label: "Seeded member code" },
    { code: "VFF-CFI", kind: "INSTRUCTOR" as const, label: "Seeded instructor code" },
  ]) {
    await prisma.signupCode.upsert({
      where: { code: code.code },
      update: {},
      create: { ...code, createdById: admin.id },
    });
  }

  const aircraft = await prisma.aircraft.upsert({
    where: { tailNumber: TAIL_NUMBER },
    update: {},
    create: {
      tailNumber: TAIL_NUMBER,
      model: "Cessna 172",
      year: 1957,
      // $135 per tach hour — the club's rate. The Finance Officer can change
      // it from the Finances tab without an admin (see lib/positions.ts).
      hourlyRateCents: 13_500,
      // 37 usable of 42 total — two 21-gallon tanks, 18.5 usable a side, per
      // the POH. Left null until the weight & balance work established it,
      // because a wrong figure here is worse than none.
      fuelCapacityGal: 37,
      homeBase: "KBFI",
      lastTach: FINAL_TACH,
      // Null, not a number: the club's log has no Hobbs column at all, and a
      // made-up reading would prefill the post-flight form with a lie.
      lastHobbs: null,
      notes:
        "Orange and white. Keys in the clubhouse lockbox. Next maintenance due:" +
        " engine oil change, ~30 Nov 2026 (the sheet said 114 days on 8 Aug 2026).",
      ...WEIGHT_BALANCE,
    },
  });

  // Backfill the POH-derived facts onto a database seeded before they existed.
  //
  // The upsert above is create-only, so an aircraft row that predates a field
  // never gets it — which is why these are separate, each guarded on the
  // column still being NULL. A reseed must never overwrite the figures an A&P
  // handed the club after the last equipment change, nor a usable-fuel number
  // the club measured itself.
  await prisma.aircraft.updateMany({
    where: { tailNumber: TAIL_NUMBER, emptyWeightLbs: null },
    data: WEIGHT_BALANCE,
  });
  await prisma.aircraft.updateMany({
    where: { tailNumber: TAIL_NUMBER, fuelCapacityGal: null },
    data: { fuelCapacityGal: 37 },
  });

  // The club's dues. Upserted by label so a reseed doesn't stack a second
  // $250 rule on top of the first — members would be billed twice a month.
  const DUES_LABEL = "Monthly membership";
  const existingDues = await prisma.recurringCharge.findFirst({
    where: { label: DUES_LABEL, memberId: null },
    select: { id: true },
  });
  if (!existingDues) {
    await prisma.recurringCharge.create({
      data: {
        label: DUES_LABEL,
        amountCents: 25_000, // $250/month, adjustable from the Finances tab
        memberId: null, // every member
        // Backdated to the start of this month so the current statement has it.
        startsOn: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        createdById: admin.id,
      },
    });
  }

  /** File one flight and the statement lines it produces. */
  async function fileFlight(entry: SeedFlight, flownOn: Date) {
    const pilot = memberBy(entry.pic);
    const flight = await prisma.flight.create({
      data: {
        aircraftId: aircraft.id,
        userId: pilot.id,
        flownOn,
        tachStart: entry.tachStart,
        tachEnd: entry.tachEnd,
        // Hobbs is absent from every row for the same reason the airplane's
        // `lastHobbs` is null: this log is tach-only.
        landings: entry.landings ?? 1,
        nightLandings: entry.nightLandings ?? 0,
        departure: entry.departure ?? null,
        arrival: entry.arrival ?? null,
        withInstructor: entry.withInstructor ?? false,
        instructorId: entry.withInstructor ? instructor.id : null,
        // A signature names a version of the entry, so the seeded ones are
        // dated with the flight rather than with the reseed.
        signedById: entry.signed ? instructor.id : null,
        signedAt: entry.signed ? flownOn : null,
        fuelAddedGal: entry.fuelGal ?? null,
        fuelCostCents: entry.fuelCents ?? null,
        notes: entry.note ?? null,
      },
    });

    // The API bills a flight as it's filed; the seed writes rows directly,
    // so it has to produce the same lines itself or the statements would
    // show dues and nothing else.
    //
    // Note this credits every recorded fuel cost back to the pilot. The
    // club's sheet has a "Fuel Purchase Personal Card" column that says
    // whether it should — every priced row here is a "Yes", so nothing is
    // mis-billed, but a flight has no column for that distinction (a
    // standalone fill-up does; see Servicing below).
    await prisma.charge.createMany({
      data: chargesForFlight(
        flight,
        aircraft.hourlyRateCents,
        aircraft.tailNumber
      ).map((line) => ({
        memberId: flight.userId,
        kind: line.kind,
        amountCents: line.amountCents,
        description: line.description,
        period: line.period,
        incurredOn: line.incurredOn,
        flightId: line.flightId,
      })),
      skipDuplicates: true,
    });
    return flight;
  }

  // The log, only on a fresh database.
  // Scoped to THIS airplane, not the whole table. A global count is how a
  // database that still held an older demo aircraft's flights ended up with
  // N8318B on the roster and an empty log against it — the guard was already
  // satisfied by rows belonging to a plane nobody flies.
  const existingFlights = await prisma.flight.count({
    where: { aircraftId: aircraft.id },
  });
  if (existingFlights === 0) {
    for (const entry of [...EARLIER_FLIGHTS, ...FLIGHT_LOG]) {
      await fileFlight(entry, on(entry.on));
    }

    // Leave the airplane where the log leaves it.
    //
    // The upsert above is create-only, so a database seeded before this log
    // existed keeps whatever meters it was given then — and would show a tach
    // of 4821.6 above a log that ends at 1505.95. Safe to overwrite HERE and
    // only here: this branch runs only when the flight log was empty, so
    // there is no meter history to preserve.
    await prisma.aircraft.update({
      where: { id: aircraft.id },
      data: { lastTach: FINAL_TACH, lastHobbs: null },
    });
  }

  // A lesson that has already been flown and filed, so a fresh install has one
  // entry sitting in the instructor's signature queue. Without it the CFI's
  // whole view of the app is an empty list, and there is nothing to click.
  //
  // Guarded on the booking not existing rather than on the flight count above:
  // this pair is created together or not at all, and the flight log seeded from
  // the club's sheet has no bookings behind it to hang this off.
  const flownLesson = await prisma.reservation.findFirst({
    where: {
      aircraftId: aircraft.id,
      instructorId: instructor.id,
      purpose: "TRAINING",
      startsAt: { lt: new Date() },
    },
    select: { id: true },
  });
  if (!flownLesson) {
    const lesson = await prisma.reservation.create({
      data: {
        aircraftId: aircraft.id,
        userId: memberBy(STUDENT.email).id,
        startsAt: day(-3, 10),
        endsAt: day(-3, 12),
        purpose: "TRAINING",
        instructorId: instructor.id,
        notes: "Short-field takeoffs and landings.",
      },
    });
    // Unsigned on purpose — that's the state the queue is for.
    await prisma.flight.create({
      data: {
        aircraftId: aircraft.id,
        userId: memberBy(STUDENT.email).id,
        reservationId: lesson.id,
        flownOn: day(-3, 10),
        tachStart: LESSON_TACH.start,
        tachEnd: LESSON_TACH.end,
        landings: 8,
        withInstructor: true,
        instructorId: instructor.id,
        departure: "KBFI",
        arrival: "KBFI",
        notes: "Eight in the pattern. Crosswind picked up on the last two.",
      },
    });
  }

  // The last couple of days' flying, filed after the lesson so the meter and
  // the calendar agree. Guarded on its own tach range rather than on the log
  // being empty, since the lesson above already put a flight in it.
  const existingRecent = await prisma.flight.count({
    where: { aircraftId: aircraft.id, tachStart: { gte: LESSON_TACH.end } },
  });
  if (existingRecent === 0) {
    for (const entry of RECENT_FLIGHTS) {
      await fileFlight(entry, day(-entry.daysAgo, 12));
    }
  }

  // Squawks in every state the club's vocabulary has except grounded.
  //
  // Deliberately nothing at REVIEWED_GROUNDED: that stops the whole club with
  // an app-wide banner and a "do not fly" card, and a demo database that opens
  // with the airplane down teaches the wrong first lesson about the app. File
  // one from the Status tab to see it.
  const existingSquawks = await prisma.squawk.count({
    where: { aircraftId: aircraft.id },
  });
  if (existingSquawks === 0) {
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy(PLAIN_MEMBER.email).id,
        title: "Right brake feels soft",
        description:
          "Pedal travels most of the way before it bites. Airworthy, but worth a look.",
        status: "REVIEWED_IN_WORK",
      },
    });
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy("taylor@vffclub.test").id,
        title: "Landing light intermittent",
        description:
          "Flickers on the taxi out, out by the runup area. Fine on the last two flights.",
        // Nobody has looked at it yet — the state everything a member files
        // starts in.
        status: "NEW",
      },
    });
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy("morgan@vffclub.test").id,
        title: "Left main tire wearing toward the indicator",
        description: "Still legal. Worth ordering a tire before it isn't.",
        // Reviewed and cleared to fly — which is NOT the same as fixed, which
        // is why it stays on the open list (see lib/squawks.ts `isOpen`).
        status: "REVIEWED_OK_TO_FLY",
      },
    });
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy("casey@vffclub.test").id,
        title: "Cabin door seal loose along the top",
        description: "Whistles above 90 mph.",
        status: "CLOSED",
        resolvedById: memberBy(SAFETY_OFFICER.email).id,
        resolvedAt: day(-9, 15),
        resolution: "Seal re-bonded and re-seated. No whistle on the check flight.",
      },
    });
  }

  // Signed-off checkouts, so Plane Status has fuel and oil to show and the
  // preflight page's oil box has a "last recorded" hint under it.
  const existingCheckouts = await prisma.checkout.count({
    where: { aircraftId: aircraft.id },
  });
  if (existingCheckouts === 0) {
    const runs: {
      kind: "PREFLIGHT" | "RUNWAY";
      pic: string;
      daysAgo: number;
      hour: number;
      values: Values;
      notes?: string;
    }[] = [
      {
        kind: "PREFLIGHT",
        pic: "taylor@vffclub.test",
        daysAgo: 2,
        hour: 9,
        // Dipped a tank at a time, which is how the card asks for it.
        values: { "consumables.dip.left": 12.5, "consumables.dip.right": 12, "consumables.oil.qts": 5.5 },
      },
      {
        kind: "PREFLIGHT",
        pic: "alex@vffclub.test",
        daysAgo: 1,
        hour: 17,
        values: { "consumables.dip.left": 17.5, "consumables.dip.right": 17, "consumables.oil.qts": 6 },
        notes: "Added a quart before the flight.",
      },
      {
        kind: "RUNWAY",
        pic: "alex@vffclub.test",
        daysAgo: 1,
        hour: 17,
        values: {},
      },
    ];

    for (const run of runs) {
      const at = day(-run.daysAgo, run.hour);
      const fuelOil =
        run.kind === "PREFLIGHT"
          ? deriveFuelOil(run.values)
          : { fuelOnBoardGal: null, oilQuarts: null };
      await prisma.checkout.create({
        data: {
          aircraftId: aircraft.id,
          userId: memberBy(run.pic).id,
          kind: run.kind,
          checkoutVersion:
            run.kind === "PREFLIGHT"
              ? PREFLIGHT_CHECKOUT.version
              : RUNWAY_CHECKOUT.version,
          answers: everyItem(run.kind),
          values: run.values,
          fuelOnBoardGal: fuelOil.fuelOnBoardGal,
          oilQuarts: fuelOil.oilQuarts,
          notes: run.notes ?? null,
          // Both stamped: `createdAt` is what "last recorded 6 qts on Tue"
          // reads, and `completedAt` is what makes it a signed-off run rather
          // than one somebody abandoned half way down the card.
          createdAt: at,
          completedAt: at,
        },
      });
    }

    // One turn-off checkout, on the flight it belongs to — the third card
    // lives on Flight rather than in this table. The put-away flags are
    // DERIVED from it, exactly as the API does when a member files a flight.
    const lastFlight = await prisma.flight.findFirst({
      where: { aircraftId: aircraft.id },
      orderBy: { tachEnd: "desc" },
      select: { id: true },
    });
    if (lastFlight) {
      const turnoff = everyItem("TURNOFF");
      await prisma.flight.update({
        where: { id: lastFlight.id },
        data: {
          turnoffCheckoutVersion: TURNOFF_CHECKOUT.version,
          turnoffAnswers: turnoff,
          ...derivePutAway(turnoff),
        },
      });
    }
  }

  // Fuel that went in with no flight attached — the before-you-fly and
  // nobody-flew-today cases. One on a member's own card (which is what a
  // FUEL_CREDIT is for) and one on the club's, which is the club buying fuel
  // and nobody's debt.
  const existingServicing = await prisma.servicing.count({
    where: { aircraftId: aircraft.id },
  });
  if (existingServicing === 0) {
    const fills: {
      pic: string;
      daysAgo: number;
      fuelAddedGal?: number;
      fuelCostCents?: number;
      oilAddedQts?: number;
      paidPersonally: boolean;
      notes?: string;
    }[] = [
      {
        pic: "taylor@vffclub.test",
        daysAgo: 2,
        fuelAddedGal: 22.4,
        fuelCostCents: 16_464,
        paidPersonally: true,
        notes: "Topped both tanks at the self-serve pump.",
      },
      {
        pic: "morgan@vffclub.test",
        daysAgo: 9,
        fuelAddedGal: 18,
        fuelCostCents: 13_140,
        paidPersonally: false,
        notes: "Club card at the FBO.",
      },
      {
        pic: "sam@vffclub.test",
        daysAgo: 5,
        oilAddedQts: 1,
        paidPersonally: true,
        notes: "One quart. Nobody flew it today.",
      },
    ];

    for (const fill of fills) {
      const servicedAt = day(-fill.daysAgo, 11);
      const row = await prisma.servicing.create({
        data: {
          aircraftId: aircraft.id,
          userId: memberBy(fill.pic).id,
          servicedAt,
          fuelAddedGal: fill.fuelAddedGal ?? null,
          fuelCostCents: fill.fuelCostCents ?? null,
          oilAddedQts: fill.oilAddedQts ?? null,
          paidPersonally: fill.paidPersonally,
          notes: fill.notes ?? null,
        },
      });
      // Same rule the API applies: only a personal card is a debt.
      const credit = servicingCredit(row, aircraft.tailNumber);
      if (credit) {
        await prisma.charge.create({
          data: {
            memberId: row.userId,
            kind: credit.kind,
            amountCents: credit.amountCents,
            description: credit.description,
            period: credit.period,
            incurredOn: credit.incurredOn,
            servicingId: row.id,
          },
        });
      }
    }
  }

  // Two hand-entered statement lines, so the Finances tab shows the kind an
  // officer types in alongside the derived ones — including a negative, which
  // is how a credit is stored.
  const existingOneOffs = await prisma.charge.count({ where: { kind: "ONE_OFF" } });
  if (existingOneOffs === 0) {
    const raisedBy = memberBy(FINANCE_OFFICER.email).id;
    const today = new Date();
    await prisma.charge.createMany({
      data: [
        {
          memberId: memberBy(STUDENT.email).id,
          kind: "ONE_OFF",
          amountCents: 3_850,
          description: "Chart subscription — club share",
          period: periodOf(today),
          incurredOn: today,
          createdById: raisedBy,
        },
        {
          memberId: memberBy("taylor@vffclub.test").id,
          kind: "ONE_OFF",
          amountCents: -2_675,
          description: "Reimbursement: tie-down straps",
          period: periodOf(today),
          incurredOn: today,
          createdById: raisedBy,
        },
      ],
    });
  }

  const existingReservations = await prisma.reservation.count({
    where: { aircraftId: aircraft.id, purpose: { not: "TRAINING" } },
  });
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
          userId: memberBy("sam@vffclub.test").id,
          startsAt: day(2, 14),
          endsAt: day(2, 16),
          purpose: "TRAINING",
          instructorId: instructor.id,
          notes: "Pattern work.",
        },
        {
          aircraftId: aircraft.id,
          userId: memberBy(STUDENT.email).id,
          startsAt: day(5, 8),
          endsAt: day(5, 17),
          purpose: "CROSS_COUNTRY",
          notes: "KBFI → KSBP and back.",
        },
        {
          aircraftId: aircraft.id,
          userId: admin.id,
          startsAt: day(9, 8),
          endsAt: day(9, 18),
          purpose: "MAINTENANCE",
          notes: "Oil change + 100-hour.",
        },
        {
          // Booked with the CFI who is also a member, so the instructor
          // picker has two names in it rather than one.
          aircraftId: aircraft.id,
          userId: memberBy("taylor@vffclub.test").id,
          startsAt: day(3, 13),
          endsAt: day(3, 15),
          purpose: "TRAINING",
          instructorId: memberBy("drew@vffclub.test").id,
          notes: "Flight review.",
        },
        {
          aircraftId: aircraft.id,
          userId: memberBy("casey@vffclub.test").id,
          startsAt: day(4, 17),
          endsAt: day(4, 20),
          purpose: "LOCAL",
          notes: "Sunset hop.",
        },
        {
          aircraftId: aircraft.id,
          userId: memberBy("robin@vffclub.test").id,
          startsAt: day(7, 7),
          endsAt: day(7, 19),
          purpose: "CROSS_COUNTRY",
          notes: "KBFI → KEAT, lunch, back before the afternoon wind.",
        },
        {
          // Kept rather than deleted, which is what cancelling does — the
          // calendar's history stays honest.
          aircraftId: aircraft.id,
          userId: memberBy("morgan@vffclub.test").id,
          startsAt: day(-6, 10),
          endsAt: day(-6, 13),
          purpose: "LOCAL",
          status: "CANCELED",
          notes: "Ceiling never lifted.",
        },
      ],
    });
  }

  console.log(
    `Seeded ${aircraft.tailNumber} with ${MEMBERS.length} members. Sign in as` +
      ` ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (demo members share that password,` +
      ` including the CFI ${INSTRUCTOR.email}).`
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
