"use client";
// The Finances page's Export, with a say in what goes in the file.
//
// It used to export exactly the months scrolled to so far — which made the
// file depend on how far down the page you happened to be. Now it asks:
//
//   When    all time (the default), this month, the last 3 or 12, or a range
//   What    which kinds of line — dues, flight time, credits… (all, by default)
//   Who     the Finance Officer's club export only: everyone (the default),
//           or a few people, the club's own money among them
//
// and then READS those months from the server rather than reusing what's on
// screen, so the file is the same whoever exports it and however far they'd
// scrolled. The privacy rule stays the server's: a member's export asks for
// their own ledger, and only a club-wide reader's can ask for `all=1`.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { downloadWorkbook } from "@/components/common/ExportButton";
import { fetchJsonArray, fetchJsonObject } from "@/lib/api";
import { financesWorkbook } from "@/lib/exports";
import {
  CHARGE_KIND_LABELS,
  currentPeriod,
  shiftPeriod,
  type ChargeKind,
  type Period,
} from "@/lib/finance";
import {
  CLUB_ACCOUNT,
  exportPeriods,
  monthsSpanned,
  selectLines,
  statementsFor,
  type ExportRange,
} from "@/lib/ledgerView";
import type { ApiCharge, ApiLedgerPage, ApiMember } from "@/lib/types";
import { xlsxFilename } from "@/lib/xlsx";

const RANGE_LABELS: Record<ExportRange, string> = {
  all: "All time",
  "this-month": "This month",
  "last-3": "Last 3 months",
  "last-12": "Last 12 months",
  custom: "Choose months…",
};

const KINDS = Object.keys(CHARGE_KIND_LABELS) as ChargeKind[];

/** The ledger API's cap on months per read — see app/api/finances/ledger. */
const MAX_MONTHS_PER_READ = 120;

export default function ExportFinancesModal({
  club,
  onClose,
}: {
  /** Export the whole club (officer) rather than the reader's own lines. */
  club: boolean;
  onClose: () => void;
}) {
  const thisMonth = currentPeriod();
  const [range, setRange] = useState<ExportRange>("all");
  const [from, setFrom] = useState<Period>(shiftPeriod(thisMonth, -2));
  const [to, setTo] = useState<Period>(thisMonth);
  const [kinds, setKinds] = useState<Set<ChargeKind>>(new Set(KINDS));
  const [everyone, setEveryone] = useState(true);
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<ApiMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!club) return;
    fetchJsonArray<ApiMember>("/api/members").then((rows) =>
      setRoster([...rows].sort((a, b) => a.name.localeCompare(b.name)))
    );
  }, [club]);

  function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  /** Every line in the chosen months, newest month first; null if a read failed. */
  async function readMonths(): Promise<{ period: Period; charges: ApiCharge[] }[] | null> {
    const span = exportPeriods(range, range === "custom" ? { from, to } : null);
    const scope = club ? "&all=1" : "";

    if (span) {
      // A range is ONE read: `before` is the month after it ends, `months` its
      // length. (Capped at the ledger's 120 per read — ten years.)
      const before = shiftPeriod(span.to, 1);
      const count = Math.min(monthsSpanned(span.from, span.to), MAX_MONTHS_PER_READ);
      const page = await fetchJsonObject<ApiLedgerPage>(
        `/api/finances/ledger?months=${count}&before=${before}${scope}`
      );
      return page ? page.months : null;
    }

    // All time: from the newest month, follow the ledger's cursor back until
    // it says the books start.
    const months: { period: Period; charges: ApiCharge[] }[] = [];
    let before: string | null = null;
    do {
      const cursor: string = before ? `&before=${before}` : "";
      const page: ApiLedgerPage | null = await fetchJsonObject<ApiLedgerPage>(
        `/api/finances/ledger?months=${MAX_MONTHS_PER_READ}${scope}${cursor}`
      );
      if (!page) return null;
      months.push(...page.months);
      before = page.nextBefore;
    } while (before);
    return months;
  }

  async function exportFile() {
    setError(null);
    if (kinds.size === 0) {
      setError("Pick at least one kind of line.");
      return;
    }
    if (club && !everyone && people.size === 0) {
      setError("Pick at least one person.");
      return;
    }
    setBusy(true);
    const months = await readMonths();
    setBusy(false);
    if (!months) {
      setError("Couldn't read the books. Check your connection and try again.");
      return;
    }

    const lines = selectLines(
      months.flatMap((m) => m.charges),
      kinds.size === KINDS.length ? null : kinds,
      club && !everyone ? people : null
    );
    if (lines.length === 0) {
      setError("Nothing matches — widen the range or the kinds of line.");
      return;
    }

    // Label the file by the months actually read.
    const newest = months[0].period;
    const oldest = months[months.length - 1].period;
    const sheets = financesWorkbook({
      period: { from: oldest, to: newest },
      statements: statementsFor(lines, newest),
      clubWide: club,
    });
    const filename = xlsxFilename([
      "finances",
      oldest === newest ? newest : `${oldest}-to-${newest}`,
      club ? "club" : "mine",
    ]);
    if (!downloadWorkbook(filename, sheets)) {
      setError("Couldn't build the export.");
      return;
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Export"
      subtitle={club ? "The club's books, as a spreadsheet" : "Your statement, as a spreadsheet"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={exportFile} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Download .xlsx"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Select
            label="Months"
            value={range}
            onChange={(e) => setRange(e.target.value as ExportRange)}
          >
            {(Object.keys(RANGE_LABELS) as ExportRange[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </Select>
          {range === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <MonthField label="From" value={from} max={thisMonth} onChange={setFrom} />
              <MonthField label="To" value={to} max={thisMonth} onChange={setTo} />
            </div>
          )}
        </div>

        <fieldset className="space-y-2">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">Kinds of line</legend>
            <button
              type="button"
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() =>
                setKinds(kinds.size === KINDS.length ? new Set() : new Set(KINDS))
              }
            >
              {kinds.size === KINDS.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={kinds.has(kind)}
                  onChange={(e) => setKinds(toggle(kinds, kind, e.target.checked))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
                />
                {CHARGE_KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>

        {club && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">People</legend>
            <div className="flex gap-2">
              {[
                { value: true, label: "Everyone" },
                { value: false, label: "Choose people" },
              ].map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => setEveryone(o.value)}
                  aria-pressed={everyone === o.value}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    everyone === o.value
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!everyone && (
              <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                {/* The club's own money is a "who" too — it belongs to nobody. */}
                {[CLUB_ACCOUNT, ...(roster ?? [])].map((person) => (
                  <li key={person.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={people.has(person.id)}
                        onChange={(e) => setPeople(toggle(people, person.id, e.target.checked))}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
                      />
                      {person === CLUB_ACCOUNT ? "Club (no member)" : person.name}
                    </label>
                  </li>
                ))}
                {roster === null && (
                  <li className="p-3">
                    <LoadingDots size="sm" />
                  </li>
                )}
              </ul>
            )}
          </fieldset>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A month picker ("2026-10"), labelled the way `Input` labels its box. */
function MonthField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: Period;
  max: Period;
  onChange: (value: Period) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <input
        type="month"
        value={value}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
      />
    </label>
  );
}
