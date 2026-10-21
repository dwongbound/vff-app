// The db half of the Finance Officer's invoices (lib/invoices.ts is the
// wording). One function both the preview (GET) and the send (POST) call, so
// the window can never show a different list or amount from what goes out.
import { currentPeriod, isBillablePeriod, periodOf, periodsBetween } from "./finance";
import { invoiceAddress, invoiceFor, type Invoice, type InvoiceScope } from "./invoices";
import { ensureRecurringChargesFor } from "./ledger";
import { prisma } from "./prisma";

export interface PreparedInvoice {
  member: { id: string; name: string; email: string | null };
  address: string | null;
  invoice: Invoice | null;
  skipReason: string | null;
  lastSentAt: Date | null;
}

/**
 * Every billed member's invoice for `scope`, sorted by name. `memberIds`
 * narrows it (unknown ids are simply absent); null means everyone.
 */
export async function prepareInvoices(opts: {
  scope: InvoiceScope;
  memberIds: string[] | null;
  officerName: string;
  financesUrl: string;
}): Promise<PreparedInvoice[]> {
  const { scope, memberIds } = opts;

  // Reading a month is what bills its dues (see lib/ledger.ts), and an
  // invoice is the one read that MUST see them — "September: $0" because
  // nobody had opened September yet would be a wrong invoice, not a late one.
  await materialise(scope);

  // `clubMember`: an instructor-only account has no statement to send.
  const members = await prisma.user.findMany({
    where: { clubMember: true, ...(memberIds ? { id: { in: memberIds } } : {}) },
    select: { id: true, name: true, email: true, username: true },
    orderBy: { name: "asc" },
  });
  const ids = members.map((m) => m.id);

  const charges = await prisma.charge.findMany({
    where: {
      memberId: { in: ids },
      deletedAt: null,
      voided: false,
      ...(scope === "all" ? { paidAt: null } : { period: scope }),
    },
    select: {
      memberId: true,
      kind: true,
      amountCents: true,
      description: true,
      period: true,
      incurredOn: true,
      voided: true,
      paidAt: true,
    },
  });
  // What each member owes across EVERY month — the line under a month's
  // invoice. Same rule as the ledger summary: standing and unsettled.
  const owed = await prisma.charge.groupBy({
    by: ["memberId"],
    where: { memberId: { in: ids }, deletedAt: null, voided: false, paidAt: null },
    _sum: { amountCents: true },
  });
  const owedBy = new Map(owed.map((o) => [o.memberId, o._sum.amountCents ?? 0]));
  const sends = await prisma.invoiceSend.findMany({
    where: { memberId: { in: ids }, scope },
    orderBy: { sentAt: "desc" },
    select: { memberId: true, sentAt: true },
  });
  const lastSent = new Map<string, Date>();
  for (const s of sends) if (!lastSent.has(s.memberId)) lastSent.set(s.memberId, s.sentAt);

  return members.map((m) => {
    const invoice = invoiceFor({
      scope,
      memberName: m.name,
      charges: charges.filter((c) => c.memberId === m.id),
      balanceDueCents: owedBy.get(m.id) ?? 0,
      officerName: opts.officerName,
      financesUrl: opts.financesUrl,
    });
    const address = invoiceAddress(m);
    const skipReason = !invoice
      ? scope === "all"
        ? "Nothing unpaid"
        : "Nothing this month"
      : !address
        ? "No email address on their account"
        : null;
    return {
      member: { id: m.id, name: m.name, email: m.email },
      address,
      invoice,
      skipReason,
      lastSentAt: lastSent.get(m.id) ?? null,
    };
  });
}

async function materialise(scope: InvoiceScope) {
  const current = currentPeriod();
  if (scope !== "all") {
    if (isBillablePeriod(scope)) await ensureRecurringChargesFor([scope]);
    return;
  }
  const firstRule = await prisma.recurringCharge.findFirst({
    orderBy: { startsOn: "asc" },
    select: { startsOn: true },
  });
  if (!firstRule) return;
  const since = periodOf(firstRule.startsOn);
  if (since <= current) await ensureRecurringChargesFor(periodsBetween(current, since));
}
