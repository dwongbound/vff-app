"use client";
// The post-flight form's save state, and the only way to throw it away.
//
// Deliberately NOT CheckoutDraftBar. That bar can say "Saved · just now"
// meaning the club's server has the walk, and it has a whole vocabulary for the
// gap between the device and the server. None of that is true here: a
// post-flight entry has nowhere to sync to until it's filed (see
// lib/postflightDraft.ts), so this strip says "on this device" and means it.
// Borrowing the other bar's wording would be the one thing a save indicator
// must never do, which is claim more than happened.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import { savedAgo } from "@/lib/checkoutDraft";
import { formatDay, formatTime } from "@/lib/dates";

/** How often the "saved 4 min ago" line re-reads the clock. */
const TICK_MS = 30_000;

export default function PostflightDraftBar({
  savedAt,
  storageBlocked,
  restoredAt,
  droppedFiles,
  dirty,
  onReset,
}: {
  savedAt: string | null;
  storageBlocked: boolean;
  /** When the restored draft was saved, or null if nothing was restored. */
  restoredAt: string | null;
  /** The restored draft had photos attached, which can't be kept. */
  droppedFiles: boolean;
  dirty: boolean;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const [, setNow] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const id = setInterval(() => setNow((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [savedAt]);

  // Nothing entered yet. Say what WILL happen — this is the line that answers
  // "if I walk away to move the airplane, do I lose this".
  if (!dirty && !restoredAt) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        This form saves itself on this device as you fill it in — you can leave
        and come back.
      </p>
    );
  }

  // Restored AND untouched since: the first change moves `savedAt` past it and
  // the greeting gives way to the ordinary saved line. Same rule as the
  // checkout bar's, for the same reason — it's a greeting, not a state.
  const justRestored = restoredAt !== null && savedAt === restoredAt;
  const amber = justRestored || storageBlocked;

  return (
    <>
      <div className="flex items-center gap-2">
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
              Private browsing or a full disk — finish and file this entry
              without closing the tab.
            </>
          ) : justRestored ? (
            <>
              <span className="font-semibold">Picking up where you left off.</span>{" "}
              Saved {formatDay(restoredAt)} at {formatTime(restoredAt)} on this
              device — check it still matches what you flew.
              {droppedFiles && " Photos aren't kept, so attach those again."}
            </>
          ) : savedAt ? (
            <>Saved · {savedAgo(savedAt)} on this device</>
          ) : (
            <>Saving…</>
          )}
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="-mr-1.5 shrink-0"
          onClick={() => setConfirming(true)}
        >
          Reset
        </Button>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset this entry?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onReset();
                setConfirming(false);
              }}
            >
              Reset entry
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Every reading, tick and note on this form gets thrown away, and the
            form starts over empty.
          </p>
          <p>
            Flights you&apos;ve already filed aren&apos;t touched — this is only
            the entry you&apos;re filling in now.
          </p>
          <p className="font-medium">This can&apos;t be undone.</p>
        </div>
      </Modal>
    </>
  );
}
