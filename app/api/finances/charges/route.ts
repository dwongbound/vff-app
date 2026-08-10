// One-off charges: a checkout fee, a fine, a share of an unexpected bill.
//
// POST /api/finances/charges — finance:manage (so: the Finance Officer, or any
// admin). Amount is sent in dollars because that's what the form asks for and
// what the receipt says; it's stored in cents.
//
// A negative amount is allowed and means a credit — an officer refunding
// something the automatic fuel credit doesn't cover.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { parseDollars, periodOf } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { serializeCharge } from "@/lib/serialize";

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
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

  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  if (!memberId) {
    return NextResponse.json({ error: "Pick a member." }, { status: 400 });
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

  const member = await prisma.user.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "No such member." }, { status: 404 });
  }

  const incurredOn = body.incurredOn ? new Date(String(body.incurredOn)) : new Date();
  if (Number.isNaN(incurredOn.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const created = await prisma.charge.create({
    data: {
      memberId,
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
