"use client";
// Basic surface container used across all tabs.
// `ComponentProps<"div">` rather than `HTMLAttributes`, because it includes
// `ref` — which React 19 passes to function components as an ordinary prop, so
// spreading it below is all that's needed to let a caller measure or scroll to
// a card (CheckoutList scrolls the section you just opened into view).
import { ComponentProps } from "react";

export default function Card({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm
        dark:border-gray-700 dark:bg-gray-800 ${className}`}
      {...props}
    />
  );
}
