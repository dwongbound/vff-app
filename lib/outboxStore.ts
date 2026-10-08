// Where the outbox lives on the device: IndexedDB.
//
// Not localStorage, which is where the drafts are, for two reasons that are
// both about photos. localStorage holds STRINGS, so a picture would have to go
// in as base64 at a third again its size; and it's capped at about 5 MB per
// site, which three phone photos of a cracked fairing would use up. IndexedDB
// stores a Blob as a Blob and has room for a day's worth of them.
//
// Hand-written over the raw API rather than pulling in a wrapper, for the same
// reason the app hand-writes its xlsx and ics: it's four operations on one
// object store, and the dependency would be bigger than the code.
//
// Where IndexedDB isn't usable — a private window on an older Safari, a
// browser with site data blocked — the store quietly falls back to memory. The
// outbox then still does its main job (retry while the page is open), it just
// can't survive a reload, which is no worse than the app was before it.
import type { OutboxJob } from "@/lib/outbox";

const DB_NAME = "vff-outbox";
const STORE = "jobs";
const VERSION = 1;

export interface OutboxStore {
  all(): Promise<OutboxJob[]>;
  put(job: OutboxJob): Promise<void>;
  remove(id: string): Promise<void>;
  /** False when this is the memory fallback, which a reload empties. */
  durable: boolean;
}

/** The fallback: the same interface over a Map, gone on reload. */
function memoryStore(): OutboxStore {
  const jobs = new Map<string, OutboxJob>();
  return {
    durable: false,
    async all() {
      return Array.from(jobs.values());
    },
    async put(job) {
      jobs.set(job.id, job);
    },
    async remove(id) {
      jobs.delete(id);
    },
  };
}

/** One IDB request as a promise. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab holding an older version open. There is only one version so
    // far, but an upgrade that waits forever is a page that never sends.
    request.onblocked = () => reject(new Error("Outbox database is blocked."));
  });
}

/** The real store: one object store of jobs, keyed by job id. */
function idbStore(db: IDBDatabase): OutboxStore {
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    durable: true,
    async all() {
      return (await done(tx("readonly").getAll())) as OutboxJob[];
    },
    async put(job) {
      await done(tx("readwrite").put(job));
    },
    async remove(id) {
      await done(tx("readwrite").delete(id));
    },
  };
}

let opening: Promise<OutboxStore> | null = null;

/** The device's outbox. Opened once per page and shared. */
export function outboxStore(): Promise<OutboxStore> {
  if (!opening) {
    opening = (async () => {
      if (typeof indexedDB === "undefined") return memoryStore();
      try {
        const store = idbStore(await openDb());
        // Prove it works before trusting it. Some private modes hand back a
        // database that throws on the first write rather than on open.
        await store.all();
        return store;
      } catch {
        return memoryStore();
      }
    })();
  }
  return opening;
}
