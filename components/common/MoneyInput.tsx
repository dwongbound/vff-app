"use client";
// A dollar amount, typed the way money is written.
//
// A plain number box made people type "590" and hope it meant $590.00: no
// currency mark, a spinner that nudged the figure by a dollar on a stray
// scroll, and nothing to say whether cents were wanted. This one has a fixed
// "$" in front, accepts only digits and one decimal point (two places at
// most), and fills in the cents when you leave it — "590" becomes "590.00" —
// so what's in the box once you've moved on is exactly what will be charged.
//
// The value is the STRING in the box, like any other input; parse it with
// `parseDollars` when it's needed as cents. Same label/hint/error layout as
// `Input`, hint and error outside the <label> for the same accessible-name
// reason.
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cleanMoneyInput, finishMoneyInput } from "@/lib/finance";

interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
}

export default function MoneyInput({
  label,
  value,
  onChange,
  hint,
  error,
  className = "",
  onBlur,
  id,
  ...props
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // Unlike `Input`, the <label> wraps ONLY the caption and points at the box
  // with htmlFor: the "$" sits beside the box, and inside the label it became
  // part of the label's text ("Total$"), which is what getByLabel and some
  // assistive tech read.
  return (
    <div className="block">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500 dark:text-gray-400"
          >
            $
          </span>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            value={value}
            onChange={(e) => onChange(cleanMoneyInput(e.target.value))}
            onBlur={(e) => {
              const finished = finishMoneyInput(value);
              if (finished !== value) onChange(finished);
              onBlur?.(e);
            }}
            className={`tabular w-full rounded-lg border bg-white py-2 pl-7 pr-3 text-sm
              focus:outline-none focus:ring-1
              disabled:cursor-not-allowed disabled:opacity-60
              dark:bg-gray-800
              ${
                error
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600"
              } ${className}`}
            {...props}
          />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}
