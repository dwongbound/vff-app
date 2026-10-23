// "22.1 gal × $6.99 = $154.48", with the total in bold — the total is what's
// credited back, so it's the number the eye should land on. An older row with
// no price reads "22.1 gal · $154.48"; see lib/fuel.ts for why its price isn't
// back-derived.
import { fuelSummary, type FuelRecord } from "@/lib/fuel";

export default function FuelSummary({ fuel }: { fuel: FuelRecord }) {
  const { gallons, price, total } = fuelSummary(fuel);
  if (!gallons && !price && !total) return <>none</>;
  if (price && total) {
    return (
      <>
        {gallons} × {price} = <strong className="font-semibold">{total}</strong>
      </>
    );
  }
  if (price) return <>{gallons ? `${gallons} at ${price}/gal` : `${price}/gal`}</>;
  return (
    <>
      {gallons}
      {gallons && total && " · "}
      {total && <strong className="font-semibold">{total}</strong>}
    </>
  );
}
