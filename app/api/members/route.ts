// The club roster. Every signed-in member can read it — this is a flying club,
// and members swap bookings and split flights with each other, so knowing who
// else is in it (and how to reach them) is the point.
//
// Only contact details and the admin flag cross the wire; pilot paperwork stays
// on /api/me. Changing a role is PATCH /api/members/[id], admins only.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { MEMBER_SELECT } from "@/lib/members";
import { prisma } from "@/lib/prisma";
import { serializeMember } from "@/lib/serialize";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.user.findMany({
    // Admins first, then alphabetically — the roster reads as "who runs this
    // club, and who's in it".
    orderBy: [{ isAdmin: "desc" }, { name: "asc" }],
    select: MEMBER_SELECT,
  });

  return NextResponse.json(rows.map((row) => serializeMember(row, user.id)));
}
