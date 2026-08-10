"use client";
// The club's operating rules (VFF-OR-A) as UI.
//
// Two views of the same data in lib/operatingRules.ts:
//   • MyLimitsCard — the verdict for YOU today ("solo, or do you need an
//     instructor?") plus the minimums that go with it, on the preflight tab,
//     where the decision is actually being made.
//   • RulesModal — the whole table as a popover, opened from the landing
//     currency card on the flight log's "Mine" view, where it serves as the
//     club's reference copy.
//
// Every row carries an (i) explaining what the limit is protecting against;
// the rules are only useful if people understand them.
import Badge from "./common/Badge";
import Card from "./common/Card";
import InfoTip from "./common/InfoTip";
import Modal from "./common/Modal";
import {
  CANCELLATION_POLICY,
  CHECKOUT_AIRPORTS,
  EXPERIENCED_RECENT_HOURS,
  EXPERIENCED_TOTAL_HOURS,
  GUMPS,
  RULES_ID,
  RULES_REVISION,
  RULE_ROWS,
  TIER_LABELS,
  ruleFor,
  type MnemonicItem,
  type SoloEligibility,
} from "@/lib/operatingRules";
import { formatHours } from "@/lib/hours";

/**
 * The verdict: can this member fly today, and under what limits?
 *
 * The rules' whole purpose is to answer "solo or instructor", so that's the
 * headline — computed from the member's declared total time plus the club's
 * own flight log. Below it are the minimums that actually apply to them, not
 * all three columns.
 */
export function MyLimitsCard({
  eligibility,
  totalTimeHours,
}: {
  eligibility: SoloEligibility;
  totalTimeHours: number | null;
}) {
  const { tier, daySolo, nightSolo, dayBlockers, nightBlockers, recentHours } =
    eligibility;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Can you fly today?
          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
            {RULES_ID} · {RULES_REVISION}
          </span>
        </h2>
        <Badge tone={tier === "BUILDING" ? "amber" : "green"}>
          {TIER_LABELS[tier]}
        </Badge>
      </div>

      {/* The headline. Failing your column's currency doesn't ground you — the
          rules' third column is "fly with an approved instructor". */}
      <div
        className={`rounded-lg px-3 py-2.5 text-sm ${
          daySolo
            ? "bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-200"
            : "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
        }`}
      >
        <p className="font-semibold">
          {daySolo
            ? "Cleared to fly solo or as PIC by day."
            : "You need an approved flight instructor for this flight."}
        </p>
        {dayBlockers.length > 0 && (
          <ul className="mt-1 list-inside list-disc">
            {dayBlockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {/* No size class: the night blocker is the same kind of statement as
            the day blockers above it, so it takes the banner's own `text-sm`
            rather than shrinking to a footnote. */}
        <p className="mt-1">
          Night:{" "}
          {nightSolo
            ? "current for solo night flying."
            : `instructor required — ${nightBlockers.join(" ")}`}
        </p>
      </div>

      {/* Prose, not metadata: four lines of running text explaining where the
          numbers came from and what to do about them. `text-xs` is the app's
          chip/label size — at paragraph length it reads as fine print, which
          is the opposite of the point. */}
      <p className="text-sm text-gray-500 dark:text-gray-400">
        From{" "}
        {totalTimeHours == null
          ? "no declared total time"
          : `${formatHours(totalTimeHours)} h total`}{" "}
        and {formatHours(recentHours)} h in this club&rsquo;s log over the last 12
        months. The club&rsquo;s standard column needs over {EXPERIENCED_TOTAL_HOURS} h
        total and {EXPERIENCED_RECENT_HOURS} h recent. Only flights logged here
        count — if you fly elsewhere, add your total time on your profile and
        talk to the Safety Officer. IFR currency is yours to assess: the club
        log doesn&rsquo;t record approaches.
      </p>

      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Your minimums today
      </h3>
      <dl className="divide-y divide-gray-100 dark:divide-gray-700">
        {RULE_ROWS.filter((row) => row.id !== "experience").map((row) => (
          <div key={row.id} className="flex items-start gap-3 py-2 text-sm">
            <dt className="flex min-w-0 flex-1 items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="min-w-0">{row.label}</span>
              <InfoTip label={row.label}>{row.why}</InfoTip>
            </dt>
            <dd className="max-w-[55%] text-right font-medium">
              {ruleFor(row, tier)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-gray-600 dark:text-gray-400">
        <span className="font-semibold">Checkout required:</span>{" "}
        {CHECKOUT_AIRPORTS.map((a) => `${a.name} (${a.id})`).join(" · ")} — get
        approval from the Safety Officer first.
      </p>

      {/* The most important sentence in the whole rulebook, so it gets to sit
          on the page rather than behind a link. */}
      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200">
        {CANCELLATION_POLICY}
      </p>
    </Card>
  );
}

/**
 * The full three-column table, in a modal.
 *
 * It's a popover rather than a section of the flight log because the rules are
 * something you go and look up — they answer a question you already have, and
 * on the page they pushed the log itself below the fold. The flight log opens
 * this from inside the currency card, which is exactly where the question
 * ("am I allowed to fly today?") comes up.
 */
export function RulesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Operating rules"
      subtitle={`${RULES_ID} — as established by the VFF Safety Officer on ${RULES_REVISION}`}
      size="full"
    >
      <div className="space-y-3">
        {/* Desktop: the table as printed. It scrolls inside its own box so a
            narrow window never makes the whole page scroll sideways. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                <th className="py-2 pr-3 font-semibold">Rule</th>
                <th className="py-2 pr-3 font-semibold">Experienced</th>
                <th className="py-2 pr-3 font-semibold">Building time</th>
                <th className="py-2 font-semibold">With instructor</th>
              </tr>
            </thead>
            <tbody>
              {RULE_ROWS.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 align-top dark:border-gray-700/60"
                >
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 font-medium">
                      {row.label}
                      <InfoTip label={row.label}>{row.why}</InfoTip>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {row.experienced}
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {row.building}
                  </td>
                  <td className="py-2 text-gray-700 dark:text-gray-300">
                    {row.withInstructor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phone: the same rows stacked, because a four-column table at
            390px is unreadable however you slice it. */}
        <ul className="space-y-3 sm:hidden">
          {RULE_ROWS.map((row) => (
            <li key={row.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {row.label}
                <InfoTip label={row.label}>{row.why}</InfoTip>
              </div>
              <dl className="mt-1.5 space-y-1 text-xs">
                <Row label="Experienced" value={row.experienced} />
                <Row label="Building time" value={row.building} />
                <Row label="With instructor" value={row.withInstructor} />
              </dl>
            </li>
          ))}
        </ul>

        <p className="text-xs text-gray-600 dark:text-gray-400">
          <span className="font-semibold">Checkout required:</span>{" "}
          {CHECKOUT_AIRPORTS.map((a) => `${a.name} (${a.id})`).join(" · ")}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          If the FAA&rsquo;s minimums or your own personal minimums are lower than
          these, those win. {CANCELLATION_POLICY}
        </p>
      </div>
    </Modal>
  );
}

/** A mnemonic (GUMPS, I'M SAFE) as a compact reference card. */
export function MnemonicCard({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: MnemonicItem[];
}) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold">
        {title}
        <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
          {subtitle}
        </span>
      </h2>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
              {item.letter}
            </span>
            <span>
              <span className="font-medium">{item.label}</span>
              <span className="text-gray-600 dark:text-gray-400"> — {item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The GUMPS card, pre-filled — it's the one every page wants verbatim. */
export function GumpsCard() {
  return (
    <MnemonicCard
      title="GUMPS"
      subtitle="Before crossing a runway threshold or turning base"
      items={GUMPS}
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
