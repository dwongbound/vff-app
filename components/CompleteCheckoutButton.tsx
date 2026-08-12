"use client";
// The one submit at the foot of a checkout page: "Complete".
//
// It is ALWAYS clickable, and that's the point. The button used to be disabled
// until every box was ticked, which sounds strict and isn't: a member standing
// at an airplane with one item they genuinely can't answer — a check the
// airframe doesn't allow, a thing already known broken and squawked — was left
// with no way to record the walk they DID do, and the club got no record at all
// rather than an honest partial one. A card nobody could file is a card people
// work around.
//
// So an incomplete card can be completed, deliberately: the modal names what
// isn't ticked and asks. The confirmation travels to the API as
// `acknowledgeIncomplete`, which is what stops a stale client filing a
// half-walked card as done by accident — see app/api/checkouts/route.ts.
//
// Shared by the preflight and runway pages so the wording of that decision
// exists once.
import { useState } from "react";
import Button from "@/components/common/Button";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import type { CheckoutItem } from "@/lib/checkouts";

/** How many missing items the modal names before it starts counting them. */
const NAMED = 6;

export default function CompleteCheckoutButton({
  title,
  remaining,
  busy,
  onComplete,
}: {
  /** The card's own name, for the modal's question ("Complete the preflight…"). */
  title: string;
  /** Required items still unticked, in card order — `missingItems()`. */
  remaining: CheckoutItem[];
  busy: boolean;
  onComplete: (opts: { acknowledgeIncomplete: boolean }) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const complete = remaining.length === 0;

  async function run(acknowledgeIncomplete: boolean) {
    setConfirming(false);
    await onComplete({ acknowledgeIncomplete });
  }

  return (
    <>
      <Button
        size="lg"
        // Never disabled by the card's state — only while a request is in
        // flight, which is about this click rather than about the walk.
        disabled={busy}
        onClick={() => (complete ? run(false) : setConfirming(true))}
        className="w-full sm:w-auto"
      >
        {busy ? <LoadingDots size="sm" /> : "Complete"}
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Complete the ${title.toLowerCase()}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep checking
            </Button>
            <Button onClick={() => run(true)}>Complete anyway</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            <span className="font-medium">
              {remaining.length} item{remaining.length === 1 ? "" : "s"}
            </span>{" "}
            {remaining.length === 1 ? "isn't" : "aren't"} ticked:
          </p>
          {/* Named, not counted. "12 items left" is a number to dismiss; seeing
              "Fuel selector — proper tank" in the list is the moment a member
              remembers whether they actually did it. */}
          <ul className="list-disc space-y-1 pl-5">
            {remaining.slice(0, NAMED).map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
            {remaining.length > NAMED && (
              <li className="list-none pl-0 text-gray-500 dark:text-gray-400">
                and {remaining.length - NAMED} more.
              </li>
            )}
          </ul>
          <p>
            The card is filed as it stands, unticked items and all — the club
            can see exactly what was and wasn&apos;t checked, which is the
            record being honest rather than complete.
          </p>
          <p className="font-medium">
            If something is wrong with the airplane, file a squawk. An unticked
            box is not a report.
          </p>
        </div>
      </Modal>
    </>
  );
}
