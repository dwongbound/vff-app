"use client";
// Preflight checkout — N8318B's preflight card, walked and signed for.
//
// Homework, consumables, cockpit, then the walk: left wing → nose → right wing
// → tail, and the standard weather briefing. It ends at the cabin door; what
// happens once you're sitting in it is the runway checkout (/runway).
//
// The card itself lives in lib/checkouts.ts and the tick rows are rendered by
// CheckoutList, which the runway page shares. What's specific to this page is
// everything AROUND the card: the club's limits for this member, what the
// walkaround found (fuel and oil), and any squawks it raised. The airplane's
// EXISTING open squawks hang off the card's own "open squawks" item, which is
// where the pilot is asked to confirm they've read them.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Textarea from "@/components/common/Textarea";
import CheckoutList, { type ItemNote } from "@/components/CheckoutList";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import CheckoutDraftBar from "@/components/CheckoutDraftBar";
import { useCheckoutDraft } from "@/components/useCheckoutDraft";
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
import {
  SQUAWK_STATUS_SHORT,
  isAwaitingReview,
  isGrounding,
  isInMaintenance,
} from "@/lib/squawks";
import { soloEligibility } from "@/lib/operatingRules";
import { useMe } from "@/components/MeProvider";
import type { ApiCheckout, ApiFlightSummary, ApiSquawk } from "@/lib/types";

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
  const [myFlights, setMyFlights] = useState<ApiFlightSummary[]>([]);
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
      fetchJsonArray<ApiFlightSummary>(`/api/flights?aircraftId=${aircraftId}&mine=1&limit=300`),
    ]);
    setRecent(runs);
    setOpenSquawks(squawks);
    setMyFlights(flights);
  }, [aircraftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Send up anything that was waiting for a row to hang off.
   *
   * Photos and squawks can't go up until the checkout exists, so they're held
   * on the page until autosave (or a sign-off) creates one. Squawks going up
   * on the first sync rather than at sign-off is the important half: a walk
   * that finds something wrong is a walk that often ends with nobody flying,
   * and a squawk that only reaches the club on a sign-off that never comes is
   * a squawk nobody reads.
   */
  const flushAttachments = useCallback(
    async (checkoutId: string) => {
      if (!selected) return;
      if (photos.length === 0 && squawkDrafts.length === 0) return;

      // Taken and cleared BEFORE the uploads: another autosave landing while
      // these are in flight would otherwise send the same picture twice.
      const pendingPhotos = photos;
      const pendingSquawks = squawkDrafts;
      setPhotos([]);
      setSquawkDrafts([]);

      if (pendingPhotos.length) {
        await uploadPhotos(pendingPhotos, "checkout", checkoutId);
      }
      for (const draft of pendingSquawks) {
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

      // A new squawk changes the open count the Status tab shows. It can no
      // longer ground the airplane by itself — only the Safety Officer's triage
      // does that — so this refreshes the count rather than a banner.
      if (pendingSquawks.length > 0) notifyAircraftChanged();
      await refresh();
    },
    [selected, photos, squawkDrafts, refresh]
  );

  // Autosave. Every tick lands on the device immediately and reaches the club's
  // server a couple of seconds later; there is no longer anything for the
  // member to press. See components/useCheckoutDraft.ts.
  const draft = useCheckoutDraft({
    kind: "PREFLIGHT",
    aircraftId,
    memberId: me?.id ?? null,
    answers,
    values,
    notes,
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

  /** Throw the saved walk away, on both stores, and start the card clean. */
  async function resetCard() {
    setError(null);
    setSaved(null);
    const result = await draft.reset();
    if (!result.ok) {
      setError(result.error ?? "Could not discard the saved checkout.");
      return;
    }
    setAnswers({});
    setValues(initialValues("PREFLIGHT"));
    setPhotos([]);
    setSquawkDrafts([]);
    setNotes("");
    setResetKey((k) => k + 1);
    await refresh();
  }

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
  const remaining = useMemo(() => missingItems("PREFLIGHT", answers), [answers]);
  // Echoed back below the card so the two figures Plane Status depends on are
  // visible before you sign off, without asking for them a second time.
  const fuelOil = useMemo(() => deriveFuelOil(values), [values]);

  /**
   * Sign the walk off. The only submit on this page now — saving happens by
   * itself, so this button means one thing rather than two.
   */
  async function signOff() {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setBusy(true);
    // Stop autosaving for the duration. A debounced sync coming due while this
    // request is in flight would POST a fresh DRAFT a moment after the walk was
    // signed for, and the next visit would offer to resume the card the member
    // had just put their name to.
    draft.freeze();

    // Fuel and oil are no longer asked for twice: they're recorded on the
    // consumables items, and the API derives the columns from those (it
    // re-derives server-side too — this is not the client's decision).
    const payload = {
      answers,
      values,
      notes: notes.trim() || null,
      complete: true,
    };

    // Autosave has almost certainly created the row already; PATCH it so one
    // walkaround stays one row. The POST is the case where the very first sync
    // hasn't landed yet — a member who ticks the last box within the debounce.
    const result = draft.serverId
      ? await sendJson<ApiCheckout>(
          `/api/checkouts/${draft.serverId}`,
          "PATCH",
          payload
        )
      : await sendJson<ApiCheckout>("/api/checkouts", "POST", {
          aircraftId: selected.id,
          kind: "PREFLIGHT",
          ...payload,
        });

    if (!result.ok || !result.data) {
      setBusy(false);
      // The sign-off didn't take, so the walk is still live work — put autosave
      // back rather than leaving the member ticking into nothing.
      draft.thaw();
      setError(result.error ?? "Could not save the preflight checkout.");
      return;
    }

    // Anything still held on the page — a photo attached seconds ago, a squawk
    // raised on the last item — needs the row, so it goes up now.
    await flushAttachments(result.data.id);

    // The row has stopped being a draft: it's the airplane's record. Drop the
    // device copy so the next visit opens a clean card rather than offering to
    // resume a walk that's already signed for.
    draft.finish();

    setBusy(false);
    setSaved(
      "Preflight checkout signed off. Next: the runway checkout, once you're sitting in it."
    );

    // Start clean for the next run — clean meaning "a fresh card", which
    // includes a fresh clock reading rather than the one from the run that was
    // just signed off.
    setAnswers({});
    setValues(initialValues("PREFLIGHT"));
    setNotes("");
    setResetKey((k) => k + 1);

    await refresh();
  }

  /**
   * The squawk item's own traffic light, and the list that justifies it.
   *
   * The colour is decided by what the club's statuses MEAN (lib/squawks.ts),
   * not by how many there are:
   *
   *   red   — the airplane is grounded, or it's in the shop. Either way this
   *           is not a "note the defect and go" morning.
   *   amber — something is filed that nobody qualified has looked at yet.
   *           Untriaged is not the same as fine.
   *   green — nothing open, or only squawks already reviewed as okay to fly.
   *
   * Note what does NOT happen: the item never ticks itself. The app knows the
   * list; it can't know that you read it, and that tick is the pilot saying
   * they did.
   */
  const squawkNote = useMemo<Record<string, ItemNote>>(() => {
    const grounded = openSquawks.filter((s) => isGrounding(s.status));
    const inWork = openSquawks.filter((s) => isInMaintenance(s.status));
    const untriaged = openSquawks.filter((s) => isAwaitingReview(s.status));
    const tone: ItemNote["tone"] =
      grounded.length > 0 || inWork.length > 0
        ? "red"
        : untriaged.length > 0
          ? "amber"
          : "green";

    return {
      "homework.squawks": {
        tone,
        children:
          openSquawks.length === 0 ? (
            <>Nothing open on {selected?.tailNumber}.</>
          ) : (
            <>
              {/* The headline says what the colour means, in words. */}
              <span className="block">
                {grounded.length > 0
                  ? `Do not fly — ${grounded.length} grounding ${
                      grounded.length === 1 ? "squawk" : "squawks"
                    }.`
                  : inWork.length > 0
                    ? "In maintenance — check with the Safety Officer before you fly it."
                    : untriaged.length > 0
                      ? `${untriaged.length} not yet reviewed by the Safety Officer.`
                      : "All reviewed as okay to fly."}
              </span>
              <span className="mt-1 block space-y-0.5">
                {openSquawks.map((s) => (
                  <span key={s.id} className="block">
                    <span className="opacity-70">
                      {SQUAWK_STATUS_SHORT[s.status]}
                    </span>{" "}
                    — {s.title}
                    {s.description ? ` — ${s.description}` : ""}
                  </span>
                ))}
              </span>
              {/* The club's own rule, for the members it applies to. */}
              {eligibility.tier === "BUILDING" && (
                <span className="mt-1 block">
                  Club rules: call the VFF Safety Officer to discuss before
                  flying with an open squawk.
                </span>
              )}
            </>
          ),
      },
    };
  }, [openSquawks, eligibility.tier, selected?.tailNumber]);

  // Everything above this line is a hook, and everything below it may not be.
  //
  // The early return used to sit HIGHER, with `squawkNote`'s useMemo below it —
  // so the render where the fleet hadn't loaded yet ran fewer hooks than the one
  // after it arrived, and React threw "Rendered more hooks than during the
  // previous render" the moment the airplane appeared. It only became reachable
  // once autosave gave the page an async resume to wait on, which is the usual
  // way a latent Rules-of-Hooks bug announces itself: not when it's written.
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

      {/* Everything about the SAVED STATE of this walk, including Reset. */}
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

      {/* The club's limits for THIS member, before anything else — they decide
          whether the flight happens at all. */}
      <MyLimitsCard
        eligibility={eligibility}
        totalTimeHours={me?.totalTimeHours ?? null}
      />

      {/* The open squawks used to be a card of their own above the card. They
          aren't any more: the checkout already HAS a line for them ("Open
          squawks — reviewed, airplane airworthy"), and a panel above the
          progress bar meant the list you were meant to read and the box you
          tick to say you read it were two screens apart. Now the list hangs
          off its own item — see `squawkNote`. */}
      <CheckoutList
        checkout={PREFLIGHT_CHECKOUT}
        answers={answers}
        onChange={setAnswers}
        values={values}
        onValuesChange={setValues}
        hints={fieldHints}
        itemNotes={squawkNote}
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
            Nothing reported. Anything you find here is filed against this
            checkout within a few seconds — you don&apos;t have to finish the
            walk, or fly, for the club to see it.
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
        {/* One button. There used to be a Save beside it, which was the only
            thing that ever wrote a half-finished walk anywhere — a button you
            had to remember to press while holding a dipstick. Saving is
            automatic now, so the remaining button means exactly one thing:
            this walk is done and I am putting my name to it. */}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="lg"
            onClick={signOff}
            disabled={busy || !complete}
            className="w-full sm:w-auto"
          >
            {busy ? <LoadingDots size="sm" /> : "Sign off"}
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
