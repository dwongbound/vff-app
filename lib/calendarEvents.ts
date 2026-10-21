// Google Calendar event ⇄ reservation, as pure rules.
//
// The airplane's Google Calendar is the schedule's source of truth (see
// lib/googleCalendarSync.ts for the db half). Two kinds of event live on it and
// both have to read back as bookings:
//
//   - events the APP wrote, which carry what the app knows (member, purpose,
//     instructor) in the event's private extended properties, and
//   - events members typed straight into Google, which carry a title, a
//     creator's email and nothing else — "George Flight with Matt", "Strut
//     Maintanence", "Personal res".
//
// Extended properties are read FIRST and the guesses only fill what they don't
// say, which is also what lets the app correct a hand-made event's purpose
// without touching its title.
//
// CANCELLING is a rename, not a delete: "CANCELLED - <title>" is how the club
// already cancels ("CANCELLED (wx) Sasha checkout"), it keeps the record on
// the calendar, and an event with that title doesn't hold the airplane.
// Deleting the event in Google is still honoured — that removes the booking.
import { CLUB_TIME_ZONE, PURPOSE_LABELS, type Purpose } from "./constants";
import { clubDateKey, clubInstant } from "./dates";

/** The subset of a Calendar API `Event` this app reads or writes. */
export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  creator?: { email?: string };
  attendees?: GoogleAttendee[];
  extendedProperties?: { private?: Record<string, string> };
}

/** A guest on an event. Google keeps more fields; these are the ones we touch. */
export interface GoogleAttendee {
  email: string;
  responseStatus?: string;
}

export interface GoogleEventTime {
  /** All-day events: "YYYY-MM-DD". The END date is EXCLUSIVE. */
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The private extended-property keys the app writes. */
export const PROP = {
  userId: "vffUserId",
  purpose: "vffPurpose",
  instructorId: "vffInstructorId",
  /** The title the app generated — so a rename in Google can be noticed. */
  summary: "vffSummary",
} as const;

const CANCELLED_PREFIX = "CANCELLED - ";

/**
 * Does this title mark the event as cancelled? The club writes it a few ways
 * ("CANCELLED (wx) …", "Canceled - …"), so any title that STARTS with the word
 * counts. A title merely containing it ("Cancelled trip makeup") does not.
 */
export function isCancelledTitle(title: string | null | undefined): boolean {
  return /^\s*cancell?ed\b/i.test(title ?? "");
}

/** The title an app cancel writes. Idempotent: cancelling twice is one prefix. */
export function cancelledTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  if (isCancelledTitle(t)) return t;
  return `${CANCELLED_PREFIX}${t || "Booking"}`;
}

/**
 * A purpose for an event typed straight into Google, off its title.
 * Conservative on purpose: LOCAL is the honest answer to "no idea", and a
 * wrong MAINTENANCE paints a member's flight amber on the calendar.
 */
export function guessPurpose(title: string | null | undefined): Purpose {
  const t = (title ?? "").toLowerCase();
  if (/\bcheck\s?ride\b/.test(t)) return "CHECKRIDE";
  if (/\b(maint\w*|annual|oil change|mx)\b/.test(t)) return "MAINTENANCE";
  if (/\bsolo\b/.test(t)) return "TRAINING_SOLO";
  if (/\b(lesson|training|instruction|checkout|dual)\b/.test(t)) return "TRAINING";
  if (/\b(cross[\s-]?country|xc)\b/.test(t)) return "CROSS_COUNTRY";
  return "LOCAL";
}

/** Is this stored string one of the app's purposes? (Props are free text.) */
function isPurpose(value: string | undefined): value is Purpose {
  return value !== undefined && value in PURPOSE_LABELS;
}

/**
 * A description as plain text. Events edited in Google's web UI store HTML
 * (`<br>`, `<b>`, entities); the app's notes field is plain text, and showing
 * a member raw tags is worse than losing the bold.
 */
export function plainText(description: string | null | undefined): string | null {
  if (!description) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** An event time → an instant, reading all-day dates as the CLUB's midnight. */
export function eventInstant(t: GoogleEventTime | undefined): Date | null {
  if (!t) return null;
  if (t.dateTime) {
    const d = new Date(t.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (t.date) return clubInstant(t.date.slice(0, 10), "00:00");
  return null;
}

/** What a mirrored row should hold. */
export interface MirroredBooking {
  googleEventId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  userId: string | null;
  purpose: Purpose;
  instructorId: string | null;
  notes: string | null;
  title: string | null;
  status: "CONFIRMED" | "CANCELED";
}

/** What the mapping needs to know about the club's people. */
export interface PeopleLookup {
  /** A member's id by (any-case) email, or null. */
  userIdByEmail(email: string): string | null;
  /** Does this user id still exist? */
  isUser(id: string): boolean;
  /** Is this user id one of the club's CFIs? */
  isInstructor(id: string): boolean;
}

/**
 * One event → the row that mirrors it.
 *
 * "removed" = the event was deleted in Google, so the booking goes. null = an
 * event with no usable times, which is skipped rather than guessed at.
 */
export function eventToBooking(
  event: GoogleEvent,
  people: PeopleLookup
): MirroredBooking | "removed" | null {
  if (event.status === "cancelled") return "removed";

  const startsAt = eventInstant(event.start);
  const endsAt = eventInstant(event.end);
  if (!startsAt || !endsAt || endsAt <= startsAt) return null;

  const props = event.extendedProperties?.private ?? {};
  const summary = (event.summary ?? "").trim();

  // Who it belongs to: the member the app recorded, if they still exist;
  // otherwise whoever created the event, matched by email; otherwise nobody.
  let userId: string | null = null;
  const propUser = props[PROP.userId];
  const creatorEmail = event.creator?.email;
  if (propUser && people.isUser(propUser)) {
    userId = propUser;
  } else if (creatorEmail) {
    userId = people.userIdByEmail(creatorEmail);
  }

  const purpose = isPurpose(props[PROP.purpose])
    ? (props[PROP.purpose] as Purpose)
    : guessPurpose(summary);

  // Same rule the booking routes hold: only a lesson names an instructor.
  const propInstructor = props[PROP.instructorId];
  const instructorId =
    purpose === "TRAINING" && propInstructor && people.isInstructor(propInstructor)
      ? propInstructor
      : null;

  // A title the app generated is not worth storing — the calendar draws its own
  // label from the member and purpose. Anything else (a hand-made event, or an
  // app event renamed in Google) is somebody's words, and is kept.
  const generated = props[PROP.summary];
  const title = summary && summary !== generated ? summary : null;

  return {
    googleEventId: event.id,
    startsAt,
    endsAt,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    userId,
    purpose,
    instructorId,
    notes: plainText(event.description),
    title,
    status: isCancelledTitle(summary) ? "CANCELED" : "CONFIRMED",
  };
}

/** Short purpose words for a calendar title — "Training (with CFI)" is a form label. */
const TITLE_PURPOSE: Record<Purpose, string> = {
  LOCAL: "Local flight",
  CROSS_COUNTRY: "Cross-country",
  TRAINING: "Lesson",
  TRAINING_SOLO: "Solo",
  CHECKRIDE: "Checkride",
  MAINTENANCE: "Maintenance",
};

/**
 * The title the app gives an event it writes, in the club's own style
 * ("Dylan Flight w Matt"): who, then what, then with whom. Maintenance is the
 * club's block, not a member's flight, so it's just "Maintenance".
 */
export function appEventTitle(b: {
  memberName: string;
  purpose: Purpose;
  instructorName?: string | null;
}): string {
  if (b.purpose === "MAINTENANCE") return "Maintenance";
  const base = `${b.memberName} — ${TITLE_PURPOSE[b.purpose]}`;
  return b.instructorName ? `${base} w/ ${b.instructorName}` : base;
}

/** Event start/end for a booking, all-day ones as club-local DATES. */
export function eventTimes(b: {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}): { start: GoogleEventTime; end: GoogleEventTime } {
  if (b.allDay) {
    return {
      start: { date: clubDateKey(b.startsAt) },
      end: { date: clubDateKey(b.endsAt) },
    };
  }
  return {
    start: { dateTime: b.startsAt.toISOString(), timeZone: CLUB_TIME_ZONE },
    end: { dateTime: b.endsAt.toISOString(), timeZone: CLUB_TIME_ZONE },
  };
}

/**
 * The private properties the app stamps on every event it writes or edits.
 * Empty string, not absent, for "no instructor": a PATCH merges these keys,
 * so leaving one out would keep a stale CFI on a booking that changed purpose.
 */
export function appEventProps(b: {
  userId: string | null;
  purpose: Purpose;
  instructorId: string | null;
  generatedTitle?: string | null;
}): Record<string, string> {
  const props: Record<string, string> = {
    [PROP.purpose]: b.purpose,
    [PROP.instructorId]: b.instructorId ?? "",
  };
  if (b.userId) props[PROP.userId] = b.userId;
  if (b.generatedTitle) props[PROP.summary] = b.generatedTitle;
  return props;
}

/**
 * The guest list a booking's event should have: the member who booked it and,
 * for a lesson, their CFI. `drop` is who the app put there before and no longer
 * wants (the CFI a lesson used to be with). Anyone else on the event — a
 * passenger somebody added in Google — is left exactly as it was, with their
 * RSVP, since sending a guest list REPLACES the event's.
 *
 * null = nothing to change, so the caller can leave `attendees` out of a PATCH
 * and Google sends nobody a fresh invite.
 */
export function bookingAttendees(
  current: GoogleAttendee[] | undefined,
  want: (string | null | undefined)[],
  drop: (string | null | undefined)[] = []
): GoogleAttendee[] | null {
  const key = (e: string) => e.trim().toLowerCase();
  const wanted = new Set(want.filter((e): e is string => !!e?.trim()).map(key));
  // A person who is still wanted stays, even if they were also the old CFI.
  const dropped = new Set(
    drop.filter((e): e is string => !!e?.trim()).map(key).filter((e) => !wanted.has(e))
  );
  const kept = (current ?? []).filter((a) => !dropped.has(key(a.email)));
  const have = new Set(kept.map((a) => key(a.email)));
  const added = [...wanted].filter((e) => !have.has(e)).map((email) => ({ email }));
  if (added.length === 0 && kept.length === (current ?? []).length) return null;
  return [...kept, ...added];
}
