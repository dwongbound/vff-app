"use client";
// Quick Log — file a flight in four numbers.
//
// The rest of this app is built around the walk: preflight card, runway card,
// fly, post-flight form. That sequence is right, and it is also twenty minutes
// of tapping, which means the flights it does not fit — a lap of the pattern
// between two lessons, a maintenance hop, a member who walked the airplane off
// a paper card and just needs the hours in the book — were getting written on
// the back of a receipt and typed in a week later, or not at all. A log with
// holes in it is worse than a log filled in quickly.
//
// So this page asks for the four meter readings and nothing else it can avoid,
// and files a real flight. It is not a lesser record: the row it writes is the
// same `Flight` row the post-flight form writes, bills the same way through
// `syncFlightCharges`, advances the airplane's meters the same way, and is
// corrected from the same detail modal in the flight log.
//
// WHAT IT IS NOT is an inspection. The preflight card is the club's record
// that somebody walked around the airplane, and this page cannot and does not
// stand in for it — the banner at the top says so in as many words, because
// the failure mode of a fast path is that it quietly becomes the only path.
// Nothing here is ticked, so nothing here can be mistaken for a walkaround.
//
// The "smarts" it does keep from the checkout pages, because they're what make
// the form four numbers instead of eight:
//
//   • It knows if you have the airplane OUT. Signing off a preflight opens a
//     session (see lib/flightSession.ts) and this page closes that one out
//     rather than opening a second row — the same rule the post-flight form
//     follows, and the server enforces it either way.
//   • The start meters prefill from the best thing the app knows, in the same
//     order the post-flight form uses: the open session's own columns, then
//     today's preflight walk, then where the last filed flight left the
//     airplane. Each box says which, and stops following the moment you type.
//   • The meters are validated by the same `validateMeters` — a tach end below
//     its start, a twelve-hour flight, half a Hobbs pair.
//   • It prices the flight live, off the same `flightCostCents` the log uses.
//
// It AUTOSAVES, on the device (lib/quickLogDraft.ts): typed at the tail, it is
// exactly the form a member leaves mid-way — to check the log for the last
// tach, to answer a message — and coming back to empty boxes was the bug. The
// draft is per member and per airplane, and goes the moment the flight is
// filed (or the member presses Discard).
//
// The button always says "File". A missing tach reading doesn't stop it — an
// honest gap beats no record — but it ASKS first, in a dialog that says what
// the gap means and how to close it, rather than renaming the button.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Banner from "@/components/common/Banner";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmModal from "@/components/common/ConfirmModal";
import Input from "@/components/common/Input";
import InfoTip from "@/components/common/InfoTip";
import Toggle from "@/components/common/Toggle";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { useOutbox, useOutboxSent } from "@/components/OutboxProvider";
import { deviceStore } from "@/components/deviceStore";
import { pruneDrafts } from "@/lib/checkoutDraft";
import {
  clearQuickLogDraft,
  quickLogHasProgress,
  readQuickLogDraft,
  writeQuickLogDraft,
  type QuickLogForm,
} from "@/lib/quickLogDraft";
import { fetchJsonArray } from "@/lib/api";
import { fuelTotalHint } from "@/lib/fuel";
import { QUEUED_NOTICE } from "@/lib/offline";
import { flightJob, hasPending } from "@/lib/outbox";
import { clubDateKey, formatDay, toDateInputValue } from "@/lib/dates";
import { landingAirportsError, parseLandingAirports } from "@/lib/landingAirports";
import {
  flightCostCents,
  formatCents,
  formatHours,
  hobbsHours,
  tachHours,
  validateMeters,
} from "@/lib/hours";
import type { ApiCheckout, ApiFlightSummary } from "@/lib/types";
import { FlightTypeSelect } from "@/components/FlightType";
import { isPurpose, type Purpose } from "@/lib/constants";

export default function QuickLogPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const aircraftId = selected?.id ?? null;
  usePageLoading(fleetLoading);

  const [flownOn, setFlownOn] = useState(() => toDateInputValue(new Date()));
  const [tachStart, setTachStart] = useState("");
  const [tachEnd, setTachEnd] = useState("");
  const [hobbsStart, setHobbsStart] = useState("");
  const [hobbsEnd, setHobbsEnd] = useState("");
  // WHERE you landed, not how many times. The count falls out of the list —
  // see lib/landingAirports.ts for why that's the right way round.
  const [airports, setAirports] = useState("");
  const [fuelAdded, setFuelAdded] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [oilAdded, setOilAdded] = useState("");
  // Whose card the fuel went on. Defaults to the member's own, which is the
  // case that needs paying back — the safer default is the one that can't
  // quietly swallow money somebody is owed. Same default, and the same
  // reasoning, as Servicing's `paidPersonally`.
  const [paidPersonally, setPaidPersonally] = useState(true);
  const [purpose, setPurpose] = useState<Purpose | "">("");
  // The fuel half is folded away until it's wanted: most flights put nothing
  // in, and three empty boxes on a page whose whole promise is "four numbers"
  // would undo the promise.
  const [showFuel, setShowFuel] = useState(false);

  const [session, setSession] = useState<ApiFlightSummary | null>(null);
  // The last flight anybody FILED on this airplane, for the prefill hints. A
  // meter reading with no name and no date on it is a number you can't decide
  // whether to trust: "1509.0, Alex Rivera, Tuesday" tells you at a glance
  // whether anything has happened to the airplane since.
  const [lastFiled, setLastFiled] = useState<ApiFlightSummary | null>(null);
  const [todaysPreflight, setTodaysPreflight] = useState<ApiCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** Filed into the outbox with no signal — see lib/offline. */
  const [queued, setQueued] = useState(false);
  const outbox = useOutbox();
  const { me } = useMe();
  // A missing tach reading asks before it files — see the note at the top.
  const [confirmingGap, setConfirmingGap] = useState(false);

  // ── Three reads, all fired in PARALLEL on mount ─────────────────────────
  //
  // Two of them hit `/api/flights` and it is tempting to fold them into one:
  // the aircraft-wide list orders open sessions first, so a single request
  // could yield both answers with a client-side filter on the pilot. Don't.
  // "Do I have the airplane out" would then be answered one way here and
  // another way (`?mine=1&open=1`, server-side) on the post-flight form, and
  // that invariant — at most one open session per member per airplane — is the
  // thing this whole feature exists to protect. One extra GET is the cheaper
  // side of that trade.
  //
  // Nor should the third become conditional. Today's preflight walk is only
  // needed when there ISN'T an open session, so it could wait for the session
  // to land — but that turns two parallel requests into a waterfall on the
  // page whose entire promise is speed, to save one small read.

  // Do I have the airplane out? Asked of the club rather than the device: the
  // card that opened the session may have been walked on the clubhouse iPad.
  const loadSession = useCallback(async () => {
    if (!aircraftId) {
      setSession(null);
      return;
    }
    const rows = await fetchJsonArray<ApiFlightSummary>(
      `/api/flights?aircraftId=${aircraftId}&mine=1&open=1&limit=1`
    );
    setSession(rows[0] ?? null);
  }, [aircraftId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // The last FILED flight, for the prefill hints below.
  //
  // `filedAt` is filtered for rather than trusted to ordering: the log's
  // default order puts OPEN sessions first, so `flights[0]` is "the airplane
  // is out" rather than "the last flight" — the trap Plane Status fell into.
  // Asking for a few and picking the first filed one is the cheap fix.
  const loadLastFiled = useCallback(async () => {
    if (!aircraftId) {
      setLastFiled(null);
      return;
    }
    const rows = await fetchJsonArray<ApiFlightSummary>(
      `/api/flights?aircraftId=${aircraftId}&limit=5`
    );
    setLastFiled(rows.find((r) => r.filedAt != null) ?? null);
  }, [aircraftId]);

  useEffect(() => {
    loadLastFiled();
  }, [loadLastFiled]);
  // A queued filing just reached the club: it's the last filed flight now,
  // and the session it closed is closed.
  useOutboxSent(() => {
    void loadSession();
    void loadLastFiled();
  });

  // Today's preflight walk, for a start reading somebody has already taken off
  // the panel. Only TODAY's — last week's is a number about a different flight.
  useEffect(() => {
    if (!aircraftId) return;
    let live = true;
    fetchJsonArray<ApiCheckout>(
      `/api/checkouts?aircraftId=${aircraftId}&kind=PREFLIGHT&limit=5`
    ).then((rows) => {
      if (!live) return;
      const today = clubDateKey(new Date());
      setTodaysPreflight(
        rows.find(
          (r) => r.completedAt != null && clubDateKey(r.completedAt) === today
        ) ?? null
      );
    });
    return () => {
      live = false;
    };
  }, [aircraftId]);

  // Each start box MIRRORS the best reading the app has until the member types
  // in that box, at which point it stops following and their number stands.
  // "Until it's empty" is the rule this deliberately isn't — see the long note
  // on the post-flight form for the bug that causes ("1506.1" arriving one
  // keystroke at a time and the box keeping only the "1").
  const [edited, setEdited] = useState({ tachStart: false, hobbsStart: false });

  // ── The device draft ────────────────────────────────────────────────────
  //
  // `restoredFor` is the member+airplane whose draft the form currently holds.
  // Until it matches, nothing is SAVED — otherwise the empty first render
  // would overwrite a draft before it had been read back.
  const draftOwner = me && aircraftId ? `${me.id}:${aircraftId}` : null;
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  /** Empty every box the MEMBER fills; the start boxes go back to the prefill. */
  function resetTyped() {
    setFlownOn(toDateInputValue(new Date()));
    setTachEnd("");
    setHobbsEnd("");
    setAirports("");
    setFuelAdded("");
    setFuelPrice("");
    setOilAdded("");
    setPaidPersonally(true);
    setPurpose("");
    setShowFuel(false);
    setEdited({ tachStart: false, hobbsStart: false });
  }

  // Read the draft back when the page opens — and again if the member switches
  // airplane, which must never carry one airplane's numbers into another's.
  useEffect(() => {
    if (!me || !aircraftId || restoredFor === draftOwner) return;
    pruneDrafts(deviceStore());
    const draft = readQuickLogDraft(deviceStore(), { memberId: me.id, aircraftId });
    if (draft) {
      setFlownOn(draft.flownOn);
      setTachStart(draft.tachStart);
      setTachEnd(draft.tachEnd);
      setHobbsStart(draft.hobbsStart);
      setHobbsEnd(draft.hobbsEnd);
      setAirports(draft.airports);
      setFuelAdded(draft.fuelAdded);
      setFuelPrice(draft.fuelPrice);
      setOilAdded(draft.oilAdded);
      setPaidPersonally(draft.paidPersonally);
      setPurpose(isPurpose(draft.purpose) ? draft.purpose : "");
      setEdited(draft.edited);
      setShowFuel(Boolean(draft.fuelAdded || draft.fuelPrice || draft.oilAdded));
      setDraftSavedAt(draft.savedAt);
    } else if (restoredFor !== null) {
      // Switched airplane, and this one has no draft: start clean.
      resetTyped();
      setDraftSavedAt(null);
    }
    setRestoredFor(draftOwner);
  }, [me, aircraftId, draftOwner, restoredFor]);

  // Save on every change — synchronously, like the other drafts, so closing
  // the tab a second after typing loses nothing. A form with nothing the
  // member brought (see `quickLogHasProgress`) isn't a draft: it's cleared.
  useEffect(() => {
    if (!me || !aircraftId || restoredFor !== draftOwner) return;
    const who = { memberId: me.id, aircraftId };
    const form: QuickLogForm = {
      flownOn,
      tachStart,
      tachEnd,
      hobbsStart,
      hobbsEnd,
      airports,
      fuelAdded,
      fuelPrice,
      oilAdded,
      paidPersonally,
      purpose,
      edited,
    };
    if (!quickLogHasProgress(form)) {
      clearQuickLogDraft(deviceStore(), who);
      setDraftSavedAt(null);
      return;
    }
    const savedAt = new Date().toISOString();
    if (writeQuickLogDraft(deviceStore(), { ...form, ...who, savedAt })) {
      setDraftSavedAt(savedAt);
    }
  }, [
    me,
    aircraftId,
    draftOwner,
    restoredFor,
    flownOn,
    tachStart,
    tachEnd,
    hobbsStart,
    hobbsEnd,
    airports,
    fuelAdded,
    fuelPrice,
    oilAdded,
    paidPersonally,
    purpose,
    edited,
  ]);

  const walkedTach = todaysPreflight?.values["cockpit.meters.tach"];
  const walkedHobbs = todaysPreflight?.values["cockpit.meters.hobbs"];
  const startTach =
    session?.tachStart ??
    (typeof walkedTach === "number" ? walkedTach : selected?.lastTach ?? null);
  const startHobbs =
    session?.hobbsStart ??
    (typeof walkedHobbs === "number" ? walkedHobbs : selected?.lastHobbs ?? null);

  useEffect(() => {
    if (startTach != null && !edited.tachStart) setTachStart(String(startTach));
  }, [startTach, edited.tachStart]);
  useEffect(() => {
    if (startHobbs != null && !edited.hobbsStart) setHobbsStart(String(startHobbs));
  }, [startHobbs, edited.hobbsStart]);

  /**
   * Where a prefilled start reading came from — never left anonymous, and
   * never left vague.
   *
   * "From the last filed flight" is true and not much use: what a member
   * deciding whether to trust the number wants is WHOSE reading it is and HOW
   * OLD. A tach carried over from a flight this morning is almost certainly
   * still right; one from three weeks ago means somebody has flown since and
   * not filed, which is exactly the disagreement worth seeing rather than
   * smoothing over.
   */
  function startHint(box: "tachStart" | "hobbsStart"): string | undefined {
    if (edited[box]) return undefined;
    const onSession =
      box === "tachStart" ? session?.tachStart != null : session?.hobbsStart != null;
    if (onSession) return "from the flight you have open";

    const walked = box === "tachStart" ? walkedTach : walkedHobbs;
    if (typeof walked === "number") {
      const who = todaysPreflight?.user?.name;
      return who
        ? `from ${who}'s preflight walk today`
        : "from today's preflight walk";
    }

    if (!lastFiled) return "from the last filed flight";
    const who = lastFiled.pilot?.name;
    const when = lastFiled.filedAt
      ? formatDay(new Date(lastFiled.filedAt))
      : formatDay(new Date(lastFiled.flownOn));
    return `where ${who ?? "the last flight"} left it on ${when}`;
  }

  // Hobbs counts as recorded only when BOTH ends are there — the start is
  // prefilled from the airplane, so without this a member who doesn't use the
  // Hobbs at all would be nagged for a reading they never took.
  const hobbsPair = hobbsStart !== "" && hobbsEnd !== "";
  const meters = useMemo(
    () => ({
      tachStart: tachStart === "" ? null : Number(tachStart),
      tachEnd: tachEnd === "" ? null : Number(tachEnd),
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
    }),
    [tachStart, tachEnd, hobbsStart, hobbsEnd, hobbsPair]
  );

  // The end reading is what this page exists to collect; the start may be left
  // empty, and a row with an end and no start is a real record of a flight.
  // Nothing is wrong until there's something to be wrong about.
  const hasEndTach = tachEnd !== "";
  const meterError = hasEndTach ? validateMeters(meters) : null;

  // The airports line, as the three columns a Flight row holds. Parsed on
  // every keystroke so the count under the box counts up as you type — which
  // is also the fastest way to notice you left one out.
  const landed = useMemo(() => parseLandingAirports(airports), [airports]);
  const airportsError = useMemo(() => landingAirportsError(airports), [airports]);
  const tach = meterError ? null : tachHours(meters);
  const hobbs = meterError ? null : hobbsHours(meters);
  const cost =
    tach != null ? flightCostCents(meters, selected?.hourlyRateCents) : null;

  /**
   * The line under the airports box: what you've typed so far, counted back.
   *
   * Written out rather than nested in the JSX. It is three separate cases and
   * a reader should be able to see all three at once — the version that lived
   * inline was a ternary inside a ternary inside a template string.
   */
  function airportsHintText(): string | undefined {
    // The error takes the slot instead; two messages under one box is noise.
    if (airportsError) return undefined;
    if (landed.landings === 0) {
      return "Every field you landed at, in order — list one twice if you landed twice";
    }
    const plural = landed.landings === 1 ? "landing" : "landings";
    return `${landed.landings} ${plural} · ends at ${landed.arrival}`;
  }
  const airportsHint = airportsHintText();

  /**
   * Which tach reading is missing, worded the way the log's badge words it
   * ("Needs tach end"), so the dialog and the log say the same thing.
   */
  function missingTach(): string {
    if (tachStart === "" && tachEnd === "") return "start & tach end";
    if (tachEnd === "") return "end";
    return "start";
  }
  const missingReading = missingTach();

  /**
   * The File button. A tach reading missing at either end asks first (the
   * dialog explains the gap and how to close it); anything else files.
   */
  function requestFile() {
    setError(null);
    if (meterError) {
      setError(meterError);
      return;
    }
    if (tachStart === "" || tachEnd === "") {
      setConfirmingGap(true);
      return;
    }
    void submit();
  }

  async function submit() {
    if (!selected || !me) return;
    setConfirmingGap(false);
    setError(null);
    setSaved(null);
    setQueued(false);

    // An empty tach end is no longer a refusal — see `acknowledgeIncomplete`
    // below. A real meter ERROR still is: "tach end below tach start" is a
    // misread number, not a missing one, and filing it would put a wrong
    // figure in the log rather than an honest gap.
    if (meterError) {
      setError(meterError);
      return;
    }
    if (airportsError) {
      setError(airportsError);
      return;
    }

    setBusy(true);
    const body = {
      aircraftId: selected.id,
      // The session this closes out, when there is one. The server looks for
      // it independently — this is the fast path, not the only one — and
      // `standalone` is deliberately NOT sent: unlike FlightEntryModal, this
      // page IS about the flight you just did, so adopting the open session is
      // exactly right.
      flightId: session?.id ?? null,
      flownOn: new Date(`${flownOn}T12:00:00`).toISOString(), // local midday: date-only, TZ-safe
      tachStart: tachStart === "" ? null : Number(tachStart),
      tachEnd: tachEnd === "" ? null : Number(tachEnd),
      // "I know this is missing a reading and I want to file it anyway." The
      // server refuses a blank tach end without it, so a stale client can't
      // drop the number by accident — the same bargain the checkouts route
      // strikes over a half-ticked card.
      acknowledgeIncomplete: true,
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
      // The airports line becomes the three columns the log already has: how
      // many landings, where the airplane ended up, and the route written out.
      landings: landed.landings,
      arrival: landed.arrival,
      route: landed.route,
      fuelAddedGal: fuelAdded === "" ? null : Number(fuelAdded),
      fuelPricePerGalDollars: fuelPrice === "" ? null : Number(fuelPrice),
      // Whose card. A club-card fill is the club buying its own fuel and must
      // not raise a credit — the server is what enforces that, this is the
      // member's answer to it.
      fuelPaidPersonally: paidPersonally,
      // Not set = let the server take the open session's type, if it has one.
      ...(purpose ? { purpose } : {}),
      oilAddedQts: oilAdded === "" ? null : Number(oilAdded),
      // No turn-off answers, and that's the honest thing: those ticks mean "I
      // confirmed this at the airplane", and there is no way to answer them
      // from a form that never asked. The API's own fallback applies.
      notes: "Filed from Quick Log.",
    };

    // Through the outbox, like the post-flight form: four numbers typed at the
    // tail are four numbers worth keeping when there's no signal to send them
    // over. See lib/outbox.ts.
    const result = await outbox.submit(
      flightJob({
        owner: { userId: me.id, userName: me.name },
        label: `Quick Log — ${selected.tailNumber}`,
        aircraftId: selected.id,
        body,
      })
    );

    if (result.kind === "refused") {
      setBusy(false);
      setError(result.error);
      return;
    }

    setBusy(false);
    const filedHours = tachHours(meters);
    const gaps = [
      tachStart === "" ? "start" : null,
      tachEnd === "" ? "end" : null,
    ].filter(Boolean);
    if (result.kind === "queued") {
      setQueued(true);
    } else {
      setSaved(
        filedHours != null
          ? `Filed ${formatHours(filedHours)} hours on ${selected.tailNumber}.`
          : `Filed on ${selected.tailNumber} with no tach ${gaps.join(" or ")} reading — it's in the log marked incomplete, and adding the number there bills the hours.`
      );
    }

    // Ready for the next one, with the meters where the airplane now reads.
    // Carry the end forward as the next flight's start — but only when there
    // was one. Carrying an empty box forward would clear a prefill that the
    // last filed flight can still answer for.
    if (tachEnd !== "") setTachStart(tachEnd);
    setTachEnd("");
    if (hobbsEnd !== "") setHobbsStart(hobbsEnd);
    setHobbsEnd("");
    setEdited({ tachStart: tachEnd !== "", hobbsStart: hobbsEnd !== "" });
    setAirports("");
    setFuelAdded("");
    setFuelPrice("");
    setOilAdded("");
    setPaidPersonally(true);
    setPurpose("");
    setShowFuel(false);

    // Queued means the club has nothing new yet, so there's nothing to re-ask —
    // and with no signal the questions would only fail. The outbox fires
    // `useOutboxSent` (above) when it lands, which refreshes then.
    if (result.kind === "queued") return;

    // The filed flight moved the airplane's meters, so every view of it is
    // stale — one event, which the provider turns into one refetch.
    notifyAircraftChanged();
    // Both re-asked rather than patched: this flight is now the last filed one
    // (so the hint under the start boxes is about to be wrong), and the member
    // may or may not still have the airplane out — somebody who flies twice in
    // an afternoon may already have walked the next card.
    await Promise.all([loadSession(), loadLastFiled()]);
  }

  // This member's filing still in the outbox: the server has that session
  // open, but it's the flight they've just filed — don't offer to close it
  // out a second time.
  const flightQueued = hasPending(outbox.jobs, me?.id ?? null, {
    type: "flight",
    aircraftId: aircraftId ?? undefined,
  });

  if (!fleetLoading && !selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — an admin can add one from Club settings.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Quick Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected?.tailNumber}
          {selected?.lastTach != null &&
            ` · last filed tach ${selected.lastTach.toFixed(1)}`}
        </p>
      </header>

      {/* Having the airplane out changes what the button does, so it's said
          before the boxes rather than discovered after pressing it. */}
      {session && !flightQueued ? (
        <Banner tone="indigo">
          <span className="font-medium">You have {selected?.tailNumber} out.</span>{" "}
          Filing here closes out the entry your{" "}
          {session.startedAt
            ? `${formatDay(new Date(session.startedAt))} `
            : ""}
          preflight opened rather than starting a second one.
        </Banner>
      ) : null}

      {/* Green isn't a Banner tone — the app's banners are for things that
          need attention, and a confirmation doesn't. Same treatment the
          post-flight form gives its own "filed" line. */}
      {saved ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
          {saved}
        </p>
      ) : null}
      {queued ? (
        <p aria-live="polite" className="text-sm text-amber-700 dark:text-amber-300">
          {QUEUED_NOTICE}
        </p>
      ) : null}
      {error ? <Banner tone="red">{error}</Banner> : null}

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">Meter readings</h2>
          {tach != null ? (
            <Badge tone="indigo">{formatHours(tach)} hrs tach</Badge>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Tach start"
            type="number"
            step="0.1"
            min="0"
            value={tachStart}
            onChange={(e) => {
              setEdited((p) => ({ ...p, tachStart: true }));
              setTachStart(e.target.value);
            }}
            hint={startHint("tachStart")}
          />
          <Input
            label="Tach end"
            type="number"
            step="0.1"
            min="0"
            value={tachEnd}
            onChange={(e) => {
              // Typing the END means the member has read the start against the
              // panel and is working from it — so it stops following, exactly
              // as if they'd typed it. Otherwise a reading arriving late (today's
              // preflight, on a slow ramp connection) would swap the start under
              // them and file a span they never saw. Accepting a prefilled
              // start fires no change event on it, so this is the only signal.
              setEdited((p) => ({ ...p, tachStart: true }));
              setTachEnd(e.target.value);
            }}
            hint="Off the panel at shutdown — the one reading this page needs"
          />
          <Input
            label="Hobbs start"
            type="number"
            step="0.1"
            min="0"
            value={hobbsStart}
            onChange={(e) => {
              setEdited((p) => ({ ...p, hobbsStart: true }));
              setHobbsStart(e.target.value);
            }}
            hint={startHint("hobbsStart")}
          />
          <Input
            label="Hobbs end"
            type="number"
            step="0.1"
            min="0"
            value={hobbsEnd}
            onChange={(e) => {
              // Same rule as the tach end, for the same reason.
              setEdited((p) => ({ ...p, hobbsStart: true }));
              setHobbsEnd(e.target.value);
            }}
            hint="Optional — leave both Hobbs boxes empty if you don't use it"
          />
        </div>

        {/* WHERE you landed, not how many times.
            A count is what the currency rules read, but it isn't what a pilot
            knows at shutdown — they know they went Torrance, Santa Monica,
            Torrance, and the count falls out of that. Asking for the number
            instead throws the route away and then asks them to do arithmetic
            about their own flight. Repeats are counted every time: six
            circuits at the home field is KTOA six times. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Landed at"
            value={airports}
            onChange={(e) => setAirports(e.target.value)}
            placeholder="KTOA, KSMO, KTOA"
            error={airportsError ?? undefined}
            hint={airportsHint}
          />
          <Input
            label="Date flown"
            type="date"
            value={flownOn}
            onChange={(e) => setFlownOn(e.target.value)}
          />
        </div>

        <FlightTypeSelect value={purpose} onChange={setPurpose} />

        {meterError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{meterError}</p>
        ) : null}

        {/* What it comes to, before you commit to it. Same arithmetic and the
            same rounding as the flight log's own estimate. */}
        {tach != null ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
            <Summary label="Tach">{formatHours(tach)} hrs</Summary>
            {hobbs != null ? (
              <Summary label="Hobbs">{formatHours(hobbs)} hrs</Summary>
            ) : null}
            {cost != null ? (
              <Summary label="Est. cost">
                <span className="inline-flex items-center gap-1">
                  {formatCents(cost)}
                  <InfoTip label="Why: estimated cost">
                    {formatHours(tach)} tach hours at the club&rsquo;s hourly
                    rate for {selected?.tailNumber}. It is an estimate until the
                    flight is filed and the charge is written; a landing fee, if
                    there was one, is added from the post-flight form or the
                    flight log rather than here.
                  </InfoTip>
                </span>
              </Summary>
            ) : null}
          </dl>
        ) : null}
      </Card>

      {/* ── Optional: what went into the airplane ──────────────────────────
          Folded away by default. Fuel bought on a member's own card is what
          raises their FUEL_CREDIT, so it belongs on the same form as the
          flight rather than being a second errand on the Servicing page. */}
      <Card className="space-y-3">
        <button
          type="button"
          onClick={() => setShowFuel((v) => !v)}
          aria-expanded={showFuel}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Fuel &amp; oil <span className="font-normal text-gray-400">— optional</span>
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {fuelAdded || fuelPrice || oilAdded
                ? `${fuelAdded || "—"} gal${fuelPrice ? ` × $${fuelPrice}` : ""}${
                    fuelPrice ? (paidPersonally ? " · own card" : " · club card") : ""
                  }${oilAdded ? ` · ${oilAdded} qt oil` : ""}`
                : "Anything you put in after this flight"}
            </span>
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
              showFuel ? "rotate-180" : ""
            }`}
          >
            <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showFuel ? (
          <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Fuel added"
                type="number"
                step="0.1"
                min="0"
                value={fuelAdded}
                onChange={(e) => setFuelAdded(e.target.value)}
                hint="US gallons"
              />
              <Input
                label="Price per gallon"
                type="number"
                step="0.01"
                min="0"
                value={fuelPrice}
                onChange={(e) => setFuelPrice(e.target.value)}
                hint={fuelTotalHint(fuelAdded, fuelPrice) ?? "Dollars"}
              />
              <Input
                label="Oil added"
                type="number"
                step="0.5"
                min="0"
                value={oilAdded}
                onChange={(e) => setOilAdded(e.target.value)}
                hint="Quarts"
              />
            </div>
            {/* Whose card — the one fact that decides whether a credit is
                written. Always here rather than revealed once a cost is typed:
                it was gated on the cost box and people couldn't find it, which
                is the worst outcome for a control that decides whether
                somebody gets paid back. */}
            <Toggle
              checked={!paidPersonally}
              onChange={(clubCard) => setPaidPersonally(!clubCard)}
              offLabel="My card"
              onLabel="Club card"
              label="Fuel paid with the club's card"
            />

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Fuel with no flight goes on{" "}
              <Link
                href="/servicing"
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Add Fuel
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : null}
      </Card>

      {/* The button is NEVER disabled by a missing reading, which is the same
          rule the checkout pages' Complete button follows: a member who
          genuinely can't answer something must still be able to file what they
          DID do, and a button that won't press with no explanation is the
          worst version of that. An entry with a gap is a better record than no
          entry — it bills nothing until the number arrives, and filling it in
          from the log bills it then. What still stops a file is a meter
          ERROR, because that's a wrong number rather than a missing one. */}
      {/* Phone and tablet: File runs the full width, the easy target for a
          thumb at the tail, with its note beneath. A computer (`lg` up): the
          button sits at the RIGHT, where a form's submit is expected, and the
          note takes the left. `flex-row-reverse` keeps the button first in
          the DOM, so it's still the first thing tabbed to after the form. */}
      <div className="flex flex-col gap-2 lg:flex-row-reverse lg:items-center lg:justify-between lg:gap-4">
        <Button
          size="lg"
          className="w-full lg:w-auto"
          onClick={requestFile}
          disabled={busy || Boolean(meterError)}
        >
          {busy ? "Filing…" : "File"}
        </Button>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {draftSavedAt ? (
            <>
              Saved on this device ·{" "}
              <button
                type="button"
                onClick={resetTyped}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Discard
              </button>
            </>
          ) : (
            <>
              Goes straight to the{" "}
              <Link
                href="/log"
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                flight log
              </Link>
              , where it can be corrected or have a write-up added.
            </>
          )}
        </p>
      </div>

      {/* A missing reading files an honest GAP, not a refusal — but the member
          is told what that means, and how to close it, before it happens. */}
      <ConfirmModal
        open={confirmingGap}
        title={`File without a tach ${missingReading === "start & tach end" ? "reading" : missingReading}?`}
        confirmLabel="File anyway"
        cancelLabel="Keep editing"
        busy={busy}
        onConfirm={() => void submit()}
        onCancel={() => setConfirmingGap(false)}
      >
        <p>
          It goes into the flight log marked{" "}
          <strong>
            Needs tach {missingReading}
          </strong>{" "}
          and bills nothing yet.
        </p>
        <p>
          To finish it: open the entry in the <strong>Flight log</strong>, tap
          Edit, and add the reading. The hours bill as soon as it&rsquo;s saved.
        </p>
      </ConfirmModal>
    </div>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </dt>
      <dd className="font-mono font-medium">{children}</dd>
    </div>
  );
}
