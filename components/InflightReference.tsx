"use client";
// The parts of the airplane's card you read in the air, parked at the bottom
// of the runway page: takeoff, climb, cruise, descent, and the KBFI
// frequencies.
//
// Collapsed by default — it's a lookup, not a step in the walkaround, and the
// runway checkout above it is already long. Nothing here ticks: see
// lib/inflightReference.ts for why these phases aren't a checkout.
import { useState } from "react";
import Card from "@/components/common/Card";
import { FIELD_FREQUENCIES, INFLIGHT_PHASES } from "@/lib/inflightReference";

export default function InflightReference() {
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">In-flight reference</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Takeoff, climb, cruise, descent &amp; field frequencies
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4 dark:border-gray-700">
          {INFLIGHT_PHASES.map((phase) => (
            <div key={phase.id}>
              <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {phase.title}
              </h3>
              <dl className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                {phase.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-baseline justify-between gap-3 py-1.5"
                  >
                    <dt className="min-w-0">{item.label}</dt>
                    <dd className="shrink-0 text-right font-medium tabular">
                      {item.action}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          <div>
            <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {FIELD_FREQUENCIES.field}
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 text-sm">
              {FIELD_FREQUENCIES.entries.map((entry) => (
                <div
                  key={entry.label}
                  className="flex items-baseline justify-between gap-2 py-1"
                >
                  <dt className="min-w-0 truncate text-gray-500 dark:text-gray-400">
                    {entry.label}
                  </dt>
                  <dd className="shrink-0 font-medium tabular">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Airspeeds are MPH, as marked on this airplane's ASI.
          </p>
        </div>
      )}
    </Card>
  );
}
