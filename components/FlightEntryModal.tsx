"use client";
// Add a flight to the log by hand.
//
// The Post-flight tab is still the front door — it prefills the meters, walks
// the turn-off checkout and closes out your booking, and it's what you use
// when you've just landed. This is the OTHER case, which every club has: a
// flight from last month that never got filed, a page of the paper log being
// caught up, a hop somebody flew while the app was down. Making that go
// through a form built around "you just got back" means back-dating a
// checkout you never walked, so it gets its own entry point instead.
//
// What it deliberately does NOT collect: the turn-off checkout. Those ticks
// mean "I confirmed this at the airplane", and there is no honest way to
// answer them a fortnight later — the API already knows a flight filed
// without them is a late entry and leaves the put-away flags alone (see
// `answeredTurnoff` in app/api/flights/route.ts).
import { useEffect, useMemo, useState } from "react";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { toDateInputValue } from "@/lib/dates";
import { formatHours, tachHours, validateMeters } from "@/lib/hours";
import type { ApiAircraft, ApiFlight, ApiMember } from "@/lib/types";

export default function FlightEntryModal({
  open,
  aircraft,
  onClose,
  onSaved,
}: {
  open: boolean;
  aircraft: ApiAircraft;
  onClose: () => void;
  /** The flight that was just written, so the page can fold it in. */
  onSaved: (flight: ApiFlight) => void;
}) {
  const [flownOn, setFlownOn] = useState(() => toDateInputValue(new Date()));
  // Tach start opens at the airplane's last known reading — the common case is
  // catching up the most recent flight — but unlike the post-flight form it is
  // NOT re-synced as the airplane moves: you're transcribing a specific entry,
  // and having the box change under you would be worse than typing it.
  const [tachStart, setTachStart] = useState(
    aircraft.lastTach == null ? "" : String(aircraft.lastTach)
  );
  const [tachEnd, setTachEnd] = useState("");
  const [hobbsStart, setHobbsStart] = useState("");
  const [hobbsEnd, setHobbsEnd] = useState("");
  const [landings, setLandings] = useState("1");
  const [nightLandings, setNightLandings] = useState("0");
  const [withInstructor, setWithInstructor] = useState(false);
  // The CFI who was on board. "" = not recorded, which is legal — a member
  // catching up an old entry may not remember, and an entry with no name on it
  // is better than one with a guess.
  const [instructorId, setInstructorId] = useState("");

  // The club's CFIs, for that picker. Fetched when the modal first opens
  // rather than on mount: most hand-entered flights aren't lessons, and the
  // log otherwise never asks for the roster.
  const [instructors, setInstructors] = useState<ApiMember[] | null>(null);
  useEffect(() => {
    if (!open || instructors !== null) return;
    let live = true;
    fetchJsonArray<ApiMember>("/api/members").then((rows) => {
      if (live) setInstructors(rows.filter((m) => m.positions.includes("INSTRUCTOR")));
    });
    return () => {
      live = false;
    };
  }, [open, instructors]);
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [route, setRoute] = useState("");
  const [fuelAddedGal, setFuelAddedGal] = useState("");
  const [fuelCostDollars, setFuelCostDollars] = useState("");
  const [oilAddedQts, setOilAddedQts] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numeric = (v: string) => (v.trim() === "" ? null : Number(v));

  // The same check the API runs, run as you type — a mis-read meter is the
  // error this form exists to catch, and finding out after you hit Add is a
  // worse place to find out.
  const meters = {
    tachStart: numeric(tachStart),
    tachEnd: numeric(tachEnd),
    hobbsStart: numeric(hobbsStart),
    hobbsEnd: numeric(hobbsEnd),
  };
  const bothTach = meters.tachStart != null && meters.tachEnd != null;
  const meterError = useMemo(
    () =>
      bothTach
        ? validateMeters({
            tachStart: meters.tachStart as number,
            tachEnd: meters.tachEnd as number,
            hobbsStart: meters.hobbsStart,
            hobbsEnd: meters.hobbsEnd,
          })
        : null,
    [bothTach, meters.tachStart, meters.tachEnd, meters.hobbsStart, meters.hobbsEnd]
  );

  const hours = bothTach
    ? tachHours({
        tachStart: meters.tachStart as number,
        tachEnd: meters.tachEnd as number,
      })
    : null;

  const ready = bothTach && !meterError && flownOn !== "" && !busy;

  async function save() {
    setError(null);
    setBusy(true);
    const result = await sendJson<ApiFlight>("/api/flights", "POST", {
      aircraftId: aircraft.id,
      // Noon, not midnight: `flownOn` is a calendar day, and midnight local
      // read back in another zone slides the flight to the day before.
      flownOn: `${flownOn}T12:00:00`,
      tachStart: numeric(tachStart),
      tachEnd: numeric(tachEnd),
      hobbsStart: numeric(hobbsStart),
      hobbsEnd: numeric(hobbsEnd),
      landings: numeric(landings) ?? 1,
      nightLandings: numeric(nightLandings) ?? 0,
      withInstructor,
      // Only sent alongside the assertion it belongs to: unticking the box
      // must not leave a CFI's name on a flight they weren't on.
      instructorId: withInstructor && instructorId ? instructorId : null,
      departure: departure.trim() || null,
      arrival: arrival.trim() || null,
      route: route.trim() || null,
      fuelAddedGal: numeric(fuelAddedGal),
      fuelCostDollars: numeric(fuelCostDollars),
      oilAddedQts: numeric(oilAddedQts),
      notes: notes.trim() || null,
    });
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not add that flight.");
      return;
    }
    onSaved(result.data);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a flight"
      subtitle={`${aircraft.tailNumber} — for a flight that was never filed at the time`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {hours != null && !meterError
              ? `${formatHours(hours)} tach hours`
              : "Tach readings are what bill the flight."}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!ready}>
              {busy ? <LoadingDots size="sm" /> : "Add to log"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Filed under YOUR name, always. An entry that could be attributed to
            anyone is a record of who was asked to type it, not of who flew —
            and the flight charge lands on whoever it names. */}
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
          This files a flight with you as pilot in command, and bills it the
          same as one filed from the Post-flight tab. To close out a booking,
          use Post-flight instead.
        </p>

        <Input
          label="Date flown"
          type="date"
          value={flownOn}
          onChange={(e) => setFlownOn(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Tach start"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={tachStart}
            onChange={(e) => setTachStart(e.target.value)}
            hint={
              aircraft.lastTach == null
                ? undefined
                : `Airplane is at ${aircraft.lastTach.toFixed(1)}`
            }
          />
          <Input
            label="Tach end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={tachEnd}
            onChange={(e) => setTachEnd(e.target.value)}
            error={meterError}
          />
          {/* Optional, and stays optional: this airplane's log is tach-only,
              so an empty pair here is the normal case rather than a gap. */}
          <Input
            label="Hobbs start"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsStart}
            onChange={(e) => setHobbsStart(e.target.value)}
            hint="Optional"
          />
          <Input
            label="Hobbs end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsEnd}
            onChange={(e) => setHobbsEnd(e.target.value)}
            hint="Optional"
          />
          <Input
            label="Landings"
            type="number"
            inputMode="numeric"
            min="0"
            value={landings}
            onChange={(e) => setLandings(e.target.value)}
          />
          <Input
            label="Night landings"
            type="number"
            inputMode="numeric"
            min="0"
            value={nightLandings}
            onChange={(e) => setNightLandings(e.target.value)}
            hint="Full-stop only — that's what counts for currency."
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={withInstructor}
            onChange={(e) => setWithInstructor(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
          />
          <span>Flown with an approved instructor</span>
        </label>

        {/* Who it was, so the entry can be signed. Only once the box is ticked:
            an empty CFI picker on every hand-entered local flight is a question
            nobody was asked. Naming them here is what puts this entry in their
            Teaching list — a lesson that was never booked in the app has no
            other way of getting there. */}
        {withInstructor && (
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
            {/* Outside the <label>, like every hint in the app — inside, it
                becomes part of the field's accessible name. */}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {instructors && instructors.length === 0
                ? "No CFIs on the roster yet — an admin adds the Flight Instructor role from the Members tab."
                : "They can sign off this entry afterwards."}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="From"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            placeholder="KBFI"
            className="uppercase"
          />
          <Input
            label="To"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            placeholder="KBFI"
            className="uppercase"
          />
        </div>
        <Input
          label="Route"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="KBFI → KWVI → KBFI"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Fuel added"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={fuelAddedGal}
            onChange={(e) => setFuelAddedGal(e.target.value)}
            hint="Gallons"
          />
          {/* Dollars in, cents stored — the receipt is in dollars, and the API
              takes either spelling so the form doesn't do money arithmetic. */}
          <Input
            label="Fuel cost"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={fuelCostDollars}
            onChange={(e) => setFuelCostDollars(e.target.value)}
            hint="Credited back to you"
          />
          <Input
            label="Oil added"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={oilAddedQts}
            onChange={(e) => setOilAddedQts(e.target.value)}
            hint="Quarts"
          />
        </div>

        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the next pilot should know."
        />

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
