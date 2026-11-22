// GET /api/reports/landings — the club's landings by airport, month by month,
// for claiming landing fees back. Shaped by lib/landingReport.ts.
//
// Club-wide (every airplane) because a reimbursement claim is the club's, not
// one airframe's. Open to any signed-in member, like the flight log it is
// built from: it names airports and counts, never pilots or money owed.
// `?months=N` is how far back (default 12, at most 120), counted in whole
// months including this one. Only FILED flights count — an airplane still out
// hasn't finished landing.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentPeriod, periodStart, shiftPeriod } from "@/lib/finance";
import { landingReport } from "@/lib/landingReport";

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 120;

/** `?months=` as a whole number in range, or the default for anything else. */
function monthsFrom(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MONTHS;
  return Math.min(parsed, MAX_MONTHS);
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const months = monthsFrom(new URL(req.url).searchParams.get("months"));
  const since = periodStart(shiftPeriod(currentPeriod(), -(months - 1)));

  const rows = await prisma.flight.findMany({
    where: { filedAt: { not: null }, flownOn: { gte: since } },
    select: {
      flownOn: true,
      landings: true,
      landingAirports: true,
      arrival: true,
      landingFeeCents: true,
      aircraft: { select: { homeBase: true } },
    },
  });

  const report = landingReport(
    rows.map((row) => ({
      flownOn: row.flownOn,
      landings: row.landings,
      landingAirports: row.landingAirports,
      arrival: row.arrival,
      homeBase: row.aircraft.homeBase,
      landingFeeCents: row.landingFeeCents,
    }))
  );
  return NextResponse.json({ months: report });
}
