-- Idempotency keys for everything a device can submit from the outbox.
--
-- A submission whose REPLY is lost — the request reached the club, the answer
-- never made it back to an airplane taxiing out of wifi range — looks to the
-- device exactly like one that never arrived, so the device sends it again.
-- Without a key the retry is a second flight, a second squawk, a second photo.
-- With one, the route recognises the request it has already handled and
-- returns that row (lib/idempotency.ts).
--
-- Nullable, because every row predating the outbox has no key, and unique,
-- because the whole job is "at most one row per request". Postgres treats
-- NULLs as distinct, so the old rows don't collide with each other.

ALTER TABLE "flights" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "checkouts" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "squawks" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "photos" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "flights_clientRequestId_key" ON "flights"("clientRequestId");
CREATE UNIQUE INDEX "checkouts_clientRequestId_key" ON "checkouts"("clientRequestId");
CREATE UNIQUE INDEX "squawks_clientRequestId_key" ON "squawks"("clientRequestId");
CREATE UNIQUE INDEX "photos_clientRequestId_key" ON "photos"("clientRequestId");
