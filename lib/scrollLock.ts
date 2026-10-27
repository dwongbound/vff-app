// Freezing the page behind an overlay.
//
// While a modal, a menu, a listbox, a date picker or the pill's group sheet is
// open, the page under it must not move — not by wheel, not by a finger, not
// by pull-to-refresh or a tab swipe. The overlay itself still scrolls.
//
// The thing to freeze is the app's one scroller (`#app-scroll`, see
// lib/appScroll.ts), NOT <body>: the document never scrolls here, so the
// classic `body { overflow: hidden }` lock was a no-op and every modal let the
// page slide around underneath it. `overflow: hidden` on an ordinary element is
// honoured by iOS Safari's touch scrolling too (it's only the ROOT scroller iOS
// used to ignore it on), and it keeps `scrollTop`, so the page is exactly where
// it was when the overlay closes.
//
// Locks are COUNTED, not toggled: a date picker inside a modal, or a menu that
// opens a modal and closes itself, takes and releases its own lock in whatever
// order React runs the effects, and the page thaws only when the last one goes.
// The gestures that move the page by hand (PullToRefresh, SwipePager) ask
// `isScrollLocked()` rather than each guessing what counts as an overlay.

/** The bit of the scroller's style the lock owns. */
export interface Lockable {
  style: { overflow: string };
}

export interface ScrollLock {
  /** Freeze the page; call the returned function (once) to let go. */
  lock(): () => void;
  /** True while anything holds a lock. */
  isLocked(): boolean;
}

/** A counted lock over whatever `target()` returns at the moment it's taken. */
export function createScrollLock(target: () => Lockable | null): ScrollLock {
  let holders = 0;
  // The element frozen by the first holder, and its overflow before that, so
  // the last release restores exactly what was there — even if the shell
  // remounted in between and `target()` would now answer something else.
  let frozen: Lockable | null = null;
  let previous = "";

  return {
    lock() {
      if (holders === 0) {
        frozen = target();
        previous = frozen?.style.overflow ?? "";
        if (frozen) frozen.style.overflow = "hidden";
      }
      holders += 1;
      let released = false;
      return () => {
        if (released) return; // a double release must not thaw someone else's lock
        released = true;
        holders -= 1;
        if (holders === 0) {
          if (frozen) frozen.style.overflow = previous;
          frozen = null;
        }
      };
    },
    isLocked: () => holders > 0,
  };
}
