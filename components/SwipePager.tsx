"use client";
// Touch tab-swipe (phone AND tablet). The page itself never moves sideways:
// a vertical scroll that drifts a few pixels laterally used to drag the whole
// page off to one side, and you then had to put it back. Instead a horizontal
// pull fades in a plain circled ARROW at the edge you're pulling toward, and only once it's fully pulled does letting go change tab. Short
// of that, releasing does nothing at all; there is no flick shortcut, because
// a flick is exactly what an accidental lateral brush looks like.
//
// The gesture has to be clearly sideways to start (lib/swipe.ts),
// and once a touch has been read as a vertical scroll it stays one for its
// whole life. A touch that begins inside something that is MEANT to scroll
// sideways (a wide table in an `overflow-x-auto` box, a range slider) is left
// alone so that scrolling keeps working.
//
// The navbar highlight previews the target tab once the arrow is fully pulled. The
// nav bars live outside this wrapper, so they never move.
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { scrollAppToTop } from "@/lib/appScroll";
import { consumeNavDirection } from "@/lib/navDirection";
import { commitDistance, pullProgress, touchIntent } from "@/lib/swipe";
import { useSwipe } from "./SwipeProvider";

// useLayoutEffect warns during SSR; fall back to useEffect on the server (the
// pre-paint positioning it buys us only matters on the client anyway).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** The next page fading in after a committed swipe. */
const IN_MS = 250;

// True when the touch starts inside something that scrolls horizontally on
// purpose, or a control whose own drag is sideways.
function inHorizontalScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node instanceof HTMLInputElement && node.type === "range") return true;
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export default function SwipePager({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabsRef, activeIndexRef, navigateRef, setPreviewIndex } = useSwipe();
  const elRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // On a committed swipe, land the new route with a quick fade. Never a
  // transform: a route-level loader or a modal is `position: fixed`, and a
  // transformed ancestor would become its containing block and drag the
  // "full-page" overlay around. Runs before paint so nothing flashes.
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    setPreviewIndex(null); // the real active tab is authoritative again
    const dir = consumeNavDirection();
    if (dir === 0) {
      el.style.transition = "";
      el.style.opacity = "";
      return;
    }
    el.style.transition = "none";
    el.style.opacity = "0";
    void el.offsetWidth; // force the start state to stick before animating
    el.style.transition = `opacity ${IN_MS}ms ease-out`;
    el.style.opacity = "1";
  }, [pathname, setPreviewIndex]);

  // The gesture. Attaches once (all deps are stable refs/setters) and reads
  // live tab info from the shared refs, so it never goes stale.
  useIsoLayoutEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    let startX = 0;
    let startY = 0;
    let mode: "none" | "deciding" | "drag" = "none";
    let dx = 0;
    let preview: number | null = null;

    // The tab a pull of `d` px heads toward, or null if there isn't one.
    const neighborFor = (d: number): number | null => {
      const n = activeIndexRef.current + (d < 0 ? 1 : -1); // finger left → next tab
      return n >= 0 && n < tabsRef.current.length ? n : null;
    };

    // Opacity is the whole indicator: fully opaque = fully pulled. Written to
    // the DOM directly rather than through state, so a drag doesn't re-render
    // the page 60 times a second.
    const paint = (arrow: HTMLDivElement, progress: number, animate: boolean) => {
      arrow.style.transition = animate ? "opacity 150ms ease-out" : "none";
      arrow.style.opacity = String(progress);
    };

    /** Fade both arrows out — the pull is over. */
    const hideArrows = () => {
      paint(left, 0, true);
      paint(right, 0, true);
    };

    /** Forget the gesture and drop any tab highlight it was previewing. */
    const clear = () => {
      mode = "none";
      dx = 0;
      if (preview !== null) {
        preview = null;
        setPreviewIndex(null);
      }
    };

    /** Start watching a one-finger touch, unless something else owns it. */
    const onStart = (e: TouchEvent) => {
      mode = "none";
      if (e.touches.length !== 1) return;
      if (window.location.pathname === "/login") return; // no tabs on the auth page
      // Don't hijack touches while a dialog is open — its own scroll/controls
      // should win.
      if (document.querySelector('[role="dialog"]')) return;
      if (inHorizontalScroller(e.target)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "deciding";
    };

    /** Classify the touch, then — once it's a swipe — track the pull. */
    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (mode === "deciding") {
        const intent = touchIntent(mx, my);
        if (intent === "undecided") return;
        // Anything that isn't clearly sideways is a scroll, for good.
        if (intent === "scroll") {
          mode = "none";
          return;
        }
        mode = "drag";
      }
      // We own this gesture now — stop the browser from also scrolling or
      // firing its native back/forward swipe.
      if (e.cancelable) e.preventDefault();
      dx = mx;
      const target = neighborFor(dx);
      const progress = pullProgress(dx, window.innerWidth, target !== null);
      paint(dx > 0 ? left : right, progress, false);
      paint(dx > 0 ? right : left, 0, false);
      const next = progress >= 1 ? target : null;
      if (next !== preview) {
        preview = next;
        setPreviewIndex(next);
      }
    };

    /** Let go: change tab only if the pull was a full one. */
    const onEnd = () => {
      if (mode !== "drag") {
        mode = "none";
        return;
      }
      const target = neighborFor(dx);
      const armed = target !== null && Math.abs(dx) >= commitDistance(window.innerWidth);
      hideArrows();
      if (armed) {
        // The incoming route mounts at the top; get there first so the fade
        // isn't paired with a scroll jump.
        scrollAppToTop();
        preview = null; // keep the highlight on the target until the route lands
        navigateRef.current(tabsRef.current[target]);
      }
      clear();
    };

    // The system took the touch away (an incoming call, an iOS edge gesture).
    // Never a commit, however far the pull had got: the member didn't let go.
    const onCancel = () => {
      hideArrows();
      clear();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so onMove can preventDefault once it locks into a horizontal
    // pull (needed to suppress vertical scroll and the browser's swipe-back).
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [tabsRef, activeIndexRef, navigateRef, setPreviewIndex]);

  return (
    <>
      <div ref={elRef}>{children}</div>
      {/* The two pull indicators. Fixed to the content column's edges — the
          left one clears the rail from `md` up — and invisible until pulled. */}
      <SwipeArrow ref={leftRef} side="left" />
      <SwipeArrow ref={rightRef} side="right" />
    </>
  );
}

/** A plain circle with a chevron, hidden until a pull fades it in. */
function SwipeArrow({ ref, side }: { ref: React.Ref<HTMLDivElement>; side: "left" | "right" }) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ opacity: 0 }}
      className={`pointer-events-none fixed top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900 ${
        side === "left" ? "left-3 md:left-63" : "right-3"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        {side === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </div>
  );
}
