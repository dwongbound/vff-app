"use client";
// Post-flight tab — what you fill in standing at the tail with the airplane
// still ticking.
//
// The form is ordered the way the numbers arrive: meters first (they're on the
// panel in front of you), then landings and route, then what you put back into
// the airplane. Tach start pre-fills from the airplane's last recorded reading,
// so the common case is typing one number.
//
// It is usually FINISHING something rather than starting one. Signing off the
// preflight card opens a flight session — a log row carrying the meters and the
// clock that walk read — and this form closes it out. The page loads that
// session as it opens and says so, so a member can see that the numbers in the
// start boxes are the ones they wrote at the airplane rather than a guess off
// the last filed flight. With no session open (nobody walked a card, or it was
// walked yesterday) the form files a fresh entry exactly as it always did, and
// the start boxes may be left EMPTY — a row with an end and no start is a real
// record of a flight, and better than none. See lib/flightSession.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DateTimeField from "@/components/common/DateTimeField";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import Toggle from "@/components/common/Toggle";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import CheckoutList from "@/components/CheckoutList";
import CollapsibleSection from "@/components/CollapsibleSection";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import PostflightDraftBar from "@/components/PostflightDraftBar";
import { usePostflightDraft } from "@/components/usePostflightDraft";
import { useMe } from "@/components/MeProvider";
import type { PostflightForm } from "@/lib/postflightDraft";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import {
  TURNOFF_CHECKOUT,
  initialValues,
  type Answers,
  type Values,
} from "@/lib/checkouts";
import { clubDateKey, formatDay, formatTime, formatTimeRange, toDateInputValue } from "@/lib/dates";
import { landingFeeFor, landingFeeInputFor } from "@/lib/landingFees";
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
  ApiFlightSummary,
  ApiMember,
  ApiReservation,
  ApiSquawk,
} from "@/lib/types";

/**
 * Where the form's own sections sit in the page's ONE numbered run.
 *
 * The turn-off checkout is sections 1..3 (it renders through the same
 * CheckoutList the preflight and runway pages use), and the form picks up
 * straight after it. Derived from the card rather than hard-coded, so adding a
 * section to the turn-off checkout renumbers the form instead of colliding
 * with it.
 */
const FIRST_FORM_INDEX = TURNOFF_CHECKOUT.sections.length + 1;
const FORM_SECTION_INDEX = {
  meters: FIRST_FORM_INDEX,
  flight: FIRST_FORM_INDEX + 1,
  servicing: FIRST_FORM_INDEX + 2,
  squawks: FIRST_FORM_INDEX + 3,
};

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
  // Whose card the fuel went on. Defaults to the member's own — the case that
  // needs paying back, and what recording a cost has always meant here. NOT in
  // the device draft: it's one radio pair with a safe default, and adding a
  // field to `PostflightForm` would invalidate every draft in the club's
  // pockets on deploy for the sake of restoring a boolean.
  const [fuelPaidPersonally, setFuelPaidPersonally] = useState(true);
  const [oilAdded, setOilAdded] = useState("");
  const [landingFee, setLandingFee] = useState("");
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
  /**
   * Which section is open — ONE piece of state for the whole page.
   *
   * The turn-off card's sections and the form's groups share it, which is what
   * makes "one section open at a time" true of the page rather than true twice
   * over. CheckoutList runs controlled off this (see its `openSectionId`);
   * without a single owner, opening Servicing would leave Shutdown expanded
   * above it and the page would scroll like two accordions stapled together.
   */
  const [openSection, setOpenSection] = useState<string>(
    TURNOFF_CHECKOUT.sections[0].id
  );
  const toggleFormSection = (id: string) =>
    setOpenSection((current) => (current === id ? "" : id));
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
  /**
   * The flight this form is here to FINISH, if there is one.
   *
   * Opened by whichever card was signed off first, and found by asking the
   * server rather than by remembering anything on the device — the walk may
   * have been done on the clubhouse iPad and the form filled in on a phone,
   * which is the case that makes "one flight, one row" worth having at all.
   */
  const [session, setSession] = useState<ApiFlightSummary | null>(null);
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

  // The session this form is finishing. Asked for on every load of the page and
  // deliberately NOT cached on the device: the only copy that can be trusted is
  // the club's, because the card that opened it may have been walked on a
  // different device entirely.
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
    landingFee: false,
  });

  // START, in order of how much the number knows about THIS flight:
  //   1. the open session — the reading the preflight walk wrote into the log
  //      entry this form is closing out. First because it is that entry's own
  //      column: whatever else changed since, this is where the flight began.
  //   2. today's preflight card, for a walk whose session has since been closed
  //      out or which never opened one.
  //   3. where the last filed flight left the airplane, which is what this page
  //      used before any of this existed and is still right when nobody walked
  //      a card today.
  // A disagreement between the last two usually means somebody flew and didn't
  // file, which is worth seeing rather than smoothing over.
  const walkedTach = todaysPreflight?.values["cockpit.meters.tach"];
  const walkedHobbs = todaysPreflight?.values["cockpit.meters.hobbs"];
  const lastTach = selected?.lastTach ?? null;
  const lastHobbs = selected?.lastHobbs ?? null;
  const startTach =
    session?.tachStart ?? (typeof walkedTach === "number" ? walkedTach : lastTach);
  const startHobbs =
    session?.hobbsStart ?? (typeof walkedHobbs === "number" ? walkedHobbs : lastHobbs);
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

  // The landing fee follows the airport you say you landed at, by the same
  // "mirrors until you type in it" rule as the meters above. It's a DEFAULT and
  // not a stamp: the table in lib/landingFees.ts is what the club expects KTOA
  // to charge, while what gets billed is whatever the pilot leaves in the box.
  //
  // Clearing back to "" when the airport has no fee on file is deliberate. Fly
  // KTOA → KCMA and the $6 that appeared for the home field must go away again,
  // or an untouched box would bill a fee for a field that never charged one.
  useEffect(() => {
    if (edited.landingFee) return;
    setLandingFee(landingFeeInputFor(arrival));
  }, [arrival, edited.landingFee]);

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
      landingFee,
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
      landingFee,
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
      setLandingFee(stored.landingFee);
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
      landingFee: false,
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
    setFuelPaidPersonally(true);
    setOilAdded("");
    setLandingFee("");
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
    const fromSession =
      box === "tachStart" ? session?.tachStart != null : session?.hobbsStart != null;
    if (edited[box]) return undefined;
    if (fromSession) return "from the flight you opened at the airplane";
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
  // Nulls, not NaN. An empty box is a reading nobody took, and `validateMeters`
  // now says so rather than refusing — a flight filed with no start reading is
  // a real entry with a gap in it. See lib/hours.ts.
  const meters = useMemo(
    () => ({
      tachStart: tachStart === "" ? null : Number(tachStart),
      tachEnd: tachEnd === "" ? null : Number(tachEnd),
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
    }),
    [tachStart, tachEnd, hobbsStart, hobbsEnd, hobbsPair]
  );

  // The end reading is the one this form exists to collect; the start may be
  // left empty. Only nag once there's something to nag about — an empty form
  // isn't wrong yet, it's just empty.
  const hasEndTach = tachEnd !== "";
  const meterError = hasEndTach ? validateMeters(meters) : null;
  const tach = meterError ? null : tachHours(meters);
  const hobbs = meterError ? null : hobbsHours(meters);
  const cost =
    tach != null ? flightCostCents(meters, selected?.hourlyRateCents) : null;

  async function submit() {
    if (!selected) return;
    setError(null);
    setSaved(null);

    if (meterError || !hasEndTach) {
      setError(meterError ?? "Enter the tach reading at shutdown.");
      return;
    }

    setBusy(true);
    // Stop saving for the duration: a write landing between the POST and the
    // form being cleared would store a draft of an entry that has just been
    // filed, and the next visit would offer to restore it.
    draft.freeze();
    const result = await sendJson<ApiFlight>("/api/flights", "POST", {
      aircraftId: selected.id,
      // The entry this form is finishing, when there is one. The server looks
      // for it as well (a stale tab must not open a second row for the same
      // flight), so this is the fast path rather than the only one.
      flightId: session?.id ?? null,
      reservationId: reservationId || null,
      flownOn: new Date(`${flownOn}T12:00:00`).toISOString(), // local midday: date-only, TZ-safe
      tachStart: tachStart === "" ? null : Number(tachStart),
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
      fuelPaidPersonally,
      oilAddedQts: oilAdded === "" ? null : Number(oilAdded),
      landingFeeDollars: landingFee === "" ? null : Number(landingFee),
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
    // Hours only when the flight has a measurable span. Filed with no start
    // reading it hasn't got one, and claiming "0.0 hours" would be the app
    // asserting something nobody told it.
    const filedHours = tachHours(meters);
    setSaved(
      filedHours != null
        ? `Filed ${formatHours(filedHours)} hours on ${selected.tailNumber}. Thanks for closing it out.`
        : `Filed on ${selected.tailNumber} with no start reading — add it from the flight log and the hours will follow.`
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
      // Back to following the airport, which is about to be blank: the next leg
      // may well land somewhere else, and carrying this one's fee across would
      // bill the member for a field they haven't reached yet.
      landingFee: false,
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
    setFuelPaidPersonally(true);
    setOilAdded("");
    setLandingFee("");
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
    // And this member no longer has the airplane out. Re-asking rather than
    // clearing the state by hand: a member who flies twice in an afternoon may
    // already have walked the next preflight card, in which case there IS
    // another session and the form should pick it up.
    await Promise.all([loadBookings(), loadSession()]);
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

      {/* Which flight this is. A session opened at the airplane is the common
          case now, and saying so is what makes the prefilled start meters
          believable — a number that appears in a box with no explanation is one
          members type over. Quiet rather than loud: it's confirmation, not a
          warning, so it reads as a line rather than as a banner. */}
      {session && (
        <div
          className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm
            text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40
            dark:text-indigo-200"
        >
          Closing out the flight you opened
          {session.startedAt ? ` at ${formatTime(session.startedAt)}` : ""}
          {session.tachStart != null
            ? `, tach ${session.tachStart.toFixed(1)}.`
            : "."}{" "}
          Filing this form finishes that log entry rather than starting a new one.
        </div>
      )}

      {/* The turn-off checkout comes FIRST: it's the back of the airplane's
          card and you work it standing at the tail, and its shutdown section is
          where you read the tach off the panel. Recording it here is what
          prefills the meters below, so the form follows what you actually did
          rather than making you jump back up the page.

          Rendered by the SAME component the preflight and runway pages use, in
          the same call shape, with no wrapper card or heading of its own — it
          used to sit inside a titled Card, which drew a box around a box and
          made the one checkout members meet at the end of every flight look
          like a different kind of thing from the two they had just walked.

          The draft bar goes in the sticky strip's `status` slot for the same
          reason it does there: where you are and whether your work is kept are
          one glance, in the one strip that follows you down the page. */}
      <CheckoutList
        checkout={TURNOFF_CHECKOUT}
        answers={turnoffAnswers}
        onChange={setTurnoffAnswers}
        values={turnoffValues}
        onValuesChange={setTurnoffValues}
        openSectionId={openSection}
        onOpenSection={setOpenSection}
        status={
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
        }
      />

      {/* Meters first — you're reading them off the panel right now. */}
      <CollapsibleSection
        index={FORM_SECTION_INDEX.meters}
        title="Meter readings"
        subtitle="Off the panel, engine just shut down"
        meta={tach != null ? `${formatHours(tach)} hr` : undefined}
        open={openSection === "form.meters"}
        onToggle={() => toggleFormSection("form.meters")}
      >
        <div className="space-y-4 p-4">
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
            {/* Its own figure rather than folded into "Est. cost": that number
                is the tach reading times the rate, and a member checking the
                arithmetic against the meters has to be able to. */}
            {Number(landingFee) > 0 && (
              <span>
                <span className="text-gray-500 dark:text-gray-400">Landing fee </span>
                <span className="font-semibold tabular">
                  {formatCents(Math.round(Number(landingFee) * 100))}
                </span>
              </span>
            )}
          </div>
        )}
        </div>
      </CollapsibleSection>

      {/* The flight itself. */}
      <CollapsibleSection
        index={FORM_SECTION_INDEX.flight}
        title="The flight"
        subtitle="Where you went, and who was on board"
        meta={`${landings || 0} ldg`}
        open={openSection === "form.flight"}
        onToggle={() => toggleFormSection("form.flight")}
      >
        <div className="space-y-4 p-4">

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
          {/* Beside "To" rather than down in Servicing: it's a consequence of
              where you landed, and the member can see the box fill in as they
              type the airport. Servicing is what went back INTO the airplane. */}
          <Input
            label="Landing fee"
            type="number"
            step="0.01"
            min="0"
            value={landingFee}
            onChange={(e) => {
              setEdited((prev) => ({ ...prev, landingFee: true }));
              setLandingFee(e.target.value);
            }}
            hint={
              landingFeeFor(arrival) != null && !edited.landingFee
                ? `${arrival.trim().toUpperCase()}'s usual fee — change it if you paid something else`
                : "dollars, billed to you"
            }
          />
        </div>
        <Input
          label="Route (optional)"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="KTOA → KCMA → practice area → KTOA"
        />
        <SwitchRow
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
        </div>
      </CollapsibleSection>

      {/* What you put back into the airplane. */}
      <CollapsibleSection
        index={FORM_SECTION_INDEX.servicing}
        title="Servicing"
        subtitle="What went back into the airplane"
        meta={fuelAdded ? `${fuelAdded} gal` : undefined}
        open={openSection === "form.servicing"}
        onToggle={() => toggleFormSection("form.servicing")}
      >
        <div className="space-y-4 p-4">
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

        {/* Whose card. Fuel on the CLUB's card is the club buying its own
            fuel and raises no credit; fuel on the member's is a debt the club
            owes them. Recording a cost here used to mean the second
            unconditionally, which quietly credited members for club-card
            fills. */}
        <Toggle
          checked={!fuelPaidPersonally}
          onChange={(clubCard) => setFuelPaidPersonally(!clubCard)}
          offLabel="My card"
          onLabel="Club card"
          label="Fuel paid with the club's card"
        />

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
        </div>
      </CollapsibleSection>


      {/* Squawks found on this flight. The Report button lives in the BODY
          rather than the header: the header is itself a <button>, and nesting
          one inside it is the same invalid markup the checkout rows avoid for
          their (i) markers. */}
      <CollapsibleSection
        index={FORM_SECTION_INDEX.squawks}
        title="Squawks from this flight"
        subtitle="Anything the next member should know"
        meta={squawkDrafts.length > 0 ? String(squawkDrafts.length) : undefined}
        open={openSection === "form.squawks"}
        onToggle={() => toggleFormSection("form.squawks")}
      >
        <div className="space-y-3 p-4">
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSquawkModalOpen(true)}
            >
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
        </div>
      </CollapsibleSection>

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
          disabled={busy || !hasEndTach || Boolean(meterError)}
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
/**
 * A bordered row with a switch and ONE label — an on/off assertion about this
 * flight ("flown with an instructor").
 *
 * Deliberately not `common/Toggle`, which names BOTH sides and is for a choice
 * between two things. Here there is no second thing to name: the opposite of
 * "flown with an instructor" is the ordinary case and doesn't want a word.
 */
function SwitchRow({
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
