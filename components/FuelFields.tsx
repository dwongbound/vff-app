"use client";
// The three fuel boxes — gallons, price per gallon, total — wherever fuel is
// entered: the post-flight form, Quick Log, Add Fuel, the add-a-flight modal
// and the log's correction modal.
//
// One component rather than three `Input`s per page, because the arithmetic
// between them (lib/fuel.ts) is the whole feature and five copies of it is
// five chances to disagree about what a member typed. Type any two and the
// third fills itself in, marked "worked out" so nobody wonders whether the
// club believes a number they didn't enter.
//
// Only the TOTAL is really being asked for — it's what the club credits back —
// so it's the box that says it's the one that matters, and the other two are
// ways of arriving at it.
import Input from "@/components/common/Input";
import { derivedField, type FuelEntry, type FuelField } from "@/lib/fuel";

const HINTS: Record<FuelField, string> = {
  gallons: "US gallons",
  price: "Dollars, off the pump",
  total: "Dollars — this is what's credited back",
};

export default function FuelFields({
  entry,
  onChange,
  className = "grid gap-3 sm:grid-cols-3",
}: {
  entry: FuelEntry;
  onChange: (field: FuelField, value: string) => void;
  /** The grid the three boxes sit in, so a narrow modal can stack them. */
  className?: string;
}) {
  const derived = derivedField(entry);
  // A box the app filled in says so, in place of its usual hint — a number
  // that appeared without being typed has to account for itself.
  const hint = (field: FuelField) =>
    derived === field ? "Worked out for you" : HINTS[field];

  return (
    <div className={className}>
      <Input
        label="Fuel added"
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        value={entry.gallons}
        onChange={(e) => onChange("gallons", e.target.value)}
        hint={hint("gallons")}
      />
      <Input
        label="Price per gallon"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={entry.price}
        onChange={(e) => onChange("price", e.target.value)}
        hint={hint("price")}
      />
      <Input
        label="Fuel total cost"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={entry.total}
        onChange={(e) => onChange("total", e.target.value)}
        hint={hint("total")}
      />
    </div>
  );
}
