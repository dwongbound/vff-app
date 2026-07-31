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
 * POST/PATCH JSON and return `{ ok, data, error }` — the shape every form in
 * the app wants (show the server's message on failure, the row on success).
 */
export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<{ ok: boolean; data: T | null; error: string | null }> {
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
      return { ok: false, data: null, error };
    }
    return { ok: true, data: data as T, error: null };
  } catch {
    return { ok: false, data: null, error: "Network error — please retry." };
  }
}
