"use client";
// The readings a checkout item asks you to write down, rendered on the row.
//
// Shared by every checkout section CheckoutList draws, so a field
// behaves the same wherever the card puts it.
//
// Three things this has to get right:
//
//   • It is a SIBLING of the row's tick button, never inside it. An <input>
//     inside a <button> is invalid HTML and React refuses to hydrate it —
//     the same rule the (i) marker already follows.
//   • Every input carries a real <label>. The row's item text ("Oil — minimum
//     4 quarts") is not a label for the box, so the field names itself ("Oil",
//     "qts") and points at the input with htmlFor/id. The out-of-range note
//     lives OUTSIDE the label — inside, it becomes part of the accessible name
//     (the same reason Input.tsx keeps its hint out).
//   • Typing a value TICKS the item. You wrote the number down, so you did the
//     thing; making a pilot on a ramp type 34.5 and then also tap the box is
//     the sort of friction that gets a checklist abandoned. Clearing the value
//     does NOT untick — undoing is a deliberate act, and silently dropping a
//     tick someone earned is worse than a stale one they can see.
import type { ReactNode } from "react";
import { outOfRange, type CheckoutField, type Values } from "@/lib/checkouts";

export default function CheckoutFields({
  fields,
  values,
  hints,
  onChange,
}: {
  fields: CheckoutField[];
  values: Values;
  /**
   * Muted note under a field, by field id — what the airplane was like last
   * time somebody looked ("Last recorded 5 qts…").
   *
   * A hint, never a prefill. The value belongs to whoever is standing at the
   * dipstick right now, and putting last week's reading IN the box is how a
   * number nobody checked ends up signed for. An out-of-range warning wins the
   * space when there is one — that's about the reading in front of you.
   */
  hints?: Record<string, ReactNode>;
  onChange: (fieldId: string, value: number | string | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
      {fields.map((field) => {
        const raw = values[field.id];
        const warning = outOfRange(field, raw);
        const noteId = warning ? `${field.id}-note` : undefined;

        return (
          <div key={field.id} className="min-w-0">
            <label htmlFor={field.id} className="block">
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {field.label}
                {field.unit && (
                  <span className="ml-1 text-gray-400 dark:text-gray-500">
                    ({field.unit})
                  </span>
                )}
              </span>
            </label>
            <input
              id={field.id}
              type={field.kind === "time" ? "time" : "number"}
              inputMode={field.kind === "number" ? "decimal" : undefined}
              step={field.step}
              min={field.min}
              max={field.max}
              value={raw ?? ""}
              aria-describedby={noteId}
              aria-invalid={warning ? true : undefined}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "") {
                  onChange(field.id, null);
                  return;
                }
                onChange(
                  field.id,
                  field.kind === "number" ? Number(next) : next
                );
              }}
              // Stop a tap on the input from also toggling the row underneath.
              onClick={(e) => e.stopPropagation()}
              className={`mt-0.5 w-28 rounded-lg border bg-white px-2 py-1 text-sm tabular dark:bg-gray-800 ${
                warning
                  ? "border-amber-500 dark:border-amber-500"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            />
            {/* Advisory, never blocking — see `outOfRange`. The warning is
                about the reading in front of you, so it outranks the hint
                about the last one. */}
            {warning ? (
              <p
                id={noteId}
                className="mt-0.5 max-w-56 text-xs text-amber-700 dark:text-amber-400"
              >
                {warning}
              </p>
            ) : hints?.[field.id] ? (
              <p className="mt-0.5 max-w-56 text-xs text-gray-500 dark:text-gray-400">
                {hints[field.id]}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
