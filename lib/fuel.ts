// Fuel money: a price per gallon in, a total out.
//
// Members are asked for the PUMP PRICE, because that's the number on the pump
// and on the receipt's top line, and because "Fuel cost: dollars" was read
// both ways — a member filed 22.1 gal at "$6.99" and was credited $6.99 for
// $154 of fuel. The TOTAL is still what's stored in `fuelCostCents` and what
// `fuelCredit` pays back, so it's worked out here, once, on the server.
//
// Rows from before the price existed carry a total and no price. They're not
// wrong, just older, and they're shown as a total rather than with a price
// back-derived from it — total ÷ gallons rarely multiplies back to the cent,
// and a sum on screen that doesn't add up is worse than no sum.
import { formatMoney } from "./finance";

/** Gallons × price, to the cent. Null unless both are known. */
export function fuelTotalCents(
  gallons: number | null | undefined,
  pricePerGalCents: number | null | undefined
): number | null {
  if (gallons == null || pricePerGalCents == null) return null;
  return Math.round(gallons * pricePerGalCents);
}

export interface FuelRecord {
  fuelAddedGal: number | null;
  fuelPricePerGalCents: number | null;
  fuelCostCents: number | null;
}

/**
 * The pieces of "22.1 gal × $6.99 = $154.48", each null when unknown, so the
 * caller can bold the total. With no price (an older row) there's no `price`
 * and the total stands alone.
 */
export function fuelSummary(f: FuelRecord): {
  gallons: string | null;
  price: string | null;
  total: string | null;
} {
  return {
    gallons: f.fuelAddedGal != null ? `${f.fuelAddedGal} gal` : null,
    price: f.fuelPricePerGalCents != null ? formatMoney(f.fuelPricePerGalCents) : null,
    total: f.fuelCostCents != null ? formatMoney(f.fuelCostCents) : null,
  };
}

/**
 * The live "= $154.48 total" under a form's price box, off the two STRINGS the
 * inputs hold. Null until both parse — a half-typed form shows the plain hint.
 */
export function fuelTotalHint(gallons: string, pricePerGal: string): string | null {
  const g = gallons.trim() === "" ? NaN : Number(gallons);
  const p = pricePerGal.trim() === "" ? NaN : Number(pricePerGal);
  if (!Number.isFinite(g) || !Number.isFinite(p) || g < 0 || p < 0) return null;
  return `= ${formatMoney(Math.round(g * Math.round(p * 100)))} total`;
}
