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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Textarea from "@/components/common/Textarea";
import CheckoutList, { type ItemNote } from "@/components/CheckoutList";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import CheckoutDraftBar from "@/components/CheckoutDraftBar";
import CompleteCheckoutButton from "@/components/CompleteCheckoutButton";
import { useCheckoutDraft } from "@/components/useCheckoutDraft";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { MyLimitsCard } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useOnline } from "@/components/useOnline";
import { usePrefetchRoutes } from "@/components/usePrefetchRoutes";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { completionOutcome, unsentNotice } from "@/lib/offline";
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
import { isAwaitingReview, isGrounding, isInMaintenance } from "@/lib/squawks";
import { soloEligibility } from "@/lib/operatingRules";
import { useMe } from "@/components/MeProvider";
import type { ApiCheckout, ApiFlightSummary, ApiSquawk } from "@/lib/types";

/**
 * Items this page answers on the pilot's behalf (see CheckoutList's
 * DerivedItem) — and only while it CAN: the open-squawks row is the app's to
 * answer on an airplane with a clean sheet and the pilot's the moment anything
 * is filed. Module-level so its identity is stable across renders, since the
 * autosave hook holds it in a ref.
 */
const DERIVED_ITEM_IDS = ["homework.squawks"] as const;

export default function PreflightPage() {
  const router = useRouter();
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
  // Null until the fetch lands, and the distinction matters: "no open squawks"
  // is an answer this page ACTS on (it ticks the row for you), so it must never
  // be the empty array the page happens to start life holding.
  const [openSquawks, setOpenSquawks] = useState<ApiSquawk[] | null>(null);
  // My own flights, for the experience/currency half of the operating rules.
  const [myFlights, setMyFlights] = useState<ApiFlightSummary[]>([]);
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * A Complete that never reached the club. Not an error — see lib/offline —
   * so it gets its own state rather than a message in `error`: the walk is
   * intact, the button still works, and the only thing to do is press it again
   * with signal.
   */
  const [unsent, setUnsent] = useState(false);
  const online = useOnline();

  // The rest of the sequence, fetched while the clubhouse wifi is still in
  // reach. The flight happens between this card and the next two, which is
  // precisely when a first navigation to them would otherwise go looking for
  // the network.
  usePrefetchRoutes(["/runway", "/postflight"]);

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

  // What the airplane's open squawks add up to, counted once. Up here rather
  // than beside the row it draws, because the autosave hook below needs to know
  // whether the squawk row is the app's answer or the pilot's.
  const squawkSummary = useMemo(() => {
    const rows = openSquawks ?? [];
    return {
      loaded: openSquawks !== null,
      grounded: rows.filter((s) => isGrounding(s.status)).length,
      inWork: rows.filter((s) => isInMaintenance(s.status)).length,
      untriaged: rows.filter((s) => isAwaitingReview(s.status)).length,
      open: rows.length,
    };
  }, [openSquawks]);

  /**
   * Nothing open at all is the one case the APP can answer.
   *
   * Everywhere else this row stays the pilot's to tick: the app knows the list,
   * it can't know you've read it, and that tick is you saying you did. But
   * there is nothing to read on an airplane with a clean sheet, so asking for
   * the tick is asking a member to confirm an empty list — which is how a row
   * becomes one people tick without looking at it.
   */
  const noOpenSquawks = squawkSummary.loaded && squawkSummary.open === 0;

  /** A clean card — carrying whatever the app answers for itself. */
  function freshAnswers(): Answers {
    return noOpenSquawks ? { "homework.squawks": true } : {};
  }

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
    // Only while the app is the one answering it. On an airplane with an open
    // squawk this row is a real tick by a real member and counts as progress
    // like any other; on a clean-sheet airplane it's written by the effect
    // above, and counting it would create a server row — and a resume prompt —
    // for somebody who has done nothing but open the page.
    derivedIds: noOpenSquawks ? DERIVED_ITEM_IDS : undefined,
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
    setUnsent(false);
    const result = await draft.reset();
    if (!result.ok) {
      setError(result.error ?? "Could not discard the saved checkout.");
      return;
    }
    // The open-squawks row keeps the app's own answer, where there is one — the
    // effect below would put it back anyway, and seeding it here avoids a frame
    // where the row looks unticked.
    setAnswers(freshAnswers());
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
   * Complete the walk. The only submit on this page — saving happens by itself,
   * so this button means one thing rather than two.
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

    // Fuel and oil are no longer asked for twice: they're recorded on the
    // consumables items, and the API derives the columns from those (it
    // re-derives server-side too — this is not the client's decision).
    const payload = {
      answers,
      values,
      notes: notes.trim() || null,
      complete: true,
      acknowledgeIncomplete,
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

    const outcome = completionOutcome(
      result,
      "Could not save the preflight checkout."
    );

    if (outcome.kind !== "filed") {
      setBusy(false);
      // The sign-off didn't take, so the walk is still live work — put autosave
      // back rather than leaving the member ticking into nothing.
      draft.thaw();
      // A refusal is something to read; a request that never landed is not.
      // The card stays exactly as it is either way, so Complete remains the
      // right button — see lib/offline for why these are told apart at all.
      if (outcome.kind === "refused") setError(outcome.error);
      else setUnsent(true);
      return;
    }

    // Anything still held on the page — a photo attached seconds ago, a squawk
    // raised on the last item — needs the row, so it goes up now.
    await flushAttachments(outcome.data.id);

    // The row has stopped being a draft: it's the airplane's record. Drop the
    // device copy so the next visit opens a clean card rather than offering to
    // resume a walk that's already signed for.
    draft.finish();

    setBusy(false);
    setSaved(
      "Preflight checkout completed. Next: the runway checkout, once you're sitting in it."
    );

    // Start clean for the next run — clean meaning "a fresh card", which
    // includes a fresh clock reading rather than the one from the run that was
    // just signed off.
    setAnswers(freshAnswers());
    setValues(initialValues("PREFLIGHT"));
    setNotes("");
    setResetKey((k) => k + 1);

    await refresh();

    // And take them there. The walk ends at the cabin door and the runway card
    // starts in the seat, so "what now" has exactly one answer — one this page
    // was previously only willing to describe. The message above still gets
    // written first: the runway page opens with "Preflight — complete" already
    // ticked and green, which is the same news arriving in the place it's
    // useful.
    router.push("/runway");
  }

  /**
   * The squawk item's own traffic light, and the one line that justifies it.
   *
   * The colour is decided by what the club's statuses MEAN (lib/squawks.ts),
   * and RED IS RESERVED FOR GROUNDED. That's the whole point of the club having
   * one status vocabulary: "reviewed — in work" says the Safety Officer has
   * looked at it and the airplane may still be flown, so painting it the same
   * red as a grounding taught members to read past the colour that actually
   * stops a flight.
   *
   *   red   — grounded. Do not fly, and no amount of reading changes that.
   *   amber — something open that isn't settled: in the shop, or not yet
   *           triaged. Flyable, but know what you're taking.
   *   green — nothing open, or only squawks already reviewed as okay to fly.
   *
   * The note is a COUNT, not a transcript. It used to inline every open squawk
   * with its description, which put four or five lines of maintenance history
   * under one tick row and buried the sentence that mattered. The detail is a
   * tap away on the Squawks page, which is where it can be read properly (and
   * where the Safety Officer works from).
   */
  const squawkNote = useMemo((): Record<string, ItemNote> => {
    // Answered by the app — the derived row below draws it instead. And say
    // nothing at all until the list has actually arrived: a note that reads
    // "0 open squawks" for a moment and then contradicts itself is worse than
    // one that appears a beat late.
    if (!squawkSummary.loaded || noOpenSquawks) return {};

    const { grounded, inWork, untriaged, open } = squawkSummary;
    const tone: ItemNote["tone"] =
      grounded > 0 ? "red" : inWork > 0 || untriaged > 0 ? "amber" : "green";

    // "3 open squawks — 1 being worked, 1 not yet reviewed." Only the parts
    // that are true get a clause, so the common single-squawk morning reads as
    // one short sentence.
    const parts = [
      grounded > 0 && `${grounded} grounding`,
      inWork > 0 && `${inWork} being worked`,
      untriaged > 0 && `${untriaged} not yet reviewed`,
    ].filter(Boolean) as string[];

    return {
      "homework.squawks": {
        tone,
        href: "/status/squawks",
        linkLabel: "Read them",
        children: (
          <>
            <span className="block">
              {open} open {open === 1 ? "squawk" : "squawks"}
              {parts.length > 0 ? ` — ${parts.join(", ")}.` : ", all reviewed okay to fly."}
            </span>
            {/* What the colour means, for the two cases where the count alone
                doesn't say it. */}
            {grounded > 0 ? (
              <span className="block">Do not fly.</span>
            ) : (
              inWork > 0 && (
                <span className="block">
                  In maintenance is not a grounding — the airplane may still be
                  flown.
                </span>
              )
            )}
            {/* The club's own rule, for the members it applies to. */}
            {eligibility.tier === "BUILDING" && (
              <span className="block">
                Club rules: call the VFF Safety Officer before flying with an
                open squawk.
              </span>
            )}
          </>
        ),
      },
    };
  }, [noOpenSquawks, squawkSummary, eligibility.tier]);

  /**
   * The clean-sheet case, ticked by the app. See `noOpenSquawks`.
   *
   * `satisfied` is always true because this row only exists when it is: the
   * moment a squawk is filed the row goes back to being the pilot's, note and
   * all, rather than turning into a red derived row nobody can clear.
   */
  const squawkRow = useMemo(
    () =>
      noOpenSquawks
        ? {
            "homework.squawks": {
              satisfied: true,
              message: `Nothing open on ${selected?.tailNumber ?? "this airplane"}.`,
            },
          }
        : undefined,
    [noOpenSquawks, selected?.tailNumber]
  );

  // The app's own answer, written into `answers` so it counts toward the
  // sign-off exactly like a ticked item. Deliberately one-way: if a squawk is
  // filed mid-walk — quite possibly by this member, from this page — the row
  // becomes theirs again but the tick stands, because unticking something a
  // member watched go green is how an app loses their trust in it.
  //
  // `answers` is in the deps because a resume REPLACES it wholesale: a walk
  // saved while the airplane had a squawk, picked up after it was closed, would
  // otherwise come back with the row untickable and unticked.
  useEffect(() => {
    if (!noOpenSquawks) return;
    setAnswers((current) =>
      current["homework.squawks"]
        ? current
        : { ...current, "homework.squawks": true }
    );
  }, [noOpenSquawks, answers]);

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
              {" · last completed "}
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
        derived={squawkRow}
        itemNotes={squawkNote}
        // Everything about the SAVED STATE of this walk, including Reset. It
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

      {/* Submit. "Complete" is never disabled by the state of the card — an
          incomplete one is confirmed in a modal that names what's missing,
          rather than met with a button that won't press and no explanation. */}
      <div className="space-y-2 pb-2">
        {/* Amber rather than red, and above the error slot rather than in it:
            nothing has gone wrong with the walk. The card is whole and on the
            device; it just hasn't been handed to the club yet. `role="status"`
            because the wording changes on its own the moment signal returns,
            while the member is looking at the airplane rather than the phone. */}
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
        {/* One button. There used to be a Save beside it, which was the only
            thing that ever wrote a half-finished walk anywhere — a button you
            had to remember to press while holding a dipstick. Saving is
            automatic now, so the remaining button means exactly one thing:
            this walk is done and I am putting my name to it. */}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <CompleteCheckoutButton
            title={PREFLIGHT_CHECKOUT.title}
            remaining={remaining}
            busy={busy}
            onComplete={completeRun}
          />
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
