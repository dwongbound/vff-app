-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "landingAirports" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: a Quick Log entry already wrote its airports out as the route
-- ("KTOA → KSMO → KTOA", one code per landing, no departure), so those rows
-- can be filled in exactly. Only where that reading is unambiguous: the route
-- is nothing but identifiers joined by " → ", there are as many of them as the
-- flight has landings, and no departure was given (a route typed on the
-- post-flight form starts at the departure, which is not a landing). Anything
-- else stays empty, and the report counts it as "assumed" rather than guessing.
UPDATE "flights"
SET "landingAirports" = string_to_array("route", ' → ')
WHERE "route" ~ '^[A-Z0-9]{3,5}( → [A-Z0-9]{3,5})*$'
  AND "departure" IS NULL
  AND "landings" > 0
  AND array_length(string_to_array("route", ' → '), 1) = "landings";
