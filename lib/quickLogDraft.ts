// Quick Log's numbers, kept on the device until they're filed.
//
// Quick Log was the one form with no autosave, on the theory that four boxes
// and a button needed none. In practice it's filled in standing at the tail,
// and a member who checks the log for the last tach, or taps another tab to
// look something up, came back to empty boxes. So it keeps what's typed the
// same way the post-flight form does (lib/postflightDraft.ts): one store, the
// DEVICE, because nothing exists on the server until the flight is filed.
//
// Kept per member AND per airplane: the club's clubhouse iPad is shared, and a
// tach reading typed for one airplane must never turn up in another's form.
// Swept by `pruneDrafts` at the same age as every other draft — the key prefix
// lives with the others in lib/checkoutDraft.ts for exactly that reason.
//
// Nothing here touches `window`: every entry point takes its store, which is
// what makes it testable under vitest's node environment.
import { QUICKLOG_DRAFT_KEY_PREFIX, type DraftStore } from "./checkoutDraft";

/** The form, as the STRINGS its boxes hold — a half-typed "150" included. */
export interface QuickLogForm {
  flownOn: string;
  tachStart: string;
  tachEnd: string;
  hobbsStart: string;
  hobbsEnd: string;
  airports: string;
  fuelAdded: string;
  fuelPrice: string;
  oilAdded: string;
  paidPersonally: boolean;
  /** The flight type, as the select holds it ("" = not set). */
  purpose?: string;
  /**
   * Which start boxes the member typed over. An untouched start box follows
   * the app's best reading; a typed one must come back as typed, not be
   * overwritten by the prefill the moment the page reloads.
   */
  edited: { tachStart: boolean; hobbsStart: boolean };
}

export interface QuickLogDraft extends QuickLogForm {
  memberId: string;
  aircraftId: string;
  savedAt: string;
}

/** Where this member's draft for this airplane lives in the store. */
export function quickLogDraftKey({
  memberId,
  aircraftId,
}: {
  memberId: string;
  aircraftId: string;
}): string {
  return `${QUICKLOG_DRAFT_KEY_PREFIX}:${memberId}:${aircraftId}`;
}

/**
 * Is there anything worth keeping? Only what the MEMBER brought: an end
 * reading, where they landed, fuel or oil. The start boxes alone don't count —
 * they're usually the app's own prefill (or the last flight's end carried
 * forward), and saving that would greet every visit with a "draft" nobody wrote.
 */
export function quickLogHasProgress(form: QuickLogForm): boolean {
  return [form.tachEnd, form.hobbsEnd, form.airports, form.fuelAdded, form.fuelPrice, form.oilAdded]
    .some((value) => value.trim() !== "");
}

const STRING_FIELDS = [
  "flownOn",
  "tachStart",
  "tachEnd",
  "hobbsStart",
  "hobbsEnd",
  "airports",
  "fuelAdded",
  "fuelPrice",
  "oilAdded",
] as const;

/**
 * Read a stored draft back — or null. DISCARDS rather than repairs, like the
 * other drafts: a draft for somebody else, another airplane, or in a shape
 * this build doesn't recognise is not one to guess at.
 */
export function parseQuickLogDraft(
  raw: string | null,
  expect: { memberId: string; aircraftId: string }
): QuickLogDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.memberId !== expect.memberId || d.aircraftId !== expect.aircraftId) return null;
  if (typeof d.savedAt !== "string") return null;
  for (const field of STRING_FIELDS) {
    if (typeof d[field] !== "string") return null;
  }
  if (typeof d.paidPersonally !== "boolean") return null;
  // Optional: drafts saved before the type picker existed simply have none.
  if (d.purpose !== undefined && typeof d.purpose !== "string") return null;
  const edited = d.edited as Record<string, unknown> | undefined;
  if (
    !edited ||
    typeof edited.tachStart !== "boolean" ||
    typeof edited.hobbsStart !== "boolean"
  ) {
    return null;
  }
  return d as unknown as QuickLogDraft;
}

/** This member's draft for this airplane, or null (none, unreadable, foreign). */
export function readQuickLogDraft(
  store: DraftStore | null,
  expect: { memberId: string; aircraftId: string }
): QuickLogDraft | null {
  if (!store) return null;
  try {
    return parseQuickLogDraft(store.getItem(quickLogDraftKey(expect)), expect);
  } catch {
    // Storage that throws (private mode, a full disk) means "no draft".
    return null;
  }
}

/** Save the draft; false if the device wouldn't take it. */
export function writeQuickLogDraft(store: DraftStore | null, draft: QuickLogDraft): boolean {
  if (!store) return false;
  try {
    store.setItem(quickLogDraftKey(draft), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Throw this member's draft for this airplane away — on File, or Discard. */
export function clearQuickLogDraft(
  store: DraftStore | null,
  expect: { memberId: string; aircraftId: string }
): void {
  if (!store) return;
  try {
    store.removeItem(quickLogDraftKey(expect));
  } catch {
    /* see readQuickLogDraft */
  }
}
