"use client";
// Date / date-and-time field with a deliberately split personality:
//
//   • On a phone or tablet the NATIVE picker wins. iOS's wheel and Android's
//     dialog are big, familiar, and already know about the device's locale and
//     24h setting — nothing hand-rolled competes with them under a thumb.
//   • On desktop the native `datetime-local` widget is a different shape in
//     every browser and ignores the app's theme entirely, so we suppress its
//     calendar button and open our own themed popover instead.
//
// Either way the real <input> stays in the DOM and stays the source of truth:
// you can still type a date, keyboard users get the normal control, and the
// value format is exactly what the native input emits ("YYYY-MM-DD", or
// "YYYY-MM-DDTHH:mm" in datetime mode).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  formatClock,
  fromDateInputValue,
  joinLocalDateTime,
  splitLocalDateTime,
  toDateInputValue,
} from "@/lib/dates";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Times offered in the popover's column. 15 minutes is the granularity people
// actually book an airplane at.
const TIME_STEP_MINUTES = 15;

interface DateTimeFieldProps {
  label: string;
  /** "YYYY-MM-DD" in date mode, "YYYY-MM-DDTHH:mm" in datetime mode. */
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "datetime";
  /** Muted helper text under the field. */
  hint?: React.ReactNode;
  error?: string | null;
  /** Earliest selectable day, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  disabled?: boolean;
}

export default function DateTimeField({
  label,
  value,
  onChange,
  mode = "datetime",
  hint,
  error,
  min,
  max,
  disabled,
}: DateTimeFieldProps) {
  const datetime = mode === "datetime";
  // The label is tied to the input with htmlFor rather than by wrapping it.
  // Wrapping would put the calendar button and the popover inside the <label>,
  // and every bit of text in there becomes part of the input's accessible name.
  // The trigger next to it is named "Open calendar for <label>" so a screen
  // reader announces which field it belongs to. That does mean the field's
  // own name is a substring of the button's, so tests look the input up with
  // an exact match.
  const inputId = useId();
  // Starts false so the server and the first client render agree on the plain
  // native field; the desktop affordance appears a tick later, once we've
  // measured the pointer.
  const [customPicker, setCustomPicker] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // "Coarse pointer" is the honest test for "this is a finger": it covers
  // phones and tablets (including iPads pretending to be desktops) without
  // sniffing user agents, and it follows a 2-in-1 that flips modes.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCustomPicker(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Flip the popover above the field when there isn't room below it — inside a
  // modal the field is often near the bottom edge.
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const POPOVER_HEIGHT = 340;
    const rect = wrapRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setDropUp(below < POPOVER_HEIGHT && rect.top > below);
  }, [open]);

  const { date: ymd, time: hm } = datetime
    ? splitLocalDateTime(value)
    : { date: value, time: "" };

  // The month on screen, which moves independently of the selection.
  const [view, setView] = useState<Date>(
    () => fromDateInputValue(ymd) ?? new Date()
  );
  // Re-center on the selected day each time the popover opens.
  useEffect(() => {
    if (open) setView(fromDateInputValue(ymd) ?? new Date());
  }, [open, ymd]);

  // Six full weeks, so the grid never changes height as you page through
  // months (a jumping popover is worse than a row of spillover days).
  const cells = useMemo(() => {
    const year = view.getFullYear();
    const month = view.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const start = new Date(year, month, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const times = useMemo(() => {
    const out: string[] = [];
    for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) {
      out.push(
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
      );
    }
    return out;
  }, []);

  const todayYmd = toDateInputValue(new Date());
  const outOfRange = (day: string) =>
    Boolean((min && day < min) || (max && day > max));

  function pickDay(d: Date) {
    const picked = toDateInputValue(d);
    if (!datetime) {
      onChange(picked);
      setOpen(false);
      return;
    }
    // Keep the time you already had; default to 09:00 for a fresh value rather
    // than midnight, which is never when anyone flies.
    onChange(joinLocalDateTime(picked, hm || "09:00"));
  }

  function pickTime(next: string) {
    onChange(joinLocalDateTime(ymd || todayYmd, next));
    setOpen(false);
  }

  return (
    <div className="block">
      <label
        htmlFor={inputId}
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <div className="relative" ref={wrapRef}>
        <input
          id={inputId}
          type={datetime ? "datetime-local" : "date"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          min={min}
          max={max}
          aria-invalid={error ? true : undefined}
          // `no-native-picker` hides the browser's own calendar button (see
          // globals.css) so desktop doesn't show two of them. On touch we
          // leave it alone — that button IS the good picker.
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm
            focus:outline-none focus:ring-1
            disabled:cursor-not-allowed disabled:opacity-60
            dark:bg-gray-800
            ${customPicker ? "no-native-picker pr-10" : ""}
            ${
              error
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600"
            }`}
        />

        {customPicker && !disabled && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={`Open calendar for ${label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700"
          >
            <CalendarIcon />
          </button>
        )}

        {open && customPicker && (
          <div
            role="dialog"
            aria-label={`${label} calendar picker`}
            className={`absolute right-0 z-40 flex gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-800 ${
              dropUp ? "bottom-full mb-1" : "top-full mt-1"
            }`}
          >
            <div className="w-64">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {MONTHS[view.getMonth()]} {view.getFullYear()}
                </span>
                <div className="flex gap-1">
                  <NavButton
                    label="Previous month"
                    onClick={() =>
                      setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))
                    }
                    d="M12 15l-4-5 4-5"
                  />
                  <NavButton
                    label="Next month"
                    onClick={() =>
                      setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))
                    }
                    d="M8 5l4 5-4 5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={i}
                    className="py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {w}
                  </span>
                ))}
                {cells.map((d) => {
                  const day = toDateInputValue(d);
                  const inMonth = d.getMonth() === view.getMonth();
                  const isToday = day === todayYmd;
                  const blocked = outOfRange(day);
                  const selected = day === ymd;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={blocked}
                      onClick={() => pickDay(d)}
                      className={`h-8 rounded text-sm transition-colors
                        ${blocked ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:bg-indigo-50 dark:hover:bg-indigo-900/50"}
                        ${!inMonth && !blocked ? "text-gray-400 dark:text-gray-500" : ""}
                        ${inMonth && !blocked && !selected ? "text-gray-800 dark:text-gray-100" : ""}
                        ${selected ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-600" : ""}
                        ${isToday && !selected && !blocked ? "font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-400 dark:text-indigo-300" : ""}`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={outOfRange(todayYmd)}
                  onClick={() => pickDay(new Date())}
                  className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
                >
                  Today
                </button>
              </div>
            </div>

            {/* Time column, only in datetime mode. Scrolled to the current
                selection on open so you land near it instead of at midnight. */}
            {datetime && (
              <TimeColumn
                times={times}
                selected={hm}
                onPick={pickTime}
              />
            )}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

function TimeColumn({
  times,
  selected,
  onPick,
}: {
  times: string[];
  selected: string;
  onPick: (time: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Bring the selected time (or 9am for an empty field) into view without
  // scrolling the page behind the popover.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>("[data-selected='true']")
      ?? list.querySelector<HTMLElement>("[data-time='09:00']");
    if (target) list.scrollTop = target.offsetTop - list.clientHeight / 2;
  }, [selected]);

  return (
    <div
      ref={listRef}
      className="scrollbar-visible h-64 w-24 overflow-y-auto border-l border-gray-100 pl-2 dark:border-gray-700"
    >
      {times.map((time) => {
        const isSelected = time === selected;
        return (
          <button
            key={time}
            type="button"
            data-time={time}
            data-selected={isSelected}
            onClick={() => onPick(time)}
            className={`block w-full rounded px-2 py-1 text-right text-sm tabular transition-colors ${
              isSelected
                ? "bg-indigo-600 font-semibold text-white"
                : "text-gray-700 hover:bg-indigo-50 dark:text-gray-200 dark:hover:bg-indigo-900/50"
            }`}
          >
            {formatClock(time)}
          </button>
        );
      })}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  d,
}: {
  label: string;
  onClick: () => void;
  d: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="4.5" width="14" height="12" rx="2" />
        <path d="M3 8h14M7 3v3M13 3v3" />
      </g>
    </svg>
  );
}
