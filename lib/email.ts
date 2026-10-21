// Outgoing email — today, only the Finance Officer's invoices.
//
// Resend's HTTP API by hand with fetch, for the same reason `storage/s3.ts`
// signs its own requests and `googleCalendar.ts` speaks REST directly: one
// POST doesn't earn an SDK. A second driver, `log`, prints the message instead
// of sending it, which is what dev and the e2e suite run on — a test run must
// never mail a real member.
//
// `emailStatus(env)` is pure and is the SINGLE answer to "can this deployment
// send email", the way `storageStatus` is for photos: the invoice window reads
// it to say what's missing, and `sendEmails` refuses on the same rule, so the
// two can't disagree.

export type EmailDriver = "resend" | "log";

export interface EmailStatus {
  configured: boolean;
  driver: EmailDriver | null;
  /** One sentence naming what's missing. Null when it's fine. */
  reason: string | null;
}

export function emailStatus(
  env: Record<string, string | undefined> = process.env
): EmailStatus {
  const named = env.EMAIL_DRIVER?.trim().toLowerCase();
  if (named === "log") return { configured: true, driver: "log", reason: null };
  if (named && named !== "resend") {
    return {
      configured: false,
      driver: null,
      reason: `EMAIL_DRIVER=${named} isn't a driver this app knows (resend or log).`,
    };
  }
  const missing = (["RESEND_API_KEY", "EMAIL_FROM"] as const).filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    return {
      configured: false,
      driver: null,
      reason: `Email isn't set up on this server: ${missing.join(" and ")} ${
        missing.length === 1 ? "is" : "are"
      } not set.`,
    };
  }
  return { configured: true, driver: "resend", reason: null };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where a reply lands — the officer who sent it, not a no-reply box. */
  replyTo?: string | null;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Resend takes at most this many messages per batch call. */
export const BATCH_LIMIT = 100;

/**
 * Send many messages, answering one result per message in the same order.
 * Never throws: a failure is a result, so the caller can say who didn't get
 * one rather than losing the whole run to the first refusal.
 */
export async function sendEmails(
  messages: OutgoingEmail[],
  env: Record<string, string | undefined> = process.env
): Promise<SendResult[]> {
  const status = emailStatus(env);
  if (!status.configured) {
    return messages.map(() => ({ ok: false, error: status.reason ?? "Email isn't set up." }));
  }

  if (status.driver === "log") {
    for (const m of messages) {
      console.log(`[email:log] to=${m.to} subject=${JSON.stringify(m.subject)}`);
    }
    return messages.map(() => ({ ok: true }));
  }

  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
    const chunk = messages.slice(i, i + BATCH_LIMIT);
    results.push(...(await sendResendBatch(chunk, env)));
  }
  return results;
}

async function sendResendBatch(
  messages: OutgoingEmail[],
  env: Record<string, string | undefined>
): Promise<SendResult[]> {
  const body = messages.map((m) => ({
    from: env.EMAIL_FROM,
    to: [m.to],
    subject: m.subject,
    text: m.text,
    html: m.html,
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
  }));
  try {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return messages.map(() => ({ ok: true }));
    // A batch is validated as a whole, so a refusal applies to every message
    // in it. Resend's error body carries a human sentence; keep it.
    const detail = await res.json().catch(() => null);
    const error =
      (detail && typeof detail.message === "string" && detail.message) ||
      `The mail service refused the batch (HTTP ${res.status}).`;
    return messages.map(() => ({ ok: false, error }));
  } catch {
    return messages.map(() => ({ ok: false, error: "Couldn't reach the mail service." }));
  }
}
