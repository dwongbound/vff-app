// GET /api/club — the whole club for a club officer's tools: who flew the
// airplane in the last 90 days, every pilot's certificate, total time, hours
// and landings, the schedule and the airplanes (lib/clubSnapshot.ts).
//
// Authenticated by `Authorization: Bearer vff_…` ONLY, like /api/agent, and
// only for a key whose owner is an ADMIN: unlike /api/agent this reads other
// members' records, so a plain member's key gets 403.
import { NextResponse } from "next/server";
import { getKeyUser } from "@/lib/accessKeyAuth";
import { clubSnapshot } from "@/lib/clubSnapshot";

export async function GET(req: Request) {
  const user = await getKeyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Send a personal access key: Authorization: Bearer vff_… (make one on your profile)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="vff"' } }
    );
  }
  if (!user.isAdmin) {
    return NextResponse.json(
      { error: "Only a club admin's key can read the whole club." },
      { status: 403 }
    );
  }
  return NextResponse.json(await clubSnapshot(user), {
    headers: { "Cache-Control": "no-store" },
  });
}
