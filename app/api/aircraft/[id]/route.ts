// Aircraft edits: tail number, rate, home base, fuel capacity, meter
// corrections, retiring an airplane.
//
// Admin-only, with one exception: the hourly rate is the club's PRICE, not a
// fact about the airframe, so the Finance Officer can set it (and only it)
// without being made an admin. Everything else here still needs the flag.
import { NextResponse } from "next/server";
import {
  AIRCRAFT_INCLUDE,
  modelError,
  normalizeTailNumber,
  tailNumberError,
} from "@/lib/aircraft";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeAircraft } from "@/lib/serialize";
import { profileFor } from "@/lib/weightBalance";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const isAdmin = user.isAdmin;
  const canPriceIt = can(user, "finance:manage");
  if (!isAdmin && !canPriceIt) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const data: Record<string, unknown> = {};

  // The rate first, since it's the one field a non-admin officer may set.
  if ("hourlyRateCents" in body) {
    data.hourlyRateCents =
      body.hourlyRateCents === null ? null : Math.round(Number(body.hourlyRateCents));
  }

  // Everything below is admin territory. An officer who sent more than the
  // rate is told so rather than having the rest quietly dropped.
  if (!isAdmin) {
    const otherFields = Object.keys(body).filter((k) => k !== "hourlyRateCents");
    if (otherFields.length > 0) {
      return NextResponse.json(
        { error: "The Finance Officer can change the hourly rate, but not the airplane." },
        { status: 403 }
      );
    }
    const priced = await prisma.aircraft.update({
      where: { id },
      data,
      include: AIRCRAFT_INCLUDE,
    });
    return NextResponse.json(serializeAircraft(priced));
  }

  // Fix a mis-typed registration, or re-register the airplane. History
  // (flights, squawks, bookings) hangs off the row's id, not its tail number,
  // so renaming keeps every past entry attached.
  if (typeof body.tailNumber === "string") {
    const tailNumber = normalizeTailNumber(body.tailNumber);
    const problem = tailNumberError(tailNumber);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const clash = await prisma.aircraft.findUnique({ where: { tailNumber } });
    if (clash && clash.id !== id) {
      return NextResponse.json(
        { error: `${tailNumber} is already in the fleet.` },
        { status: 409 }
      );
    }
    data.tailNumber = tailNumber;
  }

  if (typeof body.model === "string") {
    const problem = modelError(body.model);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    data.model = body.model.trim();
  }
  if (typeof body.homeBase === "string") data.homeBase = body.homeBase.trim() || null;
  if (typeof body.notes === "string") data.notes = body.notes.trim() || null;
  if (typeof body.active === "boolean") data.active = body.active;
  if ("year" in body) {
    data.year = body.year === null ? null : Math.round(Number(body.year));
  }
  for (const field of ["fuelCapacityGal", "lastTach", "lastHobbs"] as const) {
    if (field in body) {
      data[field] = body[field] === null ? null : Number(body[field]);
    }
  }

  // Weight & balance. The profile id has to name a profile the app actually
  // ships: a typo here would otherwise be stored happily and then read as
  // "this airplane has no W&B data", which looks like a bug in the tool rather
  // than a bad value in the row.
  if ("wbProfile" in body) {
    const value = body.wbProfile === null ? null : String(body.wbProfile).trim() || null;
    if (value !== null && !profileFor(value)) {
      return NextResponse.json(
        { error: `No weight & balance profile called "${value}".` },
        { status: 400 }
      );
    }
    data.wbProfile = value;
  }
  for (const field of ["emptyWeightLbs", "emptyMomentLbIn"] as const) {
    if (field in body) {
      const value = body[field] === null || body[field] === "" ? null : Number(body[field]);
      if (value !== null && (!Number.isFinite(value) || value <= 0)) {
        return NextResponse.json(
          { error: "Empty weight and moment must be positive numbers." },
          { status: 400 }
        );
      }
      data[field] = value;
    }
  }
  if ("weighedOn" in body) {
    if (body.weighedOn === null || body.weighedOn === "") {
      data.weighedOn = null;
    } else {
      const when = new Date(String(body.weighedOn));
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json(
          { error: "That weighing date isn't a date." },
          { status: 400 }
        );
      }
      data.weighedOn = when;
    }
  }

  const updated = await prisma.aircraft.update({
    where: { id },
    data,
    include: AIRCRAFT_INCLUDE,
  });

  return NextResponse.json(serializeAircraft(updated));
}
