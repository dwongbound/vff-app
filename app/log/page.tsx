"use client";
// Flight Log tab — every flight filed on the airplane, newest first.
//
// The Club/Mine switch changes what the page is *about*, not just which rows
// it filters:
//   • Mine — your own flying: your hours, your flights, and your landing
//     currency. The operating rules hang off that currency card (as a popover)
//     because that's where "am I allowed to fly?" gets asked. This is where the
//     page OPENS, the same way Finances opens on your own statement: a member
//     reading the log is nearly always asking something about themselves.
//   • Club — the airplane and the people flying it: hours this month, the
//     club's totals, everyone's flights, and the squawk list. Nothing here is
//     about you specifically.
//
// The airplane's squawk list lives on this page rather than in a tab of its
// own: a squawk is something you read about a flight, and the grounded banner
// in the navbar already links here.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import FlightDetailModal from "@/components/FlightDetailModal";
import FlightEntryModal from "@/components/FlightEntryModal";
import { RulesModal } from "@/components/OperatingRules";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, fetchJsonObject, sendJson } from "@/lib/api";
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
import type { ApiFlight, ApiFlightSummary } from "@/lib/types";

type Filter = "all" | "mine";

// The Suspense boundary is kept even though the page no longer reads a search
// param (it did, for the squawk panel's ?squawks=all): this is the top of a
// tab that fetches on mount, and the boundary is what keeps a future hook that
// suspends from turning into a build error in a file nobody was touching.
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
  const [flights, setFlights] = useState<ApiFlightSummary[] | null>(null);
  // Opens on YOUR flying, the way Finances opens on your own statement. A
  // member coming to the log almost always came to answer a question about
  // themselves — "am I current", "what did I fly last month" — and the club
  // view is one tap away for the times they didn't.
  const [filter, setFilter] = useState<Filter>("mine");
  const [openFlight, setOpenFlight] = useState<ApiFlight | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Adding a flight the app never saw — a page of the paper log being caught
  // up. See FlightEntryModal for why that isn't the Post-flight form.
  const [addOpen, setAddOpen] = useState(false);
  // See the reservations page for why this isn't just `flights === null`.
  const showSplash = fleetLoading || (selected !== null && flights === null);
  usePageLoading(showSplash);

  // Only the flights now. The squawk list used to be fetched alongside them
  // for a panel at the foot of the club view; that panel is gone (see below),
  // and with it the second request every visit to this tab made.
  const refresh = useCallback(async () => {
    if (!aircraftId) return;
    const rows = await fetchJsonArray<ApiFlightSummary>(
      `/api/flights?aircraftId=${aircraftId}&limit=300`
    );
    setFlights(rows);
    // Handed back as well as stored, so a caller that needs to re-find one row
    // in the new list (the signature flow) doesn't have to wait a render for
    // state to land.
    return rows;
  }, [aircraftId]);

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

  /**
   * Open one entry.
   *
   * The list rows carry no photos or squawks (see lib/flights.ts), so the full
   * entry is fetched here. The modal opens IMMEDIATELY on the summary — with
   * empty attachment lists — and the real ones drop in a moment later: a member
   * who taps a row should see it open, not a spinner, and everything above the
   * photos is already known.
   */
  async function openEntry(summary: ApiFlightSummary) {
    setOpenFlight({ ...summary, photos: [], squawks: [] });
    const detail = await fetchJsonObject<ApiFlight>(`/api/flights/${summary.id}`);
    // Ignore a response that lost the race to a different row being opened.
    if (detail) {
      setOpenFlight((current) => (current?.id === detail.id ? detail : current));
    }
  }

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
          No airplane set up yet — an admin can add one from Club settings.
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
                {/* The row reads left to right the way you look a flight up:
                    WHEN first, then who and where, then how much. The date led
                    with the hours before, which is backwards — you scan a
                    logbook for a day, not for a duration, and the month heading
                    above only narrows it to thirty of them.

                    The glow on hover is the affordance: the whole row opens the
                    entry, and a card that does something when you press it
                    should say so before you press it. */}
                <button
                  onClick={() => openEntry(flight)}
                  className="group flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition duration-150 hover:-translate-y-px hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-500/10 focus-visible:border-indigo-400 active:translate-y-0 active:scale-[0.99] dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500 dark:hover:shadow-indigo-400/10"
                >
                  {/* AUG 11 — the day, big enough to scan a column of. */}
                  <div className="w-14 shrink-0 text-center">
                    <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500 transition group-hover:text-indigo-500 dark:text-gray-400 dark:group-hover:text-indigo-400">
                      {flownOn.toLocaleDateString(undefined, { month: "short" })}
                    </div>
                    <div className="text-xl font-semibold leading-tight tabular">
                      {flownOn.getDate()}
                    </div>
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
                      {/* The weekday still earns its place — "was that the
                          Saturday one?" — but the date itself is now read off
                          the left, so it isn't repeated here. */}
                      {flownOn.toLocaleDateString(undefined, { weekday: "long" })}
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
                  {flight.openSquawkCount > 0 && <Badge tone="red">Squawk</Badge>}
                  {flight.photoCount > 0 && (
                    <span className="text-xs text-gray-400">
                      {flight.photoCount} 📷
                    </span>
                  )}

                  {/* The numbers, right-aligned so a column of them lines up on
                      the decimal — which is the whole reason to move them here. */}
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular">
                      {formatHours(tachHours(flight))}
                      <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                        hr
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {flight.landings} landing{flight.landings === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The airplane's open defects USED to be listed here, under the club
          view. They aren't any more, and the reason is that it was a second
          squawk sheet: Plane Status › Squawks is the one the Safety Officer
          triages on, and two lists of the same rows meant two places to look
          and two places to be out of date. A squawk still shows up in the log
          where it belongs to something — on the entry it was raised from, in
          the detail modal — and that row links through to the real sheet. */}

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
        // Same rule the API enforces on PATCH: your own entry, or an admin.
        canEdit={Boolean(openFlight?.mine || me?.isAdmin)}
        onSaved={async (updated) => {
          // Show the correction under the reader straight away, then refetch:
          // a corrected tach re-bills the flight and can move the airplane's
          // meters, which the header and the totals above both read.
          setOpenFlight(updated);
          await refresh();
          notifyAircraftChanged();
        }}
        onSignatureChanged={async () => {
          // Refresh the list for the badge, and re-read the open entry so the
          // signature and dates update under the reader rather than after they
          // close it.
          const id = openFlight?.id;
          await refresh();
          if (!id) return;
          const detail = await fetchJsonObject<ApiFlight>(`/api/flights/${id}`);
          if (detail) {
            setOpenFlight((current) =>
              current?.id === detail.id ? detail : current
            );
          }
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
