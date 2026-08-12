"use client";
// What the airplane is due for, as a row of dials.
//
// A gauge rather than a list because the question is "how much is left", which
// is a proportion, and a proportion read against a marked arc is faster than
// reading "19.3" and remembering the interval was 50. They sit in a row so the
// whole sheet is one glance: the shortest needle is the next job.
//
// Two rules the dial encodes:
//
//   • The NEEDLE is linear — halfway round means half the interval is gone,
//     because the needle is a measurement and lying about it would be the one
//     thing a gauge must not do.
//   • The COLOUR is not. The first half of an oil-change interval is
//     uneventful and the last tenth is the whole story, so the ramp holds green
//     most of the way round and then goes amber-to-red quickly. The gradient
//     stops below are that curve.
//
// Colour never carries the answer on its own (the house rule — see Meter.tsx):
// the countdown is printed in the middle of every dial, and its state in words
// underneath.
import { useState } from "react";
import Card from "@/components/common/Card";
import Modal from "@/components/common/Modal";
import Badge from "@/components/common/Badge";
import Link from "next/link";
import { formatFullDate } from "@/lib/dates";
import {
  DUE_SOON_DAYS,
  DUE_SOON_HOURS,
  MAINTENANCE_STATE_LABELS,
  MAINTENANCE_STATE_TONES,
  byUrgency,
  formatRemaining,
  gaugePosition,
  maintenanceDue,
  type MaintenanceDue,
} from "@/lib/maintenance";
import type { ApiAircraft, ApiMaintenanceItem } from "@/lib/types";

export default function MaintenanceGauges({
  aircraft,
  canManage,
}: {
  aircraft: ApiAircraft;
  canManage: boolean;
}) {
  const [open, setOpen] = useState<ApiMaintenanceItem | null>(null);
  const tach = aircraft.lastTach;
  const items = byUrgency(aircraft.maintenance, tach);

  if (items.length === 0) {
    return (
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Maintenance</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing tracked yet.{" "}
          {canManage ? (
            <Link
              href="/status/maintenance"
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Add the annual, the oil change and the equipment checks
            </Link>
          ) : (
            "The Maintenance Officer keeps this list."
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Maintenance</h2>
        <Link
          href="/status/maintenance"
          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {canManage ? "Record a sign-off" : "See the sheet"}
        </Link>
      </div>

      {/* One row, sharing the width evenly — the dials are meant to be read
          against each other, so they're the same size and evenly spaced rather
          than a scrolling strip. `min-w` is what stops five of them squeezing
          into illegibility on a phone: below that they wrap instead. */}
      <div className="flex flex-wrap items-start gap-2">
        {items.map((item) => (
          <Gauge
            key={item.id}
            item={item}
            due={maintenanceDue(item, tach)}
            onClick={() => setOpen(item)}
          />
        ))}
      </div>

      {open && (
        <HowItsWorkedOut
          item={open}
          tach={tach}
          canManage={canManage}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  );
}

/** Where the value sits, in the arc's own coordinates. */
const R = 46;
const CX = 56;
const CY = 56;
/** A semicircle, left to right over the top. */
const SWEEP = Math.PI;

function pointAt(fraction: number): { x: number; y: number } {
  const angle = Math.PI - fraction * SWEEP;
  return { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
}

const ARC = (() => {
  const start = pointAt(0);
  const end = pointAt(1);
  return `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;
})();

/**
 * The number in the middle takes its colour from where the DOT is, not from
 * the item's state.
 *
 * The two disagree on purpose in the interesting case: an oil change with 17
 * hours left is still "in limits", and a dial whose needle is four fifths of
 * the way round while its figure sits reassuringly green is a dial saying two
 * different things at once. The reader looks at the number — so the number
 * follows the needle, and the state stays underneath in words.
 *
 * The breakpoints are the gradient's own stops, so the figure changes colour
 * exactly where the arc behind the dot does.
 */
function inkAt(position: number | null): string {
  if (position == null) return "text-gray-400 dark:text-gray-500";
  if (position >= 1) return "text-red-600 dark:text-red-400";
  if (position >= 0.8) return "text-orange-600 dark:text-orange-400";
  if (position >= 0.55) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function Gauge({
  item,
  due,
  onClick,
}: {
  item: ApiMaintenanceItem;
  due: MaintenanceDue;
  onClick: () => void;
}) {
  const position = gaugePosition(due);
  // An untracked item has no countdown, so it gets an empty dial rather than a
  // needle parked at zero — which would read as "brand new".
  const needle = position == null ? null : pointAt(position);
  const label = formatRemaining(due);

  return (
    <button
      onClick={onClick}
      className="flex min-w-[7.5rem] flex-1 flex-col items-center rounded-lg px-1 py-2 text-center transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
      aria-label={`${item.label} — ${label}. How this is worked out`}
    >
      <svg viewBox="0 0 112 66" className="w-full" aria-hidden="true">
        <defs>
          {/* The exponential ramp, as gradient stops: green holds to 55% of
              the dial, amber arrives at 80%, red owns the last fifth. */}
          <linearGradient id="mx-ramp" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#16a34a" />
            <stop offset="55%" stopColor="#22c55e" />
            <stop offset="80%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>

        {/* The track, tinted along its length. */}
        <path
          d={ARC}
          fill="none"
          stroke="url(#mx-ramp)"
          strokeWidth="9"
          strokeLinecap="round"
          opacity={position == null ? 0.25 : 1}
        />

        {/* The needle: a short bar across the arc, the way the dial in a panel
            marks a reading rather than a pointer from the centre. */}
        {needle && (
          <>
            <circle
              cx={needle.x}
              cy={needle.y}
              r="7"
              className="fill-white dark:fill-gray-800"
            />
            <circle
              cx={needle.x}
              cy={needle.y}
              r="4.5"
              className="fill-gray-700 dark:fill-gray-200"
            />
          </>
        )}
      </svg>

      <span className={`-mt-4 text-base font-bold ${inkAt(position)}`}>
        {label}
      </span>
      <span className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">
        {item.label}
      </span>
      {/* The state stays on the club's OWN vocabulary rather than the dial's
          colour: "in limits" is a fact about the airplane, and a figure going
          orange near the end of an interval doesn't change it. */}
      <span className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
        {MAINTENANCE_STATE_LABELS[due.state]}
      </span>
    </button>
  );
}

/**
 * The dial, in longhand.
 *
 * A gauge is a summary, and a summary of an airworthiness item has to be able
 * to show its working — otherwise "19.3 hrs" is a number the club is asked to
 * take on trust. This names both intervals, both countdowns, which one is
 * binding, and what was signed off to start them.
 */
function HowItsWorkedOut({
  item,
  tach,
  canManage,
  onClose,
}: {
  item: ApiMaintenanceItem;
  tach: number | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const due = maintenanceDue(item, tach);

  return (
    <Modal
      open
      onClose={onClose}
      title={item.label}
      subtitle={
        item.reference
          ? `${item.reference}${item.requiredByReg ? " · required by regulation" : ""}`
          : item.requiredByReg
            ? "Required by regulation"
            : "The club's own schedule"
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone={MAINTENANCE_STATE_TONES[due.state]}>
            {MAINTENANCE_STATE_LABELS[due.state]}
          </Badge>
          <span className="font-semibold">{formatRemaining(due)}</span>
        </div>

        <dl className="space-y-1.5">
          <Row label="Last signed off">
            {item.lastDoneOn ? formatFullDate(new Date(item.lastDoneOn)) : "—"}
            {item.lastDoneTach != null && ` at tach ${item.lastDoneTach.toFixed(1)}`}
          </Row>
          {item.intervalHours != null && (
            <Row label="Hour interval">
              every {item.intervalHours} tach hours
              {due.dueAtTach != null && ` → due at ${due.dueAtTach.toFixed(1)}`}
              {due.hoursRemaining != null && (
                <>
                  {" "}
                  · airplane is at {tach?.toFixed(1) ?? "—"}, so{" "}
                  {due.hoursRemaining.toFixed(1)} left
                </>
              )}
            </Row>
          )}
          {item.intervalMonths != null && (
            <Row label="Calendar interval">
              every {item.intervalMonths} calendar months, good through the END
              of that month
              {due.dueOn && ` → due ${formatFullDate(due.dueOn)}`}
              {due.daysRemaining != null && ` · ${due.daysRemaining} days left`}
            </Row>
          )}
          <Row label="Which one counts">
            {due.limitedBy === "hours"
              ? "The hours — they run out first."
              : due.limitedBy === "calendar"
                ? "The calendar — it runs out first."
                : "Neither: this item has no interval recorded."}
          </Row>
          {item.notes && <Row label="Notes">{item.notes}</Row>}
        </dl>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          The dial fills as the interval is used up, and the needle is linear —
          halfway round means half the interval is gone. The colour isn&rsquo;t:
          it holds green most of the way and then reddens quickly, because the
          last stretch is the part worth acting on. It turns amber inside{" "}
          {DUE_SOON_HOURS} hours or {DUE_SOON_DAYS} days of a limit.
          {item.requiredByReg
            ? " Overdue, this one grounds the airplane — it's required by regulation."
            : " Overdue, this is the club's own schedule slipping, not a grounding."}
        </p>

        {canManage && (
          <Link
            href="/status/maintenance"
            className="inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Record a sign-off →
          </Link>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
