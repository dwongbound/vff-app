"use client";
// Reservations tab — the schedule for the club airplane.
//
// Desktop gets the month calendar (the whole month at a glance, which is how
// you find a free Saturday). Phones get a list of what's coming up plus a "+"
// button in the thumb corner, because a month grid on a 390px screen is
// unreadable. Both render from the same fetch and open the same modal; the
// switch is pure CSS (`hidden sm:flex` / `sm:hidden`), so there's no layout
// flash while JS works out how wide the window is.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ReservationCalendar from "@/components/ReservationCalendar";
import ReservationList from "@/components/ReservationList";
import ReservationModal from "@/components/ReservationModal";
import { useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray } from "@/lib/api";
import { MAX_ADVANCE_DAYS } from "@/lib/constants";
import { addDays, formatDay, formatTimeRange, relativeDay } from "@/lib/dates";
import { upcoming } from "@/lib/reservations";
import type { ApiReservation } from "@/lib/types";

type Filter = "all" | "mine";

export default function ReservationsPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  const [reservations, setReservations] = useState<ApiReservation[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // The month the desktop calendar is showing, anchored to its 1st.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Modal state: an existing booking to open, or a day to create one on.
  const [openReservation, setOpenReservation] = useState<ApiReservation | null>(null);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  usePageLoading(fleetLoading || (Boolean(selected) && reservations === null));

  // One fetch feeds both views: a window wide enough for the month on screen
  // AND the phone list's horizon, so switching layouts (or rotating a tablet)
  // never shows a gap.
  const window = useMemo(() => {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const now = new Date();
    const from = monthStart < now ? monthStart : now;
    const listHorizon = addDays(now, MAX_ADVANCE_DAYS);
    const to = monthEnd > listHorizon ? monthEnd : listHorizon;
    // Pad a week either side so a booking that straddles the boundary still
    // renders in the calendar's leading/trailing days.
    return { from: addDays(from, -7).toISOString(), to: addDays(to, 7).toISOString() };
  }, [month]);

  const refresh = useCallback(async () => {
    if (!selected) return;
    const rows = await fetchJsonArray<ApiReservation>(
      `/api/reservations?aircraftId=${selected.id}&from=${window.from}&to=${window.to}`
    );
    setReservations(rows);
  }, [selected, window.from, window.to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const rows = reservations ?? [];
    return filter === "mine" ? rows.filter((r) => r.mine) : rows;
  }, [reservations, filter]);

  const upcomingRows = useMemo(() => upcoming(visible), [visible]);
  // The one booking the member most likely opened the app for.
  const myNext = useMemo(
    () => upcoming((reservations ?? []).filter((r) => r.mine))[0] ?? null,
    [reservations]
  );

  function openNew(date?: Date | null) {
    setOpenReservation(null);
    setCreateDate(date ?? new Date());
    setModalOpen(true);
  }

  function openExisting(reservation: ApiReservation) {
    setCreateDate(null);
    setOpenReservation(reservation);
    setModalOpen(true);
  }

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane has been set up yet. Seed one with{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">
            npm run db:seed
          </code>
          .
        </p>
      </Card>
    );
  }

  const canManage = (r: ApiReservation) => r.mine || Boolean(me?.isAdmin);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Reservations</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {selected.tailNumber} · {selected.model}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* All / Mine, as a segmented control — the only filter that has
              earned its place on this page. */}
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
                {value === "all" ? "Everyone" : "Mine"}
              </button>
            ))}
          </div>
          {/* Desktop's booking entry point; phones use the FAB below. The
              wrapper (not a `hidden` class on the Button) does the hiding:
              Button already sets `inline-flex`, and two display utilities on
              one element are a coin flip decided by stylesheet order. */}
          <div className="hidden sm:block">
            <Button onClick={() => openNew()}>Book the airplane</Button>
          </div>
        </div>
      </header>

      {/* Your next flight, above both layouts — it's the answer to the question
          that made you open the app. */}
      {myNext && (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 border-indigo-200 dark:border-indigo-800">
          <Badge tone="indigo">Your next flight</Badge>
          <span className="text-sm font-medium">
            {formatDay(myNext.startsAt)} · {formatTimeRange(myNext.startsAt, myNext.endsAt)}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {relativeDay(myNext.startsAt)}
          </span>
          <button
            onClick={() => openExisting(myNext)}
            className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Open
          </button>
        </Card>
      )}

      {/* Desktop: the month grid, sized to the space under the sticky nav so
          the page itself never scrolls (--app-header-h is published by the
          navbar and shrinks/grows with its banners). */}
      <div
        className="hidden sm:block"
        style={{ height: "calc(100dvh - var(--app-header-h) - 11rem)" }}
      >
        <ReservationCalendar
          reservations={visible}
          month={month}
          onMonthChange={setMonth}
          onSelect={openExisting}
          onCreateOnDay={(date) => openNew(date)}
        />
      </div>

      {/* Phone: the upcoming list. */}
      <div className="sm:hidden">
        <ReservationList reservations={upcomingRows} onSelect={openExisting} />
      </div>

      {/* Phone "+" button, floating clear of the bottom tab bar and the iOS
          home indicator. */}
      <button
        onClick={() => openNew()}
        aria-label="New reservation"
        className="fixed right-5 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-3xl leading-none text-white shadow-lg transition active:scale-95 sm:hidden"
      >
        <span className="-mt-0.5">+</span>
      </button>

      <ReservationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        aircraftId={selected.id}
        tailNumber={selected.tailNumber}
        reservation={openReservation}
        initialDate={createDate}
        canManage={openReservation ? canManage(openReservation) : true}
        onSaved={refresh}
      />
    </div>
  );
}
