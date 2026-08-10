"use client";
// Preflight checkout — N8318B's preflight card, walked and signed for.
//
// Homework, consumables, cockpit, then the walk: left wing → nose → right wing
// → tail, and the standard weather briefing. It ends at the cabin door; what
// happens once you're sitting in it is the runway checkout (/runway).
//
// The card itself lives in lib/checkouts.ts and the tick rows are rendered by
// CheckoutList, which the runway page shares. What's specific to this page is
// everything AROUND the card: the club's limits for this member, the open
// squawks, what the walkaround found (fuel and oil), and any squawks it raised.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Textarea from "@/components/common/Textarea";
import CheckoutList from "@/components/CheckoutList";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { MyLimitsCard } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import {
  PREFLIGHT_CHECKOUT,
  isComplete,
  deriveFuelOil,
  initialValues,
  missingItems,
  type Answers,
  type Values,
} from "@/lib/checkouts";
import { formatDay } from "@/lib/dates";
import { SQUAWK_STATUS_SHORT, SQUAWK_STATUS_TONES } from "@/lib/squawks";
import { soloEligibility } from "@/lib/operatingRules";
import { useMe } from "@/components/MeProvider";
import type { ApiCheckout, ApiFlight, ApiSquawk } from "@/lib/types";

export default function PreflightPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  // Fetches key off the ID, not the aircraft object: the provider hands back a
  // fresh object on every refresh, so depending on it would re-run this page's
  // queries every time anyone touched a squawk.
  const aircraftId = selected?.id ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  // Seeded rather than empty: the card's time field starts at the club's
  // current clock (see `initialValues`), which the pilot can type over.
  const [values, setValues] = useState<Values>(() => initialValues("PREFLIGHT"));
  const [resetKey, setResetKey] = useState(0);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [squawkDrafts, setSquawkDrafts] = useState<SquawkDraft[]>([]);
  const [squawkModalOpen, setSquawkModalOpen] = useState(false);
  const [recent, setRecent] = useState<ApiCheckout[] | null>(null);
  const [openSquawks, setOpenSquawks] = useState<ApiSquawk[]>([]);
  // My own flights, for the experience/currency half of the operating rules.
  const [myFlights, setMyFlights] = useState<ApiFlight[]>([]);
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // See the reservations page for why this isn't just `recent === null`.
  const showSplash = fleetLoading || (selected !== null && recent === null);
  usePageLoading(showSplash);

  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    // All three are always shown together, so they go out together rather
    // than one after the other.
    const [runs, squawks, flights] = await Promise.all([
      fetchJsonArray<ApiCheckout>(
        `/api/checkouts?aircraftId=${aircraftId}&kind=PREFLIGHT&limit=5`
      ),
      fetchJsonArray<ApiSquawk>(`/api/squawks?aircraftId=${aircraftId}&status=open`),
      fetchJsonArray<ApiFlight>(`/api/flights?aircraftId=${aircraftId}&mine=1&limit=300`),
    ]);
    setRecent(runs);
    setOpenSquawks(squawks);
    setMyFlights(flights);
  }, [aircraftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Prefill the meters from where the last filed flight left the airplane, so
  // the common case is confirming two numbers rather than typing them. Only
  // fills a field that is EMPTY: it must never overwrite a reading the pilot
  // has already corrected against the panel, and `resetKey` is what lets it
  // seed the next run after a sign-off cleared them.
  const lastTach = selected?.lastTach ?? null;
  const lastHobbs = selected?.lastHobbs ?? null;
  useEffect(() => {
    setValues((current) => {
      const next = { ...current };
      if (next["cockpit.meters.tach"] == null && lastTach != null) {
        next["cockpit.meters.tach"] = lastTach;
      }
      if (next["cockpit.meters.hobbs"] == null && lastHobbs != null) {
        next["cockpit.meters.hobbs"] = lastHobbs;
      }
      return next;
    });
  }, [lastTach, lastHobbs, resetKey]);

  // Solo or instructor? The club's rules answer that from the member's
  // declared total time plus this club's log — see lib/operatingRules.
  const eligibility = soloEligibility({
    totalTimeHours: me?.totalTimeHours ?? null,
    flights: myFlights,
  });

  const complete = isComplete("PREFLIGHT", answers);
  const anyChecked = Object.keys(answers).length > 0;
  const remaining = useMemo(() => missingItems("PREFLIGHT", answers), [answers]);
  // Echoed back below the card so the two figures Plane Status depends on are
  // visible before you sign off, without asking for them a second time.
  const fuelOil = useMemo(() => deriveFuelOil(values), [values]);

  async function submit(signOff: boolean) {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setBusy(true);

    const result = await sendJson<ApiCheckout>("/api/checkouts", "POST", {
      aircraftId: selected.id,
      kind: "PREFLIGHT",
      answers,
      // Fuel and oil are no longer asked for twice: they're recorded on the
      // consumables items, and the API derives the columns from those (it
      // re-derives server-side too — this is not the client's decision).
      values,
      notes: notes.trim() || null,
      complete: signOff,
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      setError(result.error ?? "Could not save the preflight checkout.");
      return;
    }

    const checkoutId = result.data.id;

    // Photos and squawks both need the row's id, so they go up after it.
    if (photos.length) {
      await uploadPhotos(photos, "checkout", checkoutId);
    }
    for (const draft of squawkDrafts) {
      const squawk = await sendJson<ApiSquawk>("/api/squawks", "POST", {
        aircraftId: selected.id,
        checkoutId,
        title: draft.title,
        description: draft.description || null,
      });
      if (squawk.ok && squawk.data && draft.photos.length) {
        await uploadPhotos(draft.photos, "squawk", squawk.data.id);
      }
    }

    setBusy(false);
    setSaved(
      signOff
        ? "Preflight checkout signed off. Next: the runway checkout, once you're sitting in it."
        : "Progress saved — pick it back up any time."
    );

    // A new squawk changes the open count the Status tab shows. It can no
    // longer ground the airplane by itself — only the Safety Officer's triage
    // does that — so this refreshes the count rather than a banner.
    if (squawkDrafts.length > 0) {
      notifyAircraftChanged();
    }

    // Start clean for the next run — clean meaning "a fresh card", which
    // includes a fresh clock reading rather than the one from the run that
    // was just signed off.
    setAnswers({});
    setValues(initialValues("PREFLIGHT"));
    setPhotos([]);
    setSquawkDrafts([]);
    setNotes("");
    setResetKey((k) => k + 1);
    await refresh();
  }

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — seed one with{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">
            npm run db:seed
          </code>
          .
        </p>
      </Card>
    );
  }

  const lastRun = recent?.find((r) => r.completedAt) ?? null;

  // What the dipstick said last time somebody looked, shown under the oil box.
  //
  // Oil is the one consumable where the PREVIOUS reading is the useful part:
  // it goes down slowly, so "6 quarts on Tuesday" tells you whether today's
  // 5 is normal consumption or a leak. Fuel gets no equivalent hint — it
  // changes every flight, so last week's number is noise.
  //
  // Deliberately a hint and not a prefill: the number in the box has to be one
  // somebody read off the stick today.
  const lastOilRun = recent?.find((r) => r.oilQuarts != null) ?? null;
  const fieldHints = lastOilRun
    ? {
        "consumables.oil.qts": `Last recorded ${lastOilRun.oilQuarts} qts on ${formatDay(
          lastOilRun.createdAt
        )} by ${lastOilRun.user.name}`,
      }
    : undefined;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Preflight</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber} · {selected.model}
          {lastRun && (
            <>
              {" · last signed off "}
              {formatDay(lastRun.completedAt!)} by {lastRun.user.name}
            </>
          )}
        </p>
      </header>

      {/* The club's limits for THIS member, before anything else — they decide
          whether the flight happens at all. */}
      <MyLimitsCard
        eligibility={eligibility}
        totalTimeHours={me?.totalTimeHours ?? null}
      />

      {/* Open squawks up top: knowing what's already wrong changes what you
          look at on the walk. */}
      {openSquawks.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Open squawks</h2>
          {eligibility.tier === "BUILDING" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Club rules: call the VFF Safety Officer to discuss before flying
              with an open squawk.
            </p>
          )}
          <ul className="space-y-1.5">
            {openSquawks.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <Badge tone={SQUAWK_STATUS_TONES[s.status]}>
                  {SQUAWK_STATUS_SHORT[s.status]}
                </Badge>
                <span className="min-w-0">
                  <span className="font-medium">{s.title}</span>
                  {s.description && (
                    <span className="text-gray-500 dark:text-gray-400"> — {s.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CheckoutList
        checkout={PREFLIGHT_CHECKOUT}
        answers={answers}
        onChange={setAnswers}
        values={values}
        onValuesChange={setValues}
        hints={fieldHints}
        resetKey={resetKey}
      />

      {/* Fuel and oil used to be re-typed here, under "What you found", after
          already being ticked off on the consumables items. Two places to put
          one number is how a reading gets transcribed wrong, so they're now
          recorded on the items themselves and this card keeps only what has
          nowhere else to live. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Anything else</h2>
        {fuelOil.fuelOnBoardGal != null || fuelOil.oilQuarts != null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Recorded on the walk:{" "}
            {fuelOil.fuelOnBoardGal != null && (
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {fuelOil.fuelOnBoardGal} gal
                {selected.fuelCapacityGal
                  ? ` of ${selected.fuelCapacityGal}`
                  : ""}
              </span>
            )}
            {fuelOil.fuelOnBoardGal != null && fuelOil.oilQuarts != null && " · "}
            {fuelOil.oilQuarts != null && (
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {fuelOil.oilQuarts} qts oil
              </span>
            )}
            .
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Fuel and oil are recorded on the Consumables items above — they feed
            the Plane Status tab.
          </p>
        )}
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth passing on that isn't a squawk."
        />
        <PhotoUploader
          files={photos}
          onChange={setPhotos}
          hint="Optional — fuel state, oil level, anything you want on record."
        />
      </Card>

      {/* Squawks raised during this walk, filed when you submit. */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Squawks from this checkout</h2>
          <Button variant="secondary" size="sm" onClick={() => setSquawkModalOpen(true)}>
            Report
          </Button>
        </div>
        {squawkDrafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing reported. Anything you find here gets filed against this
            checkout when you submit.
          </p>
        ) : (
          <ul className="space-y-2">
            {squawkDrafts.map((draft, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                {/* A draft has no status yet — it becomes "New" on submit. */}
                <Badge tone="amber">New</Badge>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{draft.title}</span>
                  {draft.photos.length > 0 && (
                    <span className="ml-2 text-xs text-gray-500">
                      {draft.photos.length} photo{draft.photos.length > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
                <button
                  onClick={() =>
                    setSquawkDrafts((rows) => rows.filter((_, index) => index !== i))
                  }
                  aria-label={`Remove ${draft.title}`}
                  className="text-gray-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Submit. "Sign off" is gated on a complete checkout and says exactly
          what's missing when it isn't — never a silently disabled button. */}
      <div className="space-y-2 pb-2">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            {saved}
          </p>
        )}
        {!complete && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {remaining.length} item{remaining.length === 1 ? "" : "s"} left, starting
            with <span className="font-medium">{remaining[0]?.label}</span>.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="lg"
            onClick={() => submit(true)}
            disabled={busy || !complete}
            className="w-full sm:w-auto"
          >
            {busy ? <LoadingDots size="sm" /> : "Sign off"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => submit(false)}
            disabled={busy || !anyChecked}
            className="w-full sm:w-auto"
          >
            Save
          </Button>
        </div>
      </div>

      <SquawkDraftModal
        open={squawkModalOpen}
        onClose={() => setSquawkModalOpen(false)}
        onAdd={(draft) => setSquawkDrafts((rows) => [...rows, draft])}
      />
    </div>
  );
}
