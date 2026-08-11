"use client";
// Autosave for a checkout card: every tick to the device, the device to the
// server in the background.
//
// This replaces the old Save button, which was the only thing that ever wrote a
// half-finished walk anywhere. The problem with it wasn't that it did the wrong
// thing — it wrote a real Checkout row, which is what cross-device resume needs
// — it's that it asked a member holding a fuel dipstick to remember to press it,
// and closing the tab before they did threw the walk away.
//
// The split of duties:
//
//   localStorage — written SYNCHRONOUSLY on every change, no network involved.
//     This is the promise that the work is safe. It is the store that keeps
//     working on a ramp with no signal, which is where this app is used.
//   the Checkout row — written on a debounce. This is what lets a walk started
//     on a phone be finished on the clubhouse iPad, and it's what the club has
//     on record.
//
// The device is therefore allowed to be AHEAD of the server, and `resolveResume`
// (lib/checkoutDraft.ts) is the rule for reconciling them on the next load.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { checkoutFor, type Answers, type Values } from "@/lib/checkouts";
import {
  clearDraft,
  draftHasProgress,
  pruneDrafts,
  readDraft,
  resolveResume,
  writeDraft,
  type CheckoutDraft,
  type DraftKind,
  type DraftStore,
  type Resume,
} from "@/lib/checkoutDraft";
import type { ApiCheckout } from "@/lib/types";

/**
 * How long the card has to be quiet before the server copy is brought up to
 * date.
 *
 * Long enough that working down a section is one request rather than fifteen,
 * short enough that putting the phone in a pocket and walking to the tail has
 * already synced. The device copy is instant either way, so this delay is never
 * the difference between keeping and losing work — only between one device and
 * two.
 */
const SYNC_DELAY_MS = 2_500;

/** localStorage, or null wherever it isn't usable (SSR, private mode, kiosk). */
function deviceStore(): DraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    // The property ACCESS itself throws when storage is blocked by policy, so
    // this is inside the try rather than beside it.
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface CheckoutDraftState {
  /** What was picked up on load, if anything — drives the resume message. */
  resume: Resume | null;
  /** When the card on screen was last written to the device. */
  savedAt: string | null;
  /** A background sync is in flight. */
  syncing: boolean;
  /**
   * The last sync failed. The work is safe on THIS device but the club's
   * server doesn't have it yet, which is a real distinction to show: it means
   * "don't finish this on the iPad", not "your work is gone".
   */
  deviceOnly: boolean;
  /** The device refused to store anything (private mode, full quota). */
  storageBlocked: boolean;
  /** The row a sign-off should PATCH, or null to POST a fresh one. */
  serverId: string | null;
  /** Anything worth saving has been entered. */
  dirty: boolean;
  /** Throw the draft away, both copies. */
  reset: () => Promise<{ ok: boolean; error?: string }>;
  /** Forget the draft locally WITHOUT deleting the row — used after sign-off,
   *  where the row stops being a draft and becomes the airplane's record. */
  finish: () => void;
  /**
   * Stop autosaving, because a sign-off is being submitted. Call before the
   * request; call `thaw()` if it fails, or `finish()` if it succeeds.
   */
  freeze: () => void;
  /** Start autosaving again after a sign-off that didn't take. */
  thaw: () => void;
}

export function useCheckoutDraft({
  kind,
  aircraftId,
  memberId,
  answers,
  values,
  notes,
  derivedIds,
  onResume,
  onSynced,
}: {
  kind: DraftKind;
  aircraftId: string | null;
  memberId: string | null;
  answers: Answers;
  values: Values;
  notes: string;
  /**
   * Items the APP answers rather than the pilot (the runway card's "Preflight
   * — complete"). They don't count as progress: opening a page is not work,
   * and counting them would create a server row for a member who has done
   * nothing.
   */
  derivedIds?: readonly string[];
  /** Seed the page from whichever copy won. Called at most once per airplane. */
  onResume: (resume: Resume) => void;
  /**
   * A sync landed, and here is the row id it landed on.
   *
   * This is what stops the loss of the old Save button from being a
   * regression. Save didn't only write the ticks: it also uploaded any photos
   * and filed any squawks raised on the walk, both of which need a row to hang
   * off. Squawks especially must not wait for a sign-off — the walk that finds
   * a bad tyre is exactly the walk that never gets signed off, because nobody
   * flies it.
   */
  onSynced?: (checkoutId: string) => void | Promise<void>;
}): CheckoutDraftState {
  const checkoutVersion = checkoutFor(kind).version;

  const [resume, setResume] = useState<Resume | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deviceOnly, setDeviceOnly] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  // Resume has finished. Nothing may be written before it: an autosave firing
  // against the page's empty opening state would overwrite the very draft we
  // are in the middle of loading.
  const [ready, setReady] = useState(false);

  // Latest values, for the debounce timer to read when it fires. Kept as refs
  // so the timer doesn't have to be re-armed on every keystroke.
  const latest = useRef({ answers, values, notes, serverId, aircraftId });
  latest.current = { answers, values, notes, serverId, aircraftId };
  const derivedRef = useRef(derivedIds);
  derivedRef.current = derivedIds;
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /**
   * Swallow the one autosave that seeding the page would otherwise cause.
   *
   * `onResume` sets answers/values/notes, which is a change like any other, so
   * the effect below would write the draft straight back and PATCH the server —
   * for a member who has done nothing but open the page. Beyond being wasteful
   * that would defeat the abandoned-draft sweep: `updatedAt` is what decides
   * whether a run has gone idle, so a card somebody opens every week and never
   * works on would keep resetting its own clock and never age out.
   */
  const seeding = useRef(false);
  /**
   * Autosave is off — the page is signing off, or has finished.
   *
   * Without this, a debounced sync that comes due while the sign-off request is
   * in flight would POST a fresh DRAFT a moment after the walk was signed for,
   * and the member's next visit would offer to resume the card they had just
   * put their name to.
   */
  const frozen = useRef(false);
  // A change arrived while a sync was running, so the copy that just landed is
  // already out of date and another one is owed.
  const again = useRef(false);

  const dirty = draftHasProgress(answers, notes, derivedIds);

  /** Push the current card to the server. */
  const sync = useCallback(async () => {
    const { answers: a, values: v, notes: n, serverId: id, aircraftId: ac } =
      latest.current;
    if (frozen.current || !ac) return;
    if (!draftHasProgress(a, n, derivedRef.current)) return;

    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    setSyncing(true);

    const payload = { answers: a, values: v, notes: n.trim() || null, complete: false };
    const result = id
      ? await sendJson<ApiCheckout>(`/api/checkouts/${id}`, "PATCH", payload)
      : await sendJson<ApiCheckout>("/api/checkouts", "POST", {
          aircraftId: ac,
          kind,
          ...payload,
        });

    inFlight.current = false;
    setSyncing(false);

    if (result.ok && result.data) {
      setServerId(result.data.id);
      latest.current.serverId = result.data.id;
      setDeviceOnly(false);
      // There's a row now, so anything that was waiting for one can go up.
      await onSyncedRef.current?.(result.data.id);
    } else if (id && (result.status === 404 || result.status === 409)) {
      // The row we were syncing to is no longer ours to write: deleted from
      // another device (404), or signed off there (409). Either way this
      // device's ticks are real work that nobody asked to throw away, so we
      // forget the id and let the next pass POST a fresh draft rather than
      // retrying a write that can only fail again.
      setServerId(null);
      latest.current.serverId = null;
      again.current = true;
    } else {
      // Everything else — offline, a 500, a dropped connection. The device
      // copy still holds the work; say so rather than crying failure.
      setDeviceOnly(true);
    }

    if (again.current) {
      again.current = false;
      void sync();
    }
  }, [kind]);

  /** Restart the quiet period. */
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void sync();
    }, SYNC_DELAY_MS);
  }, [sync]);

  // Resolve which copy to resume, once per airplane.
  //
  // Deliberately not part of the pages' `refresh()`, which runs again after
  // every write: re-seeding there would overwrite whatever has been ticked
  // since. This is the one moment a stored copy can be newer than the screen.
  useEffect(() => {
    if (!aircraftId || !memberId) return;
    let cancelled = false;
    setReady(false);

    // Housekeeping while we're here: drafts nobody will ever resume, on this
    // device, from any member. Bounded storage without a chore anyone has to
    // remember. See ABANDONED_DRAFT_DAYS — the server sweep uses the same age.
    pruneDrafts(deviceStore());

    const local = readDraft(deviceStore(), {
      memberId,
      aircraftId,
      kind,
      checkoutVersion,
    });

    fetchJsonArray<ApiCheckout>(
      `/api/checkouts?aircraftId=${aircraftId}&kind=${kind}&mine=1&open=1&limit=1`
    ).then((rows) => {
      if (cancelled) return;
      const row = rows[0];
      const picked = resolveResume(
        local,
        row
          ? {
              id: row.id,
              answers: row.answers,
              values: row.values,
              notes: row.notes,
              updatedAt: row.updatedAt,
            }
          : null
      );

      if (picked) {
        setResume(picked);
        setServerId(picked.serverId);
        latest.current.serverId = picked.serverId;
        setSavedAt(picked.savedAt);
        seeding.current = true;
        onResumeRef.current(picked);
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [aircraftId, memberId, kind, checkoutVersion]);

  // The autosave itself. Device first and synchronously, server on a debounce.
  useEffect(() => {
    if (!ready || !aircraftId || !memberId) return;
    if (!draftHasProgress(answers, notes, derivedRef.current)) return;

    // The state we just seeded from the stored copy is not a change worth
    // storing back — see `seeding`.
    if (seeding.current) {
      seeding.current = false;
      return;
    }

    const draft: CheckoutDraft = {
      kind,
      aircraftId,
      memberId,
      checkoutVersion,
      answers,
      values,
      notes,
      serverId: latest.current.serverId,
      savedAt: new Date().toISOString(),
    };

    const stored = writeDraft(deviceStore(), draft);
    setStorageBlocked(!stored);
    if (stored) setSavedAt(draft.savedAt);
    schedule();
  }, [answers, values, notes, ready, aircraftId, memberId, kind, checkoutVersion, schedule]);

  // Don't sit on an unsynced change while the page is being closed or
  // backgrounded. Best-effort — the device copy is what actually guarantees the
  // work, so a request that doesn't finish costs nothing.
  useEffect(() => {
    function flush() {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void sync();
    }
    // `visibilitychange` is the one that fires reliably when a phone is locked
    // or the app is switched away from; `pagehide` covers a real navigation.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      // Unmounting mid-debounce is a navigation away from the page, which is
      // exactly the case the timer exists to survive.
      flush();
    };
  }, [sync]);

  const reset = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    // The device copy goes first and unconditionally. If the server call fails
    // we must not be left with a local draft that the next load would resume —
    // "Reset" that leaves the ticks on screen is the worst of both.
    if (memberId && aircraftId) {
      clearDraft(deviceStore(), { memberId, aircraftId, kind });
    }

    let error: string | undefined;
    if (serverId) {
      const result = await sendJson(`/api/checkouts/${serverId}`, "DELETE");
      // A row that's already gone is the outcome we wanted, not a failure.
      if (!result.ok && result.status !== 404) {
        error = result.error ?? "Could not discard the saved checkout.";
      }
    }

    setResume(null);
    setServerId(null);
    latest.current.serverId = null;
    setSavedAt(null);
    setDeviceOnly(false);
    return error ? { ok: false, error } : { ok: true };
  }, [serverId, memberId, aircraftId, kind]);

  const freeze = useCallback(() => {
    frozen.current = true;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const thaw = useCallback(() => {
    frozen.current = false;
  }, []);

  const finish = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (memberId && aircraftId) {
      clearDraft(deviceStore(), { memberId, aircraftId, kind });
    }
    setResume(null);
    setServerId(null);
    latest.current.serverId = null;
    setSavedAt(null);
    setDeviceOnly(false);
    // Autosave comes back ON: the signed-off row is the airplane's record now,
    // and the member may well walk the card again this afternoon. The page has
    // already cleared the card, so nothing is pending to write — `dirty` is
    // false until somebody ticks something.
    frozen.current = false;
  }, [memberId, aircraftId, kind]);

  return {
    resume,
    savedAt,
    syncing,
    deviceOnly,
    storageBlocked,
    serverId,
    dirty,
    reset,
    finish,
    freeze,
    thaw,
  };
}
