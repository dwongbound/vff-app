"use client";
// "Are you sure?" — said once, the same way everywhere.
//
// A confirmation is a Modal with exactly two answers, and the only thing that
// varies between them is how much is at stake: settling a line is routine,
// deleting one leaves no trace. `tone` carries that, so the confirming button
// is green for "yes, it's paid", red for "yes, destroy it", and the app's own
// colour for anything in between — the colour of the button you're about to
// press is the last thing you read before pressing it.
//
// The body says WHAT will happen, in words, naming the thing it happens to.
// "Are you sure?" on its own is a question people learn to answer without
// reading; "Alex Rivera's $42.50 headset charge will be marked paid" is not.
import type { ReactNode } from "react";
import Button from "./Button";
import LoadingDots from "./LoadingDots";
import Modal from "./Modal";

export type ConfirmTone = "primary" | "success" | "danger" | "secondary";

export default function ConfirmModal({
  open,
  title,
  subtitle,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  /** What will happen, in words. */
  children?: ReactNode;
  /** The verb on the button — "Delete", "Mark paid". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** While the change is in flight: both buttons lock, the confirm one spins. */
  busy?: boolean;
  /** Shown inside the dialog, so a refusal is read where the choice was made. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? <LoadingDots size="sm" /> : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
        {children}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
