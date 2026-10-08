// Every word the app says about being offline, in one place.
//
// Two surfaces: the one-line strip at the top of the content column
// (OutboxStrip), and the line a page shows under its button after a submission
// was queued. Both are deliberately ONE SHORT LINE. The thing they report is
// almost never something the member has to act on — the outbox sends by
// itself — and a banner that takes a third of a phone screen to say "nothing
// is wrong" teaches people to read past banners, including the grounded one.
// The detail lives behind the strip's "Details" button instead.
//
// None of it says "error" or apologises. Nothing has gone wrong with the work:
// it's on the device, whole, and the only missing ingredient is signal.
import { describePending, type OutboxJob } from "@/lib/outbox";

/** Under a page's submit button after `submit` came back `queued`. */
export const QUEUED_NOTICE = "Saved offline — sends automatically when there's signal.";

export type StripTone = "red" | "amber" | "grey";

interface StripMessage {
  tone: StripTone;
  text: string;
}

/**
 * What the strip says, or null for nothing at all (the ordinary case).
 *
 * Most important first, and only ever one of them:
 *   red   — something of mine was refused, or sent with a piece missing.
 *   amber — something of mine is waiting for signal.
 *   grey  — the page is showing cached data, or another member's items are
 *           waiting on this device.
 *
 * `waiting` is only jobs that have actually FAILED a send. A submission made
 * with signal sits in the outbox for one request, and flashing the strip for
 * every ordinary squawk would be noise.
 */
export function stripMessage(args: {
  problems: OutboxJob[];
  waiting: OutboxJob[];
  sending: boolean;
  staleSince: string | null;
  staleTime: string | null;
  others: OutboxJob[];
}): StripMessage | null {
  const { problems, waiting, sending, staleSince, staleTime, others } = args;

  if (problems.length === 1) {
    return { tone: "red", text: "1 item wasn't sent" };
  }
  if (problems.length > 1) {
    return { tone: "red", text: `${problems.length} items weren't sent` };
  }

  if (waiting.length > 0 && sending) {
    return { tone: "amber", text: `Sending ${describePending(waiting)}…` };
  }
  if (waiting.length > 0) {
    return { tone: "amber", text: `${describePending(waiting)} waiting for signal` };
  }

  if (staleSince && staleTime) {
    return { tone: "grey", text: `Offline · showing data from ${staleTime}` };
  }
  if (staleSince) {
    return { tone: "grey", text: "Offline · showing saved data" };
  }

  if (others.length > 0) {
    const names = Array.from(new Set(others.map((j) => j.userName))).join(", ");
    return { tone: "grey", text: `${others.length} saved here for ${names}` };
  }

  return null;
}
