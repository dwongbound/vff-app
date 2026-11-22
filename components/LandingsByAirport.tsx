"use client";
// The flight log's "Landings by airport" card (Club view): one month at a
// time, a bar per airport, and an Export of every month for a landing-fee
// reimbursement claim. The numbers come from GET /api/reports/landings, which
// is club-wide (every airplane) and shaped by lib/landingReport.ts.
//
// Fetched when the card first appears rather than with the log: most visits
// to the log never look at it, and the report reads a year of flights.
import { useEffect, useMemo, useState } from "react";
import Card from "@/components/common/Card";
import ExportButton from "@/components/common/ExportButton";
import InfoTip from "@/components/common/InfoTip";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import { fetchJsonObject } from "@/lib/api";
import { landingReportSheet } from "@/lib/exports";
import { currentPeriod, formatPeriod, type Period } from "@/lib/finance";
import { formatCents } from "@/lib/hours";
import type { LandingMonth } from "@/lib/landingReport";
import { xlsxFilename } from "@/lib/xlsx";

/** How far back the card reads, in months including this one. */
const REPORT_MONTHS = 24;

export default function LandingsByAirport() {
  const [months, setMonths] = useState<LandingMonth[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The month on screen. Null until the report lands, then the newest month
  // that has anything in it (usually this one).
  const [period, setPeriod] = useState<Period | null>(null);

  useEffect(() => {
    let live = true;
    fetchJsonObject<{ months: LandingMonth[] }>(
      `/api/reports/landings?months=${REPORT_MONTHS}`
    ).then((report) => {
      if (!live) return;
      if (!report) {
        setFailed(true);
        return;
      }
      setMonths(report.months);
      setPeriod(report.months[0]?.period ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  const month = useMemo(
    () => months?.find((m) => m.period === period) ?? null,
    [months, period]
  );
  // The longest bar is the busiest airport, so every bar is a share of it.
  const busiest = month ? Math.max(1, ...month.airports.map((a) => a.landings)) : 1;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold">Landings by airport</h2>
          <InfoTip label="Landings by airport">
            <span className="block">
              Every airplane in the club, from filed flights — what a landing-fee
              reimbursement claim is made from.
            </span>
            <span className="mt-1 block">
              &ldquo;Assumed&rdquo; landings come from entries that didn&rsquo;t list
              where they landed, so they&rsquo;re counted at the flight&rsquo;s
              arrival airport (or the airplane&rsquo;s home field).
            </span>
          </InfoTip>
        </div>
        <ExportButton
          filename={xlsxFilename(["landings-by-airport"])}
          disabled={!months || months.length === 0}
          build={() => [landingReportSheet(months ?? [])]}
        />
      </div>

      {failed && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load the landings report.
        </p>
      )}

      {!failed && months === null && (
        <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
          <LoadingDots label="Loading landings" />
          Loading landings
        </div>
      )}

      {months && months.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No landings filed in the last {REPORT_MONTHS} months.
        </p>
      )}

      {months && months.length > 0 && (
        <>
          <Select
            label="Month"
            hideLabel
            value={period ?? ""}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            {months.map((m) => (
              <option key={m.period} value={m.period}>
                {formatPeriod(m.period)}
                {m.period === currentPeriod() ? " (so far)" : ""}
              </option>
            ))}
          </Select>

          {month && (
            <>
              <ul className="space-y-2" aria-label={`Landings in ${formatPeriod(month.period)}`}>
                {month.airports.map((line) => (
                  <li key={line.airport} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-semibold tabular">{line.airport}</span>
                      <span className="tabular">
                        <span className="font-semibold">{line.landings}</span>{" "}
                        <span className="text-gray-500 dark:text-gray-400">
                          {line.landings === 1 ? "landing" : "landings"}
                          {line.assumed > 0 && ` · ${line.assumed} assumed`}
                          {line.feeCents > 0 && ` · ${formatCents(line.feeCents)} fees`}
                        </span>
                      </span>
                    </div>
                    <Bar
                      listed={line.landings - line.assumed}
                      assumed={line.assumed}
                      of={busiest}
                    />
                  </li>
                ))}
              </ul>
              <p className="border-t border-gray-200 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {month.landings} {month.landings === 1 ? "landing" : "landings"} on{" "}
                {month.flights} {month.flights === 1 ? "flight" : "flights"}
                {month.assumed > 0 && ` · ${month.assumed} assumed`}
                {month.feeCents > 0 && ` · ${formatCents(month.feeCents)} in fees recorded`}
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * One airport's bar: the landings pilots listed in solid colour, the assumed
 * ones lighter after them, both as a share of the busiest airport's total.
 */
function Bar({ listed, assumed, of }: { listed: number; assumed: number; of: number }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden>
      <div className="bg-indigo-600" style={{ width: `${(listed / of) * 100}%` }} />
      <div className="bg-indigo-300 dark:bg-indigo-800" style={{ width: `${(assumed / of) * 100}%` }} />
    </div>
  );
}
