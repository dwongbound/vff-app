"use client";
// The one line at the top of the content column that says what's on this
// device and not yet with the club — and whether what's on screen is live.
// What it says, and in what order, is `stripMessage` (lib/offline.ts); this
// file only draws it, plus the Details modal behind it. Nothing at all when
// everything is sent and live, which is nearly always.
import { useEffect, useMemo, useState } from "react";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import { useMe } from "@/components/MeProvider";
import { useOutbox } from "@/components/OutboxProvider";
import { onStaleDataChange, staleDataSince } from "@/lib/api";
import { formatDay, formatTime } from "@/lib/dates";
import { stripMessage, type StripTone } from "@/lib/offline";
import { DEPENDENCY_SKIPPED, type OutboxJob } from "@/lib/outbox";

const TONES: Record<StripTone, string> = {
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  grey: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
};

/** When the oldest cached read on screen was fetched, kept live — see lib/api.ts. */
function useStaleSince(): string | null {
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    setSince(staleDataSince());
    return onStaleDataChange(setSince);
  }, []);
  return since;
}

export default function OutboxStrip() {
  const { me } = useMe();
  const { jobs, sending, durable } = useOutbox();
  const staleSince = useStaleSince();
  const [open, setOpen] = useState(false);

  const userId = me?.id ?? null;
  const mine = useMemo(() => jobs.filter((j) => j.userId === userId), [jobs, userId]);
  const others = jobs.filter((j) => j.userId !== userId && j.state === "pending");

  const message = stripMessage({
    problems: mine.filter((j) => j.state !== "pending"),
    waiting: mine.filter((j) => j.state === "pending" && j.error !== null),
    sending,
    staleSince,
    staleTime: staleSince ? formatTime(staleSince) : null,
    others,
  });
  if (!message) return null;

  const hasDetails = mine.length > 0 || others.length > 0;

  return (
    <>
      {/* One line, never more: `truncate` rather than wrapping, because the
          strip sits above every page and its job is to be glanced at — the
          detail is behind the button. aria-live rather than role="status":
          the checkout draft bar is the page's status line, and two of them in
          <main> is ambiguous to a screen reader (and to every e2e spec that
          asks for "the" status). */}
      <div
        aria-live="polite"
        className={`mb-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${TONES[message.tone]}`}
      >
        <span className="min-w-0 flex-1 truncate">{message.text}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 font-semibold underline-offset-2 hover:underline"
          >
            Details
          </button>
        )}
      </div>
      <OutboxDetails
        open={open}
        onClose={() => setOpen(false)}
        mine={mine}
        others={others}
        durable={durable}
      />
    </>
  );
}

/** What a job carries besides its main record, in a few words: "with 2 photos and 1 squawk". */
function contents(job: OutboxJob): string {
  const photos = job.steps.filter((s) => s.type === "photo").length;
  const squawks = job.steps.filter((s) => s.type === "json" && s.url === "/api/squawks").length;
  const parts = [
    photos > 0 && `${photos} photo${photos === 1 ? "" : "s"}`,
    squawks > 0 && `${squawks} squawk${squawks === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? `with ${parts.join(" and ")}` : "";
}

/** Everything waiting on this device, with Try sending now and a two-press Discard. */
function OutboxDetails({
  open,
  onClose,
  mine,
  others,
  durable,
}: {
  open: boolean;
  onClose: () => void;
  mine: OutboxJob[];
  others: OutboxJob[];
  durable: boolean;
}) {
  const { flush, discard, sending } = useOutbox();
  // Discarding throws a member's work away for good, so it takes two presses,
  // the second naming what goes.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={() => {
        setConfirming(null);
        onClose();
      }}
      title="Saved on this device"
      subtitle="Submissions the club doesn't have yet"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void flush()} disabled={sending}>
            {sending ? "Sending…" : "Try sending now"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!durable && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            This browser won&apos;t let the app keep these if the page is closed —
            keep it open until they&apos;ve sent.
          </p>
        )}
        {mine.length === 0 && others.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing waiting.</p>
        )}
        <ul className="space-y-2">
          {mine.map((job) => {
            const skipped = Object.entries(job.skipped).filter(
              ([, reason]) => reason !== DEPENDENCY_SKIPPED
            );
            return (
              <li
                key={job.id}
                className="space-y-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{job.label}</span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {formatDay(job.createdAt)} {formatTime(job.createdAt)}
                  </span>
                </div>
                {contents(job) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{contents(job)}</p>
                )}
                {job.state === "pending" && (
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Waiting to send{job.error ? ` — ${job.error}` : "."}
                  </p>
                )}
                {job.state === "refused" && (
                  <p className="text-xs text-red-700 dark:text-red-300">
                    The club refused this: {job.error}
                  </p>
                )}
                {job.state === "partial" && (
                  <div className="text-xs text-red-700 dark:text-red-300">
                    Sent, but not all of it:
                    <ul className="ml-4 list-disc">
                      {skipped.map(([id, reason]) => (
                        <li key={id}>
                          {id.includes("photo") ? "A photo" : "A squawk"} — {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  {confirming === job.id ? (
                    <>
                      <span className="mr-auto self-center text-xs text-red-700 dark:text-red-300">
                        {job.state === "partial"
                          ? "Clear this note?"
                          : "Throw this away for good? The club will never see it."}
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setConfirming(null);
                          void discard(job.id);
                        }}
                      >
                        {job.state === "partial" ? "Clear" : "Discard"}
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(job.id)}>
                      {job.state === "partial" ? "Dismiss" : "Discard"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {others.map((job) => (
            <li
              key={job.id}
              className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
            >
              {job.label} — {job.userName}&apos;s. Sends when they sign in on this device.
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
