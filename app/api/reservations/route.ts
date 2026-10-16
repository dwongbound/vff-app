// Reservations: list a window of the schedule, and book the airplane.
//
// GET  /api/reservations?aircraftId=&from=&to=&mine=1
//      `from`/`to` are ISO instants bounding the calendar month (or the
//      list's horizon on phones). Canceled bookings are excluded unless
//      ?includeCanceled=1, so the calendar shows the schedule as flown.
// POST /api/reservations  { aircraftId, startsAt, endsAt, purpose, notes }
//
// An airplane with a Google Calendar linked reads and writes THROUGH it — see
// lib/googleCalendarSync.ts. GET pulls what changed in Google first (at most
// once a minute); POST re-syncs before its conflict check, writes the event to
// Google, and only then records the row.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeReservation } from "@/lib/serialize";
import { conflictMessage, findConflict, validateReservation } from "@/lib/reservations";
import {
  calendarLinkFor,
  insertCalendarBooking,
  syncAircraftCalendar,
  syncAllCalendars,
  type CalendarLink,
} from "@/lib/googleCalendarSync";
import { resolveBookingInstructor, resolutionFailed } from "@/lib/instructors";
import { can } from "@/lib/positions";
import { PURPOSE_LABELS, type Purpose } from "@/lib/constants";
import { formatTimeRange } from "@/lib/dates";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  instructor: { select: { id: true, name: true, email: true } },
  flight: { select: { id: true } },
} as const;

/** Whatever the client sent, narrowed to a Purpose. Anything odd = LOCAL. */
function parsePurpose(value: unknown): Purpose {
  if (typeof value === "string" && value in PURPOSE_LABELS) {
    return value as Purpose;
  }
  return "LOCAL";
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const mine = url.searchParams.get("mine") === "1";

  // Google is the source of truth for a linked airplane. A failed sync is
  // recorded for Club settings and the schedule is served from the last copy —
  // a read is no reason to show an empty calendar.
  if (aircraftId) await syncAircraftCalendar(aircraftId);
  else await syncAllCalendars();

  const rows = await prisma.reservation.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
      // Older databases may still hold CANCELED rows from before DELETE
      // removed them; they are never shown.
      status: "CONFIRMED",
      // A booking is "in the window" if it overlaps it at all, so a long
      // cross-country that starts before the window still shows up.
      ...(from ? { endsAt: { gt: new Date(from) } } : {}),
      ...(to ? { startsAt: { lt: new Date(to) } } : {}),
    },
    include: INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json(rows.map((r) => serializeReservation(r, user.id)));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // An instructor-only account reads the schedule but doesn't take the
  // airplane out — see `reservation:book` in lib/positions.ts. The calendar
  // hides its own booking controls for these accounts; this is the control.
  if (!can(user, "reservation:book")) {
    return NextResponse.json(
      {
        error:
          "Your account teaches here rather than flying here, so it can't book the airplane. An admin can make you a flying member from the Members tab.",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const startsAt = new Date(String(body.startsAt ?? ""));
  const endsAt = new Date(String(body.endsAt ?? ""));
  const purpose = parsePurpose(body.purpose);
  const notes = body.notes ? String(body.notes).trim() : null;

  const instructor = await resolveBookingInstructor(purpose, body.instructorId);
  if (resolutionFailed(instructor)) {
    return NextResponse.json({ error: instructor.error }, { status: 400 });
  }

  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true, active: true, tailNumber: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }
  if (!aircraft.active) {
    return NextResponse.json(
      { error: `${aircraft.tailNumber} is retired and can't be booked.` },
      { status: 400 }
    );
  }

  // Same rule set the client form runs, re-checked here: the client can be
  // stale (or bypassed entirely).
  const invalid = validateReservation({ startsAt, endsAt });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  // A linked airplane's conflict check has to be against what Google holds
  // NOW — the member who typed a booking into Google a minute ago included.
  let link: CalendarLink | null;
  try {
    link = await calendarLinkFor(aircraftId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google Calendar is unavailable." },
      { status: 503 }
    );
  }
  if (link) {
    const synced = await syncAircraftCalendar(aircraftId, { force: true });
    if (!synced.ok) {
      return NextResponse.json(
        {
          error: `Couldn't check ${aircraft.tailNumber}'s Google Calendar, so nothing was booked. ${synced.error}`,
        },
        { status: 503 }
      );
    }
  }

  // Only bookings that could possibly touch this window need loading.
  const neighbors = await prisma.reservation.findMany({
    where: {
      aircraftId,
      status: "CONFIRMED",
      endsAt: { gt: startsAt },
      startsAt: { lt: endsAt },
    },
    include: INCLUDE,
  });

  const conflict = findConflict(neighbors, { startsAt, endsAt });
  if (conflict) {
    return NextResponse.json(
      {
        error: conflictMessage(
          conflict,
          aircraft.tailNumber,
          formatTimeRange(conflict.startsAt, conflict.endsAt)
        ),
      },
      { status: 409 }
    );
  }

  const data = {
    aircraftId,
    userId: user.id,
    startsAt,
    endsAt,
    purpose,
    notes,
    instructorId: instructor.instructorId,
  };

  if (!link) {
    const created = await prisma.reservation.create({ data, include: INCLUDE });
    return NextResponse.json(serializeReservation(created, user.id), { status: 201 });
  }

  // Google first: if it refuses, nothing has been written here.
  let googleEventId: string;
  try {
    const event = await insertCalendarBooking(link, { ...data, memberName: user.name });
    googleEventId = event.id;
  } catch (e) {
    return NextResponse.json(
      {
        error: `Couldn't add the booking to ${aircraft.tailNumber}'s Google Calendar, so nothing was booked. ${
          e instanceof Error ? e.message : ""
        }`.trim(),
      },
      { status: 502 }
    );
  }

  // Upsert, not create: a schedule read elsewhere may already have pulled the
  // new event in by the time this runs.
  const created = await prisma.reservation.upsert({
    where: { googleEventId },
    create: { ...data, googleEventId },
    update: { ...data, title: null, status: "CONFIRMED" },
    include: INCLUDE,
  });

  return NextResponse.json(serializeReservation(created, user.id), { status: 201 });
}
