"use client";
// One flight-log entry, opened from the log list: the meters, the route, what
// was put back in, the photos, and any squawks that came out of it.
//
// It reads in two modes. VIEW is the record — what the club has on file for
// that flight. EDIT is the correction, and it's the same modal rather than a
// separate screen because a correction is almost always made while looking at
// the thing that's wrong: you open an entry, notice the tach reads 1498.34
// when your kneeboard says 1498.84, and fix it there. Sending the member to
// another form to retype nine fields they can already see is how a log entry
// stays wrong.
//
// Who may edit: the pilot whose flight it is, or an admin. That's the same
// rule PATCH /api/flights/[id] enforces, and the API is the one that counts —
// hiding the button is a courtesy.
//
// Photos load from /api/photos/[id], which streams them from storage behind
// the session check — so there's no public bucket URL anywhere in the client.
import { useEffect, useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import InfoTip from "./common/InfoTip";
import Input from "./common/Input";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import Select from "./common/Select";
import Textarea from "./common/Textarea";
import {
  NoImageSupport,
  usePhotoSupport,
} from "./PhotoSupportProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { countChecked, totalItems } from "@/lib/checkouts";
import {
  SIGNATURE_LABELS,
  SIGNATURE_TONES,
  signatureState,
} from "@/lib/flightSignature";
import { SQUAWK_STATUS_SHORT, SQUAWK_STATUS_TONES } from "@/lib/squawks";
import { formatFullDate, formatTime, toDateInputValue, toLocalInputValue } from "@/lib/dates";
import { formatCents, formatHours, hobbsHours, tachHours, validateMeters } from "@/lib/hours";
import { canEditLogEntry, isOpenSession } from "@/lib/flightSession";
import { hasContent } from "@/lib/markdown";
import RichTextEditor, { RichTextView } from "./common/RichText";
import type { ApiFlight, ApiMember } from "@/lib/types";

/** The editable half of a log entry, as the inputs hold it (strings). */
interface EditForm {
  flownOn: string;
  /** "YYYY-MM-DDTHH:MM" as a datetime-local input holds it; "" = not recorded. */
  startedAt: string;
  endedAt: string;
  tachStart: string;
  tachEnd: string;
  hobbsStart: string;
  hobbsEnd: string;
  landings: string;
  nightLandings: string;
  departure: string;
  arrival: string;
  route: string;
  fuelAddedGal: string;
  fuelCostDollars: string;
  landingFeeDollars: string;
  oilAddedQts: string;
  withInstructor: boolean;
  instructorId: string;
  notes: string;
  /** The pilot's write-up, as markdown. See lib/markdown.ts. */
  logEntry: string;
}

const money = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toFixed(2);
const text = (value: number | string | null) =>
  value === null ? "" : String(value);

function formFor(flight: ApiFlight): EditForm {
  return {
    flownOn: toDateInputValue(new Date(flight.flownOn)),
    startedAt: flight.startedAt ? toLocalInputValue(new Date(flight.startedAt)) : "",
    endedAt: flight.endedAt ? toLocalInputValue(new Date(flight.endedAt)) : "",
    tachStart: text(flight.tachStart),
    tachEnd: text(flight.tachEnd),
    hobbsStart: text(flight.hobbsStart),
    hobbsEnd: text(flight.hobbsEnd),
    landings: text(flight.landings),
    nightLandings: text(flight.nightLandings),
    departure: flight.departure ?? "",
    arrival: flight.arrival ?? "",
    route: flight.route ?? "",
    fuelAddedGal: text(flight.fuelAddedGal),
    fuelCostDollars: money(flight.fuelCostCents),
    landingFeeDollars: money(flight.landingFeeCents),
    oilAddedQts: text(flight.oilAddedQts),
    withInstructor: flight.withInstructor,
    instructorId: flight.instructor?.id ?? "",
    notes: flight.notes ?? "",
    logEntry: flight.logEntry ?? "",
  };
}

export default function FlightDetailModal({
  flight,
  onClose,
  hourlyRateCents,
  canDelete,
  onDelete,
  viewerId,
  onSignatureChanged,
  canEdit = false,
  onSaved,
}: {
  flight: ApiFlight | null;
  onClose: () => void;
  hourlyRateCents: number | null;
  canDelete: boolean;
  onDelete: (flight: ApiFlight) => void;
  /** The signed-in member, so the modal knows if the signature is theirs to give. */
  viewerId?: string | null;
  /** Refetch the log after a signature lands. Omit to hide the control. */
  onSignatureChanged?: () => void;
  /** May this viewer correct the entry? Their own flight, or an admin. */
  canEdit?: boolean;
  /** Hand the corrected entry back. Omit to hide the Edit control entirely. */
  onSaved?: (flight: ApiFlight) => void;
}) {
  // Above the early return: hooks may not be called conditionally.
  const { enabled: photosEnabled } = usePhotoSupport();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [instructors, setInstructors] = useState<ApiMember[] | null>(null);

  /**
   * May this viewer write the WRITE-UP, as opposed to correcting the entry?
   *
   * Narrower than `canEdit` on purpose, and the same rule the route enforces:
   * an admin may fix anyone's tach reading, because that's the club's books,
   * and may not put words in anyone's logbook. See lib/flightSession.ts.
   */
  const canWriteLog = flight
    ? canEditLogEntry(flight, viewerId ? { id: viewerId } : null)
    : false;

  // Opening a different entry closes the editor. Without this, clicking through
  // the log with the form open would show one flight's numbers under another
  // flight's heading — and Save would write them to the wrong entry.
  const flightId = flight?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setForm(null);
    setSaveError(null);
  }, [flightId]);

  // The roster, only once somebody starts editing — the same rule the entry
  // modal follows. Naming a CFI here is what puts the entry in their Teaching
  // list to sign, which is the point of offering it at all.
  useEffect(() => {
    if (!editing || instructors !== null) return;
    let live = true;
    fetchJsonArray<ApiMember>("/api/members").then((rows) => {
      if (live) setInstructors(rows.filter((m) => m.positions.includes("INSTRUCTOR")));
    });
    return () => {
      live = false;
    };
  }, [editing, instructors]);

  async function toggleSignature(id: string, signed: boolean) {
    setSignError(null);
    setSigning(true);
    const result = await sendJson(
      `/api/flights/${id}/sign`,
      signed ? "DELETE" : "POST"
    );
    setSigning(false);
    if (!result.ok) {
      setSignError(result.error ?? "Could not update the signature.");
      return;
    }
    onSignatureChanged?.();
  }

  async function save() {
    if (!flight || !form) return;
    const numeric = (v: string) => (v.trim() === "" ? null : Number(v));

    // The same mis-read-meter check the post-flight form and the API run. Worth
    // running here too: a correction is exactly when a digit gets transposed.
    //
    // Either reading may be CLEARED. An entry filed with no start tach is a
    // real thing — a flight closed out by somebody who never walked a preflight
    // card — and so is a member deciding the number they typed from memory was
    // wrong. What the log shows for those is a gap, which is honest; what it
    // must never show is an invented number nobody can date.
    const tachStart = numeric(form.tachStart);
    const tachEnd = numeric(form.tachEnd);
    const problem = validateMeters({
      tachStart,
      tachEnd,
      hobbsStart: numeric(form.hobbsStart),
      hobbsEnd: numeric(form.hobbsEnd),
    });
    if (problem) {
      setSaveError(problem);
      return;
    }

    setSaveError(null);
    setSaving(true);
    const dollars = (v: string) => {
      const value = numeric(v);
      return value == null ? null : Math.round(value * 100);
    };
    const result = await sendJson<ApiFlight>(`/api/flights/${flight.id}`, "PATCH", {
      // Noon, not midnight — see the entry modal: a calendar day read back in
      // another zone otherwise slides to the day before.
      flownOn: `${form.flownOn}T12:00:00`,
      // The datetime-local inputs hold LOCAL wall time; `new Date(...)` on that
      // string reads it in the viewer's zone, which is the right one — a member
      // correcting the time they got back is typing the time on their watch.
      startedAt: form.startedAt ? new Date(form.startedAt).toISOString() : null,
      endedAt: form.endedAt ? new Date(form.endedAt).toISOString() : null,
      tachStart,
      tachEnd,
      hobbsStart: numeric(form.hobbsStart),
      hobbsEnd: numeric(form.hobbsEnd),
      landings: numeric(form.landings) ?? 1,
      nightLandings: numeric(form.nightLandings) ?? 0,
      departure: form.departure.trim() || null,
      arrival: form.arrival.trim() || null,
      route: form.route.trim() || null,
      fuelAddedGal: numeric(form.fuelAddedGal),
      fuelCostCents: dollars(form.fuelCostDollars),
      landingFeeCents: dollars(form.landingFeeDollars),
      oilAddedQts: numeric(form.oilAddedQts),
      withInstructor: form.withInstructor,
      // Only alongside the assertion it belongs to: unticking the box must not
      // leave a CFI's name on a flight they weren't on.
      instructorId:
        form.withInstructor && form.instructorId ? form.instructorId : null,
      notes: form.notes.trim() || null,
      // The write-up, but only from its author — the route refuses it from
      // anyone else, and sending it anyway would turn an admin's correction of
      // a tach reading into a 403. See lib/flightSession.ts `canEditLogEntry`.
      ...(canWriteLog ? { logEntry: form.logEntry.trim() || null } : {}),
    });
    setSaving(false);

    if (!result.ok || !result.data) {
      setSaveError(result.error ?? "Could not save that correction.");
      return;
    }
    setEditing(false);
    setForm(null);
    onSaved?.(result.data);
  }

  /**
   * Stamp an open entry as filed, leaving everything else exactly as it is.
   *
   * Its own request rather than a flag on Save, because it is its own decision:
   * a member correcting the tach on a flight still in progress has not said the
   * flight is over, and a Save that quietly ended it would be the app deciding
   * for them.
   */
  async function fileEntry() {
    if (!flight) return;
    setSaveError(null);
    setSaving(true);
    const result = await sendJson<ApiFlight>(`/api/flights/${flight.id}`, "PATCH", {
      filed: true,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setSaveError(result.error ?? "Could not file that flight.");
      return;
    }
    onSaved?.(result.data);
  }

  if (!flight) return null;

  const tach = tachHours(flight);
  const hobbs = hobbsHours(flight);
  // An entry with no measurable span costs no HOURS. It can still owe a landing
  // fee — the desk charged that whether or not anybody read the panel.
  const hoursCost =
    hourlyRateCents == null || tach == null ? null : Math.round(tach * hourlyRateCents);
  const fee = flight.landingFeeCents ?? 0;
  const cost = hoursCost == null ? (fee || null) : hoursCost + fee;
  const inProgress = isOpenSession(flight);
  const state = signatureState(flight);
  const set = (patch: Partial<EditForm>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  return (
    <Modal
      open
      onClose={onClose}
      title={
        tach != null
          ? `${formatHours(tach)} hours · ${flight.aircraft.tailNumber}`
          : inProgress
            ? `In progress · ${flight.aircraft.tailNumber}`
            : `Hours not recorded · ${flight.aircraft.tailNumber}`
      }
      subtitle={`${formatFullDate(flight.flownOn)} · ${flight.pilot.name}`}
      footer={
        <div className="flex w-full items-center gap-2">
          {/* Red, and on its own at the far left: deleting a log entry destroys
              the club's record of a flight, and it should never sit shoulder to
              shoulder with Save looking like the same weight of decision. */}
          {canDelete && !editing && (
            <Button variant="danger" onClick={() => onDelete(flight)}>
              Delete
            </Button>
          )}
          {/* Closing out an entry from the log rather than from the post-flight
              form. The case it exists for is the walk that was signed and then
              never flown, or a flight closed out days later — without it the
              note above tells a member to file the entry here and gives them
              nothing to press. Hidden once filed: there is no un-filing. */}
          {inProgress && canEdit && onSaved && !editing && (
            <Button variant="secondary" disabled={saving} onClick={fileEntry}>
              {saving ? <LoadingDots size="sm" /> : "File this flight"}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {editing && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setForm(null);
                  setSaveError(null);
                }}
              >
                Cancel
              </Button>
            )}
            {canEdit && onSaved && (
              <Button
                disabled={saving}
                onClick={() => {
                  if (editing) {
                    save();
                    return;
                  }
                  setForm(formFor(flight));
                  setEditing(true);
                }}
              >
                {saving ? <LoadingDots size="sm" /> : editing ? "Save" : "Edit"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {saveError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {saveError}
          </p>
        )}

        {editing && form ? (
          <>
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
              Correcting this entry. Saving stamps it as edited — and if an
              instructor has already signed it, the log will say the signature
              covers the earlier version.
            </p>

            <Input
              label="Date flown"
              type="date"
              value={form.flownOn}
              onChange={(e) => set({ flownOn: e.target.value })}
            />

            {/* Out and in. Recorded by the cards' own time fields when they
                were walked, and typed here for a flight that wasn't — or when
                the clock on the card was the one the member forgot to change. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Started"
                type="datetime-local"
                value={form.startedAt}
                onChange={(e) => set({ startedAt: e.target.value })}
              />
              <Input
                label="Ended"
                type="datetime-local"
                value={form.endedAt}
                onChange={(e) => set({ endedAt: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Tach start"
                type="number"
                step="0.01"
                value={form.tachStart}
                onChange={(e) => set({ tachStart: e.target.value })}
                hint="Leave empty if it was never read"
              />
              <Input
                label="Tach end"
                type="number"
                step="0.01"
                value={form.tachEnd}
                onChange={(e) => set({ tachEnd: e.target.value })}
              />
              <Input
                label="Hobbs start"
                type="number"
                step="0.1"
                value={form.hobbsStart}
                onChange={(e) => set({ hobbsStart: e.target.value })}
              />
              <Input
                label="Hobbs end"
                type="number"
                step="0.1"
                value={form.hobbsEnd}
                onChange={(e) => set({ hobbsEnd: e.target.value })}
              />
              <Input
                label="Landings"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={form.landings}
                onChange={(e) => set({ landings: e.target.value })}
              />
              <Input
                label="Night landings"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={form.nightLandings}
                onChange={(e) => set({ nightLandings: e.target.value })}
                hint="to a full stop — that's what counts for currency"
              />
              <Input
                label="From"
                value={form.departure}
                onChange={(e) => set({ departure: e.target.value })}
                className="uppercase"
              />
              <Input
                label="To"
                value={form.arrival}
                onChange={(e) => set({ arrival: e.target.value })}
                className="uppercase"
              />
            </div>

            <Input
              label="Route"
              value={form.route}
              onChange={(e) => set({ route: e.target.value })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Fuel added"
                type="number"
                step="0.1"
                min="0"
                value={form.fuelAddedGal}
                onChange={(e) => set({ fuelAddedGal: e.target.value })}
                hint="Gallons"
              />
              <Input
                label="Fuel cost"
                type="number"
                step="0.01"
                min="0"
                value={form.fuelCostDollars}
                onChange={(e) => set({ fuelCostDollars: e.target.value })}
                hint="Dollars, credited back to you"
              />
              <Input
                label="Landing fee"
                type="number"
                step="0.01"
                min="0"
                value={form.landingFeeDollars}
                onChange={(e) => set({ landingFeeDollars: e.target.value })}
                hint="Dollars, billed to the pilot"
              />
              <Input
                label="Oil added"
                type="number"
                step="0.5"
                min="0"
                value={form.oilAddedQts}
                onChange={(e) => set({ oilAddedQts: e.target.value })}
                hint="Quarts"
              />
            </div>

            {/* The endorsement side. Naming a CFI on an entry that never had
                one is the whole reason to offer this here: a lesson filed as a
                solo has no other way to reach the instructor's list to sign. */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.withInstructor}
                  onChange={(e) => set({ withInstructor: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
                Flown with an approved flight instructor
              </label>
              {form.withInstructor && (
                <>
                  <Select
                    label="Instructor"
                    value={form.instructorId}
                    onChange={(e) => set({ instructorId: e.target.value })}
                  >
                    <option value="">Not recorded</option>
                    {(instructors ?? []).map((cfi) => (
                      <option key={cfi.id} value={cfi.id}>
                        {cfi.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {instructors && instructors.length === 0
                      ? "No CFIs on the roster yet — an admin adds the Flight Instructor role from the Members tab."
                      : "They can sign this entry off afterwards. Only they can — not another CFI, not an admin."}
                  </p>
                </>
              )}
            </div>

            <Textarea
              label="Notes"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              hint="The one-line remark — “left tank slow to fill”. The write-up below is for the flight itself."
            />

            {/* The write-up. Author-only, which is why it disappears rather
                than greying out for an admin correcting somebody's meters:
                a disabled field invites a member to wonder what they'd have to
                do to enable it, and the answer is "be someone else". */}
            {canWriteLog && (
              <RichTextEditor
                label="Log"
                value={form.logEntry}
                onChange={(logEntry) => set({ logEntry })}
                placeholder={"How the flight went.\n\n- Use the buttons above, or type **bold**, *italic*\n- Dashes make a list"}
                hint="Yours, and yours alone — an admin correcting this entry can't touch it. Editable any time."
              />
            )}
          </>
        ) : (
          <>
            {/* An entry the airplane hasn't come back from. Said plainly and
                at the top, because everything below it — hours, cost, landings
                — is an answer about a flight that isn't over. */}
            {inProgress && (
              <p
                className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900
                  dark:bg-amber-900/30 dark:text-amber-200"
              >
                This flight is still open. It was started at the airplane and
                hasn&apos;t been closed out — finish it on the post-flight form,
                or fill in the end readings here and file it.
              </p>
            )}

            {/* Meters, side by side the way they read on the panel. An unread
                meter shows an em dash on its side of the arrow rather than a
                zero: the club knows it doesn't know. */}
            <section className="grid grid-cols-2 gap-3 text-sm">
              <Figure
                label="Tach"
                value={`${flight.tachStart ?? "—"} → ${flight.tachEnd ?? "—"}`}
                sub={tach != null ? `${formatHours(tach)} hr` : "no span recorded"}
              />
              <Figure
                label="Hobbs"
                value={
                  flight.hobbsStart != null || flight.hobbsEnd != null
                    ? `${flight.hobbsStart ?? "—"} → ${flight.hobbsEnd ?? "—"}`
                    : "—"
                }
                sub={hobbs != null ? `${formatHours(hobbs)} hr` : "not recorded"}
              />
              {(flight.startedAt || flight.endedAt) && (
                <Figure
                  label="Out / in"
                  value={`${flight.startedAt ? formatTime(flight.startedAt) : "—"} → ${
                    flight.endedAt ? formatTime(flight.endedAt) : "—"
                  }`}
                />
              )}
              <Figure label="Landings" value={String(flight.landings)} />
              {cost != null && (
                <Figure
                  label="Est. cost"
                  value={formatCents(cost)}
                  tip={
                    <CostBreakdown
                      tach={tach}
                      hourlyRateCents={hourlyRateCents}
                      hoursCost={hoursCost ?? 0}
                      landingFeeCents={fee}
                      arrival={flight.arrival}
                      total={cost}
                    />
                  }
                />
              )}
            </section>

            {(flight.departure || flight.arrival || flight.route) && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Route
                </h3>
                <p className="text-sm">
                  {flight.route ??
                    [flight.departure, flight.arrival].filter(Boolean).join(" → ")}
                </p>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Servicing &amp; put-away
              </h3>
              <ul className="space-y-1 text-sm">
                <li>
                  Fuel added:{" "}
                  {flight.fuelAddedGal != null ? `${flight.fuelAddedGal} gal` : "none"}
                  {flight.fuelCostCents != null && ` (${formatCents(flight.fuelCostCents)})`}
                </li>
                <li>
                  Oil added:{" "}
                  {flight.oilAddedQts != null ? `${flight.oilAddedQts} qt` : "none"}
                </li>
                {flight.landingFeeCents != null && (
                  <li>
                    Landing fee: {formatCents(flight.landingFeeCents)}
                    {flight.arrival && ` at ${flight.arrival}`}
                  </li>
                )}
                {/* Only worth a line when the answer is "no" — that's the case the
                    next pilot needs to know about. These are derived from the
                    turn-off checkout, so "not confirmed" is the honest wording:
                    unticked can mean undone or just unrecorded. */}
                {!flight.tiedDown && (
                  <li className="text-amber-700 dark:text-amber-400">
                    Tie-downs and chocks not confirmed
                  </li>
                )}
                {!flight.cabinClean && (
                  <li className="text-amber-700 dark:text-amber-400">
                    Cabin clean-out not confirmed
                  </li>
                )}
                {flight.turnoffCheckoutVersion != null && (
                  <li className="text-gray-500 dark:text-gray-400">
                    Turn-off checkout: {countChecked("TURNOFF", flight.turnoffAnswers)}{" "}
                    of {totalItems("TURNOFF")} items
                  </li>
                )}
              </ul>
            </section>

            {/* The instructor's endorsement. Only on a lesson — an entry with no
                CFI on it has nobody to sign, and a permanently empty "unsigned"
                section on every solo flight would read as something missing. */}
            {flight.instructor && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Instructor sign-off
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SIGNATURE_TONES[state]}>{SIGNATURE_LABELS[state]}</Badge>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {flight.instructor.name}
                    {flight.signedAt && <> · {formatFullDate(flight.signedAt)}</>}
                  </span>
                </div>

                {/* The whole reason the two dates are stored separately. Not an
                    error — correcting an entry is the right thing to do — but the
                    signature was given against a different version, and saying so
                    is the only way a reader can tell. */}
                {state === "SIGNED_THEN_EDITED" && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                    This entry was corrected on {formatFullDate(flight.editedAt!)},
                    after it was signed. The signature covers the earlier version.
                  </p>
                )}

                {signError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    {signError}
                  </p>
                )}

                {/* Offered only to the instructor named on THIS entry — not to
                    other CFIs and not to admins. See lib/flightSignature.ts for
                    why that's the one place the app's "admins can do anything"
                    rule doesn't apply. */}
                {onSignatureChanged && flight.instructor.id === viewerId && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant={flight.signedAt ? "ghost" : "primary"}
                      disabled={signing}
                      onClick={() => toggleSignature(flight.id, Boolean(flight.signedAt))}
                    >
                      {signing ? (
                        <LoadingDots size="sm" />
                      ) : flight.signedAt ? (
                        "Withdraw signature"
                      ) : (
                        "Sign this entry"
                      )}
                    </Button>
                  </div>
                )}
              </section>
            )}

            {flight.notes && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Notes
                </h3>
                <p className="whitespace-pre-wrap text-sm">{flight.notes}</p>
              </section>
            )}

            {/* The write-up. Shown to everyone — the log is the club's shared
                record and a good debrief is worth reading — and written by its
                author alone. An entry without one offers the author the way in
                rather than saying nothing, since "you can add this later, any
                time" is the whole promise and an invisible feature isn't one. */}
            {hasContent(flight.logEntry) ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Log
                </h3>
                <RichTextView markdown={flight.logEntry} />
              </section>
            ) : (
              canWriteLog &&
              canEdit &&
              onSaved && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No write-up yet — press Edit to add one. You can do that any
                  time, on any flight of yours.
                </p>
              )
            )}

            {flight.squawks.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Squawks from this flight
                </h3>
                {/* Each one LINKS to the squawk sheet rather than restating its
                    story here. The status shown is a snapshot the moment this
                    entry was fetched, while Plane Status › Squawks is where it's
                    triaged — so the row says what it knows and hands off to the
                    page that owns the answer, rather than becoming a second
                    sheet that can disagree with the first. */}
                <ul className="space-y-2">
                  {flight.squawks.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`/status/squawks#${s.id}`}
                        className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <Badge tone={SQUAWK_STATUS_TONES[s.status]}>
                          {SQUAWK_STATUS_SHORT[s.status]}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{s.title}</span>
                          {s.description && (
                            <span className="block text-gray-500 dark:text-gray-400">
                              {s.description}
                            </span>
                          )}
                        </span>
                        <span
                          aria-hidden
                          className="text-gray-400 transition group-hover:text-indigo-500"
                        >
                          →
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {flight.photos.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Photos
                </h3>
                {/* The rows outlive the bytes when a club drops its bucket, so a
                    flight can carry photos this deployment simply cannot fetch.
                    Better to say so than to render a wall of broken images. */}
                {!photosEnabled ? (
                  <NoImageSupport />
                ) : (
                <div className="flex flex-wrap gap-2">
                  {flight.photos.map((p) => (
                    <a
                      key={p.id}
                      href={`/api/photos/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-24 w-24 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- the
                          bytes come from an authed API route, not a static asset */}
                      <img
                        src={`/api/photos/${p.id}`}
                        alt={p.caption ?? "Flight photo"}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
                )}
              </section>
            )}

            {/* When this entry was written and when it was last touched. Shown on
                every flight, not just signed ones: "filed on the day, never
                corrected" is a fact about a log entry worth being able to read,
                and it's the thing a signature date gets compared against. */}
            <p className="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Filed {formatFullDate(flight.createdAt)}
              {flight.editedAt
                ? ` · last edited ${formatFullDate(flight.editedAt)}`
                : " · never edited"}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * How the estimate was arrived at — the sum, written out.
 *
 * It exists because the headline and the money are computed from DIFFERENT
 * roundings and look like they disagree: the title says "1.2 hours" (a tenth,
 * which is how a logbook reads) while the bill is 1.19 tach hours at the club's
 * rate, because that's the tach's own resolution and rounding a member's money
 * up an extra hundredth of an hour every flight is not the club's to do. A
 * member checking the arithmetic finds 1.2 × $135 = $162.00 and the app saying
 * $160.65, and there is no way to resolve that without being shown the sum.
 */
function CostBreakdown({
  tach,
  hourlyRateCents,
  hoursCost,
  landingFeeCents,
  arrival,
  total,
}: {
  /** Null when the entry has no measurable span — see the hours row below. */
  tach: number | null;
  hourlyRateCents: number | null;
  hoursCost: number;
  landingFeeCents: number;
  arrival: string | null;
  total: number;
}) {
  return (
    <div className="space-y-1">
      {/* An entry with no span has no hours LINE, rather than a line reading
          "0 tach hr × $135.00/hr — $0.00". That row is an assertion about a
          flight, and this is a flight the club can't measure: the fee below it
          is the only thing it really knows. */}
      {tach != null ? (
        <div className="flex items-baseline justify-between gap-3">
          <span>
            {tach} tach hr ×{" "}
            {hourlyRateCents == null ? "—" : formatCents(hourlyRateCents)}
            /hr
          </span>
          <span className="tabular font-medium">{formatCents(hoursCost)}</span>
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">
          No hours billed — this entry has no tach span recorded.
        </p>
      )}
      {landingFeeCents > 0 && (
        <div className="flex items-baseline justify-between gap-3">
          <span>Landing fee{arrival ? ` — ${arrival}` : ""}</span>
          <span className="tabular font-medium">{formatCents(landingFeeCents)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-1 dark:border-gray-600">
        <span className="font-medium">Total</span>
        <span className="tabular font-semibold">{formatCents(total)}</span>
      </div>
      <p className="pt-1 text-gray-500 dark:text-gray-400">
        Billed on tach hours to the hundredth, which is why this can differ from
        the rounded figure in the title.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Optional (i) beside the label, explaining where the value came from. */
  tip?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {label}
        {tip && <InfoTip label={`How ${label} is worked out`}>{tip}</InfoTip>}
      </div>
      <div className="font-semibold tabular">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}
