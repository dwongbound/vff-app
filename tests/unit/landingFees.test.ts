// The landing fee: what the table knows, and what actually gets billed.
//
// The distinction those two sentences draw is the thing worth testing. The
// table is a DEFAULT the form opens at; the charge is a pass-through of what
// the pilot recorded. A change that made the charge read the table would pass
// most of these and break the one case the club actually cares about — the day
// KTOA charges something other than $6.
import { describe, expect, it } from "vitest";
import {
  LANDING_FEES_CENTS,
  landingFeeFor,
  landingFeeInputFor,
  normalizeAirport,
} from "@/lib/landingFees";
import { chargesForFlight, landingFeeCharge, type BillableFlight } from "@/lib/finance";
import {
  fuelCostCentsFrom,
  landingFeeCentsFrom,
  mentionsLandingFee,
} from "@/lib/flights";

const flight: BillableFlight = {
  id: "f1",
  tachStart: 1_503.9,
  tachEnd: 1_505.09,
  flownOn: new Date(2026, 7, 11, 12, 0, 0),
  fuelCostCents: null,
  landingFeeCents: 600,
  arrival: "KTOA",
};

describe("the fee table", () => {
  it("knows the club's home field", () => {
    expect(landingFeeFor("KTOA")).toBe(600);
    expect(LANDING_FEES_CENTS.KTOA).toBe(600);
  });

  // A member types into a phone keyboard; the API upper-cases on the way in,
  // but the form prefills BEFORE the API ever sees it.
  it("finds the airport however it was typed", () => {
    expect(landingFeeFor("ktoa")).toBe(600);
    expect(landingFeeFor("  KToa  ")).toBe(600);
  });

  // Null, not zero. Zero is a claim about the airport ("it's free"); null is
  // "nothing to prefill", which is what an unknown or empty field is.
  it("says nothing rather than zero for a field it doesn't know", () => {
    expect(landingFeeFor("KCMA")).toBeNull();
    expect(landingFeeFor("")).toBeNull();
    expect(landingFeeFor(null)).toBeNull();
    expect(landingFeeFor(undefined)).toBeNull();
  });

  it("normalises the way the flight API stores an identifier", () => {
    expect(normalizeAirport(" kcma ")).toBe("KCMA");
    expect(normalizeAirport(null)).toBe("");
  });

  it("hands the form dollars, and an empty box when there's no fee", () => {
    expect(landingFeeInputFor("KTOA")).toBe("6.00");
    expect(landingFeeInputFor("KCMA")).toBe("");
  });
});

describe("the charge", () => {
  it("bills what was recorded on the flight", () => {
    const line = landingFeeCharge(flight, "N8318B");
    expect(line?.kind).toBe("LANDING_FEE");
    expect(line?.amountCents).toBe(600);
    expect(line?.description).toBe("Landing fee — KTOA");
    expect(line?.period).toBe("2026-08");
    expect(line?.flightId).toBe("f1");
  });

  // The whole point of storing it per flight: the desk charged something else
  // that day, and the statement has to say what the member actually paid.
  it("bills the pilot's figure, not the table's", () => {
    const line = landingFeeCharge({ ...flight, landingFeeCents: 1_200 }, "N8318B");
    expect(line?.amountCents).toBe(1_200);
  });

  // A waived fee is a real answer and leaves no line — a $0.00 row on a
  // statement is noise, the same reason a zero-hour flight bills nothing.
  it("bills nothing for no fee, or a waived one", () => {
    expect(landingFeeCharge({ ...flight, landingFeeCents: null }, "N8318B")).toBeNull();
    expect(landingFeeCharge({ ...flight, landingFeeCents: 0 }, "N8318B")).toBeNull();
    expect(landingFeeCharge({ ...flight, landingFeeCents: undefined }, "N8318B")).toBeNull();
  });

  // Per flight, not per landing. Eight touch-and-goes is one visit to one desk,
  // and the charge doesn't read the landings count at all.
  it("does not multiply by anything", () => {
    expect(landingFeeCharge(flight, "N8318B")?.amountCents).toBe(600);
  });

  it("names the airplane when the flight recorded no destination", () => {
    const line = landingFeeCharge({ ...flight, arrival: null }, "N8318B");
    expect(line?.description).toBe("Landing fee — N8318B");
  });

  it("joins the hours charge on the statement", () => {
    const lines = chargesForFlight(flight, 13_500, "N8318B");
    expect(lines.map((l) => l.kind)).toEqual(["FLIGHT", "LANDING_FEE"]);
    // 1.19 tach hr at $135 is $160.65, plus the $6 to land.
    expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(16_065 + 600);
  });

  // Every caller that predates landing fees passes a flight with neither field.
  it("leaves a flight that never heard of landing fees alone", () => {
    const old = {
      id: "f0",
      tachStart: 1_000,
      tachEnd: 1_001,
      flownOn: new Date(2026, 7, 11, 12, 0, 0),
      fuelCostCents: null,
    };
    expect(chargesForFlight(old, 13_500, "N8318B").map((l) => l.kind)).toEqual([
      "FLIGHT",
    ]);
  });
});

// The wire readers both routes share. These exist because the two routes each
// had their own copy and the copies had DRIFTED — POST accepted dollars for
// fuel while PATCH only ever looked at cents, so correcting a fuel receipt from
// a form that sent dollars silently changed nothing.
describe("reading money off a request body", () => {
  it("takes the landing fee in either spelling", () => {
    expect(landingFeeCentsFrom({ landingFeeCents: 600 })).toBe(600);
    expect(landingFeeCentsFrom({ landingFeeDollars: 6 })).toBe(600);
    expect(landingFeeCentsFrom({ landingFeeDollars: "6.00" })).toBe(600);
  });

  it("rounds dollars to the cent rather than truncating", () => {
    // 12.345 dollars is 1235 cents, not 1234.
    expect(landingFeeCentsFrom({ landingFeeDollars: 12.345 })).toBe(1_235);
  });

  it("prefers cents when a client sends both", () => {
    expect(landingFeeCentsFrom({ landingFeeCents: 600, landingFeeDollars: 99 })).toBe(600);
  });

  it("keeps a waived fee and refuses a negative one", () => {
    // Zero is a real answer; a minus sign is a typo that would turn a debit
    // into a credit on somebody's statement.
    expect(landingFeeCentsFrom({ landingFeeDollars: 0 })).toBe(0);
    expect(landingFeeCentsFrom({ landingFeeDollars: -6 })).toBeNull();
  });

  it("says nothing for an absent or unparseable amount", () => {
    expect(landingFeeCentsFrom({})).toBeNull();
    expect(landingFeeCentsFrom({ landingFeeDollars: "" })).toBeNull();
    expect(landingFeeCentsFrom({ landingFeeDollars: "six" })).toBeNull();
  });

  // A PATCH only touches what it names — this is what keeps an edit that never
  // mentioned the fee from clearing one that was already recorded.
  it("knows whether the body mentioned a fee at all", () => {
    expect(mentionsLandingFee({ landingFeeCents: 0 })).toBe(true);
    expect(mentionsLandingFee({ landingFeeDollars: "" })).toBe(true);
    expect(mentionsLandingFee({ landings: 3 })).toBe(false);
  });

  it("reads fuel in either spelling too — the half that had drifted", () => {
    expect(fuelCostCentsFrom({ fuelCostCents: 4_720 })).toBe(4_720);
    expect(fuelCostCentsFrom({ fuelCostDollars: 47.2 })).toBe(4_720);
    expect(fuelCostCentsFrom({})).toBeNull();
  });
});
