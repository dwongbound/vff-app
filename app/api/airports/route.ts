// GET /api/airports — the club's airports and their landing fees, for every
// flight form's Landing fee prefill (any signed-in member).
// POST /api/airports — add one, `{ code, landingFeeDollars }` (admins; it's
// Club settings › Airports). See the Airport model and lib/landingFees.ts.
import { NextResponse } from "next/server";
import { getAdminUser, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { airportCodeError, feeFromBody, normalizeAirport } from "@/lib/landingFees";

/** The wire shape: the identifier and the fee in cents (null = none on file). */
const SELECT = { code: true, landingFeeCents: true } as const;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rows = await prisma.airport.findMany({ select: SELECT, orderBy: { code: "asc" } });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const code = normalizeAirport(String(body.code ?? ""));
  const codeError = airportCodeError(code);
  if (codeError) return NextResponse.json({ error: codeError }, { status: 400 });
  const fee = feeFromBody(body);
  if (fee === "invalid") {
    return NextResponse.json({ error: "Enter the fee in dollars, like 6.00." }, { status: 400 });
  }

  const existing = await prisma.airport.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: `${code} is already on the list.` }, { status: 409 });
  }
  const row = await prisma.airport.create({
    data: { code, landingFeeCents: fee },
    select: SELECT,
  });
  return NextResponse.json(row, { status: 201 });
}
