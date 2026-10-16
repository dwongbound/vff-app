"use client";
// Club settings › Google Calendar.
//
// The club already keeps each airplane's schedule on a Google Calendar
// ("N8318B"). Connecting it here makes that calendar the source of truth for
// the Reservations tab: the app reads it on every page load and writes every
// booking, edit and cancellation back to it. See lib/googleCalendarSync.ts.
//
// Two steps, because they're two different facts: WHICH Google account the
// club writes through (one connection, one consent screen), and WHICH of that
// account's calendars is each airplane's.
//
// Admin-only. Every route behind this re-checks that (app/api/calendar).
import { useCallback, useEffect, useState } from "react";
import Button from "./common/Button";
import Card from "./common/Card";
import ConfirmModal from "./common/ConfirmModal";
import LoadingDots from "./common/LoadingDots";
import Select from "./common/Select";
import { fetchJsonObject, sendJson } from "@/lib/api";
import { savedAgo } from "@/lib/checkoutDraft";
import type { ApiCalendarStatus } from "@/lib/types";

export default function GoogleCalendarPanel() {
  const [status, setStatus] = useState<ApiCalendarStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The result of the OAuth round trip, off the URL the callback sent us to.
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchJsonObject<ApiCalendarStatus>("/api/calendar");
    setLoadFailed(data === null);
    setStatus(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    setNotice(
      result === "connected"
        ? { tone: "ok", text: "Google account connected. Now pick each airplane's calendar." }
        : { tone: "error", text: params.get("reason") ?? "Connecting Google didn't work." }
    );
    // Drop the query so a reload doesn't repeat the message.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  /** Revoke and forget the club's Google account (confirmed in the modal). */
  async function disconnect() {
    setBusy(true);
    setError(null);
    const result = await sendJson("/api/calendar", "DELETE");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirmingDisconnect(false);
    load();
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Google Calendar</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Link an airplane to the Google Calendar the club already books it on.
          The Reservations tab then reads that calendar, and every booking,
          edit and cancellation made here is written back to it. Cancelling
          renames the event to &ldquo;CANCELLED - &hellip;&rdquo; rather than
          deleting it.
        </p>
      </div>

      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === "ok"
              ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {notice.text}
        </p>
      )}

      <PanelBody
        status={status}
        loadFailed={loadFailed}
        onDisconnect={() => setConfirmingDisconnect(true)}
        onChanged={load}
      />

      <ConfirmModal
        open={confirmingDisconnect}
        title="Disconnect Google Calendar?"
        confirmLabel="Disconnect"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={disconnect}
        onCancel={() => setConfirmingDisconnect(false)}
      >
        Every airplane goes back to booking in the app only. Nothing on the
        Google Calendar is changed, and bookings already copied from it stay on
        the Reservations tab until it&rsquo;s connected again.
      </ConfirmModal>
    </div>
  );
}

/**
 * What the panel shows, one state at a time: still loading, Google not set up
 * on this server, set up but nobody connected, or connected with each
 * airplane's calendar.
 */
function PanelBody({
  status,
  loadFailed,
  onDisconnect,
  onChanged,
}: {
  status: ApiCalendarStatus | null;
  loadFailed: boolean;
  onDisconnect: () => void;
  onChanged: () => void;
}) {
  if (status === null) {
    return (
      <Card>
        {loadFailed ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Couldn&rsquo;t load the calendar settings.
          </p>
        ) : (
          <LoadingDots size="sm" />
        )}
      </Card>
    );
  }

  if (!status.configured) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Google isn&rsquo;t set up on this server. It needs{" "}
          <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{" "}
          — see the README.
        </p>
      </Card>
    );
  }

  const connection = status.connection;
  if (!connection) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Connect a Google account that can edit the airplane&rsquo;s
          calendar. Only you see Google&rsquo;s consent screen; members sign
          in exactly as before.
        </p>
        {/* A link, not a fetch: it leaves for Google's consent screen. */}
        <a
          href="/api/calendar/connect"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Connect Google
        </a>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Connected as{" "}
          <span className="font-medium">{connection.accountEmail || "a Google account"}</span>
          {connection.connectedBy && (
            <span className="text-gray-500 dark:text-gray-400"> · by {connection.connectedBy}</span>
          )}
        </p>
        <div className="flex gap-2">
          <a
            href="/api/calendar/connect"
            className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
          >
            Reconnect
          </a>
          <Button size="sm" variant="ghost" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>

      {status.calendarsError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {status.calendarsError}
        </p>
      )}

      <ul className="space-y-4">
        {status.aircraft.map((a) => (
          <AircraftCalendarRow
            key={a.id}
            aircraft={a}
            calendars={status.calendars}
            canPick={status.canPick}
            connectedBy={connection.connectedBy}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </Card>
  );
}

/** "Synced 2 min ago", or why the last one failed — under a linked airplane. */
function syncLine(linked: NonNullable<ApiCalendarStatus["aircraft"][number]["calendar"]>): string {
  if (linked.syncError) return `Last sync failed: ${linked.syncError}`;
  if (linked.syncedAt) return `Synced ${savedAgo(linked.syncedAt)}`;
  return "Not synced yet";
}

/**
 * One airplane's link. The connecting admin picks from their calendars; any
 * other admin sees only the linked one's name, and can sync or unlink it.
 */
function AircraftCalendarRow({
  aircraft,
  calendars,
  canPick,
  connectedBy,
  onChanged,
}: {
  aircraft: ApiCalendarStatus["aircraft"][number];
  calendars: ApiCalendarStatus["calendars"];
  /** Only the admin who connected the account sees its calendars. */
  canPick: boolean;
  connectedBy: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = aircraft.calendar;

  /** Link this airplane to a calendar, or unlink it with "". */
  async function link(calendarId: string) {
    setBusy(true);
    setError(null);
    const result = await sendJson<{ syncError?: string }>(
      `/api/calendar/aircraft/${aircraft.id}`,
      "PUT",
      { calendarId: calendarId || null }
    );
    setBusy(false);
    if (!result.ok) setError(result.error);
    else if (result.data?.syncError) setError(result.data.syncError);
    onChanged();
  }

  /** A full re-read of the calendar, on demand. */
  async function syncNow() {
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/calendar/aircraft/${aircraft.id}`, "POST");
    setBusy(false);
    if (!result.ok) setError(result.error);
    onChanged();
  }

  // Keep a linked calendar in the list even if the account can no longer see
  // it, so the select doesn't silently show "Not linked" for a live link.
  const options =
    linked && !calendars.some((c) => c.id === linked.calendarId)
      ? [{ id: linked.calendarId, name: linked.calendarName ?? linked.calendarId }, ...calendars]
      : calendars;

  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {!canPick ? (
          // Somebody else's Google account: name the ONE calendar that's
          // linked, never the rest of their list.
          <div className="min-w-0 flex-1 text-sm">
            <span className="block font-medium">{aircraft.tailNumber}</span>
            <span className="text-gray-600 dark:text-gray-300">
              {linked
                ? `Linked to ${linked.calendarName ?? "a Google calendar"}`
                : `Not linked. Only ${connectedBy ?? "the admin who connected Google"} can pick a calendar — or reconnect with your own account.`}
            </span>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <Select
              label={aircraft.tailNumber}
              value={linked?.calendarId ?? ""}
              onChange={(e) => link(e.target.value)}
              disabled={busy}
            >
              <option value="">Not linked — book in the app only</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {/* The picker's own "Not linked" option unlinks for the connector;
            any other admin gets a button, since stopping the sync never
            needs to see anybody's calendar list. */}
        {linked && !canPick && (
          <Button size="sm" variant="ghost" onClick={() => link("")} disabled={busy}>
            Unlink
          </Button>
        )}
        {linked && (
          <Button size="sm" variant="secondary" onClick={syncNow} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Sync now"}
          </Button>
        )}
      </div>
      {linked && (
        <p
          className={`text-xs ${
            linked.syncError
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {syncLine(linked)}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}
