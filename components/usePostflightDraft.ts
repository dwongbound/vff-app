"use client";
// Autosave for the post-flight form. The device half of lib/postflightDraft.ts.
//
// Simpler than useCheckoutDraft by exactly one store: there is no server row to
// sync a post-flight entry to until it's filed, so there is no debounce, no
// in-flight request, and no resume race to settle. Every change goes straight
// to localStorage, synchronously, in the same tick as the keystroke.
//
// What it keeps from that hook is the part that matters: a `seeding` guard so
// restoring a draft doesn't immediately write it back, a `frozen` flag so the
// submit isn't racing a save, and a `dirty` rule that refuses to save a form
// nobody has actually filled in.
import { useCallback, useEffect, useRef, useState } from "react";
import { pruneDrafts, type DraftStore } from "@/lib/checkoutDraft";
import { checkoutFor } from "@/lib/checkouts";
import {
  clearPostflightDraft,
  postflightDraftHasProgress,
  readPostflightDraft,
  writePostflightDraft,
  type PostflightDraft,
  type PostflightForm,
} from "@/lib/postflightDraft";

/** localStorage, or null wherever it isn't usable — see useCheckoutDraft. */
function deviceStore(): DraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface PostflightDraftState {
  /** What was picked up on load, if anything — drives the restore message. */
  restored: PostflightDraft | null;
  /** When the form was last written to the device. */
  savedAt: string | null;
  /** The device refused to store anything (private mode, full quota). */
  storageBlocked: boolean;
  /** Anything worth saving has been entered. */
  dirty: boolean;
  /** Throw the draft away. */
  reset: () => void;
  /** Forget it because the flight has been FILED — nothing to come back to. */
  finish: () => void;
  /** Stop saving while the flight is being submitted. */
  freeze: () => void;
  /** Start again after a submit that didn't take. */
  thaw: () => void;
}

export function usePostflightDraft({
  aircraftId,
  memberId,
  form,
  onRestore,
}: {
  aircraftId: string | null;
  memberId: string | null;
  form: PostflightForm;
  /** Seed the page from the stored copy. Called at most once per airplane. */
  onRestore: (draft: PostflightDraft) => void;
}): PostflightDraftState {
  const turnoffVersion = checkoutFor("TURNOFF").version;

  const [restored, setRestored] = useState<PostflightDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  // Nothing may be written before the restore has run, or the form's opening
  // state would overwrite the very draft being loaded.
  const [ready, setReady] = useState(false);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const seeding = useRef(false);
  const frozen = useRef(false);

  const dirty = postflightDraftHasProgress(form);

  // Restore, once per airplane.
  useEffect(() => {
    if (!aircraftId || !memberId) return;
    setReady(false);

    // Housekeeping while we're here — both draft families, by age. Same call
    // the checkout pages make, and the reason the prefixes live together.
    pruneDrafts(deviceStore());

    const stored = readPostflightDraft(deviceStore(), {
      memberId,
      aircraftId,
      turnoffVersion,
    });
    if (stored) {
      setRestored(stored);
      setSavedAt(stored.savedAt);
      seeding.current = true;
      onRestoreRef.current(stored);
    }
    setReady(true);
  }, [aircraftId, memberId, turnoffVersion]);

  // The save itself. Synchronous, every change.
  useEffect(() => {
    if (!ready || !aircraftId || !memberId || frozen.current) return;
    if (!dirty) return;

    // The state we just seeded from the stored copy is not a change worth
    // storing back — it would only rewrite the same bytes with a newer stamp,
    // and that stamp is what the sweep reads to decide a draft is abandoned.
    if (seeding.current) {
      seeding.current = false;
      return;
    }

    const draft: PostflightDraft = {
      ...form,
      aircraftId,
      memberId,
      turnoffVersion,
      savedAt: new Date().toISOString(),
    };
    const stored = writePostflightDraft(deviceStore(), draft);
    setStorageBlocked(!stored);
    if (stored) setSavedAt(draft.savedAt);
  }, [form, dirty, ready, aircraftId, memberId, turnoffVersion]);

  const forget = useCallback(() => {
    if (memberId && aircraftId) {
      clearPostflightDraft(deviceStore(), { memberId, aircraftId });
    }
    setRestored(null);
    setSavedAt(null);
  }, [memberId, aircraftId]);

  const reset = useCallback(() => {
    forget();
  }, [forget]);

  const finish = useCallback(() => {
    forget();
    // Saving comes back on: the member may well file a second flight today, and
    // the page has already cleared itself, so `dirty` is false until they type.
    frozen.current = false;
  }, [forget]);

  const freeze = useCallback(() => {
    frozen.current = true;
  }, []);

  const thaw = useCallback(() => {
    frozen.current = false;
  }, []);

  return { restored, savedAt, storageBlocked, dirty, reset, finish, freeze, thaw };
}
