"use client";
// Finances — what you owe the club, every month of it, newest first.
//
// The page used to be one month at a time, behind a month picker. That made
// the question a member actually has — "do I owe anything?" — a question about
// every month at once that could only be asked one month at a time, and an
// unpaid March was invisible to anyone who didn't think to open March. It is
// now one long statement: the balance at the top, the months below it under
// sticky headers, older ones loading as you scroll.
//
// Three views, and the server enforces which of them you can have:
//
//   Mine               every member — your own lines. The privacy rule is the
//                      API's, not a hidden button's.
//   Club (by person)   Finance Officer / admin — each month, member by member.
//   Club (by month)    the same lines as one list per month, across members,
//                      opening on just what's OUTSTANDING: the officer's
//                      to-chase list. Settled lines are a toggle away.
//
// The two club views read the same data, so flipping between them is free;
// only crossing between Mine and Club goes back to the server.
//
// Adding money is ONE dashed "+" panel at the top, for everyone: a member can
// claim a reimbursement for themselves, and the Finance Officer gets the rest
// — reimburse anyone, charge members (split or each), move the club's own
// funds, and the recurring rules. See components/finances/AddMoneyModal.tsx.
//
// Lines are a TABLE from `sm` up and a stacked LIST below it. A five-column
// table with three buttons per row is unreadable at 402px however it scrolls,
// and a phone is where a member checks what they owe.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmModal from "@/components/common/ConfirmModal";
import Input from "@/components/common/Input";
import MoneyInput from "@/components/common/MoneyInput";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import Toggle from "@/components/common/Toggle";
import AddMoneyModal from "@/components/finances/AddMoneyModal";
import ExportFinancesModal from "@/components/finances/ExportFinancesModal";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, fetchJsonObject, sendJson } from "@/lib/api";
import { getAppScroller } from "@/lib/appScroll";
import { formatDay } from "@/lib/dates";
import { CLUB_ACCOUNT, statementsFor } from "@/lib/ledgerView";
import {
  CHARGE_KIND_LABELS,
  clubPosition,
  currentPeriod,
  formatMoney,
  formatPeriod,
  isClubLine,
  isHandEntered,
  isPayback,
  balanceContribution,
  owedContribution,
  totals,
  type ChargeKind,
  type Period,
} from "@/lib/finance";
import type {
  ApiAircraft,
  ApiCharge,
  ApiLedgerMonth,
  ApiLedgerPage,
  ApiMember,
  ApiRecurringCharge,
  ApiStatement,
  ApiUserSummary,
} from "@/lib/types";

const KIND_TONES: Record<ChargeKind, "gray" | "indigo" | "green" | "amber"> = {
  DUES: "indigo",
  FLIGHT: "gray",
  FUEL_CREDIT: "green",
  ONE_OFF: "amber",
  // Gray with FLIGHT: both are what it cost to go flying, derived from the same
  // log entry. A colour of its own would imply the member has to do something
  // about it.
  LANDING_FEE: "gray",
  // Green with FUEL_CREDIT: both are money coming BACK to the member, and the
  // colour is what makes a credit legible at a glance in a column of debits.
  PAYBACK: "green",
  REIMBURSEMENT: "green",
};

type View = "mine" | "person" | "month";

const VIEW_LABELS: Record<View, string> = {
  mine: "Me",
  person: "Club (by person)",
  month: "Club (by month)",
};

/** How many months one scroll-triggered fetch brings in. */
const PAGE_MONTHS = 3;

/**
 * What a line's buttons do. Paid and Void (and their undos) happen on the
 * spot — the row turning green or being struck through IS the confirmation,
 * and the undo is right there on the same row. Delete is the one that asks,
 * because it's the one you can't take back.
 */
type LineAction = "paid" | "unpaid" | "void" | "restore" | "delete";

interface Ledger {
  /** Which scope these months were read for — Mine, or the whole club. */
  club: boolean;
  months: ApiLedgerMonth[];
  nextBefore: Period | null;
  /** Outstanding per member across EVERY month, loaded or not. */
  members: { member: ApiUserSummary; outstandingCents: number }[];
  /** The club's worth across every month — see `balanceContribution`. */
  paidCents: number;
  /** The member the MONTHS were narrowed to (club views), or null for all. */
  member: string | null;
}


// The `sm` breakpoint, as a live boolean. Lines render as a table at or above
// it and as a list below it — one or the other, never both hidden in the DOM,
// so a locator never finds a copy that isn't on screen. The server snapshot
// is irrelevant here (nothing renders until the ledger has loaded on the
// client), and says wide.
const WIDE_QUERY = "(min-width: 640px)";
function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true
  );
}

export default function FinancesPage() {
  const { me } = useMe();
  const { aircraft: fleet, selected } = useAircraft();
  const canManage = me?.capabilities.includes("finance:manage") ?? false;
  const canReadAll = me?.capabilities.includes("finance:read-all") ?? false;
  const canClaim = me?.capabilities.includes("finance:claim-own") ?? false;

  const [view, setView] = useState<View>("mine");
  const club = view !== "mine" && canReadAll;
  // One member's lines only — picked from the club summary's chips. Club
  // views only; the server does the narrowing, so every month shown (and
  // every month lazily loaded after it) is that member's.
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const filter = club ? memberFilter : null;

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped by every fresh load, so a page that arrives after the view has
  // moved on (or after a reload) is dropped rather than appended to the wrong
  // list.
  const generation = useRef(0);
  const loadingMoreRef = useRef(false);

  // Every view opens on EVERYTHING; "Outstanding" narrows any of them to the
  // lines still to settle (and drops months with none).
  const [showSettled, setShowSettled] = useState(true);

  const [addFor, setAddFor] = useState<Period | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // The line a delete has been asked for — the only confirmation on the page.
  const [deleting, setDeleting] = useState<ApiCharge | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Lines with a write in flight: their buttons lock until it lands, so a
  // double tap can't send Paid twice or race a Paid against its own undo.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  // A refused on-the-spot change. The row has already been put back; this
  // says why, in a toast rather than at the top of a page scrolled far away.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  usePageLoading(ledger === null && loadError === null);

  /**
   * (Re)read from the newest month. `count` is how many months to bring back
   * in one go — after a change, every month already on screen, so the list
   * doesn't collapse back to the top under the officer's thumb.
   */
  const reload = useCallback(
    async (count = PAGE_MONTHS) => {
      const gen = ++generation.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      const page = await fetchJsonObject<ApiLedgerPage>(
        `/api/finances/ledger?months=${count}${club ? "&all=1" : ""}${
          filter ? `&member=${encodeURIComponent(filter)}` : ""
        }`
      );
      if (gen !== generation.current) return;
      if (!page) {
        setLoadError("Couldn't load the books. Check your connection and try again.");
        return;
      }
      setLoadError(null);
      setLedger({
        club: page.clubWide,
        months: page.months,
        nextBefore: page.nextBefore,
        members: page.summary?.members ?? [],
        paidCents: page.summary?.paidCents ?? 0,
        member: filter,
      });
    },
    [club, filter]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!ledger?.nextBefore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const gen = generation.current;
    const page = await fetchJsonObject<ApiLedgerPage>(
      `/api/finances/ledger?before=${ledger.nextBefore}&months=${PAGE_MONTHS}${
        ledger.club ? "&all=1" : ""
      }${ledger.member ? `&member=${encodeURIComponent(ledger.member)}` : ""}`
    );
    if (gen !== generation.current) return;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!page) {
      setLoadError("Couldn't load older months. Scroll again to retry.");
      return;
    }
    setLedger((current) =>
      current
        ? {
            ...current,
            months: [...current.months, ...page.months],
            nextBefore: page.nextBefore,
          }
        : current
    );
  }, [ledger]);

  // Lazy loading: a sentinel under the last month, watched against the app's
  // one scroller (the window never scrolls — see lib/appScroll.ts). Visibility
  // is held as STATE rather than acted on in the observer's callback, because
  // the observer only reports changes: if one page doesn't fill the screen the
  // sentinel stays in view, no callback fires, and the effect below is what
  // notices and asks for the next page.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSentinelVisible(entry.isIntersecting),
      { root: getAppScroller(), rootMargin: "0px 0px 600px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  // `current` = the ledger matches the scope on screen (Me vs club). The
  // summary is drawn from it as soon as it does; the MONTHS also need the
  // member filter to match — until the narrowed read lands, the list shows a
  // loader, so it's plain that it's being filtered rather than that the
  // other members' lines vanished.
  const current = ledger && ledger.club === club ? ledger : null;
  const listReady = current !== null && current.member === filter;

  useEffect(() => {
    if (sentinelVisible && listReady && current?.nextBefore && !loadingMore) loadMore();
  }, [sentinelVisible, listReady, current, loadingMore, loadMore]);

  /**
   * Fold one line's change into what's loaded, without a round trip.
   *
   * The months on screen take the server's copy of the line; the all-months
   * summary — which covers months that AREN'T loaded, so it can't simply be
   * re-added — takes the DIFFERENCE the change makes to what's outstanding
   * and to what's been paid.
   */
  function applyChange(before: ApiCharge, after: ApiCharge | null) {
    const delta = (after ? owedContribution(after) : 0) - owedContribution(before);
    const paidDelta = (after ? balanceContribution(after) : 0) - balanceContribution(before);
    setLedger((prev) => {
      if (!prev) return prev;
      const l = { ...prev, paidCents: prev.paidCents + paidDelta };
      const months = l.months.map((m) =>
        m.period !== before.period
          ? m
          : {
              ...m,
              charges: after
                ? m.charges.map((c) => (c.id === before.id ? after : c))
                : m.charges.filter((c) => c.id !== before.id),
            }
      );
      const owner = before.member;
      // A club line is never owed by anyone: only the balance moves.
      if (!owner) return { ...l, months };
      const known = l.members.some((m) => m.member.id === owner.id);
      const members = known
        ? l.members.map((m) =>
            m.member.id === owner.id
              ? { ...m, outstandingCents: m.outstandingCents + delta }
              : m
          )
        : [...l.members, { member: owner, outstandingCents: delta }];
      return { ...l, months, members };
    });
  }

  function lock(ids: string[], on: boolean) {
    setInFlight((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /** The line as it will stand once `action` lands — drawn before it does. */
  function predicted(charge: ApiCharge, action: Exclude<LineAction, "delete">): ApiCharge {
    switch (action) {
      case "paid":
        return {
          ...charge,
          paidAt: new Date().toISOString(),
          paidBy: me ? { id: me.id, name: me.name, email: me.email } : null,
        };
      case "unpaid":
        return { ...charge, paidAt: null, paidBy: null };
      case "void":
        return { ...charge, voided: true };
      case "restore":
        return { ...charge, voided: false, voidReason: null };
    }
  }

  /**
   * Paid / Unpay / Void / Restore: no dialog. The row changes the moment it's
   * tapped (the change IS the feedback), the server is told, and its copy of
   * the line replaces the guess — or, if it refuses, the row goes back to how
   * it was and a toast says why.
   */
  async function act(action: LineAction, charge: ApiCharge) {
    if (action === "delete") {
      setDeleteError(null);
      setDeleting(charge);
      return;
    }
    if (inFlight.has(charge.id)) return;
    const guess = predicted(charge, action);
    lock([charge.id], true);
    applyChange(charge, guess);
    const result = await sendJson<ApiCharge>(
      `/api/finances/charges/${charge.id}`,
      "PATCH",
      action === "paid" || action === "unpaid"
        ? { paid: action === "paid" }
        : { voided: action === "void" }
    );
    lock([charge.id], false);
    if (!result.ok || !result.data) {
      applyChange(guess, charge);
      setToast(result.error ?? "Couldn't change that line — it's been put back.");
      return;
    }
    applyChange(guess, result.data);
  }

  /** "Mark all paid" on a month — on the spot too, every line at once. */
  async function settleMonth(lines: ApiCharge[]) {
    const ids = lines.map((c) => c.id);
    if (ids.some((id) => inFlight.has(id))) return;
    const guesses = lines.map((c) => predicted(c, "paid"));
    lock(ids, true);
    lines.forEach((c, i) => applyChange(c, guesses[i]));
    const result = await sendJson<ApiCharge[]>("/api/finances/charges/paid", "POST", { ids });
    lock(ids, false);
    if (!result.ok || !Array.isArray(result.data)) {
      lines.forEach((c, i) => applyChange(guesses[i], c));
      setToast(result.error ?? "Couldn't mark that month paid — nothing was changed.");
      return;
    }
    const guessById = new Map(guesses.map((g) => [g.id, g]));
    for (const after of result.data) {
      const guess = guessById.get(after.id);
      if (guess) applyChange(guess, after);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setDeleteBusy(true);
    const result = await sendJson<unknown>(`/api/finances/charges/${deleting.id}`, "DELETE");
    setDeleteBusy(false);
    if (!result.ok) {
      setDeleteError(result.error ?? "Could not delete that line.");
      return;
    }
    applyChange(deleting, null);
    setDeleting(null);
  }

  const outstandingNow = useMemo(
    () => (current ? current.members.reduce((sum, m) => sum + m.outstandingCents, 0) : 0),
    [current]
  );

  if (!ledger && loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Finances</h1>
        <ErrorLine message={loadError} />
        <Button variant="secondary" onClick={() => reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!ledger) return null;

  const months = current?.months ?? [];
  const reloadLoaded = () => reload(Math.max(PAGE_MONTHS, months.length));

  return (
    <div className="space-y-4">
      <header className="space-y-3 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-3 sm:space-y-0">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Finances</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {club ? "The club's books, every month" : "Your statement, every month"}
            </p>
          </div>
          {/* Opens the export window, which asks for the months, kinds and
              (officer) people — and reads them itself, so the file doesn't
              depend on how far down the page you'd scrolled. The scope is the
              one the API actually returned (`current.club`, not the switch):
              the privacy rule is the server's. */}
          {current && (
            <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
              Export
            </Button>
          )}
        </div>

        {/* Whose books, and how much of them: the view switch and the
            Everything/Outstanding filter side by side, because together they
            ARE the question the page is answering. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {canReadAll && (
            // Full width on a phone, three equal segments — three labels of
            // different lengths in a wrapping row was what crammed the header.
            <div
              role="group"
              aria-label="Whose books"
              className="grid grid-cols-3 rounded-lg border border-gray-200 p-0.5 dark:border-gray-700 sm:flex"
            >
              {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    // "Me" is one member already; a club filter doesn't carry.
                    if (v === "mine") setMemberFilter(null);
                  }}
                  aria-pressed={view === v}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium leading-tight sm:px-3 sm:py-1 sm:text-sm ${
                    view === v
                      ? "bg-indigo-600 text-white"
                      : "text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Toggle
              label="Show settled lines"
              checked={showSettled}
              onChange={setShowSettled}
              offLabel="Outstanding"
              onLabel="Everything"
            />
          </div>
        </div>
      </header>

      {loadError && <ErrorLine message={loadError} />}

      {!current ? (
        <div className="flex justify-center py-10">
          <LoadingDots />
        </div>
      ) : (
        <>
          <BalanceSummary
            club={current.club}
            members={current.members}
            paidCents={current.paidCents}
            outstandingCents={outstandingNow}
            selected={filter}
            onSelect={(id) => setMemberFilter((cur) => (cur === id ? null : id))}
          />

          {(canManage || canClaim) && (
            <AddPanel officer={canManage} onOpen={() => setAddFor(currentPeriod())} />
          )}

          {filter && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 dark:text-gray-400">Showing only</span>
              <button
                type="button"
                onClick={() => setMemberFilter(null)}
                aria-label={`Clear filter: ${filterName(current.members, filter)}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                {filterName(current.members, filter)}
                <span aria-hidden>✕</span>
              </button>
            </div>
          )}

          {!listReady ? (
            <div role="status" aria-label="Filtering" className="flex justify-center py-10">
              <LoadingDots />
            </div>
          ) : (
            <>
          <MonthList
              view={current.club ? view : "mine"}
              months={months}
              showSettled={showSettled}
              canManage={canManage}
              inFlight={inFlight}
              onAction={act}
              onSettle={settleMonth}
              onAdd={(period) => setAddFor(period)}
              finished={current.nextBefore === null}
            />
  
            {/* What the observer watches. Always rendered while there's more,
                so the next page is asked for before the reader reaches it. */}
            <div ref={setSentinel} aria-hidden className="h-px" />
            {current.nextBefore ? (
              <div className="flex justify-center py-4">
                {loadingMore ? (
                  <LoadingDots size="sm" />
                ) : (
                  <Button variant="ghost" size="sm" onClick={loadMore}>
                    Load older months
                  </Button>
                )}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                That&apos;s everything — the books start here.
              </p>
            )}
            </>
          )}
        </>
      )}

      {deleting && (
        <DeleteLineModal
          charge={deleting}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-sm rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900 md:bottom-6"
        >
          {toast}
        </div>
      )}

      {addFor && me && (
        <AddMoneyModal
          officer={canManage}
          me={{ id: me.id, name: me.name }}
          period={addFor}
          onClose={() => setAddFor(null)}
          onSaved={async () => {
            setAddFor(null);
            await reloadLoaded();
          }}
          onOpenRecurring={() => {
            setAddFor(null);
            setRulesOpen(true);
          }}
        />
      )}

      {exportOpen && current && (
        <ExportFinancesModal club={current.club} onClose={() => setExportOpen(false)} />
      )}

      {rulesOpen && (
        <RulesModal
          fleet={fleet ?? []}
          initialAircraftId={selected?.id ?? null}
          onClose={() => setRulesOpen(false)}
          onChanged={reloadLoaded}
        />
      )}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
      {message}
    </p>
  );
}

function sumOf(charges: ApiCharge[]): number {
  return charges.reduce((sum, c) => sum + c.amountCents, 0);
}

/** The chip's name for a filtered member — they're always in the summary. */
function filterName(
  members: { member: ApiUserSummary }[],
  id: string
): string {
  return members.find((m) => m.member.id === id)?.member.name ?? "one member";
}

/**
 * The one way in to adding money: a dashed "+" panel, the shape that says
 * "something goes here" rather than "here is a setting". Everyone with a
 * statement sees it; what it opens depends on who you are.
 */
function AddPanel({ officer, onOpen }: { officer: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={officer ? "Add money" : "Claim a reimbursement"}
      className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-2 text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-700 focus-visible:border-indigo-500 focus-visible:outline-none dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/10 dark:hover:text-indigo-300"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 transition-colors group-hover:bg-indigo-100 dark:bg-gray-700/60 dark:group-hover:bg-indigo-900/40">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4">
          <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
        </svg>
      </span>
      <span className="text-sm font-medium">
        {officer ? "Reimburse, charge members or add club funds" : "Claim a reimbursement"}
      </span>
    </button>
  );
}


/**
 * The bottom line, across every month — the figure the page is for.
 *
 * Mine: what you owe right now, and the COLOUR says which way before the
 * number does — red when you owe the club, green when it owes you, neutral
 * when you're square. A figure whose meaning depends on reading the small
 * label above it is one people misread.
 *
 * Club: what members owe the club and what the club owes members, kept apart
 * (see `clubPosition`); the club's own lines, which are nobody's; and the
 * CLUB BALANCE — what the club is WORTH, i.e. every line that has actually
 * been paid — with what's still unsettled beside it in brackets. Each
 * member's own balance sits beneath for anyone wondering who.
 */
function BalanceSummary({
  club,
  members,
  paidCents,
  outstandingCents,
  selected = null,
  onSelect,
}: {
  club: boolean;
  members: { member: ApiUserSummary; outstandingCents: number }[];
  paidCents: number;
  outstandingCents: number;
  /** The member the list is narrowed to, if any — their chip reads as pressed. */
  selected?: string | null;
  onSelect?: (memberId: string) => void;
}) {
  if (!club) {
    let tone: "owe" | "owed" | "settled" = "settled";
    if (outstandingCents > 0) tone = "owe";
    if (outstandingCents < 0) tone = "owed";
    const styles = {
      owe: {
        card: "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30",
        amount: "text-red-600 dark:text-red-400",
        verdict: "You owe the club",
      },
      owed: {
        card: "border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/30",
        amount: "text-green-600 dark:text-green-400",
        verdict: "The club owes you",
      },
      settled: {
        card: "",
        amount: "text-gray-900 dark:text-gray-100",
        verdict: "You're all settled",
      },
    }[tone];
    return (
      <Card className={`flex items-center justify-between gap-3 ${styles.card}`}>
        <div className="min-w-0" data-tone={tone}>
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Your balance
          </h2>
          <p className={`text-base font-semibold ${styles.amount}`}>{styles.verdict}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Across every month, unpaid lines only
          </p>
        </div>
        <p className={`tabular shrink-0 text-3xl font-bold ${styles.amount}`}>
          {formatMoney(Math.abs(outstandingCents))}
        </p>
      </Card>
    );
  }

  const { owedToClubCents, owedByClubCents } = clubPosition(
    members.map((m) => m.outstandingCents)
  );
  const owing = members
    .filter((m) => m.outstandingCents !== 0)
    .sort((a, b) => b.outstandingCents - a.outstandingCents);
  // The balance is money that has MOVED: a paid member charge adds, a paid
  // credit subtracts, a club line (no member) counts at once, and an unpaid
  // member line changes nothing until it's met. What members still owe, or
  // are owed, is the bracketed figure beside it — positive = money the club
  // is still missing, negative = money it still owes out.
  const unsettled = owedToClubCents - owedByClubCents;

  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Members owe the club" cents={owedToClubCents} />
        <Figure
          label="The club owes members"
          cents={owedByClubCents}
          green={owedByClubCents > 0}
        />
        <Figure
          label="Club balance"
          cents={paidCents}
          aside={unsettledNote(unsettled)}
          hint="money that has moved"
          strong
        />
      </div>
      {owing.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {owing.map(({ member, outstandingCents }) => {
            const on = selected === member.id;
            return (
              <li key={member.id}>
                {/* A chip is a filter: tap it to see only this member's lines,
                    tap it again (or the ✕ above the list) to see everyone. */}
                <button
                  type="button"
                  onClick={() => onSelect?.(member.id)}
                  aria-pressed={on}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                    on
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/60 dark:hover:bg-gray-700"
                  }`}
                >
                  {member.name}{" "}
                  <span
                    className={`tabular font-semibold ${
                      outstandingCents < 0 && !on ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {outstandingCents < 0
                      ? `owed ${formatMoney(-outstandingCents)}`
                      : formatMoney(outstandingCents)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Figure({
  label,
  cents,
  aside,
  hint,
  green = false,
  strong = false,
}: {
  label: string;
  cents: number;
  /** A bracketed note on the same line as the figure — "(missing $40.00)". */
  aside?: string;
  hint?: string;
  green?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "rounded-lg bg-indigo-50 px-2 py-1 dark:bg-indigo-900/20" : ""}>
      <h2 className="text-xs text-gray-500 dark:text-gray-400">{label}</h2>
      {/* Wraps rather than overflowing: the bracket sits beside the figure
          when the column has room and drops under it when it doesn't — a
          four-figure balance plus "(missing $2,713.12)" is wider than half a
          phone, and nowrap pushed the whole page sideways. */}
      <p
        className={`tabular flex flex-wrap items-baseline gap-x-1.5 text-xl font-bold ${
          green ? "text-green-600 dark:text-green-400" : ""
        }`}
      >
        <span>{formatMoney(cents)}</span>
        {aside && (
          <span className="whitespace-nowrap text-xs font-medium text-amber-700 dark:text-amber-400">
            ({aside})
          </span>
        )}
      </p>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  );
}

/**
 * Month after month, each under a header that sticks to the top of the
 * scroller while you're inside it — so however far down a long month you are,
 * the month you're reading is named above you.
 */
function MonthList({
  view,
  months,
  showSettled,
  canManage,
  inFlight,
  onAction,
  onSettle,
  onAdd,
  finished,
}: {
  view: View;
  months: ApiLedgerMonth[];
  /** Everything (true) or only what's still to settle (false) — every view. */
  showSettled: boolean;
  canManage: boolean;
  inFlight: ReadonlySet<string>;
  onAction: (action: LineAction, charge: ApiCharge) => void;
  onSettle: (lines: ApiCharge[]) => void;
  onAdd: (period: Period) => void;
  finished: boolean;
}) {
  const header = (m: ApiLedgerMonth) => {
    const open = m.charges.filter((c) => owedContribution(c) !== 0);
    const busy = open.some((c) => inFlight.has(c.id));
    return (
      <MonthHeader
        period={m.period}
        figure={sumOf(open)}
        actions={
          canManage ? (
            <>
              {open.length > 0 && (
                <Button
                  size="sm"
                  variant="success"
                  disabled={busy}
                  onClick={() => onSettle(open)}
                >
                  Mark all paid
                </Button>
              )}
              {view === "person" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAdd(m.period)}
                  aria-label={`Add money in ${formatPeriod(m.period)}`}
                  title={`Add money in ${formatPeriod(m.period)}`}
                >
                  +
                </Button>
              )}
            </>
          ) : null
        }
      />
    );
  };

  const lineProps = { canManage, inFlight, onAction };

  // What each month shows under the filter. "Outstanding" drops settled lines
  // AND the months left with none — a run of "nothing outstanding" headers is
  // noise. "Everything" keeps every month in Me and by person (an empty month
  // is an answer: nothing was billed), while by month — the cross-member list
  // — still skips months with no lines at all.
  const shown = months
    .map((m) => ({
      ...m,
      lines: showSettled
        ? m.charges
        : m.charges.filter((c) => owedContribution(c) !== 0),
    }))
    .filter((m) => m.lines.length > 0 || (showSettled && view !== "month"));

  if (shown.length === 0 && finished) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {showSettled ? "No charges yet." : "Nothing outstanding — every line is settled."}
        </p>
      </Card>
    );
  }

  if (view === "month") {
    return (
      <>
        {shown.map((m) => (
          <section key={m.period} aria-label={formatPeriod(m.period)}>
            {header(m)}
            <Card>
              <ChargeLines
                caption={`Charges for ${formatPeriod(m.period)}`}
                charges={m.lines}
                showMember
                {...lineProps}
              />
            </Card>
          </section>
        ))}
      </>
    );
  }

  return (
    <>
      {shown.map((m) => (
        <section key={m.period} aria-label={formatPeriod(m.period)} className="space-y-3">
          {header(m)}
          {m.lines.length === 0 ? (
            <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
              Nothing on the books this month.
            </p>
          ) : view === "person" ? (
            statementsFor(m.lines, m.period).map((statement) => (
              <Card key={statement.member.id} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    {statement.member === CLUB_ACCOUNT
                      ? "Club (no member)"
                      : statement.member.name}
                  </h3>
                  {/* The month's total for this person, in the card's own
                      header rather than a footer row of its own. */}
                  <span
                    className={`tabular text-sm font-semibold ${
                      statement.balanceCents < 0 ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {formatMoney(statement.balanceCents)}
                  </span>
                </div>
                <ChargeLines
                  caption={`${statement.member.name}'s charges for ${formatPeriod(m.period)}`}
                  charges={statement.charges}
                  {...lineProps}
                />
              </Card>
            ))
          ) : (
            <Card>
              <ChargeLines
                caption={`Your charges for ${formatPeriod(m.period)}`}
                charges={m.lines}
                {...lineProps}
              />
            </Card>
          )}
        </section>
      ))}
    </>
  );
}

function MonthHeader({
  period,
  figure,
  actions,
}: {
  period: Period;
  figure: number;
  actions?: ReactNode;
}) {
  return (
    // `top-0` of the app's scroller, not the window: the top bar lives
    // outside the scroller, so the header parks directly under it. Bleeds to
    // the column's edges (-mx-4 px-4) with the page's own ground behind it,
    // so rows slide UNDER it rather than through it.
    <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center justify-between gap-3 bg-gray-50/95 px-4 py-2 backdrop-blur dark:bg-gray-900/95">
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{formatPeriod(period)}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          <span className={`tabular font-semibold ${figureTone(figure)}`}>
            {formatMoney(figure)}
          </span>{" "}
          outstanding
        </p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

interface LineProps {
  caption: string;
  charges: ApiCharge[];
  /** The by-month view's lines come from every member, so name them. */
  showMember?: boolean;
  canManage: boolean;
  /** Lines with a write in flight — their buttons are locked until it lands. */
  inFlight: ReadonlySet<string>;
  onAction: (action: LineAction, charge: ApiCharge) => void;
}

/**
 * A statement's lines: a real table from `sm` up (dates under dates, amounts
 * under amounts — what makes a column of money scannable), and a stacked list
 * on a phone, where the same five columns plus three buttons had nowhere to
 * go but sideways.
 *
 * A line's STATE is drawn on the whole row, because with no dialog the row is
 * the confirmation: PAID turns it green and VOIDED strikes it through, and in
 * both the row's other action greys out — the one live button left is the
 * undo (Unpay / Restore), plus the trash can.
 */
function ChargeLines(props: LineProps) {
  const wide = useIsWide();
  return wide ? <ChargeTable {...props} /> : <ChargeList {...props} />;
}

/**
 * Settled by a member paying it. Never true of a club line (no member) —
 * whatever its stored flag says, there is nobody whose paying it would be.
 */
function isPaid(charge: ApiCharge): boolean {
  return !isClubLine(charge) && Boolean(charge.paidAt);
}

/** A line's state, as the `data-state` the rows carry (and e2e reads). */
function lineState(charge: ApiCharge): "voided" | "paid" | "open" {
  if (charge.voided) return "voided";
  if (isPaid(charge)) return "paid";
  return "open";
}

/** The bracket beside the club balance: what members still owe, or are owed. */
function unsettledNote(cents: number): string | undefined {
  if (cents > 0) return `missing ${formatMoney(cents)}`;
  if (cents < 0) return `owes ${formatMoney(-cents)}`;
  return undefined;
}

/** A month's outstanding figure: green when it's money owed back, plain at zero. */
function figureTone(cents: number): string {
  if (cents < 0) return "text-green-600 dark:text-green-400";
  if (cents > 0) return "text-gray-900 dark:text-gray-100";
  return "";
}

/** The row's look for its state — green when paid, struck through when voided. */
function rowTone(charge: ApiCharge): string {
  if (charge.voided) return "opacity-60";
  if (isPaid(charge)) return "bg-green-50 dark:bg-green-900/20";
  return "";
}

/** Text in a settled row: struck through when voided, quietened when paid. */
function textTone(charge: ApiCharge): string {
  if (charge.voided) return "text-gray-400 line-through dark:text-gray-500";
  if (isPaid(charge)) return "text-gray-500 dark:text-gray-400";
  return "";
}

function ChargeTable({
  caption,
  charges,
  showMember = false,
  canManage,
  inFlight,
  onAction,
}: LineProps) {
  return (
    // Bleeds to the card's edges (-mx-4, the Card's own padding) so a paid
    // row's green runs the full width of the card; the first and last cells
    // put the padding back inside the row.
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th scope="col" className="py-1.5 pl-4 pr-3 text-left font-medium">
              Date
            </th>
            {showMember && (
              <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                Member
              </th>
            )}
            <th scope="col" className="py-1.5 pr-3 text-left font-medium">
              Type
            </th>
            <th scope="col" className="py-1.5 pr-3 text-left font-medium">
              Description
            </th>
            <th
              scope="col"
              className={`py-1.5 text-right font-medium ${canManage ? "pr-1" : "pr-4"}`}
            >
              Amount
            </th>
            {canManage && (
              <th scope="col" className="py-1.5 pl-3 pr-4 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {charges.map((charge) => {
            const text = textTone(charge);
            return (
              <tr
                key={charge.id}
                className={rowTone(charge)}
                data-state={lineState(charge)}
              >
                <td
                  className={`whitespace-nowrap py-2 pl-4 pr-3 ${
                    text || "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {formatDay(new Date(charge.incurredOn))}
                </td>
                {showMember && (
                  <td className={`whitespace-nowrap py-2 pr-3 ${text}`}>
                    <MemberName charge={charge} />
                  </td>
                )}
                <td className="py-2 pr-3">
                  <Badge tone={KIND_TONES[charge.kind]}>{CHARGE_KIND_LABELS[charge.kind]}</Badge>
                </td>
                <td className={`py-2 pr-3 ${text}`}>
                  {charge.description}
                  <LineState charge={charge} />
                </td>
                <td
                  className={`tabular whitespace-nowrap py-2 text-right font-medium ${
                    canManage ? "pr-1" : "pr-4"
                  } ${amountTone(charge)}`}
                >
                  {formatMoney(charge.amountCents)}
                </td>
                {canManage && (
                  <td className="py-1.5 pl-3 pr-4">
                    <LineActions
                      charge={charge}
                      busy={inFlight.has(charge.id)}
                      onAction={onAction}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The phone shape: one line per entry, the description and the amount on the
 * first row (the two things you're reading for), when/what/state beneath in
 * small type, and the officer's buttons on their own row so they're thumb-
 * sized rather than squeezed into a column.
 */
function ChargeList({
  caption,
  charges,
  showMember = false,
  canManage,
  inFlight,
  onAction,
}: LineProps) {
  return (
    <ul aria-label={caption} className="-mx-4 -my-1 divide-y divide-gray-100 dark:divide-gray-700">
      {charges.map((charge) => (
        <li
          key={charge.id}
          className={`px-4 py-2.5 ${rowTone(charge)}`}
          data-state={lineState(charge)}
        >
          <div className="flex items-start justify-between gap-3">
            <p className={`min-w-0 text-sm font-medium ${textTone(charge)}`}>
              {charge.description}
            </p>
            <span className={`tabular shrink-0 text-sm font-semibold ${amountTone(charge)}`}>
              {formatMoney(charge.amountCents)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>{formatDay(new Date(charge.incurredOn))}</span>
            {showMember && (
              <span>
                · <MemberName charge={charge} />
              </span>
            )}
            <Badge tone={KIND_TONES[charge.kind]}>{CHARGE_KIND_LABELS[charge.kind]}</Badge>
            <LineState charge={charge} />
          </div>
          {canManage && (
            <div className="mt-2">
              <LineActions
                charge={charge}
                busy={inFlight.has(charge.id)}
                onAction={onAction}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function MemberName({ charge }: { charge: ApiCharge }) {
  return charge.member ? (
    <>{charge.member.name}</>
  ) : (
    <span className="italic text-gray-500 dark:text-gray-400">Club</span>
  );
}

/** "voided" / "✓ paid 3 Aug" beside a line — paid and voided are not the same claim. */
function LineState({ charge }: { charge: ApiCharge }) {
  if (charge.voided) {
    return (
      <span className="ml-2 inline-block align-middle text-xs uppercase tracking-wide text-gray-400">
        voided
      </span>
    );
  }
  if (!isPaid(charge) || !charge.paidAt) return null;
  return (
    <span
      className="ml-2 inline-block align-middle text-xs font-medium text-green-700 dark:text-green-400"
      title={charge.paidBy ? `Marked paid by ${charge.paidBy.name}` : undefined}
    >
      ✓ paid {formatDay(new Date(charge.paidAt))}
    </span>
  );
}

function amountTone(charge: ApiCharge): string {
  if (charge.voided) return "text-gray-400 line-through dark:text-gray-500";
  if (isPaid(charge)) return "text-gray-500 dark:text-gray-400";
  return charge.amountCents < 0 ? "text-green-600 dark:text-green-400" : "";
}

/**
 * Paid · Void · 🗑, on every line.
 *
 *   open    — Paid (green) and Void (grey) both live.
 *   paid    — Unpay is the undo; Void is greyed out (settle it OR unwind it,
 *             not both — unpay first if it should never have stood).
 *   voided  — Restore is the undo; Paid is greyed out.
 *
 * Only the trash can asks first — it's the one action with no undo.
 */
function LineActions({
  charge,
  busy,
  onAction,
}: {
  charge: ApiCharge;
  busy: boolean;
  onAction: (action: LineAction, charge: ApiCharge) => void;
}) {
  const paid = isPaid(charge);
  const voided = charge.voided;
  // A club line (no member) is the club's own money — nobody to pay it, so
  // no Paid/Unpay at all: it counts the moment it exists, unless voided.
  const club = isClubLine(charge);

  let settle: ReactNode = null;
  if (!club && paid) {
    settle = (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("unpaid", charge)}>
        Unpay
      </Button>
    );
  } else if (!club) {
    settle = (
      <Button
        size="sm"
        variant="success"
        disabled={busy || voided}
        onClick={() => onAction("paid", charge)}
      >
        Paid
      </Button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {settle}
      {voided ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction("restore", charge)}>
          Restore
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || paid}
          onClick={() => onAction("void", charge)}
        >
          Void
        </Button>
      )}
      <button
        type="button"
        onClick={() => onAction("delete", charge)}
        disabled={busy}
        aria-label="Delete"
        title="Delete"
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/30 dark:hover:text-red-400"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Where a line's source would write it back from, for the delete dialog. */
const REBUILT_FROM: Partial<Record<ChargeKind, string>> = {
  DUES: "its recurring rule",
  PAYBACK: "its recurring rule",
  FLIGHT: "its flight",
  LANDING_FEE: "its flight",
  FUEL_CREDIT: "its flight or fill-up",
};

/** The one confirmation on the page: a delete can't be taken back. */
function DeleteLineModal({
  charge,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  charge: ApiCharge;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const member = charge.member;
  const where = member ? `${member.name}\u2019s statement` : "the club\u2019s books";
  const source = isHandEntered(charge.kind) ? null : REBUILT_FROM[charge.kind];
  return (
    <ConfirmModal
      open
      title="Delete this line?"
      subtitle={`${member?.name ?? "Club"} · ${charge.description} · ${formatMoney(charge.amountCents)}`}
      confirmLabel="Delete"
      tone="danger"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        It disappears from {where} and from the club&rsquo;s totals.
        {source && (
          <>
            {" "}
            It won&rsquo;t be rebuilt from {source}, even if that changes later.
          </>
        )}{" "}
        To keep a record that it was charged and unwound, <strong>void</strong> it
        instead.
      </p>
      <p className="text-gray-500 dark:text-gray-400">This can&rsquo;t be undone.</p>
    </ConfirmModal>
  );
}

/**
 * The standing monthly charges, and the price of an hour.
 *
 * The rate is per AIRPLANE — a club with a 172 and a Cherokee charges
 * differently for each — so the officer picks the airplane first and the field
 * follows it. This is the only place the rate can be set: it's a price, so it
 * doesn't belong in club settings next to the tail number and the fuel capacity.
 */
function RulesModal({
  fleet,
  initialAircraftId,
  onClose,
  onChanged,
}: {
  fleet: ApiAircraft[];
  initialAircraftId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<ApiRecurringCharge[] | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  // Which DIRECTION the money goes. A charge bills the club's members; a
  // PAYBACK credits one of them — the $50 a month for running the website, or
  // keeping the books. Same rule underneath, and the sign of `amountCents` is
  // the only difference (see `recurringKind` in lib/finance.ts) — but it is
  // asked as a direction rather than a minus sign, because a minus sign in a
  // money box is the sort of thing that gets lost, and losing it here means
  // billing somebody instead of paying them.
  const [payback, setPayback] = useState(false);
  // Who it applies to. Blank = every member, which is the dues case and the
  // only one the form used to allow — a rule for ONE person was reachable
  // through the API and nowhere in the UI. A payback has to name somebody.
  const [ruleMemberId, setRuleMemberId] = useState("");
  const [roster, setRoster] = useState<ApiMember[] | null>(null);
  const [aircraftId, setAircraftId] = useState(
    initialAircraftId ?? fleet[0]?.id ?? ""
  );
  const chosen = fleet.find((a) => a.id === aircraftId) ?? null;
  const tailNumber = chosen?.tailNumber ?? "";
  const [rate, setRate] = useState(
    chosen?.hourlyRateCents != null ? (chosen.hourlyRateCents / 100).toFixed(2) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching airplane loads that airplane's rate into the field. Keyed on the
  // id rather than the object so the provider's periodic refetch — which hands
  // back a new object every time — doesn't wipe what's being typed.
  useEffect(() => {
    const next = fleet.find((a) => a.id === aircraftId);
    setRate(
      next?.hourlyRateCents != null ? (next.hourlyRateCents / 100).toFixed(2) : ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftId]);

  const loadRules = useCallback(async () => {
    setRules(await fetchJsonArray<ApiRecurringCharge>("/api/finances/recurring"));
  }, []);

  // The roster, for the "billed to" picker. Every member can read it, and the
  // only people who can open this modal already hold `finance:manage`.
  useEffect(() => {
    fetchJsonArray<ApiMember>("/api/members").then(setRoster);
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  async function addRule() {
    setError(null);
    setBusy(true);
    const result = await sendJson("/api/finances/recurring", "POST", {
      label,
      // Always POSITIVE dollars plus a direction — the server combines them.
      amountDollars: amount,
      payback,
      memberId: ruleMemberId || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add that recurring charge.");
      return;
    }
    setLabel("");
    setAmount("");
    setPayback(false);
    setRuleMemberId("");
    await loadRules();
    onChanged();
  }

  async function toggleRule(rule: ApiRecurringCharge) {
    setBusy(true);
    await sendJson(`/api/finances/recurring/${rule.id}`, "PATCH", {
      active: !rule.active,
    });
    setBusy(false);
    await loadRules();
    onChanged();
  }

  async function saveRate() {
    if (!aircraftId) return;
    setError(null);
    setBusy(true);
    const cents = Math.round(Number(rate) * 100);
    const result = await sendJson(`/api/aircraft/${aircraftId}`, "PATCH", {
      hourlyRateCents: Number.isFinite(cents) ? cents : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change the rate.");
      return;
    }
    // The fleet's rate is cached in the provider, and every page shows it.
    notifyAircraftChanged();
  }

  return (
    <Modal open onClose={onClose} title="Recurring charges & rate" size="lg">
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Hourly rate</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Charged per tach hour on every filed flight. Changing it prices
            future flights — statements already issued keep the rate they were
            billed at.
          </p>
          {fleet.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No airplanes in the fleet yet.
            </p>
          ) : (
            <Select
              label="Airplane"
              value={aircraftId}
              onChange={(e) => setAircraftId(e.target.value)}
            >
              {fleet.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tailNumber}
                  {a.model ? ` — ${a.model}` : ""}
                  {a.hourlyRateCents != null
                    ? ` · ${formatMoney(a.hourlyRateCents)}/hr`
                    : " · no rate set"}
                </option>
              ))}
            </Select>
          )}
          {/* Field on its own line, action beneath it. Sitting a Button next
              to an Input in an items-end flex looks aligned until one of them
              grows a hint or an error, at which point the labels stagger. */}
          <MoneyInput
            label={
              tailNumber ? `Dollars per tach hour — ${tailNumber}` : "Dollars per tach hour"
            }
            value={rate}
            onChange={setRate}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={saveRate}
              disabled={busy || !aircraftId || rate === ""}
            >
              Save
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Monthly charges &amp; paybacks</h3>
          {rules === null ? (
            <LoadingDots size="sm" />
          ) : rules.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              None yet — add one below. A charge bills every member each month;
              a payback credits one member each month.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                      Charge
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                      Billed to
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rules.map((rule) => (
                    <tr key={rule.id} className={rule.active ? "" : "opacity-60"}>
                      <td className="py-2 pr-3">
                        {rule.label}
                        {/* A payback is chipped rather than left to be read off
                            a minus sign in the amount column. Which direction
                            the money goes is the most important thing about
                            the row, and a leading "−" is one glyph. */}
                        {isPayback(rule) && (
                          <span className="ml-2 align-middle">
                            <Badge tone="green">Payback</Badge>
                          </span>
                        )}
                        {!rule.active && (
                          <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">
                            stopped
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">
                        {rule.member ? rule.member.name : "Every member"}
                      </td>
                      <td
                        className={`tabular whitespace-nowrap py-2 pr-3 text-right font-medium ${
                          isPayback(rule) ? "text-green-700 dark:text-green-400" : ""
                        }`}
                      >
                        {isPayback(rule)
                          ? `${formatMoney(Math.abs(rule.amountCents))}/mo to them`
                          : `${formatMoney(rule.amountCents)}/mo`}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => toggleRule(rule)}
                          disabled={busy}
                          className="text-xs font-medium text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
                        >
                          {rule.active ? "Stop" : "Restart"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Both fields the same shape, on a grid, with the action on its own
              row — the old side-by-side row staggered because only one of them
              carried a hint. */}
          <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            {/* Direction first, because it changes what every other field in
                this form means — and because getting it wrong bills somebody
                instead of paying them. Two buttons rather than a checkbox
                labelled "payback": a checkbox has an unlabelled state, and the
                unlabelled state here is "money leaves the club". */}
            <div className="flex flex-wrap gap-2">
              {[
                { value: false, label: "Charge members" },
                { value: true, label: "Pay a member" },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setPayback(option.value)}
                  aria-pressed={payback === option.value}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    payback === option.value
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              {payback
                ? "A monthly payback credits one member's statement, starting this month — the club paying somebody to run the website, mow the tiedown or keep the books. Stopping it later leaves the months it already paid alone."
                : "A monthly charge bills every member, starting this month — or one member, if you name them below."}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={payback ? "Website upkeep" : "Monthly membership"}
              />
              <MoneyInput
                label={payback ? "Paid per month" : "Amount per month"}
                value={amount}
                onChange={setAmount}
                placeholder={payback ? "50.00" : "250.00"}
                hint={
                  payback
                    ? "Enter it as a positive amount — the direction is the toggle above."
                    : undefined
                }
              />
            </div>

            {/* "Every member" is not offered for a payback: it would credit the
                whole club every month, which is far likelier to be a forgotten
                name than a rebate the club voted for. The server refuses it
                too — this select just never lets you get there. */}
            <Select
              label={payback ? "Paid to" : "Billed to"}
              value={ruleMemberId}
              onChange={(e) => setRuleMemberId(e.target.value)}
            >
              {payback ? (
                <option value="">Choose a member…</option>
              ) : (
                <option value="">Every member</option>
              )}
              {(roster ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={addRule}
                disabled={
                  busy ||
                  !label.trim() ||
                  amount === "" ||
                  (payback && !ruleMemberId)
                }
              >
                {payback ? "Add payback" : "Add"}
              </Button>
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
