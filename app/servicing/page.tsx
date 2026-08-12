"use client";
// Checkouts › Add Fuel — servicing the airplane, with no flight attached.
//
// The post-flight form already asks what you put in AFTER you landed, which
// covers the common case. It doesn't cover the other half of the club's
// reality: you arrive to a half-full airplane and fill it before you go, or
// you top it on a day you never fly, or somebody else's fuel receipt needs
// entering. None of that has a flight to hang off, and the only way to record
// it was to invent one — so it went unrecorded.
//
// Filed on its own, deliberately. Nothing here touches the tach or the flight
// log: no flight happened. What it DOES do is answer the one question the
// post-flight form can't, which is whose card it went on — fuel on the club's
// card is the club buying fuel, and fuel on yours is a debt the club owes you.
import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Textarea from "@/components/common/Textarea";
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { formatDay, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/hours";
import type { ApiServicing } from "@/lib/types";

export default function ServicingPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const aircraftId = selected?.id ?? null;

  const [recent, setRecent] = useState<ApiServicing[] | null>(null);
  const [servicedAt, setServicedAt] = useState(() => toDateInputValue(new Date()));
  const [fuelAddedGal, setFuelAddedGal] = useState("");
  const [fuelCostDollars, setFuelCostDollars] = useState("");
  const [oilAddedQts, setOilAddedQts] = useState("");
  const [paidPersonally, setPaidPersonally] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  usePageLoading(fleetLoading || (selected !== null && recent === null));

  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    setRecent(
      await fetchJsonArray<ApiServicing>(
        `/api/servicing?aircraftId=${aircraftId}&limit=20`
      )
    );
  }, [aircraftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const numeric = (v: string) => (v.trim() === "" ? null : Number(v));
  const nothingRecorded =
    numeric(fuelAddedGal) == null &&
    numeric(oilAddedQts) == null &&
    numeric(fuelCostDollars) == null;

  async function file() {
    if (!selected) return;
    setError(null);
    setSaved(null);
    setBusy(true);

    const result = await sendJson<ApiServicing>("/api/servicing", "POST", {
      aircraftId: selected.id,
      // Noon, not midnight — a calendar date read back in another zone would
      // otherwise slide to the day before.
      servicedAt: `${servicedAt}T12:00:00`,
      fuelAddedGal: numeric(fuelAddedGal),
      fuelCostDollars: numeric(fuelCostDollars),
      oilAddedQts: numeric(oilAddedQts),
      paidPersonally,
      notes: notes.trim() || null,
    });
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not record that.");
      return;
    }

    setSaved(
      paidPersonally && numeric(fuelCostDollars) != null
        ? "Recorded — the cost is credited back to you on this month's statement."
        : "Recorded."
    );
    setFuelAddedGal("");
    setFuelCostDollars("");
    setOilAddedQts("");
    setNotes("");
    await refresh();
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
        <h1 className="text-xl font-bold">Add Fuel</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {selected.tailNumber} · {selected.model}
        </p>
      </header>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">What went in</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            For fuel or oil added on its own. If you&rsquo;ve just landed,
            record it on the post-flight form instead so it stays with the
            flight.
          </p>
        </div>

        <Input
          label="Date"
          type="date"
          value={servicedAt}
          onChange={(e) => setServicedAt(e.target.value)}
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
            hint={
              selected.fuelCapacityGal
                ? `Gallons — ${selected.fuelCapacityGal} usable when full`
                : "Gallons"
            }
          />
          <Input
            label="Cost"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={fuelCostDollars}
            onChange={(e) => setFuelCostDollars(e.target.value)}
            hint="Dollars, off the receipt"
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

        {/* The club's own sheet has this column, and it decides who is owed
            money — so it's a real control rather than an assumption. */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Paid with
          </legend>
          {[
            {
              value: true,
              label: "My own card",
              detail: "Credited back to you on this month's statement.",
            },
            {
              value: false,
              label: "The club's card",
              detail: "Recorded, but nobody is owed anything.",
            },
          ].map((option) => (
            <label
              key={String(option.value)}
              className="flex items-start gap-2 text-sm"
            >
              <input
                type="radio"
                name="paidWith"
                checked={paidPersonally === option.value}
                onChange={() => setPaidPersonally(option.value)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600 dark:border-gray-600"
              />
              <span>
                {option.label}
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {option.detail}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Self-serve pump, topped both tanks…"
        />

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

        <Button onClick={file} disabled={busy || nothingRecorded} size="lg">
          {busy ? <LoadingDots size="sm" /> : "Record"}
        </Button>
        {nothingRecorded && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Enter some fuel, some oil, or what it cost.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Recent servicing</h2>
        {recent && recent.length > 0 ? (
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
            {recent.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="font-medium">{formatDay(s.servicedAt)}</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {[
                    s.fuelAddedGal != null && `${s.fuelAddedGal} gal`,
                    s.oilAddedQts != null && `${s.oilAddedQts} qt oil`,
                    s.fuelCostCents != null && formatCents(s.fuelCostCents),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{s.user.name}</span>
                {s.fuelCostCents != null && (
                  <Badge tone={s.paidPersonally ? "indigo" : "gray"}>
                    {s.paidPersonally ? "own card" : "club card"}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing recorded yet. Fuel added after a flight lives on that
            flight, so this list only shows fill-ups filed on their own.
          </p>
        )}
      </Card>
    </div>
  );
}
