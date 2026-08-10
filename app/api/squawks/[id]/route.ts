// Triage a squawk.
//
// Everything on this route needs `squawk:manage` — the Safety Officer, or any
// admin, since admins hold every capability. That is a deliberate tightening of
// what came before, where the reporter could keep editing their own squawk:
// status is now the whole judgement (moving one to REVIEWED_GROUNDED takes the
// airplane off the line), and a squawk's wording is what the next pilot reads
// to decide whether to fly. Both belong to the officer.
//
// Members are not shut out of the process — they FILE squawks from the
// checkouts (POST /api/squawks), which always lands at NEW.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeSquawk } from "@/lib/serialize";
import { isSquawkStatus } from "@/lib/squawks";

const INCLUDE = {
  reportedBy: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!can(user, "squawk:manage")) {
    return NextResponse.json(
      { error: "Only the Safety Officer or a club admin can change a squawk." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await prisma.squawk.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "That squawk is gone." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const data: Record<string, unknown> = {};

  if ("status" in body) {
    if (!isSquawkStatus(body.status)) {
      return NextResponse.json({ error: "Unknown squawk status." }, { status: 400 });
    }
    data.status = body.status;

    // The sign-off trail follows CLOSED, and is cleared when a squawk comes
    // back onto the working list — otherwise a reopened item still shows who
    // "fixed" it, which is exactly the sentence a reader would trust and
    // shouldn't.
    if (body.status === "CLOSED") {
      data.resolvedById = user.id;
      data.resolvedAt = new Date();
      data.resolution = body.resolution ? String(body.resolution).trim() : null;
    } else if (existing.status === "CLOSED") {
      data.resolvedById = null;
      data.resolvedAt = null;
      data.resolution = null;
    }
  }

  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim();
  }
  if ("description" in body) {
    data.description = body.description ? String(body.description).trim() : null;
  }

  const updated = await prisma.squawk.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeSquawk(updated));
}
