"use client";
// A CSS media query as a live boolean, for the few places a layout has to
// render DIFFERENT elements by width rather than restyle the same ones — a
// table versus a list on Finances, details open or folded on a squawk.
//
// `useSyncExternalStore` rather than state + effect: it reads the query during
// render on the client, so there's no first frame with the wrong answer.
// `serverValue` is what to assume before there is a window to ask.
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}

/** Tailwind's `sm` (640px) and `md` (768px — the narrowest iPad) breakpoints. */
export const SM_UP = "(min-width: 640px)";
export const MD_UP = "(min-width: 768px)";

/**
 * Phones and tablets: below a laptop's width, or any touch screen (an iPad in
 * landscape is wider than 1024px). Where an action floats as a "+" in the
 * corner, like the Reservations page's, rather than sitting in the page.
 */
export const TOUCH_LAYOUT = "(max-width: 1023px), (pointer: coarse)";
