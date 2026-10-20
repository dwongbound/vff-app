"use client";
// Reusable modal: overlay click or Escape closes it.
//
// Layout is a flex column — a fixed header, a scrollable body, and an optional
// fixed footer that never scrolls with (or gets overlapped by) the body.
//
// On phones it docks to the bottom of the screen as a sheet (thumb-reachable,
// and the keyboard pushes it up naturally); from `sm` up it's a centered card.
//
// As a sheet, its bottom edge IS the screen's bottom edge, which on an iPhone
// is the home bar and two curved corners. So below `sm` the footer's buttons
// share the row in equal widths rather than packing into the right-hand
// corner, are 44px tall (Apple's minimum tap target), and the footer — or the
// body, when there is no footer — clears the home bar by the safe-area inset
// PLUS its ordinary padding. A button that should keep its own width (a quiet
// Delete pushed left with `mr-auto`) is left alone. A footer that wraps its
// buttons in its own element lays them out itself.
//
// A DESTRUCTIVE button (`data-destructive`, see Button) is always drawn a size
// smaller than the actions beside it, on every screen: it never stretches, it
// is shorter, and its label is a step down. Whatever is easiest to hit should
// be the thing that can't lose anybody's work.
//
// It MOVES in and out rather than appearing: the sheet rises from the bottom
// edge it is docked to, the desktop card fades up from 96%, and the backdrop
// fades under both (keyframes and curves are `.modal-*` in globals.css). To
// animate OUT it stays mounted for `EXIT_MS` after `open` goes false, showing
// what it showed last — parents often clear the thing the modal was about in
// the same breath as closing it, and an exit that drew an empty sheet would be
// worse than none. While closing it is `aria-hidden` and lets clicks through,
// so to everything but the eye it is already gone.
import { ReactNode, useEffect, useRef, useState } from "react";

/** The longest exit (the phone sheet), in step with `.modal-panel[data-closing]`. */
const EXIT_MS = 250;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Muted text under the title (e.g. the booking's date). */
  subtitle?: ReactNode;
  children: ReactNode;
  size?: "lg" | "full";
  /** Action bar pinned to the bottom, outside the scroll area. */
  footer?: ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  lg: "sm:max-w-lg max-h-[88dvh]",
  full: "sm:max-w-5xl h-[92dvh]",
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "lg",
  footer,
}: ModalProps) {
  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scrolling while open (restore the previous value on close
  // so stacked modals don't clobber each other).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Mounted from the moment it opens until its exit has played.
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);
  const closing = rendered && !open;

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // What the exit shows: the last content it had while open.
  const shown = useRef({ title, subtitle, children, footer });
  if (open) shown.current = { title, subtitle, children, footer };

  if (!rendered) return null;
  const view = shown.current;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 ${
        closing ? "pointer-events-none" : ""
      }`}
      aria-hidden={closing || undefined}
    >
      {/* backdrop */}
      <div
        className="modal-backdrop absolute inset-0 bg-black/50"
        data-closing={closing || undefined}
        onClick={onClose}
        aria-hidden
      />
      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        data-closing={closing || undefined}
        className={`modal-panel relative flex w-full flex-col overflow-hidden rounded-t-2xl bg-white
          shadow-xl dark:bg-gray-800 sm:rounded-xl ${SIZE_CLASSES[size]}`}
      >
        {/* Grab handle — a phone-sheet affordance; hidden on desktop. */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 sm:hidden" />

        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{view.title}</h2>
            {view.subtitle && (
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {view.subtitle}
              </p>
            )}
          </div>
          {/* 44px to tap, pulled back by its own margin so it lines up with the
              title. What's DRAWN is a 32px disc with an 18px cross on it: the
              old bare ✕ glyph was 13px of grey on white and easy to miss. The
              cross is an SVG rather than a character so it sits on the disc's
              true centre whatever the font's metrics. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="group -mr-1.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <span
              data-close-disc
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600
                transition-colors duration-150 group-hover:bg-gray-200 group-hover:text-gray-900
                dark:bg-gray-700 dark:text-gray-300 dark:group-hover:bg-gray-600 dark:group-hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
          </button>
        </div>

        {/* min-h-0 lets this flex child actually shrink so it (not the panel)
            scrolls. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 sm:px-6 sm:pb-6 ${
            view.footer ? "pb-5" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          }`}
        >
          {view.children}
        </div>

        {view.footer && (
          <div
            className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 pt-3
              pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-gray-700 sm:px-6
              sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]
              [&_button[data-destructive]]:px-3 [&_button[data-destructive]]:py-1
              [&_button[data-destructive]]:text-xs
              max-sm:gap-3 max-sm:[&_button:not([data-destructive])]:min-h-11
              max-sm:[&_button:not([data-destructive])]:text-base
              max-sm:[&_button[data-destructive]]:min-h-9 max-sm:[&_button[data-destructive]]:text-sm
              max-sm:[&>*:not(.mr-auto):not([data-destructive])]:flex-1"
          >
            {view.footer}
          </div>
        )}
      </div>
    </div>
  );
}
