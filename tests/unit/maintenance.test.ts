import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  DUE_SOON_HOURS,
  byUrgency,
  daysRemaining,
  dueAtTach,
  dueOn,
  formatRemaining,
  grounding,
  hoursRemaining,
  maintenanceDue,
  maintenanceItemError,
  nextDue,
  type MaintenanceFacts,
} from "@/lib/maintenance";

// The four rows of N8318B's own maintenance sheet that carry numbers, as the
// club had them on 8 Aug 2026. Every expectation below is checked against what
// that spreadsheet printed in its own derived columns — which is the point of
// transcribing a real one: the arithmetic has a right answer somebody already
// worked out by hand.
const OIL: MaintenanceFacts = {
  intervalHours: 50,
  intervalMonths: 4,
  lastDoneTach: 1473.2,
  lastDoneOn: new Date(2026, 6, 8), // 8 Jul 2026
  requiredByReg: false,
};
const ANNUAL: MaintenanceFacts = {
  intervalHours: null,
  intervalMonths: 12,
  lastDoneTach: 1473.2,
  lastDoneOn: new Date(2026, 6, 8),
  requiredByReg: true,
};
const TRANSPONDER: MaintenanceFacts = {
  intervalHours: null,
  intervalMonths: 24,
  lastDoneTach: 675.1,
  lastDoneOn: new Date(2026, 6, 8),
  requiredByReg: true,
};

/** The day the sheet was read, and the tach it showed. */
const SHEET_DAY = new Date(2026, 7, 10); // 10 Aug 2026
const SHEET_TACH = 1503.9;

describe("when an item comes due", () => {
  it("adds the hour interval to the tach it was last done at", () => {
    // The sheet's "Tach Due" column: 1473.2 + 50.
    expect(dueAtTach(OIL)).toBe(1523.2);
  });

  it("has no tach due when the item has no hour limit", () => {
    expect(dueAtTach(ANNUAL)).toBeNull();
  });

  it("counts calendar months to the END of the month, the way 14 CFR does", () => {
    // Done 8 Jul 2026 + 12 months is 31 Jul 2027 — not 8 Jul 2027. The sheet
    // agrees, and so does the flight-review rule this shares a helper with.
    const annual = dueOn(ANNUAL)!;
    expect(annual.getFullYear()).toBe(2027);
    expect(annual.getMonth()).toBe(6);
    expect(annual.getDate()).toBe(31);

    // 4 months from 8 Jul is the end of November, not 8 Nov.
    const oil = dueOn(OIL)!;
    expect(oil.getMonth()).toBe(10);
    expect(oil.getDate()).toBe(30);

    // And 24 months lands two years out, same end-of-month rule.
    expect(dueOn(TRANSPONDER)!.getFullYear()).toBe(2028);
    expect(dueOn(TRANSPONDER)!.getDate()).toBe(31);
  });

  it("has no due date when the item has never been done", () => {
    expect(dueOn({ ...OIL, lastDoneOn: null })).toBeNull();
  });
});

describe("what's left", () => {
  it("reports the hours the sheet reported", () => {
    expect(hoursRemaining(OIL, SHEET_TACH)).toBe(19.3);
  });

  it("reports the days the sheet reported", () => {
    expect(daysRemaining(OIL, SHEET_DAY)).toBe(112);
    expect(daysRemaining(ANNUAL, SHEET_DAY)).toBe(355);
  });

  it("says nothing rather than zero when the airplane has no tach", () => {
    // A zero here would render as "due now" and ground a serviceable airplane.
    expect(hoursRemaining(OIL, null)).toBeNull();
  });

  it("goes negative once a limit is past", () => {
    expect(hoursRemaining(OIL, 1530)).toBe(-6.8);
    expect(daysRemaining(OIL, new Date(2026, 11, 5))).toBe(-5);
  });
});

describe("what state that puts an item in", () => {
  it("is in limits with room on both clocks", () => {
    const due = maintenanceDue(OIL, SHEET_TACH, SHEET_DAY);
    expect(due.state).toBe("OK");
    // 19.3 hours is closer to its threshold than 112 days is to its, so the
    // hours are what the countdown should show.
    expect(due.limitedBy).toBe("hours");
    expect(due.grounds).toBe(false);
  });

  it("takes the TIGHTER of the two limits, not the friendlier one", () => {
    // Plenty of hours left, but the calendar ran out three days ago.
    const due = maintenanceDue(OIL, 1475, new Date(2026, 11, 3));
    expect(due.state).toBe("OVERDUE");
    expect(due.limitedBy).toBe("calendar");
    expect(due.hoursRemaining).toBe(48.2);
  });

  it("warns while there's still time to book the shop", () => {
    const due = maintenanceDue(OIL, 1523.2 - (DUE_SOON_HOURS - 1), SHEET_DAY);
    expect(due.state).toBe("DUE_SOON");
    expect(due.limitedBy).toBe("hours");
  });

  it("is still legal on the last day of a calendar month, and not the day after", () => {
    // The whole reason calendar months are counted to the end of the month:
    // an annual signed off in July is good through 31 July next year.
    expect(maintenanceDue(ANNUAL, SHEET_TACH, new Date(2027, 6, 31)).state).toBe(
      "DUE_SOON"
    );
    expect(maintenanceDue(ANNUAL, SHEET_TACH, new Date(2027, 7, 1)).state).toBe(
      "OVERDUE"
    );
  });

  it("is overdue the moment the hours are spent", () => {
    // Hours are a budget rather than a date: at the due tach it IS due.
    expect(maintenanceDue(OIL, 1523.2, SHEET_DAY).state).toBe("OVERDUE");
  });

  it("says 'not tracked' rather than 'fine' when nothing is known", () => {
    const unknown = maintenanceDue(
      { intervalHours: null, intervalMonths: null, lastDoneTach: null, lastDoneOn: null },
      SHEET_TACH,
      SHEET_DAY
    );
    expect(unknown.state).toBe("UNTRACKED");
    expect(unknown.urgency).toBeNull();
    // An item with an interval nobody has ever signed off is equally unknown.
    expect(
      maintenanceDue({ ...ANNUAL, lastDoneOn: null }, SHEET_TACH, SHEET_DAY).state
    ).toBe("UNTRACKED");
  });
});

describe("grounding", () => {
  it("is only ever a legally-required item, however late the club's own are", () => {
    // The oil change is 7 hours past the club's 50-hour schedule. That's a
    // maintenance officer's problem, not a dispatch decision.
    const lateOil = maintenanceDue(OIL, 1530, SHEET_DAY);
    expect(lateOil.state).toBe("OVERDUE");
    expect(lateOil.grounds).toBe(false);

    // An airplane out of annual may not be flown at all (91.409).
    const outOfAnnual = maintenanceDue(ANNUAL, SHEET_TACH, new Date(2027, 8, 1));
    expect(outOfAnnual.grounds).toBe(true);
  });

  it("lists the blocking items and nothing else", () => {
    const items = [OIL, ANNUAL, TRANSPONDER];
    // Late 2027: the annual has lapsed, the transponder check hasn't.
    const blocked = grounding(items, 1530, new Date(2027, 8, 1));
    expect(blocked).toEqual([ANNUAL]);
    // Back on the day the sheet was read, nothing blocks anything.
    expect(grounding(items, SHEET_TACH, SHEET_DAY)).toEqual([]);
  });
});

describe("which item is next", () => {
  it("picks the one the club's own sheet picked", () => {
    // The sheet's "Next-Due Maintenance Item" box read "Engine Oil Change" —
    // 19.3 hours and 112 days — even though the annual's 355 days is a bigger
    // number than either.
    expect(nextDue([ANNUAL, OIL, TRANSPONDER], SHEET_TACH, SHEET_DAY)).toBe(OIL);
  });

  it("compares hours against days in units of 'about to be due'", () => {
    // The trap this ordering exists to avoid: a raw comparison of the numbers
    // would put an item with 300 days left ahead of one with 3 hours left.
    const hoursItem: MaintenanceFacts = {
      intervalHours: 50,
      intervalMonths: null,
      lastDoneTach: 1000,
      lastDoneOn: null,
    };
    const daysItem: MaintenanceFacts = {
      intervalHours: null,
      intervalMonths: 12,
      lastDoneTach: null,
      lastDoneOn: new Date(2026, 6, 8),
    };
    // 3 hours left vs 300-odd days left.
    expect(nextDue([daysItem, hoursItem], 1047, SHEET_DAY)).toBe(hoursItem);
  });

  it("sorts untracked items last, not first", () => {
    const untracked: MaintenanceFacts = {
      intervalHours: null,
      intervalMonths: null,
      lastDoneTach: null,
      lastDoneOn: null,
    };
    const sorted = byUrgency([untracked, ANNUAL, OIL], SHEET_TACH, SHEET_DAY);
    expect(sorted[0]).toBe(OIL);
    expect(sorted[sorted.length - 1]).toBe(untracked);
    // …and it can never be what the club is "next due" for.
    expect(nextDue([untracked], SHEET_TACH, SHEET_DAY)).toBeNull();
  });

  it("has nothing to pick from an empty fleet sheet", () => {
    expect(nextDue([], SHEET_TACH, SHEET_DAY)).toBeNull();
  });
});

describe("the countdown, in words", () => {
  it("shows whichever clock is running out", () => {
    expect(formatRemaining(maintenanceDue(OIL, SHEET_TACH, SHEET_DAY))).toBe(
      "19.3 hrs"
    );
    expect(formatRemaining(maintenanceDue(ANNUAL, SHEET_TACH, SHEET_DAY))).toBe(
      "355 days"
    );
  });

  it("says how far past, rather than a minus sign", () => {
    expect(formatRemaining(maintenanceDue(OIL, 1530, SHEET_DAY))).toBe(
      "6.8 hrs over"
    );
    expect(
      formatRemaining(maintenanceDue(ANNUAL, SHEET_TACH, new Date(2027, 7, 3)))
    ).toBe("3 days over");
  });

  it("names the last legal day as today rather than counting zero", () => {
    expect(
      formatRemaining(maintenanceDue(ANNUAL, null, new Date(2027, 6, 31)))
    ).toBe("due today");
  });

  it("has a dash for an item with no countdown at all", () => {
    const untracked = maintenanceDue(
      { intervalHours: null, intervalMonths: null, lastDoneTach: null, lastDoneOn: null },
      SHEET_TACH,
      SHEET_DAY
    );
    expect(formatRemaining(untracked)).toBe("—");
  });
});

describe("thresholds", () => {
  it("are a month of club flying and a month of notice", () => {
    // Not regulation — club policy, and the unit the two clocks are compared
    // in. A change here changes what "due soon" means everywhere.
    expect(DUE_SOON_HOURS).toBe(10);
    expect(DUE_SOON_DAYS).toBe(30);
  });
});

describe("validating an item somebody typed in", () => {
  it("insists on a name and nothing else", () => {
    expect(maintenanceItemError({ label: "Engine Oil Change" })).toBeNull();
    expect(maintenanceItemError({ label: "   " })).toMatch(/name/i);
  });

  it("accepts an item with no interval and no history", () => {
    // "We have one of these and nobody has touched it" is a legitimate row —
    // it's how an item gets onto the sheet before its paperwork is found.
    expect(
      maintenanceItemError({
        label: "ELT battery",
        intervalHours: null,
        intervalMonths: null,
        lastDoneTach: null,
      })
    ).toBeNull();
  });

  it("rejects intervals that can't mean anything", () => {
    expect(maintenanceItemError({ label: "Oil", intervalHours: 0 })).toMatch(/hour/i);
    expect(maintenanceItemError({ label: "Oil", intervalMonths: -1 })).toMatch(/month/i);
    expect(maintenanceItemError({ label: "Oil", lastDoneTach: -5 })).toMatch(/tach/i);
  });
});
