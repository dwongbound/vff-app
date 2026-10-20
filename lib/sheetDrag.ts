// The phone sheet's drag-by-the-handle gesture, as arithmetic (Modal draws it).
//
// A sheet has two resting heights: its NATURAL one (as tall as its content,
// capped — what it opens at) and EXPANDED (nearly the whole screen, for a long
// form you'd rather scroll less of). The handle and the header row are the
// grip: drag down to close, drag up to make it taller, drag an expanded sheet
// down to put it back. The BODY is never a grip — it scrolls, and a sheet that
// closed whenever a member scrolled its form back to the top would be a sheet
// that loses their typing.
//
// Two ways to mean it, as with any iOS sheet: drag far enough, or flick. The
// flick matters more here than on the tab swipe (lib/swipe.ts deliberately has
// none), because a downward flick on a handle is not something anyone does by
// accident — and it's how everybody closes a sheet on an iPhone.

/** Fraction of the sheet's height a downward drag must cover to close it. */
export const CLOSE_RATIO = 0.3;
/** …but never more than this many px, so a tall sheet isn't a long haul. */
export const CLOSE_MAX_PX = 160;
/** Upward drag, in px, that expands a sheet (or downward, that un-expands it). */
export const RESIZE_PX = 64;
/** A release faster than this (px/ms) is a flick, whatever the distance. */
export const FLICK_SPEED = 0.5;
/** A flick still has to have moved this far, so a tap's jitter isn't one. */
export const FLICK_MIN_PX = 12;
/** Expanded height, as a fraction of the screen — matches Modal's `full` size. */
export const EXPANDED_RATIO = 0.92;

export type SheetRelease = "close" | "expand" | "collapse" | "stay";

/** Everything a release is decided on. `dy` is positive downwards. */
export interface ReleaseInput {
  dy: number;
  /** px/ms at release, positive downwards. */
  velocity: number;
  /** The sheet's height when the drag began. */
  height: number;
  expanded: boolean;
  /** Whether there's any taller height to go to (a `full` sheet has none). */
  canExpand: boolean;
}

/** The distance a downward drag must cover to close a sheet this tall. */
export function closeDistance(height: number): number {
  return Math.min(height * CLOSE_RATIO, CLOSE_MAX_PX);
}

/**
 * Where a released drag sends the sheet.
 *
 * Down from an EXPANDED sheet first gives back the extra height and only a
 * long pull closes it outright: un-expanding is the smaller step, and the one
 * a member who over-pulled is reaching for.
 */
export function sheetRelease({
  dy,
  velocity,
  height,
  expanded,
  canExpand,
}: ReleaseInput): SheetRelease {
  const flickDown = velocity >= FLICK_SPEED && dy >= FLICK_MIN_PX;
  const flickUp = velocity <= -FLICK_SPEED && dy <= -FLICK_MIN_PX;

  if (dy > 0) {
    if (expanded) {
      if (dy >= closeDistance(height) * 2) return "close";
      return dy >= RESIZE_PX || flickDown ? "collapse" : "stay";
    }
    return dy >= closeDistance(height) || flickDown ? "close" : "stay";
  }
  if (dy < 0 && canExpand && !expanded) {
    return -dy >= RESIZE_PX || flickUp ? "expand" : "stay";
  }
  return "stay";
}

/**
 * How far the sheet is drawn for a finger that has moved `dy`. Downwards it
 * follows the finger exactly; upwards past where it can go it RESISTS (a
 * square-root rubber band), so there is still give under the thumb but the
 * sheet never detaches from the bottom edge.
 */
export function dragOffset(dy: number, room: number): number {
  if (dy >= 0) return dy;
  const up = -dy;
  if (up <= room) return dy;
  return -(room + Math.sqrt(up - room) * 4);
}

/** Backdrop opacity (0–1) while a sheet is pulled `dy` down a sheet this tall. */
export function backdropFade(dy: number, height: number): number {
  if (dy <= 0 || height <= 0) return 1;
  return Math.max(0, 1 - dy / height);
}
