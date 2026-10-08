// The db half of a retried checkout sign-off (see lib/idempotency.ts).
//
// In lib/ rather than beside the routes because BOTH routes that can sign a run
// off need it — POST for a card whose first autosave never landed, PATCH for
// the usual case — and a `route.ts` may only export Next's own handlers.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeCheckout } from "@/lib/serialize";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

/**
 * The run a retried sign-off already filed, as the response to send — or null
 * when this key is new. Another member's key is a 409, never their row: keys
 * are random, so a collision is a client bug, and answering it with somebody
 * else's walkaround would be a leak.
 */
export async function alreadySignedOff(requestId: string, userId: string) {
  const row = await prisma.checkout.findUnique({
    where: { clientRequestId: requestId },
    include: INCLUDE,
  });
  if (!row) return null;
  if (row.userId !== userId) {
    return NextResponse.json(
      { error: "That request id belongs to another checkout." },
      { status: 409 }
    );
  }
  return NextResponse.json(serializeCheckout(row), { status: 200 });
}
