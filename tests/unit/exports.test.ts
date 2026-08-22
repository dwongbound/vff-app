import { describe, expect, it } from "vitest";
import {
  financesWorkbook,
  flightLogSheet,
  maintenanceSheet,
  sheetDate,
} from "@/lib/exports";
import type {
  ApiFlightSummary,
  ApiMaintenanceItem,
  ApiStatement,
} from "@/lib/types";

const NOW = new Date(2026, 7, 18); // 18 Aug 2026, local

function user(name: string) {
  return { id: name.toLowerCase(), name, email: null };
}

function flight(over: Partial<ApiFlightSummary> = {}): ApiFlightSummary {
  return {
    id: "f1",
    aircraft: { id: "a1", tailNumber: "N8318B" },
    pilot: user("Marat"),
    reservationId: null,
    flownOn: new Date(2026, 6, 31).toISOString(),
    filedAt: new Date(2026, 6, 31).toISOString(),
    startedAt: null,
    endedAt: null,
    logEntry: null,
    tachStart: 1491.17,
    tachEnd: 1492.6,
    hobbsStart: null,
    hobbsEnd: null,
    landings: 1,
    nightLandings: 0,
    withInstructor: false,
    departure: null,
    arrival: null,
    route: null,
    fuelAddedGal: null,
    fuelCostCents: null,
    fuelPaidPersonally: true,
    landingFeeCents: null,
    oilAddedQts: null,
    tiedDown: false,
    cabinClean: false,
    turnoffAnswers: {},
    turnoffCheckoutVersion: null,
    turnoffValues: {},
    notes: null,
    photoCount: 0,
    openSquawkCount: 0,
    instructor: null,
    signedBy: null,
    signedAt: null,
    editedAt: null,
    createdAt: new Date(2026, 6, 31).toISOString(),
    mine: false,
    ...over,
  };
}

function item(over: Partial<ApiMaintenanceItem> = {}): ApiMaintenanceItem {
  return {
    id: "m1",
    aircraftId: "a1",
    label: "Engine Oil Change",
    category: "INSPECTION",
    requiredByReg: false,
    reference: null,
    intervalHours: 50,
    intervalMonths: null,
    lastDoneTach: 1473.2,
    lastDoneOn: new Date(2026, 6, 8).toISOString(),
    notes: null,
    active: true,
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

describe("sheetDate", () => {
  it("writes the club sheet's M/D/YYYY", () => {
    expect(sheetDate(new Date(2026, 7, 16))).toBe("8/16/2026");
  });

  it("is empty rather than 'Invalid Date' for a missing or broken value", () => {
    expect(sheetDate(null)).toBe("");
    expect(sheetDate("not a date")).toBe("");
  });
});

describe("flightLogSheet", () => {
  const sheet = flightLogSheet({
    tailNumber: "N8318B",
    flights: [
      flight({
        id: "b",
        flownOn: new Date(2026, 7, 16).toISOString(),
        tachStart: 1505.09,
        tachEnd: 1506.27,
        pilot: user("Dylan"),
      }),
      flight({
        id: "a",
        fuelAddedGal: 26.89,
        fuelCostCents: 19226,
        landingFeeCents: 600,
      }),
    ],
    maintenance: [item()],
    tach: 1506.27,
    now: NOW,
  });

  it("leads with the club sheet's column order", () => {
    expect(sheet.rows[0].slice(0, 10)).toEqual([
      "Date",
      "PIC",
      "Tach Start",
      "Tach End",
      "Total Tach",
      "CheckSum Time",
      "Fuel Added [g]",
      "Fuel $ / gallon",
      "Fuel Cost [$]",
      "Fuel Purchase Personal Card",
    ]);
  });

  it("carries the status band above the table, with row 4 left blank", () => {
    expect(sheet.rows[1][0]).toBe("8/18/2026");
    expect(sheet.rows[1][1]).toBe("<- Today");
    expect(sheet.rows[1][2]).toBe("TACH HOURS Until Next Mx Due");
    // 1473.2 + 50 = 1523.2 due, against a tach of 1506.27.
    expect(sheet.rows[1][4]).toBeCloseTo(16.9, 1);
    expect(sheet.rows[2][4]).toBe("Engine Oil Change");
    expect(sheet.rows[3]).toEqual([]);
  });

  it("orders the flights oldest first, the way a log reads on paper", () => {
    // Handed in newest-first, as the page holds them.
    expect(sheet.rows[4][0]).toBe("7/31/2026");
    expect(sheet.rows[5][0]).toBe("8/16/2026");
  });

  it("writes money as summable numbers of dollars", () => {
    expect(sheet.rows[4][8]).toBe(192.26);
    expect(sheet.rows[4][17]).toBe(6);
  });

  it("derives the per-gallon price only when both halves are known", () => {
    expect(sheet.rows[4][7]).toBeCloseTo(7.15, 2);
    // The second flight recorded neither, so the column stays empty rather
    // than carrying a price worked out from nothing.
    expect(sheet.rows[5][7]).toBeNull();
  });

  it("never divides by zero when a fill-up recorded no gallons", () => {
    const zero = flightLogSheet({
      tailNumber: "N8318B",
      flights: [flight({ fuelAddedGal: 0, fuelCostCents: 5000 })],
      now: NOW,
    });
    expect(zero.rows[4][7]).toBeNull();
  });

  it("answers the personal-card column from the fuel cost that raises a credit", () => {
    expect(sheet.rows[4][9]).toBe("Yes");
    expect(sheet.rows[5][9]).toBeNull();
  });

  it("leaves the club's own checksum column empty rather than guessing at it", () => {
    expect(sheet.rows[4][5]).toBeNull();
  });

  it("still produces the band when nothing is being tracked", () => {
    const bare = flightLogSheet({ tailNumber: "N8318B", flights: [], now: NOW });
    expect(bare.rows[1][4]).toBe("N/A");
    expect(bare.rows[2][4]).toBe("Nothing tracked");
  });
});

describe("maintenanceSheet", () => {
  const sheet = maintenanceSheet({
    tailNumber: "N8318B",
    tach: 1506.27,
    now: NOW,
    items: [
      item({ id: "elt", label: "ELT Test", category: "EQUIPMENT", intervalHours: null, intervalMonths: 12, lastDoneTach: null, reference: "14 CFR 91.207" }),
      item(),
      item({
        id: "annual",
        label: "Annual Inspection",
        requiredByReg: true,
        intervalHours: null,
        intervalMonths: 12,
      }),
    ],
  });

  it("uses the club sheet's headers, with A left as its spacer", () => {
    expect(sheet.rows[0][0]).toBeNull();
    expect(sheet.rows[0][1]).toBe("Required by Regulation");
    expect(sheet.rows[0][3]).toBe("Hours Remaining");
    expect(sheet.rows[0][7]).toBe("Tach at Last Inspt / Mx");
  });

  it("groups the rows under the sheet's own two headings", () => {
    const headings = sheet.rows.map((r) => r[2]);
    expect(headings).toContain("INSPECTION & RECURRENT MX");
    expect(headings).toContain("EQUIPMENT");
    // Inspection block comes first, as it does in the club's sheet.
    expect(headings.indexOf("INSPECTION & RECURRENT MX")).toBeLessThan(
      headings.indexOf("EQUIPMENT")
    );
  });

  it("writes the sheet's dash for a club-scheduled item and Yes for a legal one", () => {
    const oil = sheet.rows.find((r) => r[2] === "Engine Oil Change")!;
    const annual = sheet.rows.find((r) => r[2] === "Annual Inspection")!;
    expect(oil[1]).toBe("-");
    expect(annual[1]).toBe("Yes");
  });

  it("writes N/A where the club's formula shows #VALUE!", () => {
    const annual = sheet.rows.find((r) => r[2] === "Annual Inspection")!;
    // No hour interval, so no hours remaining and no tach due.
    expect(annual[3]).toBe("N/A");
    expect(annual[5]).toBe("N/A");
    // The calendar half is real: 8 Jul 2026 + 12 months, to the end of July.
    expect(annual[6]).toBe("7/31/2027");
  });

  it("carries the panel's epoch, so a mailed-round sheet says what it counted from", () => {
    const last = sheet.rows[sheet.rows.length - 1][2] as string;
    expect(last).toContain("tach 1506.3");
    expect(last).toContain("8/18/2026");
  });

  it("skips a heading for a category with nothing in it", () => {
    const only = maintenanceSheet({
      tailNumber: "N8318B",
      tach: null,
      now: NOW,
      items: [item()],
    });
    expect(only.rows.map((r) => r[2])).not.toContain("EQUIPMENT");
  });
});

describe("financesWorkbook", () => {
  function statement(over: Partial<ApiStatement> = {}): ApiStatement {
    return {
      member: user("Dylan"),
      period: "2026-08",
      charges: [],
      chargedCents: 0,
      creditedCents: 0,
      balanceCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      ...over,
    };
  }

  const charge = {
    id: "c1",
    member: user("Dylan"),
    kind: "FLIGHT" as const,
    amountCents: 12000,
    description: "1.2 hr in N8318B",
    period: "2026-08",
    incurredOn: new Date(2026, 7, 5).toISOString(),
    flightId: "f1",
    recurringChargeId: null,
    voided: false,
    voidReason: null,
    paidAt: null,
    paidBy: null,
    createdAt: new Date(2026, 7, 5).toISOString(),
    mine: true,
  };

  const credit = {
    ...charge,
    id: "c2",
    kind: "FUEL_CREDIT" as const,
    amountCents: -19226,
    description: "Fuel bought for N8318B",
    incurredOn: new Date(2026, 7, 1).toISOString(),
  };

  it("splits a signed amount into charge and credit columns", () => {
    const [sheet] = financesWorkbook({
      period: "2026-08",
      clubWide: false,
      now: NOW,
      statements: [
        statement({
          charges: [charge, credit],
          chargedCents: 12000,
          creditedCents: -19226,
          balanceCents: -7226,
          outstandingCents: -7226,
        }),
      ],
    });

    // Oldest first: the credit is 1 Aug, the charge 5 Aug.
    const creditRow = sheet.rows[4];
    const chargeRow = sheet.rows[5];
    expect(creditRow[4]).toBeNull();
    expect(creditRow[5]).toBe(192.26);
    expect(chargeRow[4]).toBe(120);
    expect(chargeRow[5]).toBeNull();
  });

  it("puts the month's totals in the band above the ledger", () => {
    const [sheet] = financesWorkbook({
      period: "2026-08",
      clubWide: false,
      now: NOW,
      statements: [statement({ chargedCents: 12000, balanceCents: 12000 })],
    });
    expect(sheet.rows[1][0]).toBe("August 2026");
    expect(sheet.rows[1][2]).toBe("CHARGED");
    expect(sheet.rows[1][3]).toBe(120);
    expect(sheet.rows[3]).toEqual([]);
  });

  it("adds a per-member tab only for a club-wide export", () => {
    const own = financesWorkbook({
      period: "2026-08",
      clubWide: false,
      now: NOW,
      statements: [statement()],
    });
    expect(own).toHaveLength(1);

    const club = financesWorkbook({
      period: "2026-08",
      clubWide: true,
      now: NOW,
      statements: [
        statement({ member: user("Marat"), chargedCents: 5000, balanceCents: 5000 }),
        statement({ member: user("Dylan"), chargedCents: 12000, balanceCents: 12000 }),
      ],
    });
    expect(club).toHaveLength(2);
    // Sorted by name, then a blank row, then the club's own bottom line.
    expect(club[1].rows[1][0]).toBe("Dylan");
    expect(club[1].rows[2][0]).toBe("Marat");
    expect(club[1].rows[4]).toEqual(["TOTAL", 170, 0, 170, 0, 0]);
  });

  it("marks a voided line and leaves the column empty otherwise", () => {
    const [sheet] = financesWorkbook({
      period: "2026-08",
      clubWide: false,
      now: NOW,
      statements: [
        statement({ charges: [{ ...charge, voided: true }, credit] }),
      ],
    });
    expect(sheet.rows[4][8]).toBeNull(); // the credit
    expect(sheet.rows[5][8]).toBe("Yes"); // the voided charge
  });
});
