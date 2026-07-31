// Create a club member account. Email doubles as the username.
//
// The FIRST account ever created becomes the club admin — someone has to be
// able to resolve squawks and manage the airplane, and a fresh install has
// nobody. Every account after that is a plain member until an admin promotes
// them.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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

  const user = await prisma.user.create({
    data: {
      name,
      email,
      username: email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      isAdmin: memberCount === 0,
    },
    select: { id: true, name: true, email: true, isAdmin: true },
  });

  return NextResponse.json(user, { status: 201 });
}
