"use client";
// Runway checkout — the front of N8318B's in-cockpit card.
//
// Passengers, before starting, the cold-start pre-lube, starting, the runup and
// pre-takeoff, bracketed at the end by the club's 5 Ps. It begins where the
// preflight checkout ended (the cabin door) and stops at the hold-short line:
// nothing past that point is tickable, because nothing gets ticked in the air.
// Takeoff/climb/cruise/descent are the read-only card at the foot of this page.
//
// Its own page and its own sign-off rather than a second half of /preflight,
// because the two are walked at different times — often with a fuel stop, a
// passenger, or half an hour in between — and a member who was interrupted
// should never have to re-tick the airplane.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import Textarea from "@/components/common/Textarea";
import CheckoutList from "@/components/CheckoutList";
import InflightReference from "@/components/InflightReference";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { GumpsCard } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import {
  RUNWAY_CHECKOUT,
  initialValues,
  isComplete,
  missingItems,
  type Answers,
  type Values,
} from "@/lib/checkouts";
import { clubDateKey, formatDay } from "@/lib/dates";
import type { ApiCheckout, ApiSquawk } from "@/lib/types";

/**
 * Was this checkout signed off today? The card's "Preflight — complete" item.
 *
 * "Today" means the flying day AT THE FIELD, not on the phone in your hand:
 * this now GATES the runway sign-off, and a member whose device is an hour
 * ahead must not be told that this morning's preflight was yesterday's.
 */
function signedOffToday(run: ApiCheckout | null): boolean {
  if (!run?.completedAt) return false;
  return clubDateKey(run.completedAt) === clubDateKey(new Date());
}

export default function RunwayPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const aircraftId = selected?.id ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  // The card's "Flight timer — start" box opens at the club's current clock
  // (see `initialValues`), typed over if you started earlier.
  const [values, setValues] = useState<Values>(() => initialValues("RUNWAY"));
  const [resetKey, setResetKey] = useState(0);
  const [notes, setNotes] = useState("");
  const [squawkDrafts, setSquawkDrafts] = useState<SquawkDraft[]>([]);
  const [squawkModalOpen, setSquawkModalOpen] = useState(false);
  const [recent, setRecent] = useState<ApiCheckout[] | null>(null);
  const [preflights, setPreflights] = useState<ApiCheckout[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const showSplash = fleetLoading || (selected !== null && recent === null);
  usePageLoading(showSplash);

  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    const [runs, walks] = await Promise.all([
      fetchJsonArray<ApiCheckout>(
        `/api/checkouts?aircraftId=${aircraftId}&kind=RUNWAY&limit=5`
      ),
      fetchJsonArray<ApiCheckout>(
        `/api/checkouts?aircraftId=${aircraftId}&kind=PREFLIGHT&limit=5`
      ),
    ]);
    setRecent(runs);
    setPreflights(walks);
  }, [aircraftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Computed up here rather than beside the row it draws, because the effect
  // below has to run on every render — including the "no airplane yet" one
  // that returns early further down.
  const lastPreflight = preflights.find((r) => r.completedAt) ?? null;
  const preflightDone = signedOffToday(lastPreflight);

  // The app's own answer to "Preflight — complete", written into `answers` so
  // it counts toward the sign-off exactly like a ticked item — and removed
  // again the moment it stops being true. Nothing else may set this id: the
  // list refuses the tap and "Check all" skips it (see CheckoutList's
  // DerivedItem), so this effect is the only writer.
  useEffect(() => {
    setAnswers((current) => {
      if (Boolean(current["start.preflight"]) === preflightDone) return current;
      const next = { ...current };
      if (preflightDone) next["start.preflight"] = true;
      else delete next["start.preflight"];
      return next;
    });
  }, [preflightDone]);

  const complete = isComplete("RUNWAY", answers);
  const anyChecked = Object.keys(answers).length > 0;
  const remaining = useMemo(() => missingItems("RUNWAY", answers), [answers]);

  async function submit(signOff: boolean) {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setBusy(true);

    const result = await sendJson<ApiCheckout>("/api/checkouts", "POST", {
      aircraftId: selected.id,
      kind: "RUNWAY",
      answers,
      values,
      notes: notes.trim() || null,
      complete: signOff,
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      setError(result.error ?? "Could not save the runway checkout.");
      return;
    }

    for (const draft of squawkDrafts) {
      await sendJson<ApiSquawk>("/api/squawks", "POST", {
        aircraftId: selected.id,
        checkoutId: result.data.id,
        title: draft.title,
        description: draft.description || null,
      });
    }

    setBusy(false);
    setSaved(
      signOff
        ? "Runway checkout signed off. Clear prop — have a good flight."
        : "Progress saved — pick it back up any time."
    );

    // A new squawk changes the open count the Status tab shows. It can no
    // longer ground the airplane by itself — only the Safety Officer's triage
    // does that — so this refreshes the count rather than a banner.
    if (squawkDrafts.length > 0) {
      notifyAircraftChanged();
    }

    setAnswers(preflightDone ? { "start.preflight": true } : {});
    setValues(initialValues("RUNWAY"));
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

  // "Preflight — complete" is the card's first before-start item, and the app
  // already knows the answer: a signed-off preflight is a row in the database.
  // So the pilot never ticks it. Done today, it ticks itself; not done, it
  // goes red and links to the page that fixes it, and no amount of tapping
  // (or "Check all") will turn it green.
  //
  // That makes it a genuine gate on the runway sign-off, which the amber card
  // above it never was. The club flies from other fields and an airplane
  // walked at dawn for a 06:00 departure is a real thing — but so is a
  // "complete" preflight nobody did, and of the two, the one worth making
  // impossible is the record that says something untrue.
  const preflightRow = {
    "start.preflight": {
      satisfied: preflightDone,
      message: preflightDone
        ? `Signed off today by ${lastPreflight!.user.name}`
        : lastPreflight
          ? `No preflight signed off today — the last was ${formatDay(
              lastPreflight.completedAt!
            )} by ${lastPreflight.user.name}`
          : "No preflight checkout has been signed off for this airplane",
      href: "/preflight",
      linkLabel: "Walk the preflight",
    },
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Runway</h1>
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

      {/* The card's own first before-start item is "Preflight — complete", so
          answer it here rather than making the member remember. Not a gate:
          the club flies from other fields, and an airplane walked yesterday
          evening for a dawn departure is a real thing that happens. */}
      <Card
        className={
          preflightDone
            ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20"
            : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20"
        }
      >
        <p className="text-sm">
          {preflightDone ? (
            <>
              <span className="font-semibold text-green-800 dark:text-green-200">
                Preflight checkout done today
              </span>
              <span className="text-green-800/80 dark:text-green-200/80">
                {" "}
                — signed off by {lastPreflight!.user.name}.
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold text-amber-900 dark:text-amber-200">
                No preflight checkout signed off today
              </span>
              <span className="text-amber-900/80 dark:text-amber-200/80">
                {lastPreflight
                  ? ` — the last one was ${formatDay(lastPreflight.completedAt!)} by ${
                      lastPreflight.user.name
                    }. Walk the airplane before you start it.`
                  : " — walk the airplane before you start it."}
              </span>
            </>
          )}
        </p>
      </Card>

      <CheckoutList
        checkout={RUNWAY_CHECKOUT}
        answers={answers}
        onChange={setAnswers}
        values={values}
        onValuesChange={setValues}
        derived={preflightRow}
        resetKey={resetKey}
      />

      {/* A runup is where a lot of squawks are actually found — a mag drop out
          of limits, an ammeter that won't charge. File it before you fly. */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Squawks from this checkout</h2>
          <Button variant="secondary" size="sm" onClick={() => setSquawkModalOpen(true)}>
            Report
          </Button>
        </div>
        {squawkDrafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing reported. A mag drop or carb-heat drop outside the card's
            numbers belongs here before you take the runway.
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
                <span className="min-w-0 flex-1 font-medium">{draft.title}</span>
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
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth passing on that isn't a squawk."
        />
      </Card>

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

      {/* The last mnemonic of the rules — not a checkout item because it's
          flown, not walked: you run it on every approach. */}
      <GumpsCard />

      {/* The middle of the card, for reading in the air. Last on the page:
          nothing here is part of any sign-off. */}
      <InflightReference />

      <SquawkDraftModal
        open={squawkModalOpen}
        onClose={() => setSquawkModalOpen(false)}
        onAdd={(draft) => setSquawkDrafts((rows) => [...rows, draft])}
      />
    </div>
  );
}
