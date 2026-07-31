"use client";
// The phone view of the schedule: every upcoming booking as a full-width row,
// grouped under day headings, newest at the top. It's the same data the
// desktop calendar shows — just linear, because a 7×5 grid of 4pt text is
// unusable on a phone and scrolling a list is not.
import Badge from "./common/Badge";
import { PURPOSE_LABELS, PURPOSE_TONES } from "@/lib/constants";
import { dayKey, formatDay, formatDuration, formatTime, relativeDay } from "@/lib/dates";
import type { ApiReservation } from "@/lib/types";

export default function ReservationList({
  reservations,
  onSelect,
}: {
  /** Already filtered + sorted by the page (upcoming first). */
  reservations: ApiReservation[];
  onSelect: (reservation: ApiReservation) => void;
}) {
  if (reservations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center dark:border-gray-600">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Nothing on the schedule
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Tap the + button to book the airplane.
        </p>
      </div>
    );
  }

  // Group consecutive rows by day so the list gets date headings without a
  // second pass over the data.
  let lastKey = "";

  return (
    <ul className="space-y-2">
      {reservations.map((r) => {
        const start = new Date(r.startsAt);
        const key = dayKey(start);
        const newDay = key !== lastKey;
        lastKey = key;

        return (
          <li key={r.id}>
            {newDay && (
              <h2 className="px-1 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 first:pt-0 dark:text-gray-400">
                {formatDay(start)}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                  {relativeDay(start)}
                </span>
              </h2>
            )}
            <button
              onClick={() => onSelect(r)}
              className={`flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition active:scale-[0.99] dark:bg-gray-800 ${
                r.mine
                  ? "border-indigo-300 dark:border-indigo-700"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              {/* Time column — the thing you're actually scanning for. */}
              <div className="w-20 shrink-0">
                <div className="text-sm font-semibold tabular">
                  {formatTime(r.startsAt)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDuration(r.startsAt, r.endsAt)}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {r.mine ? "You" : r.user.name}
                </div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(r.startsAt)} – {formatTime(r.endsAt)}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>

              <Badge tone={PURPOSE_TONES[r.purpose]}>
                {PURPOSE_LABELS[r.purpose]}
              </Badge>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
