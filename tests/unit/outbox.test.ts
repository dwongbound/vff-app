import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_SKIPPED,
  PRIMARY_STEP,
  applyOutcome,
  checkoutSignOffJob,
  classifyResponse,
  dependenciesOf,
  describePending,
  flightJob,
  hasPending,
  nextStep,
  resolveRefs,
  sendableJobs,
  settle,
  skipUnresolvable,
  squawkJob,
  attachmentsJob,
  type OutboxJob,
} from "@/lib/outbox";

const owner = { userId: "u1", userName: "Alex Rivera" };
const photo = (name: string) => new File(["x"], name, { type: "image/jpeg" });

function filed(over: Partial<Parameters<typeof flightJob>[0]> = {}): OutboxJob {
  return flightJob({
    owner,
    label: "Post-flight — N8318B",
    aircraftId: "ac1",
    body: { aircraftId: "ac1", tachEnd: 1506.1 },
    photos: [photo("hobbs.jpg")],
    squawks: [{ title: "Left brake soft", description: "", photos: [photo("brake.jpg")] }],
    ...over,
  });
}

describe("classifyResponse", () => {
  it("calls no reply at all a retry, never a refusal", () => {
    expect(classifyResponse(null, null, false).kind).toBe("retry");
  });

  it("calls a 200 that isn't JSON a retry — a captive portal's login page", () => {
    // The FBO's wifi answers everything with its own HTML and a 200. Taking
    // that as "filed" would drop the flight.
    expect(classifyResponse(200, null, false).kind).toBe("retry");
  });

  it("files a 2xx with a JSON body", () => {
    expect(classifyResponse(201, { id: "f1" }, true)).toEqual({ kind: "ok", data: { id: "f1" } });
  });

  it("waits on a 401 rather than refusing the content", () => {
    expect(classifyResponse(401, { error: "Not signed in." }, true).kind).toBe("signedOut");
  });

  it("retries server trouble and rate limits", () => {
    for (const status of [500, 502, 503, 408, 429]) {
      expect(classifyResponse(status, null, false).kind).toBe("retry");
    }
  });

  it("refuses a 4xx with the server's own message", () => {
    expect(classifyResponse(400, { error: "Enter the tach reading at shutdown." }, true)).toEqual({
      kind: "refused",
      status: 400,
      error: "Enter the tach reading at shutdown.",
    });
  });
});

describe("resolveRefs", () => {
  it("substitutes an earlier step's field, at any depth", () => {
    const out = resolveRefs(
      { flightId: { $ref: "main", path: "id" }, nested: [{ x: { $ref: "main", path: "id" } }] },
      { main: { id: "f1" } }
    );
    expect(out).toEqual({ value: { flightId: "f1", nested: [{ x: "f1" }] } });
  });

  it("names the step it can't resolve rather than sending the ref", () => {
    expect(resolveRefs({ flightId: { $ref: "main", path: "id" } }, {})).toEqual({
      missing: "main",
    });
  });

  it("leaves plain values alone", () => {
    expect(resolveRefs({ a: 1, b: "two", c: null }, {})).toEqual({
      value: { a: 1, b: "two", c: null },
    });
  });
});

describe("flightJob", () => {
  it("files the flight first, then hangs photos and squawks off its id", () => {
    const job = filed();
    expect(job.steps.map((s) => s.id)).toEqual([
      PRIMARY_STEP,
      "photo-0",
      "squawk-0",
      "squawk-0-photo-0",
    ]);
    expect(dependenciesOf(job.steps[1])).toEqual([PRIMARY_STEP]);
    expect(dependenciesOf(job.steps[2])).toEqual([PRIMARY_STEP]);
    // A squawk's photo hangs off the SQUAWK, not the flight.
    expect(dependenciesOf(job.steps[3])).toEqual(["squawk-0"]);
  });

  it("gives every step its own idempotency key", () => {
    const keys = filed().steps.map((s) => s.requestId);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("records who pressed the button", () => {
    expect(filed().userId).toBe("u1");
  });
});

describe("checkoutSignOffJob", () => {
  it("PATCHes the draft row autosave made, falling back to a fresh POST", () => {
    const job = checkoutSignOffJob({
      owner,
      label: "Preflight",
      kind: "PREFLIGHT",
      aircraftId: "ac1",
      serverId: "chk1",
      payload: { complete: true },
    });
    const main = job.steps[0];
    expect(main.type === "json" && main.method).toBe("PATCH");
    expect(main.type === "json" && main.url).toBe("/api/checkouts/chk1");
    expect(main.type === "json" && main.onNotFound?.url).toBe("/api/checkouts");
    expect(job.meta).toMatchObject({ type: "checkout", kind: "PREFLIGHT", checkoutId: "chk1" });
  });

  it("POSTs when the first sync never landed", () => {
    const job = checkoutSignOffJob({
      owner,
      label: "Runway",
      kind: "RUNWAY",
      aircraftId: "ac1",
      serverId: null,
      payload: { complete: true },
    });
    const main = job.steps[0];
    expect(main.type === "json" && main.method).toBe("POST");
    expect(main.type === "json" && main.body).toMatchObject({ kind: "RUNWAY", aircraftId: "ac1" });
  });
});

describe("attachmentsJob / squawkJob", () => {
  it("is nothing at all when there's nothing to send", () => {
    expect(
      attachmentsJob({ owner, label: "x", aircraftId: "ac1", checkoutId: "chk1" })
    ).toBeNull();
  });

  it("makes a standalone squawk the primary step, so a refusal is heard", () => {
    const job = squawkJob({
      owner,
      label: "Squawk",
      aircraftId: "ac1",
      squawk: { title: "Nav light out", description: "", photos: [photo("a.jpg")] },
    });
    expect(job.steps[0].id).toBe(PRIMARY_STEP);
    expect(dependenciesOf(job.steps[1])).toEqual([PRIMARY_STEP]);
  });
});

describe("applyOutcome", () => {
  it("records a result and moves on to the next step", () => {
    const job = applyOutcome(filed(), PRIMARY_STEP, { kind: "ok", data: { id: "f1" } });
    expect(job.results[PRIMARY_STEP]).toEqual({ id: "f1" });
    expect(nextStep(job)?.id).toBe("photo-0");
    expect(job.attempts).toBe(1);
  });

  it("keeps the job pending on a retry, with the reason", () => {
    const job = applyOutcome(filed(), PRIMARY_STEP, { kind: "retry", reason: "No connection." });
    expect(job.state).toBe("pending");
    expect(job.error).toBe("No connection.");
    expect(nextStep(job)?.id).toBe(PRIMARY_STEP);
  });

  it("refuses the whole job when the PRIMARY step is refused", () => {
    const job = applyOutcome(filed(), PRIMARY_STEP, {
      kind: "refused",
      status: 409,
      error: "Already filed.",
    });
    expect(job.state).toBe("refused");
    expect(job.error).toBe("Already filed.");
  });

  it("skips a refused secondary step — and what hangs off it — and carries on", () => {
    let job = applyOutcome(filed(), PRIMARY_STEP, { kind: "ok", data: { id: "f1" } });
    job = applyOutcome(job, "photo-0", { kind: "ok", data: { id: "p1" } });
    job = applyOutcome(job, "squawk-0", { kind: "refused", status: 400, error: "No title." });
    expect(job.state).toBe("pending");
    expect(job.skipped["squawk-0"]).toBe("No title.");
    // The squawk's photo has nothing to attach to.
    expect(job.skipped["squawk-0-photo-0"]).toBe(DEPENDENCY_SKIPPED);
    // Nothing left to send: every step either landed or was given up on.
    expect(nextStep(job)).toBeNull();
  });

  it("skipUnresolvable drops a step whose input never arrived", () => {
    const job = skipUnresolvable(filed(), "squawk-0");
    expect(job.skipped["squawk-0"]).toBe(DEPENDENCY_SKIPPED);
    expect(job.skipped["squawk-0-photo-0"]).toBe(DEPENDENCY_SKIPPED);
  });
});

describe("settle", () => {
  it("removes a job where everything landed", () => {
    const job = filed({ photos: [], squawks: [] });
    expect(settle(applyOutcome(job, PRIMARY_STEP, { kind: "ok", data: { id: "f1" } }))).toBeNull();
  });

  it("keeps a job with a REAL refusal in it, so the member can read it", () => {
    let job = applyOutcome(filed(), PRIMARY_STEP, { kind: "ok", data: { id: "f1" } });
    job = applyOutcome(job, "photo-0", { kind: "refused", status: 413, error: "Too big." });
    job = applyOutcome(job, "squawk-0", { kind: "ok", data: { id: "s1" } });
    job = applyOutcome(job, "squawk-0-photo-0", { kind: "ok", data: { id: "p2" } });
    expect(settle(job)?.state).toBe("partial");
  });
});

describe("sendableJobs", () => {
  it("only ever sends the signed-in member's own jobs", () => {
    // Member A's flight on the clubhouse iPad must never go up as member B.
    const mine = filed();
    const theirs = { ...filed(), userId: "u2" };
    expect(sendableJobs([mine, theirs], "u1")).toEqual([mine]);
    expect(sendableJobs([mine, theirs], null)).toEqual([]);
  });

  it("sends oldest first and skips refused ones", () => {
    const a = { ...filed(), createdAt: "2026-10-07T10:00:00Z" };
    const b = { ...filed(), createdAt: "2026-10-07T09:00:00Z" };
    const c = { ...filed(), state: "refused" as const };
    expect(sendableJobs([a, b, c], "u1")).toEqual([b, a]);
  });
});

describe("hasPending / describePending", () => {
  it("finds a queued preflight for the runway card", () => {
    const job = checkoutSignOffJob({
      owner,
      label: "Preflight",
      kind: "PREFLIGHT",
      aircraftId: "ac1",
      serverId: null,
      payload: {},
    });
    expect(hasPending([job], "u1", { type: "checkout", kind: "PREFLIGHT", aircraftId: "ac1" })).toBe(true);
    expect(hasPending([job], "u1", { type: "checkout", kind: "RUNWAY" })).toBe(false);
    expect(hasPending([job], "u2", { type: "checkout" })).toBe(false);
  });

  it("counts by kind", () => {
    expect(describePending([filed(), filed()])).toBe("2 flights");
  });
});
