"use client";
// Photo picker used by the post-flight form, the preflight run, and squawks.
//
// It holds Files locally and does NOT upload on pick: the row a photo attaches
// to (flight, squawk, preflight) usually doesn't exist yet when you're taking
// the picture. The parent form submits, gets an id back, and then calls
// uploadPhotos() — which is why this is a controlled component over File[].
//
// On phones `capture="environment"` makes the camera the default source, so
// photographing the Hobbs meter is two taps.
import { useEffect, useState } from "react";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/constants";

export default function PhotoUploader({
  files,
  onChange,
  label = "Photos",
  hint,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // Object URLs for the thumbnails, revoked on unmount so we don't leak blobs.
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const next: File[] = [];
    for (const file of Array.from(picked)) {
      // iOS reports HEIC files with an empty type often enough that rejecting
      // on type alone would block real photos — allow anything the browser
      // calls an image, and let the server have the final say.
      if (file.type && !ALLOWED_PHOTO_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
        setError("Photos need to be JPEG, PNG, WebP or HEIC.");
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`${file.name} is over ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.`);
        continue;
      }
      next.push(file);
    }
    if (next.length) {
      setError(null);
      onChange([...files, ...next]);
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>

      <div className="flex flex-wrap gap-2">
        {previews.map((src, i) => (
          <div key={src} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob:
                URL can't go through next/image, and these are local previews */}
            <img src={src} alt={files[i]?.name ?? "Photo"} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(files.filter((_, index) => index !== i))}
              aria-label={`Remove ${files[i]?.name ?? "photo"}`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
            >
              ✕
            </button>
          </div>
        ))}

        <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 text-gray-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-6 w-6" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          <span className="text-[10px] font-medium">Add</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Upload the picked files against a row that now exists. Returns the ids of
 * everything that made it; failures are reported but never lose the rest of
 * the form's work (the flight is already saved by this point).
 */
export async function uploadPhotos(
  files: File[],
  subject: "flight" | "squawk" | "preflight",
  subjectId: string
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("subject", subject);
    form.append("subjectId", subjectId);
    try {
      const res = await fetch("/api/photos", { method: "POST", body: form });
      if (res.ok) uploaded += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed };
}
