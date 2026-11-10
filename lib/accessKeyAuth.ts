// The db half of lib/accessKeys.ts: who, if anyone, a request's access key
// belongs to. Called by GET /api/agent and POST /api/mcp, and nothing else —
// every other route still takes only a signed-in session.
import { prisma } from "./prisma";
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
  return row.user;
}

export type KeyUser = NonNullable<Awaited<ReturnType<typeof getKeyUser>>>;
