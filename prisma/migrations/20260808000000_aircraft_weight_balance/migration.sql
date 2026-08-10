-- Weight & balance basis, per airframe.
--
-- Additive and nullable, so every existing row is simply "no W&B recorded",
-- which is the truth about them — and the tool declines to compute rather than
-- assuming a default airplane. Nothing to backfill.
--
-- Only the airframe's own numbers are stored. The stations (seat, tank and
-- baggage arms) and the CG envelope belong to the TYPE and live in
-- lib/weightBalance.ts; `wbProfile` names which of those applies.
ALTER TABLE "aircraft" ADD COLUMN "wbProfile" TEXT;
ALTER TABLE "aircraft" ADD COLUMN "emptyWeightLbs" DOUBLE PRECISION;
ALTER TABLE "aircraft" ADD COLUMN "emptyMomentLbIn" DOUBLE PRECISION;
ALTER TABLE "aircraft" ADD COLUMN "weighedOn" TIMESTAMP(3);
