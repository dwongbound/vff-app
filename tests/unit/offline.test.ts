import { describe, expect, it } from "vitest";
import { completionOutcome, unsentNotice } from "@/lib/offline";

const FALLBACK = "Could not save the checkout.";

/** A `sendJson` result, spelled out so each test names only what it's about. */
function result<T>(over: Partial<{
  ok: boolean;
  data: T | null;
  error: string | null;
  status: number | null;
}>) {
  return { ok: false, data: null, error: null, status: 500, ...over };
}

describe("completionOutcome", () => {
  it("files a card the server answered with a row", () => {
    const outcome = completionOutcome(
      result({ ok: true, data: { id: "chk1" }, error: null, status: 200 }),
      FALLBACK
    );
    expect(outcome).toEqual({ kind: "filed", data: { id: "chk1" } });
  });

  it("calls a request that never got a reply UNSENT, not an error", () => {
    // status === null is `sendJson`'s "the fetch threw" — no server opinion
    // exists, so there is nothing for the member to read or fix.
    const outcome = completionOutcome(
      result({ error: "Network error — please retry.", status: null }),
      FALLBACK
    );
    expect(outcome).toEqual({ kind: "unsent" });
  });

  it("passes a refusal's own message through", () => {
    const outcome = completionOutcome(
      result({ error: "That checkout is already signed off.", status: 409 }),
      FALLBACK
    );
    expect(outcome).toEqual({
      kind: "refused",
      error: "That checkout is already signed off.",
    });
  });

  it("falls back when the server refuses without saying why", () => {
    const outcome = completionOutcome(result({ error: null, status: 500 }), FALLBACK);
    expect(outcome).toEqual({ kind: "refused", error: FALLBACK });
  });

  it("treats a 2xx with no row as a refusal rather than a filed card", () => {
    // The caller needs the row to hang photos and squawks off. Reporting this
    // as filed would drop them silently — and it isn't `unsent` either, since
    // the server plainly answered.
    const outcome = completionOutcome(
      result({ ok: true, data: null, status: 204 }),
      FALLBACK
    );
    expect(outcome).toEqual({ kind: "refused", error: FALLBACK });
  });
});

describe("unsentNotice", () => {
  it("reassures rather than apologising while offline", () => {
    const notice = unsentNotice(false);
    expect(notice.lead).toBe("No connection.");
    expect(notice.body).toContain("saved on this device");
    expect(notice.body).toContain("nothing is lost");
  });

  it("switches to the next action once signal is back", () => {
    // The member is not looking at the screen when the signal returns, so the
    // message they come back to has to be the one that's true then.
    const notice = unsentNotice(true);
    expect(notice.lead).toBe("Back in range.");
    expect(notice.body).toContain("Press Complete again");
  });

  it("never calls either state an error", () => {
    for (const online of [true, false]) {
      const { lead, body } = unsentNotice(online);
      expect(`${lead} ${body}`.toLowerCase()).not.toContain("error");
      expect(`${lead} ${body}`.toLowerCase()).not.toContain("failed");
    }
  });
});
