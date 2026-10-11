"use client";
// Basic surface container used across all tabs.
// `ComponentProps<"div">` rather than `HTMLAttributes`, because it includes
// `ref` — which React 19 passes to function components as an ordinary prop, so
// spreading it below is all that's needed to let a caller measure or scroll to
// a card (CheckoutList scrolls the section you just opened into view).
import { ComponentProps } from "react";

//
// `padded={false}` is how a card goes edge to edge (rows whose highlight must
// reach the card's border). It is a PROP, not `className="p-0"`: two padding
// utilities on one element are resolved by Tailwind's stylesheet order, not by
// the order they're written, and `p-4` wins — which is how every checkout
// section quietly kept a 16px gutter its rows' highlight couldn't cross.
export default function Card({
  className = "",
  padded = true,
  ...props
}: ComponentProps<"div"> & { padded?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm
        dark:border-gray-700 dark:bg-gray-800 ${padded ? "p-4" : ""} ${className}`}
      {...props}
    />
  );
}
