-- Deleting a DERIVED charge (dues, flight time, fuel credit, landing fee,
-- payback) leaves a tombstone rather than removing the row.
--
-- A derived line has a source that writes it: reading a month re-materialises
-- its dues, editing a flight rebuilds its charge. Removing the row would let
-- that source put it straight back. `deletedAt` keeps the row — and its place
-- in the unique indexes that make the rebuilds idempotent — while every read
-- skips it. Hand-entered lines are still removed outright.
ALTER TABLE "charges" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

CREATE INDEX "charges_deletedAt_idx" ON "charges"("deletedAt");

ALTER TABLE "charges" ADD CONSTRAINT "charges_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
