"use client";
// A page that saves as you go, as a hook over lib/autosave.ts's queue: the
// state for the status line, `queue()` for each edit, and the two ways a page
// can leave with an edit still waiting.
//
//   - Navigating away inside the app unmounts the page: the pending edit is
//     sent then, as an ordinary request (the app keeps running).
//   - Closing the tab or the app fires `pagehide`: the edit goes as a
//     keepalive request through `beacon`, which outlives the page.
import { useEffect, useRef, useState } from "react";
import {
  AUTOSAVE_DELAY_MS,
  AutosaveQueue,
  type AutosaveState,
  type SaveResult,
} from "@/lib/autosave";

export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<SaveResult>,
  opts: { beacon?: (patch: Partial<T>) => void; delayMs?: number } = {}
) {
  const [state, setState] = useState<AutosaveState>({ status: "idle", error: null });
  // The latest closures, so the queue (made once) always calls this render's.
  const saveRef = useRef(save);
  const beaconRef = useRef(opts.beacon);
  useEffect(() => {
    saveRef.current = save;
    beaconRef.current = opts.beacon;
  });

  const [queue] = useState(
    () =>
      new AutosaveQueue<T>(
        (patch) => saveRef.current(patch),
        setState,
        opts.delayMs ?? AUTOSAVE_DELAY_MS
      )
  );

  useEffect(() => {
    const onHide = () => {
      const patch = queue.takePending();
      if (patch) beaconRef.current?.(patch);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      // Leaving the page inside the app: send whatever is still waiting.
      queue.dispose();
      void queue.flush();
    };
  }, [queue]);

  return {
    state,
    queue: (patch: Partial<T>, o?: { immediate?: boolean }) => queue.queue(patch, o),
  };
}
