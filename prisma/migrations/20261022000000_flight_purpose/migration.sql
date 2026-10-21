-- Append-only enum change (the safe kind — see CLAUDE.md).
ALTER TYPE "ReservationPurpose" ADD VALUE 'TRAINING_SOLO';

-- The flight log's type chip.
ALTER TABLE "flights" ADD COLUMN "purpose" "ReservationPurpose";

-- Backfill from the booking a flight was filed against, then call the
-- remaining instructor flights lessons. Only pre-existing values are used, so
-- this is safe in the same transaction as the ADD VALUE above.
UPDATE "flights" f SET "purpose" = r."purpose"
  FROM "reservations" r WHERE f."reservationId" = r."id";
UPDATE "flights" SET "purpose" = 'TRAINING'
  WHERE "purpose" IS NULL AND "withInstructor" = true;
