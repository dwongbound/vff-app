// Preflight checklist runs.
//
// GET  /api/preflight?aircraftId=&mine=1&limit=  — most recent runs first.
// POST /api/preflight  { aircraftId, answers, fuelOnBoardGal, oilQuarts,
//                        notes, complete }
//      `complete: true` stamps completedAt, which is what makes a run count as
//      a signed-off preflight. A partial run can be posted too (you got
//      interrupted at the fuel truck) and finished later.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializePreflight } from "@/lib/serialize";
import { CHECKLIST_VERSION, isComplete, parseAnswers } from "@/lib/checklist";

const INCLUDE = {
  aircraft: { select: { id: true, tailNumber: true } },
  user: { select: { id: true, name: true, email: true } },
  photos: true,
} as const;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const aircraftId = url.searchParams.get("aircraftId");
  const mine = url.searchParams.get("mine") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);

  const rows = await prisma.preflightCheck.findMany({
    where: {
      ...(aircraftId ? { aircraftId } : {}),
      ...(mine ? { userId: user.id } : {}),
    },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(rows.map(serializePreflight));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const aircraftId = String(body.aircraftId ?? "");
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { id: true },
  });
  if (!aircraft) {
    return NextResponse.json({ error: "Unknown aircraft." }, { status: 400 });
  }

  // Drop anything that isn't a live checklist id — a stale client (or a typo)
  // shouldn't be able to write junk keys into the answers column.
  const answers = parseAnswers(body.answers);
  const complete = body.complete === true;

  if (complete && !isComplete(answers)) {
    return NextResponse.json(
      { error: "Every item has to be checked before you can sign off the preflight." },
      { status: 400 }
    );
  }

  const created = await prisma.preflightCheck.create({
    data: {
      aircraftId,
      userId: user.id,
      checklistVersion: CHECKLIST_VERSION,
      answers,
      fuelOnBoardGal:
        body.fuelOnBoardGal == null ? null : Number(body.fuelOnBoardGal),
      oilQuarts: body.oilQuarts == null ? null : Number(body.oilQuarts),
      notes: body.notes ? String(body.notes).trim() : null,
      completedAt: complete ? new Date() : null,
    },
    include: INCLUDE,
  });

  return NextResponse.json(serializePreflight(created), { status: 201 });
}
