// The page's side of the service worker (public/sw.js): registering it, and
// clearing what it has cached when the member using this device changes.
//
// The worker is what lets the app OPEN with no signal — a hard reload in a
// hangar used to be a blank page with the drafts intact underneath it. What it
// caches, and why each kind of request is treated the way it is, is written up
// at the top of public/sw.js.

/** Cache names the worker uses for API reads — must match API_CACHE in public/sw.js. */
const API_CACHE_PREFIX = "vff-api-";

/** The localStorage key remembering whose reads are in the cache. */
const LAST_USER_KEY = "vff:offline-user";

/**
 * Register the worker — production builds only.
 *
 * Never under `next dev`: a worker serving cached chunks fights hot reload, and
 * the e2e suite runs against `next dev`, which is also what keeps it from ever
 * caching a test page. A worker left over from a production build on the same
 * origin is unregistered instead, or it would keep serving that build's HTML.
 *
 * The version rides in the script URL. Changing the URL is what makes the
 * browser install the new worker, which drops the old build's caches — see the
 * `activate` handler in public/sw.js.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    if (process.env.NODE_ENV !== "production") {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      return;
    }
    const version =
      process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION || "dev";
    await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, {
      scope: "/",
    });
    // Ask the worker to fetch the pages a flying day needs while there's
    // signal to fetch them over. It decides for itself whether it's due.
    // `ready` rather than the registration's own worker: on a first install
    // that one is still installing, and `ready` waits for it to take over.
    const ready = await navigator.serviceWorker.ready;
    ready.active?.postMessage({ type: "warm" });
  } catch {
    // No worker is the app as it was before — every page still works online.
  }
}

/** Throw away every cached API read. Pages and static assets are kept. */
async function clearOfflineData(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith(API_CACHE_PREFIX)).map((n) => caches.delete(n))
    );
  } catch {
    // Nothing cached, or caches unavailable — either way nothing to leak.
  }
}

/**
 * The cached reads belong to whoever was signed in when they were made. On a
 * shared clubhouse iPad, member B going offline must not be shown member A's
 * flights, statement or session — so a change of member empties the API cache.
 * (Signing out empties it too; this catches a session that changed without one,
 * like a cookie expiring and somebody else signing in.)
 */
export async function forgetOfflineDataIfUserChanged(userId: string): Promise<void> {
  let previous: string | null = null;
  try {
    previous = window.localStorage.getItem(LAST_USER_KEY);
    window.localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Storage blocked: assume the worst and clear.
    previous = null;
  }
  if (previous !== userId) await clearOfflineData();
}

/** Sign-out's half of the above: forget the reads, and whose they were. */
export async function forgetOfflineDataOnSignOut(): Promise<void> {
  try {
    window.localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Fine — clearing the cache below is what matters.
  }
  await clearOfflineData();
}
