// The signed-in member's own personal access keys (Profile → Personal access
// keys). GET lists them, POST `{ name, canWrite?, canReadClub? }` makes one and
// returns it ONCE. `canReadClub` (the whole club's flight log and pilots) is
// for admins only. Session only: a key can't make more keys. `canWrite` is fixed for the
// key's life — to change what an assistant may do, make a new key and revoke
// the old one, so a key never quietly gains a power after it was handed out.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_ACCESS_KEYS,
  generateAccessKey,
  hashAccessKey,
  parseKeyName,
} from "@/lib/accessKeys";
import { ACCESS_KEY_SELECT, serializeAccessKey } from "@/lib/accessKeyView";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rows = await prisma.accessKey.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: ACCESS_KEY_SELECT,
  });
  return NextResponse.json(rows.map(serializeAccessKey));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const name = parseKeyName(body?.name);
  if ("error" in name) return NextResponse.json({ error: name.error }, { status: 400 });

  // Only an explicit true asks for club data, and only an admin may have it.
  const canReadClub = body?.canReadClub === true;
  if (canReadClub && !user.isAdmin) {
    return NextResponse.json(
      { error: "Only an admin can make a key that reads club data." },
      { status: 403 }
    );
  }

  const live = await prisma.accessKey.count({ where: { userId: user.id, revokedAt: null } });
  if (live >= MAX_ACCESS_KEYS) {
    return NextResponse.json(
      { error: `You already have ${MAX_ACCESS_KEYS} keys. Revoke one you don't use first.` },
      { status: 409 }
    );
  }

  const key = generateAccessKey();
  const row = await prisma.accessKey.create({
    data: {
      userId: user.id,
      name: name.value,
      keyHash: hashAccessKey(key),
      // Only an explicit true: anything else is the read-only default.
      canWrite: body?.canWrite === true,
      canReadClub,
    },
    select: ACCESS_KEY_SELECT,
  });
  // The only time the key itself ever leaves the server.
  return NextResponse.json(
    { ...serializeAccessKey(row), key },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
