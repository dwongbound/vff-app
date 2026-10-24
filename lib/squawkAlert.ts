// The email a new squawk sends to the Safety Officer — pure, so who gets it
// and what it says can be tested without a mail server or a database.
//
// A squawk lands at NEW and sits there until somebody with `squawk:manage`
// reads it, and until now the only way to find out one existed was to open
// the Squawks tab. The whole triage model assumes the officer KNOWS — a
// "reviewed, grounded" status nobody set because nobody looked is the gap
// this closes.
//
// Who: everyone holding the SAFETY_OFFICER office. With nobody in it, the
// admins — they hold every capability implicitly (lib/positions.ts) for
// exactly this reason, so a vacant office never means a squawk goes unseen.
// The member who filed it is left out: they know.
import { CLUB_NAME, CLUB_TIME_ZONE } from "./constants";
import { invoiceAddress } from "./invoices";
import { escapeHtml } from "./markdown";

export interface AlertCandidate {
  id: string;
  email: string | null;
  username: string;
  isAdmin: boolean;
  positions: string[];
}

/**
 * The addresses a new squawk is mailed to, deduplicated. `fallback` is true
 * when nobody holds the office and the admins are standing in.
 */
export function squawkAlertRecipients(
  people: AlertCandidate[],
  reporterId: string
): { addresses: string[]; fallback: boolean } {
  const officers = people.filter((p) => p.positions.includes("SAFETY_OFFICER"));
  const fallback = officers.length === 0;
  const chosen = fallback ? people.filter((p) => p.isAdmin) : officers;
  const addresses = new Set<string>();
  for (const p of chosen) {
    if (p.id === reporterId) continue;
    const address = invoiceAddress(p);
    if (address) addresses.add(address.toLowerCase());
  }
  return { addresses: [...addresses], fallback };
}

export interface SquawkAlertInput {
  tailNumber: string;
  title: string;
  description: string | null;
  reporterName: string;
  filedAt: Date | string;
  /** Where the officer goes to triage it — /status/squawks#<id>. */
  squawkUrl: string;
  /** True when the office is empty and this is going to the admins. */
  fallback: boolean;
}

export function squawkAlertEmail(input: SquawkAlertInput): {
  subject: string;
  text: string;
  html: string;
} {
  const when = new Date(input.filedAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLUB_TIME_ZONE,
  });
  const subject = `New squawk on ${input.tailNumber}: ${input.title}`;
  const filed = `${input.reporterName} filed a squawk on ${input.tailNumber} (${when}).`;
  const ask = "It's waiting for review — set its status so the next pilot knows whether the airplane flies.";
  const whyYou = input.fallback
    ? "You're getting this as an admin because nobody holds the Safety Officer position."
    : "You're getting this as the club's Safety Officer.";

  const text = [
    filed,
    "",
    input.title,
    ...(input.description ? ["", input.description] : []),
    "",
    ask,
    `Review it: ${input.squawkUrl}`,
    "",
    "Reply to this email to reach the member who filed it.",
    "",
    whyYou,
    CLUB_NAME,
  ].join("\n");

  // Every interpolated string is escaped: the title and description are
  // typed by members, and this lands in a mail client.
  const e = escapeHtml;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#111;max-width:560px;">` +
    `<p>${e(filed)}</p>` +
    `<div style="border-left:3px solid #f59e0b;padding:4px 12px;margin:16px 0;">` +
    `<p style="font-weight:700;margin:4px 0;">${e(input.title)}</p>` +
    (input.description
      ? `<p style="margin:4px 0;white-space:pre-wrap;">${e(input.description)}</p>`
      : "") +
    `</div>` +
    `<p>${e(ask)}</p>` +
    `<p><a href="${e(input.squawkUrl)}">Review it in the app</a></p>` +
    `<p style="color:#555;">Reply to this email to reach the member who filed it.</p>` +
    `<p style="color:#888;font-size:12px;">${e(whyYou)}<br>${e(CLUB_NAME)}</p>` +
    `</div>`;

  return { subject, text, html };
}
