// Small client-side fetch helpers.

/**
 * Fetch a URL that is expected to return a JSON array. Returns [] on any
 * network error, non-2xx response, or non-array body, so callers can render
 * an empty list instead of crashing on `.map(...)`.
 */
export async function fetchJsonArray<T>(
  url: string,
  init?: RequestInit
): Promise<T[]> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
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
