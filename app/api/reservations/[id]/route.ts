// Edit or delete one booking. Members own their own; admins can move or
// delete anyone's (someone has to be able to clear the board for maintenance).
//
// DELETE removes the row. It used to mark it CANCELED and keep it "so the
// calendar history stays honest", but nothing ever read a canceled booking
// back — every query filtered them out — so they were rows that only grew. A
// flight already filed against the booking keeps its log entry: the
// Flight → Reservation link is SetNull, not Cascade.
//
// A booking that MIRRORS an event on the airplane's Google Calendar is
// different on both verbs, because Google is its source of truth (see
// lib/googleCalendarSync.ts): an edit is sent to Google first, and DELETE
// CANCELS rather than removes — the event is renamed "CANCELLED - <title>",
// the club's own convention, so the calendar keeps the record, and the row is
// kept as CANCELED (which every read already filters out).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeReservation } from "@/lib/serialize";
import { conflictMessage, findConflict, validateReservation } from "@/lib/reservations";
import {
  calendarLinkFor,
  cancelCalendarBooking,
  patchCalendarBooking,
  syncAircraftCalendar,
  type CalendarLink,
} from "@/lib/googleCalendarSync";
import { resolveBookingInstructor, resolutionFailed } from "@/lib/instructors";
import { PURPOSE_LABELS, type Purpose } from "@/lib/constants";
import { formatTimeRange } from "@/lib/dates";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  instructor: { select: { id: true, name: true, email: true } },
  flight: { select: { id: true } },
} as const;

/**
 * The airplane's calendar when THIS booking lives on it, null when it's an
 * app-only booking (or nothing is linked any more — the row is then the app's
 * to change), or a ready-made 503 when it should be reachable and isn't.
 */
async function linkForBooking(
  aircraftId: string,
  googleEventId: string | null
): Promise<CalendarLink | null | NextResponse> {
  if (!googleEventId) return null;
  try {
    return await calendarLinkFor(aircraftId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google Calendar is unavailable." },
      { status: 503 }
    );
  }
}

/** The 502 for a write Google refused — its own message, after ours. */
function googleRefused(e: unknown, what: string) {
  return NextResponse.json(
    {
      error: `Google Calendar refused the ${what}, so nothing changed. ${
        e instanceof Error ? e.message : ""
      }`.trim(),
    },
    { status: 502 }
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findUnique({
    where: { id },
    include: INCLUDE,
  });
  if (!existing) {
    return NextResponse.json({ error: "That booking is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your booking." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const startsAt = body.startsAt ? new Date(String(body.startsAt)) : existing.startsAt;
  const endsAt = body.endsAt ? new Date(String(body.endsAt)) : existing.endsAt;

  // Only re-validate the window when it actually moved — otherwise editing the
  // notes on a booking that already started would fail the "not in the past"
  // rule.
  const timesChanged =
    startsAt.getTime() !== existing.startsAt.getTime() ||
    endsAt.getTime() !== existing.endsAt.getTime();

  const link = await linkForBooking(existing.aircraftId, existing.googleEventId);
  if (link instanceof NextResponse) return link;

  if (timesChanged) {
    const invalid = validateReservation({ startsAt, endsAt });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    // Check against what Google holds now, not the last read's copy.
    if (link) {
      const synced = await syncAircraftCalendar(existing.aircraftId, { force: true });
      if (!synced.ok) {
        return NextResponse.json(
          { error: `Couldn't check the Google Calendar, so nothing changed. ${synced.error}` },
          { status: 503 }
        );
      }
    }

    const neighbors = await prisma.reservation.findMany({
      where: {
        aircraftId: existing.aircraftId,
        status: "CONFIRMED",
        endsAt: { gt: startsAt },
        startsAt: { lt: endsAt },
      },
      include: INCLUDE,
    });
    const conflict = findConflict(neighbors, { startsAt, endsAt }, existing.id);
    if (conflict) {
      return NextResponse.json(
        {
          error: conflictMessage(
            conflict,
            existing.aircraft.tailNumber,
            formatTimeRange(conflict.startsAt, conflict.endsAt)
          ),
        },
        { status: 409 }
      );
    }
  }

  // Moving an all-day booking makes it a timed one: the form edits clock
  // times, and the times it sent are the member's answer.
  const data: Record<string, unknown> = timesChanged
    ? { startsAt, endsAt, allDay: false }
    : { startsAt, endsAt };
  if (typeof body.purpose === "string" && body.purpose in PURPOSE_LABELS) {
    data.purpose = body.purpose as Purpose;
  }
  if ("notes" in body) data.notes = body.notes ? String(body.notes).trim() : null;

  // The instructor is resolved against the purpose this booking will HAVE
  // after the edit, not the one it had before — otherwise changing a local
  // flight into a lesson in the same save silently drops the CFI the member
  // just picked. Re-resolved on every PATCH rather than only when
  // `instructorId` is present, because a purpose change alone has to be able
  // to clear a stale one.
  const nextPurpose = (data.purpose as Purpose | undefined) ?? (existing.purpose as Purpose);
  const instructor = await resolveBookingInstructor(
    nextPurpose,
    "instructorId" in body ? body.instructorId : existing.instructorId
  );
  if (resolutionFailed(instructor)) {
    return NextResponse.json({ error: instructor.error }, { status: 400 });
  }
  data.instructorId = instructor.instructorId;
  if (body.status === "CONFIRMED" || body.status === "CANCELED") {
    data.status = body.status;
  }

  if (link && existing.googleEventId) {
    // The legacy CANCELED-by-PATCH path doesn't apply here: cancelling a
    // calendar booking is DELETE, which renames the event.
    delete data.status;
    const notes = "notes" in data ? (data.notes as string | null) : undefined;
    try {
      await patchCalendarBooking(link, existing.googleEventId, {
        userId: existing.userId,
        memberName: existing.user?.name ?? null,
        purpose: nextPurpose,
        instructorId: instructor.instructorId,
        previousInstructorId: existing.instructorId,
        appTitled: existing.title === null,
        times: timesChanged ? { startsAt, endsAt, allDay: false } : undefined,
        notes: notes !== existing.notes ? notes : undefined,
      });
    } catch (e) {
      return googleRefused(e, "edit");
    }
  }

  const updated = await prisma.reservation.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeReservation(updated, user.id));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, userId: true, aircraftId: true, googleEventId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "That booking is gone." }, { status: 404 });
  }
  if (existing.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That's not your booking." }, { status: 403 });
  }

  const link = await linkForBooking(existing.aircraftId, existing.googleEventId);
  if (link instanceof NextResponse) return link;

  if (!link || !existing.googleEventId) {
    await prisma.reservation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  let cancelled: Awaited<ReturnType<typeof cancelCalendarBooking>>;
  try {
    cancelled = await cancelCalendarBooking(link, existing.googleEventId);
  } catch (e) {
    return googleRefused(e, "cancellation");
  }
  if (cancelled === "gone") {
    // Already deleted in Google — the next sync would remove the row anyway.
    await prisma.reservation.delete({ where: { id } });
  } else {
    await prisma.reservation.update({
      where: { id },
      data: { status: "CANCELED", title: cancelled.summary ?? null },
    });
  }
  return NextResponse.json({ ok: true });
}
