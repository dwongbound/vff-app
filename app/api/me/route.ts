// The signed-in member's own profile: read it, and edit the parts they own.
// A 401 here is how AuthGate detects a "ghost" session (valid JWT, deleted
// user) and signs it out.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ApiMe } from "@/lib/types";

function toApi(u: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
  certificate: string | null;
  totalTimeHours: number | null;
  medicalExpiresOn: Date | null;
  flightReviewOn: Date | null;
}): ApiMe {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isAdmin: u.isAdmin,
    certificate: u.certificate,
    totalTimeHours: u.totalTimeHours,
    medicalExpiresOn: u.medicalExpiresOn?.toISOString() ?? null,
    flightReviewOn: u.flightReviewOn?.toISOString() ?? null,
  };
}

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isAdmin: true,
  certificate: true,
  totalTimeHours: true,
  medicalExpiresOn: true,
  flightReviewOn: true,
} as const;

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: SELECT,
  });
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  return NextResponse.json(toApi(me));
}

export async function PATCH(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // isAdmin is deliberately NOT editable here — promoting a member is an admin
  // action, not a self-service one.
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if ("phone" in body) data.phone = body.phone ? String(body.phone).trim() : null;
  if ("certificate" in body) {
    data.certificate = body.certificate ? String(body.certificate).trim() : null;
  }
  // Total time is self-declared: the club can't see a member's logbook, and it
  // decides which column of the operating rules applies to them.
  if ("totalTimeHours" in body) {
    const hours = Number(body.totalTimeHours);
    if (body.totalTimeHours === null || body.totalTimeHours === "") {
      data.totalTimeHours = null;
    } else if (!Number.isFinite(hours) || hours < 0) {
      return NextResponse.json({ error: "Total time has to be a number." }, { status: 400 });
    } else {
      data.totalTimeHours = hours;
    }
  }
  // Date-only fields arrive as "YYYY-MM-DD" from <input type="date">.
  for (const field of ["medicalExpiresOn", "flightReviewOn"] as const) {
    if (!(field in body)) continue;
    if (!body[field]) {
      data[field] = null;
      continue;
    }
    const parsed = new Date(String(body[field]));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: `Invalid date for ${field}.` }, { status: 400 });
    }
    data[field] = parsed;
  }

  const me = await prisma.user.update({
    where: { id: session.id },
    data,
    select: SELECT,
  });

  return NextResponse.json(toApi(me));
}
