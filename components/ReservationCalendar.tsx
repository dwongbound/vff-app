"use client";
// Desktop month calendar for the airplane's schedule. One month at a time,
// ‹ › to move, and every booking rendered as a clickable chip on its day.
// Days with more bookings than fit collapse into "+N more". Hovering an empty
// day reveals a "+" that opens the booking form pre-filled to that morning.
//
// Phones never see this — they get ReservationList instead (see
// app/reservations/page.tsx).
import { useMemo, useState } from "react";
import Modal from "./common/Modal";
import { PURPOSE_LABELS } from "@/lib/constants";
import { addDays, dayKey, formatTime, sameDay } from "@/lib/dates";
import type { ApiReservation } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// How many chips to show in a cell before collapsing into "+N more".
const MAX_CHIPS = 3;

export default function ReservationCalendar({
  reservations,
  month,
  onMonthChange,
  onSelect,
  onCreateOnDay,
}: {
  reservations: ApiReservation[];
  /** The month in view, anchored to its 1st at midnight (owned by the page,
      because it also drives which window of data gets fetched). */
  month: Date;
  onMonthChange: (next: Date) => void;
  onSelect: (reservation: ApiReservation) => void;
  onCreateOnDay: (date: Date) => void;
}) {
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  // Day whose full booking list is expanded in the "+N more" popup (or null).
  const [openDay, setOpenDay] = useState<Date | null>(null);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // Group bookings by local day, each day's list sorted by start time.
  const byDay = useMemo(() => {
    const map = new Map<string, ApiReservation[]>();
    for (const r of reservations) {
      const key = dayKey(new Date(r.startsAt));
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [reservations]);

  // Build the grid: whole weeks (Sun–Sat) covering the month.
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const gridStart = new Date(year, monthIndex, 1 - firstWeekday);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
  }, [year, monthIndex]);

  const monthLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const goToMonth = (delta: number) =>
    onMonthChange(new Date(year, monthIndex + delta, 1));
  const goToday = () =>
    onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1));

  const openDayRows = openDay ? byDay.get(dayKey(openDay)) ?? [] : [];
  const weekRows = cells.length / 7;

  return (
    // A flex column so the header + weekday labels stay put while the day grid
    // fills the remaining height (and scrolls inside itself if the viewport is
    // too short — keeping the page itself from scrolling).
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={goToday}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Today
          </button>
          <button
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Chevron dir="left" />
          </button>
          <button
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Chevron dir="right" />
          </button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-7 border-t border-gray-200 dark:border-gray-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid — fills the remaining height, its rows sharing it evenly so
          the whole month always fits the page rather than forcing a scroll.
          Each cell is overflow-hidden and collapses extras into "+N more";
          overflow-y-auto stays only as a safety net for an extreme squeeze. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
      >
        {cells.map((date) => {
          const inMonth = date.getMonth() === monthIndex;
          const isToday = sameDay(date, today);
          const muted = !inMonth || date < startOfToday;
          const dayRows = byDay.get(dayKey(date)) ?? [];
          const shown = dayRows.slice(0, MAX_CHIPS);
          const overflow = dayRows.length - shown.length;

          return (
            <div
              key={date.toISOString()}
              className={`group relative min-h-0 overflow-hidden border-b border-r border-gray-100 p-1.5 dark:border-gray-700/60 ${
                muted
                  ? "bg-gray-50 text-gray-400 dark:bg-gray-900/50"
                  : "bg-white dark:bg-gray-800"
              }`}
            >
              {/* Faintly visible "+" so booking a specific day is discoverable;
                  it fills in solid on hover. Current/future days only. */}
              {!muted && (
                <button
                  onClick={() => onCreateOnDay(date)}
                  aria-label={`Book the airplane on ${date.toLocaleDateString()}`}
                  className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none text-indigo-400 opacity-50 transition hover:bg-indigo-600 hover:text-white hover:opacity-100 group-hover:opacity-100"
                >
                  +
                </button>
              )}

              <div className="mb-1 flex justify-end">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                    isToday
                      ? "bg-indigo-600 text-white"
                      : muted
                        ? "text-gray-400 dark:text-gray-600"
                        : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>

              <div className="space-y-1">
                {shown.map((r) => (
                  <BookingChip
                    key={r.id}
                    reservation={r}
                    past={new Date(r.endsAt) < today}
                    onClick={() => onSelect(r)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    onClick={() => setOpenDay(date)}
                    className="w-full rounded px-1.5 py-0.5 text-left text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* "+N more" day popup: that day's full booking list. */}
      <Modal
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={
          openDay
            ? openDay.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : ""
        }
      >
        <ul className="space-y-2">
          {openDayRows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => {
                  setOpenDay(null);
                  onSelect(r);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition hover:border-indigo-400 dark:border-gray-700"
              >
                <span>
                  <span className="font-medium">{r.user.name}</span>
                  <span className="ml-2 text-gray-500 dark:text-gray-400">
                    {formatTime(r.startsAt)} – {formatTime(r.endsAt)}
                  </span>
                </span>
                <span className="text-xs text-gray-500">
                  {PURPOSE_LABELS[r.purpose]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

// The chip's fill, spelled out as three named cases rather than a nested
// ternary: maintenance is the club's block, "mine" is solid so you can find
// your own bookings at a glance, everyone else's is tinted.
function chipFillClasses(reservation: ApiReservation): string {
  if (reservation.purpose === "MAINTENANCE") {
    return "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300";
  }
  if (reservation.mine) {
    return "bg-indigo-600 text-white hover:bg-indigo-700";
  }
  return "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/70";
}

/** Who the chip is for: the club, you, or the member who booked it. */
function chipLabel(reservation: ApiReservation): string {
  if (reservation.purpose === "MAINTENANCE") return "Maintenance";
  if (reservation.mine) return "You";
  return reservation.user.name;
}

// One booking as a compact chip inside a day cell.
function BookingChip({
  reservation,
  past,
  onClick,
}: {
  reservation: ApiReservation;
  past: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${reservation.user.name} · ${formatTime(reservation.startsAt)}–${formatTime(
        reservation.endsAt
      )} · ${PURPOSE_LABELS[reservation.purpose]}`}
      // Past bookings read as done — dimmed, but still a live button.
      className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs font-medium transition
        ${chipFillClasses(reservation)}
        ${past ? "opacity-50 grayscale-[35%] hover:opacity-100" : ""}`}
    >
      <span className="truncate">
        <span className={reservation.mine ? "opacity-90" : "opacity-70"}>
          {formatTime(reservation.startsAt)}
        </span>{" "}
        {chipLabel(reservation)}
      </span>
    </button>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={dir === "left" ? "M12.5 15l-5-5 5-5" : "M7.5 5l5 5-5 5"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
