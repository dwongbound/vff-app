"use client";
// Labeled multi-line input — squawk descriptions, flight notes.
import { TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export default function Textarea({
  label,
  hint,
  className = "",
  rows = 3,
  ...props
}: TextareaProps) {
  return (
    <div className="block">
      {/* Hint sits outside the <label> so it stays out of the field's
          accessible name — see components/common/Input.tsx. */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <textarea
          rows={rows}
          className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
            dark:border-gray-600 dark:bg-gray-800 ${className}`}
          {...props}
        />
      </label>
      {hint && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  );
}
