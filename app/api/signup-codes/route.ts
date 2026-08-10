// The club's sign-up code lists — read them, add to them. Admins only, in both
// directions: these codes ARE the club's front door, and anyone who can read
// one can hand it to a stranger.
//
// Redeeming a code is app/api/signup, which is (necessarily) unauthenticated
// and never returns anything about the code it was given.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeSignupCode } from "@/lib/serialize";
import {
  normalizeCode,
  parseSignupCodeKind,
  signupCodeError,
} from "@/lib/signupCodes";

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

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const rows = await prisma.signupCode.findMany({
    // Live codes first, then newest — an admin opens this to read out a
    // current code far more often than to audit a retired one.
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: SELECT,
  });

  return NextResponse.json(rows.map(serializeSignupCode));
}

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const problem = signupCodeError(body.code);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const code = normalizeCode(body.code);
  const kind = parseSignupCodeKind(body.kind);
  const label = body.label ? String(body.label).trim() || null : null;

  // Checked rather than caught: the club needs to be told "that code is
  // already on a list", and which list, since re-adding an existing code with
  // the other kind is the mistake this actually catches.
  const clash = await prisma.signupCode.findUnique({
    where: { code },
    select: { kind: true },
  });
  if (clash) {
    return NextResponse.json(
      { error: `${code} is already on the ${clash.kind.toLowerCase()} list.` },
      { status: 409 }
    );
  }

  const created = await prisma.signupCode.create({
    data: { code, kind, label, createdById: admin.id },
    select: SELECT,
  });

  return NextResponse.json(serializeSignupCode(created), { status: 201 });
}
