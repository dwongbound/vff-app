// One airplane's Google Calendar link. Admins only.
//
// PUT  { calendarId }        — link (or re-link) this airplane to a calendar
//                              the connected account can write, then run a
//                              FULL sync so the schedule is the calendar's
//                              from the first page load.
//                              Only the admin who CONNECTED the Google account
//                              may: it's their account's calendars being
//                              chosen from (see ../../route.ts).
//      { calendarId: null }  — unlink: back to app-only booking. Any admin.
// POST                        — "Sync now": a full sync, on demand.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWritableCalendars } from "@/lib/googleCalendar";
import { clubRefreshToken, syncAircraftCalendar } from "@/lib/googleCalendarSync";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const aircraft = await prisma.aircraft.findUnique({ where: { id }, select: { id: true } });
  if (!aircraft) return NextResponse.json({ error: "Unknown aircraft." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || !("calendarId" in body)) {
    return NextResponse.json({ error: "Pick a calendar." }, { status: 400 });
  }

  if (!body.calendarId) {
    await prisma.aircraftCalendar.deleteMany({ where: { aircraftId: id } });
    return NextResponse.json({ ok: true });
  }

  const connection = await prisma.googleConnection.findUnique({
    where: { id: "club" },
    select: { connectedById: true, connectedBy: { select: { name: true } } },
  });
  if (!connection || connection.connectedById !== admin.id) {
    return NextResponse.json(
      {
        error: connection?.connectedBy
          ? `Only ${connection.connectedBy.name}, who connected the Google account, can pick from its calendars. Reconnect with your own Google account to pick one yourself.`
          : "Connect a Google account first.",
      },
      { status: 403 }
    );
  }

  // Only a calendar the account can WRITE: a read-only one would sync in fine
  // and then refuse the first booking anybody made.
  let calendarName: string;
  try {
    const calendars = await listWritableCalendars(await clubRefreshToken());
    const match = calendars.find((c) => c.id === String(body.calendarId));
    if (!match) {
      return NextResponse.json(
        { error: "The connected Google account can't edit that calendar." },
        { status: 400 }
      );
    }
    calendarName = match.summary;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't reach Google." },
      { status: 503 }
    );
  }

  await prisma.aircraftCalendar.upsert({
    where: { aircraftId: id },
    create: { aircraftId: id, calendarId: String(body.calendarId), calendarName },
    // A different calendar means the old cursor is meaningless.
    update: { calendarId: String(body.calendarId), calendarName, syncToken: null, syncError: null },
  });
  const synced = await syncAircraftCalendar(id, { full: true });
  return NextResponse.json(synced.ok ? { ok: true } : { ok: true, syncError: synced.error });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const synced = await syncAircraftCalendar(id, { full: true });
  if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
