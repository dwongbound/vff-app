"use client";
// Club settings › Airports: the fields the club lands at and what each one
// charges to land. The figure is only the DEFAULT the flight forms open the
// fee box at (see lib/landingFees.ts) — changing it here never restates a
// flight already filed, because what was billed is what the pilot recorded.
//
// Admin-only to change; every member's forms read it (app/api/airports).
import { useCallback, useEffect, useState } from "react";
import Button from "./common/Button";
import Card from "./common/Card";
import Input from "./common/Input";
import LoadingDots from "./common/LoadingDots";
import MoneyInput from "./common/MoneyInput";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { airportCodeError, normalizeAirport } from "@/lib/landingFees";

interface AirportRow {
  code: string;
  landingFeeCents: number | null;
}

/** Cents → what the money box shows ("6.00"), or "" for no fee on file. */
function feeInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

export default function AirportsPanel() {
  const [airports, setAirports] = useState<AirportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setAirports(await fetchJsonArray<AirportRow>("/api/airports"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Open the add row empty. */
  function startAdding() {
    setCode("");
    setFee("");
    setError(null);
    setAdding(true);
  }

  async function add() {
    setError(null);
    const problem = airportCodeError(normalizeAirport(code));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const result = await sendJson<AirportRow>("/api/airports", "POST", {
      code,
      landingFeeDollars: fee,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add that airport.");
      return;
    }
    setAdding(false);
    await load();
  }

  return (
    <section className="space-y-3" aria-labelledby="airports-heading">
      <div>
        <h2 id="airports-heading" className="text-sm font-semibold">
          Airports
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          What each field charges to land. A flight form fills its landing fee
          in from here when the pilot lands at one of these, and the pilot can
          still change it. Changing a fee doesn&rsquo;t touch flights already
          filed.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <Card className="space-y-3">
        {airports === null ? (
          <LoadingDots size="sm" label="Loading airports" />
        ) : airports.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No airports yet, so no fee is filled in for anyone.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label="Airports">
            {airports.map((airport) => (
              <AirportLine
                key={airport.code}
                airport={airport}
                onError={setError}
                onChanged={load}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Airport"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="KSMO"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="uppercase"
              />
              <MoneyInput
                label="Landing fee"
                value={fee}
                onChange={setFee}
                hint="Leave empty if it charges nothing."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={add} disabled={busy}>
                {busy ? <LoadingDots size="sm" label="Adding airport" /> : "Add"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={startAdding}>
            Add airport
          </Button>
        )}
      </Card>
    </section>
  );
}

/** One airport: its code, its fee box (per flight), Save once the box changed, Delete. */
function AirportLine({
  airport,
  onError,
  onChanged,
}: {
  airport: AirportRow;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [fee, setFee] = useState(feeInput(airport.landingFeeCents));
  const [busy, setBusy] = useState(false);
  const changed = fee !== feeInput(airport.landingFeeCents);
  const path = `/api/airports/${encodeURIComponent(airport.code)}`;

  async function save() {
    onError(null);
    setBusy(true);
    const result = await sendJson(path, "PATCH", { landingFeeDollars: fee });
    setBusy(false);
    if (!result.ok) {
      onError(result.error ?? "Could not save that fee.");
      return;
    }
    await onChanged();
  }

  async function remove() {
    onError(null);
    setBusy(true);
    const result = await sendJson(path, "DELETE");
    setBusy(false);
    if (!result.ok) {
      onError(result.error ?? "Could not delete that airport.");
      return;
    }
    await onChanged();
  }

  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <div className="w-14 shrink-0 font-semibold tabular">{airport.code}</div>
      <div className="w-32 min-w-0">
        <MoneyInput
          label={`${airport.code} landing fee`}
          hideLabel
          value={fee}
          onChange={setFee}
          placeholder="No fee"
        />
      </div>
      <div className="ml-auto flex gap-2">
        {changed && (
          <Button size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          destructive
          onClick={remove}
          disabled={busy}
          aria-label={`Delete ${airport.code}`}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
