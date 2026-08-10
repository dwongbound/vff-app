"use client";
// One shared full-page loader for the whole app, so there's never more than
// one loader on screen and the page never flashes through before it appears.
//
// Three things drive it:
//   • begin()          — called the instant a nav tab is clicked, so the
//                        loader appears immediately, before the next page
//                        has even mounted.
//   • usePageLoading() — each page reports its own data-loading state.
//   • AuthGate         — reports through the same hook while it verifies the
//                        session, instead of rendering a second splash of its
//                        own. That's what makes the boot a single loader
//                        rather than one for auth and another for the page.
//
// Two details are what actually kill the double-load flash:
//
//   1. Reports are REF-COUNTED, not a single boolean. During a route change
//      the incoming page registers before the outgoing one unregisters, so a
//      plain boolean would blink off in between. The overlay hides only when
//      every reporter has finished.
//   2. Reports land in a LAYOUT effect, before the browser paints. Reporting
//      from a normal effect means the page gets one painted frame with its
//      empty state on screen before the overlay covers it — which is exactly
//      the "flashes the page and then loads again" everyone saw.
//
// The overlay is z-20, below the sticky navbar (z-30), so the nav stays put.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import LoadingScreen from "./common/LoadingScreen";

type Controls = {
  begin: () => void;
  report: (key: string, loading: boolean) => void;
};

const LoadingContext = createContext<Controls>({
  begin: () => {},
  report: () => {},
});

// useLayoutEffect has no meaning on the server and React warns about it there.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Returns begin(): show the loader immediately on a navigation click. */
export function useBeginNavigation() {
  return useContext(LoadingContext).begin;
}

/**
 * Drive the shared overlay from a page's own loading flag.
 *
 * Each caller gets its own key, so several components can be loading at once
 * (AuthGate verifying while the page fetches) and the overlay lifts when the
 * last of them is done.
 */
export function usePageLoading(loading: boolean) {
  const { report } = useContext(LoadingContext);
  const key = useId();
  useIsomorphicLayoutEffect(() => {
    report(key, loading);
    // A component that unmounts while still loading must release its claim,
    // or the overlay covers the next page forever.
    return () => report(key, false);
  }, [loading, report, key]);
}

export default function LoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // `navigating` is the instant click signal; `loadingKeys` is what mounted
  // components actually report.
  const [navigating, setNavigating] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // True until the first client commit. Reports only arrive from effects, so
  // without this the server-rendered HTML would carry no overlay at all and a
  // hard load would flash bare chrome before hydration.
  const [booting, setBooting] = useState(true);
  // Kept true until the fade-out finishes, so the overlay can animate out.
  const [rendered, setRendered] = useState(false);
  const pathname = usePathname();

  const visible = booting || navigating || loadingKeys.size > 0;

  // Mount the overlay during THIS render rather than in an effect: an effect
  // would put it on screen one painted frame late, which is the flash we're
  // here to remove. (Adjusting state during render is fine for the same
  // component — React re-runs it before committing.)
  if (visible && !rendered) setRendered(true);

  const begin = useCallback(() => setNavigating(true), []);

  const report = useCallback((key: string, loading: boolean) => {
    setLoadingKeys((prev) => {
      // Returning the same set when nothing changed keeps this from looping:
      // a page re-reporting the same value must not re-render the provider.
      if (prev.has(key) === loading) return prev;
      const next = new Set(prev);
      if (loading) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Hand over from the boot-time overlay to the reported one. Children's
  // layout effects run before this (React commits depth-first), so anything
  // still loading has already claimed a key and the overlay stays up without
  // a blink.
  useIsomorphicLayoutEffect(() => {
    setBooting(false);
  }, []);

  // Release the click signal once the new route has mounted, for the same
  // reason: if the new page is still loading the overlay stays up, and if it
  // rendered instantly this is what lets the overlay fade out.
  useEffect(() => {
    setNavigating(false);
  }, [pathname]);

  // When the splash owns the WHOLE WINDOW rather than just the content column.
  //
  // Two cases, and they're the same case: there is nothing behind it worth
  // seeing.
  //
  //   • the first boot — the rail and the top bar are chrome around an app
  //     that hasn't loaded yet, and showing them framing an empty hole is a
  //     half-drawn app rather than a loading one. It takes z-50 there, above
  //     the navbar's z-30, because covering them is the whole point.
  //   • /login, which has no rail or top bar at all (Navbar returns null) —
  //     the same exception AppShell makes for the content column's indent.
  //
  // Every LATER load is a navigation between pages you can already see, and
  // the chrome stays put: covering a rail you're still using would make the
  // app flash its whole frame on every tab tap.
  const chromeless = pathname === "/login";
  const wholeWindow = booting || chromeless;

  return (
    <LoadingContext.Provider value={{ begin, report }}>
      {children}
      {rendered && (
        <div
          aria-hidden={!visible}
          onTransitionEnd={() => {
            if (!visible) setRendered(false);
          }}
          // The box the splash fills, and therefore what it centres itself
          // in: the CONTENT COLUMN, not the window. Below the top bar (the
          // same live `--app-header-h` the rail offsets itself by) and right
          // of the rail from `md` up (`md:left-60`, in step with the rail's
          // `w-60` and AppShell's `md:pl-60`). Centred in the whole window
          // instead, the airplane sits 7.5rem left of the space it covers,
          // which reads as a misaligned splash rather than a full-width one.
          //
          // z-20 keeps it below the sticky navbar (z-30), so the chrome it is
          // deliberately not covering stays usable while a page loads.
          //
          // /login has neither piece of chrome — Navbar returns null there —
          // so it gets the whole window, the same exception AppShell makes.
          className={`fixed bottom-0 right-0 transition-opacity duration-300 ${
            wholeWindow ? "left-0 top-0 z-50" : "left-0 z-20 md:left-60"
          } ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          style={wholeWindow ? undefined : { top: "var(--app-header-h)" }}
        >
          <LoadingScreen />
        </div>
      )}
    </LoadingContext.Provider>
  );
}
