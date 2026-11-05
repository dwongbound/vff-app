// GET /api/flights/active — "have I got an airplane out?", for the app-wide
// banner that takes a member back to the flight they haven't finished.
//
// `{ flight: ApiActiveFlight | null }`: the caller's newest open session on ANY
// airplane, inside `SESSION_WINDOW_HOURS`. The window is the point: the
// post-flight form only ever joins a session that young (`findOpenSession`),
// so a banner for an older one would promise a "continue" the form can't
// keep. Older unfinished rows stay in the log, badged, as they always have.
//
// Its own route rather than `GET /api/flights?open=1` because the banner runs
// on every page: it wants one small row and its cards, not a log summary.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SESSION_WINDOW_HOURS } from "@/lib/flightSession";
import type { ApiActiveFlight } from "@/lib/types";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const since = new Date(Date.now() - SESSION_WINDOW_HOURS * 3_600_000);
  const row = await prisma.flight.findFirst({
    where: { userId: user.id, filedAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      aircraft: { select: { id: true, tailNumber: true } },
      checkouts: { where: { completedAt: { not: null } }, select: { kind: true } },
    },
  });

  const flight: ApiActiveFlight | null = row
    ? {
        id: row.id,
        aircraft: row.aircraft,
        openedAt: row.createdAt.toISOString(),
        cards: [...new Set(row.checkouts.map((c) => c.kind))],
      }
    : null;
  return NextResponse.json({ flight });
}
