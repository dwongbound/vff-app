// Retire, revive, relabel or delete one sign-up code. Admins only.
//
// Retiring (PATCH active:false) is the normal way to close a code, and DELETE
// refuses once a code has let anybody in: "which code was this member given"
// is the only audit trail the club has for how somebody got an account, and
// deleting the row erases it. An unused code is just a typo and deletes fine.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeSignupCode } from "@/lib/serialize";
import { parseSignupCodeKind } from "@/lib/signupCodes";

const SELECT = {
  id: true,
  code: true,
  kind: true,
  label: true,
  active: true,
  uses: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

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

  const existing = await prisma.signupCode.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such code." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if ("label" in body) data.label = body.label ? String(body.label).trim() || null : null;
  // The code STRING is deliberately not editable. Someone is holding a slip of
  // paper with it on; editing it in place would silently invalidate that
  // without anything appearing to have been retired. Add a new one instead.
  if ("kind" in body) data.kind = parseSignupCodeKind(body.kind);

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Send active, label and/or kind." },
      { status: 400 }
    );
  }

  const updated = await prisma.signupCode.update({
    where: { id },
    data,
    select: SELECT,
  });

  return NextResponse.json(serializeSignupCode(updated));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.signupCode.findUnique({
    where: { id },
    select: { id: true, uses: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such code." }, { status: 404 });
  }
  if (existing.uses > 0) {
    return NextResponse.json(
      {
        error:
          "That code has already created accounts — retire it instead, so the record of how they joined survives.",
      },
      { status: 409 }
    );
  }

  await prisma.signupCode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
