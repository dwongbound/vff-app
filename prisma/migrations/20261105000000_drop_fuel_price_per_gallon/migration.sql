-- Fuel is now three boxes on the form (gallons, price per gallon, total), any
-- two filling in the third, and only gallons and the TOTAL are stored: the
-- price is always total ÷ gallons. The total each priced row was billed on was
-- already worked out from its price and stays in "fuelCostCents", so dropping
-- the price loses no money.
ALTER TABLE "flights" DROP COLUMN "fuelPricePerGalCents";
ALTER TABLE "servicing" DROP COLUMN "fuelPricePerGalCents";
