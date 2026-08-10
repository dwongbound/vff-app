"use client";
// Flight Log tab — every flight filed on the airplane, newest first.
//
// The Club/Mine switch changes what the page is *about*, not just which rows
// it filters:
//   • Club — the airplane and the people flying it: hours this month, the
//     club's totals, everyone's flights, and the squawk list. Nothing here is
//     about you specifically.
//   • Mine — your own flying: your hours, your flights, and your landing
//     currency. The operating rules hang off that currency card (as a popover)
//     because that's where "am I allowed to fly?" gets asked.
//
// The airplane's squawk list lives on this page rather than in a tab of its
// own: a squawk is something you read about a flight, and the grounded banner
// in the navbar already links here.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import FlightDetailModal from "@/components/FlightDetailModal";
import FlightEntryModal from "@/components/FlightEntryModal";
import SquawkPanel from "@/components/SquawkPanel";
import { RulesModal } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { isOpen } from "@/lib/squawks";
import {
  SIGNATURE_LABELS,
  SIGNATURE_TONES,
  isAwaitingSignature,
  signatureState,
} from "@/lib/flightSignature";
import { formatDay } from "@/lib/dates";
import { REQUIRED_LANDINGS, soloEligibility } from "@/lib/operatingRules";
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
  const [rulesOpen, setRulesOpen] = useState(false);
  // Adding a flight the app never saw — a page of the paper log being caught
  // up. See FlightEntryModal for why that isn't the Post-flight form.
  const [addOpen, setAddOpen] = useState(false);
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
        `/api/squawks?aircraftId=${aircraftId}&status=${showAllSquawks ? "all" : "open"}`
      ),
    ]);
    setFlights(rows);
    setSquawks(squawkRows);
    // Handed back as well as stored, so a caller that needs to re-find one row
    // in the new list (the signature flow) doesn't have to wait a render for
    // state to land.
    return rows;
  }, [aircraftId, showAllSquawks]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const all = flights ?? [];

  /**
   * Is this member reading the log as an INSTRUCTOR?
   *
   * True for a CFI who doesn't fly here, and it changes what "Mine" means: a
   * visiting instructor has no flights of their own in this airplane, so the
   * tab would be permanently empty. What's theirs is the lessons they're named
   * on — which is also the only thing they came to this page to do something
   * about. A CFI who is ALSO a club member keeps the ordinary "Mine" (their own
   * flying), because they have flying here to look at; the entries awaiting
   * their signature still show up wherever they appear in the club log.
   */
  const asInstructor = Boolean(
    me?.capabilities.includes("flight:sign") && !me?.clubMember
  );

  const visible =
    filter === "mine"
      ? all.filter((f) => (asInstructor ? f.instructor?.id === me?.id : f.mine))
      : all;

  // What this instructor still owes the club a signature on.
  const awaiting = useMemo(
    () =>
      asInstructor
        ? all.filter((f) => f.instructor?.id === me?.id && isAwaitingSignature(f))
        : [],
    [all, asInstructor, me?.id]
  );

  // Totals across the top, computed for whichever set of flights the switch is
  // showing: on Club that's the whole log (the billing question), on Mine it's
  // just this member's rows (the logbook question).
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return {
      monthHours: totalTachHours(inRange(visible, monthStart, nextMonth)),
      yearHours: totalTachHours(inRange(visible, yearStart, nextMonth)),
      flights: visible.length,
      landings: totalLandings(visible),
    };
  }, [visible]);

  // Landing currency, per the club's rules: 3 landings inside the window that
  // applies to this member's experience column (90 days, or 30 while building
  // time). Night landings must be to a full stop, which is why they're logged
  // separately on the post-flight form.
  const currency = useMemo(
    () =>
      soloEligibility({
        totalTimeHours: me?.totalTimeHours ?? null,
        flights: all.filter((f) => f.mine),
      }),
    [all, me?.totalTimeHours]
  );

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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            Add flight
          </Button>
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
              {value === "all" ? "Club" : asInstructor ? "Teaching" : "Mine"}
            </button>
          ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filter === "all" ? (
          <>
            <Stat label="Hours this month" value={formatHours(stats.monthHours)} />
            <Stat label="Club flights" value={String(stats.flights)} />
            <Stat label="Club landings" value={String(stats.landings)} />
          </>
        ) : asInstructor ? (
          <>
            <Stat label="Hours taught this year" value={formatHours(stats.yearHours)} />
            <Stat label="Lessons" value={String(stats.flights)} />
            <Stat label="Awaiting your signature" value={String(awaiting.length)} />
          </>
        ) : (
          <>
            <Stat label="Your hours this year" value={formatHours(stats.yearHours)} />
            <Stat label="Your flights" value={String(stats.flights)} />
            <Stat label="Your landings" value={String(stats.landings)} />
          </>
        )}
      </div>

      {/* Your currency is a "Mine" question, so it only appears there — the
          club view is about the airplane and the people flying it.
          Deliberately framed as "this log shows", not "you are current":
          hours flown in another club's airplane are invisible here, and the
          pilot is still PIC of that decision. */}
      {filter === "mine" && !asInstructor && (
        <Card className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Your landing currency
              <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                last {currency.windowDays} days, from this club&rsquo;s log
              </span>
            </h2>
            {/* The rules live behind this rather than on the page: you go
                looking for them when the verdict above prompts the question. */}
            <button
              onClick={() => setRulesOpen(true)}
              className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Operating rules
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={currency.daySolo ? "green" : "amber"}>
              Day: {currency.dayLandings}/{REQUIRED_LANDINGS} landings
            </Badge>
            <Badge tone={currency.nightSolo ? "green" : "gray"}>
              Night: {currency.nightLandings}/{REQUIRED_LANDINGS} full-stop
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {currency.daySolo
              ? "You're current to fly solo or as PIC by day."
              : "Not current for solo by day — fly with an approved instructor until you are."}{" "}
            Flights in other airplanes don&rsquo;t appear here.
          </p>
        </Card>
      )}

      {/* The instructor's to-do list. Above the log rather than inside it
          because it's the whole reason a CFI opens this page — everything
          below is history, and this is the bit that's waiting on them. */}
      {filter === "mine" && asInstructor && (
        <Card className="space-y-1">
          <h2 className="text-sm font-semibold">
            {awaiting.length === 0
              ? "Nothing awaiting your signature"
              : `${awaiting.length} ${
                  awaiting.length === 1 ? "entry" : "entries"
                } awaiting your signature`}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {awaiting.length === 0
              ? "Every lesson you're named on has been signed off."
              : "Open one to read what the pilot filed, then sign it. Nobody else can sign for you."}
          </p>
        </Card>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center dark:border-gray-600">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            No flights logged yet
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {asInstructor && filter === "mine"
              ? "Lessons you're named on as the instructor show up here once the pilot files them."
              : "File one from the Post-flight tab after you fly — or add an older one by hand."}
          </p>
          {!(asInstructor && filter === "mine") && (
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                Add flight
              </Button>
            </div>
          )}
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
                  {/* Only on lessons — see the detail modal for why a solo
                      flight shows nothing rather than "no instructor". */}
                  {flight.instructor && (
                    <Badge tone={SIGNATURE_TONES[signatureState(flight)]}>
                      {SIGNATURE_LABELS[signatureState(flight)]}
                    </Badge>
                  )}
                  {flight.squawks.some((s) => isOpen(s.status)) && (
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

      {/* The airplane's open defects — club information, so it sits with the
          club view rather than with your own logbook. */}
      {filter === "all" && (
        <SquawkPanel
          squawks={squawks}
          canSignOff={Boolean(me?.capabilities.includes("squawk:manage"))}
          onChanged={() => {
            refresh();
            // The grounded banner is derived from the aircraft payload.
            notifyAircraftChanged();
          }}
        />
      )}

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <FlightEntryModal
        open={addOpen}
        aircraft={selected}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          // Refetch rather than splice the new row in: filing a flight also
          // moves the airplane's tach, which the header reads.
          refresh();
          notifyAircraftChanged();
        }}
      />

      <FlightDetailModal
        flight={openFlight}
        onClose={() => setOpenFlight(null)}
        hourlyRateCents={selected.hourlyRateCents}
        canDelete={Boolean(openFlight?.mine || me?.isAdmin)}
        onDelete={deleteFlight}
        viewerId={me?.id ?? null}
        onSignatureChanged={async () => {
          // Refetch and re-open the same row, so the badge and the dates in the
          // modal update under the reader rather than after they close it.
          const rows = await refresh();
          setOpenFlight(
            (current) => rows?.find((f) => f.id === current?.id) ?? current
          );
        }}
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
