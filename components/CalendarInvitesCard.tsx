"use client";
// /profile's "Calendar invites" card: whether the club's Google Calendar
// invites you to your bookings, and which of your calendars they land on.
// The same two answers TapWorship's profile asks, for the same reasons — see
// lib/calendarInvites.ts.
//
// CONTROLLED: the page owns the two values and saves them as they change,
// like every other field on it (the profile autosaves). What this card owns is the picker's
// own state — the member's calendar list, read from Google with their own
// permission (GET /api/calendar/mine), and whether the address box is open.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import SwitchRow from "@/components/common/SwitchRow";
import {
  INVITE_OTHER_VALUE,
  inviteOptions,
  selectedInviteValue,
  type PickerCalendar,
} from "@/lib/calendarInvites";
import type { ApiMyCalendars } from "@/lib/types";

export default function CalendarInvitesCard({
  accountEmail,
  googleConfigured,
  invites,
  onInvitesChange,
  inviteEmail,
  onInviteEmailChange,
  onInviteEmailBlur,
  inviteError,
}: {
  accountEmail: string;
  googleConfigured: boolean;
  invites: boolean;
  onInvitesChange: (next: boolean) => void;
  /** The address box's text; "" = the account email. */
  inviteEmail: string;
  /** `typed`: from the address box (still being typed) rather than the list. */
  onInviteEmailChange: (next: string, typed: boolean) => void;
  onInviteEmailBlur: () => void;
  /** Why the typed address can't be used yet, once the box is left. */
  inviteError: string | null;
}) {
  // null until asked; [] = asked, and they have none to offer.
  const [calendars, setCalendars] = useState<PickerCalendar[] | null>(null);
  // No permission to list them yet — the button goes via Google's consent.
  const [needsConsent, setNeedsConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  // "Another address…" picked: the box is open until it holds an answer.
  const [other, setOther] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Ask for the list as soon as the card shows invites on. A member who has
  // never granted the permission costs one request that answers
  // `needsConsent`; one who has gets the picker straight away.
  //
  // `?calendarPicker=` is how the consent trip comes back. It's read once and
  // then taken off the address bar so a reload doesn't repeat the message.
  useEffect(() => {
    if (!googleConfigured || !invites) return;
    const status = new URLSearchParams(window.location.search).get("calendarPicker");
    if (status) {
      if (status === "denied") {
        setMessage("Google didn't share your calendar list, so you can type an address instead.");
      } else if (status !== "connected") {
        setMessage("Couldn't reach Google for your calendar list. Try again, or type an address.");
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("calendarPicker");
      window.history.replaceState(null, "", url.toString());
    }
    void loadCalendars();
    // Once when the card turns on — not on every keystroke in the address box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConfigured, invites]);

  /** Fetch the member's own calendars; a missing permission isn't an error. */
  async function loadCalendars() {
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/mine");
      const body = (await res.json().catch(() => null)) as ApiMyCalendars | null;
      if (res.ok && body?.calendars) {
        setCalendars(body.calendars);
        setNeedsConsent(false);
      } else {
        // needsConsent, or Google being down: either way the address box is
        // still the way to answer, and the button offers the consent trip.
        setCalendars(null);
        setNeedsConsent(true);
      }
    } catch {
      setNeedsConsent(true);
    } finally {
      setLoading(false);
    }
  }

  /** A pick in the list. "Another address…" opens the box and saves nothing. */
  function pick(value: string) {
    if (value === INVITE_OTHER_VALUE) {
      setOther(true);
      return;
    }
    setOther(false);
    onInviteEmailChange(value, false);
  }

  const options = inviteOptions(calendars ?? [], accountEmail, inviteEmail || null);
  // `other` is the one state the stored value can't express (the box open on
  // purpose), so it wins over the match.
  const value = other ? INVITE_OTHER_VALUE : selectedInviteValue(options, inviteEmail || null);
  const resolved = inviteEmail.trim() || accountEmail;

  return (
    <Card className="space-y-3" data-testid="calendar-invites">
      <div>
        <h2 className="text-sm font-semibold">Calendar invites</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          When you book an airplane, or a member books a lesson with you, the club&rsquo;s Google
          Calendar invites you to it.
        </p>
      </div>

      <SwitchRow
        checked={invites}
        onChange={onInvitesChange}
        label="Send me calendar invites for my bookings"
      />

      {!invites && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          You won&rsquo;t be invited. Your bookings still show on the airplane&rsquo;s calendar and
          in the app.
        </p>
      )}

      {invites && loading && (
        // A blocking indicator with a label, over where the picker will be.
        <div className="flex min-h-11 items-center gap-2 rounded-lg bg-indigo-50 px-3 text-sm text-gray-600 dark:bg-indigo-900/30 dark:text-gray-300">
          <LoadingDots size="sm" label="Loading your Google calendars" />
          Loading your Google calendars…
        </div>
      )}

      {invites && !loading && (
        <div className="space-y-2">
          {calendars && (
            <Select
              label="Send invites to"
              // A secondary calendar's address runs to fifty-odd characters;
              // the closed box ellipsizes and the line below names it in full.
              className="truncate"
              value={value}
              onChange={(e) => pick(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.value || "default"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          {(!calendars || other) && (
            <Input
              label={calendars ? "Address" : "Send invites to"}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={inviteEmail}
              onChange={(e) => onInviteEmailChange(e.target.value, true)}
              onBlur={onInviteEmailBlur}
              error={inviteError}
              placeholder={accountEmail}
            />
          )}
          {!calendars && googleConfigured && (
            <div>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (needsConsent) {
                    window.location.href = "/api/calendar/mine?connect=1";
                  } else {
                    void loadCalendars();
                  }
                }}
              >
                Choose from my calendars
              </Button>
            </div>
          )}
          {message && <p className="text-xs text-amber-700 dark:text-amber-300">{message}</p>}
          {/* break-words: a calendar id has no space for a browser to break at. */}
          <p className="break-words text-xs text-gray-500 dark:text-gray-400">
            {calendars
              ? `Invites go to ${resolved}. A calendar of its own can be coloured or hidden in Google Calendar.`
              : "Leave this blank to use your account email, or pick one of your own calendars. Choosing asks Google to show the app your calendar list: names only, never your events."}
          </p>
        </div>
      )}
    </Card>
  );
}
