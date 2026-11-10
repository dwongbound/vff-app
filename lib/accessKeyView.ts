// An access key on the wire: its label and dates, never any part of the key.
// In lib/ because two routes share it and a route.ts may only export handlers.
import type { ApiAccessKey } from "./types";

export const ACCESS_KEY_SELECT = {
  id: true,
  name: true,
  canWrite: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

export function serializeAccessKey(row: {
  id: string;
  name: string;
  canWrite: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiAccessKey {
  return {
    id: row.id,
    name: row.name,
    canWrite: row.canWrite,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * "Can book and file · made Nov 10 · last used 4 min ago" — the line under a
 * key's name. What the key may DO leads, since that's the thing to check.
 */
export function accessKeyLine(
  key: Pick<ApiAccessKey, "canWrite" | "createdAt" | "lastUsedAt">,
  now: Date = new Date()
): string {
  const made = new Date(key.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const scope = key.canWrite ? "Can book and file" : "Read-only";
  return `${scope} · made ${made} · ${key.lastUsedAt ? `last used ${ago(key.lastUsedAt, now)}` : "never used"}`;
}

/** Rough and friendly; "last used" is only written every few minutes anyway. */
function ago(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 5) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
