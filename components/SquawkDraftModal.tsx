"use client";
// "Something's wrong with the airplane" form, used by the checkouts
// and the post-flight entry.
//
// It doesn't post anything: it hands a draft back to the parent, which files
// the squawk after its own row exists (a squawk found on the walkaround wants
// to point at that checkout; one found after landing wants the flight). That
// also means photos taken here ride along and get uploaded once there's an id
// to attach them to.
import { useEffect, useState } from "react";
import Button from "./common/Button";
import Modal from "./common/Modal";
import Input from "./common/Input";
import Select from "./common/Select";
import Textarea from "./common/Textarea";
import PhotoUploader from "./PhotoUploader";

export interface SquawkDraft {
  title: string;
  description: string;
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
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setPhotos([]);
    setError(null);
  }, [open]);

  function add() {
    if (!title.trim()) {
      setError("Give it a short title — that's what shows on the airplane's list.");
      return;
    }
    onAdd({ title: title.trim(), description: description.trim(), photos });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report"
      subtitle="Anything the next pilot needs to know about"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add}>Add</Button>
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
        {/* No severity picker any more: what a squawk MEANS for dispatch is
            the Safety Officer's call, not the reporter's. This files as "New"
            and shows up on Status › Squawks for triage. Describe what you saw
            as plainly as you can — that description is what they'll rule on. */}
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
          This files as <span className="font-medium">New</span>. The Safety
          Officer reviews it and decides whether the airplane still flies.
        </p>
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
