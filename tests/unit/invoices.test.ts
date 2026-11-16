import { describe, expect, it } from "vitest";
import {
  invoiceAddress,
  invoiceFor,
  invoiceLines,
  isInvoiceScope,
  scopeLabel,
  type InvoiceCharge,
} from "@/lib/invoices";
import { PAYMENT_INSTRUCTIONS, statementPdf, statementTotals } from "@/lib/invoicePdf";

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

/** The PDF's bytes as text: streams are uncompressed, so the words are in there. */
function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

describe("invoiceFor", () => {
  it("is null when the scope has nothing in it", () => {
    expect(invoiceFor({ ...base, scope: "2026-10", charges: [line({})], balanceDueCents: 0 })).toBeNull();
    expect(
      invoiceFor({ ...base, scope: "all", charges: [line({ paidAt: "2026-09-30" })], balanceDueCents: 0 })
    ).toBeNull();
  });

  it("puts the money in an attached PDF and none of it in the email", () => {
    const inv = invoiceFor(
      {
        ...base,
        scope: "2026-09",
        charges: [
          line({ amountCents: 15000 }),
          line({ kind: "FUEL_CREDIT", amountCents: -4000, description: "Fuel" }),
          line({ kind: "DUES", amountCents: 5000, description: "Dues", paidAt: "2026-09-02" }),
        ],
        balanceDueCents: 11000,
      },
      new Date("2026-10-01T18:00:00Z")
    )!;
    expect(inv.amountDueCents).toBe(11000);
    expect(inv.lineCount).toBe(3);
    expect(inv.subject).toBe("VFF Flying Club statement for September 2026");
    expect(inv.text).toContain("Hi Alex,");
    expect(inv.text).toContain("Attached is your VFF Flying Club statement for September 2026.");
    expect(inv.text).not.toMatch(/\$\d/);
    expect(inv.html).not.toMatch(/\$\d/);
    expect(inv.attachment.filename).toBe("VFF statement 2026-09 - Alex Rivera.pdf");
    const pdf = pdfText(inv.attachment.content);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(Alex Rivera)");
    expect(pdf).toContain("($110.00)");
    expect(pdf).toContain("(PAID CLUB)");
  });

  it("tells the member how to pay, in the email and on the PDF", () => {
    const inv = invoiceFor({ ...base, scope: "2026-09", charges: [line({})], balanceDueCents: 10000 })!;
    expect(PAYMENT_INSTRUCTIONS).toBe(
      "Please Zelle to the club account or bring a check to the finance officer(s)."
    );
    expect(inv.text).toContain(PAYMENT_INSTRUCTIONS);
    expect(inv.html).toContain("Please Zelle to the club account");
    expect(pdfText(inv.attachment.content)).toContain("(How to pay)");
  });

  it("adds the all-months balance to the PDF when it differs from the month", () => {
    const inv = invoiceFor({ ...base, scope: "2026-09", charges: [line({})], balanceDueCents: 25000 })!;
    expect(pdfText(inv.attachment.content)).toContain("(Across all months: you owe $250.00)");
    const same = invoiceFor({ ...base, scope: "2026-09", charges: [line({})], balanceDueCents: 10000 })!;
    expect(pdfText(same.attachment.content)).not.toContain("Across all months");
  });

  it("says a credit in words rather than as a negative amount due", () => {
    const inv = invoiceFor({
      ...base,
      scope: "2026-09",
      charges: [line({ kind: "REIMBURSEMENT", amountCents: -4000, description: "Oil" })],
      balanceDueCents: -4000,
    })!;
    const pdf = pdfText(inv.attachment.content);
    expect(pdf).toContain("(THE CLUB OWES YOU)");
    expect(pdf).toContain("($40.00)");
    expect(pdf).not.toContain("(AMOUNT DUE)");
  });

  it("groups the all-time statement by month", () => {
    const inv = invoiceFor({
      ...base,
      scope: "all",
      charges: [line({ period: "2026-08", incurredOn: "2026-08-05T12:00:00Z" }), line({})],
      balanceDueCents: 20000,
    })!;
    expect(inv.subject).toBe("VFF Flying Club: what you owe the club");
    expect(inv.attachment.filename).toBe("VFF unpaid - Alex Rivera.pdf");
    const pdf = pdfText(inv.attachment.content);
    expect(pdf.indexOf("(August 2026)")).toBeGreaterThan(-1);
    expect(pdf.indexOf("(August 2026)")).toBeLessThan(pdf.indexOf("(September 2026)"));
    expect(pdf).toContain("($200.00)");
  });

  it("escapes everything typed into the HTML", () => {
    const inv = invoiceFor({
      ...base,
      memberName: "<b>Eve</b>",
      scope: "2026-09",
      charges: [line({ description: `<img src=x onerror="alert(1)">` })],
      balanceDueCents: 10000,
    })!;
    expect(inv.html).not.toContain("<b>Eve");
    expect(inv.html).toContain("&lt;b&gt;Eve");
  });
});

describe("statementTotals", () => {
  it("is charges − owed + paid out − paid club", () => {
    const t = statementTotals([
      { amountCents: 25000, paid: false },
      { amountCents: 17280, paid: true },
      { amountCents: -18873, paid: true },
      { amountCents: -4000, paid: false },
    ]);
    expect(t).toEqual({
      chargedCents: 42280,
      owedCents: 22873,
      paidOutCents: 18873,
      paidClubCents: 17280,
      dueCents: 42280 - 22873 + 18873 - 17280,
    });
  });

  it("matches the ledger's outstanding figure", () => {
    const rows = [
      { amountCents: 15000, paid: false },
      { amountCents: -4000, paid: false },
      { amountCents: 5000, paid: true },
      { amountCents: -3000, paid: true },
    ];
    // Unpaid lines only: 150 − 40 = 110.
    expect(statementTotals(rows).dueCents).toBe(11000);
  });
});

describe("statementPdf", () => {
  const statement = {
    title: "Statement for September 2026",
    label: "September 2026",
    grouped: false,
    memberName: "Alex Rivera",
    balanceDueCents: null,
    financesUrl: "https://example.test/finances",
    issuedOn: new Date("2026-10-01T18:00:00Z"),
  };

  it("tags a paid credit PAID OUT and a paid charge PAID CLUB, never plain PAID", () => {
    const pdf = pdfText(
      statementPdf({
        ...statement,
        rows: [
          { date: "Sep 1", month: "2026-09", what: "Dues", kind: "Dues", amountCents: 25000, paid: true },
          { date: "Sep 2", month: "2026-09", what: "Fuel", kind: "Fuel credit", amountCents: -4000, paid: true },
        ],
      })
    );
    expect(pdf).toContain("(PAID CLUB)");
    expect(pdf).toContain("(PAID OUT)");
    expect(pdf).not.toContain("(PAID)");
    for (const label of ["Charges", "Owed", "Paid out", "Paid club", "Nothing owed"]) {
      expect(pdf).toContain(`(${label})`);
    }
  });

  it("runs a long statement onto more pages with numbered footers", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: `Sep ${i + 1}`,
      month: "2026-09",
      what: `Flight ${i}`,
      kind: "Flight time",
      amountCents: 10000,
      paid: false,
    }));
    const pdf = pdfText(statementPdf({ ...statement, rows }));
    expect(pdf).toMatch(/\/Count [2-9]/);
    expect(pdf).toContain("(Page 1 of ");
  });
});

describe("invoiceAddress", () => {
  it("prefers the email, falls back to an email-shaped username", () => {
    expect(invoiceAddress({ email: "a@x.org", username: "zzz" })).toBe("a@x.org");
    expect(invoiceAddress({ email: null, username: "b@x.org" })).toBe("b@x.org");
    expect(invoiceAddress({ email: null, username: "bob" })).toBeNull();
  });
});
