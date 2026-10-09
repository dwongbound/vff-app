// Hand-entered lines: a checkout fee, a fine, a share of an unexpected bill, a
// receipt the club owes somebody for.
//
// POST /api/finances/charges
//
// Three shapes, and who may send each is the first thing decided:
//
//   reimbursement: true   — "the club owes this member for X". Amount is a
//                           POSITIVE number of dollars and is stored negative.
//                           A member may file one for THEMSELVES
//                           (`finance:claim-own`); for anyone else it takes
//                           `finance:manage`. Lands unpaid: the officer still
//                           has to pay it out, or void it.
//   club: true            — the club's OWN money, no member: the "Club funds"
//                           form. `finance:manage`. Positive = money in,
//                           negative = money out. With nobody to chase it has
//                           no paid/unpaid state, and counts toward the club's
//                           balance the moment it's written (see the Charge
//                           model and `balanceContribution`).
//   memberId              — the original one-off against a member, signed:
//                           negative is a credit. `finance:manage`.
//
// Amount is sent in dollars because that's what the form asks for and what
// the receipt says; it's stored in cents. Charging several members at once is
// its own route (./split), since it writes many lines in one go.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { parseDollars, periodOf } from "@/lib/finance";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeCharge } from "@/lib/serialize";

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
  // Who ticked the line off as settled — money marked paid by nobody
  // in particular is how a statement loses an argument later.
  paidBy: { select: { id: true, name: true, email: true } },
} as const;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const officer = can(user, "finance:manage");

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const reimbursement = body.reimbursement === true;
  const clubLine = body.club === true;
  const memberId = typeof body.memberId === "string" ? body.memberId : "";

  // Permission first, before anything about the body is validated: a member
  // probing the route learns nothing from a 400 they'd have got a 403 for.
  if (reimbursement) {
    const forSelf = !memberId || memberId === user.id;
    if (forSelf ? !can(user, "finance:claim-own") : !officer) {
      return NextResponse.json(
        { error: "You can only claim a reimbursement for yourself." },
        { status: 403 }
      );
    }
  } else if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can add charges." },
      { status: 403 }
    );
  }

  if (reimbursement && clubLine) {
    return NextResponse.json(
      { error: "A reimbursement is owed to a member, not to the club." },
      { status: 400 }
    );
  }
  if (!reimbursement && !clubLine && !memberId) {
    return NextResponse.json({ error: "Pick a member." }, { status: 400 });
  }
  if (clubLine && memberId) {
    return NextResponse.json(
      { error: "A club line belongs to no member — send one or the other." },
      { status: 400 }
    );
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return NextResponse.json(
      { error: reimbursement ? "Say what it was for." : "Say what the charge is for." },
      { status: 400 }
    );
  }

  const parsed = parseDollars(body.amountDollars);
  if (parsed === null || parsed === 0 || (reimbursement && parsed < 0)) {
    return NextResponse.json(
      {
        error: reimbursement
          ? "Enter what you spent, as a positive amount."
          : "Enter an amount (negative for a credit).",
      },
      { status: 400 }
    );
  }
  // A reimbursement is always money owed TO the member: stored negative,
  // whatever the form did with the sign.
  const amountCents = reimbursement ? -parsed : parsed;

  const target = reimbursement ? memberId || user.id : clubLine ? null : memberId;
  if (target) {
    const member = await prisma.user.findUnique({
      where: { id: target },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json({ error: "No such member." }, { status: 404 });
    }
  }

  const incurredOn = body.incurredOn ? new Date(String(body.incurredOn)) : new Date();
  if (Number.isNaN(incurredOn.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const created = await prisma.charge.create({
    data: {
      memberId: target,
      kind: reimbursement ? "REIMBURSEMENT" : "ONE_OFF",
      amountCents,
      description,
      // The statement a charge lands on follows its date, so an officer can
      // back-date a charge into the month it actually belongs to.
      period: periodOf(incurredOn),
      incurredOn,
      createdById: user.id,
    },
    include: INCLUDE,
  });

  return NextResponse.json(serializeCharge(created, user.id), { status: 201 });
}
