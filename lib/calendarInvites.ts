// A member's calendar-invite preferences, as pure rules (unit-tested in
// tests/unit/calendarInvites.test.ts). The same two answers TapWorship asks
// on its profile page, for the same reasons:
//
//   - `calendarInvites`: do I want my bookings on my calendar at all? Off
//     takes the member off the GUEST LIST only — the booking itself is
//     untouched.
//   - `calendarInviteEmail`: where do they go? Google puts an invite on the
//     default calendar of whatever ADDRESS it was sent to, and a guest can't
//     move an invited event afterwards. A secondary Google calendar's id IS an
//     address, so choosing a calendar and typing an address are the same act:
//     the /profile picker is the list, the address box the way out of it.
//
// No prisma, no fetch: the db half is `googleCalendarSync.ts`, the Google half
// `googleCalendar.ts`, and the page imports the picker rules from here.

/** The columns a guest-list decision needs, off a User row. */
export interface InvitePrefs {
  email: string | null;
  calendarInvites: boolean;
  calendarInviteEmail: string | null;
}

/** Trimmed and lower-cased, or null for nothing usable. */
function normalizeEmail(e: string | null | undefined): string | null {
  const t = e?.trim().toLowerCase();
  return t ? t : null;
}

/**
 * The ONE address a member's booking invites go to, or null for "don't invite
 * them". Every guest list the app writes reads it, so a member who switched
 * invites off can't be added back by a path that forgot to ask.
 */
export function inviteAddress(user: InvitePrefs | null | undefined): string | null {
  if (!user || !user.calendarInvites) return null;
  return normalizeEmail(user.calendarInviteEmail) ?? normalizeEmail(user.email);
}

/**
 * The addresses of this member the app may have invited BEFORE and no longer
 * wants on the event: the account email and the saved override, minus the one
 * in force. A PATCH drops them, which is how switching invites off — or
 * pointing them at another calendar — takes effect on a booking the next time
 * it's written, rather than leaving the old copy on the old calendar forever.
 *
 * Only addresses the app itself knows belong to this member: a passenger
 * somebody typed into the event in Google is never in this list.
 */
export function staleInviteAddresses(user: InvitePrefs | null | undefined): string[] {
  if (!user) return [];
  const current = inviteAddress(user);
  const all = [normalizeEmail(user.email), normalizeEmail(user.calendarInviteEmail)];
  return [...new Set(all.filter((e): e is string => !!e && e !== current))];
}

/**
 * A member's own Google calendar, as the picker draws it. Declared here (not
 * in googleCalendar.ts) so the client page can take the list without importing
 * a server module.
 */
export interface PickerCalendar {
  id: string;
  name: string;
  primary: boolean;
}

/** The option that means "my account email", which is what null stores. */
export const INVITE_DEFAULT_VALUE = "";

/**
 * The option that opens the address box. Picking it saves NOTHING: it isn't an
 * answer yet, so the invites keep going where they were until the box is filled.
 * It's the only way to a calendar the list can't offer — one somebody else owns
 * and shared, or one on a different Google account.
 */
export const INVITE_OTHER_VALUE = "__other__";

export interface InviteOption {
  value: string;
  label: string;
}

/**
 * The picker's options, in order: the account email first (the default), then
 * the member's own calendars, then — if something else is saved — that, then
 * "Another address…".
 *
 * The PRIMARY calendar is listed only when its address differs from the
 * account email: a member who signs in here with one address and keeps their
 * Google calendar on another needs it, but for everyone else it's a second
 * option meaning exactly what the default already means.
 *
 * A saved address no calendar answers to keeps an option of its own, so the
 * picker shows what is actually in force — an address typed by hand, or a
 * calendar since deleted. Showing the default there would be a lie.
 */
export function inviteOptions(
  calendars: PickerCalendar[],
  accountEmail: string,
  saved: string | null
): InviteOption[] {
  const account = accountEmail.trim();
  const out: InviteOption[] = [
    {
      value: INVITE_DEFAULT_VALUE,
      label: account ? `My account email (${account})` : "My account email",
    },
  ];
  const seen = new Set<string>([account.toLowerCase()]);
  for (const cal of calendars) {
    const key = cal.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      value: cal.id,
      label: cal.primary ? `${cal.name} (main calendar)` : cal.name,
    });
  }
  const current = (saved ?? "").trim();
  if (current && !seen.has(current.toLowerCase())) {
    out.push({ value: current, label: current });
  }
  out.push({ value: INVITE_OTHER_VALUE, label: "Another address…" });
  return out;
}

/** Which option a stored value selects. Nothing stored = the default. */
export function selectedInviteValue(options: InviteOption[], saved: string | null): string {
  const current = (saved ?? "").trim();
  if (!current) return INVITE_DEFAULT_VALUE;
  const hit = options.find(
    (o) => o.value !== INVITE_OTHER_VALUE && o.value.toLowerCase() === current.toLowerCase()
  );
  return hit ? hit.value : INVITE_OTHER_VALUE;
}

// Deliberately loose: one "@" with something either side and no spaces. A
// secondary calendar's address (`abc…@group.calendar.google.com`) passes, and
// Google is the real judge of whether an address takes invites.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The PATCH body's `calendarInviteEmail`, as the value to store: null for blank
 * (= the account email) and for the account email itself, so typing your own
 * address in doesn't leave an override that stops following the account.
 * `{ error }` for something that isn't an address.
 */
export function parseInviteEmail(
  raw: unknown,
  accountEmail: string | null
): { value: string | null } | { error: string } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== "string") return { error: "The invite address has to be an email address." };
  const value = raw.trim();
  if (!value) return { value: null };
  if (!EMAIL_SHAPE.test(value)) {
    return { error: "The invite address has to be an email address." };
  }
  if (value.toLowerCase() === normalizeEmail(accountEmail)) return { value: null };
  return { value };
}
