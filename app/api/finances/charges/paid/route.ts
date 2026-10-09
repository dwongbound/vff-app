// Settle many lines in one go — the month header's "Mark all paid". No
// confirmation on the page: like a single line's Paid, it's undone a line at a
// time, and only Delete asks first.
//
// POST /api/finances/charges/paid — finance:manage. { ids: string[] }
//
// Marks every named line that is still STANDING and UNSETTLED; a voided line
// stays voided and an already-paid one keeps the date and the officer it was
// first ticked off by, so pressing it twice is harmless. Answers with every
// named line as it now stands, which is what the page folds back into what it
// has loaded rather than re-reading the books.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeCharge } from "@/lib/serialize";

const MAX_IDS = 1000;

const INCLUDE = {
  member: { select: { id: true, name: true, email: true } },
  paidBy: { select: { id: true, name: true, email: true } },
} as const;

export async function POST(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) {
    return NextResponse.json(
      { error: "Only the Finance Officer or an admin can mark lines paid." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nothing to mark paid." }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: "Too many lines at once." }, { status: 400 });
  }

  await prisma.charge.updateMany({
    where: { id: { in: ids }, voided: false, paidAt: null, deletedAt: null },
    data: { paidAt: new Date(), paidById: officer.id },
  });

  const rows = await prisma.charge.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: INCLUDE,
  });
  return NextResponse.json(rows.map((row) => serializeCharge(row, officer.id)));
}
