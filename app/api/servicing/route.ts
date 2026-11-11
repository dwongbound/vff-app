// Fuel and oil put into the airplane, with no flight attached.
//
// GET  /api/servicing?aircraftId=&limit=  — newest first.
// POST /api/servicing                     — file one fill-up.
//
// The post-flight form still records servicing done AFTER a flight, on the
// Flight row; this is the same fact for fuel that went in before one, or on a
// day nobody flew. Nothing here touches the tach: no flight happened, so
// there is no hour to bill and nothing to advance.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncServicingCharges } from "@/lib/ledger";
import { serializeServicing } from "@/lib/serialize";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
} as const;

/** Number, or null for "" / null / undefined / unparseable. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Dollars on the receipt, cents in the column — the same deal /api/flights makes. */
function fuelCostCents(body: Record<string, unknown>): number | null {
  const cents = num(body.fuelCostCents);
  if (cents != null) return Math.round(cents);
  const dollars = num(body.fuelCostDollars);
  if (dollars != null) return Math.round(dollars * 100);
  return null;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const mine = url.searchParams.get("mine") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const rows = await prisma.servicing.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
    },
    include: INCLUDE,
    orderBy: [{ servicedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json(rows.map((r) => serializeServicing(r, user.id)));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true, tailNumber: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  const fuelAddedGal = num(body.fuelAddedGal);
  const oilAddedQts = num(body.oilAddedQts);
  const cost = fuelCostCents(body);

  // A row that records nothing is worse than no row: it appears in the
  // servicing list saying an event happened and refuses to say what.
  if (fuelAddedGal == null && oilAddedQts == null && cost == null) {
    return NextResponse.json(
      { error: "Record some fuel, some oil, or what it cost." },
      { status: 400 }
    );
  }
  if ((fuelAddedGal ?? 0) < 0 || (oilAddedQts ?? 0) < 0 || (cost ?? 0) < 0) {
    return NextResponse.json(
      { error: "Fuel, oil and cost can't be negative." },
      { status: 400 }
    );
  }

  const servicedAt = body.servicedAt ? new Date(String(body.servicedAt)) : new Date();
  if (Number.isNaN(servicedAt.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const created = await prisma.servicing.create({
    data: {
      aircraftId,
      userId: user.id,
      servicedAt,
      fuelAddedGal,
      fuelCostCents: cost,
      oilAddedQts,
      // Absent means the member's own card — the default that can't quietly
      // swallow money somebody is owed. Only an explicit `false` says the club
      // paid.
      paidPersonally: body.paidPersonally !== false,
      notes: body.notes ? String(body.notes).trim() : null,
    },
    include: INCLUDE,
  });

  // Fuel on a member's own card is a debt the club owes them, exactly as it is
  // when the same purchase rides on a filed flight.
  await syncServicingCharges({
    id: created.id,
    userId: created.userId,
    servicedAt: created.servicedAt,
    fuelCostCents: created.fuelCostCents,
    paidPersonally: created.paidPersonally,
    aircraft: { tailNumber: created.aircraft.tailNumber },
  });

  return NextResponse.json(serializeServicing(created, user.id), { status: 201 });
}
