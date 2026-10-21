import { describe, expect, it } from "vitest";
import {
  invoiceAddress,
  invoiceFor,
  invoiceLines,
  isInvoiceScope,
  scopeLabel,
  type InvoiceCharge,
} from "@/lib/invoices";

function line(over: Partial<InvoiceCharge>): InvoiceCharge {
  return {
    kind: "FLIGHT",
    amountCents: 10000,
    description: "1.0 tach hr",
    period: "2026-09",
    incurredOn: "2026-09-10T19:00:00Z",
    voided: false,
    paidAt: null,
    ...over,
  };
}

const base = {
  memberName: "Alex Rivera",
  officerName: "Robin Chen",
  financesUrl: "https://example.test/finances",
};

describe("isInvoiceScope / scopeLabel", () => {
  it("takes a month or all, nothing else", () => {
    expect(isInvoiceScope("2026-09")).toBe(true);
    expect(isInvoiceScope("all")).toBe(true);
    expect(isInvoiceScope("2026-13")).toBe(false);
    expect(isInvoiceScope("")).toBe(false);
    expect(isInvoiceScope(null)).toBe(false);
  });
  it("names the scope", () => {
    expect(scopeLabel("2026-09")).toBe("September 2026");
    expect(scopeLabel("all")).toBe("Everything unpaid");
  });
});

describe("invoiceLines", () => {
  const lines = [
    line({ description: "late", incurredOn: "2026-09-20T12:00:00Z" }),
    line({ description: "early", incurredOn: "2026-09-02T12:00:00Z", paidAt: "2026-09-30T00:00:00Z" }),
    line({ description: "voided", voided: true }),
    line({ description: "august", period: "2026-08", incurredOn: "2026-08-05T12:00:00Z" }),
  ];
  it("a month keeps its standing lines, paid ones included, oldest first", () => {
    expect(invoiceLines("2026-09", lines).map((l) => l.description)).toEqual(["early", "late"]);
  });
  it("all time keeps every unpaid standing line", () => {
    expect(invoiceLines("all", lines).map((l) => l.description)).toEqual(["august", "late"]);
  });
});

describe("invoiceFor", () => {
  it("is null when the scope has nothing in it", () => {
    expect(invoiceFor({ ...base, scope: "2026-10", charges: [line({})], balanceDueCents: 0 })).toBeNull();
    expect(
      invoiceFor({ ...base, scope: "all", charges: [line({ paidAt: "2026-09-30" })], balanceDueCents: 0 })
    ).toBeNull();
  });

  it("asks for what the month still owes, net of credits and payments", () => {
    const inv = invoiceFor({
      ...base,
      scope: "2026-09",
      charges: [
        line({ amountCents: 15000 }),
        line({ kind: "FUEL_CREDIT", amountCents: -4000, description: "Fuel" }),
        line({ kind: "DUES", amountCents: 5000, description: "Dues", paidAt: "2026-09-02" }),
      ],
      balanceDueCents: 11000,
    })!;
    expect(inv.amountDueCents).toBe(11000);
    expect(inv.lineCount).toBe(3);
    expect(inv.subject).toBe("VFF Flying Club statement for September 2026");
    expect(inv.text).toContain("Hi Alex,");
    expect(inv.text).toContain("Amount due: $110.00");
    expect(inv.text).toContain("[paid]");
    // Same as the headline, so no second line repeating it.
    expect(inv.text).not.toContain("Across all months");
  });

  it("adds the all-months balance when it differs from the month", () => {
    const inv = invoiceFor({ ...base, scope: "2026-09", charges: [line({})], balanceDueCents: 25000 })!;
    expect(inv.text).toContain("Across all months: you owe $250.00");
  });

  it("says a credit in words rather than as a negative amount due", () => {
    const inv = invoiceFor({
      ...base,
      scope: "2026-09",
      charges: [line({ kind: "REIMBURSEMENT", amountCents: -4000, description: "Oil" })],
      balanceDueCents: -4000,
    })!;
    expect(inv.text).toContain("The club owes you $40.00");
    expect(inv.text).not.toContain("-$40.00 due");
  });

  it("groups the all-time letter by month", () => {
    const inv = invoiceFor({
      ...base,
      scope: "all",
      charges: [line({ period: "2026-08", incurredOn: "2026-08-05T12:00:00Z" }), line({})],
      balanceDueCents: 20000,
    })!;
    expect(inv.subject).toBe("VFF Flying Club: what you owe the club");
    expect(inv.text.indexOf("August 2026")).toBeLessThan(inv.text.indexOf("September 2026"));
    expect(inv.text).toContain("Amount due: $200.00");
  });

  it("escapes everything typed into the HTML", () => {
    const inv = invoiceFor({
      ...base,
      memberName: "<b>Eve</b>",
      scope: "2026-09",
      charges: [line({ description: `<img src=x onerror="alert(1)">` })],
      balanceDueCents: 10000,
    })!;
    expect(inv.html).not.toContain("<img");
    expect(inv.html).not.toContain("<b>Eve");
    expect(inv.html).toContain("&lt;img");
  });
});

describe("invoiceAddress", () => {
  it("prefers the email, falls back to an email-shaped username", () => {
    expect(invoiceAddress({ email: "a@x.org", username: "zzz" })).toBe("a@x.org");
    expect(invoiceAddress({ email: null, username: "b@x.org" })).toBe("b@x.org");
    expect(invoiceAddress({ email: null, username: "bob" })).toBeNull();
  });
});
