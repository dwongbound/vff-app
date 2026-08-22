// The club's three sheets, rebuilt from what the app knows.
//
// These are transcriptions of spreadsheets the club already keeps, and the
// column order is theirs rather than ours: somebody who has read the Google
// Sheet for years should be able to open an export and find every figure where
// their eye already goes. That's why the flight log opens with the two
// "until next Mx due" boxes, why the maintenance sheet leads with "Required by
// Regulation", and why both are OLDEST-FIRST while the app's own log is newest-
// first — a log on paper reads downwards.
//
// Where the app knows something the sheet never had a column for (landings,
// night landings, the instructor's signature) it goes to the RIGHT of the
// club's own columns rather than in among them. Nothing is invented to fill a
// column: a figure the app can't know is left empty, because a blank cell is
// read as "not recorded" while a plausible wrong number is read as fact.
//
// Money is written as NUMBERS in dollars rather than as "$291.50" strings, so
// the columns still add up in the sheet they land in. Dates are written as
// TEXT (see lib/xlsx.ts for why there are no date cells).
//
// Pure — everything comes in as arguments, including `now`. See
// tests/unit/exports.test.ts.
import {
  byUrgency,
  maintenanceDue,
  nextDue,
  MAINTENANCE_STATE_LABELS,
  type MaintenanceCategory,
} from "./maintenance";
import { CHARGE_KIND_LABELS, formatPeriod, type Period } from "./finance";
import { tachHours } from "./hours";
import { markdownToText } from "./markdown";
import type { Sheet } from "./xlsx";
import type {
  ApiFlightSummary,
  ApiMaintenanceItem,
  ApiStatement,
} from "./types";

/**
 * A date as the club's sheets write it: 8/16/2026.
 *
 * Not `formatDay` (which is "Sun, Aug 16", built for a phone-width list) and
 * not ISO: this is the format the columns being replaced are already in, and
 * it's what both Excel and Google Sheets re-parse back into a real date if the
 * reader ever asks them to.
 */
export function sheetDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/**
 * A time of day as a sheet cell: "14:05".
 *
 * A STRING, deliberately, for the same reason lib/xlsx.ts writes no date
 * cells at all: a real time cell is a fraction of a day against a serial epoch,
 * and getting that subtly wrong produces a spreadsheet that looks right and
 * sorts wrong. 24-hour so a column of them sorts as text in the order it
 * happened.
 */
export function sheetTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

/** Whole cents as a number of dollars, for a cell that has to stay summable. */
function dollars(cents: number | null | undefined): number | null {
  if (cents == null) return null;
  return Math.round(cents) / 100;
}

/** The club sheet's own spelling of a yes/no column. */
function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

// ---------------------------------------------------------------------------
// Flight log
// ---------------------------------------------------------------------------

/** Columns A-J are the club sheet's; everything after is what the app adds. */
const FLIGHT_HEADERS = [
  "Date",
  "PIC",
  "Tach Start",
  "Tach End",
  "Total Tach",
  "CheckSum Time",
  "Fuel Added [g]",
  "Fuel $ / gallon",
  "Fuel Cost [$]",
  "Fuel Purchase Personal Card",
  // Beyond the club's sheet, in the order a reader would want them.
  "Hobbs Start",
  "Hobbs End",
  "Landings",
  "Night Landings",
  "From",
  "To",
  "Route",
  "Landing Fee [$]",
  "Oil Added [qt]",
  "With Instructor",
  "Instructor",
  "Signed",
  "Notes",
  // The session's own columns. `Out`/`In` are the wall clock the cards
  // recorded; `Log` is the pilot's write-up, flattened to plain text —
  // a spreadsheet cell has no lists, and the markers survive the trip so the
  // shape the member gave it does too (see lib/markdown.ts `markdownToText`).
  "Out",
  "In",
  "Log",
];

export interface FlightLogExport {
  tailNumber: string;
  flights: ApiFlightSummary[];
  /** For the two "until next Mx due" boxes the sheet opens with. */
  maintenance?: ApiMaintenanceItem[];
  /** The airplane's current tach, which those boxes count against. */
  tach?: number | null;
  now?: Date;
}

/**
 * The flight log, laid out like the club's "Flight Log & Mx Status" tab.
 *
 * Rows 2-3 are the status band the sheet carries above its data: today's date,
 * and how much tach and how many days are left on whatever comes due next. Row
 * 4 is deliberately blank — it's the separator in the original, and it's what
 * lets a reader drag-select the table below without catching the band.
 */
export function flightLogSheet({
  tailNumber,
  flights,
  maintenance = [],
  tach = null,
  now = new Date(),
}: FlightLogExport): Sheet {
  const next = nextDue(maintenance, tach ?? null);
  const due = next ? maintenanceDue(next, tach ?? null) : null;

  const rows: (string | number | null)[][] = [
    FLIGHT_HEADERS,
    [
      sheetDate(now),
      "<- Today",
      "TACH HOURS Until Next Mx Due",
      null,
      due?.hoursRemaining ?? "N/A",
      null,
      "DAYS Until Next Mx Due",
      null,
      due?.daysRemaining ?? "N/A",
    ],
    [
      null,
      null,
      "Due Next:",
      null,
      next?.label ?? "Nothing tracked",
      null,
      "Due Next:",
      null,
      next?.label ?? "Nothing tracked",
    ],
    [],
  ];

  // Oldest first: this is a log, and the club's sheet grows downwards. Sorted
  // rather than reversed, because the app's list is only *usually* in date
  // order — a flight entered by hand weeks later files under its own date.
  const ordered = [...flights].sort((a, b) => {
    const byDate = new Date(a.flownOn).getTime() - new Date(b.flownOn).getTime();
    if (byDate !== 0) return byDate;
    // Two flights on the same day sort by where they started on the tach, which
    // is the order they were flown in. An entry with no start reading has
    // nothing to sort by and goes last on its day rather than pretending to
    // have begun at zero.
    return (a.tachStart ?? Infinity) - (b.tachStart ?? Infinity);
  });

  for (const flight of ordered) {
    const gallons = flight.fuelAddedGal;
    const fuelCost = dollars(flight.fuelCostCents);
    rows.push([
      sheetDate(flight.flownOn),
      flight.pilot.name,
      flight.tachStart,
      flight.tachEnd,
      tachHours(flight),
      // The club's own checksum column, left empty on purpose: it holds a
      // formula in the sheet it comes from, and a value here would be this
      // app's opinion rather than the check.
      null,
      gallons,
      // Only when both halves are known, and never a divide by zero: a
      // per-gallon price worked out from a missing quantity is a made-up
      // number in a column people read as fact.
      gallons != null && gallons > 0 && fuelCost != null
        ? Math.round((fuelCost / gallons) * 100) / 100
        : null,
      fuelCost,
      // A fuel cost recorded against a flight is always money the member laid
      // out themselves — it's what raises their FUEL_CREDIT (lib/finance.ts).
      // So this column is answered rather than guessed at.
      fuelCost != null && fuelCost > 0 ? "Yes" : null,
      flight.hobbsStart,
      flight.hobbsEnd,
      flight.landings,
      flight.nightLandings,
      flight.departure,
      flight.arrival,
      flight.route,
      dollars(flight.landingFeeCents),
      flight.oilAddedQts,
      yesNo(flight.withInstructor),
      flight.instructor?.name ?? null,
      flight.signedAt ? sheetDate(flight.signedAt) : null,
      flight.notes,
      flight.startedAt ? sheetTime(flight.startedAt) : null,
      flight.endedAt ? sheetTime(flight.endedAt) : null,
      markdownToText(flight.logEntry) || null,
    ]);
  }

  return { name: `${tailNumber} Flight Log`, rows };
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const MAINTENANCE_HEADERS = [
  // Column A is the club sheet's narrow spacer, and stays one here so every
  // column after it lands under the letter a reader expects.
  null,
  "Required by Regulation",
  null,
  "Hours Remaining",
  "Days Remaining",
  "Tach Due",
  "Date Due",
  "Tach at Last Inspt / Mx",
  "Date of Last Inspt / Mx",
  "Hours Valid For",
  "Months Valid For",
  // Ours: the sheet reads these off the colour of the cell, which an export
  // has no business relying on.
  "Status",
  "Reference",
  "Notes",
];

/** The block headings the club's sheet groups its rows under. */
const CATEGORY_HEADINGS: Record<MaintenanceCategory, string> = {
  INSPECTION: "INSPECTION & RECURRENT MX",
  EQUIPMENT: "EQUIPMENT",
};

export interface MaintenanceExport {
  tailNumber: string;
  items: ApiMaintenanceItem[];
  tach: number | null;
  now?: Date;
}

/**
 * The maintenance sheet, laid out like the club's "Mx Status" block.
 *
 * Grouped into the sheet's own two headings and, within each, ordered the way
 * MaintenancePanel orders them — by urgency, not by entry. The two columns the
 * original shows as `#VALUE!` (a tach due for an item with no hour limit) are
 * written "N/A" instead: the sheet's error is an artefact of its formula, and
 * reproducing it would be copying a bug rather than a layout.
 */
export function maintenanceSheet({
  tailNumber,
  items,
  tach,
  now = new Date(),
}: MaintenanceExport): Sheet {
  const rows: (string | number | null)[][] = [MAINTENANCE_HEADERS];

  for (const category of Object.keys(CATEGORY_HEADINGS) as MaintenanceCategory[]) {
    const inCategory = byUrgency(
      items.filter((item) => item.category === category),
      tach
    );
    if (inCategory.length === 0) continue;

    rows.push([null, null, CATEGORY_HEADINGS[category]]);

    for (const item of inCategory) {
      const due = maintenanceDue(item, tach);
      rows.push([
        null,
        // The sheet writes a dash rather than "No" here, and the difference
        // reads: "-" is "the club schedules this", not "this is optional".
        item.requiredByReg ? "Yes" : "-",
        item.label,
        due.hoursRemaining ?? "N/A",
        due.daysRemaining ?? "N/A",
        due.dueAtTach ?? "N/A",
        due.dueOn ? sheetDate(due.dueOn) : "N/A",
        item.lastDoneTach ?? "N/A",
        item.lastDoneOn ? sheetDate(item.lastDoneOn) : "N/A",
        item.intervalHours ?? "N/A",
        item.intervalMonths ?? "N/A",
        MAINTENANCE_STATE_LABELS[due.state],
        item.reference,
        item.notes,
      ]);
    }

    rows.push([]);
  }

  // The panel's own footnote, carried across: every countdown above is
  // relative to these two, and a sheet mailed round the club a week later is
  // otherwise a set of numbers with no epoch.
  rows.push([
    null,
    null,
    `Counted against tach ${tach != null ? tach.toFixed(1) : "—"} on ${sheetDate(now)}.` +
      " Calendar items run to the END of their month, the way 14 CFR counts them.",
  ]);

  return { name: `${tailNumber} Mx Status`, rows };
}

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------

const CHARGE_HEADERS = [
  "Date",
  "Member",
  "Kind",
  "Description",
  "Charge [$]",
  "Credit [$]",
  "Paid",
  "Paid On",
  "Voided",
  "Period",
];

const MEMBER_HEADERS = [
  "Member",
  "Charged [$]",
  "Credited [$]",
  "Balance [$]",
  "Paid [$]",
  "Outstanding [$]",
];

export interface FinancesExport {
  period: Period;
  statements: ApiStatement[];
  /** True when these are the whole club's statements rather than one member's. */
  clubWide: boolean;
  now?: Date;
}

/**
 * The month's books: a line-by-line ledger, plus a per-member summary when the
 * export is club-wide.
 *
 * Charges and credits go in SEPARATE columns rather than one signed one. The
 * app stores a credit as a negative number because that makes a balance one
 * addition (lib/finance.ts), but a two-column ledger is what the club's
 * treasurer reads, and it's what makes a stray minus sign visible instead of
 * silently halving a total.
 */
export function financesWorkbook({
  period,
  statements,
  clubWide,
  now = new Date(),
}: FinancesExport): Sheet[] {
  const totals = statements.reduce(
    (acc, s) => ({
      chargedCents: acc.chargedCents + s.chargedCents,
      creditedCents: acc.creditedCents + s.creditedCents,
      balanceCents: acc.balanceCents + s.balanceCents,
      paidCents: acc.paidCents + s.paidCents,
      outstandingCents: acc.outstandingCents + s.outstandingCents,
    }),
    {
      chargedCents: 0,
      creditedCents: 0,
      balanceCents: 0,
      paidCents: 0,
      outstandingCents: 0,
    }
  );

  const rows: (string | number | null)[][] = [
    CHARGE_HEADERS,
    [
      formatPeriod(period),
      clubWide ? "<- Club, all members" : "<- Your statement",
      "CHARGED",
      dollars(totals.chargedCents),
      "CREDITED",
      dollars(totals.creditedCents),
      "BALANCE",
      dollars(totals.balanceCents),
    ],
    [
      sheetDate(now),
      "<- Exported",
      "PAID",
      dollars(totals.paidCents),
      "OUTSTANDING",
      dollars(totals.outstandingCents),
    ],
    [],
  ];

  // Every line of every statement, oldest first — one table rather than a
  // block per member, so it sorts and filters like the sheet it replaces. The
  // member is a column, which is what makes that work.
  const lines = statements
    .flatMap((statement) =>
      statement.charges.map((charge) => ({ statement, charge }))
    )
    .sort((a, b) => {
      const byDate =
        new Date(a.charge.incurredOn).getTime() -
        new Date(b.charge.incurredOn).getTime();
      if (byDate !== 0) return byDate;
      return a.statement.member.name.localeCompare(b.statement.member.name);
    });

  for (const { statement, charge } of lines) {
    const amount = dollars(charge.amountCents) ?? 0;
    rows.push([
      sheetDate(charge.incurredOn),
      statement.member.name,
      // The label the page shows, not the enum: "Fuel credit" is what the
      // treasurer is reading down the column for, and FUEL_CREDIT is an
      // implementation detail that happens to be legible.
      CHARGE_KIND_LABELS[charge.kind] ?? charge.kind,
      charge.description,
      amount > 0 ? amount : null,
      amount < 0 ? Math.abs(amount) : null,
      yesNo(charge.paidAt != null),
      charge.paidAt ? sheetDate(charge.paidAt) : null,
      // Only marked when true. A "No" in every row of a column that is almost
      // never Yes is noise a reader has to look past to find the one that is.
      charge.voided ? "Yes" : null,
      charge.period,
    ]);
  }

  const sheets: Sheet[] = [{ name: `Charges ${period}`, rows }];

  if (clubWide) {
    const memberRows: (string | number | null)[][] = [MEMBER_HEADERS];
    for (const statement of [...statements].sort((a, b) =>
      a.member.name.localeCompare(b.member.name)
    )) {
      memberRows.push([
        statement.member.name,
        dollars(statement.chargedCents),
        dollars(statement.creditedCents),
        dollars(statement.balanceCents),
        dollars(statement.paidCents),
        dollars(statement.outstandingCents),
      ]);
    }
    memberRows.push([]);
    memberRows.push([
      "TOTAL",
      dollars(totals.chargedCents),
      dollars(totals.creditedCents),
      dollars(totals.balanceCents),
      dollars(totals.paidCents),
      dollars(totals.outstandingCents),
    ]);
    sheets.push({ name: `Members ${period}`, rows: memberRows });
  }

  return sheets;
}
