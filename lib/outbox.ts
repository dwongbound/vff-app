// The outbox: submissions kept on the device until the club has them.
//
// A member who presses Complete or File with no signal used to be told to press
// it again later — and "later" is a member who has walked away from the
// airplane, put the phone in a pocket, and forgotten. The outbox is the
// standard answer to that: the submission is FROZEN at the moment of the press
// (exactly what was on screen, photos included), kept on the device, and sent
// by the app itself whenever it is open with signal. See
// components/OutboxProvider.tsx for the runner and lib/outboxStore.ts for where
// it lives.
//
// Freezing is what makes sending it automatically safe. The old objection to
// retrying on the `online` event was that a member who kept ticking after the
// failed press would have a half-edited card filed out from under them; a
// frozen copy has no such problem, because what goes out is precisely what was
// pressed.
//
// A JOB is one submission, and it is usually more than one request: a filed
// flight is the flight, then its photos, then each squawk and that squawk's
// photos — and the later ones need ids the earlier ones return. So a job is an
// ordered list of STEPS, a step may refer to an earlier step's result
// (`OutboxRef`), and each step's result is recorded as it lands so a job
// interrupted half way resumes where it stopped rather than at the top. Every
// step also carries its own idempotency key (lib/idempotency.ts), which covers
// the case recording can't: the request landed and the reply didn't.
//
// Everything in this file is pure — no IndexedDB, no fetch, no window — so the
// rules are unit-tested under vitest's node environment like the rest of lib/.

/** "Use the `path` field of step `$ref`'s result here." */
export interface OutboxRef {
  $ref: string;
  path: string;
}

export interface JsonStep {
  id: string;
  type: "json";
  method: "POST" | "PATCH";
  url: string;
  /** May contain `OutboxRef`s at any depth; resolved just before sending. */
  body: Record<string, unknown>;
  requestId: string;
  /**
   * What to send instead if `url` answers 404. A checkout sign-off PATCHes the
   * draft row autosave created — and that row can be gone by the time a queued
   * sign-off is sent (discarded on another device, swept as abandoned). The
   * walk is still real, so it goes up as a fresh run rather than being refused.
   */
  onNotFound?: { method: "POST" | "PATCH"; url: string; body: Record<string, unknown> };
}

export interface PhotoStep {
  id: string;
  type: "photo";
  subject: "flight" | "squawk" | "checkout";
  subjectId: string | OutboxRef;
  file: Blob;
  fileName: string;
  requestId: string;
}

export type OutboxStep = JsonStep | PhotoStep;

/**
 * What a job is ABOUT, for the pages that need to know a submission is still
 * on its way — the runway card's "Preflight — complete" row, above all, which
 * would otherwise tell a member whose preflight is sitting in the outbox that
 * they never walked it.
 */
export interface OutboxMeta {
  type: "checkout" | "flight" | "squawk" | "attachments";
  aircraftId: string;
  kind?: "PREFLIGHT" | "RUNWAY";
  /** The draft row a checkout sign-off targets — autosave must not resume it. */
  checkoutId?: string | null;
}

export interface OutboxJob {
  id: string;
  /**
   * WHO pressed the button. A job is only ever sent while that member is the
   * one signed in: on the clubhouse iPad, member A's unsent flight must not go
   * up under member B's session — the server would file it as B's.
   */
  userId: string;
  userName: string;
  /** What the strip and the details list call it ("Post-flight — N8318B"). */
  label: string;
  meta: OutboxMeta;
  createdAt: string;
  steps: OutboxStep[];
  /** stepId → the JSON the server answered with. */
  results: Record<string, unknown>;
  /** stepId → why it was given up on. Only ever a non-primary step. */
  skipped: Record<string, string>;
  /**
   * `pending` — waiting to be sent, or part-sent.
   * `refused` — the club answered the PRIMARY step with a no. Kept, not
   *   dropped, so the member can read why; only they may discard it.
   * `partial` — sent, but some secondary step was given up on (a photo over
   *   the size limit). Kept for the same reason: a member who attached three
   *   pictures and sees two has a right to know which went missing and why.
   */
  state: "pending" | "refused" | "partial";
  /** The refusal, or the last reason a send didn't get through. */
  error: string | null;
  attempts: number;
  lastAttemptAt: string | null;
}

/** Why a step was dropped when the step it needed was. */
export const DEPENDENCY_SKIPPED = "Depended on something that wasn't filed.";

/** The step everything else hangs off. Its refusal is the job's refusal. */
export const PRIMARY_STEP = "main";

/**
 * What one attempt at one step came to.
 *
 *   ok        — the server has it; `data` is its answer.
 *   retry     — nothing to conclude: no signal, a timeout, a captive portal's
 *               login page, a 5xx. Stop the run here and try again later.
 *   signedOut — a 401. Not a refusal of the CONTENT, and nothing a retry fixes
 *               until somebody signs back in, so it waits like `retry` does.
 *   refused   — the server read it and said no.
 */
export type StepOutcome =
  | { kind: "ok"; data: unknown }
  | { kind: "retry"; reason: string }
  | { kind: "signedOut" }
  | { kind: "refused"; status: number; error: string };

/**
 * Sort one response into the four outcomes above.
 *
 * `status: null` is the fetch throwing — no reply at all. A 2xx whose body
 * isn't JSON is a RETRY rather than a success, and it's the case worth the
 * paragraph: a captive-portal wifi (the FBO's, the airport café's) answers
 * every request with its own HTML login page and a 200, and taking that as
 * "filed" would drop the flight on the floor.
 */
export function classifyResponse(
  status: number | null,
  json: unknown,
  isJson: boolean
): StepOutcome {
  if (status === null) return { kind: "retry", reason: "No connection." };
  if (status === 401) return { kind: "signedOut" };
  if (status >= 200 && status < 300) {
    return isJson && json !== null && typeof json === "object"
      ? { kind: "ok", data: json }
      : { kind: "retry", reason: "The network answered, but not as the club." };
  }
  // Worth another go: the server or something in front of it is having a bad
  // moment, and none of these is a judgement on what was sent.
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: "retry", reason: `The club's server is busy (${status}).` };
  }
  const error =
    json && typeof json === "object" && "error" in json
      ? String((json as { error: unknown }).error)
      : `Refused (${status}).`;
  return { kind: "refused", status, error };
}

/** Is this value a `{ $ref, path }` pointer at an earlier step's result? */
function isRef(value: unknown): value is OutboxRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OutboxRef).$ref === "string" &&
    typeof (value as OutboxRef).path === "string"
  );
}

/** Every step id a value refers to, at any depth. */
function refsIn(value: unknown): string[] {
  if (isRef(value)) return [value.$ref];
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object" && !(value instanceof Blob)) {
    return Object.values(value).flatMap(refsIn);
  }
  return [];
}

/** The steps this one can't be sent without. */
export function dependenciesOf(step: OutboxStep): string[] {
  const refs = step.type === "json" ? refsIn(step.body) : refsIn(step.subjectId);
  return Array.from(new Set(refs));
}

/**
 * Replace every ref with the value it points at.
 *
 * Returns `missing` naming the first step it couldn't resolve — not yet sent,
 * skipped, or answered without the field. The runner never sends a request
 * with a ref still in it: `{ $ref: "main" }` arriving as a squawk's `flightId`
 * would be a squawk filed against nothing.
 */
export function resolveRefs<T>(
  value: T,
  results: Record<string, unknown>
): { value: T } | { missing: string } {
  let missing: string | null = null;
  const walk = (v: unknown): unknown => {
    if (missing) return v;
    if (isRef(v)) {
      const result = results[v.$ref];
      const field =
        result && typeof result === "object"
          ? (result as Record<string, unknown>)[v.path]
          : undefined;
      if (field === undefined || field === null) {
        missing = v.$ref;
        return v;
      }
      return field;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Blob)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const resolved = walk(value);
  return missing ? { missing } : { value: resolved as T };
}

/** The next step to send, or null when every step is answered or given up on. */
export function nextStep(job: OutboxJob): OutboxStep | null {
  return job.steps.find((s) => !(s.id in job.results) && !(s.id in job.skipped)) ?? null;
}

/**
 * What a finished job becomes: gone (null) when everything landed, or kept as
 * `partial` when something was given up on. Only REAL refusals count — a step
 * skipped because what it hung off was skipped is already explained by that.
 */
export function settle(job: OutboxJob): OutboxJob | null {
  const refused = Object.values(job.skipped).some((r) => r !== DEPENDENCY_SKIPPED);
  return refused ? { ...job, state: "partial", error: null } : null;
}

/**
 * Give up on a step, and on everything downstream of it — a photo of a squawk
 * that was refused has nothing to attach to, and leaving it in the job would
 * stall the job forever on a ref that can never resolve.
 */
function skipWithDependents(
  job: OutboxJob,
  stepId: string,
  reason: string
): Record<string, string> {
  const skipped = { ...job.skipped, [stepId]: reason };
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of job.steps) {
      if (step.id in skipped || step.id in job.results) continue;
      if (dependenciesOf(step).some((d) => d in skipped)) {
        skipped[step.id] = DEPENDENCY_SKIPPED;
        changed = true;
      }
    }
  }
  return skipped;
}

/**
 * Fold one attempt's outcome into the job. Pure: returns the new job.
 *
 * The rule for refusals is the one judgement call in here. A refused PRIMARY
 * step refuses the job — the flight wasn't filed, so the member has to hear
 * why, and nothing else in the job means anything without it. A refused
 * SECONDARY step (a photo over the size limit, a squawk the server didn't like)
 * is skipped with its reason and the job carries on: the flight is filed, and
 * holding it hostage to one photo would be the outbox losing the flight to save
 * the picture.
 */
export function applyOutcome(
  job: OutboxJob,
  stepId: string,
  outcome: StepOutcome,
  now: Date = new Date()
): OutboxJob {
  const attempted = {
    ...job,
    attempts: job.attempts + 1,
    lastAttemptAt: now.toISOString(),
  };
  switch (outcome.kind) {
    case "ok":
      return {
        ...attempted,
        results: { ...job.results, [stepId]: outcome.data },
        error: null,
      };
    case "retry":
      return { ...attempted, error: outcome.reason };
    case "signedOut":
      return { ...attempted, error: "Sign in to send this." };
    case "refused":
      if (stepId === PRIMARY_STEP) {
        return { ...attempted, state: "refused", error: outcome.error };
      }
      return { ...attempted, skipped: skipWithDependents(job, stepId, outcome.error) };
  }
}

/** Mark a step unsendable because a step it needs was given up on. */
export function skipUnresolvable(job: OutboxJob, stepId: string): OutboxJob {
  return {
    ...job,
    skipped: skipWithDependents(job, stepId, DEPENDENCY_SKIPPED),
  };
}

/** The jobs this member may send right now, oldest first. */
export function sendableJobs(jobs: OutboxJob[], userId: string | null): OutboxJob[] {
  if (!userId) return [];
  return jobs
    .filter((j) => j.userId === userId && j.state === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * A fresh idempotency key. `crypto.randomUUID` everywhere it exists (every
 * browser this club uses, from iOS 15.4); the fallback is for an older
 * clubhouse tablet and only has to be unique, not cryptographic.
 */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// ── Building jobs ─────────────────────────────────────────────────────────
//
// The pages describe WHAT they're submitting; these turn it into steps. Kept
// here so the step graph — which id feeds which body — is tested once rather
// than re-derived on four pages.

/** A squawk raised on a card or a flight, as the pages hold it. */
export interface QueuedSquawk {
  title: string;
  description: string;
  photos: File[];
}

/** One upload step per file, each with its own key, all against `subjectId`. */
function photoSteps(
  prefix: string,
  subject: PhotoStep["subject"],
  subjectId: string | OutboxRef,
  files: File[]
): PhotoStep[] {
  return files.map((file, i) => ({
    id: `${prefix}photo-${i}`,
    type: "photo",
    subject,
    subjectId,
    file,
    fileName: file.name || `photo-${i}.jpg`,
    requestId: newRequestId(),
  }));
}

/** The squawk POSTs and their photos, filed against `against`. */
function squawkSteps(
  aircraftId: string,
  against: { flightId?: string | OutboxRef; checkoutId?: string | OutboxRef },
  squawks: QueuedSquawk[]
): OutboxStep[] {
  return squawks.flatMap((squawk, i): OutboxStep[] => {
    const id = `squawk-${i}`;
    return [
      {
        id,
        type: "json",
        method: "POST",
        url: "/api/squawks",
        body: {
          aircraftId,
          ...against,
          title: squawk.title,
          description: squawk.description || null,
        },
        requestId: newRequestId(),
      },
      ...photoSteps(`${id}-`, "squawk", { $ref: id, path: "id" }, squawk.photos),
    ];
  });
}

/** The fields every job shares, filled in. */
function job(
  owner: { userId: string; userName: string },
  label: string,
  meta: OutboxMeta,
  steps: OutboxStep[]
): OutboxJob {
  return {
    id: newRequestId(),
    ...owner,
    label,
    meta,
    createdAt: new Date().toISOString(),
    steps,
    results: {},
    skipped: {},
    state: "pending",
    error: null,
    attempts: 0,
    lastAttemptAt: null,
  };
}

/**
 * Sign a checkout card off: the run itself, then whatever the page was still
 * holding for it (photos taken on the walk, squawks raised on the last item).
 */
export function checkoutSignOffJob(args: {
  owner: { userId: string; userName: string };
  label: string;
  kind: "PREFLIGHT" | "RUNWAY";
  aircraftId: string;
  /** The draft row autosave made, or null when the first sync never landed. */
  serverId: string | null;
  payload: Record<string, unknown>;
  photos?: File[];
  squawks?: QueuedSquawk[];
}): OutboxJob {
  const fresh = {
    method: "POST" as const,
    url: "/api/checkouts",
    body: { aircraftId: args.aircraftId, kind: args.kind, ...args.payload },
  };
  const main: JsonStep = args.serverId
    ? {
        id: PRIMARY_STEP,
        type: "json",
        method: "PATCH",
        url: `/api/checkouts/${args.serverId}`,
        body: args.payload,
        requestId: newRequestId(),
        onNotFound: fresh,
      }
    : { id: PRIMARY_STEP, type: "json", ...fresh, requestId: newRequestId() };
  const ref = { $ref: PRIMARY_STEP, path: "id" };
  return job(
    args.owner,
    args.label,
    { type: "checkout", aircraftId: args.aircraftId, kind: args.kind, checkoutId: args.serverId },
    [
      main,
      ...photoSteps("", "checkout", ref, args.photos ?? []),
      ...squawkSteps(args.aircraftId, { checkoutId: ref }, args.squawks ?? []),
    ]
  );
}

/** File a flight, then its photos and squawks against the row it creates. */
export function flightJob(args: {
  owner: { userId: string; userName: string };
  label: string;
  aircraftId: string;
  body: Record<string, unknown>;
  photos?: File[];
  squawks?: QueuedSquawk[];
}): OutboxJob {
  const ref = { $ref: PRIMARY_STEP, path: "id" };
  return job(args.owner, args.label, { type: "flight", aircraftId: args.aircraftId }, [
    {
      id: PRIMARY_STEP,
      type: "json",
      method: "POST",
      url: "/api/flights",
      body: args.body,
      requestId: newRequestId(),
    },
    ...photoSteps("", "flight", ref, args.photos ?? []),
    ...squawkSteps(args.aircraftId, { flightId: ref }, args.squawks ?? []),
  ]);
}

/**
 * Things raised on a card that hasn't been signed off — sent as soon as the
 * draft has a row. The squawks matter most: the walk that finds a bad tyre is
 * the walk nobody signs off, because nobody flies it.
 *
 * There's no primary step here — each squawk and photo stands on its own — so
 * a refusal skips just that one, and the job lands as `partial` with the
 * reason on it for the member to read.
 */
export function attachmentsJob(args: {
  owner: { userId: string; userName: string };
  label: string;
  aircraftId: string;
  checkoutId: string;
  photos?: File[];
  squawks?: QueuedSquawk[];
}): OutboxJob | null {
  const steps: OutboxStep[] = [
    ...photoSteps("", "checkout", args.checkoutId, args.photos ?? []),
    ...squawkSteps(args.aircraftId, { checkoutId: args.checkoutId }, args.squawks ?? []),
  ];
  if (steps.length === 0) return null;
  return job(
    args.owner,
    args.label,
    { type: args.squawks?.length ? "squawk" : "attachments", aircraftId: args.aircraftId },
    steps
  );
}

/** One standalone squawk (Plane Status › Squawks), with its photos. */
export function squawkJob(args: {
  owner: { userId: string; userName: string };
  label: string;
  aircraftId: string;
  squawk: QueuedSquawk;
}): OutboxJob {
  const [first, ...rest] = squawkSteps(args.aircraftId, {}, [args.squawk]);
  // The squawk IS the submission, so it takes the primary id — a refused one
  // is a refused job, shown to the member, not a quietly skipped step.
  const main = { ...first, id: PRIMARY_STEP };
  const photos = rest.map((step) =>
    step.type === "photo" ? { ...step, subjectId: { $ref: PRIMARY_STEP, path: "id" } } : step
  );
  return job(args.owner, args.label, { type: "squawk", aircraftId: args.aircraftId }, [
    main,
    ...photos,
  ]);
}

/** Has this member got a submission of this sort still on its way? */
export function hasPending(
  jobs: OutboxJob[],
  userId: string | null,
  match: Partial<OutboxMeta>
): boolean {
  return jobs.some(
    (j) =>
      j.userId === userId &&
      j.state === "pending" &&
      Object.entries(match).every(([k, v]) => j.meta[k as keyof OutboxMeta] === v)
  );
}

/** A short count for the strip: "1 flight, 2 squawks". */
export function describePending(jobs: OutboxJob[]): string {
  const counts = new Map<string, number>();
  const noun: Record<OutboxMeta["type"], [string, string]> = {
    checkout: ["checkout", "checkouts"],
    flight: ["flight", "flights"],
    squawk: ["squawk", "squawks"],
    attachments: ["photo upload", "photo uploads"],
  };
  for (const j of jobs) counts.set(j.meta.type, (counts.get(j.meta.type) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([type, n]) => {
      const [one, many] = noun[type as OutboxMeta["type"]];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}
