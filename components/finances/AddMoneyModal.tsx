"use client";
// Everything that puts money on the books by hand, behind the Finances page's
// one dashed "+" panel.
//
// A member sees ONE form: claim a reimbursement for yourself. The API holds
// that line (`finance:claim-own` only ever credits the person filing it); the
// form just never offers anything else.
//
// The Finance Officer sees four, picked from a segmented control at the top:
//
//   Reimburse        the club owes a member for something — the same form,
//                    with a member picker.
//   Charge members   one amount, either SPLIT among people to the cent or
//                    charged to EACH of them, for everyone or for whoever is
//                    ticked. The preview spells out the arithmetic before
//                    anything is written, because "did that just charge
//                    everyone $250 or $31.25" is the question to settle
//                    before pressing, not after.
//   Club funds       money into or out of the club's own account — a line
//                    with no member, which has nobody to chase and so no
//                    paid/unpaid state: it changes the club's balance on the
//                    spot.
//   Recurring & rate the standing rules and the hourly rate, which live in
//                    their own dialog.
//
// Every amount is typed as a POSITIVE number. The direction is always a named
// choice, never a minus sign, for the same reason the old one-off form gave:
// a lost minus sign moves money the wrong way twice over.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import MoneyInput from "@/components/common/MoneyInput";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { fetchJsonArray, sendJson } from "@/lib/api";
import {
  chargeShares,
  currentPeriod,
  formatMoney,
  formatPeriod,
  parseDollars,
  periodEnd,
  type Period,
} from "@/lib/finance";
import type { ApiMember } from "@/lib/types";

type Mode = "reimburse" | "charge" | "funds" | "recurring";

/** The window's title for each of the officer's modes. */
const OFFICER_TITLES: Record<Mode, string> = {
  reimburse: "Reimburse a member",
  charge: "Charge members",
  funds: "Club funds",
  recurring: "Recurring charges & rate",
};

const MODE_LABELS: Record<Mode, string> = {
  reimburse: "Reimburse",
  charge: "Charge",
  funds: "Club funds",
  recurring: "Recurring",
};

export default function AddMoneyModal({
  officer,
  me,
  period,
  onClose,
  onSaved,
  onOpenRecurring,
}: {
  /** Holds `finance:manage` — gets every mode rather than just the claim. */
  officer: boolean;
  me: { id: string; name: string };
  /** The month a new line lands in — this month, or the header it came from. */
  period: Period;
  onClose: () => void;
  onSaved: () => void;
  onOpenRecurring: () => void;
}) {
  const [mode, setMode] = useState<Mode>(officer ? "charge" : "reimburse");
  const [roster, setRoster] = useState<ApiMember[] | null>(null);

  useEffect(() => {
    if (!officer) return;
    fetchJsonArray<ApiMember>("/api/members").then(setRoster);
  }, [officer]);

  // Shared by every form: what for, how much, and the day within the month.
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const monthFirst = `${period}-01`;
  const monthLast = dayKey(new Date(periodEnd(period).getTime() - 1));
  // Today for the current month; the month's LAST day for an earlier one,
  // which keeps a line added after the fact inside the month it belongs to.
  const [day, setDay] = useState(() =>
    period === currentPeriod() ? dayKey(new Date()) : monthLast
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reimburse: whose. Defaults to the person filing it.
  const [reimburseFor, setReimburseFor] = useState(me.id);
  // Charge members: how the amount is read, and who it falls on.
  const [chargeMode, setChargeMode] = useState<"split" | "each">("split");
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Club funds: which way the money moved.
  const [fundsIn, setFundsIn] = useState(true);

  const flying = useMemo(
    () => (roster ?? []).filter((m) => m.clubMember).sort((a, b) => a.name.localeCompare(b.name)),
    [roster]
  );
  // The people a charge falls on, in the order the server will share it out
  // (by name), so the preview's odd cents land where the real ones will.
  const chargeTargets = everyone ? flying : flying.filter((m) => picked.has(m.id));

  const cents = parseDollars(amount);
  const validAmount = cents !== null && cents > 0;
  const shares =
    mode === "charge" && validAmount ? chargeShares(cents, chargeTargets.length, chargeMode) : [];

  function pick(id: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (!description.trim()) {
      setError("Say what it's for.");
      return;
    }
    if (!validAmount) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (day < monthFirst || day > monthLast) {
      setError(`Pick a day in ${formatPeriod(period)}.`);
      return;
    }
    // Local NOON, not a bare date: "2026-08-01" parses as UTC midnight, which
    // is still July in the club's timezone and would land on the wrong month.
    const incurredOn = `${day}T12:00:00`;
    const dollars = cents / 100;

    let result;
    setBusy(true);
    if (mode === "charge") {
      if (chargeTargets.length === 0) {
        setBusy(false);
        setError("Tick at least one member.");
        return;
      }
      result = await sendJson("/api/finances/charges/split", "POST", {
        description,
        amountDollars: dollars,
        mode: chargeMode,
        memberIds: everyone ? [] : chargeTargets.map((m) => m.id),
        incurredOn,
      });
    } else if (mode === "funds") {
      result = await sendJson("/api/finances/charges", "POST", {
        club: true,
        description,
        // Money IN is owed-to-the-club-and-received: positive. Out: negative.
        amountDollars: fundsIn ? dollars : -dollars,
        incurredOn,
      });
    } else {
      result = await sendJson("/api/finances/charges", "POST", {
        reimbursement: true,
        memberId: officer ? reimburseFor : undefined,
        description,
        amountDollars: dollars,
        incurredOn,
      });
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }
    onSaved();
  }

  /** The sentence above the button: what will be recorded, in words. */
  function previewText(): ReactNode {
    if (!validAmount) return null;
    const money = formatMoney(cents);
    if (mode === "reimburse") {
      if (reimburseFor === me.id) return `The club will owe you ${money}.`;
      const member = (roster ?? []).find((m) => m.id === reimburseFor);
      if (!member) return null;
      return `The club will owe ${member.name} ${money}.`;
    }
    if (mode === "funds") {
      if (fundsIn) return `The club balance goes up ${money}.`;
      return `The club balance goes down ${money}.`;
    }
    if (mode === "charge" && shares.length > 0) {
      return describeShares(shares, chargeMode);
    }
    return null;
  }
  const preview = previewText();

  const title = officer ? OFFICER_TITLES[mode] : "Claim a reimbursement";

  /** The button says what pressing it records. */
  function submitLabelText(): string {
    if (mode === "reimburse") {
      if (officer) return "Add reimbursement";
      return "Claim reimbursement";
    }
    if (mode === "charge") {
      const n = chargeTargets.length;
      return `Charge ${n} ${n === 1 ? "person" : "people"}`;
    }
    if (fundsIn) return "Add to club";
    return "Take from club";
  }
  const submitLabel = submitLabelText();

  /** An example of what goes in "What for", so the box says what it's for. */
  function placeholderText(): string {
    if (mode === "reimburse") return "Oil — 2 quarts, receipt in the binder";
    if (mode === "charge") return "Hangar door repair";
    if (fundsIn) return "County airport grant";
    return "Annual insurance premium";
  }

  /** "Total" or "Per person" is the whole difference between the two charges. */
  function amountLabel(): string {
    if (mode !== "charge") return "Amount";
    if (chargeMode === "split") return "Total";
    return "Per person";
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={formatPeriod(period)}
      footer={
        mode === "recurring" ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <LoadingDots size="sm" /> : submitLabel}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {officer && (
          <div
            role="group"
            aria-label="What kind of money"
            className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/50 sm:grid-cols-4"
          >
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setError(null);
                  setMode(m);
                }}
                aria-pressed={mode === m}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  mode === m
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}

        {mode === "recurring" ? (
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p>
              Standing monthly charges (dues), monthly paybacks, and each
              airplane&rsquo;s hourly rate.
            </p>
            <Button variant="secondary" onClick={onOpenRecurring}>
              Open recurring charges &amp; rate
            </Button>
          </div>
        ) : (
          <>
            {mode === "reimburse" && officer && (
              <Select
                label="Member"
                value={reimburseFor}
                onChange={(e) => setReimburseFor(e.target.value)}
              >
                <option value={me.id}>{me.name} (you)</option>
                {(roster ?? [])
                  .filter((m) => m.id !== me.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            )}

            {mode === "funds" && (
              <Segmented
                label="Which way"
                options={[
                  { value: true, title: "Money in", blurb: "A deposit, a grant" },
                  { value: false, title: "Money out", blurb: "A bill the club paid" },
                ]}
                value={fundsIn}
                onChange={setFundsIn}
              />
            )}

            {mode === "charge" && (
              <Segmented
                label="How the amount is charged"
                options={[
                  { value: "split" as const, title: "Split a total", blurb: "Shared between them" },
                  { value: "each" as const, title: "Each pays", blurb: "The same for everyone" },
                ]}
                value={chargeMode}
                onChange={setChargeMode}
              />
            )}

            <Input
              label="What for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={placeholderText()}
            />

            <div className="grid grid-cols-2 gap-3">
              <MoneyInput
                label={amountLabel()}
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
              />
              <Input
                label="Date"
                type="date"
                min={monthFirst}
                max={monthLast}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>

            {mode === "charge" && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Who</legend>
                <div className="flex gap-2">
                  {[
                    { value: true, label: `Everyone (${flying.length})` },
                    { value: false, label: "Choose people" },
                  ].map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      onClick={() => setEveryone(o.value)}
                      aria-pressed={everyone === o.value}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        everyone === o.value
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {!everyone && (
                  <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                    {roster === null ? (
                      <li className="p-3">
                        <LoadingDots size="sm" />
                      </li>
                    ) : (
                      flying.map((m) => (
                        <li key={m.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={picked.has(m.id)}
                              onChange={(e) => pick(m.id, e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
                            />
                            {m.name}
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </fieldset>
            )}

            {preview && (
              <p
                role="status"
                className={`rounded-lg px-3 py-2 text-sm ${
                  mode === "reimburse" || (mode === "funds" && fundsIn)
                    ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                    : "bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200"
                }`}
              >
                {preview}
              </p>
            )}

            {mode === "reimburse" && !officer && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                It goes on your statement as money the club owes you. The
                Finance Officer pays it out — keep the receipt.
              </p>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * The arithmetic, in words, with what each PERSON pays in bold — that's the
 * figure to check before pressing: "8 people × **$12.00** = $96.00", or for a
 * split that doesn't divide evenly, who gets the odd cent.
 */
export function describeShares(shares: number[], mode: "split" | "each"): ReactNode {
  const n = shares.length;
  const total = shares.reduce((sum, c) => sum + c, 0);
  const people = `${n} ${n === 1 ? "person" : "people"}`;
  const high = shares[0];
  const low = shares[n - 1];
  if (high === low) {
    return (
      <>
        {people} × <strong>{formatMoney(high)}</strong> = {formatMoney(total)}
        {mode === "split" && n > 1 ? " — split evenly" : ""}.
      </>
    );
  }
  const extra = shares.filter((c) => c === high).length;
  return (
    <>
      {formatMoney(total)} split {n} ways: {extra} × <strong>{formatMoney(high)}</strong> and{" "}
      {n - extra} × <strong>{formatMoney(low)}</strong>.
    </>
  );
}

/** Two big labelled choices — a direction, a mode — with a line under each. */
function Segmented<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; title: string; blurb: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.title}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              active
                ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/30"
                : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                active ? "text-indigo-700 dark:text-indigo-200" : ""
              }`}
            >
              {o.title}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">{o.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "YYYY-MM-DD" in local time — what a date input holds. */
function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}
