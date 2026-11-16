// What the Finance Officer's monthly invoice SAYS — pure, so the wording and
// the arithmetic can be tested without a mail server. The email is a short
// note; every line and figure is in the attached PDF statement
// (lib/invoicePdf.ts).
//
// Two scopes, the two questions an officer asks at the start of a month:
//
//   a month ("2026-09")  the statement for that month: every standing line
//                        in it, settled ones marked paid, and what of it is
//                        still owed. Below it, the member's balance across
//                        EVERY month, because a member who reads "September:
//                        $0 owed" while August is unpaid has been misled.
//   "all"                everything still unpaid, whenever it was billed,
//                        oldest first, grouped by month — the "here's what
//                        you owe the club" letter.
//
// Voided lines never appear (an invoice asks for money, and a voided line
// asks for none); the app's statement still shows them struck through for the
// member who wants the history.
//
// An invoice with nothing on it is never sent: `invoiceFor` returns null, and
// the route reports that member as skipped with the reason.
import { CLUB_NAME, CLUB_TIME_ZONE } from "./constants";
import {
  CHARGE_KIND_LABELS,
  formatPeriod,
  isPeriod,
  type ChargeKind,
  type Period,
} from "./finance";
import { PAYMENT_INSTRUCTIONS, statementPdf, statementTotals, type Statement } from "./invoicePdf";
import { escapeHtml } from "./markdown";

/** A month, or every unpaid line whenever it was billed. */
export type InvoiceScope = Period | "all";

export function isInvoiceScope(value: unknown): value is InvoiceScope {
  return value === "all" || isPeriod(value);
}

/** "September 2026", or "Everything unpaid". */
export function scopeLabel(scope: InvoiceScope): string {
  return scope === "all" ? "Everything unpaid" : formatPeriod(scope);
}

/** The subset of a Charge an invoice needs. */
export interface InvoiceCharge {
  kind: ChargeKind;
  amountCents: number;
  description: string;
  period: Period;
  incurredOn: Date | string;
  voided: boolean;
  paidAt: Date | string | null;
}

/**
 * The lines this scope puts on the invoice, oldest first: a month's standing
 * lines (paid or not), or every standing unpaid line for "all".
 */
export function invoiceLines<T extends InvoiceCharge>(scope: InvoiceScope, charges: T[]): T[] {
  return charges
    .filter((c) => !c.voided)
    .filter((c) => (scope === "all" ? !c.paidAt : c.period === scope))
    .sort((a, b) => new Date(a.incurredOn).getTime() - new Date(b.incurredOn).getTime());
}

export interface InvoiceInput {
  scope: InvoiceScope;
  memberName: string;
  /** Every one of the member's lines the route read — `invoiceLines` narrows. */
  charges: InvoiceCharge[];
  /** What the member owes across ALL months (positive = owes the club). */
  balanceDueCents: number;
  /** The officer sending it, named in the sign-off. */
  officerName: string;
  /** Where "see it in the app" links to — the Finances page. */
  financesUrl: string;
}

export interface InvoiceAttachment {
  filename: string;
  content: Uint8Array<ArrayBuffer>;
}

export interface Invoice {
  subject: string;
  text: string;
  html: string;
  /** The statement itself, as a PDF: every line and every figure lives here. */
  attachment: InvoiceAttachment;
  /** The amount the invoice is FOR: a month's outstanding, or everything owed. */
  amountDueCents: number;
  lineCount: number;
}

/**
 * Null = nothing to invoice in this scope, so nothing is sent.
 *
 * The email itself carries NO money (Dylan, 2026-11-16): it says what's
 * attached, how to pay and where to ask, and the figures live in the PDF —
 * one document a member can file, forward or print, rather than a table
 * that every mail client lays out differently.
 */
export function invoiceFor(input: InvoiceInput, issuedOn: Date = new Date()): Invoice | null {
  const lines = invoiceLines(input.scope, input.charges);
  if (lines.length === 0) return null;

  const rows = lines.map((line) => ({
    date: shortDate(line.incurredOn),
    month: line.period,
    what: line.description || CHARGE_KIND_LABELS[line.kind],
    kind: CHARGE_KIND_LABELS[line.kind],
    amountCents: line.amountCents,
    paid: Boolean(line.paidAt),
  }));
  // The PDF's own sum (charges − owed − paid), so the figure recorded for
  // the send is the one the member read.
  const amountDueCents = statementTotals(rows).dueCents;
  const label = scopeLabel(input.scope);
  const firstName = input.memberName.split(/\s+/)[0] || input.memberName;

  const subject =
    input.scope === "all"
      ? `${CLUB_NAME}: what you owe the club`
      : `${CLUB_NAME} statement for ${label}`;

  // The all-months balance is only worth a line when it says something the
  // headline doesn't: on a month invoice, and only when it differs.
  const showBalance = input.scope !== "all" && input.balanceDueCents !== amountDueCents;

  const statement: Statement = {
    title: input.scope === "all" ? "Everything unpaid" : `Statement for ${label}`,
    label,
    grouped: input.scope === "all",
    memberName: input.memberName,
    rows,
    balanceDueCents: showBalance ? input.balanceDueCents : null,
    financesUrl: input.financesUrl,
    issuedOn,
  };
  const attachment: InvoiceAttachment = {
    filename: attachmentName(input.scope, input.memberName),
    content: statementPdf(statement),
  };

  const intro =
    input.scope === "all"
      ? `Attached is a statement of everything on your ${CLUB_NAME} account that is still unpaid.`
      : `Attached is your ${CLUB_NAME} statement for ${label}.`;

  const text = [
    `Hi ${firstName},`,
    "",
    intro,
    "",
    PAYMENT_INSTRUCTIONS,
    "",
    `You can also see every line in the app: ${input.financesUrl}`,
    "",
    "Reply to this email with any questions.",
    "",
    input.officerName,
    CLUB_NAME,
  ].join("\n");

  // Every interpolated string is escaped: names are typed by members, and
  // this lands in a mail client.
  const e = escapeHtml;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;">` +
    `<p>Hi ${e(firstName)},</p>` +
    `<p>${e(intro)}</p>` +
    `<p style="padding:12px 14px;background:#fdf1ea;border-left:4px solid #c64912;margin:16px 0;">${e(PAYMENT_INSTRUCTIONS)}</p>` +
    `<p><a href="${e(input.financesUrl)}">See every line in the app</a></p>` +
    `<p style="color:#555;">Reply to this email with any questions.</p>` +
    `<p>${e(input.officerName)}<br>${e(CLUB_NAME)}</p>` +
    `</div>`;

  return { subject, text, html, attachment, amountDueCents, lineCount: lines.length };
}

/** "VFF statement 2026-08 - Alex Rivera.pdf" / "VFF unpaid - Alex Rivera.pdf". */
export function attachmentName(scope: InvoiceScope, memberName: string): string {
  // Only characters every mail client and file system is happy with.
  const who = memberName.replace(/[^A-Za-z0-9 .'-]+/g, "").replace(/\s+/g, " ").trim() || "member";
  const what = scope === "all" ? "VFF unpaid" : `VFF statement ${scope}`;
  return `${what} - ${who}.pdf`;
}

function shortDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: CLUB_TIME_ZONE,
  });
}

/**
 * The address an invoice goes to. `email` is optional on an account, but the
 * username is the email you signed up with, so it's the fallback — when it
 * looks like one.
 */
export function invoiceAddress(user: { email: string | null; username: string }): string | null {
  const candidate = user.email?.trim() || user.username.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}
