"use client";
// The one line that says whether a self-saving page has kept what you typed.
// It never says "Saved" while anything is pending or in flight (see
// lib/autosave.ts), so it's something a member — and a test — can believe.
import LoadingDots from "@/components/common/LoadingDots";
import type { AutosaveState } from "@/lib/autosave";

export default function AutosaveStatus({ state }: { state: AutosaveState }) {
  let body;
  if (state.status === "pending" || state.status === "saving") {
    body = (
      <span className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <LoadingDots size="sm" label="Saving" />
        Saving…
      </span>
    );
  } else if (state.status === "saved") {
    body = <span className="text-green-700 dark:text-green-300">Saved</span>;
  } else if (state.status === "error") {
    body = <span className="text-red-700 dark:text-red-300">{state.error}</span>;
  } else {
    body = <span className="text-gray-500 dark:text-gray-400">Changes save as you go.</span>;
  }
  return (
    // aria-live rather than role="status": a polite announcement of the new
    // line, without claiming the page's one status region.
    <p className="min-h-5 text-sm" aria-live="polite" data-testid="autosave-status">
      {body}
    </p>
  );
}
