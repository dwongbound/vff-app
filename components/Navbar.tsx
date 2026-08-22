"use client";
// A fixed navigation RAIL down the left-hand edge on desktop, and a floating
// bottom bar on phones.
//
// Because the rail is tall rather than wide it can afford icon + label per tab
// and an inline sub-list, so Checkouts EXPANDS in place here instead of
// opening the hover menu the old top strip used. On a phone it still taps open
// a sheet above the pill (touch has no hover to open a menu with).
//
// The order follows a flying day: Plane Status → Checkouts → Flight Log →
// Reservations → Finances. Reservations is styled as a call-to-action rather
// than a tab: booking the airplane is what most people came to do.
//
// Members and Club settings are deliberately NOT tabs — the roster and the
// club's configuration are about people and admin, not about flying, so they
// hang off the avatar menu in the top bar, next to "My profile".
//
// The rail carries ONLY the tabs. Everything about you rather than about
// flying — the club's name, who's signed in, which airplane, the theme, the
// tour — sits in the `<header>` bar, which spans the FULL window width with
// the rail hanging beneath it. That split is what keeps the rail readable as a
// plain list of destinations. The bar's height is published as
// `--app-header-h`, which is also what the rail offsets its top by.
//
// Below `md` there is no rail: a phone can't spare 15rem for navigation, so it
// gets the floating bottom pill instead and can swipe left/right between pages.
// The gesture lives in SwipePager and walks the flattened tab list, so a swipe
// still reaches every checkout even though they share one pill tab.
// Tablets are above `md` and get the desktop layout.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import Banner from "./common/Banner";
import Dropdown, { useLatchDropdown } from "./common/Dropdown";
import Logo from "./Logo";
import { useAircraft } from "./AircraftProvider";
import { useMe } from "./MeProvider";
import { useBeginNavigation } from "./LoadingProvider";
import { useSwipe } from "./SwipeProvider";
import { sendJson } from "@/lib/api";
import { appScrollTop } from "@/lib/appScroll";
import { setNavDirection } from "@/lib/navDirection";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import { CLUB_NAME, CLUB_SHORT_NAME } from "@/lib/constants";
import type { Capability } from "@/lib/positions";

// Outline icon paths (24×24 heroicons) for the bottom bar tabs.
const CLIPBOARD_ICON =
  "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z";
const GAUGE_ICON =
  "M12 6v2.25m0 0a5.25 5.25 0 105.25 5.25M12 8.25a5.25 5.25 0 00-5.25 5.25m10.5 0h1.5M4.5 13.5H3m14.03-6.03l1.06-1.06M6.91 7.47L5.85 6.41M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
const BOOK_ICON =
  "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25";
const CALENDAR_ICON =
  "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5";
const MONEY_ICON =
  "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
const WRENCH_ICON =
  "M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.25 5.25A2.652 2.652 0 003 3l3 3v.75";
// A fuel pump, for the servicing entry.
const FUEL_ICON =
  "M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.007-1.875 2.25-1.875s2.25.84 2.25 1.875c0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z";
const PLANE_ICON =
  "M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5";
// Taxi & Runway: the departing-aircraft glyph, for the checkout that ends at the
// hold-short line.
const RUNWAY_ICON =
  "M3.75 19.5h16.5M4.5 15.75l3.75-1.5m0 0 8.379-3.352a2.25 2.25 0 1 0-1.671-4.177L3.75 11.25l1.5 3.75 3-1.5Zm0 0 2.25 4.5";
const CALCULATOR_ICON =
  "M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z";
// A balance scale, for weight & balance — the one tool where the icon is
// simply a picture of the arithmetic.
// A lightning bolt, for Quick Log — the fast way into the flight log.
const BOLT_ICON =
  "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z";
// An ID card, for My plane: the airplane's own spec sheet.
const ID_CARD_ICON =
  "M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z";
const SCALE_ICON =
  "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z";

interface NavLeaf {
  href: string;
  label: string;
  mobileLabel: string;
  icon: string;
  /**
   * Render this leaf as an ACTION rather than as a destination: pinned to the
   * foot of the rail, under a divider, drawn as a filled button.
   *
   * The app spent a while with NO permanently-tinted tab, on the reasoning
   * that a tab which looks the same on every page stops being a signal and
   * competes with the one mark that actually changes — which tab you're on.
   * That reasoning is why this is not simply "a coloured tab in the list": a
   * pinned button is a different KIND of thing from the tabs above it, sitting
   * apart from them, so it can be permanently coloured without competing to be
   * read as the current page. The list above stays a plain list of
   * destinations with exactly one mark on it.
   *
   * Quick Log has it because it is the one entry that is a verb. Everything
   * else in the rail is a place you go to look at something; this one does a
   * job and returns you to what you were doing — and it is wanted at the
   * moment you are NOT already thinking about the app, walking back to the car
   * with a tach reading in your head, so it has to be visible without being
   * hunted for.
   */
  action?: boolean;
}

interface NavGroup {
  label: string;
  mobileLabel: string;
  icon: string;
  children: NavLeaf[];
}

type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => "children" in item;

// Tab order matches the order of a flying day: what's the airplane doing, get
// ready, write it up, book the next one, settle up.
//
// Plane Status leads because it answers "can I go flying" without opening
// anything else. The three checkouts are one entry — they're the same job at
// three points in the flight, and collapsing them keeps the bar short enough
// for a phone. Members lives in the avatar menu: it's the roster, not flying.
//
// Finances is shown to every member who HAS a statement — which is everyone
// who flies here. What differs between them is what the page returns, and the
// API decides that; the tab isn't a permission. The one account it's hidden
// from is the instructor who teaches here without being a member: nothing
// bills them, so the tab could only ever say "nothing here". That's the job of
// `NAV_REQUIRES` below rather than a branch in the render, so the swipe order
// and the bottom pill can't disagree with the rail about which tabs exist.
const NAV: NavItem[] = [
  {
    label: "Plane Status",
    mobileLabel: "Status",
    icon: PLANE_ICON,
    children: [
      { href: "/status", label: "Overview", mobileLabel: "Overview", icon: PLANE_ICON },
      { href: "/status/squawks", label: "Squawks", mobileLabel: "Squawks", icon: WRENCH_ICON },
      // What the airplane is DUE for, as opposed to what's wrong with it. Next
      // to Squawks because the two are read by the same person on the same
      // morning, and `isActive` uses the longest matching href, so a nested
      // route can't light two entries at once.
      { href: "/status/maintenance", label: "Maintenance", mobileLabel: "Mx", icon: GAUGE_ICON },
    ],
  },
  {
    label: "Checkouts",
    mobileLabel: "Checks",
    icon: CLIPBOARD_ICON,
    children: [
      { href: "/preflight", label: "Preflight", mobileLabel: "Preflight", icon: CLIPBOARD_ICON },
      { href: "/runway", label: "Taxi & Runway", mobileLabel: "Taxi", icon: RUNWAY_ICON },
      { href: "/postflight", label: "Post-flight", mobileLabel: "Post", icon: GAUGE_ICON },
      // Not a checkout — nothing is ticked and nothing is signed off — but it
      // belongs here anyway: it's the other thing you do standing at the
      // airplane, and a member looking for "where do I record the fuel I just
      // put in" looks where the before/after-flight jobs are. It files on its
      // own, without a flight (see app/servicing/page.tsx).
      { href: "/servicing", label: "Add Fuel", mobileLabel: "Fuel", icon: FUEL_ICON },
    ],
  },
  // Tools sits between getting ready and writing it up because that's when it
  // gets used: weight & balance is worked out at the table with the load in
  // front of you, before the walkaround, and re-worked when someone turns up
  // with an extra bag. A GROUP with one entry today rather than a plain tab —
  // the planning arithmetic a club does isn't only W&B (a runway/density
  // altitude sheet is the obvious next one), and promoting a leaf to a group
  // later would move a link people had already learned.
  {
    label: "Tools",
    mobileLabel: "Tools",
    icon: CALCULATOR_ICON,
    children: [
      {
        href: "/tools/weight-balance",
        label: "Weight & Balance",
        mobileLabel: "W&B",
        icon: SCALE_ICON,
      },
      // The airplane's own manual, as numbers. A tool rather than a Plane
      // Status tab because it never changes: Status answers "what is the
      // airplane doing today", and a stall speed is true of the TYPE and was
      // true in 1958.
      {
        href: "/tools/my-plane",
        label: "My plane",
        mobileLabel: "Plane",
        icon: ID_CARD_ICON,
      },
    ],
  },
  { href: "/log", label: "Flight Log", mobileLabel: "Log", icon: BOOK_ICON },
  { href: "/reservations", label: "Reservations", mobileLabel: "Reserve", icon: CALENDAR_ICON },
  { href: "/finances", label: "Finances", mobileLabel: "Money", icon: MONEY_ICON },
  // LAST, and drawn as a button pinned to the foot of the rail rather than as
  // another row in the list — see `action` on NavLeaf. It is the shortest path
  // through the app (four meter readings and a button), and the one entry here
  // that DOES something rather than showing you something, so it reads better
  // as a control under the menu than as a destination inside it.
  //
  // Last in the array rather than positioned by the renderer, because the
  // SWIPE PAGER walks this list in order: a phone swiping right off Finances
  // should arrive at Quick Log, and a tab pinned visually to the bottom while
  // sitting first in the route order would swipe from the wrong neighbour.
  {
    href: "/quick-log",
    label: "Quick Log",
    mobileLabel: "Quick",
    icon: BOLT_ICON,
    action: true,
  },
];

/**
 * Tabs that need a capability, by href. Anything absent is shown to everyone.
 *
 * Keyed on the LEAF href so a group is filtered child by child — hiding a whole
 * group would be a different decision, and no group needs it today.
 */
const NAV_REQUIRES: Record<string, Capability> = {
  "/finances": "finance:read-own",
};

/** The nav as this member sees it, with the tabs they can't use removed. */
function navFor(capabilities: Capability[]): NavItem[] {
  const allowed = (leaf: NavLeaf) => {
    const needed = NAV_REQUIRES[leaf.href];
    return !needed || capabilities.includes(needed);
  };
  return NAV.flatMap<NavItem>((item) => {
    if (!isGroup(item)) return allowed(item) ? [item] : [];
    const children = item.children.filter(allowed);
    // A group with every child filtered out disappears with them, rather than
    // becoming a menu that opens onto nothing.
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

// Reservations used to carry a tint of its own here, as the app's call to
// action. It doesn't any more: a tab that is permanently coloured says the same
// thing on every page, so it stops being a signal and competes with the ONE
// mark that actually changes — which tab you're on. Every tab now looks the
// same until it's the current one.

// The theme modes, named. "System" is last because it's the default: the list
// reads as "pick one, or hand it back to the OS".
const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * The `data-tour` name for a tab — what GuidedTour looks up when it wants to
 * spotlight the real control instead of describing it. Derived from the href
 * ("/preflight" → "preflight") so a tab can never carry a stale hand-written
 * key, and stamped on BOTH the rail and the bottom pill: the tour just takes
 * whichever one is actually on screen.
 */
const tourKey = (href: string) => href.replace(/^\//, "");

/** A group's spotlight key, derived from its label the same way. */
const groupTourKey = (group: NavGroup) =>
  group.label.toLowerCase().replace(/[^a-z]+/g, "-");

/**
 * The one route a path is "on", by LONGEST match.
 *
 * Plain `startsWith` would light up both Overview (`/status`) and Squawks
 * (`/status/squawks`) when you're on the latter, because one href is a prefix
 * of the other. Taking the longest match instead of special-casing that pair
 * means a future nested route can't reintroduce the bug.
 */
function bestRoute(pathname: string, routes: NavLeaf[]): string | null {
  let best: string | null = null;
  for (const route of routes) {
    if (pathname === route.href || pathname.startsWith(route.href + "/")) {
      if (!best || route.href.length > best.length) best = route.href;
    }
  }
  return best;
}

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { selected } = useAircraft();
  const { me, setMe } = useMe();
  const [theme, setTheme] = useState<Theme>("system");
  // Href of the tab just clicked, so it highlights immediately instead of
  // waiting for `pathname` to update after the new page mounts.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [groundedDismissed, setGroundedDismissed] = useState(false);
  // The phone-only group sheet (a group can't hover on touch). Holds the LABEL
  // of the open group rather than a boolean: there is more than one group in
  // the pill now, and a shared boolean would open both at once.
  const [openSheet, setOpenSheet] = useState<string | null>(null);
  // Rail sub-lists the member has explicitly opened or collapsed, by group
  // label. Absent = "not touched", and the DEFAULT is then derived from where
  // you are (see `groupExpanded`) rather than being "always open": with two
  // groups in the rail, expanding both meant five child links on screen at all
  // times, four of which were about somewhere you aren't.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Published as the `--app-header-h` CSS var so full-height pages (the
  // reservation calendar) can size themselves to the space left over — which
  // grows and shrinks as banners appear/dismiss, and is simply 0 on a desktop
  // now that the tabs are down the side.
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
  //
  // Position comes from the content column, not `window.scrollY`: the document
  // itself never scrolls (see lib/appScroll.ts), so window.scrollY is a
  // constant 0 and this bar would never compact. `capture: true` for the same
  // reason — scroll events don't bubble, but they do capture, so one window
  // listener still sees the inner scroller move.
  useEffect(() => {
    let lastY = appScrollTop();
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = appScrollTop();
        const delta = y - lastY;
        if (y < 40) setBottomBarCompact(false);
        else if (delta > 8) setBottomBarCompact(true);
        else if (delta < -8) setBottomBarCompact(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true });
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

  // The settings menu names all three modes rather than cycling through them:
  // a single button that rotates light → dark → system never tells you what the
  // next press will do, and "system" in particular is invisible until you land
  // on it.
  const chooseTheme = (next: Theme) => {
    storeTheme(next);
    applyTheme(next);
    setTheme(next);
  };

  const grounded = selected?.groundingSquawks ?? [];

  // The nav this member actually gets. While `me` is still loading we show the
  // full set: a tab that appears a beat after the rest is a flicker, whereas
  // one that's briefly there and then vanishes looks like a bug — and the
  // pages behind them re-check on the server anyway.
  const nav = me ? navFor(me.capabilities) : NAV;
  const routes = nav.flatMap((item) => (isGroup(item) ? item.children : [item]));
  // The rail draws these in two blocks: the menu, and the action buttons
  // pinned under it. `routes` above is deliberately built from the WHOLE nav
  // first, so the swipe order and the tab list are unaffected by where a leaf
  // happens to be drawn.
  const isAction = (item: NavItem): item is NavLeaf =>
    !isGroup(item) && item.action === true;
  const menuItems = nav.filter((item) => !isAction(item));
  const actionItems = nav.filter(isAction);

  // Shared by both nav bars: is this tab the highlighted one, and what to do
  // on click. Prefer the just-clicked tab so selection is instant; fall back
  // to the real route once navigation completes.
  const isActive = (href: string) =>
    pendingHref ? pendingHref === href : bestRoute(pathname, routes) === href;

  // "Replay the tour": clear the seen-stamp and let GuidedTour notice. Updating
  // the shared profile is what re-opens it, so there's no second flag to keep
  // in step.
  const replayTour = async () => {
    setMe(me ? { ...me, tourSeenAt: null } : me);
    await sendJson("/api/me", "PATCH", { tourSeen: false });
  };

  const handleTabClick = (href: string) => {
    // Show the shared loader and highlight the clicked tab the instant it's
    // clicked, before the next page mounts.
    if (pathname !== href) {
      setPendingHref(href);
      beginNavigation();
    }
  };

  // Swiping walks the FLAT route list, not the nav's top level: the checkouts
  // are grouped under one menu but are still separate pages, and a swipe
  // should reach them.
  const routeIndex = (href: string) => routes.findIndex((r) => r.href === href);
  const leafActive = (href: string) =>
    previewIndex != null ? previewIndex === routeIndex(href) : isActive(href);
  const itemActive = (item: NavItem) =>
    isGroup(item)
      ? item.children.some((c) => leafActive(c.href))
      : leafActive(item.href);

  // Feed the swipe handler the current tab order, active tab, and a navigate
  // fn (same optimistic highlight + loader a tab tap gets, then a real push).
  tabHrefsRef.current = routes.map((t) => t.href);
  activeIndexRef.current = Math.max(
    0,
    routes.findIndex((t) => isActive(t.href))
  );
  navigateRef.current = (href) => {
    // Tell SwipePager which way the content should slide: swiping to a
    // right-hand tab slides the new page in from the right, and vice versa.
    const to = tabHrefsRef.current.indexOf(href);
    setNavDirection(Math.sign(to - activeIndexRef.current));
    handleTabClick(href);
    router.push(href);
  };

  // Open when it holds the page you're on; closed otherwise. An explicit tap
  // on the group header still wins — that's what the `??` is for — so you can
  // go browsing in another group's list without being yanked back.
  const groupExpanded = (item: NavGroup) =>
    openGroups[item.label] ?? item.children.some((c) => isActive(c.href));

  // The avatar menu's contents, shared by the rail and the phone top bar.
  const accountMenu = session?.user && (
    <>
      <Link
        href="/profile"
        className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        My profile
      </Link>
      {/* The roster is about people, not flying, so it lives with the rest of
          the "about me and the club" entries. */}
      <Link
        href="/members"
        onClick={() => handleTabClick("/members")}
        className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        Members
      </Link>
      {/* Club-wide configuration, so it only appears for admins. The page and
          every write behind it re-check on the server. */}
      {session.user.isAdmin && (
        <Link
          href="/settings"
          className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Club settings
        </Link>
      )}
      {/* Replaying the tour has its own button in the top bar now, so it's not
          repeated here. */}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        Log out
      </button>
    </>
  );

  // The gear is a menu OF SETTINGS, not a theme switcher that happens to look
  // like one. Theme is the only entry today, so it could have been the whole
  // menu — but then the first setting we add reshapes the thing people have
  // learned, and "the gear opens the theme list" is a habit worth not
  // breaking. A named row with its current value on the right and a submenu
  // behind it is a shape that takes a second and a third entry for free.
  const settingsMenu = (
    <Dropdown
      align="right"
      menuClassName=""
      trigger={
        <span
          aria-label="Settings"
          title="Settings"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <CogIcon />
        </span>
      }
    >
      <ThemeSubmenu theme={theme} onChoose={chooseTheme} />
    </Dropdown>
  );

  // Re-opening the tour is a deliberate, occasional act, so it gets a plain
  // icon button rather than a line buried in the account menu.
  const tourButton = (
    <button
      onClick={replayTour}
      aria-label="Replay the guided tour"
      title="Replay the guided tour"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      <HelpIcon />
    </button>
  );

  return (
    <>
      {/* ── Desktop: the left-hand rail ─────────────────────────────────────
          Hangs BELOW the full-width top bar rather than beside it, so the bar
          reads as the app's roof and the rail as one column under it. That's
          what `top-[var(--app-header-h)]` is doing: the same live measurement
          the pages use, so the rail's top edge tracks the bar as banners come
          and go. Matched by `md:pl-60` on the content column in AppShell so no
          page ever runs underneath it. */}
      <aside
        className="fixed bottom-0 left-0 z-30 hidden w-60 flex-col border-r border-gray-200 bg-white md:flex dark:border-gray-700 dark:bg-gray-800"
        style={{ top: "var(--app-header-h)" }}
      >
        <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-4">
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Menu
          </p>
          <div className="flex flex-col gap-1">
            {menuItems.map((item) => {
              if (isGroup(item)) {
                const expanded = groupExpanded(item);
                return (
                  <div key={item.label}>
                    <button
                      onClick={() =>
                        setOpenGroups((g) => ({ ...g, [item.label]: !expanded }))
                      }
                      aria-expanded={expanded}
                      data-tour={groupTourKey(item)}
                      className={`${railClassName(
                        item.children.some((c) => isActive(c.href))
                      )} w-full`}
                    >
                      <TabIcon d={item.icon} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <Chevron open={expanded} />
                    </button>
                    {expanded && (
                      // Indented under the parent, with a hairline connecting
                      // the children to it — the rail's only nesting.
                      <div className="ml-5 mt-1 flex flex-col gap-1 border-l border-gray-200 pl-3 dark:border-gray-700">
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => handleTabClick(child.href)}
                            data-tour={tourKey(child.href)}
                            className={railChildClassName(isActive(child.href))}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => handleTabClick(item.href)}
                  data-tour={tourKey(item.href)}
                  className={railClassName(isActive(item.href))}
                >
                  <TabIcon d={item.icon} />
                  <span className="flex-1 text-left">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* ── Pinned actions ────────────────────────────────────────────────
            Below the menu and outside the scrolling <nav>, so they stay put at
            the foot of the rail however long the list above them gets.

            Drawn as filled buttons rather than tabs, which is what lets them
            be permanently coloured without competing with the ONE mark that
            says which page you're on: a button under a divider is a different
            kind of thing from the rows above it, so a reader doesn't have to
            work out whether the colour means "current". Being the current page
            is still shown — the ring — but it's a second-order mark on a
            control rather than the primary one on a list. */}
        {actionItems.length > 0 && (
          <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">
            {actionItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => handleTabClick(item.href)}
                data-tour={tourKey(item.href)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={railActionClassName(isActive(item.href))}
              >
                <TabIcon d={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        )}
      </aside>

      {/* ── The top bar ─────────────────────────────────────────────────────
          Spans the whole window at every size — it is a sibling of the content
          column in AppShell, not inside it, which is what lets the rail sit
          UNDER it rather than beside it. The club's name anchors the left end,
          the controls and then your own avatar run along the right. No tabs
          ever appear here; those belong to the rail (or the bottom pill). Its
          height is what `--app-header-h` publishes. */}
      <header ref={navRef} className="sticky top-0 z-40">
        {/* `1fr auto 1fr` is what actually centres the airplane: equal side
            columns mean the middle one is centred in the window no matter how
            long the club's name or how many controls are on the right. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800">
          <Link
            href="/status"
            onClick={() => handleTabClick("/status")}
            className="flex min-w-0 items-center gap-2.5 justify-self-start"
          >
            <Logo className="h-9 w-9 shrink-0" />
            {/* The full name once there's room for it; the initials otherwise. */}
            <span className="truncate text-sm font-semibold">
              <span className="hidden md:inline">{CLUB_NAME}</span>
              <span className="md:hidden">{CLUB_SHORT_NAME}</span>
            </span>
          </Link>

          {/* Which airplane every tab is talking about — the one fact the whole
              app is relative to, so it sits dead centre rather than filed away
              with the controls. */}
          <AircraftChip />

          <div className="flex shrink-0 items-center gap-2 justify-self-end">
            {tourButton}
            {settingsMenu}

            {session?.user && (
              <Dropdown
                align="right"
                trigger={(open) => (
                  <span
                    data-tour="account"
                    className="flex min-w-0 items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                      {(session.user.name ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="hidden truncate text-sm font-medium sm:block">
                      {session.user.name}
                    </span>
                    <Chevron open={open} />
                  </span>
                )}
              >
                {accountMenu}
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
            // The squawk sheet, which is where a grounding is read and lifted.
            // It used to point at the flight log, which carried a second copy
            // of the list; that copy is gone, and this is the page that owns
            // the answer to "why is it grounded and who is fixing it".
            href="/status/squawks"
            onLinkClick={() => handleTabClick("/status/squawks")}
            onDismiss={() => setGroundedDismissed(true)}
          >
            <span className="font-semibold">
              {selected?.tailNumber} is grounded:
            </span>{" "}
            {grounded.map((s) => s.title).join(", ")}. Do not fly until it&rsquo;s
            signed off.
          </Banner>
        )}
      </header>

      {/* Phone-only bottom bar: an app-style floating pill fixed above the
          bottom edge (respecting the iOS home-indicator safe area). Same tabs
          as the top strip, but icon-first with short labels. */}
      <nav className="fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 md:hidden">
        <div
          className={`mx-auto flex items-stretch rounded-full border border-gray-200/60 bg-white/50 px-1.5 py-1.5 shadow-lg backdrop-blur-xl transition-all duration-300 ease-in-out dark:border-gray-700/60 dark:bg-gray-800/50 ${
            // Scroll down → also pull the pill in horizontally (centered), so it
            // reads as a compact icons-only bar rather than a full-width one.
            bottomBarCompact ? "max-w-xs" : "max-w-md"
          }`}
        >
          {nav.map((item) => {
            const active = itemActive(item);
            const label = (
              // Labels collapse to nothing on scroll down, leaving icons only.
              <span
                className={`overflow-hidden text-[10px] font-medium leading-tight transition-all duration-300 ease-in-out ${
                  bottomBarCompact ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
                }`}
              >
                {item.mobileLabel}
              </span>
            );

            // A group can't hover on a phone, so it taps open a sheet above the
            // bar. The sheet is rendered HERE, inside the tab it belongs to,
            // and centred on it: a menu is an answer to the thing you just
            // touched, so it has to come out of that thing. Centred on the
            // whole pill instead — which is what this did — it appeared over
            // the middle of the bar with no relationship to the tab under the
            // thumb, and on a five-tab pill that's a different tab entirely.
            if (isGroup(item)) {
              const sheetOpen = openSheet === item.label;
              return (
                <div key={item.label} className="relative flex flex-1">
                  <button
                    onClick={() =>
                      setOpenSheet((open) => (open === item.label ? null : item.label))
                    }
                    aria-expanded={sheetOpen}
                    data-tour={groupTourKey(item)}
                    className={bottomTabClassName(active)}
                  >
                    <TabIcon d={item.icon} />
                    {label}
                  </button>

                  {sheetOpen && (
                    <div
                      // `max-w` rather than a plain width: centred on a tab near
                      // the edge of a 402px phone, a fixed 12rem would hang off
                      // the screen. The pill is already inset 1rem each side.
                      className="absolute bottom-full left-1/2 mb-2 w-48 max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-fade-in-up rounded-xl border border-gray-200/60 bg-white/90 p-1 shadow-lg backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-800/90"
                      role="menu"
                    >
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => {
                            setOpenSheet(null);
                            handleTabClick(child.href);
                          }}
                          data-tour={tourKey(child.href)}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                            leafActive(child.href)
                              ? "bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300"
                              : "hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          <TabIcon d={child.icon} />
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  setOpenSheet(null);
                  handleTabClick(item.href);
                }}
                data-tour={tourKey(item.href)}
                className={bottomTabClassName(active, item.action)}
              >
                <TabIcon d={item.icon} />
                {label}
              </Link>
            );
          })}
        </div>

      </nav>
    </>
  );
}

// The theme list, hanging off the settings menu's "Select theme" row.
//
// It flies out to the RIGHT, the direction a submenu's chevron promises and
// the direction every desktop menu opens. The gear does sit near the right
// edge of the top bar, so on a narrow window there isn't always room — the
// side is measured when the submenu opens and flips to the left only when the
// list would otherwise run off screen, with the chevron turning to match.
//
// Hover opens it, a click LATCHES it (and its parent, which would otherwise
// close under it the moment the pointer left) until a theme is chosen or the
// click lands outside — the same bargain `Dropdown` itself strikes.
//
// It also has to strike the same bargain about GETTING there. The gap between
// the row and the list is PADDING on a positioned wrapper, never a margin on
// the list: a margin belongs to neither element, so the pointer sliding across
// it is briefly over nothing, `mouseleave` fires, and the list you were
// reaching for vanishes. The deferred close is the second half of that — a
// clipped corner on the way across shouldn't shut it either.
const THEME_MENU_W = 144; // w-36
const THEME_MENU_GAP = 4; // pl-1 / pr-1 on the wrapper — see above
const WINDOW_MARGIN = 8;
// Matches Dropdown's own grace period, for the same reason.
const SUBMENU_CLOSE_DELAY_MS = 120;

function ThemeSubmenu({
  theme,
  onChoose,
}: {
  theme: Theme;
  onChoose: (next: Theme) => void;
}) {
  const [open, setOpen] = useState(false);
  const [latched, setLatched] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const rowRef = useRef<HTMLDivElement>(null);
  const latchParent = useLatchDropdown();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), SUBMENU_CLOSE_DELAY_MS);
  };
  // Don't leave a timer running after the row unmounts with the parent menu.
  useEffect(() => cancelClose, []);

  // Measured as it opens rather than after: a layout effect would be a second
  // pass, and the answer can't change while the list is on screen.
  const openMenu = () => {
    cancelClose();
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) {
      const fits =
        rect.right + THEME_MENU_GAP + THEME_MENU_W <=
        window.innerWidth - WINDOW_MARGIN;
      setSide(fits ? "right" : "left");
    }
    setOpen(true);
  };

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={() => {
        if (!latched) scheduleClose();
      }}
    >
      <button
        // The parent menu closes on any click inside it — that's right for a
        // menu item, wrong for the thing that opens a submenu.
        onClick={(e) => {
          e.stopPropagation();
          if (latched) {
            setLatched(false);
            setOpen(false);
            return;
          }
          latchParent();
          setLatched(true);
          openMenu();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <span className="flex-1">Select theme</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {THEMES.find((t) => t.value === theme)?.label}
        </span>
        <ChevronRight flipped={side === "left"} />
      </button>

      {open && (
        // The gap is PADDING on this wrapper, so it's still part of the
        // submenu's hit area — the pointer crosses it without ever being over
        // nothing. `ml-1` here instead would be the dead zone that made this
        // list impossible to reach.
        <div
          className={`absolute top-0 ${
            side === "right" ? "left-full pl-1" : "right-full pr-1"
          }`}
          onMouseEnter={cancelClose}
        >
          <div
            role="menu"
            className="w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
          {THEMES.map((option) => (
            <button
              key={option.value}
              onClick={() => onChoose(option.value)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                theme === option.value
                  ? "font-semibold text-indigo-600 dark:text-indigo-400"
                  : ""
              }`}
            >
              <span aria-hidden="true" className="w-4 text-center">
                {theme === option.value ? "✓" : ""}
              </span>
              {option.label}
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The airplane the whole app is talking about, centred in the top bar.
//
// A one-airplane club sees a plain chip — a menu you can't choose anything
// from is a lie — and it grows a caret the moment there's a second airframe.
// Either way the tail number is the loud part and the model is the quiet part
// beneath it, because the tail is what members say to each other.
function AircraftChip() {
  const { aircraft, selected, selectAircraft } = useAircraft();
  // No airplane yet (a brand-new club, or the fleet still loading): render an
  // EMPTY CELL rather than nothing. The header is a three-column grid whose
  // outer `1fr`s are what centre the chip, and returning null here leaves only
  // two children — grid auto-placement then slides the account controls into
  // the middle column and they stop being right-aligned.
  if (!selected) return <span aria-hidden />;

  const hasChoice = Boolean(aircraft && aircraft.length > 1);

  const chip = (
    <span
      className={`flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-1.5 dark:border-gray-600 ${
        hasChoice ? "hover:bg-gray-100 dark:hover:bg-gray-700" : ""
      }`}
    >
      <PlaneMark />
      <span className="flex flex-col items-start leading-tight">
        {/* The airplane's name, not a code to transcribe — so the signage face
            with a touch of tracking, the way it's painted on the tail, rather
            than the mono this used to be. */}
        <span className="text-sm font-semibold tracking-wide text-gray-800 dark:text-gray-100">
          {selected.tailNumber}
        </span>
        <span className="max-w-[9rem] truncate text-[10px] text-gray-500 dark:text-gray-400">
          {selected.model}
        </span>
      </span>
      {hasChoice && <Chevron open={false} />}
    </span>
  );

  if (!hasChoice) return chip;

  return (
    <Dropdown trigger={chip} align="right" menuClassName="w-56 overflow-hidden">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Airplane
      </p>
      {aircraft!.map((a) => {
        const current = a.id === selected.id;
        return (
          <button
            key={a.id}
            onClick={() => selectAircraft(a.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 ${
              current ? "bg-indigo-50 dark:bg-indigo-900/30" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-4 shrink-0 text-center text-sm ${
                current ? "text-indigo-600 dark:text-indigo-400" : "text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={`text-sm tracking-wide ${
                  current
                    ? "font-semibold text-indigo-700 dark:text-indigo-300"
                    : "font-medium"
                }`}
              >
                {a.tailNumber}
              </span>
              <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                {a.model}
              </span>
            </span>
          </button>
        );
      })}
    </Dropdown>
  );
}

/** The little airplane on the tail-number chip. */
function PlaneMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
    >
      <path d={PLANE_ICON} />
    </svg>
  );
}

// Rail tab styling.
//
// The SOLID fill belongs to wherever you are, not to Reservations. A permanent
// filled button shouts the same thing on every page, so it stops being a
// signal and starts competing with the one mark that actually changes — and on
// a page whose whole job is "where am I", the loudest thing on screen should
// be the answer. Reservations keeps a soft tint instead (see below): still set
// apart from the plain tabs, no longer the brightest thing in the rail.
//
// `focus:outline-none` drops the ring that otherwise lingers on a clicked tab —
// the fill is the selection cue instead.
function railClassName(active: boolean): string {
  const base =
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700`;
  }
  return `${base} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`;
}

/**
 * A pinned action at the foot of the rail — Quick Log today.
 *
 * CENTRED, full width and OUTLINED, which is what makes it read as a button
 * rather than as another left-aligned row of the menu above it. The shape is
 * doing the work here, not the colour.
 *
 * Deliberately QUIETER than an active tab. A solid fill was the first version
 * and it was wrong: the loudest thing in the rail has to be the one mark that
 * changes — which page you're on — and a permanent block of solid indigo at
 * the bottom out-shouted it on every screen. So this is a tint and a border
 * against the active tab's solid fill, which leaves the two unambiguous when
 * they're both on screen and keeps the button legible when they're not.
 *
 * Being the current page deepens the tint one step rather than filling it in:
 * "you are here" is a smaller thing to say about a control than about a list,
 * and the button is already the only outlined thing in the column.
 */
function railActionClassName(active: boolean): string {
  const base =
    "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none";
  if (active) {
    return `${base} border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-500/60 dark:bg-indigo-500/25 dark:text-indigo-200`;
  }
  return `${base} border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20`;
}

// A page nested under a rail group. No icon: the parent's icon already stands
// for the pair, and repeating it at the same size would flatten the nesting
// the indent is there to show.
function railChildClassName(active: boolean): string {
  const base =
    "rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`;
  }
  return `${base} text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700`;
}

// Bottom-bar tab styling: stacked icon + label, evenly sharing the pill's
// width. `rounded-full` matches the surrounding pill.
function bottomTabClassName(active: boolean, action = false): string {
  const base =
    "flex flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5 transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-indigo-600 text-white shadow-sm`;
  }
  // A phone has no rail to pin a button under, so an `action` leaf stays a tab
  // here and carries the tint instead. It is the last tab, which is the same
  // place it sits in the rail — and a phone is where Quick Log gets used most,
  // so dropping it from the pill to keep the bar short would cut it off from
  // the people most likely to want it.
  if (action) {
    return `${base} bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300`;
  }
  return `${base} text-gray-500 dark:text-gray-400`;
}

/** Points into a submenu — the way it actually opens. */
function ChevronRight({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 text-gray-400 ${flipped ? "rotate-180" : ""}`}
    >
      <path d="M8 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The settings gear. */
function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

/** Re-open the guided tour. */
function HelpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
    </svg>
  );
}

/** The little caret on a nav group, rotating when its menu is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
