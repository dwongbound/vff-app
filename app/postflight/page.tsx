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
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import PhotoUploader, { uploadPhotos } from "@/components/PhotoUploader";
import SquawkDraftModal, { type SquawkDraft } from "@/components/SquawkDraftModal";
import { AIRCRAFT_CHANGED_EVENT, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { SEVERITY_LABELS, SEVERITY_TONES } from "@/lib/constants";
import { formatDay, formatTimeRange, toDateInputValue } from "@/lib/dates";
import {
  flightCostCents,
  formatCents,
  formatHours,
  hobbsHours,
  tachHours,
  validateMeters,
} from "@/lib/hours";
import type { ApiFlight, ApiReservation, ApiSquawk } from "@/lib/types";

export default function PostflightPage() {
  const { selected, loading: fleetLoading, refreshAircraft } = useAircraft();

  const [reservationId, setReservationId] = useState("");
  const [flownOn, setFlownOn] = useState(() => toDateInputValue(new Date()));
  const [tachStart, setTachStart] = useState("");
  const [tachEnd, setTachEnd] = useState("");
  const [hobbsStart, setHobbsStart] = useState("");
  const [hobbsEnd, setHobbsEnd] = useState("");
  const [landings, setLandings] = useState("1");
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [route, setRoute] = useState("");
  const [fuelAdded, setFuelAdded] = useState("");
  const [fuelCost, setFuelCost] = useState("");
  const [oilAdded, setOilAdded] = useState("");
  const [tiedDown, setTiedDown] = useState(true);
  const [cabinClean, setCabinClean] = useState(true);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [squawkDrafts, setSquawkDrafts] = useState<SquawkDraft[]>([]);
  const [squawkModalOpen, setSquawkModalOpen] = useState(false);

  // My bookings that haven't been closed out yet — the flight you just made is
  // almost always one of them.
  const [openBookings, setOpenBookings] = useState<ApiReservation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  usePageLoading(fleetLoading || (Boolean(selected) && openBookings === null));

  const loadBookings = useCallback(async () => {
    if (!selected) return;
    // Everything of mine from the last two weeks through now — a flight filed
    // days late still finds its booking.
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const rows = await fetchJsonArray<ApiReservation>(
      `/api/reservations?aircraftId=${selected.id}&mine=1&from=${from}&to=${to}`
    );
    setOpenBookings(rows.filter((r) => !r.hasFlight));
  }, [selected]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Prefill the "start" meters from where the airplane was left. The pilot
  // still confirms them against the panel — they're editable, and a mismatch
  // usually means someone forgot to file a flight.
  useEffect(() => {
    if (!selected) return;
    setTachStart((current) =>
      current === "" && selected.lastTach != null ? String(selected.lastTach) : current
    );
    setHobbsStart((current) =>
      current === "" && selected.lastHobbs != null ? String(selected.lastHobbs) : current
    );
  }, [selected]);

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
    const result = await sendJson<ApiFlight>("/api/flights", "POST", {
      aircraftId: selected.id,
      reservationId: reservationId || null,
      flownOn: new Date(`${flownOn}T12:00:00`).toISOString(), // local midday: date-only, TZ-safe
      tachStart: Number(tachStart),
      tachEnd: Number(tachEnd),
      hobbsStart: hobbsPair ? Number(hobbsStart) : null,
      hobbsEnd: hobbsPair ? Number(hobbsEnd) : null,
      landings: Number(landings || 1),
      departure: departure.trim() || null,
      arrival: arrival.trim() || null,
      route: route.trim() || null,
      fuelAddedGal: fuelAdded === "" ? null : Number(fuelAdded),
      fuelCostDollars: fuelCost === "" ? null : Number(fuelCost),
      oilAddedQts: oilAdded === "" ? null : Number(oilAdded),
      tiedDown,
      cabinClean,
      notes: notes.trim() || null,
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      setError(result.error ?? "Could not save the flight.");
      return;
    }

    const flightId = result.data.id;
    if (photos.length) await uploadPhotos(photos, "flight", flightId);
    for (const draft of squawkDrafts) {
      const squawk = await sendJson<ApiSquawk>("/api/squawks", "POST", {
        aircraftId: selected.id,
        flightId,
        title: draft.title,
        description: draft.description || null,
        severity: draft.severity,
      });
      if (squawk.ok && squawk.data && draft.photos.length) {
        await uploadPhotos(draft.photos, "squawk", squawk.data.id);
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
    setLandings("1");
    setDeparture("");
    setArrival("");
    setRoute("");
    setFuelAdded("");
    setFuelCost("");
    setOilAdded("");
    setNotes("");
    setPhotos([]);
    setSquawkDrafts([]);

    await refreshAircraft();
    window.dispatchEvent(new Event(AIRCRAFT_CHANGED_EVENT));
    await loadBookings();
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Post-flight</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber}
          {selected.lastTach != null && ` · last tach ${selected.lastTach.toFixed(1)}`}
        </p>
      </header>

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
            onChange={(e) => setTachStart(e.target.value)}
            hint="prefilled from the last flight"
          />
          <Input
            label="Tach end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={tachEnd}
            onChange={(e) => setTachEnd(e.target.value)}
          />
          <Input
            label="Hobbs start"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsStart}
            onChange={(e) => setHobbsStart(e.target.value)}
          />
          <Input
            label="Hobbs end"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={hobbsEnd}
            onChange={(e) => setHobbsEnd(e.target.value)}
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
          <Input
            label="Date flown"
            type="date"
            value={flownOn}
            onChange={(e) => setFlownOn(e.target.value)}
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
            label="From"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            placeholder="KRHV"
            className="uppercase"
          />
          <Input
            label="To"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            placeholder="KRHV"
            className="uppercase"
          />
        </div>
        <Input
          label="Route (optional)"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="KRHV → KWVI → practice area → KRHV"
        />
      </Card>

      {/* What you put back into the airplane. */}
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Servicing &amp; put-away</h2>
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

        <div className="space-y-2">
          <Toggle
            checked={tiedDown}
            onChange={setTiedDown}
            label="Tied down and chocked"
          />
          <Toggle
            checked={cabinClean}
            onChange={setCabinClean}
            label="Cabin cleaned out, trash removed"
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
          <h2 className="text-sm font-semibold">Anything wrong with the airplane?</h2>
          <Button variant="secondary" size="sm" onClick={() => setSquawkModalOpen(true)}>
            Report a squawk
          </Button>
        </div>
        {squawkDrafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing reported — the airplane goes back on the line as-is.
          </p>
        ) : (
          <ul className="space-y-2">
            {squawkDrafts.map((draft, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                <Badge tone={SEVERITY_TONES[draft.severity]}>
                  {SEVERITY_LABELS[draft.severity]}
                </Badge>
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
          {busy ? <LoadingDots size="sm" /> : "File this flight"}
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
