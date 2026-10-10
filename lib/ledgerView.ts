// How the Finances page groups and narrows ledger lines — pure, so the page
// and its export window agree, and so it can be unit-tested.
//
// Lives apart from lib/finance.ts because it works on the WIRE shapes
// (ApiCharge, ApiStatement) the page holds, not on database rows.
import {
  currentPeriod,
  shiftPeriod,
  totals,
  type ChargeKind,
  type Period,
} from "./finance";
import type { ApiCharge, ApiStatement, ApiUserSummary } from "./types";

/**
 * Stands in for the member on a club line (no member) wherever a name is
 * drawn — the by-person card, the Member column, the export. Never sent to
 * the server.
 */
export const CLUB_ACCOUNT: ApiUserSummary = { id: "__club", name: "Club", email: null };

/** Whose line this is, for display: a member, or the club's own money. */
export function ownerOf(charge: ApiCharge): ApiUserSummary {
  return charge.member ?? CLUB_ACCOUNT;
}

/**
 * Lines → one statement per member, for the export and the by-person view.
 * The club's own lines are gathered under `CLUB_ACCOUNT` and put FIRST: they
 * are the one block that isn't somebody, so they shouldn't sort in among names.
 */
export function statementsFor(charges: ApiCharge[], period: Period): ApiStatement[] {
  const byOwner = new Map<string, ApiCharge[]>();
  for (const charge of charges) {
    const key = ownerOf(charge).id;
    const list = byOwner.get(key) ?? [];
    list.push(charge);
    byOwner.set(key, list);
  }
  const statements = [...byOwner.values()].map((lines) => ({
    member: ownerOf(lines[0]),
    period,
    charges: lines,
    ...totals(lines),
  }));
  return statements.sort((a, b) => {
    if (a.member === CLUB_ACCOUNT) return -1;
    if (b.member === CLUB_ACCOUNT) return 1;
    return a.member.name.localeCompare(b.member.name);
  });
}

/** The export window's time ranges. */
export type ExportRange = "all" | "this-month" | "last-3" | "last-12" | "custom";

/**
 * The months an export covers, newest month last: `{ from, to }`, or null for
 * ALL TIME (the window then reads every month the ledger has).
 *
 * "Last 3 months" counts THIS month as one of the three — it's what a member
 * means by "the last few statements". A custom range given backwards is
 * swapped rather than refused: nobody means "from October to August" as
 * anything but August to October.
 */
export function exportPeriods(
  range: ExportRange,
  custom: { from: Period; to: Period } | null,
  now: Date = new Date()
): { from: Period; to: Period } | null {
  const thisMonth = currentPeriod(now);
  switch (range) {
    case "all":
      return null;
    case "this-month":
      return { from: thisMonth, to: thisMonth };
    case "last-3":
      return { from: shiftPeriod(thisMonth, -2), to: thisMonth };
    case "last-12":
      return { from: shiftPeriod(thisMonth, -11), to: thisMonth };
    case "custom": {
      if (!custom) return null;
      if (custom.from > custom.to) return { from: custom.to, to: custom.from };
      return custom;
    }
  }
}

/** How many months `from`..`to` spans, inclusive. */
export function monthsSpanned(from: Period, to: Period): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Narrow lines to the kinds and the people asked for. `kinds` / `people` of
 * null mean "all"; in `people`, `CLUB_ACCOUNT.id` stands for the club's own
 * lines (no member).
 */
export function selectLines(
  lines: ApiCharge[],
  kinds: ReadonlySet<ChargeKind> | null,
  people: ReadonlySet<string> | null
): ApiCharge[] {
  return lines.filter((line) => {
    if (kinds && !kinds.has(line.kind)) return false;
    if (people && !people.has(ownerOf(line).id)) return false;
    return true;
  });
}
