"use client";
// Club settings — the club's own configuration, as opposed to /profile which is
// the member's. Admins only, reached from the avatar menu.
//
// Today that means the fleet: add an airplane, fix a tail number, change the
// rate, retire one. Everything in the app is keyed by aircraft id, so renaming
// an airplane keeps its whole history attached and adding one is just a row.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import SignupCodesPanel from "@/components/SignupCodesPanel";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { sendJson } from "@/lib/api";
import { CLUB_SHORT_NAME } from "@/lib/constants";
import { toDateInputValue } from "@/lib/dates";
import { WB_PROFILES } from "@/lib/weightBalance";
import type { ApiAircraft } from "@/lib/types";

export default function SettingsPage() {
  const { me } = useMe();
  const { aircraft, loading } = useAircraft();
  const [adding, setAdding] = useState(false);

  usePageLoading(me === null || loading);

  if (!me) return null;

  // The server refuses every write regardless; this is just so a non-admin who
  // types the URL gets an explanation instead of a broken-looking form.
  if (!me.isAdmin) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-bold">Club settings</h1>
        </header>
        <Card>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Only club admins can change {CLUB_SHORT_NAME} settings. Ask an admin
            on the Members tab if you need something changed.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Club settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The club&rsquo;s fleet and configuration. Member roles live on the{" "}
          Members tab.
        </p>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Fleet ({aircraft?.length ?? 0})
        </h2>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>

      {adding && (
        <AddAircraftCard
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            notifyAircraftChanged();
          }}
        />
      )}

      <div className="space-y-3">
        {(aircraft ?? []).map((a) => (
          <AircraftCard key={a.id} aircraft={a} />
        ))}
        {aircraft?.length === 0 && !adding && (
          <Card>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No airplanes yet. Add one to start booking and logging flights.
            </p>
          </Card>
        )}
      </div>

      {/* Who can get IN, under who can fly: the fleet is what the club has, and
          this is who it lets near it. */}
      <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <SignupCodesPanel />
      </div>
    </div>
  );
}

/** Dollars ⇄ cents, so admins type "165" rather than "16500". */
function centsToDollars(cents: number | null): string {
  return cents == null ? "" : String(cents / 100);
}
function dollarsToCents(dollars: string): number | null {
  if (dollars.trim() === "") return null;
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** One airplane, editable in place. */
function AircraftCard({ aircraft }: { aircraft: ApiAircraft }) {
  const [tailNumber, setTailNumber] = useState(aircraft.tailNumber);
  const [model, setModel] = useState(aircraft.model);
  const [year, setYear] = useState(aircraft.year == null ? "" : String(aircraft.year));
  const [fuel, setFuel] = useState(
    aircraft.fuelCapacityGal == null ? "" : String(aircraft.fuelCapacityGal)
  );
  const [homeBase, setHomeBase] = useState(aircraft.homeBase ?? "");
  const [notes, setNotes] = useState(aircraft.notes ?? "");
  // Weight & balance: which type's stations apply, and this airframe's own
  // basis off its latest signed revision.
  const [wbProfile, setWbProfile] = useState(aircraft.wbProfile ?? "");
  const [emptyWeight, setEmptyWeight] = useState(
    aircraft.emptyWeightLbs == null ? "" : String(aircraft.emptyWeightLbs)
  );
  const [emptyMoment, setEmptyMoment] = useState(
    aircraft.emptyMomentLbIn == null ? "" : String(aircraft.emptyMomentLbIn)
  );
  const [weighedOn, setWeighedOn] = useState(
    aircraft.weighedOn ? toDateInputValue(new Date(aircraft.weighedOn)) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The provider refetches the fleet after every save, which re-renders this
  // card with new props — resync the fields so they don't show stale text.
  useEffect(() => {
    setTailNumber(aircraft.tailNumber);
    setModel(aircraft.model);
    setYear(aircraft.year == null ? "" : String(aircraft.year));
    setFuel(aircraft.fuelCapacityGal == null ? "" : String(aircraft.fuelCapacityGal));
    setHomeBase(aircraft.homeBase ?? "");
    setNotes(aircraft.notes ?? "");
    setWbProfile(aircraft.wbProfile ?? "");
    setEmptyWeight(
      aircraft.emptyWeightLbs == null ? "" : String(aircraft.emptyWeightLbs)
    );
    setEmptyMoment(
      aircraft.emptyMomentLbIn == null ? "" : String(aircraft.emptyMomentLbIn)
    );
    setWeighedOn(
      aircraft.weighedOn ? toDateInputValue(new Date(aircraft.weighedOn)) : ""
    );
  }, [aircraft]);

  async function save(extra: Record<string, unknown> = {}) {
    setError(null);
    setSaved(false);
    setBusy(true);
    const result = await sendJson<ApiAircraft>(
      `/api/aircraft/${aircraft.id}`,
      "PATCH",
      {
        tailNumber,
        model,
        year: year === "" ? null : Number(year),
        fuelCapacityGal: fuel === "" ? null : Number(fuel),
        homeBase,
        notes,
        wbProfile: wbProfile || null,
        emptyWeightLbs: emptyWeight === "" ? null : Number(emptyWeight),
        emptyMomentLbIn: emptyMoment === "" ? null : Number(emptyMoment),
        // Noon rather than midnight: this is a calendar date, and a midnight
        // local value read back in another timezone slides to the day before.
        weighedOn: weighedOn === "" ? null : `${weighedOn}T12:00:00`,
        ...extra,
      }
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save this airplane.");
      return;
    }
    setSaved(true);
    notifyAircraftChanged();
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {/* No `font-mono` here: a tail number as a HEADING is the airplane's
            name, so it takes the signage face the way it's painted on the
            fuselage. The tail-number INPUT below stays mono — that's
            transcribing a code, where the fixed advance helps. */}
        <h3 className="text-sm font-semibold tracking-wide">{aircraft.tailNumber}</h3>
        {!aircraft.active && (
          <span className="text-xs text-gray-500 dark:text-gray-400">Retired</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Tail number"
          value={tailNumber}
          onChange={(e) => setTailNumber(e.target.value)}
          className="font-mono uppercase"
          hint="Renaming keeps every flight, squawk and booking attached."
        />
        <Input
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Cessna 172"
        />
        <Input
          label="Year"
          type="number"
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        {/* The hourly rate deliberately isn't here: it's a price, not a fact
            about the airframe, and it belongs to whoever keeps the books. The
            Finance Officer sets it per airplane on the Finances tab. */}
        <Input
          label="Usable fuel"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          value={fuel}
          onChange={(e) => setFuel(e.target.value)}
          hint="Usable gallons, from the airplane's POH."
        />
        <Input
          label="Home base"
          value={homeBase}
          onChange={(e) => setHomeBase(e.target.value)}
          placeholder="KBFI"
        />
      </div>

      {/* ── Weight & balance ────────────────────────────────────────────────
          Split the way the data itself splits. The PROFILE says which type's
          stations and CG envelope apply, and those live in code
          (lib/weightBalance.ts) because they're a fact about the airplane's
          design. The empty weight and moment are a fact about THIS airframe
          and change with every equipment revision, so they're typed in here —
          straight off the signed sheet, which is also why the moment is asked
          for rather than the arm: the sheet totals a moment, and re-deriving
          it from a rounded arm loses a digit that matters. */}
      <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
        <h4 className="text-sm font-semibold">Weight &amp; balance</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          From the airplane&rsquo;s latest Weight/Balance &amp; Equipment List
          Revision. The Tools tab refuses to compute without these rather than
          assuming a default airplane.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type profile"
            value={wbProfile}
            onChange={(e) => setWbProfile(e.target.value)}
          >
            <option value="">No profile — W&amp;B unavailable</option>
            {Object.values(WB_PROFILES).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input
            label="Weighed on"
            type="date"
            value={weighedOn}
            onChange={(e) => setWeighedOn(e.target.value)}
            hint="The date on the revision, shown next to every result."
          />
          <Input
            label="Empty weight"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={emptyWeight}
            onChange={(e) => setEmptyWeight(e.target.value)}
            hint="Pounds, as weighed."
          />
          <Input
            label="Empty moment"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={emptyMoment}
            onChange={(e) => setEmptyMoment(e.target.value)}
            hint={
              // Echoing the arm back is the check: the sheet prints one, and
              // if it doesn't match, a digit went in wrong.
              emptyWeight && emptyMoment && Number(emptyWeight) > 0
                ? `Pound-inches. That works out to an arm of ${(
                    Number(emptyMoment) / Number(emptyWeight)
                  ).toFixed(2)} in — check it against the sheet.`
                : "Pound-inches, not thousands."
            }
          />
        </div>
      </div>

      <Textarea
        label="Notes"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
          Saved.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save()} disabled={busy}>
          {busy ? <LoadingDots size="sm" /> : "Save"}
        </Button>
        {/* Retiring keeps the airplane's history but drops it out of the
            pickers, which is what a club does when it sells one. */}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => save({ active: !aircraft.active })}
        >
          {aircraft.active ? "Retire" : "Un-retire"}
        </Button>
      </div>
    </Card>
  );
}

/** The "add an airplane" form — only the two required fields, plus the rate. */
function AddAircraftCard({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [tailNumber, setTailNumber] = useState("");
  const [model, setModel] = useState("");
  const [homeBase, setHomeBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    const result = await sendJson<ApiAircraft>("/api/aircraft", "POST", {
      tailNumber,
      model,
      homeBase,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add that airplane.");
      return;
    }
    onAdded();
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Add an airplane</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Tail number"
          value={tailNumber}
          onChange={(e) => setTailNumber(e.target.value)}
          className="font-mono uppercase"
          placeholder="NB3188"
        />
        <Input
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Cessna 172"
        />
        {/* No rate here either — a new airplane starts unpriced and the
            Finance Officer sets it from Finances. */}
        <Input
          label="Home base"
          value={homeBase}
          onChange={(e) => setHomeBase(e.target.value)}
          placeholder="KBFI"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={add} disabled={busy}>
          {busy ? <LoadingDots size="sm" /> : "Add"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
