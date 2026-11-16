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

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where a reply lands — the officer who sent it, not a no-reply box. */
  replyTo?: string | null;
  /** Files to attach (the invoice's PDF statement). */
  attachments?: EmailAttachment[];
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Resend takes at most this many messages per batch call. */
export const BATCH_LIMIT = 100;

/**
 * Pause between single sends. Resend's batch endpoint doesn't take
 * attachments, so a message carrying one goes on its own — and the API
 * allows a couple of requests a second, so they go one at a time with room.
 */
export const SINGLE_SEND_GAP_MS = 600;

/**
 * Send many messages, answering one result per message in the same order.
 * Never throws: a failure is a result, so the caller can say who didn't get
 * one rather than losing the whole run to the first refusal.
 */
export async function sendEmails(
  messages: OutgoingEmail[],
  env: Record<string, string | undefined> = process.env,
  gapMs: number = SINGLE_SEND_GAP_MS
): Promise<SendResult[]> {
  const status = emailStatus(env);
  if (!status.configured) {
    return messages.map(() => ({ ok: false, error: status.reason ?? "Email isn't set up." }));
  }

  if (status.driver === "log") {
    for (const m of messages) {
      const files = (m.attachments ?? []).map((a) => `${a.filename} (${a.content.length} bytes)`);
      console.log(
        `[email:log] to=${m.to} subject=${JSON.stringify(m.subject)}` +
          (files.length > 0 ? ` attachments=${JSON.stringify(files)}` : "")
      );
    }
    return messages.map(() => ({ ok: true }));
  }

  // Messages with attachments can't ride in a batch, so they go one by one;
  // the rest still batch. Results come back in the caller's order either way.
  const results: SendResult[] = new Array(messages.length);
  const plain: number[] = [];
  const attached: number[] = [];
  messages.forEach((m, i) => ((m.attachments?.length ?? 0) > 0 ? attached : plain).push(i));

  for (let i = 0; i < plain.length; i += BATCH_LIMIT) {
    const chunk = plain.slice(i, i + BATCH_LIMIT);
    const outcomes = await sendResendBatch(chunk.map((idx) => messages[idx]), env);
    chunk.forEach((idx, j) => (results[idx] = outcomes[j]));
  }
  for (let j = 0; j < attached.length; j++) {
    if (j > 0 && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const idx = attached[j];
    results[idx] = await sendResendSingle(messages[idx], env);
  }
  return results;
}

/** Bytes → base64, which is how Resend takes an attachment's content. */
function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** One message's body for Resend, attachments included when it has any. */
function resendBody(m: OutgoingEmail, env: Record<string, string | undefined>) {
  return {
    from: env.EMAIL_FROM,
    to: [m.to],
    subject: m.subject,
    text: m.text,
    html: m.html,
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.attachments && m.attachments.length > 0
      ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: base64(a.content) })) }
      : {}),
  };
}

/** The mail service's own sentence about a refusal, or a plain one. */
async function refusal(res: Response, what: string): Promise<string> {
  const detail = await res.json().catch(() => null);
  return (
    (detail && typeof detail.message === "string" && detail.message) ||
    `The mail service refused the ${what} (HTTP ${res.status}).`
  );
}

async function sendResendSingle(
  message: OutgoingEmail,
  env: Record<string, string | undefined>
): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody(message, env)),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: await refusal(res, "message") };
  } catch {
    return { ok: false, error: "Couldn't reach the mail service." };
  }
}

async function sendResendBatch(
  messages: OutgoingEmail[],
  env: Record<string, string | undefined>
): Promise<SendResult[]> {
  const body = messages.map((m) => resendBody(m, env));
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
    const error = await refusal(res, "batch");
    return messages.map(() => ({ ok: false, error }));
  } catch {
    return messages.map(() => ({ ok: false, error: "Couldn't reach the mail service." }));
  }
}
