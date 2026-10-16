// Which files count as a photo — ONE rule for the picker and the upload route.
//
// They used to disagree: the picker let through anything the browser called
// `image/*` (GIF, AVIF, SVG…) or anything with no type at all, while the route
// took exactly the list below. A GIF therefore sailed through the form and was
// refused only when the outbox sent it — after the member had left the
// airplane. Both sides now call `photoProblem`, so a file the server would
// refuse is refused the moment it's picked, with the same words.
//
// The no-type case is real, not hypothetical: iOS often hands over a HEIC with
// an empty `type`. Rather than wave every untyped file through, the type is
// read off the file's EXTENSION when the browser didn't say.
//
// Pure — no DOM, no server imports — so it runs in both places and in vitest.
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "./constants";

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/**
 * The content type to store a photo as, or null if it isn't one the club
 * takes. The browser's own type when it gave one; otherwise the extension's.
 */
export function photoContentType(file: { type: string; name: string }): string | null {
  const type = file.type.toLowerCase();
  if (type) return ALLOWED_PHOTO_TYPES.includes(type) ? type : null;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

/** Why this file can't be attached, naming it — or null when it can. */
export function photoProblem(file: { type: string; name: string; size: number }): string | null {
  if (photoContentType(file) === null) {
    return `${file.name} isn't a photo the club can take — use JPEG, PNG, WebP or HEIC.`;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `${file.name} is over ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.`;
  }
  return null;
}
