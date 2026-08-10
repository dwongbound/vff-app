// The app's one scroll container.
//
// The document deliberately does NOT scroll (see globals.css `.app-scroll` and
// the flex column on <body>): the top bar and the nav rail have to sit outside
// any scroller, or rubber-banding drags them around. That means anything which
// used to talk to `window.scrollY` / `window.scrollTo` has to talk to this
// element instead — from the window's point of view the page never moves.
//
// Two rules for anyone wiring up scroll behaviour:
//   • READ position from `getAppScroller()`, not `window.scrollY`.
//   • LISTEN with `{ capture: true }` on window. Scroll events don't bubble,
//     but they do capture, so one window listener still sees this element
//     scrolling (GuidedTour and InfoTip already do exactly that).

export const APP_SCROLL_ID = "app-scroll";

/** The scrolling content column, or null before mount / on the server. */
export function getAppScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(APP_SCROLL_ID);
}

/** How far the content is scrolled. 0 when the shell isn't mounted yet. */
export function appScrollTop(): number {
  return getAppScroller()?.scrollTop ?? 0;
}

/** Jump the content back to the top — what a route change wants. */
export function scrollAppToTop(): void {
  getAppScroller()?.scrollTo(0, 0);
}
