// Personal access keys, as rules (unit-tested in tests/unit/accessKeys.test.ts).
// A key lets ONE app of a member's — Jarvis — read what that member can already
// see in the app, through GET /api/agent and the MCP endpoint /api/mcp. Those
// two routes are the only ones that accept a key, and neither writes, so a key
// is read-only by construction rather than by a flag somebody could forget.
//
// The db half (resolving a request's key to a member) is accessKeyAuth.ts.
import { createHash, randomBytes } from "node:crypto";

/** Every key starts with this, so a leaked one is recognisable in a log or a scan. */
export const ACCESS_KEY_PREFIX = "vff_";

/** Enough for a phone, a laptop and Jarvis, with room to rotate one. */
export const MAX_ACCESS_KEYS = 5;

export const MAX_KEY_NAME_CHARS = 40;

/** A fresh key: the prefix and 32 random bytes, URL-safe. Shown ONCE. */
export function generateAccessKey(): string {
  return ACCESS_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * What the database keeps instead of the key. SHA-256 rather than bcrypt: a
 * password needs a slow hash because people pick guessable ones, and this is
 * 256 random bits nobody picked. A fast hash is also what lets the lookup be
 * one indexed query.
 */
export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * The key out of an `Authorization: Bearer …` header, or null. Only keys of
 * this app's shape are taken, so a stray token for some other service is
 * refused before it reaches the database.
 */
export function bearerKey(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match) return null;
  const key = match[1];
  return key.startsWith(ACCESS_KEY_PREFIX) && key.length > ACCESS_KEY_PREFIX.length + 20
    ? key
    : null;
}

/** The member's label, tidied, or `{ error }`. */
export function parseKeyName(raw: unknown): { value: string } | { error: string } {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!value) return { error: "Give the key a name, like Jarvis, so you know what to revoke." };
  if (value.length > MAX_KEY_NAME_CHARS) {
    return { error: `Keep the name under ${MAX_KEY_NAME_CHARS} characters.` };
  }
  return { value };
}

/**
 * How often "last used" is written. Jarvis may call several times a minute,
 * and a write per read would turn every read into a write; to the minute is
 * all the profile card shows anyway.
 */
export const LAST_USED_RESOLUTION_MS = 5 * 60_000;

export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date = new Date()): boolean {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS;
}
