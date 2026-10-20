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
/** The arrow's own travel down the screen is this fraction of the finger's… */
export const FOLLOW = 0.5;

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
 * How far down the arrow is drawn for a finger `my` px down. It follows at
 * half speed up to the arming point and then resists (a square-root rubber
 * band), so a long pull still gives under the thumb without the arrow
 * wandering off down the page.
 */
export function indicatorOffset(my: number): number {
  if (my <= 0) return 0;
  const armed = REFRESH_PX * FOLLOW;
  if (my <= REFRESH_PX) return my * FOLLOW;
  return armed + Math.sqrt(my - REFRESH_PX) * 2;
}

/** The arrow's rotation in degrees: down at rest, turned up once armed. */
export function arrowRotation(progress: number): number {
  return progress >= 1 ? 180 : 0;
}
