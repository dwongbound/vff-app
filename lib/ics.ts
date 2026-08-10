// Booking → iCalendar (.ics), so a reservation can live in the calendar app a
// member actually looks at on the morning of the flight.
//
// Written by hand rather than pulled from a package: the format is small, and
// the three things implementations get wrong (CRLF line endings, escaping, and
// 75-octet line folding) are exactly the things a dependency would hide from us
// when a calendar app silently refuses the file.
//
// Everything here is a pure string transform — see tests/unit/ics.test.ts.

export interface IcsEvent {
  /** Stable, globally unique. Reusing one lets a calendar UPDATE the event. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** When the row was last touched, so a re-export supersedes the old copy. */
  lastModified?: Date | null;
}

/**
 * Escape a text value: backslashes, semicolons and commas are delimiters in
 * iCalendar, and a literal newline would end the property.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets, continuing with a leading space.
 *
 * Measured in UTF-8 BYTES, not characters: the limit is octets, so a line of
 * accented text or an em dash folds earlier than its length suggests. A
 * multi-byte character is never split across the fold.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line allows 75 octets; continuation lines start with a space, which
  // itself costs one of the 75.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

/** A UTC timestamp in iCalendar's basic format: 20260804T173000Z. */
export function toIcsUtc(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Build a whole calendar.
 *
 * Times are written in UTC (the trailing Z) rather than with a VTIMEZONE
 * block: the club's bookings are absolute instants, and every calendar app
 * converts a UTC stamp into the reader's own zone correctly. A local time
 * without a VTIMEZONE is the thing that actually goes wrong — it lands an hour
 * out for anyone in a different offset.
 */
export function buildIcs(
  events: IcsEvent[],
  options: { calendarName?: string; now?: Date } = {}
): string {
  const stamp = toIcsUtc(options.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VFF Flying Club//Reservations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  if (options.calendarName) {
    // X-WR-CALNAME is non-standard but is what names the calendar in every
    // client that matters.
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
  }

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(event.start)}`);
    lines.push(`DTEND:${toIcsUtc(event.end)}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.lastModified) {
      lines.push(`LAST-MODIFIED:${toIcsUtc(event.lastModified)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // CRLF throughout, and a trailing one — RFC 5545 wants every line terminated.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A filename-safe slug, for the downloaded file. */
export function icsFilename(parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "reservation"}.ics`;
}
