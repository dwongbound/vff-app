// Date/time helpers. Everything is stored as a UTC instant in the db and
// rendered in the server/browser local zone (APP_TZ in prod — see
// instrumentation.ts), which is the club's home field time.
//
// `clubTimeNow` is the one exception, and deliberately so: it names the club's
// zone outright instead of trusting the device's, because it produces a
// reading that gets WRITTEN DOWN rather than one that gets displayed.
import { CLUB_TIME_ZONE } from "./constants";

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

/**
 * "YYYY-MM-DD" → a LOCAL Date. Parsed by hand because `new Date("2026-08-02")`
 * is interpreted as midnight UTC, which lands on the previous day in the US.
 */
export function fromDateInputValue(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Split "2026-08-02T09:30" into its date and time halves. */
export function splitLocalDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  // Some browsers hand back seconds ("09:30:00"); the pickers only deal in
  // hours and minutes.
  return { date, time: time.slice(0, 5) };
}

/** Rejoin the halves. Returns "" unless both are present. */
export function joinLocalDateTime(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

/**
 * The clock right now at the club's field, as the "HH:MM" a time input takes.
 *
 * Explicitly in `CLUB_TIME_ZONE` rather than the device's: this stamps a
 * reading being written onto the airplane's card, and "14:05" on a preflight
 * means 14:05 at KTOA. A member whose laptop is still on Eastern from last
 * week's trip would otherwise silently record a time three hours out, and
 * nothing downstream could tell.
 *
 * 24-hour with `h23`, because that's the format `<input type="time">` parses —
 * and `h23` specifically, since `hour12: false` renders midnight as "24:00" in
 * some locales, which the input then rejects.
 */
export function clubTimeNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLUB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * The calendar day an instant falls on AT THE CLUB, as "YYYY-MM-DD".
 *
 * For comparing two instants for same-day-ness where the day that matters is
 * the flying day at the field — "was the airplane walked today?" is a question
 * about KTOA, and answering it in the device's zone means a member whose phone
 * is an hour ahead can be told the morning's preflight was yesterday's.
 */
export function clubDateKey(iso: string | Date): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * What the club's clock was offset from UTC at an instant, in milliseconds.
 *
 * Derived by formatting the instant in `CLUB_TIME_ZONE` and reading the result
 * back as if it were UTC — the difference IS the offset. Doing it this way
 * rather than from a table means DST is whatever the platform's tz database
 * says it is, which is the only source that stays right.
 */
function clubOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asIfUtc - at.getTime();
}

/**
 * A calendar day at the club plus a clock reading off one of its cards, as a
 * real instant. "2026-08-21" + "14:05" → 14:05 at KTOA that day.
 *
 * This is how a time FIELD becomes a time COLUMN: the cards record "HH:MM"
 * because that is what a member reads off the panel and what an `<input
 * type="time">` produces, while the flight log stores instants because it sorts
 * them, subtracts them and shows them to people in other timezones.
 *
 * Two passes, and the second one is what makes the spring-forward Sunday
 * correct: the first guess uses the offset in force at the same wall time read
 * as UTC, which can land on the wrong side of a transition, so the offset is
 * re-read at the guessed instant and applied again. Returns null on anything
 * that isn't a real date and clock, since a half-typed field must not become
 * midnight.
 */
export function clubInstant(day: string, hm: string): Date | null {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  const guess = wallAsUtc - clubOffsetMs(new Date(wallAsUtc));
  const settled = wallAsUtc - clubOffsetMs(new Date(guess));
  const out = new Date(settled);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** "09:30" → "9:30 AM" in the viewer's locale. */
export function formatClock(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hm;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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
