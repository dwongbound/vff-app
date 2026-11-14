// GET /api/agent/club — the club-wide read for a club officer's tools: every
// pilot's ratings, total time and landings in the last 90 days, and the next
// 30 days of bookings (lib/agentClub.ts). Nothing flight-by-flight.
//
// Takes `Authorization: Bearer vff_…` ONLY, and only a key made with "club
// data" by a member who is still an admin. Any other valid key gets 403.
import { NextResponse } from "next/server";
import { getKeyUser } from "@/lib/accessKeyAuth";
import { clubSnapshot } from "@/lib/agentClub";

export async function GET(req: Request) {
  const user = await getKeyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Send a personal access key: Authorization: Bearer vff_… (make one on your profile)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="vff"' } }
    );
  }
  if (!user.canReadClub) {
    return NextResponse.json(
      { error: "This key can't read club data. An admin makes one with \"club data\" ticked on their profile." },
      { status: 403 }
    );
  }
  // Every member's ratings: never cached by anything in between.
  return NextResponse.json(await clubSnapshot(user), { headers: { "Cache-Control": "no-store" } });
}
