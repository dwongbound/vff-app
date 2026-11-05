// Fuel money: three boxes, any two of which give the third.
//
// A fill-up is gallons × price per gallon = total, and members arrive holding
// different halves of it — the receipt's total, the pump's price, the gallons
// off the meter. So the forms offer all three and work out whichever one the
// member didn't type. Only the TOTAL matters to the club: it's what
// `fuelCostCents` stores and what `fuelCredit` pays back. Gallons are stored
// too (`fuelAddedGal`); the price is never stored, only shown, because it is
// always total ÷ gallons.
//
// Which box is worked out is decided by what the member typed MOST RECENTLY:
// the two latest typed boxes are the inputs and the third follows them. Type
// into the worked-out one and it becomes an input, and the oldest input is the
// one that gets worked out instead. Clear a box and the worked-out one clears
// with it, since there's nothing left to work it out from.
//
// Every value is the STRING the input holds — a half-typed "6." is a state the
// member is entitled to be in, and the drafts keep strings for the same reason.
import { formatMoney } from "./finance";

export type FuelField = "gallons" | "price" | "total";

export interface FuelEntry {
  gallons: string;
  price: string;
  total: string;
  /** The boxes the member typed, oldest first — at most two. */
  typed: FuelField[];
}

export const EMPTY_FUEL: FuelEntry = { gallons: "", price: "", total: "", typed: [] };

const FIELDS: FuelField[] = ["gallons", "price", "total"];

function parse(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Two decimals, trailing zeros dropped — "21.1", not "21.10". */
function gallonsText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function moneyText(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** The third box, from the other two. "" when they don't give one. */
function derive(entry: FuelEntry, field: FuelField): string {
  const gallons = parse(entry.gallons);
  const price = parse(entry.price);
  const total = parse(entry.total);
  switch (field) {
    case "total":
      return gallons != null && price != null ? moneyText(gallons * price) : "";
    case "price":
      return gallons != null && gallons > 0 && total != null ? moneyText(total / gallons) : "";
    case "gallons":
      return price != null && price > 0 && total != null ? gallonsText(total / price) : "";
  }
}

/** Fill in (or clear) every box the member didn't type. */
function settle(entry: FuelEntry): FuelEntry {
  const next = { ...entry };
  for (const field of FIELDS) {
    if (entry.typed.includes(field)) continue;
    next[field] = entry.typed.length === 2 ? derive(entry, field) : "";
  }
  return next;
}

/**
 * The member typed `value` into `field`.
 *
 * Typing into the worked-out box makes it an input, and one of the other two
 * has to give way. PRICE goes first: it's the only one of the three the club
 * doesn't store, so it's the safest number to let the app move. Correcting the
 * gallons on a receipt therefore re-prices the fill-up rather than quietly
 * rewriting the total the member is owed. With no price to drop, the box
 * typed longest ago gives way.
 */
export function editFuel(entry: FuelEntry, field: FuelField, value: string): FuelEntry {
  const others = entry.typed.filter((f) => f !== field);
  if (value.trim() === "") return settle({ ...entry, [field]: value, typed: others });
  const kept =
    others.length < 2
      ? others
      : others.includes("price")
        ? others.filter((f) => f !== "price")
        : others.slice(1);
  return settle({ ...entry, [field]: value, typed: [...kept, field] });
}

/** The box the app filled in, if any — the form marks it as worked out. */
export function derivedField(entry: FuelEntry): FuelField | null {
  if (entry.typed.length !== 2) return null;
  return FIELDS.find((f) => !entry.typed.includes(f)) ?? null;
}

/**
 * Rebuild the boxes from stored strings — a draft, or a saved row's two
 * columns. Every non-empty box counts as typed, and when all three are full the
 * PRICE is the one treated as worked out: gallons and total are what the club
 * stores, so they're the pair a reload should keep.
 */
export function restoreFuel(values: { gallons?: string; price?: string; total?: string }): FuelEntry {
  const entry: FuelEntry = {
    gallons: values.gallons ?? "",
    price: values.price ?? "",
    total: values.total ?? "",
    typed: [],
  };
  // Gallons and total are the stored pair, so they're the two a reload keeps;
  // a price beside them is treated as the worked-out one.
  entry.typed = (["price", "gallons", "total"] as FuelField[])
    .filter((f) => entry[f].trim() !== "")
    .slice(-2);
  return settle(entry);
}

/** The boxes for a saved row: its gallons and total, price worked out. */
export function fuelEntryFor(f: { fuelAddedGal: number | null; fuelCostCents: number | null }): FuelEntry {
  return restoreFuel({
    gallons: f.fuelAddedGal != null ? String(f.fuelAddedGal) : "",
    total: f.fuelCostCents != null ? (f.fuelCostCents / 100).toFixed(2) : "",
  });
}

/** What goes on the wire: the two numbers the club stores. */
export function fuelPayload(entry: FuelEntry): {
  fuelAddedGal: number | null;
  fuelCostDollars: number | null;
} {
  return { fuelAddedGal: parse(entry.gallons), fuelCostDollars: parse(entry.total) };
}

/** Has the member put anything in the fuel boxes? */
export function hasFuel(entry: FuelEntry): boolean {
  return FIELDS.some((f) => entry[f].trim() !== "");
}

export interface FuelRecord {
  fuelAddedGal: number | null;
  fuelCostCents: number | null;
}

/**
 * The pieces of "22.1 gal × $6.99 = $154.48", each null when unknown. The
 * price is worked out from the two stored columns, and only when there are
 * gallons to divide by.
 */
export function fuelSummary(f: FuelRecord): {
  gallons: string | null;
  price: string | null;
  total: string | null;
} {
  const g = f.fuelAddedGal;
  const total = f.fuelCostCents;
  return {
    gallons: g != null ? `${g} gal` : null,
    price: g != null && g > 0 && total != null ? formatMoney(Math.round(total / g)) : null,
    total: total != null ? formatMoney(total) : null,
  };
}
