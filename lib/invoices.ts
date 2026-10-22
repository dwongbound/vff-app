// What the Finance Officer's monthly invoice SAYS — pure, so the wording and
// the arithmetic can be tested without a mail server.
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
  formatMoney,
  formatPeriod,
  isPeriod,
  totals,
  type ChargeKind,
  type Period,
} from "./finance";
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

export interface Invoice {
  subject: string;
  text: string;
  html: string;
  /** The amount the invoice is FOR: a month's outstanding, or everything owed. */
  amountDueCents: number;
  lineCount: number;
}

/** Null = nothing to invoice in this scope, so nothing is sent. */
export function invoiceFor(input: InvoiceInput): Invoice | null {
  const lines = invoiceLines(input.scope, input.charges);
  if (lines.length === 0) return null;

  const t = totals(lines);
  const amountDueCents = t.outstandingCents;
  const label = scopeLabel(input.scope);
  const firstName = input.memberName.split(/\s+/)[0] || input.memberName;

  const subject =
    input.scope === "all"
      ? `${CLUB_NAME}: what you owe the club`
      : `${CLUB_NAME} statement for ${label}`;

  // "You owe", "The club owes you" or "Nothing owed": a negative amount is a
  // credit, and printing "-$40.00 due" asks the member to work it out.
  const verdict = (cents: number) =>
    cents > 0
      ? `Amount due: ${formatMoney(cents)}`
      : cents < 0
        ? `The club owes you ${formatMoney(-cents)}`
        : "Nothing owed — all settled";

  // The all-months balance is only worth a line when it says something the
  // headline doesn't: on a month invoice, and only when it differs.
  const showBalance = input.scope !== "all" && input.balanceDueCents !== amountDueCents;

  const rows = lines.map((line) => ({
    date: shortDate(line.incurredOn),
    month: line.period,
    what: line.description || CHARGE_KIND_LABELS[line.kind],
    kind: CHARGE_KIND_LABELS[line.kind],
    amount: formatMoney(line.amountCents),
    paid: Boolean(line.paidAt),
  }));

  const intro =
    input.scope === "all"
      ? `Here is everything on your ${CLUB_NAME} account that is still unpaid.`
      : `Here is your ${CLUB_NAME} statement for ${label}.`;

  // ── Plain text ──
  const textLines: string[] = [`Hi ${firstName},`, "", intro, ""];
  let lastMonth: string | null = null;
  for (const row of rows) {
    if (input.scope === "all" && row.month !== lastMonth) {
      if (lastMonth !== null) textLines.push("");
      textLines.push(formatPeriod(row.month));
      lastMonth = row.month;
    }
    textLines.push(
      `  ${row.date}  ${row.what} (${row.kind})  ${row.amount}${row.paid ? "  [paid]" : ""}`
    );
  }
  textLines.push("", verdict(amountDueCents));
  if (showBalance) {
    textLines.push(`Across all months: ${balancePhrase(input.balanceDueCents)}`);
  }
  textLines.push(
    "",
    `See every line in the app: ${input.financesUrl}`,
    "",
    "Reply to this email with any questions.",
    "",
    input.officerName,
    CLUB_NAME
  );

  // ── HTML ── Every interpolated string is escaped: descriptions are typed
  // by officers and members, and this lands in a mail client.
  const e = escapeHtml;
  const cell = "padding:6px 8px;border-bottom:1px solid #eee;";
  let lastHtmlMonth: string | null = null;
  const tableRows = rows
    .map((row) => {
      let header = "";
      if (input.scope === "all" && row.month !== lastHtmlMonth) {
        lastHtmlMonth = row.month;
        header = `<tr><td colspan="3" style="padding:12px 8px 4px;font-weight:600;">${e(
          formatPeriod(row.month)
        )}</td></tr>`;
      }
      return (
        header +
        `<tr>` +
        `<td style="${cell}color:#666;white-space:nowrap;">${e(row.date)}</td>` +
        `<td style="${cell}">${e(row.what)}<br><span style="color:#888;font-size:12px;">${e(
          row.kind
        )}${row.paid ? " · paid" : ""}</span></td>` +
        `<td style="${cell}text-align:right;white-space:nowrap;${
          row.paid ? "color:#16a34a;" : ""
        }">${e(row.amount)}</td>` +
        `</tr>`
      );
    })
    .join("");

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#111;max-width:560px;">` +
    `<p>Hi ${e(firstName)},</p>` +
    `<p>${e(intro)}</p>` +
    `<table style="border-collapse:collapse;width:100%;">${tableRows}</table>` +
    `<p style="font-size:18px;font-weight:700;margin:16px 0 4px;">${e(verdict(amountDueCents))}</p>` +
    (showBalance
      ? `<p style="color:#555;margin:0;">Across all months: ${e(balancePhrase(input.balanceDueCents))}</p>`
      : "") +
    `<p style="margin-top:20px;"><a href="${e(input.financesUrl)}">See every line in the app</a></p>` +
    `<p style="color:#555;">Reply to this email with any questions.</p>` +
    `<p>${e(input.officerName)}<br>${e(CLUB_NAME)}</p>` +
    `</div>`;

  return { subject, text: textLines.join("\n"), html, amountDueCents, lineCount: lines.length };
}

function balancePhrase(cents: number): string {
  if (cents > 0) return `you owe ${formatMoney(cents)}`;
  if (cents < 0) return `the club owes you ${formatMoney(-cents)}`;
  return "nothing owed";
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
