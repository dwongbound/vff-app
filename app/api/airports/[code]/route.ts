// PATCH /api/airports/[code] — change an airport's landing fee,
// `{ landingFeeDollars }` (empty = no fee on file). DELETE takes it off the
// list. Admins only (Club settings › Airports). Neither touches a flight
// already filed: what bills is the fee left on the flight.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { feeFromBody, normalizeAirport } from "@/lib/landingFees";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const code = normalizeAirport(decodeURIComponent((await params).code));

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Same reading as the POST: empty = none on file, zero kept, negative refused.
  const fee = feeFromBody(body);
  if (fee === "invalid") {
    return NextResponse.json({ error: "Enter the fee in dollars, like 6.00." }, { status: 400 });
  }

  const existing = await prisma.airport.findUnique({ where: { code } });
  if (!existing) return NextResponse.json({ error: "That airport is gone." }, { status: 404 });
  const row = await prisma.airport.update({
    where: { code },
    data: { landingFeeCents: fee },
    select: { code: true, landingFeeCents: true },
  });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const code = normalizeAirport(decodeURIComponent((await params).code));
  await prisma.airport.deleteMany({ where: { code } });
  return NextResponse.json({ ok: true });
}
