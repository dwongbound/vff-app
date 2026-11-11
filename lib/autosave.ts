// A form that saves itself: edits are collected into ONE pending patch and
// sent a moment after the member stops typing, one request at a time. Pure —
// no React, no fetch — so the ordering rules are unit-tested
// (tests/unit/autosave.test.ts); `components/useAutosave.ts` is the hook.
//
// The rules, and why:
//   - Edits MERGE. Typing "Dylan" is five changes and should be one request,
//     and a later edit to a field replaces an earlier one that hasn't gone yet.
//   - One request in flight at a time. Two PATCHes racing can land in either
//     order, and the older one landing last would undo the newer.
//   - A refused or failed patch is put BACK under anything typed since, so the
//     next save tries it again; a corrected value simply replaces it.
//   - "Saved" is only said once nothing is pending or in flight — the status
//     line must never claim a change is kept while it's still on its way.

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveState {
  status: AutosaveStatus;
  /** The server's (or the network's) words, while `status` is "error". */
  error: string | null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** How long after the last edit a save goes, when the edit isn't immediate. */
export const AUTOSAVE_DELAY_MS = 700;

const NETWORK_ERROR = "Couldn't reach the club to save that. It will try again with your next change.";

export class AutosaveQueue<T extends object> {
  private pending: Partial<T> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(
    private readonly save: (patch: Partial<T>) => Promise<SaveResult>,
    private readonly onState: (state: AutosaveState) => void,
    private readonly delayMs: number = AUTOSAVE_DELAY_MS
  ) {}

  /**
   * Add an edit. Typed text waits `delayMs` for the next keystroke; a switch,
   * a picked option or a date is `immediate`, because there is no "still
   * typing" to wait for.
   */
  queue(patch: Partial<T>, opts: { immediate?: boolean } = {}): void {
    this.pending = { ...this.pending, ...patch };
    this.onState({ status: "pending", error: null });
    this.clearTimer();
    if (opts.immediate) {
      void this.flush();
    } else {
      this.timer = setTimeout(() => void this.flush(), this.delayMs);
    }
  }

  /** Whether an edit is waiting to go (not counting one already in flight). */
  hasPending(): boolean {
    return Object.keys(this.pending).length > 0;
  }

  /**
   * Hand over what hasn't gone yet and forget it — for the page being closed,
   * when the only chance left is a keepalive request the page won't hear back
   * from.
   */
  takePending(): Partial<T> | null {
    this.clearTimer();
    if (!this.hasPending()) return null;
    const patch = this.pending;
    this.pending = {};
    return patch;
  }

  /** Send what's pending now. A save already in flight picks it up after. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.busy || !this.hasPending()) return;
    const patch = this.pending;
    this.pending = {};
    this.busy = true;
    this.onState({ status: "saving", error: null });

    let result: SaveResult;
    try {
      result = await this.save(patch);
    } catch {
      result = { ok: false, error: NETWORK_ERROR };
    }
    this.busy = false;

    if (!result.ok) {
      // Underneath anything typed since: the newer value of a field wins.
      this.pending = { ...patch, ...this.pending };
      this.onState({ status: "error", error: result.error });
      return;
    }
    if (this.hasPending()) {
      // Edited while that was in flight: send the rest before saying "Saved".
      return this.flush();
    }
    this.onState({ status: "saved", error: null });
  }

  /** Stop the timer (the page is going); pending edits are left to the caller. */
  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
