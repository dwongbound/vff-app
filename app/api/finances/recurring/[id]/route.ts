// Change or stop a standing monthly charge. finance:manage.
//
// PATCH — rename it, change the amount, set an end date, or deactivate it.
// DELETE — only if it has never billed anything; otherwise deactivate, so the
//          lines it produced keep pointing at the rule that explains them.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { parseDollars } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { serializeRecurringCharge } from "@/lib/serialize";

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
      { error: "Only the Finance Officer or an admin can change recurring charges." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const existing = await prisma.recurringCharge.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such recurring charge." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) {
      return NextResponse.json({ error: "Give the charge a name." }, { status: 400 });
    }
    data.label = label;
  }

  if ("amountDollars" in body) {
    const amountCents = parseDollars(body.amountDollars);
    if (amountCents === null || amountCents <= 0) {
      return NextResponse.json(
        { error: "Enter how much it is, per month." },
        { status: 400 }
      );
    }
    data.amountCents = amountCents;
  }

  if (typeof body.active === "boolean") data.active = body.active;

  if ("endsOn" in body) {
    if (body.endsOn === null || body.endsOn === "") {
      data.endsOn = null;
    } else {
      const endsOn = new Date(String(body.endsOn));
      if (Number.isNaN(endsOn.getTime())) {
        return NextResponse.json({ error: "Invalid end date." }, { status: 400 });
      }
      data.endsOn = endsOn;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const updated = await prisma.recurringCharge.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeRecurringCharge(updated));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can remove recurring charges." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const billed = await prisma.charge.count({ where: { recurringChargeId: id } });
  if (billed > 0) {
    return NextResponse.json(
      {
        error:
          "This has already billed members — switch it off instead, so past statements still explain themselves.",
      },
      { status: 409 }
    );
  }

  await prisma.recurringCharge.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
