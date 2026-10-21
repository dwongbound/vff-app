import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_LIMIT, emailStatus, sendEmails } from "@/lib/email";

const msg = { to: "a@x.org", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "o@x.org" };

describe("emailStatus", () => {
  it("is off, naming what's missing, with nothing set", () => {
    const s = emailStatus({});
    expect(s.configured).toBe(false);
    expect(s.reason).toContain("RESEND_API_KEY and EMAIL_FROM are not set");
  });
  it("names the one missing variable", () => {
    expect(emailStatus({ RESEND_API_KEY: "k" }).reason).toContain("EMAIL_FROM is not set");
  });
  it("is on with both Resend variables", () => {
    expect(emailStatus({ RESEND_API_KEY: "k", EMAIL_FROM: "c@x.org" })).toEqual({
      configured: true,
      driver: "resend",
      reason: null,
    });
  });
  it("the log driver needs nothing", () => {
    expect(emailStatus({ EMAIL_DRIVER: "log" }).driver).toBe("log");
  });
  it("refuses a driver it doesn't know", () => {
    expect(emailStatus({ EMAIL_DRIVER: "smtp" }).configured).toBe(false);
  });
});

describe("sendEmails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails every message, without a network call, when not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await sendEmails([msg, msg], {});
    expect(out.every((r) => !r.ok)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the log driver sends nothing over the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendEmails([msg], { EMAIL_DRIVER: "log" })).toEqual([{ ok: true }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batches to Resend, with the officer as reply-to, in chunks of the limit", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const env = { RESEND_API_KEY: "key", EMAIL_FROM: "Club <c@x.org>" };
    const out = await sendEmails(Array(BATCH_LIMIT + 1).fill(msg), env);
    expect(out).toHaveLength(BATCH_LIMIT + 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails/batch");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toHaveLength(BATCH_LIMIT);
    expect(body[0]).toMatchObject({ from: "Club <c@x.org>", to: ["a@x.org"], reply_to: "o@x.org" });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer key" });
  });

  it("reports a refused batch on every message in it, with the service's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 })
    );
    const out = await sendEmails([msg, msg], { RESEND_API_KEY: "k", EMAIL_FROM: "c@x.org" });
    expect(out).toEqual([
      { ok: false, error: "Domain not verified" },
      { ok: false, error: "Domain not verified" },
    ]);
  });
});
