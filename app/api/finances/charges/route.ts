// One-off charges: a checkout fee, a fine, a share of an unexpected bill.
//
// POST /api/finances/charges — finance:manage (so: the Finance Officer, or any
// admin). Amount is sent in dollars because that's what the form asks for and
// what the receipt says; it's stored in cents.
//
// A negative amount is allowed and means a credit — an officer refunding
// something the automatic fuel credit doesn't cover.
//
// `club: true` in place of a `memberId` records the line against the CLUB's
// own books rather than anybody's statement — an insurance bill, a grant, an
// opening balance. Same sign: positive = owed to the club, negative = the club
// owes. It has to be asked for by name: a missing memberId is still "pick a
// member", so a form that forgot the field can't quietly file a club line.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { parseDollars, periodOf } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { serializeCharge } from "@/lib/serialize";

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
  // Who ticked the line off as settled — money marked paid by nobody
  // in particular is how a statement loses an argument later.
  paidBy: { select: { id: true, name: true, email: true } },
} as const;

export async function POST(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can add charges." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const clubLine = body.club === true;
  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  if (!clubLine && !memberId) {
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
      { error: "Say what the charge is for." },
      { status: 400 }
    );
  }

  const amountCents = parseDollars(body.amountDollars);
  if (amountCents === null || amountCents === 0) {
    return NextResponse.json(
      { error: "Enter an amount (negative for a credit)." },
      { status: 400 }
    );
  }

  if (!clubLine) {
    const member = await prisma.user.findUnique({
      where: { id: memberId },
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
      memberId: clubLine ? null : memberId,
      kind: "ONE_OFF",
      amountCents,
      description,
      // The statement a charge lands on follows its date, so an officer can
      // back-date a charge into the month it actually belongs to.
      period: periodOf(incurredOn),
      incurredOn,
      createdById: officer.id,
    },
    include: INCLUDE,
  });

  return NextResponse.json(serializeCharge(created, officer.id), { status: 201 });
}
