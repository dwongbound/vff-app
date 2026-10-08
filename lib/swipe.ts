// The tab-swipe gesture's rules, as arithmetic (SwipePager draws them).
//
// Two questions, both about NOT doing something by accident:
//   • is this touch a swipe at all, or a scroll that drifted sideways? A
//     member scrolling down a checkout with a thumb moves a few pixels
//     laterally on every stroke, and a page that changes tab for that is a
//     page you can't scroll.
//   • has the swipe gone far enough to mean it? Only a FULL pull, released,
//     changes tab — there is deliberately no quick-flick shortcut, because a
//     flick is exactly what an accidental lateral brush looks like.

/** Movement, in px, before a touch is classified at all. */
export const DECIDE_PX = 12;
/** Sideways must beat vertical by this factor for a touch to be a swipe. */
export const H_BIAS = 1.5;
/** A full pull, in px… */
export const COMMIT_PX = 140;
/** …capped at this fraction of the screen, so a narrow phone isn't asked for half its width. */
export const COMMIT_RATIO = 0.4;

export type TouchIntent = "undecided" | "scroll" | "swipe";

/**
 * What a touch that has moved (mx, my) from where it started is.
 *
 * Asked on every move until it answers something other than "undecided", and
 * then never again for that touch — a scroll stays a scroll however far it
 * drifts afterwards.
 */
export function touchIntent(mx: number, my: number): TouchIntent {
  if (Math.abs(mx) < DECIDE_PX && Math.abs(my) < DECIDE_PX) return "undecided";
  return Math.abs(mx) >= Math.abs(my) * H_BIAS ? "swipe" : "scroll";
}

/** How far a swipe must travel on a screen this wide to change tab. */
export function commitDistance(screenWidth: number): number {
  return Math.min(COMMIT_PX, Math.max(screenWidth, 1) * COMMIT_RATIO);
}

/**
 * How far along a pull is, 0 → 1 (clamped), which is the arrow's opacity. 1 is
 * "release now and the tab changes". 0 whenever there's no tab that way.
 */
export function pullProgress(dx: number, screenWidth: number, hasNeighbor: boolean): number {
  if (!hasNeighbor) return 0;
  return Math.min(Math.abs(dx) / commitDistance(screenWidth), 1);
}
