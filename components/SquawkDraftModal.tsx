"use client";
// "Something's wrong with the airplane" form, used by both the preflight run
// and the post-flight entry.
//
// It doesn't post anything: it hands a draft back to the parent, which files
// the squawk after its own row exists (a squawk found on the walkaround wants
// to point at that preflight; one found after landing wants the flight). That
// also means photos taken here ride along and get uploaded once there's an id
// to attach them to.
import { useEffect, useState } from "react";
import Button from "./common/Button";
import Modal from "./common/Modal";
import Input from "./common/Input";
import Select from "./common/Select";
import Textarea from "./common/Textarea";
import PhotoUploader from "./PhotoUploader";
import { SEVERITIES, SEVERITY_LABELS, type Severity } from "@/lib/constants";

export interface SquawkDraft {
  title: string;
  description: string;
  severity: Severity;
  photos: File[];
}

export default function SquawkDraftModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (draft: SquawkDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("NOTE");
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setSeverity("NOTE");
    setPhotos([]);
    setError(null);
  }, [open]);

  function add() {
    if (!title.trim()) {
      setError("Give it a short title — that's what shows on the airplane's list.");
      return;
    }
    onAdd({ title: title.trim(), description: description.trim(), severity, photos });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a squawk"
      subtitle="Anything the next pilot needs to know about"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add}>Add squawk</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="What's wrong?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Left brake feels soft"
          error={error}
        />
        <Textarea
          label="Details (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Noticed during taxi; pedal goes most of the way down before it bites."
        />
        <Select
          label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </Select>
        {severity === "GROUNDING" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            This grounds the airplane for everyone until a club admin signs it
            off. Use it when the airplane isn&rsquo;t airworthy.
          </p>
        )}
        <PhotoUploader
          files={photos}
          onChange={setPhotos}
          label="Photos"
          hint="A picture of the problem saves the next person a phone call."
        />
      </div>
    </Modal>
  );
}
