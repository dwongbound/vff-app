// Google's answer to ./connect. Checks the `state` cookie, trades the code for
// a refresh token, stores it (sealed — lib/secretBox.ts) as the club's ONE
// Google connection, and sends the admin back to Club settings to pick each
// airplane's calendar.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  STATE_COOKIE,
  appBaseUrl,
  calendarRedirectUri,
  exchangeCode,
  revokeToken,
} from "@/lib/googleCalendar";
import { clubRefreshToken, tokenSecret } from "@/lib/googleCalendarSync";
import { sealBox } from "@/lib/secretBox";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${query}`, appBaseUrl(req)));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
    return res;
  };
  const fail = (reason: string) =>
    done(`calendar=error&reason=${encodeURIComponent(reason)}`);

  const admin = await getAdminUser();
  if (!admin) return fail("Only admins can connect the club's Google Calendar.");

  const cookieState = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  const state = url.searchParams.get("state");
  if (!state || !cookieState || state !== cookieState) {
    return fail("That sign-in link expired or didn't start here. Press Connect again.");
  }

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return fail(
      googleError === "access_denied"
        ? "Google access wasn't granted."
        : `Google said: ${googleError}`
    );
  }
  const code = url.searchParams.get("code");
  if (!code) return fail("Google didn't send a code back.");

  let granted: { refreshToken: string; email: string };
  try {
    granted = await exchangeCode(code, calendarRedirectUri(req));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Google refused the sign-in.");
  }

  // Replacing a connection: let go of the old token at Google too, rather than
  // leaving a live credential nobody is using.
  const previous = await clubRefreshToken().catch(() => null);
  if (previous && previous !== granted.refreshToken) await revokeToken(previous);

  const data = {
    accountEmail: granted.email,
    refreshTokenEnc: sealBox(granted.refreshToken, tokenSecret()),
    connectedById: admin.id,
  };
  await prisma.googleConnection.upsert({
    where: { id: "club" },
    create: { id: "club", ...data },
    update: data,
  });

  return done("calendar=connected");
}
