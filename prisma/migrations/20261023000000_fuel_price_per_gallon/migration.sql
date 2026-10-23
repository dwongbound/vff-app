-- Fuel is entered as a price per gallon; the total (fuelCostCents) is still
-- what's stored and credited. Existing rows recorded a total only, so they
-- keep it and simply have no price.
ALTER TABLE "flights" ADD COLUMN "fuelPricePerGalCents" INTEGER;
ALTER TABLE "servicing" ADD COLUMN "fuelPricePerGalCents" INTEGER;
