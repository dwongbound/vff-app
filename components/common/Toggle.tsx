"use client";
// A two-state switch with a label on each side: "My card ( o) Club card".
//
// For a binary choice where BOTH sides deserve a name. A checkbox can't do
// that — it has a label and an unlabelled opposite, and the unlabelled one is
// whatever the reader assumes — and a radio pair costs four lines and a
// legend to say what this says in one row.
//
// It replaced exactly that: a "Paid with" fieldset whose two options each
// carried an explanatory subline. Correct, and far too much furniture for
// "whose card was it".
//
// The two labels are BUTTONS, not text. On a phone the label is the bigger
// target and tapping it to pick that side is what people try first; a label
// that looks tappable and isn't is worse than no label. The switch itself
// stays the control of record — `role="switch"` with `aria-checked`, so it
// reads as one thing to a screen reader rather than as three.
import type { ReactNode } from "react";

export default function Toggle({
  checked,
  onChange,
  offLabel,
  onLabel,
  label,
  disabled = false,
}: {
  /** True = the RIGHT-hand label is the chosen one. */
  checked: boolean;
  onChange: (next: boolean) => void;
  offLabel: ReactNode;
  onLabel: ReactNode;
  /**
   * What the switch is choosing, for screen readers — "switch, checked" on its
   * own says nothing about which side that is. Give it the question
   * ("Paid with the club's card"), not the state.
   */
  label: string;
  disabled?: boolean;
}) {
  const side = (active: boolean, content: ReactNode, next: boolean) => (
    <button
      type="button"
      // Presentational: the switch beside it already carries the state, and a
      // screen reader announcing three controls for one choice is noise.
      aria-hidden="true"
      tabIndex={-1}
      disabled={disabled}
      onClick={() => onChange(next)}
      className={`text-sm transition-colors ${
        active
          ? "font-medium text-gray-900 dark:text-gray-100"
          : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      }`}
    >
      {content}
    </button>
  );

  return (
    <div className="flex items-center gap-3">
      {side(!checked, offLabel, false)}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-60
          dark:focus-visible:ring-offset-gray-800
          ${checked ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
            ${checked ? "translate-x-[1.375rem]" : "translate-x-0.5"}`}
        />
      </button>
      {side(checked, onLabel, true)}
    </div>
  );
}
