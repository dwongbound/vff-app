// The pull-to-refresh gesture's rules, as arithmetic (PullToRefresh draws them).
//
// The same shape as the tab swipe (lib/swipe.ts) on purpose, so the two read as
// one family: the PAGE never moves, a plain circled arrow fades in as you pull,
// and only a FULL pull, released, does anything. Two differences, both because
// this pull is vertical: it only starts with the page already at its top (a
// pull anywhere else is somebody scrolling up), and the arrow turns over as it
// fills — pointing down while you pull, up once letting go will refresh.

/** Finger travel, in px, that arms a refresh. */
export const REFRESH_PX = 96;
/** The content follows the finger at this fraction of its travel… */
export const FOLLOW = 0.75;
/**
 * …which, at the arming point, has uncovered this much: the 44px indicator
 * plus the space above and below it. While the refetch runs the content is
 * parked here, so the spinner stays in view.
 */
export const REVEAL_PX = REFRESH_PX * FOLLOW;

/**
 * Whether a touch that has moved (mx, my) is a pull-to-refresh, given that it
 * started with the page at its top. `null` while it's too early to say.
 * Reuses the swipe's own classifier, so a touch is never read as both.
 */
export function isPullDown(
  intent: "undecided" | "scroll" | "swipe",
  my: number
): boolean | null {
  if (intent === "undecided") return null;
  return intent === "scroll" && my > 0;
}

/** 0 → 1 (clamped): the arrow's opacity, and 1 means "let go to refresh". */
export function refreshProgress(my: number): number {
  return Math.max(0, Math.min(my / REFRESH_PX, 1));
}

/**
 * How far the page CONTENT is drawn down for a finger `my` px down. It follows
 * at `FOLLOW` speed up to the arming point — far enough by then to have
 * uncovered the whole indicator, `REVEAL_PX` — and then resists (a
 * square-root rubber band), so a long pull still gives under the thumb
 * without the page sliding off the bottom of the screen.
 */
export function contentOffset(my: number): number {
  if (my <= 0) return 0;
  if (my <= REFRESH_PX) return my * FOLLOW;
  return REVEAL_PX + Math.sqrt(my - REFRESH_PX) * 3;
}

/** The arrow's rotation in degrees: down at rest, turned up once armed. */
export function arrowRotation(progress: number): number {
  return progress >= 1 ? 180 : 0;
}
