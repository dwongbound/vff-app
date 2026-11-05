import { describe, expect, it } from "vitest";
import {
  EMPTY_FUEL,
  derivedField,
  editFuel,
  fuelEntryFor,
  fuelPayload,
  fuelSummary,
  hasFuel,
  restoreFuel,
  type FuelEntry,
  type FuelField,
} from "@/lib/fuel";

/** Type into the boxes in order, as a member would. */
function type(...edits: [FuelField, string][]): FuelEntry {
  return edits.reduce((entry, [field, value]) => editFuel(entry, field, value), EMPTY_FUEL);
}

describe("editFuel", () => {
  it("works out the total from gallons and a price", () => {
    const entry = type(["gallons", "22.1"], ["price", "6.99"]);
    expect(entry.total).toBe("154.48");
    expect(derivedField(entry)).toBe("total");
  });

  it("works out the price from gallons and a total", () => {
    const entry = type(["gallons", "20"], ["total", "139.80"]);
    expect(entry.price).toBe("6.99");
    expect(derivedField(entry)).toBe("price");
  });

  it("works out the gallons from a price and a total", () => {
    const entry = type(["price", "6.99"], ["total", "139.80"]);
    expect(entry.gallons).toBe("20");
    expect(derivedField(entry)).toBe("gallons");
  });

  it("asks for nothing but the total", () => {
    const entry = type(["total", "154.48"]);
    expect(fuelPayload(entry)).toEqual({ fuelAddedGal: null, fuelCostDollars: 154.48 });
    expect(derivedField(entry)).toBeNull();
    expect(entry.gallons).toBe("");
    expect(entry.price).toBe("");
  });

  it("re-works the derived box as an input changes", () => {
    const entry = editFuel(type(["gallons", "20"], ["price", "7"]), "gallons", "10");
    expect(entry.total).toBe("70.00");
  });

  it("re-prices rather than rewriting a figure the club stores", () => {
    // Gallons, then price (total is worked out) — now correct the total off
    // the receipt. The gallons measured at the pump stand and the price gives
    // way, because the price is the one figure nothing is stored from.
    const entry = type(["gallons", "20"], ["price", "7"], ["total", "120"]);
    expect(entry.price).toBe("6.00");
    expect(entry.gallons).toBe("20");
    expect(derivedField(entry)).toBe("price");
  });

  it("clears the derived box when an input is emptied", () => {
    const entry = editFuel(type(["gallons", "20"], ["price", "7"]), "price", "");
    expect(entry.total).toBe("");
    expect(entry.gallons).toBe("20");
    expect(derivedField(entry)).toBeNull();
  });

  it("keeps a half-typed number exactly as typed", () => {
    // "6." is a state a member passes through on the way to 6.99, so the box
    // holds their characters while the total follows what they mean so far.
    const entry = type(["gallons", "20"], ["price", "6."]);
    expect(entry.price).toBe("6.");
    expect(entry.total).toBe("120.00");
    expect(editFuel(entry, "price", "6.99").total).toBe("139.80");
  });

  it("derives nothing from a box holding only a decimal point", () => {
    expect(type(["gallons", "20"], ["price", "."]).total).toBe("");
  });

  it("refuses to divide by zero", () => {
    expect(type(["gallons", "0"], ["total", "50"]).price).toBe("");
    expect(type(["price", "0"], ["total", "50"]).gallons).toBe("");
  });

  it("ignores a negative figure rather than deriving from it", () => {
    expect(type(["gallons", "-5"], ["price", "7"]).total).toBe("");
  });
});

describe("restoreFuel", () => {
  it("keeps the two stored columns and re-derives the price", () => {
    const entry = fuelEntryFor({ fuelAddedGal: 22.1, fuelCostCents: 15448 });
    expect(entry).toMatchObject({ gallons: "22.1", total: "154.48", price: "6.99" });
    expect(derivedField(entry)).toBe("price");
    // Correcting the gallons re-prices it and leaves the receipt total — the
    // figure the club credits — exactly as it was filed.
    const fixed = editFuel(entry, "gallons", "10");
    expect(fixed.total).toBe("154.48");
    expect(fixed.price).toBe("15.45");
  });

  it("restores a draft of all three boxes without changing what it holds", () => {
    const entry = restoreFuel({ gallons: "20", price: "6.99", total: "139.80" });
    expect(entry).toMatchObject({ gallons: "20", price: "6.99", total: "139.80" });
  });

  it("leaves a total-only row alone", () => {
    const entry = fuelEntryFor({ fuelAddedGal: null, fuelCostCents: 15448 });
    expect(entry).toMatchObject({ gallons: "", price: "", total: "154.48" });
    expect(hasFuel(entry)).toBe(true);
  });

  it("is empty for a row with no fuel on it", () => {
    expect(hasFuel(fuelEntryFor({ fuelAddedGal: null, fuelCostCents: null }))).toBe(false);
  });
});

describe("fuelSummary", () => {
  it("prices a fill-up from the two stored figures", () => {
    expect(fuelSummary({ fuelAddedGal: 22.1, fuelCostCents: 15448 })).toEqual({
      gallons: "22.1 gal",
      price: "$6.99",
      total: "$154.48",
    });
  });

  it("gives no price when there are no gallons to divide by", () => {
    expect(fuelSummary({ fuelAddedGal: 0, fuelCostCents: 15448 }).price).toBeNull();
    expect(fuelSummary({ fuelAddedGal: null, fuelCostCents: 15448 }).price).toBeNull();
  });
});
