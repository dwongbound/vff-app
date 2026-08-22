// Standing monthly charges — the club's dues, any private arrangement, and
// PAYBACKS: the same rule with a negative amount, for the member the club pays
// $50 a month to run the website. See `recurringKind` in lib/finance.ts for
// why the sign picks the statement line's kind rather than a separate flag.
//
// GET  /api/finances/recurring — finance:read-all. The rules themselves are
//      officer-facing; a member sees only the LINES a rule produced, on their
//      own statement.
// POST /api/finances/recurring — finance:manage.
//
// Changing a rule never rewrites months already billed: the lines it produced
// are Charge rows in their own right. That's deliberate — a dues increase in
// August must not silently restate July.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { parseDollars } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { serializeRecurringCharge } from "@/lib/serialize";

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
} as const;

export async function GET() {
  const officer = await getCapableUser("finance:read-all");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can see the club's rules." },
      { status: 403 }
    );
  }

  const rules = await prisma.recurringCharge.findMany({
    include: INCLUDE,
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(rules.map(serializeRecurringCharge));
}

export async function POST(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can add recurring charges." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Give the charge a name." }, { status: 400 });
  }

  // The amount arrives as a POSITIVE number of dollars plus a direction, and
  // the two are combined here. The client could send a negative amount
  // directly, but a minus sign is exactly the sort of thing that gets lost or
  // duplicated on the way through a form — and the difference between the two
  // is the difference between billing somebody $50 a month and paying them
  // $50 a month. An explicit direction can't be typed by accident.
  const magnitude = parseDollars(body.amountDollars);
  if (magnitude === null || magnitude <= 0) {
    return NextResponse.json(
      { error: "Enter how much it is, per month." },
      { status: 400 }
    );
  }
  const payback = body.payback === true;
  const amountCents = payback ? -magnitude : magnitude;

  // Null memberId = every member. That's the dues case.
  const memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : null;
  if (memberId) {
    const member = await prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json({ error: "No such member." }, { status: 404 });
    }
  }
  // A club-wide PAYBACK would credit every member every month — a standing
  // rebate to the whole club, which is a thing a club could conceivably vote
  // for and is much more likely to be somebody forgetting to pick a name.
  // Refused rather than guessed at: the money goes out either way, and this
  // is the one mistake here that is expensive and silent.
  if (payback && !memberId) {
    return NextResponse.json(
      { error: "Choose who the payback goes to — a payback has to name a member." },
      { status: 400 }
    );
  }

  const startsOn = body.startsOn ? new Date(String(body.startsOn)) : new Date();
  if (Number.isNaN(startsOn.getTime())) {
    return NextResponse.json({ error: "Invalid start date." }, { status: 400 });
  }
  const endsOn = body.endsOn ? new Date(String(body.endsOn)) : null;
  if (endsOn && Number.isNaN(endsOn.getTime())) {
    return NextResponse.json({ error: "Invalid end date." }, { status: 400 });
  }

  const created = await prisma.recurringCharge.create({
    data: {
      label,
      amountCents,
      memberId,
      startsOn,
      endsOn,
      createdById: officer.id,
    },
    include: INCLUDE,
  });

  return NextResponse.json(serializeRecurringCharge(created), { status: 201 });
}
