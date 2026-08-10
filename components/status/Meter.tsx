"use client";
// A level against a known total — the right form for "how much is in it", where
// a bare number makes you do the division yourself.
//
// Two rules from the house chart spec are load-bearing here:
//
//   • The unfilled track is a LIGHTER STEP OF THE SAME RAMP, not grey, so the
//     bar reads as one object and the state carries across its whole width.
//   • Status colour never travels alone. The palette validator FAILS amber
//     against green under protanopia (ΔE 5.7) and both warn on contrast, so a
//     meter that said "low" only by turning amber would be saying nothing to a
//     colourblind member. Every toned meter therefore prints `state` as words.
//
// `tone` is deliberately not derived from the fraction: a level only means
// something against a threshold somebody actually set, and inventing one on a
// page pilots use to decide whether to fly would be worse than showing none.
// Oil has a real minimum (4 qts, off the airplane's own card); fuel has no
// gallon threshold anywhere in the club's rules — its reserve is written in
// HOURS, which needs a burn rate this app doesn't store — so fuel stays
// neutral and simply reports what was measured.
import Card from "@/components/common/Card";

type Tone = "neutral" | "good" | "warning";

const FILL: Record<Tone, string> = {
  neutral: "bg-indigo-500 dark:bg-indigo-400",
  good: "bg-green-600 dark:bg-green-500",
  warning: "bg-amber-500 dark:bg-amber-400",
};

// Same hue as the fill, several steps lighter.
const TRACK: Record<Tone, string> = {
  neutral: "bg-indigo-100 dark:bg-indigo-950",
  good: "bg-green-100 dark:bg-green-950",
  warning: "bg-amber-100 dark:bg-amber-950",
};

const STATE_INK: Record<Tone, string> = {
  neutral: "text-gray-500 dark:text-gray-400",
  good: "text-green-700 dark:text-green-400",
  warning: "text-amber-700 dark:text-amber-400",
};

export default function Meter({
  label,
  value,
  unit,
  /** 0–1, or null when nothing has been recorded. */
  fraction,
  /** The words that carry the state when colour can't. */
  state,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  unit: string;
  fraction: number | null;
  state?: string;
  tone?: Tone;
  note: string;
}) {
  const pct = fraction == null ? null : Math.max(0, Math.min(1, fraction)) * 100;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </p>
        {state && (
          <p className={`text-xs font-semibold ${STATE_INK[tone]}`}>{state}</p>
        )}
      </div>

      <p className="text-2xl font-bold">
        {value}
        <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">
          {unit}
        </span>
      </p>

      {pct == null ? (
        // Nothing measured. An empty track would read as "the tanks are dry",
        // which is a far worse lie than an obvious blank.
        <div className="h-2 rounded-full border border-dashed border-gray-300 dark:border-gray-600" />
      ) : (
        <div
          className={`h-2 overflow-hidden rounded-full ${TRACK[tone]}`}
          role="meter"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${value} ${unit}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${FILL[tone]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>
    </Card>
  );
}
