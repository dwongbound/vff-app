// Photo storage entry point.
//
// STORAGE_DRIVER picks the backend:
//   "local" (default) — ./storage/photos on disk. Zero config; dev + e2e.
//   "s3"              — any S3-compatible bucket (Cloudflare R2, AWS S3,
//                       Backblaze B2, MinIO). See lib/storage/s3.ts.
//
// Photo BYTES never leave this module: routes call getStorage() and the app
// serves images through /api/photos/[id], which checks the session first. That
// means the bucket can stay entirely private — no public URLs to leak.
import { createLocalDriver } from "./local";
import { createS3Driver } from "./s3";
import type { StorageDriver } from "./types";

export type { StorageDriver, StoredObject } from "./types";

let cached: StorageDriver | null = null;

/** Whether this deployment can store and serve photos at all, and why not. */
export interface StorageStatus {
  configured: boolean;
  /** One sentence naming what's missing. Null when it's fine. */
  reason: string | null;
}

/**
 * Can this deployment do photos?
 *
 * Pure, and takes the environment as an argument, so it can be reasoned about
 * (and tested) without a bucket. `getStorage()` is built on it, which is what
 * keeps "the UI says photos are off" and "the upload route refuses" from ever
 * disagreeing — the alternative is two lists of required variables that drift.
 *
 * Three answers:
 *   • local (the default)   — always configured; it's a directory.
 *   • s3 with its keys      — configured.
 *   • s3 without them, or
 *     an explicit "none"    — NOT configured. The app stays fully usable and
 *                             every place that posts or shows a photo says so,
 *                             rather than offering a camera button that fails
 *                             after the picture has been taken.
 */
export function storageStatus(
  env: Record<string, string | undefined> = process.env
): StorageStatus {
  const driver = (env.STORAGE_DRIVER ?? "local").toLowerCase();

  // An explicit off switch. A club without a bucket shouldn't have to set
  // credentials it doesn't have just to make the buttons behave.
  if (driver === "none" || driver === "off") {
    return {
      configured: false,
      reason: `Photo storage is switched off (STORAGE_DRIVER=${driver}).`,
    };
  }

  if (driver === "s3") {
    const missing = (
      ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    ).filter((key) => !env[key]);
    if (missing.length > 0) {
      return {
        configured: false,
        reason: `STORAGE_DRIVER=s3 but ${missing.join(", ")} ${
          missing.length === 1 ? "is" : "are"
        } not set.`,
      };
    }
  }

  return { configured: true, reason: null };
}

export function getStorage(): StorageDriver {
  if (cached) return cached;

  const status = storageStatus();
  if (!status.configured) throw new Error(status.reason ?? "Photo storage is unavailable.");

  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();

  if (driver === "s3") {
    // Non-null: storageStatus() has already refused every case where these are
    // missing, which is why that check is the single source of truth.
    const bucket = process.env.S3_BUCKET!;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!;
    cached = createS3Driver({
      bucket,
      // R2 ignores the region but SigV4 still has to sign one; "auto" is what
      // Cloudflare's own docs use.
      region: process.env.S3_REGION || "auto",
      accessKeyId,
      secretAccessKey,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
    return cached;
  }

  cached = createLocalDriver(process.env.STORAGE_LOCAL_DIR || "storage/photos");
  return cached;
}

/**
 * Object key for a new photo: `<subject>/<subjectId>/<random>.<ext>`.
 * Grouping by subject makes the bucket browsable and lets a whole flight's
 * photos be deleted with one prefix listing if it ever comes to that.
 */
export function photoKey(
  subject: "flights" | "squawks" | "checkouts",
  subjectId: string,
  contentType: string
): string {
  const ext = EXTENSIONS[contentType] ?? "bin";
  return `${subject}/${subjectId}/${crypto.randomUUID()}.${ext}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
