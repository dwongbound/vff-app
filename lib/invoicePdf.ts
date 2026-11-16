// The invoice as a printed statement: the PDF attached to each invoice email.
//
// Laid out like a bill people already know how to read: the club's band
// across the top, who it's for and the one number that matters (what's due)
// side by side, then every line in a table, a short totals block, and how to
// pay. Paid lines say PAID beside them rather than relying on colour alone,
// and credits read as credits ("−$188.73", in green), never as a bill.
//
// Pure: takes the statement `invoiceFor` already worked out and returns bytes.
import { CLUB_NAME, CLUB_TIME_ZONE } from "./constants";
import { formatMoney, formatPeriod } from "./finance";
import { fitText, PAGE_HEIGHT, PAGE_WIDTH, PdfDocument, wrapText } from "./pdf";

/** The one payment instruction every invoice carries (Dylan, 2026-11-16). */
export const PAYMENT_INSTRUCTIONS =
  "Please Zelle to the club account or bring a check to the finance officer(s).";

export interface StatementRow {
  date: string;
  /** "YYYY-MM": the month a line belongs to, for "all" statements' groups. */
  month: string;
  what: string;
  kind: string;
  amountCents: number;
  paid: boolean;
}

export interface Statement {
  title: string;
  /** "August 2026" or "Everything unpaid". */
  label: string;
  /** Group the table by month ("all") or not (a single month). */
  grouped: boolean;
  memberName: string;
  rows: StatementRow[];
  /** The member's balance across every month, when it says more than the headline. */
  balanceDueCents: number | null;
  financesUrl: string;
  issuedOn: Date;
}

// The club's palette (tailwind.config.ts remaps indigo to these).
const BRAND = "#c64912";
const BRAND_TINT = "#fdf1ea";
const INK = "#1f2328";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const ZEBRA = "#fafafa";
const GREEN = "#15803d";
const GREEN_TINT = "#dcfce7";
const BLUE = "#1d4ed8";
const BLUE_TINT = "#dbeafe";

const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;
const FOOTER_Y = PAGE_HEIGHT - 32;
/** Lowest a table row may reach before the page turns. */
const BODY_BOTTOM = PAGE_HEIGHT - 64;

// Table columns.
const COL_DATE = MARGIN + 10;
const COL_WHAT = MARGIN + 74;
const COL_STATUS = RIGHT - 150;
const COL_AMOUNT = RIGHT - 10;
const WHAT_WIDTH = COL_STATUS - COL_WHAT - 12;

const ROW_H = 32;
const HEADER_ROW_H = 24;
const GROUP_ROW_H = 26;

/** "Aug 21, 2026", in the club's own time zone. */
function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: CLUB_TIME_ZONE,
  });
}

/** Money for the table: credits get a real minus sign. */
function money(cents: number): string {
  return cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents);
}

/** The headline box's label and figure, worded so a credit never reads as a bill. */
function headline(cents: number): { label: string; total: string; figure: string; color: string } {
  if (cents > 0) {
    return { label: "AMOUNT DUE", total: "Amount due", figure: formatMoney(cents), color: BRAND };
  }
  if (cents < 0) {
    return { label: "THE CLUB OWES YOU", total: "The club owes you", figure: formatMoney(-cents), color: GREEN };
  }
  return { label: "NOTHING OWED", total: "Nothing owed", figure: formatMoney(0), color: GREEN };
}

/** "you owe $2,501.95" / "the club owes you $40.00" / "nothing owed". */
function balancePhrase(cents: number): string {
  if (cents > 0) return `you owe ${formatMoney(cents)}`;
  if (cents < 0) return `the club owes you ${formatMoney(-cents)}`;
  return "nothing owed";
}

export interface StatementTotals {
  /** Every charge on the statement, paid or not. */
  chargedCents: number;
  /** Every credit (fuel credit, reimbursement, payback): owed TO the member. */
  owedCents: number;
  /** The credits the club has already paid out to the member. */
  paidOutCents: number;
  /** The charges the member has already paid the club. */
  paidClubCents: number;
  /** Charges − owed + paid out − paid club: what the member still has to send. */
  dueCents: number;
}

/**
 * The totals block, as four sums a member can check against the table by
 * eye (Dylan, 2026-11-16): Charges, Owed (every credit), Paid out (credits
 * the club has already settled) and Paid club (charges the member has
 * already settled). Amount due = charges − owed + paid out − paid club,
 * which is the same figure as the app's outstanding balance.
 */
export function statementTotals(rows: Pick<StatementRow, "amountCents" | "paid">[]): StatementTotals {
  let chargedCents = 0;
  let owedCents = 0;
  let paidOutCents = 0;
  let paidClubCents = 0;
  for (const row of rows) {
    if (row.amountCents >= 0) {
      chargedCents += row.amountCents;
      if (row.paid) paidClubCents += row.amountCents;
    } else {
      owedCents += -row.amountCents;
      if (row.paid) paidOutCents += -row.amountCents;
    }
  }
  const dueCents = chargedCents - owedCents + paidOutCents - paidClubCents;
  return { chargedCents, owedCents, paidOutCents, paidClubCents, dueCents };
}

/** A totals figure with its sign in front ("−$40.00"), but a bare "$0.00" for zero. */
function signed(sign: string, cents: number): string {
  if (cents === 0) return formatMoney(0);
  return `${sign}${formatMoney(cents)}`;
}

/** The statement, as a PDF file. */
export function statementPdf(s: Statement): Uint8Array<ArrayBuffer> {
  const doc = new PdfDocument(s.title);
  doc.addPage();

  // ── Band ──
  doc.rect(0, 0, PAGE_WIDTH, 92, { fill: BRAND });
  doc.text(MARGIN, 44, CLUB_NAME, { font: "bold", size: 22, color: "#ffffff" });
  doc.text(MARGIN, 66, s.grouped ? "Statement of unpaid charges" : "Monthly statement", {
    size: 11,
    color: "#fde4d6",
  });
  doc.text(RIGHT, 44, s.label, { font: "bold", size: 14, color: "#ffffff", align: "right" });
  doc.text(RIGHT, 66, `Issued ${longDate(s.issuedOn)}`, { size: 10, color: "#fde4d6", align: "right" });

  // ── Who it's for, and the number that matters ──
  doc.text(MARGIN, 128, "STATEMENT FOR", { font: "bold", size: 8, color: MUTED });
  doc.text(MARGIN, 148, fitText(s.memberName, "bold", 16, 280), { font: "bold", size: 16, color: INK });
  doc.text(MARGIN, 166, s.grouped ? "Every unpaid line, oldest first" : s.label, { size: 10, color: MUTED });

  const boxX = RIGHT - 220;
  const boxH = s.balanceDueCents === null ? 70 : 86;
  const sums = statementTotals(s.rows);
  const head = headline(sums.dueCents);
  doc.rect(boxX, 112, 220, boxH, { fill: BRAND_TINT });
  doc.rect(boxX, 112, 4, boxH, { fill: head.color });
  doc.text(boxX + 18, 132, head.label, { font: "bold", size: 8, color: MUTED });
  doc.text(boxX + 18, 162, head.figure, { font: "bold", size: 26, color: head.color });
  if (s.balanceDueCents !== null) {
    doc.text(boxX + 18, 184, fitText(`Across all months: ${balancePhrase(s.balanceDueCents)}`, "regular", 9, 196), {
      size: 9,
      color: MUTED,
    });
  }

  // ── The lines ──
  let y = 112 + boxH + 30;
  const tableHeader = () => {
    doc.rect(MARGIN, y, RIGHT - MARGIN, HEADER_ROW_H, { fill: "#f3f4f6" });
    const base = y + 15.5;
    doc.text(COL_DATE, base, "DATE", { font: "bold", size: 8, color: MUTED });
    doc.text(COL_WHAT, base, "DESCRIPTION", { font: "bold", size: 8, color: MUTED });
    doc.text(COL_STATUS, base, "STATUS", { font: "bold", size: 8, color: MUTED });
    doc.text(COL_AMOUNT, base, "AMOUNT", { font: "bold", size: 8, color: MUTED, align: "right" });
    y += HEADER_ROW_H;
  };
  const newPage = () => {
    doc.addPage();
    doc.rect(0, 0, PAGE_WIDTH, 6, { fill: BRAND });
    doc.text(MARGIN, 40, `${CLUB_NAME} · ${s.memberName} · ${s.label}`, {
      font: "bold",
      size: 10,
      color: INK,
    });
    doc.text(RIGHT, 40, "continued", { size: 9, color: MUTED, align: "right" });
    y = 58;
    tableHeader();
  };

  tableHeader();
  let lastMonth: string | null = null;
  s.rows.forEach((row, i) => {
    const needsGroup = s.grouped && row.month !== lastMonth;
    const height = ROW_H + (needsGroup ? GROUP_ROW_H : 0);
    if (y + height > BODY_BOTTOM) newPage();
    if (needsGroup) {
      lastMonth = row.month;
      doc.text(COL_DATE, y + 18, formatPeriod(row.month), { font: "bold", size: 10, color: INK });
      doc.line(MARGIN, y + GROUP_ROW_H, RIGHT, y + GROUP_ROW_H, RULE);
      y += GROUP_ROW_H;
    }
    if (i % 2 === 1) doc.rect(MARGIN, y, RIGHT - MARGIN, ROW_H, { fill: ZEBRA });
    doc.text(COL_DATE, y + 15, row.date, { size: 10, color: MUTED });
    doc.text(COL_WHAT, y + 15, fitText(row.what, "regular", 10.5, WHAT_WIDTH), { size: 10.5, color: INK });
    doc.text(COL_WHAT, y + 27, fitText(row.kind, "regular", 8.5, WHAT_WIDTH), { size: 8.5, color: MUTED });
    // A settled line is tagged by WHICH WAY the money went: a charge the
    // member paid the club (green), or a credit the club paid out (blue).
    if (row.paid) {
      const credit = row.amountCents < 0;
      const tag = credit ? "PAID OUT" : "PAID CLUB";
      doc.rect(COL_STATUS - 2, y + 7, 52, 13, { fill: credit ? BLUE_TINT : GREEN_TINT });
      doc.text(COL_STATUS + 24, y + 16.5, tag, { font: "bold", size: 7.5, color: credit ? BLUE : GREEN, align: "center" });
    }
    doc.text(COL_AMOUNT, y + 15, money(row.amountCents), {
      font: "bold",
      size: 10.5,
      color: row.amountCents < 0 ? GREEN : INK,
      align: "right",
    });
    doc.line(MARGIN, y + ROW_H, RIGHT, y + ROW_H, RULE, 0.75);
    y += ROW_H;
  });

  // ── How to pay (left) beside the totals (right) ── kept together on one page.
  const totals: [string, string][] = [
    ["Charges", formatMoney(sums.chargedCents)],
    ["Owed", signed("\u2212", sums.owedCents)],
    ["Paid out", signed("+", sums.paidOutCents)],
    ["Paid club", signed("\u2212", sums.paidClubCents)],
  ];
  const totalsHeight = totals.length * 18 + 40;
  const payWidth = RIGHT - MARGIN - 250;
  const payLines = wrapText(PAYMENT_INSTRUCTIONS, "regular", 10, payWidth - 32);
  const payHeight = 34 + payLines.length * 14 + 26;
  const closingHeight = 20 + Math.max(totalsHeight, payHeight) + 34;
  if (y + closingHeight > BODY_BOTTOM) {
    doc.addPage();
    doc.rect(0, 0, PAGE_WIDTH, 6, { fill: BRAND });
    y = 40;
  } else {
    y += 20;
  }
  const top = y;

  doc.rect(MARGIN, top, payWidth, payHeight, { fill: BRAND_TINT });
  doc.rect(MARGIN, top, 4, payHeight, { fill: BRAND });
  doc.text(MARGIN + 18, top + 22, "How to pay", { font: "bold", size: 11, color: INK });
  payLines.forEach((line, i) => doc.text(MARGIN + 18, top + 40 + i * 14, line, { size: 10, color: INK }));
  doc.text(MARGIN + 18, top + payHeight - 12, "Questions? Reply to the email this came with.", {
    size: 8.5,
    color: MUTED,
  });

  const labelX = RIGHT - 210;
  let ty = top;
  for (const [label, value] of totals) {
    ty += 18;
    doc.text(labelX, ty, label, { size: 10, color: MUTED });
    doc.text(COL_AMOUNT, ty, value, { size: 10, color: INK, align: "right" });
  }
  ty += 10;
  doc.line(labelX, ty, RIGHT, ty, INK, 1);
  ty += 22;
  doc.text(labelX, ty, head.total, { font: "bold", size: 12, color: INK });
  doc.text(COL_AMOUNT, ty, head.figure, { font: "bold", size: 12, color: head.color, align: "right" });
  y = top + Math.max(totalsHeight, payHeight) + 28;
  doc.text(MARGIN, y, fitText(`Every line, any time: ${s.financesUrl}`, "regular", 9, RIGHT - MARGIN), {
    size: 9,
    color: MUTED,
  });

  // ── Footers, now the page count is known ──
  const pages = doc.pageCount;
  for (let p = 0; p < pages; p++) {
    doc.usePage(p);
    doc.line(MARGIN, FOOTER_Y - 14, RIGHT, FOOTER_Y - 14, RULE, 0.75);
    doc.text(MARGIN, FOOTER_Y, `${CLUB_NAME} · ${s.title}`, { size: 8, color: MUTED });
    doc.text(RIGHT, FOOTER_Y, `Page ${p + 1} of ${pages}`, { size: 8, color: MUTED, align: "right" });
  }

  return doc.toBytes();
}
