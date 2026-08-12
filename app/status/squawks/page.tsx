"use client";
// Plane Status › Squawks — the club's squawk sheet.
//
// Read-only for every member, editable by the Safety Officer (and admins, who
// hold every capability — see lib/positions.ts). That split is the whole point
// of the tab: a squawk's status is what tells the next pilot whether to fly, so
// it's a judgement, not a note anyone can revise. Members still FILE squawks
// from the checkouts; those land as "New" and wait here for triage.
//
// The client hides the editing affordances on `squawk:manage`, but that's a
// courtesy, not the control: /api/squawks/[id] re-checks the same capability on
// every PATCH.
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ChipSelect from "@/components/common/ChipSelect";
import InfoTip from "@/components/common/InfoTip";
import LoadingDots from "@/components/common/LoadingDots";
import { notifyAircraftChanged, useAircraft } from "@/components/AircraftProvider";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import {
  SQUAWK_STATUSES,
  SQUAWK_STATUS_HINTS,
  SQUAWK_STATUS_LABELS,
  SQUAWK_STATUS_SHORT,
  SQUAWK_STATUS_TONES,
  SQUAWK_TRIAGE_ORDER,
  type SquawkStatus,
} from "@/lib/squawks";
import type { ApiSquawk } from "@/lib/types";

export default function SquawksPage() {
  const { selected, loading: fleetLoading } = useAircraft();
  const { me } = useMe();
  const aircraftId = selected?.id ?? null;

  const [squawks, setSquawks] = useState<ApiSquawk[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = Boolean(me?.capabilities.includes("squawk:manage"));

  usePageLoading(fleetLoading || (selected !== null && squawks === null));

  const load = useCallback(async () => {
    if (!aircraftId) return;
    // Always fetch everything and filter in the client: the list is small, and
    // toggling "show closed" shouldn't cost a round trip or a loading flash.
    setSquawks(
      await fetchJsonArray<ApiSquawk>(
        `/api/squawks?aircraftId=${aircraftId}&status=all`
      )
    );
  }, [aircraftId]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const rows = (squawks ?? []).filter(
      (s) => showClosed || s.status !== "CLOSED"
    );
    return [...rows].sort(
      (a, b) =>
        SQUAWK_TRIAGE_ORDER.indexOf(a.status) -
          SQUAWK_TRIAGE_ORDER.indexOf(b.status) ||
        +new Date(b.createdAt) - +new Date(a.createdAt)
    );
  }, [squawks, showClosed]);

  const closedCount = (squawks ?? []).filter((s) => s.status === "CLOSED").length;

  async function setStatus(squawk: ApiSquawk, status: SquawkStatus) {
    setError(null);
    setBusyId(squawk.id);
    const result = await sendJson<ApiSquawk>(
      `/api/squawks/${squawk.id}`,
      "PATCH",
      { status }
    );
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not update that squawk.");
      return;
    }
    // Grounding and in-work both change the app-wide banner and the Status
    // header, which read the aircraft, not this list.
    notifyAircraftChanged();
    await load();
  }

  if (!selected) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No airplane set up yet — an admin can add one from Club settings.
        </p>
      </Card>
    );
  }
  if (squawks === null) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {canManage
            ? "You can set the status of any squawk."
            : "Read-only — the Safety Officer sets a squawk's status."}
        </p>
        {closedCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? "Hide" : `Closed (${closedCount})`}
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing outstanding — the airplane is clean. Squawks you raise from
            a checkout land here as “New”.
          </p>
        </Card>
      ) : (
        // Named so it can be told apart from the layout banner's list of
        // grounded titles, which also renders <li>s containing a squawk title.
        <ul aria-label="Squawks" className="space-y-3">
          {visible.map((s) => (
            <SquawkRow
              key={s.id}
              squawk={s}
              canManage={canManage}
              busy={busyId === s.id}
              onStatus={(status) => setStatus(s, status)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SquawkRow({
  squawk,
  canManage,
  busy,
  onStatus,
}: {
  squawk: ApiSquawk;
  canManage: boolean;
  busy: boolean;
  onStatus: (status: SquawkStatus) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <Card className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={SQUAWK_STATUS_TONES[squawk.status]}>
                {SQUAWK_STATUS_SHORT[squawk.status]}
              </Badge>
              <InfoTip label={SQUAWK_STATUS_LABELS[squawk.status]}>
                {SQUAWK_STATUS_HINTS[squawk.status]}
              </InfoTip>
            </div>
            <p className="mt-1 font-medium">{squawk.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Noted {formatDay(new Date(squawk.createdAt))} by{" "}
              {squawk.reportedBy.name}
            </p>
          </div>

          {busy ? (
            <LoadingDots size="sm" />
          ) : canManage ? (
            // The whole controlled vocabulary, in one place — the officer picks
            // a status rather than pressing a verb, because the sheet's status
            // list IS the workflow.
            //
            // Chips rather than a native <select>: these five values are a
            // dispatch decision, and rendering "okay to fly" and "aircraft
            // grounded" in identical grey makes the reader parse the sentence
            // to find out which one is selected. Same tones the badge above
            // uses, from lib/squawks.ts — one table, so the picker and the row
            // can never disagree about what red means.
            <ChipSelect
              label="Status"
              hideLabel
              value={squawk.status}
              onChange={onStatus}
              className="w-56"
              options={SQUAWK_STATUSES.map((status) => ({
                value: status,
                label: SQUAWK_STATUS_LABELS[status],
                tone: SQUAWK_STATUS_TONES[status],
                hint: SQUAWK_STATUS_HINTS[status],
              }))}
            />
          ) : null}
        </div>

        {squawk.description && (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {open ? "Hide" : "Details"}
            </button>
            {open && (
              <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
                {squawk.description}
              </p>
            )}
          </>
        )}

        {squawk.status === "CLOSED" && squawk.resolvedBy && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Closed by {squawk.resolvedBy.name}
            {squawk.resolvedAt && ` on ${formatDay(new Date(squawk.resolvedAt))}`}
            {squawk.resolution ? ` — ${squawk.resolution}` : ""}
          </p>
        )}
      </Card>
    </li>
  );
}
