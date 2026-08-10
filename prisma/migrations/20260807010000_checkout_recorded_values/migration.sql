-- Readings recorded on the checkout items themselves.
--
-- Additive and nullable, so this one is safe: existing rows simply have no
-- recorded values, which is exactly true of them — they were answered before
-- the cards had fields. The fuelOnBoardGal / oilQuarts columns stay put and
-- keep whatever they already held; they're now DERIVED from `values` on write
-- instead of posted separately, but nothing has to be backfilled for that.
ALTER TABLE "checkouts" ADD COLUMN "values" JSONB;
ALTER TABLE "flights" ADD COLUMN "turnoffValues" JSONB;
