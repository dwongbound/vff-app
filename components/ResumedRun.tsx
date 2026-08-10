"use client";
// "You're picking up a checkout you already started."
//
// Shared by the preflight and runway pages, which resume an unfinished run the
// same way. It exists to answer the question a half-ticked card raises the
// moment it loads: WHY are these already ticked? Without the date and time,
// a member who saved on Tuesday and came back on Thursday has no way to tell
// their own saved work from someone else's, or from a bug — and the safe
// reaction to a checkout you don't trust is to re-walk the airplane anyway,
// which is the thing saving progress was supposed to avoid.
//
// "Start over" is right here rather than buried: resuming is only safe if
// abandoning is one obvious tap away.
import Button from "@/components/common/Button";
import { formatDay, formatTime } from "@/lib/dates";

export default function ResumedRun({
  savedAt,
  onStartOver,
  busy = false,
}: {
  /** When the run being resumed was last saved (ISO). */
  savedAt: string;
  onStartOver: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border
        border-amber-300 bg-amber-50 px-4 py-3 text-sm
        dark:border-amber-800 dark:bg-amber-900/20"
    >
      <p className="text-amber-900 dark:text-amber-100">
        <span className="font-semibold">Picking up where you left off.</span>{" "}
        Saved {formatDay(savedAt)} at {formatTime(savedAt)} — check that the
        ticks below still match the airplane.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onStartOver}
        disabled={busy}
      >
        Start over
      </Button>
    </div>
  );
}
