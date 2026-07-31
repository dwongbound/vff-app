// The club's airplanes, with their open squawks folded in so the client can
// tell at a glance whether anything is grounded.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeAircraft } from "@/lib/serialize";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.aircraft.findMany({
    orderBy: [{ active: "desc" }, { tailNumber: "asc" }],
    include: {
      squawks: {
        where: { status: "OPEN" },
        select: { id: true, title: true, severity: true, status: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return NextResponse.json(rows.map(serializeAircraft));
}
