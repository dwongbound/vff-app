// Create a club account. Email doubles as the username.
//
// Two things decide what you get:
//
//   • The FIRST account ever created becomes the club admin, and is the one
//     sign-up that needs no code — a fresh install has nobody who could have
//     issued one. See `signupCodeRequired` for why that's the only exception.
//   • Every account after it redeems a code off one of the club's two lists,
//     and the LIST decides the account: a member code makes a flying member, a
//     CFI code makes an instructor account. The applicant never picks — see
//     lib/signupCodes.ts.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  accountFromCodeKind,
  normalizeCode,
  redemptionError,
  signupCodeRequired,
  type SignupCodeKind,
} from "@/lib/signupCodes";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const phone = body.phone ? String(body.phone).trim() : null;

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Name, email and password are all required." },
      { status: 400 }
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Use at least 8 characters for your password." },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: email }] },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "There's already an account with that email." },
      { status: 409 }
    );
  }

  const memberCount = await prisma.user.count();

  // Resolve the code BEFORE creating anything, so a bad one costs nothing.
  let codeId: string | null = null;
  let kind: SignupCodeKind = "MEMBER";

  if (signupCodeRequired(memberCount)) {
    const code = normalizeCode(body.code);
    if (!code) {
      return NextResponse.json(
        { error: "A sign-up code is required. Ask the club for one." },
        { status: 400 }
      );
    }
    const row = await prisma.signupCode.findUnique({
      where: { code },
      select: { id: true, code: true, kind: true, active: true },
    });
    // Unrecognised and retired codes give the same 403 on purpose — see
    // `redemptionError`. 403 rather than 400: the request was well-formed, the
    // club just isn't letting this person in.
    const problem = redemptionError(
      row ? { code: row.code, kind: row.kind as SignupCodeKind, active: row.active } : null
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 403 });

    codeId = row!.id;
    kind = row!.kind as SignupCodeKind;
  }

  const shape = accountFromCodeKind(kind);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      username: email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      // The bootstrap account runs the club. Note this deliberately ignores
      // the code's kind: there is no code at that point to have a kind.
      isAdmin: memberCount === 0,
      positions: shape.positions,
      clubMember: shape.clubMember,
    },
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      positions: true,
      clubMember: true,
    },
  });

  // Count the redemption after the account exists, so a failed create can't
  // inflate the tally. Best-effort: the person is already in, and losing a
  // usage count is not worth failing their sign-up over.
  if (codeId) {
    await prisma.signupCode
      .update({
        where: { id: codeId },
        data: { uses: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  return NextResponse.json(user, { status: 201 });
}
