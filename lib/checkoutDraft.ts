// A half-walked checkout, kept on the device it is being walked on.
//
// This is the answer to "what happens if I close the tab at the fuel truck".
// Before this, the answer was "you lose the walk unless you remembered to press
// Save" — a button that quietly did something quite large (it wrote a real
// Checkout row to the club's server) and that nobody presses while holding a
// dipstick. Now every tick lands here immediately, and the server copy is a
// background sync rather than something the member has to think about.
//
// Two stores, on purpose, because they answer different questions:
//
//   this file (localStorage) — "is my work safe RIGHT NOW", answered without a
//     network, on a ramp with no signal, in the same tick as the tap.
//   the Checkout row          — "can I pick this up on the iPad instead", and
//     "what does the club have on record". Slower, shared, authoritative.
//
// Nothing in here touches `window` at module scope: every entry point takes the
// `Storage` to use, which is what lets the whole file be unit-tested under
// vitest's node environment (and what stops a server render from exploding on
// an undefined `localStorage`).
import {
  parseAnswers,
  parseValues,
  type Answers,
  type CheckoutKind,
  type Values,
} from "@/lib/checkouts";

/** The kinds that get a draft. TURNOFF is answered on the post-flight form. */
export type DraftKind = Extract<CheckoutKind, "PREFLIGHT" | "RUNWAY">;

/**
 * Bumped when the SHAPE below changes incompatibly.
 *
 * Read as part of the key rather than only the payload, so an old build's
 * drafts are invisible to a new one instead of being parsed and rejected one
 * by one — and so `pruneDrafts` can sweep them by key.
 */
export const DRAFT_FORMAT = 1;

export const DRAFT_KEY_PREFIX = `vff:checkout-draft:v${DRAFT_FORMAT}`;

/**
 * How long an untouched draft is worth keeping, on the device and on the
 * server. Exported because BOTH halves have to agree: the server sweep
 * (GET /api/checkouts?mine=1&open=1) and `pruneDrafts` below use this same
 * number, or one store would keep offering to resume a walk the other had
 * already thrown away.
 *
 * Seven days is well past useful — nobody resumes last Tuesday's walkaround —
 * while being long enough that a member who flies at the weekend and leaves a
 * card half-done still finds it on the Saturday after.
 */
export const ABANDONED_DRAFT_DAYS = 7;
export const ABANDONED_DRAFT_MS = ABANDONED_DRAFT_DAYS * 24 * 60 * 60 * 1000;

export interface CheckoutDraft {
  kind: DraftKind;
  aircraftId: string;
  memberId: string;
  /**
   * Which version of the card these ticks were made against. A draft whose
   * version no longer matches is DISCARDED rather than migrated — see
   * `parseDraft`.
   */
  checkoutVersion: number;
  answers: Answers;
  values: Values;
  notes: string;
  /** The Checkout row this draft syncs to, once it has reached the server. */
  serverId: string | null;
  /** When this draft was last written to the device (ISO). */
  savedAt: string;
}

/**
 * The slice of `Storage` this file uses.
 *
 * Declared rather than reusing the DOM `Storage` type so a test can pass a
 * plain Map-backed fake, and so nothing here depends on lib.dom.
 */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export interface DraftIdentity {
  memberId: string;
  aircraftId: string;
  kind: DraftKind;
}

/**
 * Where one member's draft for one card on one airplane lives.
 *
 * The MEMBER is in the key because a shared iPad in the clubhouse is a real
 * thing: two members walking the same airplane on the same device must not
 * inherit each other's ticks, which on a preflight card would be a safety bug
 * rather than an inconvenience.
 */
export function draftKey({ memberId, aircraftId, kind }: DraftIdentity): string {
  return `${DRAFT_KEY_PREFIX}:${memberId}:${aircraftId}:${kind}`;
}

/** Is this a key this module owns? Used by the sweep, which must not touch
 *  anything else the app (or another app on localhost) has stored. */
export function isDraftKey(key: string): boolean {
  return key.startsWith(`${DRAFT_KEY_PREFIX}:`);
}

/**
 * Read a stored draft back, or null if it can't be trusted.
 *
 * Everything here is a reason to DISCARD rather than repair, because a
 * checkout draft is not worth guessing at:
 *
 *   - unparseable, or not an object: a truncated write or someone else's key.
 *   - a different card version: the club reworded or reordered the card since
 *     these ticks were made, so what they asserted is no longer what the row
 *     in front of the member says. Item ids survive a rewording by design (see
 *     the rename gotcha in CLAUDE.md), which is exactly why the version — not
 *     the ids — is the thing that has to match.
 *   - a different member/airplane/kind than the key promised: only reachable
 *     by tampering, and the safe reading of a tampered checkout is "no draft".
 *
 * Answers and values are re-parsed through the card itself, so an id that no
 * longer exists is dropped here exactly as the API drops it — the device and
 * the server can't end up disagreeing about what was ticked.
 */
export function parseDraft(raw: string | null, expect: DraftIdentity & { checkoutVersion: number }): CheckoutDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;

  if (row.kind !== expect.kind) return null;
  if (row.aircraftId !== expect.aircraftId) return null;
  if (row.memberId !== expect.memberId) return null;
  if (row.checkoutVersion !== expect.checkoutVersion) return null;

  const savedAt = typeof row.savedAt === "string" ? row.savedAt : null;
  if (!savedAt || Number.isNaN(Date.parse(savedAt))) return null;

  return {
    kind: expect.kind,
    aircraftId: expect.aircraftId,
    memberId: expect.memberId,
    checkoutVersion: expect.checkoutVersion,
    answers: parseAnswers(expect.kind, row.answers),
    values: parseValues(expect.kind, row.values),
    notes: typeof row.notes === "string" ? row.notes : "",
    serverId: typeof row.serverId === "string" ? row.serverId : null,
    savedAt,
  };
}

/**
 * Load this member's draft for this card.
 *
 * Never throws: a browser with storage disabled (Safari in private mode, a
 * locked-down kiosk) must degrade to "no draft" rather than take the preflight
 * page down with it.
 */
export function readDraft(
  store: DraftStore | null,
  expect: DraftIdentity & { checkoutVersion: number }
): CheckoutDraft | null {
  if (!store) return null;
  try {
    return parseDraft(store.getItem(draftKey(expect)), expect);
  } catch {
    return null;
  }
}

/**
 * Write the draft. Returns whether it actually landed.
 *
 * The false case is real and has to be handled by the caller rather than
 * swallowed: `setItem` throws when the quota is full or storage is disabled,
 * and a page that says "Saved" when nothing was saved is worse than one that
 * admits it can only keep the work on the server.
 */
export function writeDraft(store: DraftStore | null, draft: CheckoutDraft): boolean {
  if (!store) return false;
  try {
    store.setItem(draftKey(draft), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Throw this member's draft for this card away. */
export function clearDraft(store: DraftStore | null, expect: DraftIdentity): void {
  if (!store) return;
  try {
    store.removeItem(draftKey(expect));
  } catch {
    /* nothing to do — see readDraft */
  }
}

/**
 * Sweep drafts that will never be resumed, so the device's storage is bounded.
 *
 * Deliberately blind to WHOSE draft it is: on a shared clubhouse iPad this has
 * to be able to clear out a member who hasn't signed in for a fortnight, and
 * age is the only fair way to decide that. It is not blind to age, though — a
 * live draft belonging to somebody else is left exactly where it is.
 *
 * Keys from an older `DRAFT_FORMAT` are swept too: nothing will ever read them
 * again, so they're pure residue.
 *
 * Returns the keys removed, which is what the tests assert on.
 */
export function pruneDrafts(
  store: DraftStore | null,
  now: Date = new Date(),
  maxAgeMs: number = ABANDONED_DRAFT_MS
): string[] {
  if (!store) return [];
  const removed: string[] = [];
  try {
    // Collected first: removing while walking `key(i)` renumbers the store
    // underneath the loop and silently skips entries.
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key) keys.push(key);
    }

    for (const key of keys) {
      // An older format's keys can't be parsed by this build, so age can't be
      // read off them — they go on sight.
      if (key.startsWith("vff:checkout-draft:") && !isDraftKey(key)) {
        store.removeItem(key);
        removed.push(key);
        continue;
      }
      if (!isDraftKey(key)) continue;

      const raw = store.getItem(key);
      let savedAt: string | null = null;
      try {
        const parsed = JSON.parse(raw ?? "");
        savedAt =
          parsed && typeof parsed === "object" && typeof parsed.savedAt === "string"
            ? parsed.savedAt
            : null;
      } catch {
        savedAt = null;
      }

      // Unreadable, or undateable: it can never be resumed, so it's residue.
      const at = savedAt ? Date.parse(savedAt) : NaN;
      if (Number.isNaN(at) || now.getTime() - at > maxAgeMs) {
        store.removeItem(key);
        removed.push(key);
      }
    }
  } catch {
    /* see readDraft */
  }
  return removed;
}

/** The server's half of the resume decision — one open Checkout row. */
export interface OpenRun {
  id: string;
  answers: Answers;
  values: Values;
  notes: string | null;
  /** When the row was last written. See ApiCheckout.updatedAt. */
  updatedAt: string;
}

export interface Resume {
  /** Which store the card on screen came from — shown to the member. */
  source: "device" | "server";
  answers: Answers;
  values: Values;
  notes: string;
  /** The row to PATCH from here on, or null if this draft has never synced. */
  serverId: string | null;
  savedAt: string;
}

/**
 * Which copy of an unfinished walk wins.
 *
 * Both stores can hold one and they can genuinely disagree: tick three items on
 * the phone, and for the few seconds before the debounced sync lands, the
 * device is ahead of the server. Reload in that window and the server's copy
 * would otherwise quietly undo three ticks — the exact failure that makes
 * people stop trusting a checklist app.
 *
 * So: NEWEST WINS, and a tie goes to the device. A tie means the sync had
 * just landed, so the two agree anyway; preferring the device keeps the rule
 * from depending on clock skew between a phone and the server.
 *
 * `serverId` always comes from the server row when there is one, whatever won
 * the content. The row is the member's single open draft for this card (the
 * API enforces one), so adopting it is what keeps a resumed walk from forking
 * into a second row.
 */
export function resolveResume(
  local: CheckoutDraft | null,
  server: OpenRun | null
): Resume | null {
  if (!local && !server) return null;

  if (local && !server) {
    return {
      source: "device",
      answers: local.answers,
      values: local.values,
      notes: local.notes,
      // The row this draft used to sync to is gone — reset on another device,
      // or swept as abandoned. Null, so the next sync POSTs a fresh row rather
      // than PATCHing a 404.
      serverId: null,
      savedAt: local.savedAt,
    };
  }

  if (server && !local) {
    return {
      source: "server",
      answers: server.answers,
      values: server.values,
      notes: server.notes ?? "",
      serverId: server.id,
      savedAt: server.updatedAt,
    };
  }

  const device = local!;
  const row = server!;
  const deviceWins = Date.parse(device.savedAt) >= Date.parse(row.updatedAt);

  return deviceWins
    ? {
        source: "device",
        answers: device.answers,
        values: device.values,
        notes: device.notes,
        serverId: row.id,
        savedAt: device.savedAt,
      }
    : {
        source: "server",
        answers: row.answers,
        values: row.values,
        notes: row.notes ?? "",
        serverId: row.id,
        savedAt: row.updatedAt,
      };
}

/**
 * Is there anything here worth saving?
 *
 * `ignore` is what keeps the runway card honest. Its "Preflight — complete"
 * item is answered by the APP, not the pilot (see CheckoutList's DerivedItem),
 * so a member who merely opens the page arrives with one tick already in
 * `answers`. Counting it would autosave a draft — and create a server row —
 * for somebody who has done nothing at all.
 */
export function draftHasProgress(
  answers: Answers,
  notes: string,
  ignore: readonly string[] = []
): boolean {
  if (notes.trim() !== "") return true;
  return Object.keys(answers).some((id) => answers[id] && !ignore.includes(id));
}

/**
 * "Saved just now" / "Saved 4 min ago" — the reassurance line on the draft bar.
 *
 * Coarse on purpose. The question being answered is "is my work safe", not
 * "how long exactly", and a counter ticking through every second beside a
 * checklist is movement in the corner of the eye that means nothing.
 */
export function savedAgo(savedAt: string, now: Date = new Date()): string {
  const then = Date.parse(savedAt);
  if (Number.isNaN(then)) return "saved";

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
