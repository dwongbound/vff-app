"use client";
// The outbox runner: sends what's waiting on the device, in order, whenever the
// app is open with signal. See lib/outbox.ts for what a job is and why it's
// frozen; this file is only the part that touches the network.
//
// When it sends:
//   • the moment something is submitted — `submit()` queues the job and then
//     runs the queue, so with signal a submission is filed as fast as it ever
//     was and the page hears back in the same breath;
//   • on load, on the `online` event, and when the app comes back to the
//     foreground;
//   • every TICK_MS while anything is waiting and the page is visible — the
//     backstop for a captive portal, which never fires `online`.
//
// It does NOT send in the background. iOS Safari has no Background Sync, so a
// queue there only moves while the app is open — the strip says exactly that
// rather than promising more.
//
// One member at a time. A job carries who pressed the button and is only sent
// while that member is signed in, so a flight queued on the clubhouse iPad by
// one member can never be filed by the session of the next.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { notifyAircraftChanged } from "@/components/AircraftProvider";
import { useMe } from "@/components/MeProvider";
import {
  applyOutcome,
  classifyResponse,
  nextStep,
  resolveRefs,
  sendableJobs,
  settle,
  skipUnresolvable,
  PRIMARY_STEP,
  type OutboxJob,
  type OutboxStep,
  type StepOutcome,
} from "@/lib/outbox";
import { outboxStore, type OutboxStore } from "@/lib/outboxStore";
import { forgetOfflineDataIfUserChanged, registerServiceWorker } from "@/lib/serviceWorker";

/** How long one request may take before it counts as "no signal". */
const REQUEST_TIMEOUT_MS = 15_000;
/** How often a waiting queue is retried while the app is in front. */
const TICK_MS = 20_000;
/** Fired on window when a job finishes, so pages can refresh what they show. */
const OUTBOX_SENT_EVENT = "vff:outbox-sent";

export type SubmitResult =
  /** The club has it. `data` is the primary step's answer. */
  | { kind: "filed"; data: unknown }
  /** Kept on the device; it will go by itself. Not an error. */
  | { kind: "queued" }
  /** The club read it and said no. Nothing was kept — the page still has it. */
  | { kind: "refused"; error: string };

interface OutboxCtx {
  /** Every job on this device, any member's. */
  jobs: OutboxJob[];
  /** False when a reload would lose the queue (no IndexedDB). */
  durable: boolean;
  /** A send is in progress. */
  sending: boolean;
  submit: (job: OutboxJob) => Promise<SubmitResult>;
  flush: () => Promise<void>;
  discard: (id: string) => Promise<void>;
}

const Ctx = createContext<OutboxCtx | null>(null);

/** fetch, with a deadline and the answer sorted into a StepOutcome. */
async function send(url: string, init: RequestInit): Promise<StepOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal, credentials: "same-origin" });
  } catch {
    return classifyResponse(null, null, false);
  } finally {
    clearTimeout(timer);
  }
  // A captive portal that redirected us to its own login page. The 200 at the
  // end of that is the portal's, not the club's.
  if (res.redirected && new URL(res.url).origin !== window.location.origin) {
    return { kind: "retry", reason: "This wifi wants you to sign in to it first." };
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const json = isJson ? await res.json().catch(() => null) : null;
  return classifyResponse(res.status, json, isJson && json !== null);
}

/** The fetch init for a JSON step, with its idempotency key added to the body. */
function jsonRequest(method: string, body: Record<string, unknown>, requestId: string) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, requestId }),
  };
}

/** One attempt at one step, or `unresolvable` if it needs a step that failed. */
async function execute(
  step: OutboxStep,
  results: Record<string, unknown>
): Promise<StepOutcome | "unresolvable"> {
  if (step.type === "photo") {
    const subject = resolveRefs(step.subjectId, results);
    if ("missing" in subject) return "unresolvable";
    const form = new FormData();
    form.append("file", step.file, step.fileName);
    form.append("subject", step.subject);
    form.append("subjectId", String(subject.value));
    form.append("requestId", step.requestId);
    const outcome = await send("/api/photos", { method: "POST", body: form });
    // 503 from the photo route is "this deployment has no photo storage" —
    // nothing a retry will ever fix, so it's a refusal of THIS step rather
    // than a reason to hold the whole queue.
    if (outcome.kind === "retry" && outcome.reason.includes("(503)")) {
      return { kind: "refused", status: 503, error: "Photos aren't switched on for the club." };
    }
    return outcome;
  }

  const body = resolveRefs(step.body, results);
  if ("missing" in body) return "unresolvable";
  const outcome = await send(step.url, jsonRequest(step.method, body.value, step.requestId));
  if (outcome.kind === "refused" && outcome.status === 404 && step.onNotFound) {
    const alt = step.onNotFound;
    const altBody = resolveRefs(alt.body, results);
    if ("missing" in altBody) return "unresolvable";
    // The SAME key: if this alternative was already sent once and its reply
    // lost, the server recognises it rather than filing the walk twice.
    return send(alt.url, jsonRequest(alt.method, altBody.value, step.requestId));
  }
  return outcome;
}

/** Ask the browser not to evict the queue under storage pressure. Best-effort. */
function askToPersist() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Not supported, or refused — the queue still works, it's just evictable.
  }
}

/** Run `fn` holding the cross-tab outbox lock, where the browser has one. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? (locks.request("vff-outbox", fn) as Promise<T>) : fn();
}

export default function OutboxProvider({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const meRef = useRef(me);
  meRef.current = me;
  const [jobs, setJobs] = useState<OutboxJob[]>([]);
  const [durable, setDurable] = useState(true);
  const [sending, setSending] = useState(false);
  // Results of jobs that finished, so `submit` can hand the page its answer
  // after the job itself has left the store. Only for jobs a `submit` is
  // waiting on — a job sent in the background has nobody to hand it to.
  const awaiting = useRef(new Set<string>());
  const finished = useRef(new Map<string, unknown>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);

  /** Re-read the queue from the store into state, for the strip and the pages. */
  const reload = useCallback(async (store?: OutboxStore) => {
    const s = store ?? (await outboxStore());
    setDurable(s.durable);
    const all = await s.all();
    setJobs(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }, []);

  /** Send one job as far as it will go. */
  const runJob = useCallback(
    async (store: OutboxStore, start: OutboxJob): Promise<"done" | "waiting" | "refused"> => {
      let job = start;
      for (let step = nextStep(job); step; step = nextStep(job)) {
        const outcome = await execute(step, job.results);
        if (outcome === "unresolvable") {
          job = skipUnresolvable(job, step.id);
          await store.put(job);
          continue;
        }
        job = applyOutcome(job, step.id, outcome);
        await store.put(job);
        if (outcome.kind === "retry" || outcome.kind === "signedOut") return "waiting";
        if (job.state === "refused") return "refused";
      }
      if (awaiting.current.has(job.id)) {
        finished.current.set(job.id, job.results[PRIMARY_STEP] ?? null);
      }
      const kept = settle(job);
      if (kept) await store.put(kept);
      else await store.remove(job.id);
      window.dispatchEvent(new CustomEvent(OUTBOX_SENT_EVENT, { detail: job.meta }));
      return "done";
    },
    []
  );

  /** Send everything this member has waiting, oldest first, holding the cross-tab lock. */
  const runAll = useCallback(async () => {
    const userId = meRef.current?.id ?? null;
    if (!userId) return;
    setSending(true);
    try {
      await withLock(async () => {
        const store = await outboxStore();
        let sentAny = false;
        for (const job of sendableJobs(await store.all(), userId)) {
          const result = await runJob(store, job);
          if (result === "done") sentAny = true;
          // Oldest first and stop at the first one that can't get through: a
          // later job very often depends on an earlier one (the runway card
          // joins the session the preflight opens), and with no signal for one
          // there is no signal for the next.
          if (result === "waiting") break;
        }
        await reload(store);
        if (sentAny) notifyAircraftChanged();
      });
    } finally {
      setSending(false);
      channel.current?.postMessage("changed");
    }
  }, [reload, runJob]);

  /** Run the queue — after any run already in progress, never alongside it. */
  const flush = useCallback(() => {
    chain.current = chain.current.then(runAll).catch(() => {});
    return chain.current;
  }, [runAll]);

  /**
   * Queue a job and send it now. Resolves once this attempt is over: `filed`
   * with the primary step's answer, `queued` if it's waiting for signal, or
   * `refused` (and nothing kept) if the club said no on the spot.
   */
  const submit = useCallback(
    async (job: OutboxJob): Promise<SubmitResult> => {
      const store = await outboxStore();
      awaiting.current.add(job.id);
      await store.put(job);
      if (store.durable) askToPersist();
      await reload(store);
      await flush();
      awaiting.current.delete(job.id);

      if (finished.current.has(job.id)) {
        const data = finished.current.get(job.id);
        finished.current.delete(job.id);
        return { kind: "filed", data };
      }
      const after = (await store.all()).find((j) => j.id === job.id);
      if (after?.state === "refused") {
        // Refused on the spot, with the member still looking at the form: hand
        // the error back to the page (which keeps everything on screen) rather
        // than leaving a copy in the outbox to be discarded by hand later.
        await store.remove(job.id);
        await reload(store);
        return { kind: "refused", error: after.error ?? "The club refused this." };
      }
      return { kind: "queued" };
    },
    [flush, reload]
  );

  /** Throw a job away for good — the member's call, from the Details modal. */
  const discard = useCallback(
    async (id: string) => {
      const store = await outboxStore();
      await store.remove(id);
      await reload(store);
      channel.current?.postMessage("changed");
    },
    [reload]
  );

  // Another tab changed the queue (sent something, discarded something).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("vff-outbox");
    ch.onmessage = () => void reload();
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [reload]);

  // Whoever is signed in now: drop the previous member's cached reads, then
  // send anything of theirs that's waiting.
  const userId = me?.id ?? null;
  useEffect(() => {
    void reload();
    if (!userId) return;
    // Registered once somebody is signed in rather than on /login, because
    // its first job is fetching the member's pages — which redirect to /login
    // for anyone who isn't.
    void registerServiceWorker();
    void forgetOfflineDataIfUserChanged(userId);
    void flush();
  }, [userId, flush, reload]);

  const mine = useMemo(() => sendableJobs(jobs, userId), [jobs, userId]);
  const waiting = mine.length > 0;

  useEffect(() => {
    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const tick = waiting
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void flush();
        }, TICK_MS)
      : null;
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (tick) window.clearInterval(tick);
    };
  }, [flush, waiting]);

  const value = useMemo(
    () => ({ jobs, durable, sending, submit, flush, discard }),
    [jobs, durable, sending, submit, flush, discard]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOutbox(): OutboxCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOutbox must be used within an OutboxProvider");
  return ctx;
}

/** Call `onSent` whenever a queued job finishes — the page's cue to refresh. */
export function useOutboxSent(onSent: () => void): void {
  const ref = useRef(onSent);
  ref.current = onSent;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(OUTBOX_SENT_EVENT, handler);
    return () => window.removeEventListener(OUTBOX_SENT_EVENT, handler);
  }, []);
}
