// The signed-in member's OWN Google calendars, for /profile's "Send invites to"
// picker. Nothing to do with the club's connection: this is read with the
// member's own permission, asked for once, and it lists names and ids only.
//
// GET            — `{ calendars }`, or `{ needsConsent: true }` when there's no
//                  permission to list them yet (never asked, or withdrawn),
//                  or `{ configured: false }` on a server with no Google client.
// GET ?connect=1 — a plain navigation: sets the one-time state cookie and
//                  sends the member to Google's consent screen, which comes
//                  back through the SAME callback the club connection uses
//                  (see MEMBER_STATE_PREFIX) and lands on /profile.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GoogleError,
  MEMBER_STATE_PREFIX,
  STATE_COOKIE,
  appBaseUrl,
  calendarRedirectUri,
  consentUrl,
  googleConfigured,
  listOwnCalendars,
} from "@/lib/googleCalendar";
import { tokenSecret } from "@/lib/googleCalendarSync";
import { openBox } from "@/lib/secretBox";
import type { ApiMyCalendars } from "@/lib/types";

export async function GET(req: Request) {
  const session = await getSessionUser();
  const connect = new URL(req.url).searchParams.get("connect") === "1";

  if (connect) {
    const back = (status: string) =>
      NextResponse.redirect(new URL(`/profile?calendarPicker=${status}`, appBaseUrl(req)));
    if (!session) return NextResponse.redirect(new URL("/login", appBaseUrl(req)));
    if (!googleConfigured()) return back("error");
    const state = MEMBER_STATE_PREFIX + randomBytes(24).toString("base64url");
    const res = NextResponse.redirect(consentUrl(calendarRedirectUri(req), state, true));
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: appBaseUrl(req).startsWith("https:"),
      path: "/api/calendar",
      maxAge: 600,
    });
    return res;
  }

  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!googleConfigured()) {
    return NextResponse.json({ configured: false } satisfies ApiMyCalendars);
  }

  const row = await prisma.user.findUnique({
    where: { id: session.id },
    select: { googleListTokenEnc: true },
  });
  // An unreadable token (NEXTAUTH_SECRET changed) is the same as none: the
  // member just goes through the consent screen again.
  const token = row?.googleListTokenEnc ? openBox(row.googleListTokenEnc, tokenSecret()) : null;
  if (!token) {
    return NextResponse.json({ configured: true, needsConsent: true } satisfies ApiMyCalendars);
  }

  try {
    const calendars = await listOwnCalendars(token);
    return NextResponse.json({ configured: true, calendars } satisfies ApiMyCalendars);
  } catch (e) {
    // invalid_grant (401): the member revoked us in their Google account, or
    // the token aged out. Forget it so the next ask is a clean consent trip.
    if (e instanceof GoogleError && (e.status === 401 || e.status === 403)) {
      await prisma.user.update({
        where: { id: session.id },
        data: { googleListTokenEnc: null },
      });
      return NextResponse.json({ configured: true, needsConsent: true } satisfies ApiMyCalendars);
    }
    const error = e instanceof Error ? e.message : "Couldn't reach Google Calendar.";
    return NextResponse.json({ error }, { status: 502 });
  }
}
