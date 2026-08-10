// Statements for a month.
//
// GET /api/finances?period=YYYY-MM[&all=1]
//   • any member          — their own statement, and only their own.
//   • finance:read-all    — every member's, when &all=1 is asked for.
//
// The privacy rule is enforced here rather than by the page: a member asking
// for &all=1 gets their own statement back, not a 403 and not everyone's.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { currentPeriod, isPeriod, totals, type Period } from "@/lib/finance";
import { ensureRecurringCharges } from "@/lib/ledger";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeCharge, serializeUser } from "@/lib/serialize";
import type { ApiFinances, ApiStatement } from "@/lib/types";

const CHARGE_INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
  // Who ticked the line off as settled — money marked paid by nobody
  // in particular is how a statement loses an argument later.
  paidBy: { select: { id: true, name: true, email: true } },
} as const;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // An instructor-only account has no statement here: nothing bills it, so
  // there is no month of theirs to read. The nav hides the tab; this is what
  // makes the URL agree with it.
  if (!can(user, "finance:read-own")) {
    return NextResponse.json(
      { error: "Your account isn't billed by the club, so it has no statements." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("period");
  const period: Period =
    requested && isPeriod(requested) ? requested : currentPeriod();

  const wantsEveryone = url.searchParams.get("all") === "1";
  const clubWide = wantsEveryone && can(user, "finance:read-all");

  // Reading a statement is what materialises that month's dues — idempotently,
  // so this is safe to do on every request (see lib/ledger.ts).
  await ensureRecurringCharges(period);

  const charges = await prisma.charge.findMany({
    where: { period, ...(clubWide ? {} : { memberId: user.id }) },
    include: CHARGE_INCLUDE,
    orderBy: [{ incurredOn: "asc" }, { createdAt: "asc" }],
  });

  // Everyone gets a statement, including members with no lines this month —
  // "you owe nothing" is an answer, and a missing row looks like a bug.
  const members = clubWide
    ? await prisma.user.findMany({
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
    : [{ id: user.id, name: user.name, email: user.email }];

  const statements: ApiStatement[] = members.map((member) => {
    const mine = charges.filter((c) => c.memberId === member.id);
    const sums = totals(mine);
    return {
      member: serializeUser(member),
      period,
      charges: mine.map((c) => serializeCharge(c, user.id)),
      ...sums,
    };
  });

  const payload: ApiFinances = { period, clubWide, statements };
  return NextResponse.json(payload);
}
