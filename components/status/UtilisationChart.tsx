"use client";
// Hours flown per calendar month — the one thing the status page can show that
// isn't a single current reading.
//
// Form: a column chart, because the job is "compare magnitude across an ordered
// set of buckets". One series, so there is no legend (the heading names it) and
// no categorical palette — a single hue, which is also why the palette
// validator's adjacent-pair CVD check doesn't apply here.
//
// Marks follow the house spec: thin columns with 4px rounded tops anchored to a
// baseline, a 2px surface gap between them, a hairline baseline rule, and
// labels only where they earn their place (the tallest month, and the current
// one). A number over every column is noise nobody reads.
//
// Accessibility: the columns are decorative to a screen reader — the same
// figures are published as a real <table> in the sr-only block below, which is
// also the "relief" the contrast check requires for the accent fill.
import { formatHours, type MonthlyHours } from "@/lib/hours";

export default function UtilisationChart({ months }: { months: MonthlyHours[] }) {
  const peak = Math.max(...months.map((m) => m.hours), 0);
  const total = months.reduce((sum, m) => sum + m.hours, 0);
  const flown = months.filter((m) => m.hours > 0).length;
  // The last bucket is the month we're standing in — it isn't finished, so it
  // is never "the quiet month" and shouldn't be read as one.
  const currentIndex = months.length - 1;

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Hours flown</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {total > 0
            ? `${formatHours(total)} over ${months.length} months · ${flown} with flying`
            : `Nothing filed in the last ${months.length} months`}
        </p>
      </figcaption>

      {peak === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No flights filed yet — this fills in as the club flies.
        </p>
      ) : (
        // The container grows with its content: the columns get a fixed height,
        // the month labels sit BELOW that in normal flow. Fixing the height of
        // the whole figure is what gives a card its own tiny scrollbar.
        <div className="flex items-end gap-0.5" role="presentation">
          {months.map((m, i) => {
            const isCurrent = i === currentIndex;
            // Floor the visible height so a month with a little flying still
            // reads as more than an empty one.
            const pct = m.hours === 0 ? 0 : Math.max(6, (m.hours / peak) * 100);
            const labelled = m.hours > 0 && (m.hours === peak || isCurrent);

            return (
              <div key={m.label + i} className="group relative flex-1">
                <div className="flex h-24 items-end">
                  <div
                    className={`w-full rounded-t transition-all ${
                      m.hours === 0
                        ? "bg-gray-200 dark:bg-gray-700"
                        : isCurrent
                          ? "bg-indigo-300 dark:bg-indigo-800"
                          : "bg-indigo-500 dark:bg-indigo-400"
                    }`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                </div>

                {/* Hover layer: an HTML chart is interactive by default, and a
                    column too short to label still has to be readable. */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block dark:bg-gray-700">
                  {m.label} · {formatHours(m.hours)}
                </div>

                <p className="mt-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
                  {m.label}
                </p>
                <p className="text-center text-[11px] font-medium tabular text-gray-700 dark:text-gray-300">
                  {labelled ? m.hours.toFixed(1) : " "}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* The same numbers, for anyone not reading the columns. */}
      <table className="sr-only">
        <caption>Tach hours flown per month</caption>
        <tbody>
          {months.map((m, i) => (
            <tr key={m.label + i}>
              <th scope="row">{m.label}</th>
              <td>{formatHours(m.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
