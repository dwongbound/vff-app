"use client";
// Reusable button. Add variants/sizes here as the app grows.
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400",
  secondary:
    "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 " +
    "dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400",
  // Money settled, a thing confirmed done. Green is otherwise only ever a
  // credit's colour in this app, so it stays rare on a button too.
  success: "bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400",
  ghost:
    "bg-transparent text-gray-700 hover:bg-gray-100 " +
    "dark:text-gray-300 dark:hover:bg-gray-800",
};

// Vertical padding is deliberately one step tighter than the horizontal:
// the type scale already runs 1px large (see tailwind.config.ts), and stock
// paddings on top of that gave every button a slab of empty space above and
// below its label.
const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-1.5 text-sm",
  // The primary action at the bottom of a form. Still the tallest of the
  // three; the WIDTH is what makes it the easy target on a phone (these are
  // `w-full` below `sm`), so the height doesn't have to carry that on its own.
  lg: "px-5 py-2 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Marks a button that destroys something (Delete, Remove, Reset). Implied
   *  by `variant="danger"`; pass it for a quiet ghost Delete too. A modal
   *  footer draws these a size SMALLER than the actions beside them, so the
   *  safe choice is always the bigger target. */
  destructive?: boolean;
}

// Press feedback: a button gives a little under the finger (97%) the moment it
// goes DOWN, not when the tap is released — releasing is when a click fires,
// and feedback that waits for it reads as lag. Quick and ease-out, and not on
// a disabled button, which shouldn't look like it took the press.
export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  destructive,
  ...props
}: ButtonProps) {
  return (
    <button
      data-destructive={destructive || variant === "danger" || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium
        transition-[color,background-color,border-color,scale] duration-150 ease-out
        enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
