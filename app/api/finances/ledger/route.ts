// Every month's statement, newest first, a page at a time.
//
// GET /api/finances/ledger?[before=YYYY-MM][&months=N][&all=1]
//   • any member          — their own lines, and only their own.
//   • finance:read-all    — every member's, when &all=1 is asked for.
//
// The month-at-a-time GET /api/finances is still there and still right for a
// single statement; this is the Finances page's own feed, which scrolls back
// through the club's whole history instead of making a member open each month
// to find out whether it was paid.
//
// Club-level lines (no member — see the Charge model) come back in the
// club-wide scope only: `memberId: user.id` can never match one.
//
// The FIRST page (no `before`) does two things the later ones don't:
//   • materialises the standing rules for every month since the earliest one
//     started. Reading a month is what bills it (see lib/ledger.ts), and a
//     running balance over months nobody happened to open would otherwise be
//     missing their dues — the old page's quiet failure, made visible.
//   • returns the summary: each member's outstanding total across ALL months,
//     which the page needs to draw a running balance while holding only the
//     months scrolled to so far.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  currentPeriod,
  isPeriod,
  periodOf,
  periodsBetween,
  shiftPeriod,
  type Period,
} from "@/lib/finance";
import { ensureRecurringChargesFor } from "@/lib/ledger";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeCharge, serializeUser } from "@/lib/serialize";
import type { ApiLedgerPage } from "@/lib/types";

const CHARGE_INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
  paidBy: { select: { id: true, name: true, email: true } },
} as const;

const DEFAULT_MONTHS = 3;
// A reload after a change re-reads every month already on screen in one call,
// so the cap is generous; it's there to bound a hostile query, not a real one.
const MAX_MONTHS = 120;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!can(user, "finance:read-own")) {
    return NextResponse.json(
      { error: "Your account isn't billed by the club, so it has no statements." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const beforeParam = url.searchParams.get("before");
  const before: Period | null =
    beforeParam && isPeriod(beforeParam) ? beforeParam : null;
  const monthsParam = Number(url.searchParams.get("months"));
  const months =
    Number.isInteger(monthsParam) && monthsParam > 0
      ? Math.min(monthsParam, MAX_MONTHS)
      : DEFAULT_MONTHS;

  // Same privacy rule as /api/finances: asking for everyone without the
  // capability gets your own lines back, not a 403 and not everyone's.
  const clubWide =
    url.searchParams.get("all") === "1" && can(user, "finance:read-all");
  const scope = clubWide ? {} : { memberId: user.id };
  const current = currentPeriod();

  if (!before) {
    const firstRule = await prisma.recurringCharge.findFirst({
      orderBy: { startsOn: "asc" },
      select: { startsOn: true },
    });
    if (firstRule) {
      const since = periodOf(firstRule.startsOn);
      if (since <= current) {
        await ensureRecurringChargesFor(periodsBetween(current, since));
      }
    }
  }

  // The ledger runs from the newest line (a charge dated ahead is still on the
  // books, so it can be later than this month) back to the oldest, and always
  // includes the current month — "nothing this month" is an answer.
  const bounds = await prisma.charge.aggregate({
    where: scope,
    _min: { period: true },
    _max: { period: true },
  });
  const newest = maxPeriod(current, bounds._max.period ?? current);
  const oldest = minPeriod(current, bounds._min.period ?? current);

  const start = before ? shiftPeriod(before, -1) : newest;
  let page: ApiLedgerPage["months"] = [];
  let nextBefore: Period | null = null;

  if (start >= oldest) {
    const end = maxPeriod(oldest, shiftPeriod(start, -(months - 1)));
    const charges = await prisma.charge.findMany({
      where: { ...scope, period: { gte: end, lte: start } },
      include: CHARGE_INCLUDE,
      orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }],
    });
    page = periodsBetween(start, end).map((period) => ({
      period,
      charges: charges
        .filter((c) => c.period === period)
        .map((c) => serializeCharge(c, user.id)),
    }));
    nextBefore = end > oldest ? end : null;
  }

  let summary: ApiLedgerPage["summary"] = null;
  if (!before) {
    // Outstanding = standing and unsettled — `outstandingContribution`'s rule,
    // done by the database across every month at once.
    const sums = await prisma.charge.groupBy({
      by: ["memberId"],
      where: { ...scope, voided: false, paidAt: null },
      _sum: { amountCents: true },
    });
    const memberIds = sums.flatMap((s) => (s.memberId ? [s.memberId] : []));
    const people = await prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    const byId = new Map(sums.map((s) => [s.memberId, s._sum.amountCents ?? 0]));
    // The settled half: `paidContribution`'s rule, summed by the database.
    const paid = await prisma.charge.aggregate({
      where: { ...scope, voided: false, paidAt: { not: null } },
      _sum: { amountCents: true },
    });
    summary = {
      members: people.map((p) => ({
        member: serializeUser(p),
        outstandingCents: byId.get(p.id) ?? 0,
      })),
      // The null group: lines on the club's own books. Only ever non-zero for
      // a club-wide read, since a member's scope names them.
      clubOutstandingCents: sums.find((s) => s.memberId === null)?._sum.amountCents ?? 0,
      paidCents: paid._sum.amountCents ?? 0,
    };
  }

  const payload: ApiLedgerPage = { clubWide, months: page, nextBefore, summary };
  return NextResponse.json(payload);
}

function maxPeriod(a: Period, b: Period): Period {
  return a > b ? a : b;
}

function minPeriod(a: Period, b: Period): Period {
  return a < b ? a : b;
}
