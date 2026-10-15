// The club's Google Calendar sync, as Club settings sees it. Admins only.
//
// GET    — is Google configured here, which account is connected, each
//          airplane's linked calendar and how its last sync went, and — ONLY
//          for the admin who connected it — the calendars that account could
//          link. The connected account is somebody's own Google account, and
//          its calendar list ("Wong Family", "Work") is theirs: other admins
//          see the airplane's linked calendar and nothing else.
// DELETE — disconnect: revoke the token at Google, forget it, and unlink every
//          airplane, which returns them to app-only booking. Mirrored rows
//          stay as they are; linking again runs a full sync that reconciles
//          them with the calendar.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  googleConfigured,
  listWritableCalendars,
  revokeToken,
} from "@/lib/googleCalendar";
import { clubRefreshToken } from "@/lib/googleCalendarSync";
import type { ApiCalendarStatus } from "@/lib/types";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const [connection, aircraft] = await Promise.all([
    prisma.googleConnection.findUnique({
      where: { id: "club" },
      include: { connectedBy: { select: { name: true } } },
    }),
    prisma.aircraft.findMany({
      where: { active: true },
      orderBy: { tailNumber: "asc" },
      select: { id: true, tailNumber: true, calendar: true },
    }),
  ]);

  let calendars: ApiCalendarStatus["calendars"] = [];
  let calendarsError: string | null = null;
  const canPick = Boolean(connection && connection.connectedById === admin.id);
  if (connection && canPick) {
    try {
      const token = await clubRefreshToken();
      calendars = (await listWritableCalendars(token)).map((c) => ({ id: c.id, name: c.summary }));
    } catch (e) {
      calendarsError = e instanceof Error ? e.message : "Couldn't list calendars.";
    }
  }

  const body: ApiCalendarStatus = {
    configured: googleConfigured(),
    connection: connection
      ? {
          accountEmail: connection.accountEmail,
          connectedBy: connection.connectedBy?.name ?? null,
          connectedAt: connection.updatedAt.toISOString(),
        }
      : null,
    canPick,
    calendars,
    calendarsError,
    aircraft: aircraft.map((a) => ({
      id: a.id,
      tailNumber: a.tailNumber,
      calendar: a.calendar
        ? {
            calendarId: a.calendar.calendarId,
            calendarName: a.calendar.calendarName,
            syncedAt: a.calendar.syncedAt?.toISOString() ?? null,
            syncError: a.calendar.syncError,
          }
        : null,
    })),
  };
  return NextResponse.json(body);
}

export async function DELETE() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const token = await clubRefreshToken().catch(() => null);
  if (token) await revokeToken(token);
  await prisma.$transaction([
    prisma.aircraftCalendar.deleteMany({}),
    prisma.googleConnection.deleteMany({}),
  ]);
  return NextResponse.json({ ok: true });
}
