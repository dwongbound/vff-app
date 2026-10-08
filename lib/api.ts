// Small client-side fetch helpers.

/**
 * The header the service worker (public/sw.js) puts on a read it answered
 * from its cache because the network didn't. Its value is when that copy was
 * fetched.
 */
const CACHED_AT_HEADER = "x-vff-cached-at";

let staleSince: string | null = null;
const staleListeners = new Set<(at: string | null) => void>();

/**
 * Note whether a read came off the network or out of the worker's cache.
 *
 * One flag for the whole app rather than per request: the question a member
 * needs answered is "is what I'm looking at live", and that's true or false of
 * the connection, not of one list. A fresh read clears it, because a fresh
 * read means we're back.
 */
function noteFreshness(res: Response) {
  const at = res.headers.get(CACHED_AT_HEADER);
  const next = at ? (staleSince && staleSince < at ? staleSince : at) : null;
  if (next === staleSince) return;
  staleSince = next;
  staleListeners.forEach((l) => l(staleSince));
}

/** When the oldest cached read on screen was fetched, or null when all live. */
export function staleDataSince(): string | null {
  return staleSince;
}

/** Hear about the above changing. Returns the unsubscribe. */
export function onStaleDataChange(listener: (at: string | null) => void): () => void {
  staleListeners.add(listener);
  return () => staleListeners.delete(listener);
}

/**
 * Fetch a URL that is expected to return a JSON array. Returns [] on any
 * network error, non-2xx response, or non-array body, so callers can render
 * an empty list instead of crashing on `.map(...)`.
 */
export async function fetchJsonArray<T>(
  url: string,
  init?: RequestInit
): Promise<T[]> {
  return (await fetchJsonList<T>(url, init)) ?? [];
}

/**
 * The same, but null on failure rather than [] — for the callers where "the
 * request failed" and "there are none" must not look alike. The fleet is the
 * one that matters: a refetch that fails with no signal used to come back as
 * an empty fleet, and every page then said "No airplane set up yet".
 */
export async function fetchJsonList<T>(
  url: string,
  init?: RequestInit
): Promise<T[] | null> {
  try {
    const res = await fetch(url, init);
    noteFreshness(res);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a URL that returns a single JSON object. Null on any failure, so a
 * page can tell "not loaded yet" from "loaded and empty" — which is what
 * drives the shared loading splash (see usePageLoading).
 */
export async function fetchJsonObject<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    noteFreshness(res);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as T)
      : null;
  } catch {
    return null;
  }
}

/**
 * POST/PATCH JSON and return `{ ok, data, error, status }` — the shape every
 * form in the app wants (show the server's message on failure, the row on
 * success).
 *
 * `status` is the raw HTTP code, or null when the request never got a reply at
 * all. Most callers only need `ok`; it's there for the few that have to tell
 * WHICH refusal they got, rather than matching on the prose of `error` — the
 * checkout autosave retargets a draft whose row has gone (404) but not one the
 * server merely rejected, and a message string is not a stable thing to branch
 * on.
 */
export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<{ ok: boolean; data: T | null; error: string | null; status: number | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error =
        (data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null) ?? "Something went wrong.";
      return { ok: false, data: null, error, status: res.status };
    }
    return { ok: true, data: data as T, error: null, status: res.status };
  } catch {
    return { ok: false, data: null, error: "Network error — please retry.", status: null };
  }
}
