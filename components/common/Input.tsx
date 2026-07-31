"use client";
// Labeled text input. The <label> wraps the caption and the <input>, which
// associates them for accessibility (and lets Playwright's getByLabel find
// them).
//
// The hint/error line sits OUTSIDE the <label> on purpose: anything inside it
// becomes part of the field's accessible name, so a hint would turn "Password"
// into "Password At least 8 characters" for screen readers (and break
// getByLabel("Password", { exact: true })).
import { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Muted helper text under the field (units, format, why we ask). */
  hint?: ReactNode;
  /** Red validation message; replaces the hint while present. */
  error?: string | null;
}

export default function Input({
  label,
  hint,
  error,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="block">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <input
          aria-invalid={error ? true : undefined}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm
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
      </label>
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}
