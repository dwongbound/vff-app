"use client";
// Post-flight tab — what you fill in standing at the tail with the airplane
// still ticking.
//
// The form is ordered the way the numbers arrive: meters first (they're on the
// panel in front of you), then landings and route, then what you put back into
// the airplane. Tach start pre-fills from the airplane's last recorded reading,
// so the common case is typing one number.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DateTimeField from "@/components/common/DateTimeField";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import TurnoffCheckout from "@/components/TurnoffCheckout";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import PostflightDraftBar from "@/components/PostflightDraftBar";
import { usePostflightDraft } from "@/components/usePostflightDraft";
import { useMe } from "@/components/MeProvider";
import type { PostflightForm } from "@/lib/postflightDraft";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { initialValues, type Answers, type Values } from "@/lib/checkouts";
import { clubDateKey, formatDay, formatTimeRange, toDateInputValue } from "@/lib/dates";
import {
  flightCostCents,
  formatCents,
  formatHours,
  hobbsHours,
  tachHours,
  validateMeters,
} from "@/lib/hours";
import type {
  ApiCheckout,
  ApiFlight,
  ApiMember,
  ApiReservation,
  ApiSquawk,
} from "@/lib/types";

export default function PostflightPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  // See the preflight page: depend on the id, not the object identity.
  const aircraftId = selected?.id ?? null;

  const [reservationId, setReservationId] = useState("");
  const [flownOn, setFlownOn] = useState(() => toDateInputValue(new Date()));
  const [tachStart, setTachStart] = useState("");
  const [tachEnd, setTachEnd] = useState("");
  const [hobbsStart, setHobbsStart] = useState("");
  const [hobbsEnd, setHobbsEnd] = useState("");
  const [landings, setLandings] = useState("1");
  const [nightLandings, setNightLandings] = useState("0");
  const [withInstructor, setWithInstructor] = useState(false);
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [route, setRoute] = useState("");
  const [fuelAdded, setFuelAdded] = useState("");
  const [fuelCost, setFuelCost] = useState("");
  const [oilAdded, setOilAdded] = useState("");
  // The turn-off checkout replaces the old "tied down"/"cabin clean" toggles:
  // the API derives both flags from these answers, so the log records what the
  // pilot confirmed rather than a default nobody moved.
  const [turnoffAnswers, setTurnoffAnswers] = useState<Answers>({});
  // "Flight timer — stop" opens at the club's current clock, since this page
  // is filled in with the airplane just shut down. Overridable, like every
  // other reading on a card (see `initialValues`).
  const [turnoffValues, setTurnoffValues] = useState<Values>(() =>
    initialValues("TURNOFF")
  );
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [squawkDrafts, setSquawkDrafts] = useState<SquawkDraft[]>([]);
  const [squawkModalOpen, setSquawkModalOpen] = useState(false);

  // My bookings that haven't been closed out yet — the flight you just made is
  // almost always one of them.
  const [openBookings, setOpenBookings] = useState<ApiReservation[] | null>(null);
  // The CFI on board, for a lesson that wasn't booked in the app. A booked
  // lesson already names one and the server copies it across — see
  // `bookedInstructor` below, which is why this picker hides in that case.
  const [instructorId, setInstructorId] = useState("");
  const [instructors, setInstructors] = useState<ApiMember[] | null>(null);
  /** Today's signed-off preflight walk, if there is one — the start meters. */
  const [todaysPreflight, setTodaysPreflight] = useState<ApiCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // See the reservations page for why this isn't just `openBookings === null`.
  const showSplash = fleetLoading || (selected !== null && openBookings === null);
  usePageLoading(showSplash);

  const loadBookings = useCallback(async () => {
    if (!aircraftId) return;
    // Everything of mine from the last two weeks through now — a flight filed
    // days late still finds its booking.
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const rows = await fetchJsonArray<ApiReservation>(
      `/api/reservations?aircraftId=${aircraftId}&mine=1&from=${from}&to=${to}`
    );
    setOpenBookings(rows.filter((r) => !r.hasFlight));
  }, [aircraftId]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Today's preflight walk, for the start meters below. Only TODAY's: a reading
  // from last week is a number about a different flight, and quietly prefilling
  // it would be worse than leaving the box empty.
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

  // The roster, only once somebody says they flew with an instructor. Most
  // flights aren't lessons, and this page otherwise never needs it.
  useEffect(() => {
    if (!withInstructor || instructors !== null) return;
    let live = true;
    fetchJsonArray<ApiMember>("/api/members").then((rows) => {
      if (live) setInstructors(rows.filter((m) => m.positions.includes("INSTRUCTOR")));
    });
    return () => {
      live = false;
    };
  }, [withInstructor, instructors]);

  /** The CFI the chosen booking already names, if any. */
  const bookedInstructor =
    (openBookings ?? []).find((r) => r.id === reservationId)?.instructor?.name ??
    null;

  // ── Where the four meter numbers come from ──────────────────────────────
  //
  // Ideally: nowhere the member has to type twice. Both ends of the flight are
  // already read off the panel ON A CARD — the preflight's "Tach & Hobbs —
  // recorded" at the start, the turn-off's "Tach & Hobbs — record time in
  // flight log" at the end — so this card's job is to SHOW what those cards
  // captured, not to ask again. A member who filled in both checkouts should
  // be able to scroll past it.
  //
  // Each box MIRRORS its card until the member types in the box itself, at
  // which point that one field stops following and their correction stands.
  //
  // "Until it's empty" was the old rule and it was subtly wrong the moment the
  // upstream field became one being typed into live: the first keystroke of
  // "1506.1" arrives as `1`, the box is still empty so it takes it, and every
  // keystroke after that is ignored because the box is no longer empty. The
  // meter card sat there reading "1" under a checklist reading 1506.1. What
  // decides whether a prefill still applies has to be "has the member edited
  // THIS box", never "does it happen to hold something".
  const [edited, setEdited] = useState({
    tachStart: false,
    tachEnd: false,
    hobbsStart: false,
    hobbsEnd: false,
  });

  // START, first choice: what today's preflight walk actually read off the
  // panel. Second choice: where the last filed flight left the airplane, which
  // is what this page used before and is still right when nobody walked the
  // card today. A disagreement between the two usually means somebody flew and
  // didn't file, which is worth seeing rather than smoothing over.
  const walkedTach = todaysPreflight?.values["cockpit.meters.tach"];
  const walkedHobbs = todaysPreflight?.values["cockpit.meters.hobbs"];
  const lastTach = selected?.lastTach ?? null;
  const lastHobbs = selected?.lastHobbs ?? null;
  const startTach = typeof walkedTach === "number" ? walkedTach : lastTach;
  const startHobbs = typeof walkedHobbs === "number" ? walkedHobbs : lastHobbs;
  useEffect(() => {
    if (startTach != null && !edited.tachStart) setTachStart(String(startTach));
  }, [startTach, edited.tachStart]);
  useEffect(() => {
    if (startHobbs != null && !edited.hobbsStart) setHobbsStart(String(startHobbs));
  }, [startHobbs, edited.hobbsStart]);

  // END: the two numbers the pilot just wrote on the shutdown item ARE the end
  // readings. Nothing else on the airplane knows them.
  const recordedTach = turnoffValues["shutdown.tach.hours"];
  const recordedHobbs = turnoffValues["shutdown.tach.hobbs"];
  useEffect(() => {
    if (typeof recordedTach === "number" && !edited.tachEnd) {
      setTachEnd(String(recordedTach));
    }
  }, [recordedTach, edited.tachEnd]);
  useEffect(() => {
    if (typeof recordedHobbs === "number" && !edited.hobbsEnd) {
      setHobbsEnd(String(recordedHobbs));
    }
  }, [recordedHobbs, edited.hobbsEnd]);

  // ── Autosave ────────────────────────────────────────────────────────────
  //
  // The same promise the checkout cards make: leave the page, come back, your
  // work is still here. It used to be false on this one page, which is the
  // worst place for it to be false — the form is filled in standing at the
  // tail, one-handed, and walking away to push the airplane back was enough to
  // lose the lot.
  //
  // Device only, and the bar says so: there is no server row to sync a
  // post-flight entry to until it's filed. See lib/postflightDraft.ts.
  const form: PostflightForm = useMemo(
    () => ({
      reservationId,
      flownOn,
      tachStart,
      tachEnd,
      hobbsStart,
      hobbsEnd,
      landings,
      nightLandings,
      withInstructor,
      instructorId,
      departure,
      arrival,
      route,
      fuelAdded,
      fuelCost,
      oilAdded,
      notes,
      turnoffAnswers,
      turnoffValues,
      edited,
      // Files can't be stored, so the TEXT of a squawk is kept and the fact
      // that pictures were attached is recorded — see the module comment.
      squawks: squawkDrafts.map((d) => ({
        title: d.title,
        description: d.description,
        hadPhotos: d.photos.length > 0,
      })),
      hadPhotos: photos.length > 0,
    }),
    [
      reservationId,
      flownOn,
      tachStart,
      tachEnd,
      hobbsStart,
      hobbsEnd,
      landings,
      nightLandings,
      withInstructor,
      instructorId,
      departure,
      arrival,
      route,
      fuelAdded,
      fuelCost,
      oilAdded,
      notes,
      turnoffAnswers,
      turnoffValues,
      edited,
      squawkDrafts,
      photos,
    ]
  );

  const draft = usePostflightDraft({
    aircraftId,
    memberId: me?.id ?? null,
    form,
    onRestore: useCallback((stored) => {
      setReservationId(stored.reservationId);
      if (stored.flownOn) setFlownOn(stored.flownOn);
      setTachStart(stored.tachStart);
      setTachEnd(stored.tachEnd);
      setHobbsStart(stored.hobbsStart);
      setHobbsEnd(stored.hobbsEnd);
      if (stored.landings) setLandings(stored.landings);
      if (stored.nightLandings) setNightLandings(stored.nightLandings);
      setWithInstructor(stored.withInstructor);
      setInstructorId(stored.instructorId);
      setDeparture(stored.departure);
      setArrival(stored.arrival);
      setRoute(stored.route);
      setFuelAdded(stored.fuelAdded);
      setFuelCost(stored.fuelCost);
      setOilAdded(stored.oilAdded);
      setNotes(stored.notes);
      setTurnoffAnswers(stored.turnoffAnswers);
      // Saved values win, but a field the draft never recorded keeps its
      // default — otherwise restoring an entry saved before a field existed
      // would blank it rather than leave it at its opening value.
      setTurnoffValues((defaults) => ({ ...defaults, ...stored.turnoffValues }));
      setEdited(stored.edited);
      // Photos are gone (files don't survive a reload); the text isn't.
      setSquawkDrafts(
        stored.squawks.map((sq) => ({
          title: sq.title,
          description: sq.description,
          photos: [],
        }))
      );
    }, []),
  });

  /** Clear the draft AND the form — the bar only knows about the first half. */
  function resetForm() {
    draft.reset();
    setReservationId("");
    setFlownOn(toDateInputValue(new Date()));
    setTachStart("");
    setTachEnd("");
    setHobbsStart("");
    setHobbsEnd("");
    setEdited({
      tachStart: false,
      tachEnd: false,
      hobbsStart: false,
      hobbsEnd: false,
    });
    setLandings("1");
    setNightLandings("0");
    setWithInstructor(false);
    setInstructorId("");
    setDeparture("");
    setArrival("");
    setRoute("");
    setFuelAdded("");
    setFuelCost("");
    setOilAdded("");
    setTurnoffAnswers({});
    setTurnoffValues(initialValues("TURNOFF"));
    setNotes("");
    setPhotos([]);
    setSquawkDrafts([]);
    setError(null);
    setSaved(null);
  }

  /**
   * What to say under a meter box: where the number in it came from.
   *
   * Written as four plain branches rather than a nested ternary in the JSX.
   * They ARE nearly the same shape twice over, and saying so twice is cheaper
   * to read than one clever expression that says it once.
   */
  function startHint(box: "tachStart" | "hobbsStart"): string | undefined {
    const walked = box === "tachStart" ? walkedTach : walkedHobbs;
    if (edited[box]) return undefined;
    if (typeof walked === "number") return "from today's preflight walk";
    if (box === "tachStart") return "from the last filed flight";
    return undefined;
  }

  function endHint(box: "tachEnd" | "hobbsEnd"): string | undefined {
    const recorded = box === "tachEnd" ? recordedTach : recordedHobbs;
    if (edited[box]) return undefined;
    if (typeof recorded === "number") return "from the turn-off checkout";
    return undefined;
  }

  // Hobbs counts as recorded only when BOTH readings are there. The start is
  // prefilled from the airplane, so without this a pilot who simply doesn't use
  // the Hobbs would be nagged for a reading they never took.
  const hobbsPair = hobbsStart !== "" && hobbsEnd !== "";
  const meters = useMemo(
    () => ({
      tachStart: Number(tachStart),
      tachEnd: Number(tachEnd),
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
    }),
    [tachStart, tachEnd, hobbsStart, hobbsEnd, hobbsPair]
  );

  const bothTach = tachStart !== "" && tachEnd !== "";
  // Only nag once there's something to nag about — an empty form isn't wrong
  // yet, it's just empty.
  const meterError = bothTach ? validateMeters(meters) : null;
  const tach = bothTach && !meterError ? tachHours(meters) : null;
  const hobbs = bothTach && !meterError ? hobbsHours(meters) : null;
  const cost =
    tach != null ? flightCostCents(meters, selected?.hourlyRateCents) : null;

  async function submit() {
    if (!selected) return;
    setError(null);
    setSaved(null);

    if (meterError || !bothTach) {
      setError(meterError ?? "Enter both tach readings.");
      return;
    }

    setBusy(true);
    // Stop saving for the duration: a write landing between the POST and the
    // form being cleared would store a draft of an entry that has just been
    // filed, and the next visit would offer to restore it.
    draft.freeze();
    const result = await sendJson<ApiFlight>("/api/flights", "POST", {
      aircraftId: selected.id,
      reservationId: reservationId || null,
      flownOn: new Date(`${flownOn}T12:00:00`).toISOString(), // local midday: date-only, TZ-safe
      tachStart: Number(tachStart),
      tachEnd: Number(tachEnd),
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
      landings: Number(landings || 1),
      nightLandings: Number(nightLandings || 0),
      withInstructor,
      // Only alongside the assertion it belongs to, and only when the booking
      // hasn't already answered it (the server resolves that one itself).
      instructorId:
        withInstructor && !bookedInstructor && instructorId ? instructorId : null,
      departure: departure.trim() || null,
      arrival: arrival.trim() || null,
      route: route.trim() || null,
      fuelAddedGal: fuelAdded === "" ? null : Number(fuelAdded),
      fuelCostDollars: fuelCost === "" ? null : Number(fuelCost),
      oilAddedQts: oilAdded === "" ? null : Number(oilAdded),
      turnoffAnswers,
      turnoffValues,
      notes: notes.trim() || null,
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      // The flight didn't file, so this is still live work — start saving again
      // rather than leaving the member typing into nothing.
      draft.thaw();
      setError(result.error ?? "Could not save the flight.");
      return;
    }

    const flightId = result.data.id;
    if (photos.length) await uploadPhotos(photos, "flight", flightId);
    // `pending`, not `draft`: that name belongs to the autosave hook now.
    for (const pending of squawkDrafts) {
      const squawk = await sendJson<ApiSquawk>("/api/squawks", "POST", {
        aircraftId: selected.id,
        flightId,
        title: pending.title,
        description: pending.description || null,
      });
      if (squawk.ok && squawk.data && pending.photos.length) {
        await uploadPhotos(pending.photos, "squawk", squawk.data.id);
      }
    }

    setBusy(false);
    setSaved(
      `Filed ${formatHours(tachHours(meters))} hours on ${selected.tailNumber}. Thanks for closing it out.`
    );

    // Reset for the next flight, but keep the meters in sync with what the
    // airplane now reads.
    setReservationId("");
    setTachStart(tachEnd);
    setTachEnd("");
    setHobbsStart(hobbsEnd);
    setHobbsEnd("");
    // The carried-over starts are this member's own numbers rather than a
    // card's, so they hold; the ends go back to following the turn-off card,
    // which is about to be blank again for the next flight.
    setEdited({
      tachStart: true,
      tachEnd: false,
      hobbsStart: true,
      hobbsEnd: false,
    });
    setLandings("1");
    setNightLandings("0");
    setWithInstructor(false);
    setInstructorId("");
    setDeparture("");
    setArrival("");
    setRoute("");
    setFuelAdded("");
    setFuelCost("");
    setOilAdded("");
    setTurnoffAnswers({});
    setTurnoffValues(initialValues("TURNOFF"));
    setNotes("");
    setPhotos([]);
    setSquawkDrafts([]);
    // The entry is the club's record now rather than a draft, so the device
    // copy goes — otherwise the next visit offers to restore a filed flight.
    draft.finish();

    // The filed flight advanced the airplane's meters, so everyone's view of
    // it is stale — one event, which the provider turns into one refetch.
    notifyAircraftChanged();
    await loadBookings();
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Post-flight</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber}
          {selected.lastTach != null && ` · last tach ${selected.lastTach.toFixed(1)}`}
        </p>
      </header>

      {/* Where this entry stands, and the only way to throw it away. Above the
          form rather than at the foot of it: the question it answers ("if I
          walk away now, is this kept?") is one a member asks before they start,
          not after they finish. */}
      <PostflightDraftBar
        savedAt={draft.savedAt}
        storageBlocked={draft.storageBlocked}
        restoredAt={draft.restored?.savedAt ?? null}
        droppedFiles={
          (draft.restored?.hadPhotos ?? false) ||
          (draft.restored?.squawks ?? []).some((sq) => sq.hadPhotos)
        }
        dirty={draft.dirty}
        onReset={resetForm}
      />

      {/* The turn-off checkout comes FIRST: it's the back of the airplane's
          card and you work it standing at the tail, and its shutdown section is
          where you read the tach off the panel. Recording it here is what
          prefills the meters below, so the form follows what you actually did
          rather than making you jump back up the page. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Turn-off checkout</h2>
        <TurnoffCheckout
          answers={turnoffAnswers}
          onChange={setTurnoffAnswers}
          values={turnoffValues}
          onValuesChange={setTurnoffValues}
        />
      </Card>

      {/* Meters first — you're reading them off the panel right now. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Meter readings</h2>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Tach start"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={tachStart}
            onChange={(e) => {
              setTachStart(e.target.value);
              setEdited((f) => (f.tachStart ? f : { ...f, tachStart: true }));
            }}
            hint={startHint("tachStart")}
          />
          <Input
            label="Tach end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={tachEnd}
            onChange={(e) => {
              setTachEnd(e.target.value);
              setEdited((f) => (f.tachEnd ? f : { ...f, tachEnd: true }));
            }}
            hint={endHint("tachEnd")}
          />
          <Input
            label="Hobbs start"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsStart}
            onChange={(e) => {
              setHobbsStart(e.target.value);
              setEdited((f) => (f.hobbsStart ? f : { ...f, hobbsStart: true }));
            }}
            hint={startHint("hobbsStart")}
          />
          <Input
            label="Hobbs end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsEnd}
            onChange={(e) => {
              setHobbsEnd(e.target.value);
              setEdited((f) => (f.hobbsEnd ? f : { ...f, hobbsEnd: true }));
            }}
            hint={endHint("hobbsEnd")}
          />
        </div>

        {meterError && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            {meterError}
          </p>
        )}

        {/* Live totals: the numbers the club actually cares about, computed as
            you type so a fat-fingered reading is obvious immediately. */}
        {tach != null && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-700/50">
            <span>
              <span className="text-gray-500 dark:text-gray-400">Tach </span>
              <span className="font-semibold tabular">{formatHours(tach)} hr</span>
            </span>
            {hobbs != null && (
              <span>
                <span className="text-gray-500 dark:text-gray-400">Hobbs </span>
                <span className="font-semibold tabular">{formatHours(hobbs)} hr</span>
              </span>
            )}
            {cost != null && (
              <span>
                <span className="text-gray-500 dark:text-gray-400">Est. cost </span>
                <span className="font-semibold tabular">{formatCents(cost)}</span>
              </span>
            )}
          </div>
        )}
      </Card>

      {/* The flight itself. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">The flight</h2>

        {openBookings && openBookings.length > 0 && (
          <Select
            label="Closes out which booking?"
            value={reservationId}
            onChange={(e) => setReservationId(e.target.value)}
          >
            <option value="">Not against a booking</option>
            {openBookings.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDay(r.startsAt)} · {formatTimeRange(r.startsAt, r.endsAt)}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <DateTimeField
            label="Date flown"
            mode="date"
            value={flownOn}
            onChange={setFlownOn}
            // You can file a flight late, but not one you haven't flown yet.
            max={toDateInputValue(new Date())}
          />
          <Input
            label="Landings"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={landings}
            onChange={(e) => setLandings(e.target.value)}
          />
          <Input
            label="Night landings"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={nightLandings}
            onChange={(e) => setNightLandings(e.target.value)}
            hint="to a full stop — that's what counts for currency"
          />
          <Input
            label="From"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            placeholder="KTOA"
            className="uppercase"
          />
          <Input
            label="To"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            placeholder="KTOA"
            className="uppercase"
          />
        </div>
        <Input
          label="Route (optional)"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="KTOA → KCMA → practice area → KTOA"
        />
        <Toggle
          checked={withInstructor}
          onChange={setWithInstructor}
          label="Flown with an approved flight instructor"
        />
        {/* Who it was. Only once the box is ticked, and only when the booking
            hasn't already answered it: filing against a TRAINING reservation
            carries the CFI across on the server, and asking again would invite
            two different answers to the same question. Naming them is what
            puts this entry in their Teaching list to sign. */}
        {withInstructor && !bookedInstructor && (
          <div>
            <Select
              label="Instructor (optional)"
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
            >
              <option value="">Not recorded</option>
              {(instructors ?? []).map((cfi) => (
                <option key={cfi.id} value={cfi.id}>
                  {cfi.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {instructors && instructors.length === 0
                ? "No CFIs on the roster yet — an admin adds the Flight Instructor role from the Members tab."
                : "They can sign off this entry afterwards."}
            </p>
          </div>
        )}
        {withInstructor && bookedInstructor && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Booked with {bookedInstructor} — they&rsquo;ll be recorded as the
            instructor on this entry.
          </p>
        )}
      </Card>

      {/* What you put back into the airplane. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Servicing</h2>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Fuel added"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={fuelAdded}
            onChange={(e) => setFuelAdded(e.target.value)}
            hint="gallons"
          />
          <Input
            label="Fuel cost"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={fuelCost}
            onChange={(e) => setFuelCost(e.target.value)}
            hint="dollars"
          />
          <Input
            label="Oil added"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={oilAdded}
            onChange={(e) => setOilAdded(e.target.value)}
            hint="quarts"
          />
        </div>

        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the next pilot should know."
        />
        <PhotoUploader
          files={photos}
          onChange={setPhotos}
          hint="A shot of the Hobbs/tach is the easiest way to settle a dispute later."
        />
      </Card>


      {/* Squawks found on this flight. */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Squawks from this flight</h2>
          <Button variant="secondary" size="sm" onClick={() => setSquawkModalOpen(true)}>
            Report
          </Button>
        </div>
        {squawkDrafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing reported — the airplane goes back on the line as-is. Report
            anything you found and it's filed with this flight, for the next
            member to read before they fly it.
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
        <Button
          size="lg"
          onClick={submit}
          disabled={busy || !bothTach || Boolean(meterError)}
          className="w-full sm:w-auto"
        >
          {busy ? <LoadingDots size="sm" /> : "File"}
        </Button>
      </div>

      <SquawkDraftModal
        open={squawkModalOpen}
        onClose={() => setSquawkModalOpen(false)}
        onAdd={(draft) => setSquawkDrafts((rows) => [...rows, draft])}
      />
    </div>
  );
}

// Big switch-style checkbox — the two put-away questions are answered with a
// thumb, not a pointer.
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
    >
      <span
        className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
      <span className={checked ? "" : "text-gray-500 dark:text-gray-400"}>{label}</span>
    </button>
  );
}
