"use client";
// Dropdown menu (the navbar user menu).
//
// Opens on hover where hovering is a real thing, and on click everywhere —
// which is both the keyboard path and the only path on a touch screen, where
// `mouseenter` either never fires or fires as a side effect of the tap. The
// media query is checked inside the handlers rather than in state so there's no
// server/client hydration mismatch.
//
// Two details keep hover from feeling broken:
//   • the gap between the trigger and the menu is PADDING on a wrapper, not a
//     margin on the menu, so the pointer never crosses a dead zone that would
//     close the menu on its way there;
//   • closing is deferred a moment, so clipping a corner on the way in or out
//     doesn't make the menu flicker.
//
// Clicking LATCHES the menu open. A hover menu that also vanishes on hover-out
// is a menu you can't read at leisure — glance away, come back, it's gone — so
// a click says "I mean to use this": the pointer may leave, and only choosing
// something, clicking outside, Escape, or clicking the trigger again closes it.
// Nested menus latch their parent too, via `useLatchDropdown` below.
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface DropdownProps {
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: ReactNode; // menu contents
  align?: "left" | "right";
  menuClassName?: string;
  /** Extra classes on the trigger button — e.g. `w-full` in the side rail,
      where the account row spans the rail's full width. */
  triggerClassName?: string;
  /** Extra classes on the positioned wrapper, for callers that need the menu
      to open somewhere other than directly below (`bottom-full` in a rail
      footer, where there's no room underneath). */
  wrapperClassName?: string;
}

/** Lets a submenu inside a Dropdown pin its parent open — without it, latching
    the submenu is pointless, since the parent would close under it the moment
    the pointer left. Null outside a Dropdown. */
const LatchContext = createContext<(() => void) | null>(null);

export function useLatchDropdown(): () => void {
  const latch = useContext(LatchContext);
  return useCallback(() => latch?.(), [latch]);
}

/** True only on a device that actually has a hovering pointer. */
function pointerCanHover(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

const CLOSE_DELAY_MS = 120;

export default function Dropdown({
  trigger,
  children,
  align = "right",
  menuClassName = "overflow-hidden",
  triggerClassName = "",
  wrapperClassName = "top-full pt-2",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  // Stays true through the fade-out so the menu can animate away.
  const [rendered, setRendered] = useState(false);
  // Clicked open: hovering out no longer closes it.
  const [latched, setLatched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True once the menu has been on screen for a frame. The menu must first
  // paint in its closed state and only then flip to open, or the browser has
  // no "from" to transition out of and it simply appears.
  const [entered, setEntered] = useState(false);

  if (open && !rendered) setRendered(true);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open, rendered]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const close = useCallback(() => {
    cancelClose();
    setLatched(false);
    setOpen(false);
  }, [cancelClose]);

  const latch = useCallback(() => {
    cancelClose();
    setLatched(true);
    setOpen(true);
  }, [cancelClose]);

  // Don't leave a timer running after the menu goes away.
  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => {
        if (!pointerCanHover()) return;
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (!pointerCanHover() || latched) return;
        scheduleClose();
      }}
    >
      <button
        // A click on the trigger is a decision, so it latches rather than
        // toggles: on a hovering pointer the menu is usually already open by
        // the time the click lands, and toggling would shut it in your face.
        onClick={() => (latched ? close() : latch())}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center ${triggerClassName}`}
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>

      {rendered && (
        // The padding here is the hover bridge — see the note at the top.
        <div
          className={`absolute z-40 ${wrapperClassName} ${
            align === "right" ? "right-0" : "left-0"
          } ${open ? "" : "pointer-events-none"}`}
        >
          <div
            role="menu"
            // Choosing something closes the menu — including "Log out", which
            // navigates away underneath it. A submenu trigger inside stops the
            // click here, since opening one isn't choosing anything.
            onClick={() => close()}
            // Fades and lifts into place. Kept mounted until the fade-out
            // finishes (same trick as the loading overlay) so closing is
            // animated too rather than snapping away.
            onTransitionEnd={() => {
              if (!open) setRendered(false);
            }}
            className={`w-48 origin-top rounded-lg border border-gray-200 bg-white py-1
              shadow-lg transition duration-150 ease-out dark:border-gray-700 dark:bg-gray-800
              ${entered && open ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-1 scale-95"}
              ${menuClassName}`}
          >
            <LatchContext.Provider value={latch}>{children}</LatchContext.Provider>
          </div>
        </div>
      )}
    </div>
  );
}
