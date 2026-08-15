// What happened when a checkout sign-off was submitted — and, more to the
// point, which of the two very different failures it was.
//
// A member pressing Complete and not getting a filed card has hit one of two
// things, and they look identical on screen while calling for opposite
// reactions:
//
//   the club REFUSED it — a stale client, a card already signed off on another
//     device, a validation rule. Something to read and act on. The server has
//     an opinion and the member needs to hear it.
//   it never got there — the airplane taxied out of range, the FBO's wifi is a
//     captive portal, the phone is in a hangar. There is nothing to fix and
//     nothing to lose: every tick is already on the device (lib/checkoutDraft),
//     so the card is safe and the only missing ingredient is signal.
//
// Telling a member "Something went wrong" for the second one is what makes them
// walk the whole card again on the assumption their work is gone. It isn't.
//
// This is the entire reason `sendJson` reports `status: null` separately from a
// status code (lib/api.ts): null means the request never got a reply, so the
// server cannot have formed an opinion about the card. Branching on the PROSE
// of an error message would be the alternative, and it isn't a stable thing to
// branch on.

/** The shape `sendJson` returns — declared here so this file imports nothing. */
export interface SendResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** The HTTP code, or null when the request never got a reply at all. */
  status: number | null;
}

export type CompletionOutcome<T> =
  /** The club has it. `data` is the row it filed. */
  | { kind: "filed"; data: T }
  /**
   * The request never left, or never landed. The card has NOT been refused and
   * must not be described as an error: the right move is to keep the walk
   * exactly as it is and press Complete again later.
   */
  | { kind: "unsent" }
  /** The server answered, and said no. `error` is its own message. */
  | { kind: "refused"; error: string };

/**
 * Sort one sign-off response into the three cases above.
 *
 * A 2xx with no body counts as REFUSED rather than filed: the caller needs the
 * row (to hang photos and squawks off), and pretending an empty success is a
 * filed card would drop them silently. It is not `unsent` either — the server
 * plainly answered.
 */
export function completionOutcome<T>(
  result: SendResult<T>,
  fallbackError: string
): CompletionOutcome<T> {
  if (result.ok && result.data) return { kind: "filed", data: result.data };
  if (result.status === null) return { kind: "unsent" };
  return { kind: "refused", error: result.error ?? fallbackError };
}

export interface UnsentNotice {
  /** The bolded first clause — what state the member is in right now. */
  lead: string;
  /** What that means for their walk, and what to do about it. */
  body: string;
}

/**
 * What to tell a member whose sign-off didn't reach the club.
 *
 * Two states rather than one, because the useful sentence changes the moment
 * the signal comes back and the member is very unlikely to be looking at the
 * screen at that moment. Coming back to a page still saying "no connection"
 * when there plainly is one is how a member learns to distrust the whole strip.
 *
 * Neither version apologises and neither says "error". Nothing has gone wrong
 * with the walk — it is sitting on the device, complete, waiting to be sent.
 */
export function unsentNotice(online: boolean): UnsentNotice {
  return online
    ? {
        lead: "Back in range.",
        body: "Press Complete again to file this card with the club.",
      }
    : {
        lead: "No connection.",
        body:
          "Every tick is saved on this device, so nothing is lost — press " +
          "Complete again once you're back in range.",
      };
}
