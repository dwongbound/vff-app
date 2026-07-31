"use client";
// Book the airplane, or open an existing booking to edit/cancel it.
//
// One component handles both because the fields are identical — `reservation`
// null means "new". The same lib/reservations rules the API enforces run here
// first, so an impossible booking is caught before the round-trip.
import { useEffect, useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import DateTimeField from "./common/DateTimeField";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import Select from "./common/Select";
import Textarea from "./common/Textarea";
import { sendJson } from "@/lib/api";
import {
  DEFAULT_RESERVATION_HOURS,
  MAX_ADVANCE_DAYS,
  PURPOSES,
  PURPOSE_LABELS,
  PURPOSE_TONES,
  type Purpose,
} from "@/lib/constants";
import {
  addDays,
  addMinutes,
  formatDuration,
  formatFullDate,
  splitLocalDateTime,
  toDateInputValue,
  toLocalInputValue,
} from "@/lib/dates";
import { validateReservation } from "@/lib/reservations";
import type { ApiReservation } from "@/lib/types";

export default function ReservationModal({
  open,
  onClose,
  aircraftId,
  tailNumber,
  reservation,
  initialDate,
  canManage,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  aircraftId: string;
  tailNumber: string;
  /** Existing booking to edit, or null to create a new one. */
  reservation: ApiReservation | null;
  /** For a new booking: the day the user clicked (defaults to now). */
  initialDate?: Date | null;
  /** Whether the viewer may edit/cancel this booking (owner or admin). */
  canManage: boolean;
  onSaved: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("LOCAL");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Two-step cancel: the destructive action shouldn't be one stray tap.
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Reset the form every time the modal opens, so a previous booking's values
  // never bleed into the next one.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmingCancel(false);
    if (reservation) {
      setStart(toLocalInputValue(new Date(reservation.startsAt)));
      setEnd(toLocalInputValue(new Date(reservation.endsAt)));
      setPurpose(reservation.purpose);
      setNotes(reservation.notes ?? "");
      return;
    }
    // New booking: start at the next whole hour of the chosen day (or now),
    // running the club's default block length.
    const base = initialDate ? new Date(initialDate) : new Date();
    const now = new Date();
    if (initialDate && base.toDateString() !== now.toDateString()) {
      base.setHours(9, 0, 0, 0); // a fresh day starts at a sensible 9am
    } else {
      base.setHours(now.getHours() + 1, 0, 0, 0);
    }
    setStart(toLocalInputValue(base));
    setEnd(toLocalInputValue(addMinutes(base, DEFAULT_RESERVATION_HOURS * 60)));
    setPurpose("LOCAL");
    setNotes("");
  }, [open, reservation, initialDate]);

  // Keep the block length when the start moves: a pilot picking a new
  // departure time almost never wants to re-type the end time too.
  function onStartChange(value: string) {
    const previousStart = new Date(start);
    const previousEnd = new Date(end);
    setStart(value);
    if (
      !Number.isNaN(previousStart.getTime()) &&
      !Number.isNaN(previousEnd.getTime()) &&
      previousEnd > previousStart
    ) {
      const minutes = (previousEnd.getTime() - previousStart.getTime()) / 60000;
      const next = new Date(value);
      if (!Number.isNaN(next.getTime())) {
        setEnd(toLocalInputValue(addMinutes(next, minutes)));
      }
    }
  }

  const startsAt = new Date(start);
  const endsAt = new Date(end);
  const timesUsable =
    !Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime());

  async function save() {
    setError(null);
    const invalid = validateReservation({ startsAt, endsAt });
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const payload = {
      aircraftId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      purpose,
      notes: notes.trim() || null,
    };
    const result = reservation
      ? await sendJson(`/api/reservations/${reservation.id}`, "PATCH", payload)
      : await sendJson("/api/reservations", "POST", payload);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  async function cancelBooking() {
    if (!reservation) return;
    setBusy(true);
    const result = await sendJson(`/api/reservations/${reservation.id}`, "DELETE");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  // Someone else's booking: show it read-only rather than a form you can't
  // submit. Knowing who has the airplane (and how to reach them about a swap)
  // is the whole reason you tapped it.
  if (reservation && !canManage) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={reservation.user.name}
        subtitle={`${tailNumber} · ${formatFullDate(reservation.startsAt)}`}
      >
        <dl className="space-y-3 text-sm">
          <Row label="Time">
            {new Date(reservation.startsAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            {" – "}
            {new Date(reservation.endsAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            <span className="ml-2 text-gray-500">
              ({formatDuration(reservation.startsAt, reservation.endsAt)})
            </span>
          </Row>
          <Row label="Purpose">
            <Badge tone={PURPOSE_TONES[reservation.purpose]}>
              {PURPOSE_LABELS[reservation.purpose]}
            </Badge>
          </Row>
          {reservation.notes && <Row label="Notes">{reservation.notes}</Row>}
          {reservation.user.email && (
            <Row label="Contact">
              <a
                href={`mailto:${reservation.user.email}`}
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {reservation.user.email}
              </a>
            </Row>
          )}
        </dl>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reservation ? "Your booking" : `Book ${tailNumber}`}
      subtitle={
        timesUsable && endsAt > startsAt
          ? `${formatFullDate(startsAt)} · ${formatDuration(startsAt, endsAt)}`
          : tailNumber
      }
      footer={
        <>
          {reservation && (
            <Button
              variant={confirmingCancel ? "danger" : "ghost"}
              onClick={() =>
                confirmingCancel ? cancelBooking() : setConfirmingCancel(true)
              }
              disabled={busy}
              className="mr-auto"
            >
              {confirmingCancel ? "Yes, cancel it" : "Cancel booking"}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : reservation ? "Save changes" : "Book it"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DateTimeField
          label="Start"
          value={start}
          onChange={onStartChange}
          // No point offering days the club won't accept a booking on.
          min={toDateInputValue(new Date())}
          max={toDateInputValue(addDays(new Date(), MAX_ADVANCE_DAYS))}
        />
        <DateTimeField
          label="End"
          value={end}
          onChange={setEnd}
          min={splitLocalDateTime(start).date || toDateInputValue(new Date())}
          hint={
            timesUsable && endsAt > startsAt
              ? `You'll have the airplane for ${formatDuration(startsAt, endsAt)}.`
              : undefined
          }
        />
        <Select
          label="Purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as Purpose)}
        >
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {PURPOSE_LABELS[p]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Where you're headed, who's flying with you…"
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
