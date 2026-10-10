// Charge several members at once — a shared bill, or the same fee for each.
//
// POST /api/finances/charges/split — finance:manage.
//   {
//     description, amountDollars (POSITIVE), incurredOn?,
//     mode: "split" | "each",
//     memberIds?: string[]   // omitted or empty = every flying member
//   }
//
//   split — amountDollars is a TOTAL, shared out to the cent (`splitCents`):
//           $100 three ways is 33.34 + 33.33 + 33.33, never a cent lost.
//   each  — amountDollars is what EVERY named member is charged.
//
// "Everyone" means the club's flying members (`clubMember`), not every
// account: a visiting instructor has no statement to put a share on, and
// splitting a hangar bill eight ways when seven people pay it would leave a
// share nobody can ever settle.
//
// One ONE_OFF line per member, written in one transaction so a bill is never
// half-charged. A split line says so in its description ("share of $100.00"),
// because a member reading $33.34 on their statement deserves to know it's a
// third of something rather than a price.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { chargeShares, formatMoney, parseDollars, periodOf } from "@/lib/finance";
import { prisma } from "@/lib/prisma";

const MAX_MEMBERS = 500;

export async function POST(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can charge members." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const mode = body.mode === "each" ? "each" : body.mode === "split" ? "split" : null;
  if (!mode) {
    return NextResponse.json(
      { error: "Say whether the amount is split or charged to each person." },
      { status: 400 }
    );
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Say what the charge is for." }, { status: 400 });
  }

  const amountCents = parseDollars(body.amountDollars);
  if (amountCents === null || amountCents <= 0) {
    return NextResponse.json(
      { error: "Enter an amount greater than zero." },
      { status: 400 }
    );
  }

  const requested: string[] = Array.isArray(body.memberIds)
    ? body.memberIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (requested.length > MAX_MEMBERS) {
    return NextResponse.json({ error: "Too many members." }, { status: 400 });
  }

  // Ordered by name so the odd cents of a split always land on the same
  // people, whichever order the form listed them in.
  const members = await prisma.user.findMany({
    where:
      requested.length > 0
        ? { id: { in: requested } }
        : { clubMember: true },
    select: { id: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (requested.length > 0 && members.length !== new Set(requested).size) {
    return NextResponse.json({ error: "No such member." }, { status: 404 });
  }
  if (members.length === 0) {
    return NextResponse.json({ error: "Nobody to charge." }, { status: 400 });
  }

  const incurredOn = body.incurredOn ? new Date(String(body.incurredOn)) : new Date();
  if (Number.isNaN(incurredOn.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const shares = chargeShares(amountCents, members.length, mode);
  const lineDescription =
    mode === "split" && members.length > 1
      ? `${description} — share of ${formatMoney(amountCents)}`
      : description;

  await prisma.$transaction(
    members.map((member, i) =>
      prisma.charge.create({
        data: {
          memberId: member.id,
          kind: "ONE_OFF",
          amountCents: shares[i],
          description: lineDescription,
          period: periodOf(incurredOn),
          incurredOn,
          createdById: officer.id,
        },
      })
    )
  );

  return NextResponse.json(
    {
      count: members.length,
      totalCents: shares.reduce((sum, cents) => sum + cents, 0),
    },
    { status: 201 }
  );
}
