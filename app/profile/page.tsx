"use client";
// Member profile: how to reach you, and the paperwork the club needs to know
// is current. Nothing here is enforced — the app reminds, the pilot decides.
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { useMe } from "@/components/MeProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { sendJson } from "@/lib/api";
import { FLIGHT_REVIEW_MONTHS } from "@/lib/constants";
import { calendarMonthsFrom, formatFullDate, toDateInputValue } from "@/lib/dates";
import type { ApiMe } from "@/lib/types";

export default function ProfilePage() {
  const { me, setMe, refreshMe } = useMe();
  const { update: updateSession } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [certificate, setCertificate] = useState("");
  const [medical, setMedical] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  usePageLoading(me === null);

  // Seed the form from the shared profile once it lands.
  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setPhone(me.phone ?? "");
    setCertificate(me.certificate ?? "");
    setMedical(me.medicalExpiresOn ? toDateInputValue(new Date(me.medicalExpiresOn)) : "");
    setReview(me.flightReviewOn ? toDateInputValue(new Date(me.flightReviewOn)) : "");
  }, [me]);

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    const result = await sendJson<ApiMe>("/api/me", "PATCH", {
      name: name.trim(),
      phone: phone.trim() || null,
      certificate: certificate.trim() || null,
      medicalExpiresOn: medical || null,
      flightReviewOn: review || null,
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not save your profile.");
      return;
    }
    setMe(result.data);
    setSaved(true);
    // Push the new name onto the session so the navbar updates without a
    // re-login.
    await updateSession({ name: result.data.name });
    await refreshMe();
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
      </header>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Contact</h2>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Shown to other members on your bookings, so they can reach you about a swap."
        />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Pilot paperwork</h2>
        <Input
          label="Certificate"
          value={certificate}
          onChange={(e) => setCertificate(e.target.value)}
          placeholder="Private Pilot ASEL"
        />
        <Input
          label="Medical expires"
          type="date"
          value={medical}
          onChange={(e) => setMedical(e.target.value)}
          hint={
            medicalDate
              ? medicalDate < now
                ? "Expired."
                : `Good through ${formatFullDate(medicalDate)}.`
              : "Leave blank if you fly under BasicMed or sport rules."
          }
        />
        <Input
          label="Last flight review"
          type="date"
          value={review}
          onChange={(e) => setReview(e.target.value)}
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

      <div className="space-y-2 pb-2">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Saved.
          </p>
        )}
        <Button size="lg" onClick={save} disabled={busy} className="w-full sm:w-auto">
          {busy ? <LoadingDots size="sm" /> : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
