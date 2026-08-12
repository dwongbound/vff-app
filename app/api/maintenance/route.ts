// The airplane's maintenance sheet — add a row.
//
// There is deliberately NO GET here. What the airplane is due for is a fact
// about the airplane, so it rides on `GET /api/aircraft` alongside its open
// squawks (see lib/aircraft.ts `AIRCRAFT_INCLUDE`): every page already holds
// the fleet through AircraftProvider, and a second endpoint returning the same
// rows would be a second answer to "is anything overdue" — one of which would
// be stale on any screen that hadn't refetched it.
//
// Writes need `maintenance:manage` — the Maintenance Officer, or an admin.
// Reading is open to every member on purpose: "the annual runs out next week"
// is the first thing anyone walking out to the airplane should know.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { maintenanceFieldsFrom } from "@/lib/maintenance";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeMaintenanceItem } from "@/lib/serialize";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!can(user, "maintenance:manage")) {
    return NextResponse.json(
      { error: "Only the Maintenance Officer (or an admin) keeps this list." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraft = await prisma.aircraft.findUnique({
    where: { id: String(body.aircraftId ?? "") },
    select: { id: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  const fields = maintenanceFieldsFrom(body);
  if ("error" in fields) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }

  const created = await prisma.maintenanceItem.create({
    // `label` is restated rather than left to the spread: the helper hands back
    // a loose bag of columns, and Prisma's create type needs to see the one
    // field that isn't optional. (It's already been validated in there.)
    data: {
      aircraftId: aircraft.id,
      ...fields.data,
      label: String(fields.data.label),
    },
  });

  return NextResponse.json(serializeMaintenanceItem(created), { status: 201 });
}
