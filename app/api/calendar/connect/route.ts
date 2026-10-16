// Start connecting the club's Google account for calendar sync. Admins only.
//
// A plain navigation (Club settings' Connect is a link, not a fetch): sets a
// one-time `state` cookie and sends the admin to Google's consent screen,
// which comes back to ./callback. The cookie is what stops a forged callback
// from attaching somebody else's Google account to the club.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import {
  STATE_COOKIE,
  appBaseUrl,
  calendarRedirectUri,
  consentUrl,
  googleConfigured,
} from "@/lib/googleCalendar";

export async function GET(req: Request) {
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?calendar=error&reason=${encodeURIComponent(reason)}`, appBaseUrl(req)));

  const admin = await getAdminUser();
  if (!admin) return back("Only admins can connect the club's Google Calendar.");
  if (!googleConfigured()) {
    return back("Google isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(consentUrl(calendarRedirectUri(req), state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: appBaseUrl(req).startsWith("https:"),
    path: "/api/calendar",
    maxAge: 600,
  });
  return res;
}
