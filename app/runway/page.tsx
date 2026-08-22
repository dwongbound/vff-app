"use client";
// Taxi & Runway checkout — the front of N8318B's in-cockpit card.
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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Textarea from "@/components/common/Textarea";
import CheckoutList from "@/components/CheckoutList";
import CheckoutDraftBar from "@/components/CheckoutDraftBar";
import CompleteCheckoutButton from "@/components/CompleteCheckoutButton";
import { useCheckoutDraft } from "@/components/useCheckoutDraft";
import InflightReference from "@/components/InflightReference";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { GumpsCard } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { useOnline } from "@/components/useOnline";
import { usePrefetchRoutes } from "@/components/usePrefetchRoutes";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { completionOutcome, unsentNotice } from "@/lib/offline";
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

/**
 * Items this page answers on the pilot's behalf (see CheckoutList's
 * DerivedItem). Module-level so its identity is stable across renders — the
 * autosave hook holds it in a ref, and a fresh array every render would be a
 * quiet way to make that ref lie.
 */
const DERIVED_ITEM_IDS = ["start.preflight"] as const;

export default function RunwayPage() {
  const router = useRouter();
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
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
  /** A Complete that never reached the club — see lib/offline. */
  const [unsent, setUnsent] = useState(false);
  const online = useOnline();

  // This card is walked in the seat, with the engine running and the clubhouse
  // wifi already behind you — so the post-flight form is fetched now rather
  // than after the flight, when there may be nothing to fetch it over.
  usePrefetchRoutes(["/postflight"]);

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
  const remaining = useMemo(() => missingItems("RUNWAY", answers), [answers]);

  /** File anything raised on this run, once there's a row to hang it off. */
  const flushAttachments = useCallback(
    async (checkoutId: string) => {
      if (!selected || squawkDrafts.length === 0) return;
      // Cleared before the posts, so a sync landing mid-flight can't re-file
      // the same squawk.
      const pending = squawkDrafts;
      setSquawkDrafts([]);
      for (const draft of pending) {
        await sendJson<ApiSquawk>("/api/squawks", "POST", {
          aircraftId: selected.id,
          checkoutId,
          title: draft.title,
          description: draft.description || null,
        });
      }
      notifyAircraftChanged();
      await refresh();
    },
    [selected, squawkDrafts, refresh]
  );

  // Autosave — see components/useCheckoutDraft.ts.
  const draft = useCheckoutDraft({
    kind: "RUNWAY",
    aircraftId,
    memberId: me?.id ?? null,
    answers,
    values,
    notes,
    // "Preflight — complete" is the APP's answer, not the pilot's, and it's
    // already in `answers` before anyone touches the page. Without this, merely
    // opening the runway card on a day the airplane was walked would count as
    // progress and autosave a draft for someone who has done nothing.
    derivedIds: DERIVED_ITEM_IDS,
    onResume: useCallback((picked) => {
      setAnswers(picked.answers);
      // Saved values win, but anything the run never recorded keeps its
      // default — otherwise resuming a card saved before a field existed
      // would leave that field blank rather than at its opening value.
      setValues((defaults) => ({ ...defaults, ...picked.values }));
      setNotes(picked.notes);
    }, []),
    onSynced: flushAttachments,
  });

  /** Throw the saved run away, on both stores, and start the card clean. */
  async function resetCard() {
    setError(null);
    setSaved(null);
    setUnsent(false);
    const result = await draft.reset();
    if (!result.ok) {
      setError(result.error ?? "Could not discard the saved checkout.");
      return;
    }
    // `start.preflight` is the app's own answer rather than a tick of the
    // pilot's, so a cleared card keeps it — the effect above would put it back
    // anyway, and seeding it here avoids a frame where the row looks unticked.
    setAnswers(preflightDone ? { "start.preflight": true } : {});
    setValues(initialValues("RUNWAY"));
    setSquawkDrafts([]);
    setNotes("");
    setResetKey((k) => k + 1);
    await refresh();
  }

  /**
   * Complete the run — the page's only submit now that saving is automatic.
   *
   * `acknowledgeIncomplete` is the member having been asked, in a modal that
   * named the unticked items, and having said yes anyway. The API refuses an
   * incomplete card without it (see CompleteCheckoutButton).
   */
  async function completeRun({
    acknowledgeIncomplete,
  }: {
    acknowledgeIncomplete: boolean;
  }) {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setUnsent(false);
    setBusy(true);
    // Stop autosaving for the duration. A debounced sync coming due while this
    // request is in flight would POST a fresh DRAFT a moment after the walk was
    // signed for, and the next visit would offer to resume the card the member
    // had just put their name to.
    draft.freeze();

    const payload = {
      answers,
      values,
      notes: notes.trim() || null,
      complete: true,
      acknowledgeIncomplete,
    };

    // Autosave has almost certainly created the row already; PATCH it so one
    // run stays one row. The POST covers the member who ticks the last box
    // inside the debounce window.
    const result = draft.serverId
      ? await sendJson<ApiCheckout>(
          `/api/checkouts/${draft.serverId}`,
          "PATCH",
          payload
        )
      : await sendJson<ApiCheckout>("/api/checkouts", "POST", {
          aircraftId: selected.id,
          kind: "RUNWAY",
          ...payload,
        });

    const outcome = completionOutcome(
      result,
      "Could not save the taxi & runway checkout."
    );

    if (outcome.kind !== "filed") {
      setBusy(false);
      // The sign-off didn't take, so the walk is still live work — put autosave
      // back rather than leaving the member ticking into nothing.
      draft.thaw();
      // This is the card most likely to be signed off with no signal at all —
      // it ends at the hold-short line. A dropped request is therefore the
      // ordinary case here, not the exceptional one, and must not read as an
      // error: the walk is on the device and Complete is still the button.
      if (outcome.kind === "refused") setError(outcome.error);
      else setUnsent(true);
      return;
    }

    await flushAttachments(outcome.data.id);

    // The row is the airplane's record now, not a draft — drop the device copy
    // so the next visit opens clean.
    draft.finish();

    setBusy(false);
    // Signing this card off joins the flight's log entry — the one the
    // preflight walk opened, or a new one for a member who skipped that card.
    // Either way the club can now see the airplane is out. See
    // lib/flightSession.ts.
    setSaved("Taxi & Runway checkout completed. Clear prop — have a good flight.");

    setAnswers(preflightDone ? { "start.preflight": true } : {});
    setValues(initialValues("RUNWAY"));
    setNotes("");
    setResetKey((k) => k + 1);

    await refresh();

    // On to the next card, the same way the preflight page hands over to this
    // one. The flight itself happens between the two, which is exactly why the
    // post-flight page is where a member wants to land: it's the form they'll
    // be filling in when they get back, with the turn-off checkout on it.
    router.push("/postflight");
  }

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — an admin can add one from Club settings.
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
        ? `Completed today by ${lastPreflight!.user.name}`
        : lastPreflight
          ? `No preflight completed today — the last was ${formatDay(
              lastPreflight.completedAt!
            )} by ${lastPreflight.user.name}`
          : "No preflight checkout has been completed for this airplane",
      href: "/preflight",
      linkLabel: "Walk the preflight",
    },
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Taxi &amp; Runway</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber} · {selected.model}
          {lastRun && (
            <>
              {" · last completed "}
              {formatDay(lastRun.completedAt!)} by {lastRun.user.name}
            </>
          )}
        </p>
      </header>

      {/* No banner about the preflight up here any more. The card's own first
          before-start item IS "Preflight — complete" (see `preflightRow`): the
          app answers it, and the row itself goes green with who signed it or red
          with what's missing and a link to the walk. A banner saying the same
          thing a few inches above the row it's about was one fact in two places,
          and the row is the one that can't be scrolled past — it has to be
          passed to finish the card. */}
      <CheckoutList
        checkout={RUNWAY_CHECKOUT}
        answers={answers}
        onChange={setAnswers}
        values={values}
        onValuesChange={setValues}
        derived={preflightRow}
        // Everything about the SAVED STATE of this run, including Reset. It
        // rides in the sticky progress bar so it travels down the card with the
        // step counts rather than scrolling off the top of the page.
        status={
          <CheckoutDraftBar
            savedAt={draft.savedAt}
            serverSynced={draft.serverId !== null && !draft.deviceOnly}
            deviceOnly={draft.deviceOnly}
            storageBlocked={draft.storageBlocked}
            resume={draft.resume}
            dirty={draft.dirty}
            onReset={resetCard}
            busy={busy}
          />
        }
        resumed={draft.resume !== null}
        resetKey={resetKey}
      />

      {/* A runup is where a lot of squawks are actually found — a mag drop out
          of limits, an alternator light that stays on. File it before you
          fly. */}
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
        {/* Amber, not red, and above the error slot — the walk is whole and on
            the device, it just hasn't reached the club. See the same block on
            the preflight page. */}
        {unsent && (
          <p
            role="status"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          >
            <span className="font-semibold">{unsentNotice(online).lead}</span>{" "}
            {unsentNotice(online).body}
          </p>
        )}
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
        {/* One button, never disabled by the state of the card — an incomplete
            one is confirmed in a modal that names what's missing. See the
            preflight page. */}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <CompleteCheckoutButton
            title={RUNWAY_CHECKOUT.title}
            remaining={remaining}
            busy={busy}
            onComplete={completeRun}
          />
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
