// The airplane's Google Calendar ⇄ the Reservation table: the db half of
// lib/calendarEvents.ts.
//
// GOOGLE IS THE SOURCE OF TRUTH for an airplane that has a calendar linked
// (AircraftCalendar). The Reservation rows are a MIRROR of it, kept because a
// filed flight links to its booking, a lesson names its CFI, and the schedule
// should still draw when Google is slow. So:
//
//   - READING the schedule first pulls what changed in Google (incremental,
//     via Google's sync token — normally one small request) and applies it.
//     At most once a minute per airplane (`SYNC_INTERVAL_MS`); writes force
//     one, because a conflict check against a minute-old copy is a guess.
//     Same deliberate pattern as finances materialising dues: the read happens
//     exactly when the answer matters, so the club needs no cron.
//   - WRITING goes to Google first and only then to the row, so a refusal from
//     Google leaves nothing behind locally. The row is upserted by
//     `googleEventId`, which is also why a sync racing the write is harmless.
//   - A FULL sync (first link, a stale token, or "Sync now") makes this
//     airplane's mirrored rows EXACTLY the calendar's events: rows whose event
//     has gone are deleted. App-only rows (no `googleEventId`) are never
//     touched — they predate the link and stay the app's.
//
// An airplane with no calendar linked behaves exactly as before any of this.
import { prisma } from "./prisma";
import { openBox } from "./secretBox";
import {
  appEventProps,
  appEventTitle,
  bookingAttendees,
  cancelledTitle,
  eventTimes,
  eventToBooking,
  type GoogleEvent,
  type PeopleLookup,
} from "./calendarEvents";
import {
  GoogleError,
  getEvent,
  type EventsPage,
  insertEvent,
  listEventsPage,
  patchEvent,
} from "./googleCalendar";
import type { Purpose } from "./constants";

/** How stale a READ may let an airplane's mirror get. Writes always re-sync. */
const SYNC_INTERVAL_MS = 60_000;

export interface CalendarLink {
  refreshToken: string;
  calendarId: string;
  /** The airplane's tail number, which every title the app writes carries. */
  tailNumber: string;
}

/** The secret the refresh token is sealed under (lib/secretBox.ts). */
export function tokenSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? "";
}

/** The club's refresh token, or a GoogleError saying why there isn't one. */
export async function clubRefreshToken(): Promise<string> {
  const row = await prisma.googleConnection.findUnique({ where: { id: "club" } });
  if (!row) {
    throw new GoogleError(
      "The club's Google account isn't connected. An admin can connect it in Club settings.",
      null
    );
  }
  const token = openBox(row.refreshTokenEnc, tokenSecret());
  if (!token) {
    // NEXTAUTH_SECRET changed since it was stored — see lib/secretBox.ts.
    throw new GoogleError(
      "The stored Google connection can't be read any more. An admin needs to reconnect it in Club settings.",
      null
    );
  }
  return token;
}

/**
 * This airplane's calendar, ready to call. null = no calendar linked, i.e. the
 * app-only behaviour. Throws when one IS linked but can't be used, because
 * quietly falling back to app-only would let the two schedules drift apart.
 */
export async function calendarLinkFor(aircraftId: string): Promise<CalendarLink | null> {
  const cal = await prisma.aircraftCalendar.findUnique({
    where: { aircraftId },
    include: { aircraft: { select: { tailNumber: true } } },
  });
  if (!cal) return null;
  return {
    refreshToken: await clubRefreshToken(),
    calendarId: cal.calendarId,
    tailNumber: cal.aircraft.tailNumber,
  };
}

/**
 * The club's people, loaded ONCE per sync, as the lookups `eventToBooking`
 * needs. One query for the whole roster beats one per event.
 */
async function peopleLookup(): Promise<PeopleLookup> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, positions: true },
  });
  const byEmail = new Map<string, string>();
  const ids = new Set<string>();
  const instructors = new Set<string>();
  for (const u of users) {
    ids.add(u.id);
    if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    if (u.positions.includes("INSTRUCTOR")) instructors.add(u.id);
  }
  return {
    userIdByEmail: (email) => byEmail.get(email.toLowerCase()) ?? null,
    isUser: (id) => ids.has(id),
    isInstructor: (id) => instructors.has(id),
  };
}

/**
 * The writes that make one PAGE of events true in the mirror: an upsert per
 * live event, a delete per event removed in Google. Sent as one transaction,
 * so a first sync of a few hundred events is a handful of round trips rather
 * than a few hundred.
 */
async function applyEvents(aircraftId: string, events: GoogleEvent[], people: PeopleLookup) {
  const writes = [];
  for (const event of events) {
    const booking = eventToBooking(event, people);
    if (booking === null) continue;
    if (booking === "removed") {
      writes.push(prisma.reservation.deleteMany({ where: { googleEventId: event.id } }));
      continue;
    }
    const { googleEventId, ...fields } = booking;
    writes.push(
      prisma.reservation.upsert({
        where: { googleEventId },
        create: { googleEventId, aircraftId, ...fields },
        update: { aircraftId, ...fields },
      })
    );
  }
  if (writes.length > 0) await prisma.$transaction(writes);
}

/** A member's email — what Google invites them by. */
async function emailOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Bring this airplane's mirror up to date with its calendar.
 *
 * Never throws: a failure is recorded on the AircraftCalendar row (Club
 * settings shows it) and returned, so a schedule READ can carry on with the
 * copy it has. Writes check the result and refuse on failure.
 */
export async function syncAircraftCalendar(
  aircraftId: string,
  opts: { force?: boolean; full?: boolean } = {}
): Promise<SyncResult> {
  const cal = await prisma.aircraftCalendar.findUnique({ where: { aircraftId } });
  if (!cal) return { ok: true };
  if (
    !opts.force &&
    !opts.full &&
    cal.syncedAt &&
    Date.now() - cal.syncedAt.getTime() < SYNC_INTERVAL_MS
  ) {
    return { ok: true };
  }

  const startedAt = new Date();
  try {
    const refreshToken = await clubRefreshToken();
    const people = await peopleLookup();
    let syncToken = opts.full ? null : cal.syncToken;

    // A stale token is a 410: start again from a full listing, once.
    let page: EventsPage<GoogleEvent>;
    try {
      page = await listEventsPage<GoogleEvent>(refreshToken, cal.calendarId, { syncToken });
    } catch (e) {
      if (!(e instanceof GoogleError && e.status === 410 && syncToken)) throw e;
      syncToken = null;
      page = await listEventsPage<GoogleEvent>(refreshToken, cal.calendarId, {});
    }
    const full = !syncToken;
    const seen = new Set<string>();

    for (;;) {
      const events = page.items ?? [];
      for (const event of events) seen.add(event.id);
      await applyEvents(aircraftId, events, people);
      if (!page.nextPageToken) break;
      page = await listEventsPage<GoogleEvent>(refreshToken, cal.calendarId, {
        syncToken,
        pageToken: page.nextPageToken,
      });
    }

    if (full) {
      // Rows whose event no longer exists. `updatedAt` guards the one race
      // that matters: a booking the app wrote while this listing was in flight
      // isn't in `seen`, and must not be deleted for it.
      await prisma.reservation.deleteMany({
        where: {
          aircraftId,
          googleEventId: { not: null, notIn: [...seen] },
          updatedAt: { lt: startedAt },
        },
      });
    }

    await prisma.aircraftCalendar.update({
      where: { aircraftId },
      data: { syncToken: page.nextSyncToken ?? null, syncedAt: new Date(), syncError: null },
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't reach Google Calendar.";
    await prisma.aircraftCalendar
      .update({ where: { aircraftId }, data: { syncError: error } })
      .catch(() => undefined);
    return { ok: false, error };
  }
}

/** Sync every linked airplane (a schedule read that isn't about one). */
export async function syncAllCalendars(): Promise<void> {
  const cals = await prisma.aircraftCalendar.findMany({ select: { aircraftId: true } });
  await Promise.all(cals.map((c) => syncAircraftCalendar(c.aircraftId)));
}

/** A booking the app is creating, as the event Google should hold. */
export async function insertCalendarBooking(
  link: CalendarLink,
  b: {
    userId: string;
    memberName: string;
    startsAt: Date;
    endsAt: Date;
    purpose: Purpose;
    instructorId: string | null;
    notes: string | null;
  }
): Promise<GoogleEvent> {
  const title = appEventTitle({ ...b, tailNumber: link.tailNumber });
  // The member and their CFI are invited, so the booking lands in their own
  // calendars. The club account stays the organiser, which is what lets any
  // member book without needing access to the airplane's calendar themselves.
  const attendees = bookingAttendees(
    [],
    [await emailOf(b.userId), await emailOf(b.instructorId)]
  );
  return insertEvent<GoogleEvent>(
    link.refreshToken,
    link.calendarId,
    {
      summary: title,
      description: b.notes ?? "",
      ...eventTimes({ ...b, allDay: false }),
      ...(attendees ? { attendees } : {}),
      extendedProperties: {
        private: appEventProps({ ...b, generatedTitle: title }),
      },
    },
    "all"
  );
}

/**
 * An edit, sent as a PATCH of only what changed — an untouched hand-made
 * event keeps its all-day dates, its HTML description and its own title.
 * `title` is regenerated only for an event whose title the app wrote and
 * nobody has renamed since (the row's `title` is null).
 */
export async function patchCalendarBooking(
  link: CalendarLink,
  googleEventId: string,
  b: {
    userId: string | null;
    memberName: string | null;
    purpose: Purpose;
    instructorId: string | null;
    /** The CFI the booking had before this edit, uninvited if it changed. */
    previousInstructorId: string | null;
    appTitled: boolean;
    times?: { startsAt: Date; endsAt: Date; allDay: boolean };
    notes?: string | null;
  }
): Promise<GoogleEvent> {
  let title: string | null = null;
  if (b.appTitled && b.memberName) {
    title = appEventTitle({
      memberName: b.memberName,
      purpose: b.purpose,
      tailNumber: link.tailNumber,
    });
  }
  // Sending a guest list replaces the event's, so read what's there now and
  // change only our part of it. This also invites the member to a booking made
  // before the app sent invites, the first time it's edited.
  const current = await getEvent<GoogleEvent>(link.refreshToken, link.calendarId, googleEventId);
  const previous = b.previousInstructorId !== b.instructorId ? b.previousInstructorId : null;
  const attendees = bookingAttendees(
    current.attendees,
    [await emailOf(b.userId), await emailOf(b.instructorId)],
    [await emailOf(previous)]
  );
  // Guests hear about the changes that matter to them — a new time, or being
  // added or taken off — and not about a reworded note.
  const notify = attendees !== null || b.times !== undefined;
  return patchEvent<GoogleEvent>(
    link.refreshToken,
    link.calendarId,
    googleEventId,
    {
      ...(title ? { summary: title } : {}),
      ...(b.times ? eventTimes(b.times) : {}),
      ...(b.notes !== undefined ? { description: b.notes ?? "" } : {}),
      ...(attendees ? { attendees } : {}),
      extendedProperties: {
        private: appEventProps({ ...b, generatedTitle: title }),
      },
    },
    notify ? "all" : "none"
  );
}

/**
 * Cancel = rename to "CANCELLED - <title>", the way the club already does it,
 * so the calendar keeps the record. Reads the event first: the title to
 * prefix is whatever it's called in Google NOW. "gone" = it was already
 * deleted there, which is as cancelled as it gets.
 */
export async function cancelCalendarBooking(
  link: CalendarLink,
  googleEventId: string
): Promise<GoogleEvent | "gone"> {
  let event: GoogleEvent;
  try {
    event = await getEvent<GoogleEvent>(link.refreshToken, link.calendarId, googleEventId);
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return "gone";
    throw e;
  }
  if (event.status === "cancelled") return "gone";
  // "all", so the invited member and CFI see it's off rather than finding out
  // at the airplane.
  return patchEvent<GoogleEvent>(
    link.refreshToken,
    link.calendarId,
    googleEventId,
    { summary: cancelledTitle(event.summary) },
    "all"
  );
}
