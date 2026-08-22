"use client";
// One numbered, collapsible section — the shell every checkout section is drawn
// in, and now the shell the post-flight form's own groups use too.
//
// It exists because those two were drawn differently and shouldn't have been. A
// member works down the preflight card, the runway card, then the post-flight
// page within the same hour; the first two were numbered accordions and the
// third was a stack of always-open boxes with its own headings. Same job, three
// screens, two visual languages — which is one more than anybody should have to
// learn while standing at the tail of an airplane.
//
// Deliberately knows nothing about checkouts. It takes a number, a title, a
// right-hand meta slot and children: `CheckoutList` passes item tallies into
// the meta, while the post-flight form passes a summary of what's typed in
// (or nothing at all). Anything more specific would have to grow a second
// shape the moment a third caller appeared.
import type { ReactNode, Ref } from "react";
import Card from "@/components/common/Card";

export default function CollapsibleSection({
  index,
  title,
  subtitle,
  titleNote,
  meta,
  complete = false,
  open,
  onToggle,
  children,
  ref,
}: {
  /** The number in the badge — 1-based, and continuous across the page. */
  index: number;
  title: string;
  subtitle?: ReactNode;
  /** A note beside the title, e.g. the checkout's "if it applies". */
  titleNote?: ReactNode;
  /** The right-hand slot: "4/6" on a checkout, a summary on a form group. */
  meta?: ReactNode;
  /** Done — the badge goes green and shows a tick instead of its number. */
  complete?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** React 19 passes this as an ordinary prop — see common/Card. */
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <Card
      ref={ref}
      // Scroll target. The margin keeps the sticky progress bar from parking on
      // top of the header it just scrolled to, so it clears the bar's HEIGHT —
      // roughly 100px, and ~115 while the two-line resume line is up.
      className="scroll-mt-28 p-0"
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            complete
              ? "bg-green-500 text-white"
              : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          }`}
        >
          {complete ? <Check /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {title}
            {titleNote}
          </span>
          {subtitle && (
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </span>
          )}
        </span>
        {meta && (
          <span className="shrink-0 text-sm tabular text-gray-500 dark:text-gray-400">
            {meta}
          </span>
        )}
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700">{children}</div>
      )}
    </Card>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Drawn rather than popped in — see the check-draw keyframe.
        strokeDasharray="24"
        strokeDashoffset="24"
        className="animate-check-draw"
      />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
        open ? "rotate-180" : ""
      }`}
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
