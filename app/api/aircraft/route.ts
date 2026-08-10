// The club's airplanes, with their open squawks folded in so the client can
// tell at a glance whether anything is grounded.
import { NextResponse } from "next/server";
import {
  AIRCRAFT_INCLUDE,
  modelError,
  normalizeTailNumber,
  tailNumberError,
} from "@/lib/aircraft";
import { getAdminUser, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeAircraft } from "@/lib/serialize";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.aircraft.findMany({
    orderBy: [{ active: "desc" }, { tailNumber: "asc" }],
    include: AIRCRAFT_INCLUDE,
  });

  return NextResponse.json(rows.map(serializeAircraft));
}

/**
 * Add an airplane to the fleet (admins only, from Club settings).
 *
 * Everything in the app is keyed by aircraft, so a second airplane really is
 * just a row — nothing else has to change for the club to grow.
 */
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const tailNumber = normalizeTailNumber(String(body.tailNumber ?? ""));
  const model = String(body.model ?? "").trim();
  const problem = tailNumberError(tailNumber) ?? modelError(model);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Tail numbers are unique, and "we already fly that one" is a much better
  // message than a raw constraint violation.
  const existing = await prisma.aircraft.findUnique({ where: { tailNumber } });
  if (existing) {
    return NextResponse.json(
      { error: `${tailNumber} is already in the fleet.` },
      { status: 409 }
    );
  }

  const created = await prisma.aircraft.create({
    data: {
      tailNumber,
      model,
      year: numberOrNull(body.year, Math.round),
      hourlyRateCents: numberOrNull(body.hourlyRateCents, Math.round),
      fuelCapacityGal: numberOrNull(body.fuelCapacityGal),
      homeBase: optionalText(body.homeBase),
      notes: optionalText(body.notes),
      lastTach: numberOrNull(body.lastTach),
      lastHobbs: numberOrNull(body.lastHobbs),
    },
    include: AIRCRAFT_INCLUDE,
  });

  return NextResponse.json(serializeAircraft(created), { status: 201 });
}

/** Blank/absent → null; otherwise a finite number (optionally rounded). */
function numberOrNull(
  value: unknown,
  round?: (n: number) => number
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return round ? round(n) : n;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}
