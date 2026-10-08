"use client";
// Finances — what you owe the club, every month of it, newest first.
//
// The page used to be one month at a time, behind a month picker. That made
// the question a member actually has — "do I owe anything?" — a question about
// every month at once that could only be asked one month at a time, and an
// unpaid March was invisible to anyone who didn't think to open March. It is
// now one long statement: a running balance at the top, the months below it
// under sticky headers, older ones loading as you scroll.
//
// Three views, and the server enforces which of them you can have:
//
//   Mine               every member — your own lines, with a running balance
//                      down the side. The privacy rule is the API's, not a
//                      hidden button's.
//   Club (by person)   Finance Officer / admin — each month, member by member,
//                      with "Add charge or credit" on the month it lands in.
//   Club (by month)    the same lines as one list per month, across members,
//                      opening on just what's OUTSTANDING: the officer's
//                      to-chase list. Settled lines are a toggle away.
//
// The two club views read the same data, so flipping between them is free;
// only crossing between Mine and Club goes back to the server.
//
// A statement is charges minus credits: dues and flight time on one side, the
// fuel a member bought out of their own pocket on the other. Nothing here is
// typed in twice — flight lines come from the flight log and dues from a
// standing rule, so the books can't disagree with the log.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmModal, { type ConfirmTone } from "@/components/common/ConfirmModal";
import ExportButton from "@/components/common/ExportButton";
import OfficerOnly from "@/components/common/OfficerOnly";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import Toggle from "@/components/common/Toggle";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, fetchJsonObject, sendJson } from "@/lib/api";
import { getAppScroller } from "@/lib/appScroll";
import { formatDay } from "@/lib/dates";
import { financesWorkbook } from "@/lib/exports";
import { xlsxFilename } from "@/lib/xlsx";
import {
  CHARGE_KIND_LABELS,
  clubPosition,
  currentPeriod,
  formatMoney,
  formatPeriod,
  isPayback,
  outstandingContribution,
  paidContribution,
  parseDollars,
  periodEnd,
  runningBalances,
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
};

type View = "mine" | "person" | "month";

const VIEW_LABELS: Record<View, string> = {
  mine: "Mine",
  person: "Club (by person)",
  month: "Club (by month)",
};

/** How many months one scroll-triggered fetch brings in. */
const PAGE_MONTHS = 3;

/** Every line change on this page goes through a confirmation first. */
type LineAction = "paid" | "unpaid" | "void" | "restore" | "delete";

interface Ledger {
  /** Which scope these months were read for — Mine, or the whole club. */
  club: boolean;
  months: ApiLedgerMonth[];
  nextBefore: Period | null;
  /** Outstanding per member across EVERY month, loaded or not. */
  members: { member: ApiUserSummary; outstandingCents: number }[];
  /** The club's own lines (no member), outstanding across every month. */
  clubCents: number;
  /** Every paid line, netted, across every month — the club's worth. */
  paidCents: number;
}

/**
 * Stands in for the member on a club-level line wherever a name is drawn — the
 * by-person card, the Member column, the export. Never sent to the server.
 */
const CLUB_ACCOUNT: ApiUserSummary = { id: "__club", name: "Club", email: null };

/** Whose line this is, for display: a member, or the club's own books. */
function ownerOf(charge: ApiCharge): ApiUserSummary {
  return charge.member ?? CLUB_ACCOUNT;
}

export default function FinancesPage() {
  const { me } = useMe();
  const { aircraft: fleet, selected } = useAircraft();
  const canManage = me?.capabilities.includes("finance:manage") ?? false;
  const canReadAll = me?.capabilities.includes("finance:read-all") ?? false;

  const [view, setView] = useState<View>("mine");
  const club = view !== "mine" && canReadAll;

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped by every fresh load, so a page that arrives after the view has
  // moved on (or after a reload) is dropped rather than appended to the wrong
  // list.
  const generation = useRef(0);
  const loadingMoreRef = useRef(false);

  // The by-month view opens on what's owed; settled lines are opt-in.
  const [showSettled, setShowSettled] = useState(false);

  const [addFor, setAddFor] = useState<Period | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pending, setPending] = useState<{ action: LineAction; charge: ApiCharge } | null>(
    null
  );
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

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
        `/api/finances/ledger?months=${count}${club ? "&all=1" : ""}`
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
        clubCents: page.summary?.clubOutstandingCents ?? 0,
        paidCents: page.summary?.paidCents ?? 0,
      });
    },
    [club]
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
      }`
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

  const current = ledger && ledger.club === club ? ledger : null;

  useEffect(() => {
    if (sentinelVisible && current?.nextBefore && !loadingMore) loadMore();
  }, [sentinelVisible, current, loadingMore, loadMore]);

  /**
   * Fold one line's change into what's loaded, without a round trip.
   *
   * The months on screen take the server's copy of the line; the all-months
   * summary — which covers months that AREN'T loaded, so it can't simply be
   * re-added — takes the DIFFERENCE the change makes to what's outstanding.
   */
  function applyChange(before: ApiCharge, after: ApiCharge | null) {
    const delta =
      (after ? outstandingContribution(after) : 0) - outstandingContribution(before);
    const paidDelta = (after ? paidContribution(after) : 0) - paidContribution(before);
    setLedger((l) => {
      if (!l) return l;
      l = { ...l, paidCents: l.paidCents + paidDelta };
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
      if (!owner) return { ...l, months, clubCents: l.clubCents + delta };
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

  async function confirmPending() {
    if (!pending) return;
    const { action, charge } = pending;
    setPendingError(null);
    setPendingBusy(true);
    const url = `/api/finances/charges/${charge.id}`;
    const result =
      action === "delete"
        ? await sendJson<unknown>(url, "DELETE")
        : await sendJson<ApiCharge>(
            url,
            "PATCH",
            action === "paid" || action === "unpaid"
              ? { paid: action === "paid" }
              : { voided: action === "void" }
          );
    setPendingBusy(false);
    if (!result.ok) {
      // Shown IN the dialog: "void it instead" is exactly what an officer
      // trying to delete a derived line needs to read, and it belongs next to
      // the button they just pressed.
      setPendingError(result.error ?? "Could not change that line.");
      return;
    }
    applyChange(charge, action === "delete" ? null : (result.data as ApiCharge));
    setPending(null);
  }

  function ask(action: LineAction, charge: ApiCharge) {
    setPendingError(null);
    setPending({ action, charge });
  }

  const outstandingNow = useMemo(
    () => (current ? current.members.reduce((sum, m) => sum + m.outstandingCents, 0) : 0),
    [current]
  );

  // The running balance beside each of YOUR lines — Mine only. Built down
  // from what's owed now across the whole flattened list, newest first, so it
  // stays exact however many months are loaded.
  const running = useMemo(() => {
    if (!current || current.club) return new Map<string, number>();
    const lines = current.months.flatMap((m) => m.charges);
    const after = runningBalances(lines, outstandingNow);
    return new Map(lines.map((c, i) => [c.id, after[i]]));
  }, [current, outstandingNow]);

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
  const loadedFrom = months.length ? months[months.length - 1].period : null;
  const loadedTo = months.length ? months[0].period : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Finances</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {club ? "The club's books, every month" : "Your statement, every month"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Exports the months LOADED, in the scope the API actually
              returned (`current.club`, not the switch) — the privacy rule is
              the server's, and an export must not be the one place that reads
              it differently. */}
          {current && loadedFrom && loadedTo && (
            <ExportButton
              filename={xlsxFilename([
                "finances",
                loadedFrom === loadedTo ? loadedTo : `${loadedFrom}-to-${loadedTo}`,
                current.club ? "club" : "mine",
              ])}
              disabled={months.every((m) => m.charges.length === 0)}
              build={() =>
                financesWorkbook({
                  period: { from: loadedFrom, to: loadedTo },
                  statements: statementsFor(
                    months.flatMap((m) => m.charges),
                    loadedTo
                  ),
                  clubWide: current.club,
                })
              }
            />
          )}

          {canReadAll && (
            <div
              role="group"
              aria-label="Whose books"
              className="flex flex-wrap rounded-lg border border-gray-200 p-0.5 dark:border-gray-700"
            >
              {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${
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
        </div>
      </header>

      {loadError && <ErrorLine message={loadError} />}

      {canManage && (
        <OfficerOnly office="Finance Officer">
          {/* Centred, and the two buttons share one width: they are the
              reason this card exists, so they shouldn't be squeezed into the
              tail of a sentence. Named for WHAT each one writes — one line on a
              statement, versus the standing rule that bills every month. */}
          <div className="flex flex-col items-center gap-3 py-1 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Add charges and credits, set the club&apos;s dues and hourly rate.
            </p>
            <div className="grid w-full max-w-xs grid-cols-2 gap-3">
              <Button onClick={() => setAddFor(currentPeriod())}>One Off</Button>
              <Button variant="secondary" onClick={() => setRulesOpen(true)}>
                Recurring
              </Button>
            </div>
          </div>
        </OfficerOnly>
      )}

      {!current ? (
        <div className="flex justify-center py-10">
          <LoadingDots />
        </div>
      ) : (
        <>
          <BalanceSummary
            club={current.club}
            members={current.members}
            clubCents={current.clubCents}
            paidCents={current.paidCents}
            outstandingCents={outstandingNow}
          />

          {view === "month" && current.club && (
            <div className="flex justify-end">
              <Toggle
                label="Show settled lines"
                checked={showSettled}
                onChange={setShowSettled}
                offLabel="Outstanding"
                onLabel="Everything"
              />
            </div>
          )}

          <MonthList
            view={current.club ? view : "mine"}
            months={months}
            running={running}
            showSettled={showSettled}
            canManage={canManage}
            onAction={ask}
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

      {pending && (
        <LineActionModal
          action={pending.action}
          charge={pending.charge}
          busy={pendingBusy}
          error={pendingError}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {addFor && (
        <AddChargeModal
          period={addFor}
          onClose={() => setAddFor(null)}
          onSaved={async () => {
            setAddFor(null);
            await reload(Math.max(PAGE_MONTHS, months.length));
          }}
        />
      )}

      {rulesOpen && (
        <RulesModal
          fleet={fleet ?? []}
          initialAircraftId={selected?.id ?? null}
          onClose={() => setRulesOpen(false)}
          onChanged={() => reload(Math.max(PAGE_MONTHS, months.length))}
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

/**
 * Lines → one statement per member, for the export and the by-person view.
 * The club's own lines are gathered under `CLUB_ACCOUNT` and put FIRST: they
 * are the one block that isn't somebody, so they shouldn't sort in among names.
 */
function statementsFor(charges: ApiCharge[], period: Period): ApiStatement[] {
  const byMember = new Map<string, ApiCharge[]>();
  for (const charge of charges) {
    const key = ownerOf(charge).id;
    const list = byMember.get(key) ?? [];
    list.push(charge);
    byMember.set(key, list);
  }
  return [...byMember.values()]
    .map((lines) => ({
      member: ownerOf(lines[0]),
      period,
      charges: lines,
      ...totals(lines),
    }))
    .sort((a, b) =>
      a.member === CLUB_ACCOUNT
        ? -1
        : b.member === CLUB_ACCOUNT
          ? 1
          : a.member.name.localeCompare(b.member.name)
    );
}

/**
 * The bottom line, across every month — the figure the page is for.
 *
 * Mine: what you owe right now. Club: what members owe the club and what the
 * club owes members, kept apart (see `clubPosition`); the club's own lines,
 * which are nobody's; and the CLUB BALANCE — what the club is WORTH, i.e.
 * every line that has actually been paid — with what's still unsettled beside
 * it in brackets. Each member's own balance sits beneath for anyone wondering
 * who.
 */
function BalanceSummary({
  club,
  members,
  clubCents,
  paidCents,
  outstandingCents,
}: {
  club: boolean;
  members: { member: ApiUserSummary; outstandingCents: number }[];
  clubCents: number;
  paidCents: number;
  outstandingCents: number;
}) {
  if (!club) {
    return (
      <Card className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Your balance</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Across every month · paid and voided lines don&apos;t count
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {outstandingCents > 0
              ? "You owe"
              : outstandingCents < 0
                ? "Owed to you"
                : "All settled"}
          </span>
          <span
            className={`tabular text-2xl font-bold ${
              outstandingCents < 0 ? "text-green-600 dark:text-green-400" : ""
            }`}
          >
            {formatMoney(Math.abs(outstandingCents))}
          </span>
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

  // The balance is money that has MOVED: a paid charge adds, a paid credit or
  // club bill subtracts, and an unpaid line changes nothing until it's met.
  // What's still unsettled is the bracketed figure beside it — positive =
  // money the club is still missing, negative = money it still owes out.
  const unsettled = owedToClubCents - owedByClubCents + clubCents;

  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Members owe the club" cents={owedToClubCents} />
        <Figure label="The club owes members" cents={owedByClubCents} green={owedByClubCents > 0} />
        <Figure
          label="Club-level lines"
          cents={clubCents}
          hint={clubCents < 0 ? "the club owes" : clubCents > 0 ? "owed to the club" : "none open"}
        />
        <Figure
          label="Club balance"
          cents={paidCents}
          aside={
            unsettled > 0
              ? `missing ${formatMoney(unsettled)}`
              : unsettled < 0
                ? `owes ${formatMoney(-unsettled)}`
                : undefined
          }
          hint="paid lines only"
          strong
        />
      </div>
      {owing.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {owing.map(({ member, outstandingCents }) => (
            <li
              key={member.id}
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs dark:bg-gray-700/60"
            >
              {member.name}{" "}
              <span
                className={`tabular font-semibold ${
                  outstandingCents < 0 ? "text-green-600 dark:text-green-400" : ""
                }`}
              >
                {outstandingCents < 0
                  ? `owed ${formatMoney(-outstandingCents)}`
                  : formatMoney(outstandingCents)}
              </span>
            </li>
          ))}
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
      <p
        className={`tabular text-xl font-bold ${
          green ? "text-green-600 dark:text-green-400" : ""
        }`}
      >
        <span>{formatMoney(cents)}</span>
        {aside && (
          <span className="ml-1.5 whitespace-nowrap text-xs font-medium text-amber-700 dark:text-amber-400">
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
  running,
  showSettled,
  canManage,
  onAction,
  onAdd,
  finished,
}: {
  view: View;
  months: ApiLedgerMonth[];
  running: Map<string, number>;
  showSettled: boolean;
  canManage: boolean;
  onAction: (action: LineAction, charge: ApiCharge) => void;
  onAdd: (period: Period) => void;
  finished: boolean;
}) {
  if (view === "month") {
    // The to-chase list: months with nothing left to settle are skipped rather
    // than headed "nothing outstanding" one after another down the page.
    const shown = months
      .map((m) => ({
        ...m,
        lines: showSettled
          ? m.charges
          : m.charges.filter((c) => outstandingContribution(c) !== 0),
      }))
      .filter((m) => m.lines.length > 0);
    if (shown.length === 0 && finished) {
      return (
        <Card>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {showSettled ? "No charges yet." : "Nothing outstanding — every line is settled."}
          </p>
        </Card>
      );
    }
    return (
      <>
        {shown.map((m) => (
          <section key={m.period} aria-label={formatPeriod(m.period)}>
            <MonthHeader
              period={m.period}
              figure={sumOutstanding(m.charges)}
              figureLabel="outstanding"
            />
            <Card>
              <ChargeTable
                caption={`Charges for ${formatPeriod(m.period)}`}
                charges={m.lines}
                showMember
                canManage={canManage}
                onAction={onAction}
              />
            </Card>
          </section>
        ))}
      </>
    );
  }

  return (
    <>
      {months.map((m) => (
        <section key={m.period} aria-label={formatPeriod(m.period)} className="space-y-3">
          <MonthHeader
            period={m.period}
            figure={sumOutstanding(m.charges)}
            figureLabel="outstanding"
            action={
              view === "person" && canManage ? (
                <Button size="sm" variant="secondary" onClick={() => onAdd(m.period)}>
                  + Charge or credit
                </Button>
              ) : null
            }
          />
          {m.charges.length === 0 ? (
            <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
              Nothing on the books this month.
            </p>
          ) : view === "person" ? (
            statementsFor(m.charges, m.period).map((statement) => (
              <Card key={statement.member.id} className="space-y-3">
                <h3 className="text-sm font-semibold">
                  {statement.member === CLUB_ACCOUNT
                    ? "Club (no member)"
                    : statement.member.name}
                </h3>
                <ChargeTable
                  caption={`${statement.member.name}'s charges for ${formatPeriod(m.period)}`}
                  charges={statement.charges}
                  canManage={canManage}
                  onAction={onAction}
                  balanceCents={statement.balanceCents}
                />
              </Card>
            ))
          ) : (
            <Card>
              <ChargeTable
                caption={`Your charges for ${formatPeriod(m.period)}`}
                charges={m.charges}
                running={running}
                canManage={canManage}
                onAction={onAction}
              />
            </Card>
          )}
        </section>
      ))}
    </>
  );
}

function sumOutstanding(charges: ApiCharge[]): number {
  return charges.reduce((sum, c) => sum + outstandingContribution(c), 0);
}

function MonthHeader({
  period,
  figure,
  figureLabel,
  action,
}: {
  period: Period;
  figure: number;
  figureLabel: string;
  action?: ReactNode;
}) {
  return (
    // `top-0` of the app's scroller, not the window: the top bar lives
    // outside the scroller, so the header parks directly under it. Bleeds to
    // the column's edges (-mx-4 px-4) with the page's own ground behind it,
    // so rows slide UNDER it rather than through it.
    <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center justify-between gap-3 bg-gray-50/95 px-4 py-2 backdrop-blur dark:bg-gray-900/95">
      <h2 className="text-base font-semibold">{formatPeriod(period)}</h2>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          <span
            className={`tabular font-semibold ${
              figure < 0
                ? "text-green-600 dark:text-green-400"
                : figure > 0
                  ? "text-gray-900 dark:text-gray-100"
                  : ""
            }`}
          >
            {formatMoney(figure)}
          </span>{" "}
          {figureLabel}
        </span>
        {action}
      </div>
    </div>
  );
}

/**
 * The lines of a statement, as a real table: dates under dates and amounts
 * under amounts, which is what makes a column of money scannable. It scrolls
 * inside its own box rather than widening the page on a phone.
 */
function ChargeTable({
  caption,
  charges,
  showMember = false,
  running,
  balanceCents,
  canManage,
  onAction,
}: {
  caption: string;
  charges: ApiCharge[];
  /** The by-month view's lines come from every member, so name them. */
  showMember?: boolean;
  /** Mine: the running balance beside each line. */
  running?: Map<string, number>;
  /** By person: the month's total, at the foot of the column it sums. */
  balanceCents?: number;
  canManage: boolean;
  onAction: (action: LineAction, charge: ApiCharge) => void;
}) {
  const leading = 3 + (showMember ? 1 : 0);
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th scope="col" className="py-1.5 pl-1 pr-3 text-left font-medium">
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
            <th scope="col" className="py-1.5 pr-1 text-right font-medium">
              Amount
            </th>
            {running && (
              <th scope="col" className="py-1.5 pl-3 pr-1 text-right font-medium">
                Balance
              </th>
            )}
            {canManage && (
              <th scope="col" className="py-1.5 pl-3 pr-1 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {charges.map((charge) => {
            // Voided and paid both quieten the row, and they are NOT the same
            // claim: voided is struck through (it should never have stood),
            // paid keeps its amount with a tick to say it's settled.
            const voided = charge.voided;
            const paid = Boolean(charge.paidAt);
            const after = running?.get(charge.id);
            return (
              <tr key={charge.id} className={paid && !voided ? "bg-green-50/40 dark:bg-green-900/10" : ""}>
                <td className="whitespace-nowrap py-2 pl-1 pr-3 text-gray-500 dark:text-gray-400">
                  {formatDay(new Date(charge.incurredOn))}
                </td>
                {showMember && (
                  <td className="whitespace-nowrap py-2 pr-3">
                    {charge.member ? (
                      charge.member.name
                    ) : (
                      <span className="italic text-gray-500 dark:text-gray-400">Club</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-3">
                  <Badge tone={KIND_TONES[charge.kind]}>
                    {CHARGE_KIND_LABELS[charge.kind]}
                  </Badge>
                </td>
                <td
                  className={`py-2 pr-3 ${
                    voided ? "text-gray-400 line-through dark:text-gray-500" : ""
                  }`}
                >
                  {charge.description}
                  {voided && (
                    <span className="ml-2 align-middle text-xs uppercase tracking-wide text-gray-400 no-underline">
                      voided
                    </span>
                  )}
                  {paid && !voided && (
                    <span
                      className="ml-2 align-middle text-xs font-medium text-green-700 dark:text-green-400"
                      title={
                        charge.paidBy ? `Marked paid by ${charge.paidBy.name}` : undefined
                      }
                    >
                      ✓ paid
                      {charge.paidAt ? ` ${formatDay(new Date(charge.paidAt))}` : ""}
                    </span>
                  )}
                </td>
                <td
                  className={`tabular whitespace-nowrap py-2 pr-1 text-right font-medium ${
                    voided
                      ? "text-gray-400 line-through dark:text-gray-500"
                      : paid
                        ? "text-gray-500 dark:text-gray-400"
                        : charge.amountCents < 0
                          ? "text-green-600 dark:text-green-400"
                          : ""
                  }`}
                >
                  {formatMoney(charge.amountCents)}
                </td>
                {running && (
                  <td
                    className={`tabular whitespace-nowrap py-2 pl-3 pr-1 text-right text-gray-500 dark:text-gray-400 ${
                      after !== undefined && after < 0 ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {after !== undefined ? formatMoney(after) : ""}
                  </td>
                )}
                {canManage && (
                  <td className="py-1.5 pl-3 pr-1">
                    <LineActions charge={charge} onAction={onAction} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>

        {balanceCents !== undefined && (
          // One highlighted total, sitting under the column it's the sum of.
          // Negative = the club owes the member, so it reads green.
          <tfoot className="border-t-2 border-gray-300 dark:border-gray-600">
            <tr>
              <th
                scope="row"
                colSpan={leading}
                className="py-2 pl-1 pr-3 text-right text-sm font-semibold"
              >
                {balanceCents < 0 ? "Owed to them" : "Balance"}
              </th>
              <td
                className={`tabular whitespace-nowrap py-2 pr-1 text-right text-lg font-bold ${
                  balanceCents < 0 ? "text-green-600 dark:text-green-400" : ""
                }`}
              >
                {formatMoney(Math.abs(balanceCents))}
              </td>
              {canManage && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Paid · Void · 🗑 — every one of them confirms first (`LineActionModal`).
 *
 * Paid is green because settling is the everyday action and the good news.
 * Void is grey: it unwinds a line but keeps the trail. Delete is a trash can,
 * and only on hand-entered lines — the API refuses it for anything derived
 * from a flight or a standing rule, so offering it there was a button whose
 * only possible outcome was an error.
 */
function LineActions({
  charge,
  onAction,
}: {
  charge: ApiCharge;
  onAction: (action: LineAction, charge: ApiCharge) => void;
}) {
  const paid = Boolean(charge.paidAt);
  const deletable = charge.kind === "ONE_OFF";
  return (
    <div className="flex items-center justify-end gap-1.5">
      {!charge.voided &&
        (paid ? (
          <Button size="sm" variant="ghost" onClick={() => onAction("unpaid", charge)}>
            Unpay
          </Button>
        ) : (
          <Button size="sm" variant="success" onClick={() => onAction("paid", charge)}>
            Paid
          </Button>
        ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction(charge.voided ? "restore" : "void", charge)}
      >
        {charge.voided ? "Restore" : "Void"}
      </Button>
      {deletable ? (
        <button
          type="button"
          onClick={() => onAction("delete", charge)}
          aria-label="Delete"
          title="Delete"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
        >
          <TrashIcon />
        </button>
      ) : (
        // Holds the column's width so Paid/Void line up down the table.
        <span className="w-7" aria-hidden />
      )}
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

/** What each line action says before it happens. */
const ACTION_COPY: Record<
  LineAction,
  { title: string; confirm: string; tone: ConfirmTone }
> = {
  paid: { title: "Mark this line paid?", confirm: "Mark paid", tone: "success" },
  unpaid: { title: "Mark this line unpaid?", confirm: "Mark unpaid", tone: "primary" },
  void: { title: "Void this line?", confirm: "Void", tone: "secondary" },
  restore: { title: "Restore this line?", confirm: "Restore", tone: "primary" },
  delete: { title: "Delete this line?", confirm: "Delete", tone: "danger" },
};

function LineActionModal({
  action,
  charge,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  action: LineAction;
  charge: ApiCharge;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const copy = ACTION_COPY[action];
  const member = charge.member;
  const amount = formatMoney(charge.amountCents);
  const magnitude = formatMoney(Math.abs(charge.amountCents));
  // Where the line lives, for the sentences below: a member's statement, or —
  // for a club-level line — the club's own books.
  const where = member ? `${member.name}’s statement` : "the club’s books";

  let settled: string;
  if (!member) {
    settled =
      charge.amountCents < 0
        ? `Records that the club has paid this ${magnitude}.`
        : `Records that the club has received this ${magnitude}.`;
  } else {
    settled =
      charge.amountCents < 0
        ? `Records that the club has paid ${member.name} back ${magnitude}.`
        : `Records that ${member.name} has paid ${amount}.`;
  }

  return (
    <ConfirmModal
      open
      title={copy.title}
      subtitle={`${member?.name ?? "Club"} · ${charge.description} · ${amount}`}
      confirmLabel={copy.confirm}
      tone={copy.tone}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {action === "paid" && (
        <p>
          {settled} It comes off what&rsquo;s outstanding; the month&rsquo;s
          total stays as it was. You can undo it.
        </p>
      )}
      {action === "unpaid" && (
        <p>
          Puts {magnitude} back into what&rsquo;s outstanding on {where} — for a
          line ticked off by mistake.
        </p>
      )}
      {action === "void" && (
        <p>
          The line stays on {where}, struck through, and stops counting toward
          anything. Use this for a charge that should never have stood. You can
          restore it.
        </p>
      )}
      {action === "restore" && (
        <p>The line counts again, on {where} and in the club&rsquo;s totals.</p>
      )}
      {action === "delete" && (
        <>
          <p>
            It disappears from {where} and from the club&rsquo;s totals, with no
            record that it was ever there. To unwind a charge and keep the
            trail, <strong>void</strong> it instead.
          </p>
          <p className="text-gray-500 dark:text-gray-400">This can&rsquo;t be undone.</p>
        </>
      )}
    </ConfirmModal>
  );
}

/**
 * Bill a member, or credit one.
 *
 * Both are the same ledger row with an opposite sign, but asking an officer to
 * type a negative number is a trap: the minus sign is invisible in a summary
 * and easy to forget, and getting it backwards moves money the wrong way twice
 * over. So the direction is an explicit choice, the amount is always typed as a
 * positive number, and the sentence above the button says in words what is
 * about to be recorded.
 */
function AddChargeModal({
  period,
  onClose,
  onSaved,
}: {
  /** The month the line lands on — the one whose header the button was on. */
  period: Period;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<ApiMember[] | null>(null);
  const [memberId, setMemberId] = useState("");
  const [direction, setDirection] = useState<"charge" | "credit">("charge");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // The day within that month. Today for the current month; the month's LAST
  // day for an earlier one, which is when a charge added after the fact was
  // settled up, and which keeps it inside the month whatever the officer
  // meant. The box is bounded to the month, because the statement a line
  // lands on follows its date.
  const monthFirst = `${period}-01`;
  const monthLast = dayKey(new Date(periodEnd(period).getTime() - 1));
  const [day, setDay] = useState(() =>
    period === currentPeriod() ? dayKey(new Date()) : monthLast
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJsonArray<ApiMember>("/api/members").then((rows) => {
      setMembers(rows);
      setMemberId((current) => current || (rows[0]?.id ?? ""));
    });
  }, []);

  const crediting = direction === "credit";
  // The club's own books, rather than anybody's statement — see the Charge
  // model. Picked from the same list as a member, at its head, because "who
  // is this line against" is one question whichever the answer is.
  const forClub = memberId === CLUB_OPTION;
  const cents = parseDollars(amount);
  const member = (members ?? []).find((m) => m.id === memberId);
  // Preview the exact line that will land on the statement.
  const preview =
    cents === null || cents <= 0
      ? null
      : forClub
        ? crediting
          ? `The club's books will show ${formatMoney(cents)} the club owes.`
          : `The club's books will show ${formatMoney(cents)} owed to the club.`
        : member
          ? crediting
            ? `${member.name} will be credited ${formatMoney(cents)}.`
            : `${member.name} will be charged ${formatMoney(cents)}.`
          : null;

  async function submit() {
    setError(null);
    if (cents === null || cents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (day < monthFirst || day > monthLast) {
      setError(`Pick a day in ${formatPeriod(period)}.`);
      return;
    }
    setBusy(true);
    const result = await sendJson("/api/finances/charges", "POST", {
      ...(forClub ? { club: true } : { memberId }),
      description,
      // Local NOON, not a bare date: "2026-08-01" parses as UTC midnight,
      // which is still July in the club's timezone and would put the line on
      // the wrong month's statement.
      incurredOn: `${day}T12:00:00`,
      // The toggle owns the sign; the field is always a positive number.
      amountDollars: (crediting ? -cents : cents) / 100,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        forClub
          ? "A line on the club's books"
          : crediting
            ? "Credit a member"
            : "Charge a member"
      }
      subtitle={formatPeriod(period)}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <DirectionButton
            active={!crediting}
            onClick={() => setDirection("charge")}
            title="Charge"
            blurb={forClub ? "Owed to the club" : "They owe the club"}
          />
          <DirectionButton
            active={crediting}
            onClick={() => setDirection("credit")}
            title="Credit"
            blurb={forClub ? "The club owes it" : "The club owes them"}
          />
        </div>

        <Select
          label="Member"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        >
          <option value={CLUB_OPTION}>The club itself — no member</option>
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Input
          label="What for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            forClub
              ? crediting
                ? "Hangar insurance"
                : "Grant — county airport fund"
              : crediting
                ? "Refund — fuel receipt"
                : "Checkout fee"
          }
        />

        <Input
          label="Amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="dollars"
        />

        <Input
          label="Date"
          type="date"
          min={monthFirst}
          max={monthLast}
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />

        {preview && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              crediting
                ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                : "bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200"
            }`}
          >
            {preview}
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button onClick={submit} disabled={busy || !memberId}>
            {busy ? (
              <LoadingDots size="sm" />
            ) : crediting ? (
              "Add credit"
            ) : (
              "Add charge"
            )}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The member picker's value for "the club itself". Never sent as an id. */
const CLUB_OPTION = "__club";

/** "YYYY-MM-DD" in local time — what a date input holds. */
function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** One half of the charge/credit switch. */
function DirectionButton({
  active,
  onClick,
  title,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/30"
          : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
      }`}
    >
      <span
        className={`block text-sm font-semibold ${
          active ? "text-indigo-700 dark:text-indigo-200" : ""
        }`}
      >
        {title}
      </span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">{blurb}</span>
    </button>
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
          <Input
            label={
              tailNumber ? `Dollars per tach hour — ${tailNumber}` : "Dollars per tach hour"
            }
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
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
              <Input
                label={payback ? "Paid per month" : "Amount per month"}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
