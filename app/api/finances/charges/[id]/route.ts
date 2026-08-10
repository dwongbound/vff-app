// Correct one line on a statement.
//
// PATCH /api/finances/charges/[id] — finance:manage.
//   { voided, voidReason }             — unwind a line, keeping the record.
//   { amountDollars, description }     — fix a line that was simply wrong.
//
// Voiding rather than deleting is the rule for anything derived: a flight's
// fuel credit that an officer voids stays voided even if the flight is later
// corrected (see lib/ledger.ts), so a decision to unwind something isn't
// silently reversed by an unrelated edit.
//
// DELETE is allowed only for hand-entered lines. A derived line has a source
// row that would just recreate it, so deleting one would be a lie that heals
// itself on the next edit.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { parseDollars } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { serializeCharge } from "@/lib/serialize";

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
} as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can change charges." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const existing = await prisma.charge.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such charge." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.voided === "boolean") {
    data.voided = body.voided;
    data.voidReason = body.voided
      ? typeof body.voidReason === "string" && body.voidReason.trim()
        ? body.voidReason.trim()
        : null
      : null;
  }

  if ("amountDollars" in body) {
    const amountCents = parseDollars(body.amountDollars);
    if (amountCents === null || amountCents === 0) {
      return NextResponse.json(
        { error: "Enter an amount (negative for a credit)." },
        { status: 400 }
      );
    }
    data.amountCents = amountCents;
  }

  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (!description) {
      return NextResponse.json(
        { error: "Say what the charge is for." },
        { status: 400 }
      );
    }
    data.description = description;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const updated = await prisma.charge.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeCharge(updated, officer.id));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can remove charges." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await prisma.charge.findUnique({
    where: { id },
    select: { id: true, kind: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such charge." }, { status: 404 });
  }

  if (existing.kind !== "ONE_OFF") {
    return NextResponse.json(
      {
        error:
          "That line comes from a flight or a recurring rule — void it instead, or change what it came from.",
      },
      { status: 409 }
    );
  }

  await prisma.charge.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
