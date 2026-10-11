"use client";
// Keep a popup (menu, listbox, date picker) inside the window.
//
// Every popup here is placed relative to the thing that opened it — centred
// on a tab, aligned to a field's edge — which is right until that thing sits
// near the edge of a phone, and then half the menu hangs off the screen. The
// group sheet over the first tab of the bottom pill did exactly that.
//
// Usage: `const ref = useKeepInViewport<HTMLDivElement>(open)` on the popup's
// positioned element. After it renders (and on resize/rotation) the hook
// measures it and, if it pokes out, nudges it back by `viewportShift`.
//
// The nudge is applied as a MARGIN, and on both sides at once (left +dx,
// right −dx). That's deliberate, and it's what lets one hook serve popups
// anchored either way: an absolutely positioned box placed by `left` is moved
// by its left margin, one placed by `right` by its right margin, and the other
// margin is ignored. A `transform` would have been the obvious tool, but these
// popups already use transforms — Tailwind's centring `-translate-x-1/2` and
// the fade-in-up animation — and an inline one would clobber them.
import { useLayoutEffect, useRef } from "react";
import { viewportShift } from "@/lib/viewport";

/** A ref for a popup; while `open`, it is kept inside the window. */
export function useKeepInViewport<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;

    const place = () => {
      // Measure where it sits on its own, then correct from there.
      el.style.marginLeft = "";
      el.style.marginRight = "";
      const rect = el.getBoundingClientRect();
      const dx = viewportShift(rect.left, rect.right, window.innerWidth);
      if (dx !== 0) {
        el.style.marginLeft = `${dx}px`;
        el.style.marginRight = `${-dx}px`;
      }
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return ref;
}
