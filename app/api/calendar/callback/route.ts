// Google's answer to ./connect. Checks the `state` cookie, trades the code for
// a refresh token, stores it (sealed — lib/secretBox.ts) as the club's ONE
// Google connection, and sends the admin back to Club settings to pick each
// airplane's calendar.
//
// It is ALSO the answer to ./mine?connect=1 — a member's own permission to
// list their calendars for /profile's invite picker — told apart by the
// state's MEMBER_STATE_PREFIX. One redirect URI for both means the OAuth
// client in Google Cloud needed no new entry.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser, getSessionUser } from "@/lib/auth";
import {
  LIST_SCOPE,
  MEMBER_STATE_PREFIX,
  STATE_COOKIE,
  appBaseUrl,
  calendarRedirectUri,
  exchangeCode,
  revokeToken,
} from "@/lib/googleCalendar";
import { clubRefreshToken, tokenSecret } from "@/lib/googleCalendarSync";
import { openBox, sealBox } from "@/lib/secretBox";

/** The state cookie's value off a request, if any. */
function stateCookie(req: Request): string | undefined {
  return req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
}

/**
 * A member's picker trip: store their list permission (sealed) and send them
 * back to /profile, whose picker reads `?calendarPicker=` to say how it went.
 */
async function memberCallback(req: Request, url: URL): Promise<NextResponse> {
  const done = (status: string) => {
    const res = NextResponse.redirect(
      new URL(`/profile?calendarPicker=${status}`, appBaseUrl(req))
    );
    res.cookies.set(STATE_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
    return res;
  };
  const me = await getSessionUser();
  if (!me) return done("error");
  const state = url.searchParams.get("state");
  const cookieState = stateCookie(req);
  if (!state || !cookieState || state !== cookieState) return done("error");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code) return done("error");

  let granted: { refreshToken: string };
  try {
    granted = await exchangeCode(code, calendarRedirectUri(req), LIST_SCOPE);
  } catch {
    // Most often the member unticked the calendar box on the consent screen.
    return done("denied");
  }
  const previous = await prisma.user.findUnique({
    where: { id: me.id },
    select: { googleListTokenEnc: true },
  });
  await prisma.user.update({
    where: { id: me.id },
    data: { googleListTokenEnc: sealBox(granted.refreshToken, tokenSecret()) },
  });
  // A second trip replaces the first; let go of the old token at Google too.
  const old = previous?.googleListTokenEnc ? openBox(previous.googleListTokenEnc, tokenSecret()) : null;
  if (old && old !== granted.refreshToken) await revokeToken(old);
  return done("connected");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("state")?.startsWith(MEMBER_STATE_PREFIX)) {
    return memberCallback(req, url);
  }
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${query}`, appBaseUrl(req)));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
    return res;
  };
  const fail = (reason: string) =>
    done(`calendar=error&reason=${encodeURIComponent(reason)}`);

  const admin = await getAdminUser();
  if (!admin) return fail("Only admins can connect the club's Google Calendar.");

  const cookieState = stateCookie(req);
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
