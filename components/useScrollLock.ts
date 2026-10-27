"use client";
// Freeze the page while an overlay is open: `useScrollLock(open)`.
//
// One lock for the whole app (rules in lib/scrollLock.ts) over the app's
// scroller. Every overlay takes it — `Modal`, `Dropdown`, `ChipSelect`,
// `DateTimeField`'s calendar, the pill's group sheet — and the hand-rolled page
// gestures (PullToRefresh, SwipePager) stand down while it's held.
import { useEffect } from "react";
import { getAppScroller } from "@/lib/appScroll";
import { createScrollLock } from "@/lib/scrollLock";

const appScrollLock = createScrollLock(getAppScroller);

/** True while any overlay has the page frozen. */
export const isScrollLocked = appScrollLock.isLocked;

/** Holds the page still for as long as `active` is true. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return appScrollLock.lock();
  }, [active]);
}
