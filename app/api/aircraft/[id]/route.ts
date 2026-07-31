// Admin-only aircraft edits: rate, home base, fuel capacity, meter
// corrections, retiring an airplane.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeAircraft } from "@/lib/serialize";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.model === "string") data.model = body.model.trim();
  if (typeof body.homeBase === "string") data.homeBase = body.homeBase.trim() || null;
  if (typeof body.notes === "string") data.notes = body.notes.trim() || null;
  if (typeof body.active === "boolean") data.active = body.active;
  for (const field of ["hourlyRateCents", "year"] as const) {
    if (field in body) {
      data[field] = body[field] === null ? null : Math.round(Number(body[field]));
    }
  }
  for (const field of ["fuelCapacityGal", "lastTach", "lastHobbs"] as const) {
    if (field in body) {
      data[field] = body[field] === null ? null : Number(body[field]);
    }
  }

  const updated = await prisma.aircraft.update({
    where: { id },
    data,
    include: {
      squawks: {
        where: { status: "OPEN" },
        select: { id: true, title: true, severity: true, status: true },
      },
    },
  });

  return NextResponse.json(serializeAircraft(updated));
}
