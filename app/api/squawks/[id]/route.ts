// Sign off (or reopen) a squawk.
//
// Resolving is admin-only: clearing a grounding item is the decision that puts
// the airplane back on the line. The person who raised it may still edit the
// wording or severity of their own open squawk.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeSquawk } from "@/lib/serialize";
import { SEVERITY_LABELS, type Severity } from "@/lib/constants";

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

  const { id } = await params;
  const existing = await prisma.squawk.findUnique({
    where: { id },
    select: { id: true, reportedById: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "That squawk is gone." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const data: Record<string, unknown> = {};

  // Status changes (resolve / reopen) are the admin half.
  if (body.status === "RESOLVED" || body.status === "OPEN") {
    if (!user.isAdmin) {
      return NextResponse.json(
        { error: "Only a club admin can sign off a squawk." },
        { status: 403 }
      );
    }
    if (body.status === "RESOLVED") {
      data.status = "RESOLVED";
      data.resolvedById = user.id;
      data.resolvedAt = new Date();
      data.resolution = body.resolution ? String(body.resolution).trim() : null;
    } else {
      data.status = "OPEN";
      data.resolvedById = null;
      data.resolvedAt = null;
      data.resolution = null;
    }
  }

  // Wording/severity edits: the reporter (while it's open) or any admin.
  const canEdit =
    user.isAdmin || (existing.reportedById === user.id && existing.status === "OPEN");
  if (("title" in body || "description" in body || "severity" in body) && !canEdit) {
    return NextResponse.json({ error: "That's not your squawk." }, { status: 403 });
  }
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("description" in body) {
    data.description = body.description ? String(body.description).trim() : null;
  }
  if (typeof body.severity === "string" && body.severity in SEVERITY_LABELS) {
    data.severity = body.severity as Severity;
  }

  const updated = await prisma.squawk.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json(serializeSquawk(updated));
}
