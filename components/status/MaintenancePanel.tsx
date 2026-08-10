"use client";
// What the airplane is due for — the club's maintenance sheet, on the page
// that answers "can I go flying".
//
// The club has kept this in a spreadsheet whose ten columns are arithmetic on
// four typed-in facts, and the one box anybody actually reads is at the bottom:
// "Next-Due Maintenance Item". So that's what this leads with, and the rest of
// the sheet is underneath it in the order things come due rather than in the
// order they were entered.
//
// On form, the same rule the rest of Plane Status follows: every item gets a
// countdown BAR against its own interval, because "19.3" means nothing until
// you know it's 19.3 of 50. Status colour never travels alone — every toned row
// prints its state in words as well (see components/status/Meter.tsx).
//
// Editing is gated on `maintenance:manage` (the Maintenance Officer, or an
// admin). The API re-checks it on every write; hiding the buttons is a
// courtesy, not the control.
import { useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import Textarea from "@/components/common/Textarea";
import { notifyAircraftChanged } from "@/components/AircraftProvider";
import { sendJson } from "@/lib/api";
import { formatFullDate, toDateInputValue } from "@/lib/dates";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_STATE_LABELS,
  MAINTENANCE_STATE_TONES,
  byUrgency,
  formatRemaining,
  maintenanceDue,
  nextDue,
  type MaintenanceCategory,
  type MaintenanceDue,
} from "@/lib/maintenance";
import type { ApiAircraft, ApiMaintenanceItem } from "@/lib/types";

export default function MaintenancePanel({
  aircraft,
  canManage,
}: {
  aircraft: ApiAircraft;
  canManage: boolean;
}) {
  // The item being edited, or "new" for the add form. Null = nothing open.
  const [editing, setEditing] = useState<ApiMaintenanceItem | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The item a sign-off has been asked for but not yet confirmed. Marking
  // something done is a claim about the airplane's airworthiness that resets
  // both of its clocks — a year of annual, or 50 hours of oil — so it goes
  // through a dialog that states what it is about to write, rather than
  // happening on a single tap next to "Edit".
  const [confirmingDone, setConfirmingDone] = useState<ApiMaintenanceItem | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const tach = aircraft.lastTach;
  const items = aircraft.maintenance;
  const sorted = byUrgency(items, tach);
  const next = nextDue(items, tach);

  /**
   * Sign an item off at today's date and the airplane's current tach — the
   * one-tap version of the write this whole panel exists for, and the only
   * one that happens more than once a year.
   *
   * Both clocks are restarted together because that's what a signature does:
   * the shop hands the airplane back, and the item is good for another 50
   * hours AND another 4 months from that moment.
   */
  async function markDone(item: ApiMaintenanceItem) {
    setError(null);
    setBusyId(item.id);
    const result = await sendJson(`/api/maintenance/${item.id}`, "PATCH", {
      // Noon rather than midnight: this is a calendar date, and a midnight
      // local value read back further east lands on the day before.
      lastDoneOn: `${toDateInputValue(new Date())}T12:00:00`,
      // Null when the airplane has no meter reading at all — better an item
      // with no hour countdown than one anchored to a zero nobody measured.
      lastDoneTach: tach,
    });
    setBusyId(null);
    setConfirmingDone(null);
    if (!result.ok) {
      setError(result.error ?? "Could not record that.");
      return;
    }
    notifyAircraftChanged();
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Maintenance</h2>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            Add item
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing tracked yet.{" "}
          {canManage
            ? "Add the annual, the oil change and the equipment checks and the countdowns look after themselves."
            : "The Maintenance Officer keeps this list."}
        </p>
      ) : (
        <>
          {/* The sheet's own bottom line, first: one item, both clocks. */}
          {next && <NextDueStrip item={next} tach={tach} />}

          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map((item) => (
              <MaintenanceRow
                key={item.id}
                item={item}
                tach={tach}
                canManage={canManage}
                busy={busyId === item.id}
                onDone={() => setConfirmingDone(item)}
                onEdit={() => setEditing(item)}
              />
            ))}
          </ul>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Counted against tach{" "}
            {tach != null ? tach.toFixed(1) : "—"} and today&rsquo;s date.
            Calendar items run to the END of their month, the way 14 CFR counts
            them.
          </p>
        </>
      )}

      {confirmingDone && (
        <MarkDoneModal
          item={confirmingDone}
          tach={tach}
          busy={busyId === confirmingDone.id}
          onCancel={() => setConfirmingDone(null)}
          onConfirm={() => markDone(confirmingDone)}
        />
      )}

      {editing && (
        <MaintenanceItemModal
          aircraftId={aircraft.id}
          item={editing === "new" ? null : editing}
          currentTach={tach}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notifyAircraftChanged();
          }}
        />
      )}
    </Card>
  );
}

/**
 * The hero: the one thing the club is next due for.
 *
 * Both countdowns are printed even though only one of them is what's binding,
 * because the question this answers on a Saturday morning is "have I got time
 * to fly it before this needs doing", and that's two questions — how many
 * hours, and how many days.
 */
function NextDueStrip({
  item,
  tach,
}: {
  item: ApiMaintenanceItem;
  tach: number | null;
}) {
  const due = maintenanceDue(item, tach);
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${TONE_SURFACE[due.state]}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide opacity-70">Next due</p>
        <Badge tone={MAINTENANCE_STATE_TONES[due.state]}>
          {MAINTENANCE_STATE_LABELS[due.state]}
        </Badge>
      </div>
      <p className="mt-1 text-lg font-semibold">{item.label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        {due.hoursRemaining != null && (
          <span>
            <span className="text-2xl font-bold">
              {due.hoursRemaining.toFixed(1)}
            </span>{" "}
            hrs
          </span>
        )}
        {due.daysRemaining != null && (
          <span>
            <span className="text-2xl font-bold">{due.daysRemaining}</span> days
          </span>
        )}
        <span className="opacity-70">whichever comes first</span>
      </div>
    </div>
  );
}

/** Row surfaces, keyed by state — a tint, not the badge's fill. */
const TONE_SURFACE: Record<string, string> = {
  OVERDUE:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-100",
  DUE_SOON:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-100",
  OK: "border-gray-200 dark:border-gray-700",
  UNTRACKED: "border-dashed border-gray-300 dark:border-gray-600",
};

const BAR_FILL: Record<string, string> = {
  OVERDUE: "bg-red-600 dark:bg-red-500",
  DUE_SOON: "bg-amber-500 dark:bg-amber-400",
  OK: "bg-green-600 dark:bg-green-500",
  UNTRACKED: "bg-gray-300 dark:bg-gray-600",
};

function MaintenanceRow({
  item,
  tach,
  canManage,
  busy,
  onDone,
  onEdit,
}: {
  item: ApiMaintenanceItem;
  tach: number | null;
  canManage: boolean;
  busy: boolean;
  onDone: () => void;
  onEdit: () => void;
}) {
  const due = maintenanceDue(item, tach);

  return (
    <li className="flex flex-wrap items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          <Badge tone={MAINTENANCE_STATE_TONES[due.state]}>
            {MAINTENANCE_STATE_LABELS[due.state]}
          </Badge>
          {/* What an overdue item MEANS. Only the law grounds an airplane; the
              club's own schedule being late is a different sentence, and
              saying "grounded" for both would wear the word out. */}
          {item.requiredByReg && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              Required
            </span>
          )}
          {item.reference && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {item.reference}
            </span>
          )}
        </div>

        <CountdownBars due={due} />

        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {item.lastDoneOn || item.lastDoneTach != null ? (
            <>
              Last done
              {item.lastDoneOn && ` ${formatFullDate(new Date(item.lastDoneOn))}`}
              {item.lastDoneTach != null && ` at tach ${item.lastDoneTach.toFixed(1)}`}
            </>
          ) : (
            "Never recorded"
          )}
          {item.notes ? ` · ${item.notes}` : ""}
        </p>
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          {busy ? (
            <LoadingDots size="sm" />
          ) : (
            <>
              {/* The write that happens most: the shop handed it back today. */}
              <Button size="sm" variant="secondary" onClick={onDone}>
                Mark done
              </Button>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The two countdowns, each against its own interval.
 *
 * A bar per clock rather than one bar for "the tightest": an item can be
 * comfortable on hours and nearly out of calendar, and that's precisely the
 * case the club's spreadsheet made hard to see.
 */
function CountdownBars({ due }: { due: MaintenanceDue }) {
  if (due.state === "UNTRACKED") {
    return (
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        No interval recorded — this item never comes due on its own.
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {due.hoursRemaining != null && due.dueAtTach != null && (
        <Countdown
          state={due.state}
          // Fraction of the interval left. Clamped by the bar itself, so an
          // overdue item simply reads empty rather than drawing backwards.
          fraction={due.hoursRemaining / Math.max(1, due.dueAtTach)}
          text={`${
            due.hoursRemaining < 0
              ? `${Math.abs(due.hoursRemaining).toFixed(1)} hrs over`
              : `${due.hoursRemaining.toFixed(1)} hrs left`
          } · due at tach ${due.dueAtTach.toFixed(1)}`}
          leading={due.limitedBy === "hours"}
        />
      )}
      {due.daysRemaining != null && due.dueOn != null && (
        <Countdown
          state={due.state}
          fraction={due.daysRemaining / 365}
          text={`${
            due.daysRemaining < 0
              ? `${Math.abs(due.daysRemaining)} days over`
              : due.daysRemaining === 0
                ? "due today"
                : `${due.daysRemaining} days left`
          } · due ${formatFullDate(due.dueOn)}`}
          leading={due.limitedBy === "calendar"}
        />
      )}
      {due.limitedBy && (
        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {formatRemaining(due)} to go
        </p>
      )}
    </div>
  );
}

function Countdown({
  state,
  fraction,
  text,
  leading,
}: {
  state: string;
  fraction: number;
  text: string;
  leading: boolean;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full rounded-full ${BAR_FILL[state]} ${
            // The clock that isn't binding is drawn quieter, so the row has one
            // answer rather than two competing ones.
            leading ? "" : "opacity-40"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`text-xs ${
          leading
            ? "text-gray-600 dark:text-gray-300"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * "The shop handed it back" — stated before it's written.
 *
 * The dialog exists because the write is bigger than the button: it restarts
 * BOTH clocks from today and from the airplane's current tach, which for an
 * annual is a year of airworthiness. Naming the two dates it is about to store,
 * and what they make the item due at, turns a mis-tap into something you can
 * see before you commit it rather than something you notice next July.
 */
function MarkDoneModal({
  item,
  tach,
  busy,
  onCancel,
  onConfirm,
}: {
  item: ApiMaintenanceItem;
  tach: number | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const today = new Date();
  // What the item WILL be due at once this is recorded — the same arithmetic
  // the gauges use, run forward over the values about to be stored.
  const after = maintenanceDue(
    {
      ...item,
      lastDoneOn: today,
      lastDoneTach: tach,
    },
    tach,
    today
  );

  return (
    <Modal
      open
      onClose={onCancel}
      title="Mark this done?"
      subtitle={item.label}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Mark done"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-300">
          This records that <strong>{item.label}</strong> was signed off today,{" "}
          {formatFullDate(today)}
          {tach != null ? (
            <>
              , at tach <strong>{tach.toFixed(1)}</strong>
            </>
          ) : (
            " (the airplane has no tach reading on file, so the hour countdown won't restart)"
          )}
          .
        </p>

        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/40">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            It will next be due
          </p>
          <p className="mt-0.5">
            {after.dueAtTach != null && (
              <>
                at tach <strong>{after.dueAtTach.toFixed(1)}</strong>
                {after.dueOn ? " or " : ""}
              </>
            )}
            {after.dueOn && (
              <>
                on <strong>{formatFullDate(after.dueOn)}</strong>
              </>
            )}
            {after.dueAtTach == null && after.dueOn == null && (
              <>never — this item has no interval recorded.</>
            )}
            {after.dueAtTach != null && after.dueOn != null
              ? ", whichever comes first."
              : ""}
          </p>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Signed off on a different day, or at a different tach? Use{" "}
          <strong>Edit</strong> instead and type the dates off the logbook entry.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Add or correct one item.
 *
 * The four facts, and nothing derived: everything else on the panel is a
 * function of these, so there is no "days remaining" here to get out of step
 * with the airplane.
 */
function MaintenanceItemModal({
  aircraftId,
  item,
  currentTach,
  onClose,
  onSaved,
}: {
  aircraftId: string;
  item: ApiMaintenanceItem | null;
  currentTach: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(item?.label ?? "");
  const [category, setCategory] = useState<MaintenanceCategory>(
    item?.category ?? "INSPECTION"
  );
  const [requiredByReg, setRequiredByReg] = useState(item?.requiredByReg ?? false);
  const [reference, setReference] = useState(item?.reference ?? "");
  const [intervalHours, setIntervalHours] = useState(
    item?.intervalHours == null ? "" : String(item.intervalHours)
  );
  const [intervalMonths, setIntervalMonths] = useState(
    item?.intervalMonths == null ? "" : String(item.intervalMonths)
  );
  const [lastDoneTach, setLastDoneTach] = useState(
    item?.lastDoneTach == null ? "" : String(item.lastDoneTach)
  );
  const [lastDoneOn, setLastDoneOn] = useState(
    item?.lastDoneOn ? toDateInputValue(new Date(item.lastDoneOn)) : ""
  );
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    const body = {
      aircraftId,
      label,
      category,
      requiredByReg,
      reference: reference.trim() || null,
      intervalHours: intervalHours === "" ? null : Number(intervalHours),
      intervalMonths: intervalMonths === "" ? null : Number(intervalMonths),
      lastDoneTach: lastDoneTach === "" ? null : Number(lastDoneTach),
      lastDoneOn: lastDoneOn === "" ? null : `${lastDoneOn}T12:00:00`,
      notes: notes.trim() || null,
    };
    const result = item
      ? await sendJson(`/api/maintenance/${item.id}`, "PATCH", body)
      : await sendJson("/api/maintenance", "POST", body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that item.");
      return;
    }
    onSaved();
  }

  async function remove(hard: boolean) {
    setError(null);
    setBusy(true);
    // Two ways off the list, and they mean different things: RETIRE keeps the
    // row and its dates (the equipment came out, the club stopped tracking
    // it), DELETE is for a row that shouldn't have existed.
    const result = hard
      ? await sendJson(`/api/maintenance/${item!.id}`, "DELETE")
      : await sendJson(`/api/maintenance/${item!.id}`, "PATCH", { active: false });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not remove that item.");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? item.label : "Add a maintenance item"}
      subtitle="Only what's typed in — every countdown is worked out from these."
      footer={
        <>
          {item && !confirmingDelete && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              Remove
            </Button>
          )}
          {item && confirmingDelete && (
            <div className="mr-auto flex gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => remove(false)}>
                Retire
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(true)}>
                Delete
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !label.trim()}>
            {busy ? <LoadingDots size="sm" /> : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {confirmingDelete && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            <strong>Retire</strong> keeps this item and its last-done dates but
            takes it off the airplane&rsquo;s list. <strong>Delete</strong>{" "}
            removes it and its history for good.
          </p>
        )}

        <Input
          label="Item"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Engine oil change"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Section"
            value={category}
            onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}
          >
            {MAINTENANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MAINTENANCE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <Input
            label="Regulation (optional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="14 CFR 91.413"
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiredByReg}
            onChange={(e) => setRequiredByReg(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
          />
          <span>
            Required by regulation
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Overdue means the airplane doesn&rsquo;t fly, and the club is told
              so in red. Leave it off for the club&rsquo;s own schedule.
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Every (hours)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={intervalHours}
            onChange={(e) => setIntervalHours(e.target.value)}
            hint="Tach hours. Blank if this item has no hour limit."
          />
          <Input
            label="Every (calendar months)"
            type="number"
            inputMode="numeric"
            min="0"
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(e.target.value)}
            hint="Good through the END of that month, per 14 CFR."
          />
          <Input
            label="Last done at tach"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={lastDoneTach}
            onChange={(e) => setLastDoneTach(e.target.value)}
            hint={
              currentTach != null
                ? `The airplane is at ${currentTach.toFixed(1)} now.`
                : "The airplane has no tach reading on file."
            }
          />
          <Input
            label="Last done on"
            type="date"
            value={lastDoneOn}
            onChange={(e) => setLastDoneOn(e.target.value)}
          />
        </div>

        <Textarea
          label="Notes (optional)"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
