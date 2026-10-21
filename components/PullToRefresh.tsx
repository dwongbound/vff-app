"use client";
// Pull down from the top of a page to fetch it again — on any touch screen.
//
// The native shape: the page's content follows the finger down (resisting
// past the arming point) and uncovers a circled arrow parked under the top
// bar, which turns over once letting go will refresh. Only a FULL pull,
// released, does anything — the same rule as the tab swipe (SwipePager). The
// content then holds just low enough to show the spinner until the page's own
// refetch has landed, and springs back. The rules are lib/pullRefresh.ts.
//
// A page opts in with `usePullToRefresh(refetch)`; a page that doesn't simply
// has no pull. One page is on screen at a time, so one registered handler is
// all there ever is.
import { useEffect, useLayoutEffect, useRef } from "react";
import { getAppScroller } from "@/lib/appScroll";
import { hapticTap } from "@/lib/haptics";
import {
  REVEAL_PX,
  arrowRotation,
  contentOffset,
  isPullDown,
  refreshProgress,
} from "@/lib/pullRefresh";
import { touchIntent } from "@/lib/swipe";

type Refresh = () => Promise<unknown> | unknown;

let handler: Refresh | null = null;

/** Make this page pull-to-refreshable while it's mounted. */
export function usePullToRefresh(refresh: Refresh): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const mine: Refresh = () => latest.current();
    handler = mine;
    return () => {
      if (handler === mine) handler = null;
    };
  }, []);
}

/** Long enough that a refetch which comes back at once still reads as one. */
const MIN_SPIN_MS = 450;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function PullToRefresh() {
  const elRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<SVGSVGElement>(null);
  const spinRef = useRef<SVGSVGElement>(null);

  useIsoLayoutEffect(() => {
    const el = elRef.current;
    const arrow = arrowRef.current;
    const spin = spinRef.current;
    if (!el || !arrow || !spin) return;
    let startX = 0;
    let startY = 0;
    let mode: "none" | "deciding" | "pull" | "refreshing" = "none";
    let progress = 0;

    /** The page content: what moves. Looked up per pull, since pages swap it. */
    let content: HTMLElement | null = null;

    const paint = (offset: number, opacity: number, animate: boolean) => {
      const ease = "var(--ease-drawer)";
      el.style.transition = animate ? "opacity 200ms ease-out, scale 200ms ease-out" : "none";
      el.style.opacity = String(opacity);
      // Grows in from 80%, never from nothing: a thing that appears from a
      // point reads as coming out of nowhere.
      el.style.scale = String(0.8 + 0.2 * opacity);
      if (!content) return;
      content.style.transition = animate ? `transform 300ms ${ease}` : "none";
      // At rest the transform comes OFF rather than sitting at 0: a
      // transformed <main> would be the containing block for every `fixed`
      // popover inside it.
      content.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
    };
    const showSpinner = (on: boolean) => {
      arrow.style.display = on ? "none" : "";
      spin.style.display = on ? "" : "none";
    };

    const onStart = (e: TouchEvent) => {
      if (mode === "refreshing") return;
      mode = "none";
      if (!handler || e.touches.length !== 1) return;
      if (window.location.pathname === "/login") return;
      // A sheet's own scroll and drag win while one is open.
      if (document.querySelector('[role="dialog"]')) return;
      // Only from the very top: anywhere else, pulling down is scrolling up.
      if ((getAppScroller()?.scrollTop ?? 0) > 0) return;
      content = getAppScroller()?.querySelector("main") ?? null;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "deciding";
    };

    const onMove = (e: TouchEvent) => {
      if (mode !== "deciding" && mode !== "pull") return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (mode === "deciding") {
        const pull = isPullDown(touchIntent(mx, my), my);
        if (pull === null) return;
        if (!pull) {
          mode = "none";
          return;
        }
        mode = "pull";
        showSpinner(false);
      }
      // Ours now: no rubber-banding the page underneath the arrow.
      if (e.cancelable) e.preventDefault();
      progress = refreshProgress(my);
      paint(contentOffset(my), progress, false);
      arrow.style.transition = "transform 200ms var(--ease-out)";
      arrow.style.transform = `rotate(${arrowRotation(progress)}deg)`;
    };

    const settle = () => {
      paint(0, 0, true);
      const settled = content;
      setTimeout(() => {
        if (settled && mode === "none") settled.style.transition = "";
      }, 300);
      mode = "none";
      progress = 0;
    };

    const onEnd = async () => {
      if (mode !== "pull") {
        if (mode === "deciding") mode = "none";
        return;
      }
      const run = handler;
      if (progress < 1 || !run) {
        settle();
        return;
      }
      mode = "refreshing";
      hapticTap(); // inside the touchend, which is what iOS asks of it
      showSpinner(true);
      paint(REVEAL_PX, 1, true); // parked with the spinner showing
      const started = Date.now();
      try {
        await run();
      } catch {
        // The page's own loaders already decide what a failed fetch shows.
      }
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      settle();
    };

    const onCancel = () => {
      if (mode === "pull" || mode === "deciding") settle();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return (
    // Centred over the content column (clear of the rail from `md` up), hung
    // just under the top bar.
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--app-header-h)+0.75rem)] z-40 flex justify-center md:left-60"
    >
      <div
        ref={elRef}
        data-pull-refresh
        style={{ opacity: 0 }}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-800 text-white shadow-md dark:bg-gray-200 dark:text-gray-900"
      >
        <svg ref={arrowRef} viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
        <svg ref={spinRef} viewBox="0 0 24 24" className="h-6 w-6 animate-spin" style={{ display: "none" }} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      </div>
    </div>
  );
}
