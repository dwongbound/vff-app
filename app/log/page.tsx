"use client";
// Flight Log tab — every flight the club has filed on the airplane, newest
// first, with the totals that people actually ask about (hours this month,
// my hours, what the airplane has been doing) across the top.
//
// The airplane's squawk list lives at the bottom of this page rather than in a
// tab of its own: a squawk is something you read about a flight, and the
// grounded banner in the navbar already links here.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Badge from "@/components/common/Badge";
import Card from "@/components/common/Card";
import FlightDetailModal from "@/components/FlightDetailModal";
import SquawkPanel from "@/components/SquawkPanel";
import { RulesReference } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import {
  REQUIRED_LANDINGS,
  hoursInLastYear,
  landingCurrency,
  pilotTier,
} from "@/lib/operatingRules";
import {
  formatHours,
  inRange,
  tachHours,
  totalLandings,
  totalTachHours,
} from "@/lib/hours";
import type { ApiFlight, ApiSquawk } from "@/lib/types";

type Filter = "all" | "mine";

// useSearchParams() must sit under a Suspense boundary, so the page export
// just wraps the real component in one.
export default function FlightLogPage() {
  return (
    <Suspense>
      <FlightLog />
    </Suspense>
  );
}

function FlightLog() {
  const { selected, loading: fleetLoading } = useAircraft();
  // See the preflight page: depend on the id, not the object identity.
  const aircraftId = selected?.id ?? null;
  const { me } = useMe();
  const searchParams = useSearchParams();
  const [flights, setFlights] = useState<ApiFlight[] | null>(null);
  const [squawks, setSquawks] = useState<ApiSquawk[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [openFlight, setOpenFlight] = useState<ApiFlight | null>(null);
  // The navbar's grounded banner links here with ?squawks=open, so show
  // everything when someone asks for the full history instead.
  const showAllSquawks = searchParams.get("squawks") === "all";

  // See the reservations page for why this isn't just `flights === null`.
  const showSplash = fleetLoading || (selected !== null && flights === null);
  usePageLoading(showSplash);

  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    // The log and the squawk list are always on screen together, so they're
    // fetched together rather than in sequence.
    const [rows, squawkRows] = await Promise.all([
      fetchJsonArray<ApiFlight>(`/api/flights?aircraftId=${aircraftId}&limit=300`),
      fetchJsonArray<ApiSquawk>(
        `/api/squawks?aircraftId=${aircraftId}&status=${showAllSquawks ? "all" : "OPEN"}`
      ),
    ]);
    setFlights(rows);
    setSquawks(squawkRows);
  }, [aircraftId, showAllSquawks]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const all = flights ?? [];
  const visible = filter === "mine" ? all.filter((f) => f.mine) : all;

  // Totals across the top. "This month" is the club's billing question; "your
  // hours" is the one every member asks about themselves.
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const mine = all.filter((f) => f.mine);
    return {
      monthHours: totalTachHours(inRange(all, monthStart, nextMonth)),
      myYearHours: totalTachHours(inRange(mine, yearStart, nextMonth)),
      myFlights: mine.length,
      landings: totalLandings(all),
    };
  }, [all]);

  // Landing currency, per the club's rules: 3 landings inside the window that
  // applies to this member's experience column (90 days, or 30 while building
  // time). Night landings must be to a full stop, which is why they're logged
  // separately on the post-flight form.
  const currency = useMemo(() => {
    const mine = all.filter((f) => f.mine);
    const tier = pilotTier({
      totalTimeHours: me?.totalTimeHours ?? null,
      recentHours: hoursInLastYear(mine),
    });
    return { tier, ...landingCurrency(mine, tier) };
  }, [all, me?.totalTimeHours]);

  async function deleteFlight(flight: ApiFlight) {
    const result = await sendJson(`/api/flights/${flight.id}`, "DELETE");
    if (result.ok) {
      setOpenFlight(null);
      await refresh();
    }
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Flight log</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {selected.tailNumber}
            {selected.lastTach != null && ` · tach ${selected.lastTach.toFixed(1)}`}
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-300 p-0.5 dark:border-gray-600">
          {(["all", "mine"] as Filter[]).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === value
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {value === "all" ? "Club" : "Mine"}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hours this month" value={formatHours(stats.monthHours)} />
        <Stat label="Your hours this year" value={formatHours(stats.myYearHours)} />
        <Stat label="Your flights" value={String(stats.myFlights)} />
        <Stat label="Club landings" value={String(stats.landings)} />
      </div>

      {/* What the club's log can say about your currency. Deliberately framed
          as "this log shows", not "you are current": hours flown in another
          club's airplane are invisible here, and the pilot is still PIC of
          that decision. */}
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">
          Your landing currency
          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
            last {currency.windowDays} days, from this club&rsquo;s log
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge tone={currency.dayCurrent ? "green" : "amber"}>
            Day: {currency.dayLandings}/{REQUIRED_LANDINGS} landings
          </Badge>
          <Badge tone={currency.nightCurrent ? "green" : "gray"}>
            Night: {currency.nightLandings}/{REQUIRED_LANDINGS} full-stop
          </Badge>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Flights in other airplanes don&rsquo;t appear here — this is what the club
          log alone shows.
        </p>
      </Card>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center dark:border-gray-600">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            No flights logged yet
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            File one from the Post-flight tab after you fly.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((flight, i) => {
            // Month headings, computed as we go rather than in a second pass.
            const flownOn = new Date(flight.flownOn);
            const previous = i > 0 ? new Date(visible[i - 1].flownOn) : null;
            const newMonth =
              !previous ||
              previous.getMonth() !== flownOn.getMonth() ||
              previous.getFullYear() !== flownOn.getFullYear();

            return (
              <li key={flight.id}>
                {newMonth && (
                  <h2 className="px-1 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 first:pt-0 dark:text-gray-400">
                    {flownOn.toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                )}
                <button
                  onClick={() => setOpenFlight(flight)}
                  className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-400 active:scale-[0.99] dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="w-16 shrink-0">
                    <div className="text-sm font-semibold tabular">
                      {formatHours(tachHours(flight))}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">hours</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {flight.mine ? "You" : flight.pilot.name}
                      {(flight.departure || flight.arrival) && (
                        <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                          {[flight.departure, flight.arrival].filter(Boolean).join(" → ")}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {formatDay(flight.flownOn)} · {flight.landings} landing
                      {flight.landings === 1 ? "" : "s"}
                      {flight.fuelAddedGal != null && ` · ${flight.fuelAddedGal} gal`}
                    </div>
                  </div>
                  {flight.squawks.some((s) => s.status === "OPEN") && (
                    <Badge tone="red">Squawk</Badge>
                  )}
                  {flight.photos.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {flight.photos.length} 📷
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SquawkPanel
        squawks={squawks}
        isAdmin={Boolean(me?.isAdmin)}
        onChanged={() => {
          refresh();
          // The grounded banner is derived from the aircraft payload.
          notifyAircraftChanged();
        }}
      />

      <RulesReference />

      <FlightDetailModal
        flight={openFlight}
        onClose={() => setOpenFlight(null)}
        hourlyRateCents={selected.hourlyRateCents}
        canDelete={Boolean(openFlight?.mine || me?.isAdmin)}
        onDelete={deleteFlight}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold tabular">{value}</div>
    </Card>
  );
}
