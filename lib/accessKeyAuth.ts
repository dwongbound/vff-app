// The db half of lib/accessKeys.ts: who, if anyone, a request's access key
// belongs to. `getKeyUser` is for GET /api/agent and POST /api/mcp, which take
// a key and nothing else. `getActingUser` is for the five routes a key that
// was made "can book and file" may also write through — book, change or
// cancel your own booking, file or correct your own flight — and every other
// route still takes only a session.
import { prisma } from "./prisma";
import { getSessionUser } from "./auth";
import { bearerKey, hashAccessKey, shouldTouchLastUsed } from "./accessKeys";

/**
 * The member behind `Authorization: Bearer vff_…`, read fresh — positions and
 * membership included, so a key can never see more than its member could
 * today — or null for a missing, unknown or revoked key.
 */
export async function getKeyUser(req: Request) {
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return null;
  const row = await prisma.accessKey.findUnique({
    where: { keyHash: hashAccessKey(key) },
    select: {
      id: true,
      canWrite: true,
      revokedAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isAdmin: true,
          positions: true,
          clubMember: true,
          totalTimeHours: true,
        },
      },
    },
  });
  if (!row || row.revokedAt) return null;
  if (shouldTouchLastUsed(row.lastUsedAt)) {
    await prisma.accessKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { ...row.user, canWrite: row.canWrite };
}

export type KeyUser = NonNullable<Awaited<ReturnType<typeof getKeyUser>>>;

/**
 * Who is doing this write: the signed-in member, or else the member behind a
 * key that was made "can book and file". Through a key the member acts as a
 * PLAIN member — no admin, no offices — so a key on an admin's account still
 * can only book, cancel its own bookings and file its own flights, which is
 * the whole promise the profile card makes. Membership (`clubMember`) is kept,
 * since that is what lets anyone book at all.
 */
export async function getActingUser(req: Request) {
  const session = await getSessionUser();
  if (session) return session;
  const keyUser = await getKeyUser(req);
  if (!keyUser?.canWrite) return null;
  return {
    id: keyUser.id,
    name: keyUser.name,
    email: keyUser.email,
    isAdmin: false,
    positions: [] as typeof keyUser.positions,
    clubMember: keyUser.clubMember,
  };
}
