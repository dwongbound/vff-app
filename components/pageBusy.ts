"use client";
// "The page is busy — leave it alone until it's done."
//
// While a page is loading or being fetched again, what's on screen is about
// to be replaced, and a tap on it lands on a row that may not exist a moment
// later (a booking opened as the list under it reloads). So the page is made
// INERT for the duration: no taps, no focus, no keyboard, and it says it's
// busy to a screen reader. The chrome around it — the top bar, the rail, the
// bottom pill — stays live, so you can still leave.
//
// Held, not set: two things can hold it at once (the loading overlay and a
// pull-to-refresh), and the page comes back only when both let go. AppShell's
// <main> and every `Floating` read it through `usePageBusy`.
import { useSyncExternalStore } from "react";

let holds = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Disable the page until the returned function is called (once). */
export function holdPageBusy(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

/** Whether the page should be inert right now. */
export function usePageBusy(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => holds > 0,
    () => false
  );
}
