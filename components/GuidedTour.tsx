"use client";
// A one-time walk through the app, for a member's first sign-in.
//
// Each step SPOTLIGHTS the real control it's describing: the page dims, a hole
// is cut around the live element, and the card is placed beside it. Pointing at
// the thing beats naming it — "Reservations" means nothing until you've seen
// where Reservations is.
//
// Anchoring to live coordinates is only safe because nothing here is
// hand-positioned. Every step names a `data-tour` key that the nav stamps on
// BOTH the desktop rail and the phone pill (see `tourKey` in Navbar.tsx), the
// step takes whichever copy is currently on screen, and the card places itself
// from that element's measured rect. A key that matches nothing visible — the
// checkouts are behind a tap on a phone — falls back to the next key in the
// list, and a step with no visible target at all just centres its card. So a
// layout change moves the highlight instead of stranding it.
//
// "Seen" lives on the User row (see /api/me), not in localStorage, so it
// follows the member to their phone and doesn't reset when a browser is
// cleared. It's marked seen whether they finish OR skip — both mean "don't
// show me this again" — and the top bar's (?) can replay it on demand.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// useLayoutEffect warns during SSR; fall back to useEffect on the server (the
// pre-paint measurement it buys us only matters on the client anyway). Same
// shim as SwipePager.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import Button from "@/components/common/Button";
import { useMe } from "@/components/MeProvider";
import { sendJson } from "@/lib/api";
import { CLUB_NAME } from "@/lib/constants";

interface Step {
  /**
   * `data-tour` keys to spotlight, best first. More than one because a control
   * can be reachable in different places at different widths — Preflight is a
   * rail entry on a desktop but lives behind the pill's Checkouts tap on a
   * phone, where the group itself is the honest thing to point at.
   */
  targets?: string[];
  /** Where this lives, for the card's eyebrow. */
  where: string | null;
  title: string;
  body: string;
  icon: string;
}

// 24x24 heroicon outline paths, matching the ones in the nav bar.
const ICONS = {
  wave: "M12 2.25a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0Z",
  clipboard:
    "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
  gauge:
    "M12 6v2.25m0 0a5.25 5.25 0 105.25 5.25M12 8.25a5.25 5.25 0 00-5.25 5.25m10.5 0h1.5M4.5 13.5H3m14.03-6.03l1.06-1.06M6.91 7.47L5.85 6.41M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  book: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
  calendar:
    "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
  people:
    "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  money:
    "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  check: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  scale:
    "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z",
  runway:
    "M3.75 19.5h16.5M4.5 15.75l3.75-1.5m0 0 8.379-3.352a2.25 2.25 0 1 0-1.671-4.177L3.75 11.25l1.5 3.75 3-1.5Zm0 0 2.25 4.5",
} as const;

const STEPS: Step[] = [
  {
    where: null,
    icon: ICONS.wave,
    title: `Welcome to ${CLUB_NAME}`,
    body: "Eight pages, in the order of a flying day: get ready, go fly, write it up, and settle up. I'll point at each one — about a minute.",
  },
  {
    targets: ["preflight", "checkouts"],
    where: "Checkouts",
    icon: ICONS.clipboard,
    title: "Preflight checkout",
    body: "N8318B's own preflight card: I'M SAFE, the homework, the consumables, the cockpit, and the walk around the airplane. Tap a row to tick it; tap the (i) beside it to learn why the item is on the card. Complete it when you're done — the club has a record that you walked it.",
  },
  {
    targets: ["runway", "checkouts"],
    where: "Checkouts",
    icon: ICONS.runway,
    title: "Runway checkout",
    body: "The other card, from sitting down to holding short: passengers, before start, the cold-start pre-lube, the start, the runup and pre-takeoff. Its own sign-off, because it's usually walked a while after the airplane was.",
  },
  {
    targets: ["postflight", "checkouts"],
    where: "Checkouts",
    icon: ICONS.gauge,
    title: "Post-flight",
    body: "File the flight when you get back: tach and Hobbs, landings, fuel and oil, and the turn-off checkout. Filing is what advances the airplane's meters for the next pilot — and what bills the flight.",
  },
  {
    targets: ["tools/weight-balance", "tools"],
    where: "Tools",
    icon: ICONS.scale,
    title: "Weight & balance",
    body: "N8318B's empty weight is already in it, off its latest signed revision — put the people, bags and fuel in and it does the rest. It checks where you LAND as well as where you take off (the tanks are behind the CG, so every flight drifts forward as it burns), and tells you how much more each seat will take.",
  },
  {
    targets: ["log"],
    where: "Flight Log",
    icon: ICONS.book,
    title: "Flight log",
    body: "Club shows the airplane: hours this month, everyone's flights, and the open squawks. Mine shows your flying — your totals and whether you're current to carry passengers.",
  },
  {
    targets: ["reservations"],
    where: "Reservations",
    icon: ICONS.calendar,
    title: "Reservations",
    body: "Book the airplane. Overlapping bookings are refused, back-to-back ones are fine, and you can send a booking straight to your own calendar with “Add to calendar”.",
  },
  {
    targets: ["account"],
    where: "Under your name",
    icon: ICONS.people,
    title: "Members",
    body: "The roster lives in this menu, along with your own profile. Badges show who runs the club and who holds each office, like the Safety Officer you'd call about a squawk.",
  },
  {
    targets: ["finances"],
    where: "Finances",
    icon: ICONS.money,
    title: "Finances",
    body: "Your statement for the month: dues, the flights you flew, and any fuel you paid for out of pocket credited back. You only ever see your own — the Finance Officer sees the club's.",
  },
  {
    where: null,
    icon: ICONS.check,
    title: "That's the tour",
    body: "Run it again any time from the (?) in the top bar. Clear prop!",
  },
];

/** Breathing room between the highlight and the element it surrounds. */
const HALO = 6;
/** Gap between the highlight and the card. */
const GAP = 12;
const CARD_W = 360;
const MARGIN = 12;

interface Placement {
  /** The `data-tour` key actually highlighted — see `findTarget`. */
  key: string;
  hole: { top: number; left: number; width: number; height: number };
  card: { top: number; left: number };
}

/**
 * The visible element for a step, or null.
 *
 * "Visible" has to be checked because both nav bars are always in the DOM —
 * one of them is merely `display: none` at any given width, and an element
 * hidden that way reports a zero-sized rect.
 */
function findTarget(
  targets: string[] | undefined
): { el: HTMLElement; key: string } | null {
  if (!targets || typeof document === "undefined") return null;
  for (const key of targets) {
    const matches = document.querySelectorAll<HTMLElement>(
      `[data-tour="${key}"]`
    );
    for (const el of matches) {
      const rect = el.getBoundingClientRect();
      // Returns the key that MATCHED, not the one first asked for. On a phone
      // the preflight step lands on the Checkouts group instead, and a
      // spotlight that reported "preflight" would be describing a control
      // that isn't on the screen.
      if (rect.width > 0 && rect.height > 0) return { el, key };
    }
  }
  return null;
}

/**
 * Where the hole and the card go, given the target's current rect and the
 * card's REAL height.
 *
 * The height has to be measured rather than assumed. A guess is fine on a
 * desktop, where the card is 360px of a 1280px window and there's slack in
 * every direction — and wrong on a phone, where the same words wrap to half
 * again as tall. Assuming 260px there put the card straight down on top of the
 * bottom pill it was pointing at, and pushed its own Next button off the
 * bottom of the screen.
 */
function place(el: HTMLElement, key: string, cardH: number): Placement {
  const r = el.getBoundingClientRect();
  const hole = {
    top: r.top - HALO,
    left: r.left - HALO,
    width: r.width + HALO * 2,
    height: r.height + HALO * 2,
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - MARGIN * 2);
  // Never taller than the screen; the card scrolls internally past that.
  const h = Math.min(cardH, vh - MARGIN * 2);

  // Prefer the side with room: beside a rail entry, below a top-bar control,
  // above a bottom-bar tab.
  const roomRight = vw - hole.left - hole.width;
  const roomLeft = hole.left;
  const roomBelow = vh - hole.top - hole.height;
  const roomAbove = hole.top;

  let left: number;
  let top: number;
  if (roomRight >= cardW + GAP + MARGIN) {
    left = hole.left + hole.width + GAP;
    top = hole.top;
  } else if (roomLeft >= cardW + GAP + MARGIN) {
    left = hole.left - cardW - GAP;
    top = hole.top;
  } else if (roomBelow >= h + GAP + MARGIN) {
    left = hole.left + hole.width / 2 - cardW / 2;
    top = hole.top + hole.height + GAP;
  } else if (roomAbove >= h + GAP + MARGIN) {
    left = hole.left + hole.width / 2 - cardW / 2;
    top = hole.top - h - GAP;
  } else {
    // Nothing fits cleanly — take the roomier side and let the clamp settle it.
    left = hole.left + hole.width / 2 - cardW / 2;
    top = roomAbove > roomBelow ? MARGIN : vh - h - MARGIN;
  }

  return {
    key,
    hole,
    card: {
      left: Math.min(Math.max(left, MARGIN), vw - cardW - MARGIN),
      top: Math.min(Math.max(top, MARGIN), vh - h - MARGIN),
    },
  };
}

export default function GuidedTour() {
  const { me, setMe } = useMe();
  const [index, setIndex] = useState(0);
  // Hide instantly on finish; the PATCH is what makes it stick.
  const [dismissed, setDismissed] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The card's measured height. Starts at a plausible desktop value and is
  // corrected from the DOM on the next tick — see the effect below.
  const [cardH, setCardH] = useState(260);
  const cardRef = useRef<HTMLDivElement>(null);

  const open = Boolean(me) && me?.tourSeenAt === null && !dismissed;
  const step = STEPS[index];

  // Re-measure whenever the step changes and on anything that could move the
  // target. A tour that keeps its highlight after a resize is worse than one
  // that has none, so this is a layout effect: the hole is positioned before
  // the browser paints the step.
  const measure = useCallback(() => {
    if (!open) return;
    const found = findTarget(step?.targets);
    setPlacement(found ? place(found.el, found.key, cardH) : null);
  }, [open, step, cardH]);

  useIsoLayoutEffect(() => {
    measure();
  }, [measure]);

  // Feed the card's REAL height back into the placement. Two passes: the first
  // lays the card out at the previous step's height, this reads what it
  // actually came to, and `measure` runs again with the truth. The deadband is
  // what keeps those two passes from oscillating forever.
  useIsoLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 4) setCardH(h);
  });

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // "Replay the tour" works by clearing `tourSeenAt` on the shared profile, so
  // that going back to null is what has to un-latch this component.
  //
  // `dismissed` exists only to hide the tour on the same tick you finish it,
  // ahead of the PATCH — but it survives in state long after, and without this
  // the second and every later replay would set `tourSeenAt` to null, satisfy
  // the rest of the condition, and still show nothing.
  useEffect(() => {
    if (me?.tourSeenAt === null) setDismissed(false);
  }, [me?.tourSeenAt]);

  // Restart at the beginning each time the tour is re-opened, so "replay the
  // tour" doesn't drop you back where you skipped.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Move focus into the card so the keyboard lands somewhere sensible, and let
  // Escape out.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  if (!open || !me || !step) return null;
  // Bound after the guard: TS doesn't carry the null-narrowing of `me` into
  // the function declaration below.
  const profile = me;

  const isLast = index === STEPS.length - 1;

  async function finish() {
    setDismissed(true);
    // Optimistic: the tour is gone from this session either way, and a failed
    // write only means they see it again next time — not worth blocking on.
    setMe({ ...profile, tourSeenAt: new Date().toISOString() });
    await sendJson("/api/me", "PATCH", { tourSeen: true });
  }

  const card = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      tabIndex={-1}
      style={
        placement
          ? {
              position: "fixed",
              top: placement.card.top,
              left: placement.card.left,
              width: Math.min(CARD_W, window.innerWidth - MARGIN * 2),
              // A hard ceiling, so a long step on a short screen scrolls
              // inside the card instead of running its buttons off the bottom
              // of the viewport where nothing can reach them.
              maxHeight: window.innerHeight - MARGIN * 2,
              overflowY: "auto",
            }
          : undefined
      }
      className={`z-[70] rounded-xl border border-gray-200 bg-white p-4 shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-800 ${
        placement ? "" : "w-full max-w-md"
      }`}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path d={step.icon} />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold">{step.title}</p>
            {step.where && (
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                {step.where}
              </p>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-700 dark:text-gray-300">{step.body}</p>

        {/* Progress dots, and a live count for anyone not seeing them. */}
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-5 bg-indigo-600 dark:bg-indigo-400"
                  : "w-1.5 bg-gray-300 dark:bg-gray-600"
              }`}
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {STEPS.length}: {step.title}
        </p>

        <div className="flex items-center gap-2">
          {!isLast && (
            <Button variant="ghost" onClick={finish} className="mr-auto">
              Skip
            </Button>
          )}
          {index > 0 && (
            <Button
              variant="secondary"
              onClick={() => setIndex((i) => i - 1)}
              className={isLast ? "mr-auto" : ""}
            >
              Back
            </Button>
          )}
          <Button onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}>
            {isLast ? "Start flying" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {placement ? (
        <>
          {/* The dim IS this element's shadow: one box the size of the hole,
              casting an opaque spread far larger than any viewport. That gives
              a real cutout — with a matching rounded corner — without an SVG
              mask or four separately-positioned panels that never quite meet.
              `pointer-events-none` so it isn't itself a click target; the
              backdrop below is what swallows clicks. */}
          <div
            aria-hidden="true"
            data-tour-spotlight={placement.key}
            className="pointer-events-none absolute rounded-xl ring-2 ring-indigo-400 transition-all duration-200"
            style={{
              top: placement.hole.top,
              left: placement.hole.left,
              width: placement.hole.width,
              height: placement.hole.height,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
            }}
          />
          {/* Clicks anywhere outside the highlight close the tour, the same as
              Skip — the scrim is not a trap. */}
          <button
            aria-hidden="true"
            tabIndex={-1}
            onClick={finish}
            className="absolute inset-0 cursor-default"
          />
          {card}
        </>
      ) : (
        // No target on screen: fall back to a plain centred card.
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          {card}
        </div>
      )}
    </div>,
    document.body
  );
}
