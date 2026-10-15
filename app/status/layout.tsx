"use client";
// The Status tab's frame: which airplane, whether it flies, and the two views
// of it (Overview / Squawks).
//
// The header and the dispatch banner live HERE rather than on Overview because
// they're true of the airplane, not of a view — a member who walked into the
// Squawks tab to read why the airplane is down should not have to go back to
// Overview to see that it is.
//
// Overview and Squawks are RAIL children under Plane Status (see Navbar's NAV),
// exactly like Preflight/Startup & Runup/Post-flight under Checkouts — not tabs drawn
// inside the page. So this layout carries no navigation at all: just the two
// things both children need above them.
import Link from "next/link";
import { usePathname } from "next/navigation";
import Badge from "@/components/common/Badge";
import { useAircraft } from "@/components/AircraftProvider";
import { grounding } from "@/lib/maintenance";
import { squawkBanner, type SquawkCounts } from "@/lib/squawks";

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { selected } = useAircraft();
  // A banner points at a tab; on that tab it would only point at the page
  // you're already reading, so it isn't drawn there.
  const pathname = usePathname();
  const onSquawks = pathname.startsWith("/status/squawks");
  const onMaintenance = pathname.startsWith("/status/maintenance");

  const grounded = selected?.groundingSquawks ?? [];
  const inWork = selected?.inWorkSquawks ?? [];
  // The OTHER way an airplane stops flying, and the one nobody files a squawk
  // about: a legally-required inspection that has run out. Only items marked
  // `requiredByReg` count — the club being late on its own 50-hour oil change
  // is loud on the Overview tab and is not a grounding (see lib/maintenance).
  const outOfCheck = grounding(
    selected?.maintenance ?? [],
    selected?.lastTach ?? null
  );
  const airworthy = grounded.length === 0 && outOfCheck.length === 0;

  return (
    <div className="space-y-4">
      {selected && (
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{selected.tailNumber}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[selected.model, selected.year, selected.homeBase]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge tone={airworthy ? "green" : "red"}>
            {airworthy ? "Airworthy" : "Grounded"}
          </Badge>
        </header>
      )}

      {/* Paperwork that has run out. Above the squawk banners and separate
          from them, because it isn't a defect and nobody reported it — the
          airplane is perfectly serviceable and may not legally be flown. */}
      {/* One line per fact about whether it flies, worst first. Each is a
          headline and a link to where the detail lives — the list of
          squawks used to be printed here too, and on a phone a single
          squawk's banner took a third of the first screen. */}
      {outOfCheck.length > 0 && !onMaintenance && (
        <StatusBanner tone="red" href="/status/maintenance" linkText="See maintenance">
          Do not fly — {outOfCheck.length === 1 ? "an inspection has" : "inspections have"} run out
        </StatusBanner>
      )}
      {!onSquawks && (
        <SquawkBanner
          grounded={grounded.length}
          inWork={inWork.length}
          unreviewed={selected?.newSquawkCount ?? 0}
          okToFly={selected?.okToFlySquawkCount ?? 0}
        />
      )}

      {children}
    </div>
  );
}

const BANNER_TONES = {
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200",
} as const;

/** The squawks' one dispatch line (see `squawkBanner`), or nothing. */
function SquawkBanner(counts: SquawkCounts) {
  const banner = squawkBanner(counts);
  if (!banner) return null;
  return (
    <StatusBanner tone={banner.tone} href="/status/squawks" linkText="See squawks">
      {banner.text}
    </StatusBanner>
  );
}

/** One dispatch line: a (!), a headline, and a link to the detail. */
function StatusBanner({
  tone,
  href,
  linkText,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  href: string;
  linkText: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${BANNER_TONES[tone]}`}
    >
      <span aria-hidden="true" className="shrink-0">
        <AlertIcon />
      </span>
      {/* A heading, small as it is: it's the page's answer to "does it fly". */}
      <h2 className="min-w-0 flex-1 text-sm font-medium">{children}</h2>
      <Link href={href} className="shrink-0 font-medium underline underline-offset-2">
        {linkText}
      </Link>
    </div>
  );
}

/** (!) in a circle. */
function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.6" fill="currentColor" />
    </svg>
  );
}
