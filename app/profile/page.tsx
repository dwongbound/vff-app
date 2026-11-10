"use client";
// Member profile: how to reach you, and the paperwork the club needs to know
// is current. Nothing here is enforced — the app reminds, the pilot decides.
// Every field saves itself as it changes; there is no Save button.
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Badge from "@/components/common/Badge";
import AutosaveStatus from "@/components/AutosaveStatus";
import CalendarInvitesCard from "@/components/CalendarInvitesCard";
import Card from "@/components/common/Card";
import DateTimeField from "@/components/common/DateTimeField";
import Input from "@/components/common/Input";
import { useMe } from "@/components/MeProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useAutosave } from "@/components/useAutosave";
import { sendJson } from "@/lib/api";
import { parseInviteEmail } from "@/lib/calendarInvites";
import { FLIGHT_REVIEW_MONTHS } from "@/lib/constants";
import { calendarMonthsFrom, formatFullDate, toDateInputValue } from "@/lib/dates";
import type { ApiMe } from "@/lib/types";

/** What /api/me PATCH takes from this page — any subset of it. */
interface ProfilePatch {
  name: string;
  phone: string | null;
  certificate: string | null;
  totalTimeHours: number | null;
  medicalExpiresOn: string | null;
  flightReviewOn: string | null;
  calendarInvites: boolean;
  calendarInviteEmail: string | null;
}

export default function ProfilePage() {
  const { me, setMe } = useMe();
  const { update: updateSession } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [certificate, setCertificate] = useState("");
  const [totalTime, setTotalTime] = useState("");
  const [medical, setMedical] = useState("");
  const [review, setReview] = useState("");
  // Calendar invites: the switch, and where they go ("" = account email).
  const [calendarInvites, setCalendarInvites] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  // Field problems the page catches itself, so a half-typed value is never
  // sent: a blank name, a total time that isn't hours, a half-typed address.
  const [nameError, setNameError] = useState<string | null>(null);
  const [totalTimeError, setTotalTimeError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // The form is seeded from `me` ONCE. Every save hands back a fresh `me`, and
  // re-seeding from it would overwrite whatever was typed while it was in flight.
  const seeded = useRef(false);

  usePageLoading(me === null);

  useEffect(() => {
    if (!me || seeded.current) return;
    seeded.current = true;
    setName(me.name);
    setPhone(me.phone ?? "");
    setCertificate(me.certificate ?? "");
    setTotalTime(me.totalTimeHours == null ? "" : String(me.totalTimeHours));
    setMedical(me.medicalExpiresOn ? toDateInputValue(new Date(me.medicalExpiresOn)) : "");
    setReview(me.flightReviewOn ? toDateInputValue(new Date(me.flightReviewOn)) : "");
    setCalendarInvites(me.calendarInvites);
    setInviteEmail(me.calendarInviteEmail ?? "");
  }, [me]);

  // There is no Save button: every field saves itself (lib/autosave.ts).
  const autosave = useAutosave<ProfilePatch>(
    async (patch) => {
      const result = await sendJson<ApiMe>("/api/me", "PATCH", patch);
      if (!result.ok || !result.data) {
        return { ok: false, error: result.error ?? "Couldn't save that change." };
      }
      setMe(result.data);
      // Push a new name onto the session so the navbar shows it without a
      // re-login.
      if ("name" in patch) await updateSession({ name: result.data.name });
      return { ok: true };
    },
    {
      // Closing the tab mid-edit: keepalive outlives the page.
      beacon: (patch) => {
        void fetch("/api/me", {
          method: "PATCH",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }).catch(() => undefined);
      },
    }
  );

  /** Name: never blank, so a cleared box waits rather than saving. */
  function changeName(value: string) {
    setName(value);
    if (!value.trim()) {
      setNameError("Your name can't be blank.");
      return;
    }
    setNameError(null);
    autosave.queue({ name: value.trim() });
  }

  /** Total time: blank clears it; anything else has to be hours. */
  function changeTotalTime(value: string) {
    setTotalTime(value);
    const hours = Number(value);
    if (value !== "" && (!Number.isFinite(hours) || hours < 0)) {
      setTotalTimeError("Total time has to be a number of hours.");
      return;
    }
    setTotalTimeError(null);
    autosave.queue({ totalTimeHours: value === "" ? null : hours });
  }

  /**
   * The invite address. A pick from the list saves straight away; a typed one
   * saves once it's an address (or blank, which means the account email) —
   * until then nothing is sent, and leaving the box says why.
   */
  function changeInviteEmail(value: string, typed: boolean) {
    setInviteEmail(value);
    const parsed = parseInviteEmail(value, me?.email ?? null);
    if ("error" in parsed) return;
    setInviteError(null);
    autosave.queue({ calendarInviteEmail: parsed.value }, { immediate: !typed });
  }

  function leaveInviteEmail() {
    const parsed = parseInviteEmail(inviteEmail, me?.email ?? null);
    setInviteError("error" in parsed ? parsed.error : null);
  }

  if (!me) return null;

  // Currency, computed the way the regs count it: through the last day of the
  // 24th calendar month after the review.
  const reviewDueOn = calendarMonthsFrom(review || null, FLIGHT_REVIEW_MONTHS);
  const medicalDate = medical ? new Date(`${medical}T12:00:00`) : null;
  const now = new Date();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Your profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {me.email}
          {me.isAdmin && (
            <>
              {" · "}
              <span className="font-medium text-indigo-600 dark:text-indigo-400">
                club admin
              </span>
            </>
          )}
        </p>
        <AutosaveStatus state={autosave.state} />
      </header>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Contact</h2>
        <Input
          label="Name"
          value={name}
          onChange={(e) => changeName(e.target.value)}
          error={nameError}
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            autosave.queue({ phone: e.target.value.trim() || null });
          }}
          hint="Shown to other members on your bookings, so they can reach you about a swap."
        />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Pilot paperwork</h2>
        <Input
          label="Certificate"
          value={certificate}
          onChange={(e) => {
            setCertificate(e.target.value);
            autosave.queue({ certificate: e.target.value.trim() || null });
          }}
          placeholder="Private Pilot ASEL"
        />
        <Input
          label="Total flight time"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          value={totalTime}
          onChange={(e) => changeTotalTime(e.target.value)}
          error={totalTimeError}
          hint="Hours from your own logbook. The club can't see it, and it decides which column of the operating rules applies to you."
        />
        <DateTimeField
          label="Medical expires"
          mode="date"
          value={medical}
          onChange={(value) => {
            setMedical(value);
            autosave.queue({ medicalExpiresOn: value || null }, { immediate: true });
          }}
          hint={
            medicalDate
              ? medicalDate < now
                ? "Expired."
                : `Good through ${formatFullDate(medicalDate)}.`
              : "Leave blank if you fly under BasicMed or sport rules."
          }
        />
        <DateTimeField
          label="Last flight review"
          mode="date"
          // A review you took in the future isn't a review.
          max={toDateInputValue(new Date())}
          value={review}
          onChange={(value) => {
            setReview(value);
            autosave.queue({ flightReviewOn: value || null }, { immediate: true });
          }}
          hint={
            reviewDueOn
              ? `Current through ${formatFullDate(reviewDueOn)} (${FLIGHT_REVIEW_MONTHS} calendar months).`
              : undefined
          }
        />

        {/* The two statuses at a glance, since that's what you came to check. */}
        <div className="flex flex-wrap gap-2">
          {medicalDate && (
            <Badge tone={medicalDate < now ? "red" : "green"}>
              Medical {medicalDate < now ? "expired" : "current"}
            </Badge>
          )}
          {reviewDueOn && (
            <Badge tone={reviewDueOn < now ? "red" : "green"}>
              Flight review {reviewDueOn < now ? "due" : "current"}
            </Badge>
          )}
        </div>
      </Card>

      <CalendarInvitesCard
        accountEmail={me.email ?? ""}
        googleConfigured={me.googleConfigured}
        invites={calendarInvites}
        onInvitesChange={(next) => {
          setCalendarInvites(next);
          autosave.queue({ calendarInvites: next }, { immediate: true });
        }}
        inviteEmail={inviteEmail}
        onInviteEmailChange={changeInviteEmail}
        onInviteEmailBlur={leaveInviteEmail}
        inviteError={inviteError}
      />

    </div>
  );
}
