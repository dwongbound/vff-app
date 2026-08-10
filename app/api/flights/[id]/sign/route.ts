// The instructor's signature on one flight-log entry.
//
//   POST   — sign it.
//   DELETE — withdraw the signature.
//
// A route of its own rather than another field on PATCH /api/flights/[id],
// because it is a different act by a different person under different rules: a
// pilot corrects their own entry, an instructor endorses it, and the one thing
// the club needs from this record is that those two can't be confused. Keeping
// them apart is also what lets PATCH stamp `editedAt` unconditionally without
// a signature counting as an edit to itself.
//
// The rules are in lib/flightSignature.ts, including the one exception to this
// app's "admins can do anything" rule: an admin may NOT sign for a CFI.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeFlight } from "@/lib/serialize";
import { signatureError, unsignError } from "@/lib/flightSignature";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  pilot: { select: { id: true, name: true, email: true } },
  instructor: { select: { id: true, name: true, email: true } },
  signedBy: { select: { id: true, name: true, email: true } },
  photos: true,
  squawks: {
    include: {
      reportedBy: { select: { id: true, name: true, email: true } },
      resolvedBy: { select: { id: true, name: true, email: true } },
      photos: true,
    },
  },
} as const;

const SIGNATURE_SELECT = {
  id: true,
  instructorId: true,
  signedAt: true,
  editedAt: true,
} as const;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.flight.findUnique({
    where: { id },
    select: SIGNATURE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "That flight is gone." }, { status: 404 });
  }

  const problem = signatureError(existing, user);
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });

  const signed = await prisma.flight.update({
    where: { id },
    // Both columns together: `signedById` is who actually put their name to it,
    // which is worth recording separately from who was expected to even while
    // the rules make them the same person.
    data: { signedAt: new Date(), signedById: user.id },
    include: INCLUDE,
  });

  return NextResponse.json(serializeFlight(signed, user.id));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.flight.findUnique({
    where: { id },
    select: SIGNATURE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "That flight is gone." }, { status: 404 });
  }

  const problem = unsignError(existing, user);
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });

  // Cleared rather than kept with a "withdrawn" flag: the entry goes back to
  // awaiting a signature, which is the true state, and the instructor can sign
  // it again once whatever prompted the withdrawal is fixed.
  const unsigned = await prisma.flight.update({
    where: { id },
    data: { signedAt: null, signedById: null },
    include: INCLUDE,
  });

  return NextResponse.json(serializeFlight(unsigned, user.id));
}
