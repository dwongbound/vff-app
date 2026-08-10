"use client";
// Plane Status › Overview — "can I go flying, and what am I walking out to?"
//
// The first tab on purpose: everything here is already recorded somewhere else
// in the app, and a member shouldn't have to open three tabs and do arithmetic
// to find out whether the airplane is available, how much fuel is in it and who
// has it next.
//
// Every figure is DERIVED and carries the moment it was true. Fuel and oil come
// from the last preflight checkout someone actually walked, not from a stored
// "current fuel" field — a number nobody is responsible for updating is worse
// than no number, because it looks authoritative while quietly going stale.
//
// On form: the page deliberately does NOT render as a row of identical stat
// squares. Each figure gets the shape its data actually has —
//
//   tach/Hobbs   → a hero figure. A running total has no scale to sit against;
//                  the number IS the chart, so it's typed big and left alone.
//   fuel & oil   → meters. Both are a level against a known total, and a bare
//                  number makes the reader do the division.
//   hours flown  → a column chart. The only quantity here with a time axis, and
//                  the only one where the shape says something a number can't.
//   squawks      → a list with status badges. Under ~7 classes that all carry
//                  meaning, words beat more colour.
//
// — which is the whole reason it reads as a page rather than a spreadsheet.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Card from "@/components/common/Card";
import Meter from "@/components/status/Meter";
import UtilisationChart from "@/components/status/UtilisationChart";
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray } from "@/lib/api";
import {
  SQUAWK_STATUS_SHORT,
  SQUAWK_STATUS_TONES,
} from "@/lib/squawks";
import { formatDay, formatTimeRange } from "@/lib/dates";
import { formatHours, monthlyTachHours, tachHours } from "@/lib/hours";
import type { ApiCheckout, ApiFlight, ApiReservation, ApiSquawk } from "@/lib/types";

/** How much history the utilisation chart shows. Half a year fits a phone. */
const UTILISATION_MONTHS = 6;

/**
 * The airplane's own card: "Oil — minimum 4 quarts". The ONLY consumable
 * threshold the club actually defines, which is why oil is the only meter here
 * that carries a tone. (The fuel reserve rule in VFF-OR-A is written in HOURS,
 * so it can't be turned into a gallons mark without a burn rate we don't hold.)
 */
const OIL_MINIMUM_QTS = 4;
/** Only used to scale the oil meter's track — twice the minimum reads sensibly. */
const OIL_SCALE_QTS = 8;

export default function StatusPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  const aircraftId = selected?.id ?? null;

  const [preflights, setPreflights] = useState<ApiCheckout[] | null>(null);
  const [flights, setFlights] = useState<ApiFlight[] | null>(null);
  const [bookings, setBookings] = useState<ApiReservation[] | null>(null);
  const [squawks, setSquawks] = useState<ApiSquawk[] | null>(null);

  const loaded =
    preflights !== null && flights !== null && bookings !== null && squawks !== null;
  usePageLoading(fleetLoading || (selected !== null && !loaded));

  const load = useCallback(async () => {
    if (!aircraftId) return;
    const now = new Date();
    const to = new Date(now.getTime() + 60 * 86_400_000).toISOString();
    const [p, f, r, s] = await Promise.all([
      fetchJsonArray<ApiCheckout>(
        `/api/checkouts?aircraftId=${aircraftId}&kind=PREFLIGHT&limit=5`
      ),
      // Enough history for the utilisation chart, not just the last flight —
      // the club flies a few hundred hours a year at most, so one page of
      // flights covers the window comfortably.
      fetchJsonArray<ApiFlight>(`/api/flights?aircraftId=${aircraftId}&limit=300`),
      fetchJsonArray<ApiReservation>(
        `/api/reservations?aircraftId=${aircraftId}&from=${now.toISOString()}&to=${to}`
      ),
      fetchJsonArray<ApiSquawk>(`/api/squawks?aircraftId=${aircraftId}&status=open`),
    ]);
    setPreflights(p);
    setFlights(f);
    setBookings(r);
    setSquawks(s);
  }, [aircraftId]);

  useEffect(() => {
    load();
  }, [load]);

  // The last walkaround that actually recorded a number. A checkout where the
  // pilot skipped the fuel box tells us nothing, so fall further back rather
  // than showing a blank.
  const lastFuel = useMemo(
    () => (preflights ?? []).find((p) => p.fuelOnBoardGal != null) ?? null,
    [preflights]
  );
  const lastOil = useMemo(
    () => (preflights ?? []).find((p) => p.oilQuarts != null) ?? null,
    [preflights]
  );

  const months = useMemo(
    () => monthlyTachHours(flights ?? [], UTILISATION_MONTHS),
    [flights]
  );

  const nextBooking = useMemo(() => {
    const now = Date.now();
    return (
      (bookings ?? [])
        .filter((b) => b.status === "CONFIRMED" && new Date(b.endsAt).getTime() > now)
        .sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        )[0] ?? null
    );
  }, [bookings]);

  const lastFlight = (flights ?? [])[0] ?? null;
  const openSquawks = squawks ?? [];

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — an admin can add one from Org settings.
        </p>
      </Card>
    );
  }
  if (!loaded) return null;

  const capacity = selected.fuelCapacityGal;
  const fuelGal = lastFuel?.fuelOnBoardGal ?? null;
  const oilQts = lastOil?.oilQuarts ?? null;
  const oilLow = oilQts != null && oilQts < OIL_MINIMUM_QTS;

  return (
    <div className="space-y-4">
      {/* The tail number, the airworthy badge and the do-not-fly / in-
          maintenance banner all live in the Status LAYOUT — they're true of the
          airplane rather than of this view, so the Squawks tab gets them too. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* The hero figure — exactly one per view. Tach is the meter that
            bills and the one the next pilot checks their start reading
            against, so it's the number this page leads with. Hobbs rides
            alongside rather than in a square of its own: nobody reads one
            without the other. Proportional figures, not `tabular` — tabular
            gives every digit the width of a zero, which looks loose at this
            size and only earns its keep in aligned columns. */}
        <Card className="sm:col-span-2 flex flex-col justify-between gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Tach
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              After the last filed flight
            </p>
          </div>
          <p className="text-5xl font-bold leading-none">
            {selected.lastTach != null ? selected.lastTach.toFixed(1) : "—"}
            <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
              hrs
            </span>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Hobbs{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {selected.lastHobbs != null ? selected.lastHobbs.toFixed(1) : "—"}
            </span>
            {selected.lastHobbs == null && " · not recorded"}
          </p>
        </Card>

        <Meter
          label="Fuel on board"
          value={fuelGal != null ? String(fuelGal) : "—"}
          unit={capacity ? `of ${capacity} gal` : "gal"}
          fraction={fuelGal != null && capacity ? fuelGal / capacity : null}
          state={
            fuelGal != null && capacity
              ? `${Math.round((fuelGal / capacity) * 100)}% full`
              : undefined
          }
          note={
            lastFuel
              ? `${lastFuel.user.name}'s checkout, ${formatDay(new Date(lastFuel.createdAt))}`
              : "No preflight checkout has recorded it"
          }
        />

        <Meter
          label="Engine oil"
          value={oilQts != null ? String(oilQts) : "—"}
          unit="qts"
          fraction={oilQts != null ? oilQts / OIL_SCALE_QTS : null}
          tone={oilQts == null ? "neutral" : oilLow ? "warning" : "good"}
          state={
            oilQts == null
              ? undefined
              : oilLow
                ? `Below ${OIL_MINIMUM_QTS} qt minimum`
                : `Above ${OIL_MINIMUM_QTS} qt minimum`
          }
          note={
            lastOil
              ? `${lastOil.user.name}'s checkout, ${formatDay(new Date(lastOil.createdAt))}`
              : "No preflight checkout has recorded it"
          }
        />
      </div>

      {/* How hard the airplane is being worked — the one figure here with a
          time axis, and the only reason to draw anything. */}
      <Card>
        <UtilisationChart months={months} />
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Who has it next — the other half of "can I go flying". */}
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Next up</h2>
          {nextBooking ? (
            <>
              <p className="text-sm">
                <span className="font-medium">
                  {nextBooking.mine ? "You" : nextBooking.user.name}
                </span>{" "}
                — {formatDay(new Date(nextBooking.startsAt))}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatTimeRange(nextBooking.startsAt, nextBooking.endsAt)}
                {nextBooking.notes ? ` · ${nextBooking.notes}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing booked in the next 60 days — the airplane is free.
            </p>
          )}
          <Link
            href="/reservations"
            className="mt-auto inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Book it
          </Link>
        </Card>

        {/* What the last person did with it. */}
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Last flight</h2>
          {lastFlight ? (
            <>
              <p className="text-sm">
                <span className="font-medium">
                  {lastFlight.mine ? "You" : lastFlight.pilot.name}
                </span>{" "}
                — {formatDay(new Date(lastFlight.flownOn))}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatHours(tachHours(lastFlight))} tach ·{" "}
                {lastFlight.landings}{" "}
                {lastFlight.landings === 1 ? "landing" : "landings"}
                {lastFlight.route ? ` · ${lastFlight.route}` : ""}
              </p>
              {(!lastFlight.tiedDown || !lastFlight.cabinClean) && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {!lastFlight.tiedDown && "Tie-downs not confirmed. "}
                  {!lastFlight.cabinClean && "Cabin clean-out not confirmed."}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No flights filed yet.
            </p>
          )}
        </Card>
      </div>

      {/* Everything else that's open against the airplane. */}
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Open squawks ({openSquawks.length})
          </h2>
          <Link
            href="/status/squawks"
            className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            See all
          </Link>
        </div>
        {openSquawks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing outstanding — the airplane is clean.
          </p>
        ) : (
          <ul className="space-y-1">
            {openSquawks.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Badge tone={SQUAWK_STATUS_TONES[s.status]}>
                  {SQUAWK_STATUS_SHORT[s.status]}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {me && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Fuel and oil are whatever the last preflight checkout recorded — walk the
          airplane before you trust them.
        </p>
      )}
    </div>
  );
}
