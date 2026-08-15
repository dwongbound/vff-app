"use client";
// Finances — what you owe the club this month, and where it came from.
//
// The page is two pages wearing one hat, exactly like the flight log's
// Club/Mine switch:
//
//   every member      sees their OWN statement and nothing else. The privacy
//                     rule is enforced by the API, not by hiding a button.
//   Finance Officer   (and any admin, who can do anything an officer can) gets
//                     a club-wide view, the tools to add and unwind charges,
//                     the recurring rules, and the hourly rate.
//
// A statement is charges minus credits: dues and flight time on one side, the
// fuel a member bought out of their own pocket on the other. Nothing here is
// typed in twice — flight lines come from the flight log and dues from a
// standing rule, so the books can't disagree with the log.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import OfficerOnly from "@/components/common/OfficerOnly";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, fetchJsonObject, sendJson } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import {
  CHARGE_KIND_LABELS,
  currentPeriod,
  formatMoney,
  formatPeriod,
  parseDollars,
  recentPeriods,
  type ChargeKind,
} from "@/lib/finance";
import type {
  ApiAircraft,
  ApiCharge,
  ApiFinances,
  ApiMember,
  ApiRecurringCharge,
  ApiStatement,
} from "@/lib/types";

const KIND_TONES: Record<ChargeKind, "gray" | "indigo" | "green" | "amber"> = {
  DUES: "indigo",
  FLIGHT: "gray",
  FUEL_CREDIT: "green",
  ONE_OFF: "amber",
  // Gray with FLIGHT: both are what it cost to go flying, derived from the same
  // log entry. A colour of its own would imply the member has to do something
  // about it.
  LANDING_FEE: "gray",
};

export default function FinancesPage() {
  const { me } = useMe();
  const { aircraft: fleet, selected } = useAircraft();
  const canManage = me?.capabilities.includes("finance:manage") ?? false;
  const canReadAll = me?.capabilities.includes("finance:read-all") ?? false;

  const [period, setPeriod] = useState(() => currentPeriod());
  // Officers can flip between the club and just themselves; everyone else only
  // ever has one view, so the toggle isn't rendered for them.
  const [clubView, setClubView] = useState(false);
  const [data, setData] = useState<ApiFinances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  // The line a delete has been asked for but not yet confirmed. Deleting is
  // the only action here with no undo, so it goes through a dialog that names
  // the line and its amount rather than a second tap on the same button.
  const [confirmingDelete, setConfirmingDelete] = useState<ApiCharge | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  usePageLoading(data === null);

  const wantsClub = clubView && canReadAll;

  const load = useCallback(async () => {
    const query = `period=${period}${wantsClub ? "&all=1" : ""}`;
    setData(await fetchJsonObject<ApiFinances>(`/api/finances?${query}`));
  }, [period, wantsClub]);

  useEffect(() => {
    load();
  }, [load]);

  const periods = useMemo(() => recentPeriods(13), []);

  // The club's bottom line for the month, for the officer view.
  const clubTotals = useMemo(() => {
    if (!data) return null;
    return data.statements.reduce(
      (acc, s) => ({
        chargedCents: acc.chargedCents + s.chargedCents,
        creditedCents: acc.creditedCents + s.creditedCents,
        balanceCents: acc.balanceCents + s.balanceCents,
        paidCents: acc.paidCents + s.paidCents,
        outstandingCents: acc.outstandingCents + s.outstandingCents,
      }),
      {
        chargedCents: 0,
        creditedCents: 0,
        balanceCents: 0,
        paidCents: 0,
        outstandingCents: 0,
      }
    );
  }, [data]);

  async function voidCharge(charge: ApiCharge, voided: boolean) {
    setError(null);
    setBusy(true);
    const result = await sendJson<ApiCharge>(
      `/api/finances/charges/${charge.id}`,
      "PATCH",
      { voided }
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change that charge.");
      return;
    }
    await load();
  }

  /** Tick a line off as settled — or un-tick it, for the wrong row. */
  async function setPaid(charge: ApiCharge, paid: boolean) {
    setError(null);
    setBusy(true);
    const result = await sendJson<ApiCharge>(
      `/api/finances/charges/${charge.id}`,
      "PATCH",
      { paid }
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change that charge.");
      return;
    }
    await load();
  }

  /**
   * Remove a line for good.
   *
   * Only ever reached through the confirm dialog below — this is the one
   * action on the page that leaves no trace, and the API refuses it outright
   * for a derived line (a flight's charge would only come back the next time
   * the flight was corrected). Its error is shown rather than swallowed, since
   * "void it instead" is exactly what the officer needs to hear.
   */
  async function deleteCharge(charge: ApiCharge) {
    setError(null);
    setBusy(true);
    const result = await sendJson(`/api/finances/charges/${charge.id}`, "DELETE");
    setBusy(false);
    setConfirmingDelete(null);
    if (!result.ok) {
      setError(result.error ?? "Could not delete that charge.");
      return;
    }
    await load();
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Finances</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatPeriod(data.period)}
            {data.clubWide
              ? ` · ${data.statements.length} members`
              : " · your charges"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Month"
            hideLabel
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {formatPeriod(p)}
              </option>
            ))}
          </Select>

          {canReadAll && (
            <div className="flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
              <button
                onClick={() => setClubView(false)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  !clubView
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                Mine
              </button>
              <button
                onClick={() => setClubView(true)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  clubView
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                Club
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {canManage && (
        <OfficerOnly office="Finance Officer">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">
              Add charges and credits, set the club&apos;s dues and hourly rate.
            </span>
            {/* Named for WHAT each one writes, not for the verb: one line on
                this month's statement, versus the standing rule that bills
                every month. "Add"/"Rules" read as generic chrome. */}
            <Button size="sm" onClick={() => setAddOpen(true)}>
              One Off
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRulesOpen(true)}>
              Recurring
            </Button>
          </div>
        </OfficerOnly>
      )}

      {data.clubWide && clubTotals && (
        <Card className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">
            Outstanding across the club
            {/* Payments come off this figure and leave the month's totals
                alone — see `totals` in lib/finance.ts. */}
            {clubTotals.paidCents !== 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                {formatMoney(clubTotals.paidCents)} of{" "}
                {formatMoney(clubTotals.balanceCents)} settled
              </span>
            )}
          </span>
          <span
            className={`tabular text-xl font-bold ${
              clubTotals.outstandingCents < 0
                ? "text-green-600 dark:text-green-400"
                : ""
            }`}
          >
            {formatMoney(clubTotals.outstandingCents)}
          </span>
        </Card>
      )}

      {data.statements.map((statement) => (
        <StatementCard
          key={statement.member.id}
          statement={statement}
          showName={data.clubWide}
          canManage={canManage}
          busy={busy}
          onVoid={voidCharge}
          onPaid={setPaid}
          onDelete={(charge) => setConfirmingDelete(charge)}
        />
      ))}

      {/* Deleting a line is the one thing on this page that can't be undone —
          voiding keeps the record, and un-ticking "paid" is free. So it asks,
          and it names the line and the amount it's about to remove. */}
      {confirmingDelete && (
        <Modal
          open
          onClose={() => setConfirmingDelete(null)}
          title="Delete this line?"
          subtitle={`${confirmingDelete.description} · ${formatMoney(
            confirmingDelete.amountCents
          )}`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteCharge(confirmingDelete)}
                disabled={busy}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            It disappears from {confirmingDelete.member.name}&rsquo;s statement
            and from the club&rsquo;s totals, with no record that it was ever
            there. To unwind a charge and keep the trail, <strong>void</strong>{" "}
            it instead.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Lines that came from a flight or a recurring rule can&rsquo;t be
            deleted at all — they would be rebuilt from their source. Void those.
          </p>
        </Modal>
      )}

      {addOpen && (
        <AddChargeModal
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            await load();
          }}
        />
      )}

      {rulesOpen && (
        <RulesModal
          fleet={fleet ?? []}
          initialAircraftId={selected?.id ?? null}
          onClose={() => setRulesOpen(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}


/** One member's month. */
function StatementCard({
  statement,
  showName,
  canManage,
  busy,
  onVoid,
  onPaid,
  onDelete,
}: {
  statement: ApiStatement;
  showName: boolean;
  canManage: boolean;
  busy: boolean;
  onVoid: (charge: ApiCharge, voided: boolean) => void;
  onPaid: (charge: ApiCharge, paid: boolean) => void;
  onDelete: (charge: ApiCharge) => void;
}) {
  return (
    <Card className="space-y-3">
      {/* Name only. The one number that matters is the balance, and it lives
          at the foot of the table where the column of amounts adds up to it —
          repeating it up here just gave the eye two places to look. */}
      <h2 className="text-sm font-semibold">
        {showName ? statement.member.name : "Your charges"}
      </h2>

      {statement.charges.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing on this month&apos;s statement.
        </p>
      ) : (
        // A statement is columnar data, so it's a real table: dates under
        // dates and amounts under amounts, which is what makes a column of
        // money scannable. It scrolls inside its own box rather than widening
        // the page on a phone.
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <caption className="sr-only">
              {statement.member.name}&apos;s charges for this month
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th scope="col" className="py-1.5 pl-1 pr-3 text-left font-medium">
                  Date
                </th>
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                  Type
                </th>
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                  Description
                </th>
                <th scope="col" className="py-1.5 pr-1 text-right font-medium">
                  Amount
                </th>
                {canManage && (
                  <th scope="col" className="py-1.5 pl-3 pr-1 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {statement.charges.map((charge) => {
                // Voided and paid both quieten the row, and they are NOT the
                // same claim: voided is struck through (it should never have
                // stood), paid keeps its amount and its strikethrough-free
                // description, with a tick to say it's settled.
                const muted = charge.voided;
                const paid = Boolean(charge.paidAt);
                return (
                  <tr key={charge.id}>
                    <td className="whitespace-nowrap py-2 pl-1 pr-3 text-gray-500 dark:text-gray-400">
                      {formatDay(new Date(charge.incurredOn))}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={KIND_TONES[charge.kind]}>
                        {CHARGE_KIND_LABELS[charge.kind]}
                      </Badge>
                    </td>
                    <td
                      className={`py-2 pr-3 ${
                        muted ? "text-gray-400 line-through dark:text-gray-500" : ""
                      }`}
                    >
                      {charge.description}
                      {muted && (
                        <span className="ml-2 align-middle text-xs uppercase tracking-wide text-gray-400 no-underline">
                          voided
                        </span>
                      )}
                      {paid && !muted && (
                        <span
                          className="ml-2 align-middle text-xs font-medium text-green-700 dark:text-green-400"
                          title={
                            charge.paidBy
                              ? `Marked paid by ${charge.paidBy.name}`
                              : undefined
                          }
                        >
                          ✓ paid
                          {charge.paidAt
                            ? ` ${formatDay(new Date(charge.paidAt))}`
                            : ""}
                        </span>
                      )}
                    </td>
                    <td
                      className={`tabular whitespace-nowrap py-2 pr-1 text-right font-medium ${
                        muted
                          ? "text-gray-400 line-through dark:text-gray-500"
                          : charge.amountCents < 0
                            ? "text-green-600 dark:text-green-400"
                            : ""
                      }`}
                    >
                      {formatMoney(charge.amountCents)}
                    </td>
                    {canManage && (
                      <td className="py-2 pl-3 pr-1 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {/* The everyday action, first: the member paid. A
                              checkbox rather than a verb, because it toggles
                              and its state IS the answer. */}
                          {!charge.voided && (
                            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <input
                                type="checkbox"
                                checked={paid}
                                disabled={busy}
                                onChange={(e) => onPaid(charge, e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
                                aria-label={`Paid — ${charge.description}`}
                              />
                              Paid
                            </label>
                          )}
                          <button
                            onClick={() => onVoid(charge, !charge.voided)}
                            disabled={busy}
                            className="text-xs font-medium text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
                          >
                            {charge.voided ? "Restore" : "Void"}
                          </button>
                          <button
                            onClick={() => onDelete(charge)}
                            disabled={busy}
                            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* One highlighted total, sitting under the column it's the sum
                of. Negative = the club owes the member, so it reads green. */}
            <tfoot className="border-t-2 border-gray-300 dark:border-gray-600">
              <tr>
                <th
                  scope="row"
                  colSpan={3}
                  className="py-2 pl-1 pr-3 text-right text-sm font-semibold"
                >
                  {statement.balanceCents < 0 ? "Owed to you" : "Balance"}
                </th>
                <td
                  className={`tabular whitespace-nowrap py-2 pr-1 text-right text-lg font-bold ${
                    statement.balanceCents < 0
                      ? "text-green-600 dark:text-green-400"
                      : ""
                  }`}
                >
                  {formatMoney(Math.abs(statement.balanceCents))}
                </td>
                {canManage && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Bill a member, or credit one.
 *
 * Both are the same ledger row with an opposite sign, but asking an officer to
 * type a negative number is a trap: the minus sign is invisible in a summary
 * and easy to forget, and getting it backwards moves money the wrong way twice
 * over. So the direction is an explicit choice, the amount is always typed as a
 * positive number, and the sentence above the button says in words what is
 * about to be recorded.
 */
function AddChargeModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<ApiMember[] | null>(null);
  const [memberId, setMemberId] = useState("");
  const [direction, setDirection] = useState<"charge" | "credit">("charge");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJsonArray<ApiMember>("/api/members").then((rows) => {
      setMembers(rows);
      setMemberId((current) => current || (rows[0]?.id ?? ""));
    });
  }, []);

  const crediting = direction === "credit";
  const cents = parseDollars(amount);
  const member = (members ?? []).find((m) => m.id === memberId);
  // Preview the exact line that will land on the statement.
  const preview =
    cents !== null && cents > 0 && member
      ? crediting
        ? `${member.name} will be credited ${formatMoney(cents)}.`
        : `${member.name} will be charged ${formatMoney(cents)}.`
      : null;

  async function submit() {
    setError(null);
    if (cents === null || cents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    const result = await sendJson("/api/finances/charges", "POST", {
      memberId,
      description,
      // The toggle owns the sign; the field is always a positive number.
      amountDollars: (crediting ? -cents : cents) / 100,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that.");
      return;
    }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={crediting ? "Credit a member" : "Charge a member"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <DirectionButton
            active={!crediting}
            onClick={() => setDirection("charge")}
            title="Charge"
            blurb="They owe the club"
          />
          <DirectionButton
            active={crediting}
            onClick={() => setDirection("credit")}
            title="Credit"
            blurb="The club owes them"
          />
        </div>

        <Select
          label="Member"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        >
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Input
          label="What for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={crediting ? "Refund — fuel receipt" : "Checkout fee"}
        />

        <Input
          label="Amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="dollars"
        />

        {preview && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              crediting
                ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                : "bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200"
            }`}
          >
            {preview}
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button onClick={submit} disabled={busy || !memberId}>
            {busy ? (
              <LoadingDots size="sm" />
            ) : crediting ? (
              "Add credit"
            ) : (
              "Add charge"
            )}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One half of the charge/credit switch. */
function DirectionButton({
  active,
  onClick,
  title,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        {title}
      </span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">{blurb}</span>
    </button>
  );
}

/**
 * The standing monthly charges, and the price of an hour.
 *
 * The rate is per AIRPLANE — a club with a 172 and a Cherokee charges
 * differently for each — so the officer picks the airplane first and the field
 * follows it. This is the only place the rate can be set: it's a price, so it
 * doesn't belong in club settings next to the tail number and the fuel capacity.
 */
function RulesModal({
  fleet,
  initialAircraftId,
  onClose,
  onChanged,
}: {
  fleet: ApiAircraft[];
  initialAircraftId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<ApiRecurringCharge[] | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [aircraftId, setAircraftId] = useState(
    initialAircraftId ?? fleet[0]?.id ?? ""
  );
  const chosen = fleet.find((a) => a.id === aircraftId) ?? null;
  const tailNumber = chosen?.tailNumber ?? "";
  const [rate, setRate] = useState(
    chosen?.hourlyRateCents != null ? (chosen.hourlyRateCents / 100).toFixed(2) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching airplane loads that airplane's rate into the field. Keyed on the
  // id rather than the object so the provider's periodic refetch — which hands
  // back a new object every time — doesn't wipe what's being typed.
  useEffect(() => {
    const next = fleet.find((a) => a.id === aircraftId);
    setRate(
      next?.hourlyRateCents != null ? (next.hourlyRateCents / 100).toFixed(2) : ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftId]);

  const loadRules = useCallback(async () => {
    setRules(await fetchJsonArray<ApiRecurringCharge>("/api/finances/recurring"));
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  async function addRule() {
    setError(null);
    setBusy(true);
    const result = await sendJson("/api/finances/recurring", "POST", {
      label,
      amountDollars: amount,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add that recurring charge.");
      return;
    }
    setLabel("");
    setAmount("");
    await loadRules();
    onChanged();
  }

  async function toggleRule(rule: ApiRecurringCharge) {
    setBusy(true);
    await sendJson(`/api/finances/recurring/${rule.id}`, "PATCH", {
      active: !rule.active,
    });
    setBusy(false);
    await loadRules();
    onChanged();
  }

  async function saveRate() {
    if (!aircraftId) return;
    setError(null);
    setBusy(true);
    const cents = Math.round(Number(rate) * 100);
    const result = await sendJson(`/api/aircraft/${aircraftId}`, "PATCH", {
      hourlyRateCents: Number.isFinite(cents) ? cents : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change the rate.");
      return;
    }
    // The fleet's rate is cached in the provider, and every page shows it.
    notifyAircraftChanged();
  }

  return (
    <Modal open onClose={onClose} title="Recurring charges & rate" size="lg">
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Hourly rate</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Charged per tach hour on every filed flight. Changing it prices
            future flights — statements already issued keep the rate they were
            billed at.
          </p>
          {fleet.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No airplanes in the fleet yet.
            </p>
          ) : (
            <Select
              label="Airplane"
              value={aircraftId}
              onChange={(e) => setAircraftId(e.target.value)}
            >
              {fleet.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tailNumber}
                  {a.model ? ` — ${a.model}` : ""}
                  {a.hourlyRateCents != null
                    ? ` · ${formatMoney(a.hourlyRateCents)}/hr`
                    : " · no rate set"}
                </option>
              ))}
            </Select>
          )}
          {/* Field on its own line, action beneath it. Sitting a Button next
              to an Input in an items-end flex looks aligned until one of them
              grows a hint or an error, at which point the labels stagger. */}
          <Input
            label={
              tailNumber ? `Dollars per tach hour — ${tailNumber}` : "Dollars per tach hour"
            }
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={saveRate}
              disabled={busy || !aircraftId || rate === ""}
            >
              Save
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Monthly charges</h3>
          {rules === null ? (
            <LoadingDots size="sm" />
          ) : rules.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              None yet — add one below and every member is billed it each month.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                      Charge
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                      Billed to
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rules.map((rule) => (
                    <tr key={rule.id} className={rule.active ? "" : "opacity-60"}>
                      <td className="py-2 pr-3">
                        {rule.label}
                        {!rule.active && (
                          <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">
                            stopped
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">
                        {rule.member ? rule.member.name : "Every member"}
                      </td>
                      <td className="tabular whitespace-nowrap py-2 pr-3 text-right font-medium">
                        {formatMoney(rule.amountCents)}/mo
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => toggleRule(rule)}
                          disabled={busy}
                          className="text-xs font-medium text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
                        >
                          {rule.active ? "Stop" : "Restart"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Both fields the same shape, on a grid, with the action on its own
              row — the old side-by-side row staggered because only one of them
              carried a hint. */}
          <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              A new monthly charge bills every member, starting this month.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Monthly membership"
              />
              <Input
                label="Amount per month"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="250.00"
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={addRule}
                disabled={busy || !label.trim() || amount === ""}
              >
                Add
              </Button>
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
