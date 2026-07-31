// Date/time helpers. Everything is stored as a UTC instant in the db and
// rendered in the server/browser local zone (APP_TZ in prod — see
// instrumentation.ts), which is the club's home field time.

/** "Sat, Aug 2" — the list/calendar day label. */
export function formatDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "August 2, 2026" — long form for detail headers. */
export function formatFullDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "9:30 AM" */
export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "9:30 AM – 12:00 PM" for a reservation block. */
export function formatTimeRange(start: string | Date, end: string | Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** "2.5 hr" / "45 min" — how long a booking runs. */
export function formatDuration(start: string | Date, end: string | Date): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  // One decimal, but drop a trailing ".0" — "3 hr" reads better than "3.0 hr".
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hr`;
}

/**
 * The value an `<input type="datetime-local">` expects: "YYYY-MM-DDTHH:mm" in
 * LOCAL time. `toISOString()` would shift by the UTC offset, so build it from
 * the local getters instead.
 */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The `<input type="date">` value ("YYYY-MM-DD") for a local date. */
export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of the day `d` falls on. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60000);
}

/** Local-time day key, e.g. "2026-6-3". Groups rows by the day they start. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** "in 3 days" / "tomorrow" / "today" — the upcoming-reservation hint. */
export function relativeDay(iso: string | Date): string {
  const days = Math.round(
    (startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) /
      86_400_000
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/**
 * Calendar-month currency, the way the FAA counts it: a flight review or
 * medical dated Jan 15 is good through the last day of the month, N months on.
 * Returns null when the base date is missing.
 */
export function calendarMonthsFrom(
  base: string | Date | null | undefined,
  months: number
): Date | null {
  if (!base) return null;
  const d = new Date(base);
  // Day 0 of month+1 = the last day of month, i.e. the end of that month.
  return new Date(d.getFullYear(), d.getMonth() + months + 1, 0, 23, 59, 59);
}
