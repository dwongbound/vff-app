"use client";
// A select whose options are COLOURED CHIPS rather than lines of text.
//
// For the small controlled vocabularies where the colour is half the meaning: a
// squawk's status is the difference between "fly it" and "don't", and a native
// <select> renders every one of those in the same grey, so the reader has to
// finish reading the sentence before they know which one they're looking at.
// The chip carries the answer at a glance and the words confirm it.
//
// Deliberately NOT built on `Dropdown`: that one opens on hover, which is right
// for a navigation menu you're browsing and wrong for a control that changes a
// stored value — brushing past a status picker on the way to something else
// should not open it.
//
// Native `<select>` is still the right answer for everything else. This is for
// the case where the options are a status vocabulary with tones attached.
import { useEffect, useId, useRef, useState } from "react";
import Badge, { type BadgeTone } from "./Badge";
import InfoTip from "./InfoTip";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  tone: BadgeTone;
  /**
   * What choosing this means, behind the row's (i). A hover rather than a line
   * of subtext under every chip: the vocabulary is five items long and the
   * colour already says most of it, so the explanations are there for the
   * reader who wants one and out of the way of the one who doesn't.
   */
  hint?: string;
}

export default function ChipSelect<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: ChipOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const valueId = useId();

  const current = options.find((o) => o.value === value) ?? options[0];

  // Close on an outside click or Escape — the same bargain every menu in the
  // app strikes. Escape also returns focus to the trigger, since a keyboard
  // user who backs out of a menu has nowhere else sensible to be.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <span
        id={labelId}
        className={
          hideLabel
            ? "sr-only"
            : "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        }
      >
        {label}
      </span>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Named by the field AND its current value, so a screen reader reading
        // the page's controls out of context gets "Status, Reviewed — in work"
        // rather than a row of identical buttons called "Status". The label
        // comes first, which is also what makes the control findable by name
        // regardless of what it's currently set to.
        aria-labelledby={`${labelId} ${valueId}`}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left transition-colors hover:border-gray-400 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500"
      >
        <span id={valueId}>
          <Badge tone={current.tone}>{current.label}</Badge>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby={labelId}
          className="absolute right-0 z-40 mt-1 w-full min-w-max overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              // The hint's (i) is a button of its own, so it sits BESIDE the
              // option rather than inside it — nesting one button in another is
              // invalid, and a click on "why" must not also pick the value.
              <li
                key={option.value}
                className="flex items-center transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false);
                    // Re-picking the current value is a no-op rather than a
                    // round trip that saves what's already stored.
                    if (!selected) onChange(option.value);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left"
                >
                  <span className="flex h-5 w-4 shrink-0 items-center justify-center text-indigo-600 dark:text-indigo-400">
                    {selected && (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path
                          fillRule="evenodd"
                          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <Badge tone={option.tone}>{option.label}</Badge>
                </button>
                <span className="flex shrink-0 items-center pl-2 pr-3">
                  {option.hint && (
                    <InfoTip label={option.label}>{option.hint}</InfoTip>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
