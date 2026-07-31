"use client";
// Full-width notification banner (e.g. the "airplane is grounded" warning).
// Tones map to semantic colors; pass onDismiss to show an ✕, and `href` for a
// trailing "→" that links to whatever the banner is nudging you toward.
import Link from "next/link";
import { ReactNode } from "react";

type BannerTone = "indigo" | "amber" | "red";

const TONE_CLASSES: Record<BannerTone, string> = {
  indigo:
    "bg-indigo-50 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  red: "bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export default function Banner({
  tone = "indigo",
  children,
  href,
  onLinkClick,
  onDismiss,
}: {
  tone?: BannerTone;
  children: ReactNode;
  href?: string;
  onLinkClick?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className={`w-full ${TONE_CLASSES[tone]}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span>
          {children}
          {href && (
            <Link
              href={href}
              onClick={onLinkClick}
              aria-label="Go there"
              className="ml-1.5 whitespace-nowrap text-base font-bold hover:opacity-70"
            >
              →
            </Link>
          )}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
