// Local-disk driver: writes photo bytes under STORAGE_LOCAL_DIR (default
// ./storage/photos). Zero setup, which is why it's the default — dev and the
// e2e suite never need bucket credentials.
//
// In production this only survives if that directory is a persistent volume
// (docker-compose mounts one for the prod service). For a real deployment
// prefer the s3 driver — see README "Photo storage".
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver, StoredObject } from "./types";

// Sidecar file holding the content type, so a GET can answer with the right
// header without sniffing the bytes.
const META_SUFFIX = ".type";

export function createLocalDriver(rootDir: string): StorageDriver {
  // Resolve once against the process cwd (the repo root under next/node).
  const root = path.resolve(rootDir);

  // Keys are app-generated ("flights/<id>/<uuid>.jpg"), but resolve and
  // re-check anyway: a key that escaped the root would be an arbitrary-file
  // write/read primitive.
  function resolveKey(key: string): string {
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error("Invalid storage key.");
    }
    return full;
  }

  return {
    name: "local",

    async put(key, bytes, contentType) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
      await writeFile(full + META_SUFFIX, contentType, "utf8");
    },

    async get(key): Promise<StoredObject | null> {
      const full = resolveKey(key);
      try {
        const bytes = await readFile(full);
        const contentType = await readFile(full + META_SUFFIX, "utf8").catch(
          () => "application/octet-stream"
        );
        return { bytes: new Uint8Array(bytes), contentType };
      } catch {
        return null; // missing file — the caller 404s
      }
    },

    async delete(key) {
      const full = resolveKey(key);
      // Both unlinks are best-effort: deleting a photo row shouldn't fail
      // because the bytes were already gone.
      await unlink(full).catch(() => {});
      await unlink(full + META_SUFFIX).catch(() => {});
    },
  };
}
