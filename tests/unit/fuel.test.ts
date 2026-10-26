import { describe, expect, it } from "vitest";
import { fuelSummary, fuelTotalCents, fuelTotalHint } from "@/lib/fuel";
import { fuelFrom, fuelPatchFrom } from "@/lib/flights";

describe("fuelTotalCents", () => {
  it("is gallons × price, to the cent", () => {
    expect(fuelTotalCents(22.1, 699)).toBe(15448);
    expect(fuelTotalCents(10, 699)).toBe(6990);
  });
  it("is unknown unless both halves are", () => {
    expect(fuelTotalCents(null, 699)).toBeNull();
    expect(fuelTotalCents(22.1, null)).toBeNull();
  });
});

describe("fuelSummary", () => {
  it("gives the three pieces of gal × price = total", () => {
    expect(
      fuelSummary({ fuelAddedGal: 22.1, fuelPricePerGalCents: 699, fuelCostCents: 15448 })
    ).toEqual({ gallons: "22.1 gal", price: "$6.99", total: "$154.48" });
  });
  it("leaves an older total-only row without a price", () => {
    expect(
      fuelSummary({ fuelAddedGal: 21.4, fuelPricePerGalCents: null, fuelCostCents: 15301 }).price
    ).toBeNull();
  });
});

describe("fuelTotalHint", () => {
  it("shows the live total once both boxes parse", () => {
    expect(fuelTotalHint("22.1", "6.99")).toBe("= $154.48 total");
  });
  it("stays quiet on a half-filled form", () => {
    expect(fuelTotalHint("", "6.99")).toBeNull();
    expect(fuelTotalHint("22.1", "")).toBeNull();
    expect(fuelTotalHint("22.1", "-1")).toBeNull();
  });
});

describe("fuelFrom (a new row)", () => {
  it("multiplies a price out to the total that gets credited", () => {
    expect(fuelFrom({ fuelPricePerGalDollars: 6.99 }, 22.1)).toEqual({
      fuelPricePerGalCents: 699,
      fuelCostCents: 15448,
    });
  });
  it("records a price with no gallons, but no total", () => {
    expect(fuelFrom({ fuelPricePerGalDollars: 6.99 }, null)).toEqual({
      fuelPricePerGalCents: 699,
      fuelCostCents: null,
    });
  });
  it("still takes a total sent outright, as an older client's queued job does", () => {
    expect(fuelFrom({ fuelCostDollars: 88.4 }, 12)).toEqual({
      fuelPricePerGalCents: null,
      fuelCostCents: 8840,
    });
  });
  it("drops a negative price", () => {
    expect(fuelFrom({ fuelPricePerGalDollars: -6.99 }, 10).fuelPricePerGalCents).toBeNull();
  });
});

describe("fuelPatchFrom (a correction)", () => {
  const priced = { fuelPricePerGalCents: 699 };
  const older = { fuelPricePerGalCents: null };

  it("re-works the total from a new price", () => {
    expect(fuelPatchFrom({ fuelPricePerGalCents: 650 }, 20, priced)).toEqual({
      fuelPricePerGalCents: 650,
      fuelCostCents: 13000,
    });
  });
  it("clearing the price clears the total with it", () => {
    expect(fuelPatchFrom({ fuelPricePerGalCents: null }, 20, priced)).toEqual({
      fuelPricePerGalCents: null,
      fuelCostCents: null,
    });
  });
  it("re-works a priced row's total when only the gallons change", () => {
    expect(fuelPatchFrom({ fuelAddedGal: 10 }, 10, priced)).toEqual({ fuelCostCents: 6990 });
  });
  it("leaves an older row's total alone when only the gallons change", () => {
    expect(fuelPatchFrom({ fuelAddedGal: 10 }, 10, older)).toEqual({});
  });
  it("a total sent outright replaces the price, so the sum can't disagree", () => {
    expect(fuelPatchFrom({ fuelCostCents: 5000 }, 10, priced)).toEqual({
      fuelPricePerGalCents: null,
      fuelCostCents: 5000,
    });
  });
  it("touches nothing it wasn't asked about", () => {
    expect(fuelPatchFrom({ notes: "x" }, 10, priced)).toEqual({});
  });
});
