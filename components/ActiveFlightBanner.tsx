"use client";
// "N8318B is out with you — continue: runway card →", on every page while the
// signed-in member has a flight they haven't filed.
//
// A session opens the moment a card is signed off (lib/flightSessions.ts),
// and the cards after it are walked on whatever device is to hand — so a
// member who closed the tab at the hold-short line, or picked up a phone that
// never saw the walk, had no way back but to know which page came next. The
// banner is that way back. Where it points comes off the session's own cards
// (`resumePoint`), and it stays off the pages that ARE the way back
// (`showsResumeBanner`).
//
// Asked again whenever it could have changed: on sign-in, on every navigation
// (filing ends at a navigation), when the app comes back to the foreground
// (the "open the app" case — a home-screen app resumes, it doesn't reload),
// and when a queued submission lands.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Banner from "./common/Banner";
import { useAircraft } from "./AircraftProvider";
import { useMe } from "./MeProvider";
import { useOutbox, useOutboxSent } from "./OutboxProvider";
import { fetchJsonObject } from "@/lib/api";
import { formatTime } from "@/lib/dates";
import { resumePoint, showsResumeBanner } from "@/lib/flightSession";
import { hasPending } from "@/lib/outbox";
import type { ApiActiveFlight } from "@/lib/types";

export default function ActiveFlightBanner({
  onNavigate,
}: {
  /** The nav's own click handler, so the tab lights up straight away. */
  onNavigate?: (href: string) => void;
}) {
  const pathname = usePathname();
  const { status } = useSession();
  const { me } = useMe();
  const { jobs } = useOutbox();
  const { selectAircraft } = useAircraft();
  const [active, setActive] = useState<ApiActiveFlight | null>(null);
  // Dismissed for this visit only: the next time the app opens, a flight that
  // still isn't filed is still worth saying so about.
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") {
      setActive(null);
      return;
    }
    const data = await fetchJsonObject<{ flight: ApiActiveFlight | null }>("/api/flights/active");
    // A failed ask (offline, mid-deploy) keeps what we last knew rather than
    // blinking the banner away and back.
    if (data) setActive(data.flight);
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useOutboxSent(refresh);

  if (!active || active.id === dismissedId || !showsResumeBanner(pathname)) return null;

  const userId = me?.id ?? null;
  const aircraftId = active.aircraft.id;
  // Filed on this device but still in the outbox: the flight is finished as
  // far as the member is concerned, and "continue" would send them to fill the
  // form in twice. Likewise a runway card that's signed but not yet sent.
  if (hasPending(jobs, userId, { type: "flight", aircraftId })) return null;
  const runwayQueued = hasPending(jobs, userId, { type: "checkout", aircraftId, kind: "RUNWAY" });
  const { href, next } = resumePoint(runwayQueued ? [...active.cards, "RUNWAY"] : active.cards);

  return (
    <Banner tone="indigo" onDismiss={() => setDismissedId(active.id)}>
      <Link
        href={href}
        onClick={() => {
          // The cards act on the SELECTED airplane, so pick the one that's out
          // before arriving — or the runway card opens on the wrong tail.
          selectAircraft(aircraftId);
          onNavigate?.(href);
        }}
        className="hover:opacity-80"
      >
        <span className="font-semibold">
          {active.aircraft.tailNumber} is out with you
        </span>{" "}
        since {formatTime(active.openedAt)} — continue: {next}
        <span aria-hidden="true" className="ml-1.5 text-base font-bold">
          →
        </span>
      </Link>
    </Banner>
  );
}
