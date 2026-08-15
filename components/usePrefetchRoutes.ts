"use client";
// Pull the pages a member is about to need into the browser BEFORE they need
// them.
//
// The checkouts run in a fixed order and the app already knows it: preflight at
// the airplane, taxi & runway in the seat, post-flight at the tail. What sits
// in the MIDDLE of that sequence is a flight. A member who walks the preflight
// card standing in the clubhouse wifi and then taxis out has left it behind by
// the time they want the next card — and Next fetches a route's payload and its
// JS chunks on the FIRST navigation to it, which is exactly then.
//
// So each card prefetches the ones downstream of it while there is still
// signal. They land in the router cache, and the client-side navigation at the
// end of the card then needs no network at all.
//
// Two honest limits, neither of which this hook can fix:
//
//   - A HARD RELOAD still hits the network for the document itself. Without a
//     service worker there is nowhere else for it to come from, so an airplane
//     with no signal is one browser refresh away from a blank page. The drafts
//     survive it (they're in localStorage) — the app shell doesn't.
//   - The pages' own API reads (the fleet, the last preflight, open squawks)
//     are separate requests and will fail offline. They already degrade to
//     empty rather than throwing, so the card renders; it just can't tell you
//     what the last recorded oil was.
//
// Both are worth knowing about before someone concludes the app is "offline
// capable" in a stronger sense than this.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function usePrefetchRoutes(routes: readonly string[], enabled = true) {
  const router = useRouter();

  // Call sites pass a fresh array literal on every render, so the effect keys
  // off the CONTENT rather than the identity — otherwise it re-runs forever.
  // Routes are paths and never contain a space, which is what makes joining and
  // re-splitting on one safe.
  const key = routes.join(" ");

  useEffect(() => {
    if (!enabled) return;
    for (const href of key.split(" ").filter(Boolean)) {
      // Best-effort by definition: prefetching is an optimisation, and a failed
      // one (offline already, a dev build that doesn't prefetch) must never
      // surface to the member as anything at all.
      try {
        router.prefetch(href);
      } catch {
        // Ignored on purpose — see above.
      }
    }
  }, [key, enabled, router]);
}
