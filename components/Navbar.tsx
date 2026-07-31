"use client";
// Top navigation on desktop, floating bottom bar on phones.
//
// Four tabs, in the order a flight actually happens: Preflight → Post-flight →
// Flight Log → Reservations. Phones get the same four as an icon-first pill
// docked above the home indicator, and can swipe left/right between them (the
// gesture itself lives in SwipePager; this component publishes the tab order
// it needs).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import Banner from "./common/Banner";
import Dropdown from "./common/Dropdown";
import Logo from "./Logo";
import { useAircraft } from "./AircraftProvider";
import { useBeginNavigation } from "./LoadingProvider";
import { useSwipe } from "./SwipeProvider";
import { setNavDirection } from "@/lib/navDirection";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import { CLUB_SHORT_NAME } from "@/lib/constants";

// Outline icon paths (24×24 heroicons) for the bottom bar tabs.
const CLIPBOARD_ICON =
  "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z";
const GAUGE_ICON =
  "M12 6v2.25m0 0a5.25 5.25 0 105.25 5.25M12 8.25a5.25 5.25 0 00-5.25 5.25m10.5 0h1.5M4.5 13.5H3m14.03-6.03l1.06-1.06M6.91 7.47L5.85 6.41M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
const BOOK_ICON =
  "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25";
const CALENDAR_ICON =
  "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5";

// Tab order is deliberate: it matches the order of a flight, so swiping right
// through the app walks you through the day.
const TABS = [
  { href: "/preflight", label: "Preflight", mobileLabel: "Preflight", icon: CLIPBOARD_ICON },
  { href: "/postflight", label: "Post-flight", mobileLabel: "Post", icon: GAUGE_ICON },
  { href: "/log", label: "Flight Log", mobileLabel: "Log", icon: BOOK_ICON },
  { href: "/reservations", label: "Reservations", mobileLabel: "Reserve", icon: CALENDAR_ICON },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { selected } = useAircraft();
  const [theme, setTheme] = useState<Theme>("system");
  // Href of the tab just clicked, so it highlights immediately instead of
  // waiting for `pathname` to update after the new page mounts.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [groundedDismissed, setGroundedDismissed] = useState(false);
  // Published as the `--app-header-h` CSS var so full-height pages (the
  // reservation calendar) can size themselves to the space below the nav —
  // which grows and shrinks as banners appear/dismiss.
  const navRef = useRef<HTMLElement>(null);
  const beginNavigation = useBeginNavigation();
  const router = useRouter();

  // Shared with SwipePager: the navbar writes the live tab list / active index /
  // navigate fn here, and reads back `previewIndex` — the tab the in-progress
  // swipe is heading toward — so the highlight updates live during the drag.
  const {
    tabsRef: tabHrefsRef,
    activeIndexRef,
    navigateRef,
    previewIndex,
  } = useSwipe();

  // Phone bottom bar shrinks to icons-only on scroll down (labels collapse) and
  // expands back on scroll up or near the top. It never fully hides, so
  // navigation stays one tap away.
  const [bottomBarCompact, setBottomBarCompact] = useState(false);

  // Read the persisted mode after mount (localStorage is client-only).
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  // Once the real route catches up to the clicked tab, drop the optimistic
  // highlight so `pathname` is the single source of truth again.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Track scroll direction to shrink/expand the phone bottom bar. Uses a ref
  // for the last position so the passive listener never re-attaches, and
  // rAF-throttles so it recalculates at most once per frame.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 40) setBottomBarCompact(false);
        else if (delta > 8) setBottomBarCompact(true);
        else if (delta < -8) setBottomBarCompact(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // While in "system" mode, follow live OS theme changes.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Keep `--app-header-h` in sync with the nav's real height (bar + any
  // banners). Must stay above the early return below so hook order is
  // identical on every route.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--app-header-h",
        `${el.offsetHeight}px`
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // No chrome on the login page. Placed after all hooks so hook order stays
  // stable across renders (never return before a hook).
  if (pathname === "/login") return null;

  // Cycle light → dark → system → light.
  const cycleTheme = () => {
    const next: Theme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    storeTheme(next);
    applyTheme(next);
    setTheme(next);
  };

  const themeIcon = theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥️";
  const themeLabel = `Theme: ${theme} (click to change)`;

  const grounded = selected?.groundingSquawks ?? [];

  // Shared by both nav bars: is this tab the highlighted one, and what to do
  // on click. Prefer the just-clicked tab so selection is instant; fall back
  // to the real route once navigation completes.
  const isActive = (href: string) =>
    pendingHref ? pendingHref === href : pathname.startsWith(href);
  // During a swipe, SwipePager sets `previewIndex` so the highlight follows the
  // drag to the tab you're heading toward.
  const tabActive = (index: number, href: string) =>
    previewIndex != null ? index === previewIndex : isActive(href);

  const handleTabClick = (href: string) => {
    // Show the shared loader and highlight the clicked tab the instant it's
    // clicked, before the next page mounts.
    if (pathname !== href) {
      setPendingHref(href);
      beginNavigation();
    }
  };

  // Feed the swipe handler the current tab order, active tab, and a navigate
  // fn (same optimistic highlight + loader a tab tap gets, then a real push).
  tabHrefsRef.current = TABS.map((t) => t.href);
  activeIndexRef.current = Math.max(
    0,
    TABS.findIndex((t) => isActive(t.href))
  );
  navigateRef.current = (href) => {
    // Tell SwipePager which way the content should slide: swiping to a
    // right-hand tab slides the new page in from the right, and vice versa.
    const to = tabHrefsRef.current.indexOf(href);
    setNavDirection(Math.sign(to - activeIndexRef.current));
    handleTabClick(href);
    router.push(href);
  };

  return (
    <>
      <nav
        ref={navRef}
        className="sticky top-0 z-30 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/reservations" aria-label={`${CLUB_SHORT_NAME} home`} className="shrink-0">
              <Logo className="h-9 w-9" />
            </Link>
            {/* Tab strip — hidden on phones, where the floating bottom bar
                (below) takes over. `p-2 -m-2` gives the overflow clip box room
                for anything sticking out of a tab, then cancels itself. */}
            <div className="hidden gap-1 overflow-x-auto p-2 -m-2 sm:flex">
              {TABS.map((tab, i) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  onClick={() => handleTabClick(tab.href)}
                  className={tabClassName(tabActive(i, tab.href))}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Which airplane every tab is talking about. A one-airplane club
                sees a plain tail-number chip; more than one gets a picker. */}
            <AircraftChip />

            <button
              onClick={cycleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {themeIcon}
            </button>

            {session?.user && (
              <Dropdown
                trigger={
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                      {(session.user.name ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="hidden text-sm font-medium sm:block">
                      {session.user.name}
                    </span>
                  </span>
                }
              >
                <Link
                  href="/profile"
                  className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  My profile
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Log out
                </button>
              </Dropdown>
            )}
          </div>
        </div>

        {/* The one banner that matters: an open grounding squawk means nobody
            flies. Dismissible so it doesn't block the page, but it comes back
            on the next load until the squawk is signed off. */}
        {grounded.length > 0 && !groundedDismissed && (
          <Banner
            tone="red"
            href="/log?squawks=open"
            onLinkClick={() => handleTabClick("/log")}
            onDismiss={() => setGroundedDismissed(true)}
          >
            <span className="font-semibold">
              {selected?.tailNumber} is grounded:
            </span>{" "}
            {grounded.map((s) => s.title).join(", ")}. Do not fly until it&rsquo;s
            signed off.
          </Banner>
        )}
      </nav>

      {/* Phone-only bottom bar: an app-style floating pill fixed above the
          bottom edge (respecting the iOS home-indicator safe area). Same tabs
          as the top strip, but icon-first with short labels. */}
      <nav className="fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 sm:hidden">
        <div
          className={`mx-auto flex items-stretch rounded-full border border-gray-200/60 bg-white/50 px-1.5 py-1.5 shadow-lg backdrop-blur-xl transition-all duration-300 ease-in-out dark:border-gray-700/60 dark:bg-gray-800/50 ${
            // Scroll down → also pull the pill in horizontally (centered), so it
            // reads as a compact icons-only bar rather than a full-width one.
            bottomBarCompact ? "max-w-xs" : "max-w-md"
          }`}
        >
          {TABS.map((tab, i) => (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => handleTabClick(tab.href)}
              className={bottomTabClassName(tabActive(i, tab.href))}
            >
              <TabIcon d={tab.icon} />
              {/* Labels collapse to nothing on scroll down, leaving icons only. */}
              <span
                className={`overflow-hidden text-[10px] font-medium leading-tight transition-all duration-300 ease-in-out ${
                  bottomBarCompact ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
                }`}
              >
                {tab.mobileLabel}
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

// Tail number chip in the header. With one airplane it's a label; with several
// it becomes a menu, so nothing changes visually until the club grows.
function AircraftChip() {
  const { aircraft, selected, selectAircraft } = useAircraft();
  if (!selected) return null;

  const chip = (
    <span className="hidden rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-xs font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-300 sm:inline-block">
      {selected.tailNumber}
    </span>
  );

  if (!aircraft || aircraft.length < 2) return chip;

  return (
    <Dropdown trigger={chip} align="right">
      {aircraft.map((a) => (
        <button
          key={a.id}
          onClick={() => selectAircraft(a.id)}
          className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
            a.id === selected.id ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""
          }`}
        >
          <span className="font-mono">{a.tailNumber}</span>
          <span className="ml-2 text-xs text-gray-500">{a.model}</span>
        </button>
      ))}
    </Dropdown>
  );
}

// Tab styling: the active tab is filled, inactive tabs are plain.
// `focus:outline-none` drops the ring that otherwise lingers on a clicked tab —
// the filled background is the selection cue instead.
function tabClassName(active: boolean): string {
  const base =
    "relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`;
  }
  return `${base} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`;
}

// Bottom-bar tab styling: stacked icon + label, evenly sharing the pill's
// width. `rounded-full` matches the surrounding pill.
function bottomTabClassName(active: boolean): string {
  const base =
    "flex flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5 transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`;
  }
  return `${base} text-gray-500 dark:text-gray-400`;
}

// Renders one of the outline paths above as a bottom-bar icon.
function TabIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <path d={d} />
    </svg>
  );
}
