// One row of the airplane's maintenance sheet: correct it, sign it off, or
// take it off the list.
//
// The WHOLE route needs `maintenance:manage`, wording included — the same rule
// the squawk route follows, and for the same reason. "Annual inspection · last
// done 8 Jul 2026" is what the next pilot reads to decide the airplane is
// legal, so it isn't a note anyone may revise.
//
// The common write here is not an edit at all: it's PATCH { lastDoneTach,
// lastDoneOn } after the shop hands the airplane back, which is what restarts
// both countdowns at once.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { maintenanceFieldsFrom } from "@/lib/maintenance";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeMaintenanceItem } from "@/lib/serialize";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!can(user, "maintenance:manage")) {
    return NextResponse.json(
      { error: "Only the Maintenance Officer (or an admin) keeps this list." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const existing = await prisma.maintenanceItem.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such maintenance item." }, { status: 404 });
  }

  const fields = maintenanceFieldsFrom(body, true);
  if ("error" in fields) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }

  const updated = await prisma.maintenanceItem.update({
    where: { id },
    data: fields.data,
  });

  return NextResponse.json(serializeMaintenanceItem(updated));
}

/**
 * Take an item off the sheet for good.
 *
 * Nothing else in the app points at a maintenance item — no charge, no flight,
 * no squawk — so unlike a squawk or a booking there's no history to orphan, and
 * a real delete is honest. The softer option is still there and is usually the
 * right one: PATCH { active: false } keeps the row and its last-done dates for
 * an airplane whose equipment came out, which is why the UI asks which one the
 * officer means before it sends this.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!can(user, "maintenance:manage")) {
    return NextResponse.json(
      { error: "Only the Maintenance Officer (or an admin) keeps this list." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await prisma.maintenanceItem.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such maintenance item." }, { status: 404 });
  }

  await prisma.maintenanceItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
