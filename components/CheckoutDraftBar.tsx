"use client";
// "Your work is safe, and here's how to throw it away."
//
// Everything about the SAVED STATE of a walk, which is now a thing that happens
// by itself rather than something the member does. It replaces two older pieces
// of UI: the Save button (which is gone — see useCheckoutDraft for why a button
// was the wrong shape for this) and ResumedRun, whose amber "picking up where
// you left off" banner is folded in here as one of this strip's states.
//
// It renders INSIDE CheckoutList's sticky progress bar (the `status` slot), so
// it is one line in a bar rather than a card of its own. That's a reversal of
// the original arrangement, and the reason for the original still stands and is
// answered rather than ignored: Reset destroys a walk, and the sticky bar is
// the one thing parked under a member's thumb for the whole length of the card.
// So Reset is the quietest control on the strip — ghost weight, at the far edge,
// out of the way of the section headers and tick rows that get tapped — and it
// still asks in a modal that says what goes. What the move buys is that a
// member's progress and whether that progress is SAFE are now one thing they
// look at, in the one part of the page that follows them down the card; before
// this, the save state scrolled off the top and the answer to "did that get
// kept" was a trip back up the page.
//
// Two consequences of living in a bar:
//   - the copy has to survive a phone's width, so it clamps to two lines;
//   - "Picking up where you left off" gives way to the ordinary saved line as
//     soon as the member ticks anything (see `justResumed`). It's a greeting,
//     not a state — once you've started work it stops being true, and a
//     permanent amber notice in a sticky bar is a permanent tax on the height
//     of every card.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import { savedAgo } from "@/lib/checkoutDraft";
import type { Resume } from "@/lib/checkoutDraft";
import { formatDay, formatTime } from "@/lib/dates";

/** How often the "saved 4 min ago" line re-reads the clock. */
const TICK_MS = 30_000;

export default function CheckoutDraftBar({
  savedAt,
  serverSynced,
  deviceOnly,
  storageBlocked,
  resume,
  dirty,
  onReset,
  busy = false,
}: {
  savedAt: string | null;
  /** The club's server has this walk, not just this device. */
  serverSynced: boolean;
  deviceOnly: boolean;
  storageBlocked: boolean;
  resume: Resume | null;
  dirty: boolean;
  /** Clear both copies AND the card on screen — owned by the page, because
   *  only it knows what a cleared card looks like (the runway one keeps its
   *  derived "Preflight — complete" tick). */
  onReset: () => Promise<void>;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-render on a slow tick so "just now" becomes "2 min ago" without the
  // member touching anything. Only while there's something to age.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const id = setInterval(() => setNow((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [savedAt]);

  async function confirmReset() {
    setResetting(true);
    await onReset();
    setResetting(false);
    setConfirming(false);
  }

  // A card nobody has touched yet. Say what WILL happen — this is the line that
  // has to do the job the Save button used to do, which is tell a member their
  // work isn't going to evaporate. No Reset: there's nothing to reset, and
  // offering it would only invite the question of what it would delete.
  if (!dirty && !resume) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Your progress saves automatically as you work down the card.
      </p>
    );
  }

  // Resumed AND untouched: `savedAt` still being the stored copy's own stamp is
  // exactly "nothing has been written since we picked this up". The first tick
  // moves it, and the greeting gives way to the saved line.
  const justResumed = resume !== null && savedAt === resume.savedAt;
  const amber = justResumed || deviceOnly || storageBlocked;

  return (
    <>
      <div className="flex items-center gap-2">
        {/* `role="status"` rather than a bare <p>: this text changes on its own
            while the member is looking elsewhere, which is precisely what a
            polite live region is for. It's also the stable handle the e2e
            suite reads the save state from.
            It is the ONLY live region on this page — the progress bar wrapped
            around it deliberately isn't one, or every tick would re-announce
            the whole strip. */}
        <p
          role="status"
          className={`line-clamp-2 min-w-0 flex-1 text-xs ${
            amber
              ? "text-amber-700 dark:text-amber-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {storageBlocked ? (
            <>
              <span className="font-semibold">
                This device won&apos;t store anything.
              </span>{" "}
              Private browsing or a full disk — your work is going to the club&apos;s
              server instead, so finish the card without closing this tab.
            </>
          ) : justResumed ? (
            // Deliberately does NOT say WHICH store this came from. It's
            // tempting — `Resume.source` is right there — but the server copy
            // is normally just this device's own sync landing a couple of
            // seconds later, so it is the newer of the two and "saved from
            // another device" would be a lie on almost every ordinary resume.
            // The date and time are the part that does the work anyway: they
            // let a member tell their own saved walk from a stale one.
            <>
              <span className="font-semibold">Picking up where you left off.</span>{" "}
              Saved {formatDay(resume.savedAt)} at {formatTime(resume.savedAt)} —
              check that the ticks below still match the airplane.
            </>
          ) : deviceOnly ? (
            <>
              <span className="font-semibold">Saved on this device only.</span>{" "}
              The club&apos;s server hasn&apos;t got it yet, so finish the card here
              rather than on another device. It&apos;ll sync by itself when
              you&apos;re back in range.
            </>
          ) : !savedAt ? (
            // Dirty, but nothing has been stored yet. Saying "Saved" here is
            // the one thing this strip must never do: its whole job is to be
            // believed, and a status that reports success before the write has
            // happened is worse than no status at all. (It also hid a real bug
            // from the e2e suite, which was asserting on /^Saved/ and passing
            // while nothing reached either store.)
            <>Saving…</>
          ) : !serverSynced ? (
            // On the device, not yet on the club's server. Distinct from the
            // failure case below: nothing is wrong, it just hasn't landed.
            <>
              Saved {savedAgo(savedAt)} on this device
              <span className="opacity-60"> · syncing to the club</span>
            </>
          ) : (
            <>Saved · {savedAgo(savedAt)}</>
          )}
        </p>

        {/* Quietest control on the strip, and the furthest from anything a
            member taps on purpose while walking the card. `-mr-1.5` pulls its
            padding back to the bar's edge so the label lines up with the "19%"
            sitting directly above it. */}
        <Button
          variant="ghost"
          size="sm"
          className="-mr-1.5 shrink-0"
          onClick={() => setConfirming(true)}
          disabled={busy || resetting}
        >
          Reset
        </Button>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset this checkout?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={resetting}
            >
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmReset} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset checkout"}
            </Button>
          </>
        }
      >
        {/* Says what goes, in the member's terms, and that it can't be undone.
            A confirm dialog that only says "are you sure?" makes the member
            guess at the blast radius. */}
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Every tick, reading and note on this card gets thrown away, on this
            device and on the club&apos;s server, and the card starts over from
            the first section.
          </p>
          <p>
            Nothing that has already been <span className="font-medium">signed
            off</span> is touched, and any squawk you&apos;ve already filed stays
            filed — the airplane still has the fault either way.
          </p>
          <p className="font-medium">This can&apos;t be undone.</p>
        </div>
      </Modal>
    </>
  );
}
