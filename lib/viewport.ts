// Keeping popups on the screen, as arithmetic (the hook in
// components/useKeepInViewport.ts applies it).

/** How close to the window's edge a popup may come, in px. */
export const VIEWPORT_MARGIN = 8;

/**
 * How far to move a popup sideways so it stays inside the window: 0 when it
 * already fits, positive to push it right, negative to pull it left.
 *
 * A popup wider than the window can't fit either way; it is pinned to the
 * LEFT margin, so its start — where a menu's text begins — is what's visible.
 */
export function viewportShift(
  left: number,
  right: number,
  windowWidth: number,
  margin: number = VIEWPORT_MARGIN
): number {
  const width = right - left;
  if (width > windowWidth - margin * 2) return margin - left;
  if (left < margin) return margin - left;
  if (right > windowWidth - margin) return windowWidth - margin - right;
  return 0;
}
