-- Flight sessions: one log row spanning preflight → runway → post-flight.
--
-- Three changes, and the BACKFILL in the middle is the load-bearing one.
--
-- 1. The tach columns become nullable. A session opened by a preflight walk has
--    no end reading yet, and a flight closed out with no preflight has no start
--    one. Widening a NOT NULL column is not a rewrite and touches no data.
-- 2. `filed_at` says which state a row is in — null means the airplane is still
--    out. Every row that already exists was filed from the post-flight form, so
--    it is backfilled from `created_at`; without that step the whole club's
--    history would come back as flights in progress.
-- 3. `checkouts.flight_id` is what joins the cards to the session.

ALTER TABLE "flights" ALTER COLUMN "tachStart" DROP NOT NULL;
ALTER TABLE "flights" ALTER COLUMN "tachEnd" DROP NOT NULL;

ALTER TABLE "flights" ADD COLUMN "filedAt" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "logEntry" TEXT;

-- Everything already in the log is a filed flight, not a session in progress.
UPDATE "flights" SET "filedAt" = "createdAt" WHERE "filedAt" IS NULL;

ALTER TABLE "checkouts" ADD COLUMN "flightId" TEXT;

ALTER TABLE "checkouts"
  ADD CONSTRAINT "checkouts_flightId_fkey"
  FOREIGN KEY ("flightId") REFERENCES "flights"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "checkouts_flightId_idx" ON "checkouts"("flightId");
CREATE INDEX "flights_userId_aircraftId_filedAt_idx" ON "flights"("userId", "aircraftId", "filedAt");
