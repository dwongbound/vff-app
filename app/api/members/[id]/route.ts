// Promote a member to club admin, hand the flag back, or set which club
// offices they hold.
//
// Admin-only, and re-checked against the database by getAdminUser() rather than
// trusted from the session token — a token minted before the flag was revoked
// is still cryptographically valid.
//
// Positions are a separate concern from isAdmin and can be sent together or
// alone. There is deliberately no "last Finance Officer" rule to match the
// last-admin one: admins can already do everything an officer can, so a club
// with no Finance Officer is inconvenienced, not locked out.
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { adminChangeError, MEMBER_SELECT } from "@/lib/members";
import { parsePositions } from "@/lib/positions";
import { prisma } from "@/lib/prisma";
import { serializeMember } from "@/lib/serialize";

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
  const changesAdmin = body && typeof body.isAdmin === "boolean";
  const changesPositions = body && "positions" in body;
  const changesMembership = body && typeof body.clubMember === "boolean";
  if (!body || (!changesAdmin && !changesPositions && !changesMembership)) {
    return NextResponse.json(
      { error: "Send isAdmin (true or false), positions and/or clubMember." },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: MEMBER_SELECT,
  });
  if (!target) {
    return NextResponse.json({ error: "No such member." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (changesAdmin) {
    const nextIsAdmin: boolean = body.isAdmin;
    // Counted inside the same request as the update so the "last admin" check
    // reflects the roster as it is right now.
    const totalAdmins = await prisma.user.count({ where: { isAdmin: true } });
    const problem = adminChangeError({
      target: { id: target.id, isAdmin: target.isAdmin },
      nextIsAdmin,
      totalAdmins,
    });
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
    data.isAdmin = nextIsAdmin;
  }

  if (changesPositions) {
    if (!Array.isArray(body.positions)) {
      return NextResponse.json(
        { error: "positions must be a list of offices." },
        { status: 400 }
      );
    }
    // Unknown offices are dropped rather than rejected: the client sends what
    // it rendered, and a stale tab shouldn't fail the whole save.
    data.positions = { set: parsePositions(body.positions) };
  }

  // "This CFI flies here too" (or stops doing so). Admin-only like the rest of
  // this route, and deliberately independent of the INSTRUCTOR office: a club
  // member who qualifies as a CFI and a visiting instructor who joins the club
  // arrive at the same place from opposite directions.
  //
  // No "last member" guard to match the last-admin one below — a club with no
  // flying members is odd but not locked out, since admins can always book.
  if (changesMembership) {
    if (target.isAdmin && body.clubMember === false) {
      return NextResponse.json(
        {
          error:
            "Admins run the club and book its airplane — remove admin first if this account only teaches here.",
        },
        { status: 409 }
      );
    }
    data.clubMember = body.clubMember;
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: MEMBER_SELECT,
  });

  return NextResponse.json(serializeMember(updated, admin.id));
}
