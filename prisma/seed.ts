// Seed data: the club airplane, an admin login, a demo roster, and enough
// history behind them that every tab has something real to show — a year of
// flying, a statement with lines on it, squawks in every state of triage,
// signed-off checkouts and a schedule.
//
// The bar it aims at is one STATE PER BRANCH, not one row per table. A demo
// club where every charge is outstanding, every squawk stands on its own,
// every endorsement carries the same name and every maintenance item is
// comfortably in date exercises exactly one path through code that has four —
// and the paths it skips are the ones nobody looks at until a member hits them.
// So the seed deliberately includes the awkward states: a signature overtaken
// by an edit, a walk somebody abandoned half way down, a rule that has stopped
// billing, an item overdue without grounding anything, a line voided and a
// month settled.
//
// Two states are left out on purpose, both for the same reason — they stop the
// club dead and a database that opens that way teaches the wrong first lesson:
// a squawk at REVIEWED_GROUNDED, and a legally-required maintenance item run
// out. Each is one click away in the app.
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
import {
  chargesForFlight,
  currentPeriod,
  periodOf,
  servicingCredit,
} from "../lib/finance";
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
    // The one piece of paperwork dated RELATIVE to the seed run rather than
    // fixed. Everything else here is history and must not slide, but the
    // profile page's "your medical expires soon" reminder only exists inside a
    // window — a fixed date means the reminder is dead on every database
    // seeded after it passes, which is the same as not seeding it at all.
    medicalExpiresOn: day(38, 12),
  },
  {
    // Two offices at once, which the roster has to be able to say: a club this
    // size runs out of people long before it runs out of jobs, and the members
    // screen, the position chips and `capabilitiesFor` all have to hold more
    // than one.
    name: "Morgan Ellis",
    email: "morgan@vffclub.test",
    phone: "(206) 555-0164",
    positions: ["MAINTENANCE_OFFICER", "VICE_PRESIDENT"],
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
    positions: ["SECRETARY"],
    certificate: "Private Pilot ASEL",
    totalTimeHours: 97,
  },
];

// Between them the roster now holds every value of the `Position` enum, which
// is the point: an office nobody in the demo club holds is an office whose
// chip, whose entry in the roles editor and whose row in lib/positions.ts have
// never been looked at. PRESIDENT / VICE_PRESIDENT / SECRETARY carry no
// capabilities today and are seeded for exactly that reason — the app has to
// render an office that grants nothing without implying it grants something.

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
  oilQts?: number;
  departure?: string;
  arrival?: string;
  /** The whole route as the pilot filed it, when it wasn't just A to B. */
  route?: string;
  /** Flown with a CFI, and (when signed) endorsed by them. */
  withInstructor?: boolean;
  /**
   * WHICH CFI, by roster email. Defaults to the club's visiting instructor —
   * she teaches most of the lessons — but the club has two, and a log where
   * every endorsement carries the same name never shows that `instructorId`
   * is a real column rather than a flag.
   */
  instructor?: string;
  signed?: boolean;
  /**
   * Days after the flight that the ENTRY was corrected, stamping `editedAt`.
   *
   * Only interesting alongside `signed`: it is what produces the fourth
   * signature state, SIGNED_THEN_EDITED (lib/flightSignature.ts). The
   * endorsement was really given and is not erased — it just no longer covers
   * what's on screen — and without a seeded example that state is reachable
   * only by an e2e test that makes it happen itself.
   */
  editedDaysAfter?: number;
  /**
   * The turn-off checkout, as answered on the post-flight form.
   *
   * "all" is the pilot who worked the whole card; "partial" leaves the cabin
   * clean-out unticked, which is what `derivePutAway` turns into
   * `cabinClean: false` and what the flight log nags about. Absent means the
   * flight was filed without the card being answered at all — the third state,
   * and the one every row in the club's transcribed sheet is in.
   */
  turnoff?: "all" | "partial";
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
    // The only seeded flight with a filed ROUTE. Departure and arrival are the
    // same field on a there-and-back, which makes them read as one airport
    // twice; this is the column that says where it actually went.
    route: "KBFI → KTIW → KPWT → KBFI",
    fuelGal: 22.4,
    fuelCents: 16_464,
    turnoff: "all",
    note: "Tacoma and back for lunch.",
  },
  {
    // The club's OTHER CFI signing, and the one entry in the log that was
    // corrected after he signed it — see `editedDaysAfter`. Taylor's flight
    // review rather than a student lesson, which is also why it's Drew: he is
    // the CFI who is a flying member, and the seeded day-6 booking has him
    // down for exactly this.
    daysAgo: 2,
    pic: "taylor@vffclub.test",
    tachStart: 1504.5,
    tachEnd: 1505.6,
    landings: 6,
    withInstructor: true,
    instructor: "drew@vffclub.test",
    signed: true,
    editedDaysAfter: 1,
    turnoff: "all",
    note: "Flight review — air work, then short and soft field.",
  },
  {
    daysAgo: 1,
    pic: "alex@vffclub.test",
    tachStart: 1505.6,
    tachEnd: 1507.05,
    landings: 4,
    nightLandings: 3,
    // A quart went in after the flight, which is the servicing half of the
    // post-flight form (Servicing rows are the no-flight case; this is the
    // common one, and until now no seeded flight used the column).
    oilQts: 1,
    // Tied down and chocked, cabin left for the morning — the state the flight
    // log's put-away nag exists to show, and an honest one at 10pm.
    turnoff: "partial",
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

// N8318B's maintenance sheet, transcribed from the club's own spreadsheet as
// it stood on 8 Aug 2026 — the second piece of REAL data in this file, and
// transcribed for the same reason as the flight log: the derived columns give
// the arithmetic an answer somebody already worked out by hand (the sheet read
// 19.3 hours / 112 days to the oil change, 355 days to the annual).
//
// Two things in it look wrong and are the club's own numbers, so they stay:
//   • the altimeter/static check is tracked at 12 months, where 91.411 allows
//     24 — the club's sheet is the tighter of the two, and an app that quietly
//     doubled it would be extending an inspection nobody authorised;
//   • "Tach at Last" is 0.0 on the items with no hour interval, which is not a
//     reading at all. Stored as null here rather than as a zero that would
//     otherwise render as "last done at tach 0.0".
//
// `requiredByReg` is the sheet's own "Required by Regulation" column, and it
// is what decides whether OVERDUE grounds the airplane (lib/maintenance.ts).
interface SeedMaintenanceItem {
  label: string;
  category: "INSPECTION" | "EQUIPMENT";
  requiredByReg: boolean;
  reference: string | null;
  intervalHours: number | null;
  intervalMonths: number | null;
  lastDoneTach: number | null;
  /** A fixed calendar date, or a function of "now" for the live states. */
  lastDoneOn: [number, number, number] | (() => Date);
  notes?: string;
  /** Retired from the sheet but kept for its history. Defaults to true. */
  active?: boolean;
}

const MAINTENANCE_SHEET: SeedMaintenanceItem[] = [
  {
    label: "Annual inspection",
    category: "INSPECTION" as const,
    requiredByReg: true,
    reference: "14 CFR 91.409",
    intervalHours: null,
    intervalMonths: 12,
    lastDoneTach: 1473.2,
    lastDoneOn: [2026, 7, 8] as [number, number, number],
  },
  {
    label: "Engine oil change",
    category: "INSPECTION" as const,
    requiredByReg: false,
    reference: null,
    intervalHours: 50,
    intervalMonths: 4,
    lastDoneTach: 1473.2,
    lastDoneOn: [2026, 7, 8] as [number, number, number],
    notes: "Club schedule — 50 hours or 4 months, whichever comes first.",
  },
  {
    label: "Altimeter, encoder & static system",
    category: "INSPECTION" as const,
    requiredByReg: false,
    reference: "14 CFR 91.411",
    intervalHours: null,
    intervalMonths: 12,
    lastDoneTach: null,
    lastDoneOn: [2026, 7, 8] as [number, number, number],
  },
  {
    label: "Transponder",
    category: "INSPECTION" as const,
    requiredByReg: true,
    reference: "14 CFR 91.413 / 91.215",
    intervalHours: null,
    intervalMonths: 24,
    lastDoneTach: 675.1,
    lastDoneOn: [2026, 7, 8] as [number, number, number],
  },
  {
    label: "ELT inspection & battery",
    category: "EQUIPMENT" as const,
    requiredByReg: false,
    reference: "14 CFR 91.207",
    intervalHours: null,
    intervalMonths: 12,
    lastDoneTach: null,
    lastDoneOn: [2026, 7, 8] as [number, number, number],
  },
];

// Three more items — INVENTED, and kept in their own list for the same reason
// EARLIER_FLIGHTS is kept apart from the club's transcribed log: the sheet
// above is the club's own paperwork and stays exactly as it reads.
//
// The transcribed sheet was all signed off on the same day and is therefore
// entirely green, which leaves three of `lib/maintenance.ts`'s states with no
// example anywhere in the app. These fill them in, and the FIRST is the one
// that matters:
//
//   • OVERDUE without a grounding. `requiredByReg` is the whole difference
//     between "the maintenance officer has a job to do" and "this airplane may
//     not be flown", and with every seeded item comfortably in date, nothing in
//     the demo club ever showed the first without the second. A club-schedule
//     item a few hours over does — and `grounding()` correctly ignores it, so
//     the Airworthy badge and the dispatch banner stay clear.
//   • DUE_SOON on the calendar clock, dated relative to the seed run so the
//     amber state is live rather than true only in August 2026.
//   • A RETIRED item, which is how the club stops tracking something without
//     erasing that it was ever tracked.
//
// Deliberately NOT here: a required item run out. That grounds the airplane
// through `grounding()` — the same app-wide banner a REVIEWED_GROUNDED squawk
// raises — and the seed avoids it for the same reason it seeds no grounded
// squawk. File one, or mark an item overdue, to see it.
const EXTRA_MAINTENANCE: SeedMaintenanceItem[] = [
  {
    label: "Wheel bearings — clean & repack",
    category: "INSPECTION",
    requiredByReg: false,
    reference: null,
    intervalHours: 100,
    intervalMonths: null,
    // 104 hours ago on a 100-hour interval: four hours overdue, and nobody is
    // grounded by it.
    lastDoneTach: 1403.05,
    lastDoneOn: [2025, 6, 14],
    notes: "Club schedule. Overdue — the shop has it on the list for the annual.",
  },
  {
    label: "Fire extinguisher — inspection",
    category: "EQUIPMENT",
    requiredByReg: false,
    reference: null,
    intervalHours: null,
    intervalMonths: 12,
    lastDoneTach: null,
    // Exactly twelve calendar months ago, so it comes due at the END of the
    // current month (calendar months run to the last day — see
    // `calendarMonthsFrom`). That lands inside DUE_SOON_DAYS on any day the
    // seed is run, and can never read as overdue.
    lastDoneOn: () => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      d.setHours(12, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Portable oxygen bottle — hydrostatic test",
    category: "EQUIPMENT",
    requiredByReg: false,
    reference: null,
    intervalHours: null,
    intervalMonths: 60,
    lastDoneTach: null,
    lastDoneOn: [2021, 3, 2],
    active: false,
    notes: "Bottle sold in 2025. Kept so the sheet's history stays complete.",
  },
];

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

/**
 * The same run with some items left unticked.
 *
 * DROPPED rather than set to false, which is what a card the member never
 * touched actually looks like: `parseAnswers` reads an absent id as unanswered,
 * and writing `false` would claim they looked and said no.
 */
function withoutItems(answers: Answers, ids: string[]): Answers {
  const rest = { ...answers };
  for (const id of ids) delete rest[id];
  return rest;
}

/** The first `count` items of a card, in card order — a walk left half done. */
function firstItems(
  kind: "PREFLIGHT" | "RUNWAY" | "TURNOFF",
  count: number
): Answers {
  return Object.fromEntries(
    allItemIds(kind)
      .slice(0, count)
      .map((id) => [id, true])
  );
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

  // Annotated rather than left to infer from the pushes below: the winter
  // surcharge block reads this inside a callback, and an evolving `[]` stops
  // being inferable the moment a closure gets hold of it.
  const members: Awaited<ReturnType<typeof prisma.user.upsert>>[] = [];
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
    {
      code: "VFF-MEMBER",
      kind: "MEMBER" as const,
      label: "Seeded member code",
      // A usage trail, because "is this one still in use?" is the only
      // question an admin asks before retiring a code — and a list where every
      // code reads "never used" never shows the counter doing its job.
      uses: 5,
      lastUsedAt: day(-11, 14),
    },
    {
      code: "VFF-CFI",
      kind: "INSTRUCTOR" as const,
      label: "Seeded instructor code",
      uses: 1,
      lastUsedAt: day(-46, 10),
    },
    {
      // A RETIRED code, which is the state the whole "retire, never delete"
      // rule exists for: it still refuses a stranger (`redemptionError` gives
      // it the same message as a code that never existed), the record of who
      // it let in survives, and DELETE is refused because `uses` is not zero.
      // Nothing in the demo club showed any of that while both codes were
      // open and unused.
      code: "VFF-2025",
      kind: "MEMBER" as const,
      label: "2025 intake — closed",
      active: false,
      uses: 9,
      lastUsedAt: on([2025, 12, 3]),
    },
  ]) {
    await prisma.signupCode.upsert({
      where: { code: code.code },
      // Left alone on a reseed: `active` especially, since resurrecting a code
      // an admin deliberately retired would reopen the club's front door.
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
      // No "next maintenance due" here any more: that is derived from the
      // maintenance sheet on every page that asks (lib/maintenance.ts), and a
      // sentence typed into a notes field is a second answer to the same
      // question that goes stale the first time the shop signs anything off.
      notes: "Orange and white. Keys in the clubhouse lockbox.",
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

  // A rule that bills ONE member.
  //
  // `RecurringCharge.memberId` is null for the club-wide dues and set for a
  // private arrangement, and `membersBilledBy` branches on exactly that — but
  // with only the dues rule seeded, the branch that returns one member had no
  // example anywhere in the club. A locker is the ordinary shape of it.
  const LOCKER_LABEL = "Clubhouse locker";
  const existingLocker = await prisma.recurringCharge.findFirst({
    where: { label: LOCKER_LABEL },
    select: { id: true },
  });
  if (!existingLocker) {
    await prisma.recurringCharge.create({
      data: {
        label: LOCKER_LABEL,
        amountCents: 1_500,
        memberId: memberBy("morgan@vffclub.test").id,
        startsOn: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        createdById: memberBy(FINANCE_OFFICER.email).id,
      },
    });
  }

  // A rule that PAYS a member rather than billing them.
  //
  // Same rule shape, negative amount — the sign is what makes the line a
  // PAYBACK rather than DUES (`recurringKind` in lib/finance.ts). Seeded for
  // the same reason the locker is: the negative branch existed with no example
  // anywhere in the club, so nobody looking at a dev database would discover
  // that a statement can have a standing credit on it, or that the totals net
  // it off correctly. Somebody running the club's website for $50 a month is
  // the ordinary shape of it.
  const PAYBACK_LABEL = "Website upkeep";
  const existingPayback = await prisma.recurringCharge.findFirst({
    where: { label: PAYBACK_LABEL },
    select: { id: true },
  });
  if (!existingPayback) {
    await prisma.recurringCharge.create({
      data: {
        label: PAYBACK_LABEL,
        amountCents: -5_000, // negative: the club owes this one
        memberId: memberBy("morgan@vffclub.test").id,
        startsOn: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        createdById: memberBy(FINANCE_OFFICER.email).id,
      },
    });
  }

  // A rule that has STOPPED, and the lines it produced while it ran.
  //
  // Deactivating a rule is the club's way of ending it, and the promise is
  // that the months it already billed stay exactly as they were — editing the
  // rule never restates history. That promise is invisible in a demo club
  // where every rule is live, so this one ran last winter and is now off.
  //
  // Its lines are written here rather than materialised: `ensureRecurringCharges`
  // only ever looks at ACTIVE rules, which is what makes an ended rule safe to
  // leave lying around, and is also why reading one of those old months would
  // otherwise produce nothing.
  const WINTER_LABEL = "Winter tie-down surcharge";
  const existingWinter = await prisma.recurringCharge.findFirst({
    where: { label: WINTER_LABEL },
    select: { id: true },
  });
  if (!existingWinter) {
    const winter = await prisma.recurringCharge.create({
      data: {
        label: WINTER_LABEL,
        amountCents: 2_000,
        memberId: null,
        startsOn: on([2025, 11, 1]),
        endsOn: on([2026, 2, 28]),
        active: false,
        createdById: memberBy(FINANCE_OFFICER.email).id,
      },
    });
    await prisma.charge.createMany({
      data: ["2025-11", "2025-12", "2026-01", "2026-02"].flatMap((period) => {
        const [year, month] = period.split("-").map(Number);
        return members.map((member) => ({
          memberId: member.id,
          kind: "DUES" as const,
          amountCents: winter.amountCents,
          description: WINTER_LABEL,
          period,
          // Dues are incurred on the 1st, whenever anyone happens to read the
          // page — the same rule `ensureRecurringCharges` applies.
          incurredOn: new Date(year, month - 1, 1, 12, 0, 0, 0),
          recurringChargeId: winter.id,
        }));
      }),
      // The (memberId, recurringChargeId, period) index is what makes the
      // derived kinds idempotent, and it protects this the same way.
      skipDuplicates: true,
    });
  }

  /** File one flight and the statement lines it produces. */
  async function fileFlight(entry: SeedFlight, flownOn: Date) {
    const pilot = memberBy(entry.pic);
    // Which CFI is on the entry. Named on the row rather than assumed, because
    // the club has two and `resolveInstructor` refuses anyone who isn't one —
    // so a seeded lesson naming the wrong person would be a state the API
    // itself could never produce.
    const cfi = entry.withInstructor
      ? entry.instructor
        ? memberBy(entry.instructor)
        : instructor
      : null;
    // The turn-off card, answered on the post-flight form. The put-away flags
    // are DERIVED from it exactly as the API does, so `tiedDown` means
    // "confirmed" rather than "a toggle nobody moved".
    const turnoff: Answers | null =
      entry.turnoff === "all"
        ? everyItem("TURNOFF")
        : entry.turnoff === "partial"
          ? withoutItems(everyItem("TURNOFF"), ["parking.cabin"])
          : null;

    const flight = await prisma.flight.create({
      data: {
        aircraftId: aircraft.id,
        userId: pilot.id,
        flownOn,
        // Every seeded row is a FILED flight, not a session in progress. Stamped
        // with the flight's own date rather than with the reseed, for the same
        // reason the signature below is: a demo database whose whole log was
        // filed at 03:00 this morning reads as one nobody flew.
        filedAt: flownOn,
        tachStart: entry.tachStart,
        tachEnd: entry.tachEnd,
        // Hobbs is absent from every row for the same reason the airplane's
        // `lastHobbs` is null: this log is tach-only.
        landings: entry.landings ?? 1,
        nightLandings: entry.nightLandings ?? 0,
        departure: entry.departure ?? null,
        arrival: entry.arrival ?? null,
        route: entry.route ?? null,
        withInstructor: entry.withInstructor ?? false,
        instructorId: cfi?.id ?? null,
        // A signature names a version of the entry, so the seeded ones are
        // dated with the flight rather than with the reseed.
        signedById: entry.signed ? (cfi?.id ?? null) : null,
        signedAt: entry.signed ? flownOn : null,
        // …and `editedAt` is what that signature gets compared against. Stamped
        // only here and by PATCH /api/flights/[id], never by the act of
        // signing — see the gotcha in CLAUDE.md.
        editedAt:
          entry.editedDaysAfter != null
            ? new Date(flownOn.getTime() + entry.editedDaysAfter * 86_400_000)
            : null,
        fuelAddedGal: entry.fuelGal ?? null,
        fuelCostCents: entry.fuelCents ?? null,
        oilAddedQts: entry.oilQts ?? null,
        turnoffCheckoutVersion: turnoff ? TURNOFF_CHECKOUT.version : null,
        turnoffAnswers: turnoff ?? undefined,
        ...(turnoff ? derivePutAway(turnoff) : {}),
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

  // The maintenance sheet. Matched by (aircraft, label) rather than guarded by
  // a global count, so a database seeded before this existed picks the sheet up
  // on a reseed — and an item that's already there is LEFT ALONE: an officer
  // who has since recorded an oil change must not have it rolled back to the
  // transcribed date.
  for (const item of [...MAINTENANCE_SHEET, ...EXTRA_MAINTENANCE]) {
    const existing = await prisma.maintenanceItem.findFirst({
      where: { aircraftId: aircraft.id, label: item.label },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.maintenanceItem.create({
      data: {
        aircraftId: aircraft.id,
        label: item.label,
        category: item.category,
        requiredByReg: item.requiredByReg,
        reference: item.reference,
        intervalHours: item.intervalHours,
        intervalMonths: item.intervalMonths,
        lastDoneTach: item.lastDoneTach,
        lastDoneOn:
          typeof item.lastDoneOn === "function"
            ? item.lastDoneOn()
            : on(item.lastDoneOn),
        notes: item.notes ?? null,
        active: item.active ?? true,
      },
    });
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
        filedAt: day(-3, 12),
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

  // Signed-off checkouts, so Plane Status has fuel and oil to show and the
  // preflight page's oil box has a "last recorded" hint under it.
  const existingCheckouts = await prisma.checkout.count({
    where: { aircraftId: aircraft.id },
  });
  //
  // The turn-off card is NOT here: it lives on the Flight it belongs to, and
  // `fileFlight` writes it from each entry's `turnoff` (see SeedFlight), which
  // is also how one of the recent flights ends up with `cabinClean: false`.
  /** The completed runs this seed created, so a squawk can point at one. */
  const seededRuns: { pic: string; kind: string; id: string }[] = [];
  if (existingCheckouts === 0) {
    const runs: {
      kind: "PREFLIGHT" | "RUNWAY";
      pic: string;
      daysAgo: number;
      hour: number;
      values: Values;
      notes?: string;
      /**
       * A walk still in progress — no `completedAt`, some of the card left.
       *
       * The pages autosave, so an open row is the ordinary result of somebody
       * starting a card and being called away, and it's what `resolveResume`,
       * the resume banner and `sweepAbandonedRuns` all exist for. Attached to
       * a member the e2e suite never signs in as: a half-ticked card resumes
       * on the next visit, which turns "Check all" into "Clear" and would
       * booby-trap the checkout specs (see helpers.ts `clearCheckoutDrafts`).
       */
      inProgress?: number;
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
        kind: "RUNWAY",
        pic: "taylor@vffclub.test",
        daysAgo: 2,
        hour: 9,
        values: {},
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
      {
        kind: "PREFLIGHT",
        pic: "casey@vffclub.test",
        daysAgo: 1,
        hour: 8,
        values: { "consumables.dip.left": 9 },
        inProgress: 6,
        notes: "Called away before the walkaround.",
      },
    ];

    for (const run of runs) {
      const at = day(-run.daysAgo, run.hour);
      const fuelOil =
        run.kind === "PREFLIGHT"
          ? deriveFuelOil(run.values)
          : { fuelOnBoardGal: null, oilQuarts: null };
      const created = await prisma.checkout.create({
        data: {
          aircraftId: aircraft.id,
          userId: memberBy(run.pic).id,
          kind: run.kind,
          checkoutVersion:
            run.kind === "PREFLIGHT"
              ? PREFLIGHT_CHECKOUT.version
              : RUNWAY_CHECKOUT.version,
          answers:
            run.inProgress != null
              ? firstItems(run.kind, run.inProgress)
              : everyItem(run.kind),
          values: run.values,
          fuelOnBoardGal: fuelOil.fuelOnBoardGal,
          oilQuarts: fuelOil.oilQuarts,
          notes: run.notes ?? null,
          // Both stamped: `createdAt` is what "last recorded 6 qts on Tue"
          // reads, and `completedAt` is what makes it a signed-off run rather
          // than one somebody abandoned half way down the card.
          createdAt: at,
          completedAt: run.inProgress != null ? null : at,
        },
      });
      if (run.inProgress == null) {
        seededRuns.push({ pic: run.pic, kind: run.kind, id: created.id });
      }
    }
  }

  // Squawks in every state the club's vocabulary has except grounded.
  //
  // Deliberately nothing at REVIEWED_GROUNDED: that stops the whole club with
  // an app-wide banner and a "do not fly" card, and a demo database that opens
  // with the airplane down teaches the wrong first lesson about the app. File
  // one from the Status tab to see it.
  //
  // Seeded AFTER the checkouts and the log so two of them can say WHERE they
  // were noticed. `flightId` and `checkoutId` are how a squawk points back at
  // the walk or the flight it came out of — the real path into this table,
  // since almost every squawk a member files is filed from a card — and while
  // every seeded one stood on its own, both columns were dead weight.
  const existingSquawks = await prisma.squawk.count({
    where: { aircraftId: aircraft.id },
  });
  if (existingSquawks === 0) {
    /** The walk Taylor's landing-light squawk came off, if this run made it. */
    const taylorPreflight =
      seededRuns.find((r) => r.pic === "taylor@vffclub.test" && r.kind === "PREFLIGHT")
        ?.id ?? null;
    /** The night flight — the one that noticed the shimmy on rollout. */
    const nightFlight = await prisma.flight.findFirst({
      where: { aircraftId: aircraft.id, nightLandings: { gt: 0 } },
      orderBy: { flownOn: "desc" },
      select: { id: true },
    });

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
        // Filed from the preflight card, which is where members actually file
        // them — the checkout's Report button.
        checkoutId: taylorPreflight,
        // Nobody has looked at it yet — the state everything a member files
        // starts in.
        status: "NEW",
      },
    });
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy(PLAIN_MEMBER.email).id,
        title: "Nosewheel shimmy on the rollout",
        description:
          "Only above about 40 mph on landing, and only on the last two. Went away with back pressure.",
        // The other way in: noticed in the air and written up on the
        // post-flight form, so it hangs off the flight rather than a card.
        flightId: nightFlight?.id ?? null,
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
    await prisma.squawk.create({
      data: {
        aircraftId: aircraft.id,
        reportedById: memberBy("robin@vffclub.test").id,
        title: "Transponder dropped off ATC's screen near Paine",
        description: "Approach lost the code twice. Reappeared after a power cycle.",
        // A second CLOSED one, and the more useful shape of closed: something
        // that was genuinely worked rather than adjusted. One closed squawk
        // makes the history look like an exception; two make it a list.
        status: "CLOSED",
        resolvedById: memberBy(SAFETY_OFFICER.email).id,
        resolvedAt: day(-24, 11),
        resolution:
          "Loose antenna ground strap, re-terminated by the avionics shop. Checked good on the ramp test.",
      },
    });
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
      {
        // Fuel AND oil on the same visit, which is the ordinary shape of a
        // stop at the pump and the one combination none of the rows above
        // covered — each of them exercises a single column.
        pic: "casey@vffclub.test",
        daysAgo: 14,
        fuelAddedGal: 15.6,
        fuelCostCents: 11_388,
        oilAddedQts: 2,
        paidPersonally: true,
        notes: "Filled the left tank and put two quarts in before the club fly-out.",
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
    // Last month, so the statement's month picker has somewhere to go back to.
    // A books page that only ever shows the current month can't show that
    // `period` is stored rather than derived, which is the whole reason
    // correcting a date can't move money between settled months.
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 17, 12);
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
        {
          memberId: memberBy("casey@vffclub.test").id,
          kind: "ONE_OFF",
          amountCents: 7_400,
          description: "Landing fees — Friday Harbor",
          period: periodOf(lastMonth),
          incurredOn: lastMonth,
          createdById: raisedBy,
        },
        {
          // A VOIDED line, which is the state the whole "strike it through,
          // never delete it" rule exists for — and which nothing in the demo
          // club showed, so the struck-through row, the reason and the Restore
          // button had never been seen on a statement that wasn't mid-test.
          //
          // Note what voiding does NOT do: it leaves the line on the month and
          // takes it out of the totals. That is the difference from `paidAt`
          // below, which leaves the totals alone and only moves what's
          // outstanding.
          memberId: memberBy("sam@vffclub.test").id,
          kind: "ONE_OFF",
          amountCents: 9_500,
          description: "Headset repair",
          period: periodOf(lastMonth),
          incurredOn: lastMonth,
          createdById: raisedBy,
          voided: true,
          voidReason: "Covered by the manufacturer's warranty in the end.",
        },
      ],
    });
  }

  // Settle up everything before this month.
  //
  // `paidAt` / `paidById` had no seeded example at all, which meant every demo
  // statement ever looked at reported the same number twice — the month's total
  // and the amount outstanding — and the one distinction the column exists to
  // draw was invisible. A club settles monthly, so every closed month is paid
  // and the current one is not.
  //
  // Deliberately period by period rather than one sweep: the payment is dated
  // to the month it settled, on the 5th of the month after, because "when" is
  // the question anybody ever asks of a payment. Voided lines are skipped — a
  // line that should never have stood cannot also have been met.
  const alreadySettled = await prisma.charge.count({
    where: { paidAt: { not: null } },
  });
  if (alreadySettled === 0) {
    const settledPeriods = await prisma.charge.findMany({
      where: { period: { lt: currentPeriod() }, voided: false, paidAt: null },
      select: { period: true },
      distinct: ["period"],
    });
    for (const { period } of settledPeriods) {
      const [year, month] = period.split("-").map(Number);
      await prisma.charge.updateMany({
        where: { period, voided: false, paidAt: null },
        data: {
          // `month` is 1-based, so this index is the FOLLOWING month.
          paidAt: new Date(year, month, 5, 12, 0, 0, 0),
          paidById: memberBy(FINANCE_OFFICER.email).id,
        },
      });
    }
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
          //
          // Day 6, not day 3: the e2e suite books day 3 at 13:00 on the
          // strength of the seed leaving it free, and day 9 is the maintenance
          // block its double-booking test aims at. A seeded booking that lands
          // on either is a failing suite, not a scheduling clash.
          aircraftId: aircraft.id,
          userId: memberBy("taylor@vffclub.test").id,
          startsAt: day(6, 9),
          endsAt: day(6, 11),
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
        {
          // The fifth purpose. CHECKRIDE was the one value of the enum with no
          // booking anywhere in the demo club, so its chip colour on the
          // calendar had never been rendered — and a purpose you can pick but
          // never see is a purpose nobody trusts the calendar to show.
          //
          // Day 11 on purpose: day 3 at 13:00 is the slot the e2e suite books
          // into on the strength of it being free, and day 9 is the
          // maintenance block its double-booking test aims at.
          aircraftId: aircraft.id,
          userId: memberBy(STUDENT.email).id,
          startsAt: day(11, 8),
          endsAt: day(11, 13),
          purpose: "CHECKRIDE",
          notes: "Private pilot practical. DPE arrives 0830.",
        },
      ],
    });

    // A booking with the flight that was flown against it.
    //
    // `Flight.reservationId` is @unique and every seeded example of it was a
    // TRAINING lesson, which made the link look like part of the instructor
    // feature. It isn't: it's what closes the loop for any booking, and it's
    // what the calendar reads to show that a past block was actually flown.
    const tacoma = await prisma.flight.findFirst({
      where: { aircraftId: aircraft.id, arrival: "KTIW" },
      orderBy: { flownOn: "desc" },
      select: { id: true, userId: true, reservationId: true },
    });
    if (tacoma && !tacoma.reservationId) {
      const booked = await prisma.reservation.create({
        data: {
          aircraftId: aircraft.id,
          userId: tacoma.userId,
          startsAt: day(-2, 10),
          endsAt: day(-2, 15),
          purpose: "CROSS_COUNTRY",
          notes: "Lunch at Tacoma Narrows.",
        },
      });
      await prisma.flight.update({
        where: { id: tacoma.id },
        data: { reservationId: booked.id },
      });
    }

    // A write-up on one entry, so the Log section on the detail modal has
    // something in it on a fresh install. Markdown, because that's what the
    // column holds — see lib/markdown.ts — and only ONE, because a demo log in
    // which every flight comes with a debrief teaches members that a blank one
    // is a gap rather than the ordinary case.
    if (tacoma) {
      await prisma.flight.update({
        where: { id: tacoma.id },
        data: {
          logEntry: [
            "Smooth run up the Sound, **VFR the whole way**.",
            "",
            "Things worth remembering:",
            "",
            "- Tacoma tower was landing 17, so plan the 45 from the north",
            "- Winds picked up to about 12 gusting 18 by the time we left",
            "- Transient parking is at the *south* end, past the fuel pumps",
            "",
            "Left tank was slow to fill again. Squawked it.",
          ].join("\n"),
        },
      });
    }
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
