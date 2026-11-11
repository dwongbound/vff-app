// Google's OAuth + Calendar REST API, by hand with fetch — the same call as
// lib/storage/s3.ts: the handful of endpoints this needs are smaller than the
// SDK's install, and every request is visible here.
//
// Uses the SAME OAuth client as "Continue with Google" (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET), but through its own consent flow: sign-in asks only
// for a name and an email, while this asks ONE admin, once, for the calendar.
// See app/api/calendar/connect.
//
// Server-only.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/**
 * `calendar.events` is the narrowest scope that can write to a calendar the
 * account doesn't OWN — the club's N8318B calendar is shared to members as
 * writers. The calendar-list scope is only so Club settings can offer a
 * picker instead of asking an admin to paste a calendar id.
 */
const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

/**
 * What a MEMBER is asked for by /profile's invite picker: the names and ids of
 * their own calendars, nothing more. `calendar.calendarlist.readonly` is NOT
 * one of Google's sensitive scopes (only the events scopes are), so this trip
 * shows no unverified-app warning and needs no verification of its own.
 */
export const LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const MEMBER_LIST_SCOPES = ["openid", "email", LIST_SCOPE];

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * What "Continue with Google" asks for. Sign-in itself needs only openid +
 * email + profile; the calendar LIST rides along so a member who signs in with
 * Google gets the /profile picker straight away, with no second consent trip.
 * It's the same non-sensitive scope the picker's own trip asks for, so sign-in
 * gains no warning. `access_type: offline` is what makes Google hand back a
 * refresh token the first time the member agrees to it (Google sends one only
 * on a consent screen, so a later sign-in leaves the stored one in place).
 * No `prompt: consent` here: that would show the consent screen at EVERY
 * sign-in.
 */
export const GOOGLE_SIGN_IN_PARAMS = {
  scope: ["openid", "email", "profile", LIST_SCOPE].join(" "),
  access_type: "offline",
  include_granted_scopes: "true",
} as const;

/**
 * Whether a token Google issued at sign-in carries the calendar list. Google
 * lets a person untick the box, and the sign-in still has to work if they do.
 */
export function grantsListScope(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(LIST_SCOPE);
}

/** The one-time OAuth `state`, between ./connect and ./callback. */
export const STATE_COOKIE = "vff-calendar-oauth-state";

/**
 * A `state` that starts with this is a member's picker trip rather than the
 * club's connection. Both share the ONE redirect URI already registered on the
 * OAuth client (/api/calendar/callback), so adding the picker needed no change
 * in Google Cloud; the callback tells them apart by this prefix, and the cookie
 * check is what stops anyone forging either.
 */
export const MEMBER_STATE_PREFIX = "me.";

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The app's PUBLIC address, for every redirect this flow sends a browser to.
 *
 * Never `req.url` on its own: behind Docker (or any proxy) that's the server's
 * own view of itself — `http://0.0.0.0:3000` in the dev container, whose port
 * on the host is 3001 — and a redirect built from it lands the admin on some
 * other app. NEXTAUTH_URL is the configured answer; the forwarded headers are
 * the fallback for a deployment that doesn't set it.
 */
export function appBaseUrl(req: Request): string {
  if (process.env.NEXTAUTH_URL) return new URL(process.env.NEXTAUTH_URL).origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/**
 * Where Google sends the admin back to. Must be byte-identical between the
 * consent URL and the code exchange, and listed on the OAuth client.
 */
export function calendarRedirectUri(req: Request): string {
  return new URL("/api/calendar/callback", appBaseUrl(req)).toString();
}

/**
 * Google's consent screen. `member` asks for the calendar LIST only (the
 * /profile picker); otherwise it's the club connection's write access.
 */
export function consentUrl(redirectUri: string, state: string, member = false): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: (member ? MEMBER_LIST_SCOPES : CALENDAR_SCOPES).join(" "),
    // offline + consent is what makes Google hand back a REFRESH token every
    // time, including for an account that connected before.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/**
 * The code from the callback → a refresh token and the account's email.
 * `requiredScope` is the one permission the trip was FOR — Google lets a
 * person untick boxes, so a token without it is refused here rather than
 * stored and failing later.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  requiredScope: string = EVENTS_SCOPE
): Promise<{ refreshToken: string; email: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json().catch(() => null)) as Record<string, string> | null;
  if (!res.ok || !data) {
    throw new GoogleError(
      `Google refused the sign-in (${data?.error_description ?? data?.error ?? res.status}).`,
      res.status
    );
  }
  if (!data.refresh_token) {
    throw new GoogleError(
      "Google didn't hand back offline access. Remove the app from the account's Google permissions and connect again.",
      null
    );
  }
  const scopes = (data.scope ?? "").split(" ");
  if (!scopes.includes(requiredScope)) {
    throw new GoogleError(
      "Calendar access wasn't granted — tick the calendar box on Google's consent screen.",
      null
    );
  }
  return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) ?? "" };
}

/**
 * The email claim from an id_token. Not signature-checked, and doesn't need to
 * be: it came straight from Google's token endpoint over TLS in answer to our
 * own client secret, and it's only ever DISPLAYED ("connected as …").
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}

// Access tokens per warm server instance, keyed by the refresh token each came
// from so a reconnect can't keep using the old account's. A map rather than one
// slot now that members' picker tokens pass through here too — one member
// opening /profile must not evict the club's token mid-sync. Bounded, oldest
// first, since every member who ever opens the picker adds a key.
const cache = new Map<string, { accessToken: string; expiresAt: number }>();
const CACHE_MAX = 50;

/**
 * A short-lived access token for API calls, minted from the stored refresh
 * token and reused until a minute before it expires.
 */
async function accessToken(refreshToken: string): Promise<string> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.accessToken;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || typeof data.access_token !== "string") {
    cache.delete(refreshToken);
    // invalid_grant is the one that needs a person: the token was revoked, the
    // account lost access, or the OAuth app is still in "Testing" (whose
    // refresh tokens die after seven days).
    if (data?.error === "invalid_grant") {
      throw new GoogleError(
        "Google no longer accepts the club's calendar connection. An admin needs to reconnect it in Club settings.",
        401
      );
    }
    throw new GoogleError(`Couldn't reach Google Calendar (${res.status}).`, res.status);
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

/**
 * One authenticated Calendar API request. Throws GoogleError with Google's own
 * message on any non-2xx, so the routes can show it as-is.
 */
async function call<T>(
  refreshToken: string,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const token = await accessToken(refreshToken);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
    throw new GoogleError(`Google Calendar: ${message}`, res.status);
  }
  return data as T;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
}

/** Every calendar the connected account can WRITE to. */
export async function listWritableCalendars(
  refreshToken: string
): Promise<GoogleCalendarListEntry[]> {
  const out: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      refreshToken,
      "/users/me/calendarList",
      { query: { minAccessRole: "writer", ...(pageToken ? { pageToken } : {}) } }
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * A MEMBER's own calendars, for the /profile invite picker: every calendar on
 * their list they could put an event on (writer or owner — a read-only
 * subscription like "US Holidays" can't take an invite), primary first.
 */
export async function listOwnCalendars(
  refreshToken: string
): Promise<{ id: string; name: string; primary: boolean }[]> {
  const out: { id: string; name: string; primary: boolean }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{
      items?: (GoogleCalendarListEntry & { primary?: boolean; summaryOverride?: string })[];
      nextPageToken?: string;
    }>(refreshToken, "/users/me/calendarList", {
      query: { minAccessRole: "writer", ...(pageToken ? { pageToken } : {}) },
    });
    for (const c of page.items ?? []) {
      // summaryOverride is the name the member gave a calendar on THEIR list,
      // which is the name they'll recognise.
      out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => Number(b.primary) - Number(a.primary));
}

const enc = encodeURIComponent;

export interface EventsPage<E> {
  items?: E[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * One page of a calendar's events. With `syncToken`, only what changed since
 * (deletions included, as `status: "cancelled"`); without, everything — and
 * the last page of a full listing carries the token for next time.
 * A stale token is a 410, which the caller answers with a full listing.
 */
export function listEventsPage<E>(
  refreshToken: string,
  calendarId: string,
  opts: { syncToken?: string | null; pageToken?: string }
): Promise<EventsPage<E>> {
  return call<EventsPage<E>>(refreshToken, `/calendars/${enc(calendarId)}/events`, {
    query: {
      // Recurring events arrive as their individual instances, each with its
      // own id — a weekly lesson is many bookings, not one.
      singleEvents: "true",
      maxResults: "250",
      ...(opts.syncToken ? { syncToken: opts.syncToken } : {}),
      ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    },
  });
}

export function getEvent<E>(refreshToken: string, calendarId: string, eventId: string) {
  return call<E>(refreshToken, `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
}

/**
 * Who Google emails about a write: "all" invites/updates every guest, "none"
 * changes the event silently. Without it Google emails nobody — guests on a
 * non-Gmail address would never hear they were invited.
 */
export type SendUpdates = "all" | "none";

export function insertEvent<E>(
  refreshToken: string,
  calendarId: string,
  body: unknown,
  sendUpdates: SendUpdates = "none"
) {
  return call<E>(refreshToken, `/calendars/${enc(calendarId)}/events`, {
    method: "POST",
    body,
    query: { sendUpdates },
  });
}

export function patchEvent<E>(
  refreshToken: string,
  calendarId: string,
  eventId: string,
  body: unknown,
  sendUpdates: SendUpdates = "none"
) {
  return call<E>(refreshToken, `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
    method: "PATCH",
    body,
    query: { sendUpdates },
  });
}
