"use client";
// The Finance Officer's "Send invoices": every member's statement, by email.
//
//   Month   a month (last month by default — invoices go out once a month has
//           closed) or "Everything unpaid", the all-time letter.
//   Who     everyone with something to send (the default), or a few people.
//
// The list is the SERVER's preview (GET /api/finances/invoices), the same
// function the send runs, so the amounts beside each name are exactly what
// each email asks for. Members with nothing in the month, or no address, are
// listed greyed with the reason rather than silently left out — "why didn't
// Sam get one" should be answerable from this window. "Sent Oct 3" beside a
// name is the guard against a second officer sending the same month again.
//
// Sending is a bulk action that leaves the app, so it confirms first.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import ConfirmModal from "@/components/common/ConfirmModal";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { fetchJsonObject, sendJson } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { currentPeriod, formatMoney, formatPeriod, shiftPeriod } from "@/lib/finance";
import { scopeLabel, type InvoiceScope } from "@/lib/invoices";
import type { ApiInvoicePreview, ApiInvoiceSendResult } from "@/lib/types";

/** Months offered in the picker, newest first, this month included. */
const MONTHS_OFFERED = 12;

export default function SendInvoicesModal({ onClose }: { onClose: () => void }) {
  const thisMonth = currentPeriod();
  const [scope, setScope] = useState<InvoiceScope>(shiftPeriod(thisMonth, -1));
  const [preview, setPreview] = useState<ApiInvoicePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiInvoiceSendResult | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    setLoadError(null);
    fetchJsonObject<ApiInvoicePreview>(`/api/finances/invoices?scope=${scope}`).then((p) => {
      if (!live) return;
      if (p) setPreview(p);
      else setLoadError("Couldn't read the books. Check your connection and try again.");
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const sendable = preview?.recipients.filter((r) => !r.skipReason) ?? [];
  const skipped = preview?.recipients.filter((r) => r.skipReason) ?? [];
  const targets = everyone ? sendable : sendable.filter((r) => chosen.has(r.member.id));
  const emailOff = preview !== null && !preview.email.configured;
  const label = scopeLabel(scope);
  const plural = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;

  async function send() {
    setBusy(true);
    setSendError(null);
    const res = await sendJson<ApiInvoiceSendResult>("/api/finances/invoices", "POST", {
      scope,
      memberIds: everyone ? null : targets.map((t) => t.member.id),
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setSendError(res.error);
      return;
    }
    setConfirming(false);
    setResult(res.data);
  }

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Invoices sent"
        subtitle={label}
        footer={<Button onClick={onClose}>Close</Button>}
      >
        <div className="space-y-3 text-sm">
          <p role="status" className="font-medium">
            {result.sent.length > 0
              ? `Sent ${plural(result.sent.length)}.`
              : "Nothing was sent."}
          </p>
          {result.sent.length > 0 && (
            <ul className="space-y-1 text-gray-600 dark:text-gray-300">
              {result.sent.map((s) => (
                <li key={s.memberId}>
                  {s.name} <span className="text-gray-400">· {s.address}</span>
                </li>
              ))}
            </ul>
          )}
          {result.failed.length > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <p className="font-medium">Not sent:</p>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.memberId}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Send invoices"
        subtitle="Each member gets their own statement by email"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                setSendError(null);
                setConfirming(true);
              }}
              disabled={!preview || emailOff || targets.length === 0}
            >
              {targets.length > 0 ? `Send ${plural(targets.length)}` : "Send"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Select
            label="Statement"
            value={scope}
            onChange={(e) => setScope(e.target.value as InvoiceScope)}
          >
            {Array.from({ length: MONTHS_OFFERED }, (_, i) => shiftPeriod(thisMonth, -i)).map(
              (p) => (
                <option key={p} value={p}>
                  {formatPeriod(p)}
                  {p === thisMonth ? " (so far)" : ""}
                </option>
              )
            )}
            <option value="all">All time: everything unpaid</option>
          </Select>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Send to</legend>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              {[
                { value: true, label: "Everyone" },
                { value: false, label: "Choose people" },
              ].map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => setEveryone(o.value)}
                  aria-pressed={everyone === o.value}
                  className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors sm:min-h-0 sm:py-1.5 ${
                    everyone === o.value
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          {emailOff && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {preview!.email.reason} Ask whoever runs the club&apos;s server to set it up.
            </p>
          )}
          {loadError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {loadError}
            </p>
          )}

          {!preview && !loadError ? (
            <div className="flex justify-center py-6">
              <LoadingDots />
            </div>
          ) : preview ? (
            <ul
              aria-label="Recipients"
              className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
            >
              {sendable.length === 0 && (
                <li className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                  Nobody has anything to invoice for {label}.
                </li>
              )}
              {sendable.map((r) => {
                const on = everyone || chosen.has(r.member.id);
                return (
                  <li key={r.member.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={everyone}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(r.member.id);
                          else next.delete(r.member.id);
                          setChosen(next);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 dark:border-gray-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.member.name}</span>
                        {r.lastSentAt && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            Sent {formatDay(r.lastSentAt)}
                          </span>
                        )}
                      </span>
                      <span
                        className={`tabular shrink-0 font-medium ${
                          r.amountDueCents < 0 ? "text-green-600 dark:text-green-400" : ""
                        }`}
                      >
                        {r.amountDueCents < 0
                          ? `owed ${formatMoney(-r.amountDueCents)}`
                          : formatMoney(r.amountDueCents)}
                      </span>
                    </label>
                  </li>
                );
              })}
              {skipped.map((r) => (
                <li
                  key={r.member.id}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm text-gray-400 dark:text-gray-500"
                >
                  <span className="truncate">{r.member.name}</span>
                  <span className="shrink-0 text-xs">{r.skipReason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>

      <ConfirmModal
        open={confirming}
        title={`Email ${plural(targets.length)}?`}
        subtitle={label}
        confirmLabel="Send"
        busy={busy}
        error={sendError}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      >
        {targets.length === 1
          ? `${targets[0].member.name} gets their ${label} statement`
          : `${targets.length} members each get their own ${label} statement`}{" "}
        at the address on their account. Replies come to you.
      </ConfirmModal>
    </>
  );
}
