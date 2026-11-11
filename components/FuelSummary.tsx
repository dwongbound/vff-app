// "22.1 gal × $6.99 = $154.48", with the total in bold — the total is what's
// credited back, so it's the number the eye should land on. The price is
// worked out from the stored gallons and total (lib/fuel.ts), so it shows only
// when both are known.
import { fuelSummary, type FuelRecord } from "@/lib/fuel";

export default function FuelSummary({ fuel }: { fuel: FuelRecord }) {
  const { gallons, price, total } = fuelSummary(fuel);
  if (!gallons && !total) return <>none</>;
  if (gallons && price && total) {
    return (
      <>
        {gallons} × {price} = <strong className="font-semibold">{total}</strong>
      </>
    );
  }
  return (
    <>
      {gallons}
      {gallons && total && " · "}
      {total && <strong className="font-semibold">{total}</strong>}
    </>
  );
}
