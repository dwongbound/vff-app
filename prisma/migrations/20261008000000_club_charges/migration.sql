-- Club-level charges: a one-off line on the club's books that belongs to no
-- member — an insurance bill, a grant, an opening balance.
--
-- The only change is that `memberId` may now be NULL. Every existing row has
-- a member, so nothing is backfilled, and the (memberId, recurringChargeId,
-- period) unique index is untouched: Postgres treats NULLs as distinct, and a
-- club line never has a recurring rule anyway.
ALTER TABLE "charges" ALTER COLUMN "memberId" DROP NOT NULL;
