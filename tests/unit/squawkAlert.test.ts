import { describe, expect, it } from "vitest";
import { squawkAlertEmail, squawkAlertRecipients, type AlertCandidate } from "@/lib/squawkAlert";

const person = (over: Partial<AlertCandidate> & { id: string }): AlertCandidate => ({
  email: `${over.id}@x.org`,
  username: `${over.id}@x.org`,
  isAdmin: false,
  positions: [],
  ...over,
});

describe("squawkAlertRecipients", () => {
  it("mails every Safety Officer and not the admins", () => {
    const out = squawkAlertRecipients(
      [
        person({ id: "so1", positions: ["SAFETY_OFFICER"] }),
        person({ id: "so2", positions: ["SAFETY_OFFICER", "PRESIDENT"] }),
        person({ id: "admin", isAdmin: true }),
      ],
      "member"
    );
    expect(out).toEqual({ addresses: ["so1@x.org", "so2@x.org"], fallback: false });
  });

  it("falls back to the admins while the office is empty", () => {
    const out = squawkAlertRecipients(
      [person({ id: "admin", isAdmin: true }), person({ id: "fo", positions: ["FINANCE_OFFICER"] })],
      "member"
    );
    expect(out).toEqual({ addresses: ["admin@x.org"], fallback: true });
  });

  it("leaves out the member who filed it", () => {
    const so = person({ id: "so", positions: ["SAFETY_OFFICER"] });
    expect(squawkAlertRecipients([so], "so").addresses).toEqual([]);
  });

  it("uses the username when it's the email, and skips anyone with no address", () => {
    const out = squawkAlertRecipients(
      [
        person({ id: "a", email: null, username: "A@X.org", positions: ["SAFETY_OFFICER"] }),
        person({ id: "b", email: null, username: "bob", positions: ["SAFETY_OFFICER"] }),
        person({ id: "c", email: "a@x.org", positions: ["SAFETY_OFFICER"] }),
      ],
      "member"
    );
    expect(out.addresses).toEqual(["a@x.org"]);
  });
});

describe("squawkAlertEmail", () => {
  const base = {
    tailNumber: "N8318B",
    title: "Left brake <soft>",
    description: "Pedal goes nearly\nto the floor",
    reporterName: "Alex Rivera",
    filedAt: "2026-10-22T17:05:00Z",
    squawkUrl: "https://example.org/status/squawks#abc",
    fallback: false,
  };

  it("names the airplane and the squawk in the subject", () => {
    expect(squawkAlertEmail(base).subject).toBe("New squawk on N8318B: Left brake <soft>");
  });

  it("carries who, when (club time), the wording and the link", () => {
    const { text } = squawkAlertEmail(base);
    expect(text).toContain("Alex Rivera filed a squawk on N8318B (Thu, Oct 22, 10:05 AM)");
    expect(text).toContain("Pedal goes nearly\nto the floor");
    expect(text).toContain("https://example.org/status/squawks#abc");
    expect(text).toContain("as the club's Safety Officer");
  });

  it("escapes member-typed text in the HTML", () => {
    const { html } = squawkAlertEmail(base);
    expect(html).toContain("Left brake &lt;soft&gt;");
    expect(html).not.toContain("<soft>");
  });

  it("says why an admin is getting it when the office is empty", () => {
    expect(squawkAlertEmail({ ...base, fallback: true }).text).toContain(
      "nobody holds the Safety Officer position"
    );
  });

  it("omits the description block when there isn't one", () => {
    const { html } = squawkAlertEmail({ ...base, description: null });
    expect(html).not.toContain("pre-wrap");
  });
});
