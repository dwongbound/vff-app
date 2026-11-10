import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveQueue, type AutosaveState, type SaveResult } from "@/lib/autosave";

type Form = { name: string; phone: string | null; invites: boolean };

/** A queue whose saves resolve only when the test says so. */
function harness() {
  const states: AutosaveState[] = [];
  const sent: Partial<Form>[] = [];
  const replies: ((r: SaveResult) => void)[] = [];
  const queue = new AutosaveQueue<Form>(
    (patch) => {
      sent.push(patch);
      return new Promise<SaveResult>((resolve) => replies.push(resolve));
    },
    (s) => states.push(s),
    500
  );
  const last = () => states[states.length - 1]?.status;
  /** Answer the oldest unanswered save, and let its continuation run. */
  const reply = async (r: SaveResult = { ok: true }) => {
    replies.shift()!(r);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { queue, sent, last, reply, states };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AutosaveQueue", () => {
  it("waits for typing to stop, then sends the edits as one patch", async () => {
    const h = harness();
    h.queue.queue({ name: "D" });
    h.queue.queue({ name: "Dy" });
    h.queue.queue({ phone: "555" });
    await vi.advanceTimersByTimeAsync(499);
    expect(h.sent).toEqual([]);
    expect(h.last()).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toEqual([{ name: "Dy", phone: "555" }]);
    expect(h.last()).toBe("saving");
    await h.reply();
    expect(h.last()).toBe("saved");
  });

  it("sends a switch or a pick straight away", async () => {
    const h = harness();
    h.queue.queue({ invites: false }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toEqual([{ invites: false }]);
  });

  it("keeps one save in flight, and says Saved only after the edit made during it", async () => {
    const h = harness();
    h.queue.queue({ name: "Dylan" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    h.queue.queue({ phone: "555" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    // Still only the first request: the second waits for it to land.
    expect(h.sent).toHaveLength(1);
    await h.reply();
    expect(h.last()).not.toBe("saved");
    expect(h.sent).toEqual([{ name: "Dylan" }, { phone: "555" }]);
    await h.reply();
    expect(h.last()).toBe("saved");
  });

  it("puts a refused patch back under newer edits, so the corrected value wins", async () => {
    const h = harness();
    h.queue.queue({ name: "Dylan", phone: "bad" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    await h.reply({ ok: false, error: "Nope." });
    expect(h.states[h.states.length - 1]).toEqual({ status: "error", error: "Nope." });
    h.queue.queue({ phone: "555" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent[1]).toEqual({ name: "Dylan", phone: "555" });
  });

  it("treats a thrown save as a network failure, not a crash", async () => {
    const states: AutosaveState[] = [];
    const queue = new AutosaveQueue<Form>(
      () => Promise.reject(new Error("offline")),
      (s) => states.push(s)
    );
    queue.queue({ name: "Dylan" }, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(states[states.length - 1].status).toBe("error");
    expect(queue.hasPending()).toBe(true);
  });

  it("hands over what hasn't gone when the page closes, and forgets it", async () => {
    const h = harness();
    h.queue.queue({ name: "Dylan" });
    expect(h.queue.takePending()).toEqual({ name: "Dylan" });
    expect(h.queue.takePending()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent).toEqual([]);
  });
});
