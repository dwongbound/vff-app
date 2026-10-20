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
import { ReactNode, useEffect } from "react";

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
  lg: "sm:max-w-lg max-h-[88vh]",
  full: "sm:max-w-5xl h-[92vh]",
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex w-full flex-col overflow-hidden rounded-t-2xl bg-white
          shadow-xl dark:bg-gray-800 sm:rounded-xl ${SIZE_CLASSES[size]}`}
      >
        {/* Grab handle — a phone-sheet affordance; hidden on desktop. */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 sm:hidden" />

        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {subtitle}
              </p>
            )}
          </div>
          {/* 44px to tap, pulled back by its own margin so the header looks
              exactly as it did with the old 24px box. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2.5 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        {/* min-h-0 lets this flex child actually shrink so it (not the panel)
            scrolls. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 sm:px-6 sm:pb-6 ${
            footer ? "pb-5" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          }`}
        >
          {children}
        </div>

        {footer && (
          <div
            className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 pt-3
              pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-gray-700 sm:px-6
              sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]
              max-sm:gap-3 max-sm:[&_button]:min-h-11 max-sm:[&_button]:text-base
              max-sm:[&>*:not(.mr-auto)]:flex-1"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
