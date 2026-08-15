-- Landing fees: what the destination charged, billed on to whoever flew.
--
-- Both halves are the SAFE kind of change, which is why this migration has no
-- hand-written USING clause the way the squawk-status one does:
--
--   • the enum value is APPENDED. Postgres sorts an enum in declaration order,
--     so adding at the end leaves every existing charge's sort position alone.
--     (Renumbering is the destructive case — see
--     20260807000000_squawk_status_vocabulary.)
--   • the column is NULLABLE with no default, so every flight already filed
--     stays exactly as it is: null means "no fee recorded", which is the
--     truthful answer for a flight nobody was asked the question about.
--
-- Note the new enum value cannot be USED in the same transaction that adds it
-- (Postgres rule). Nothing here does — the first LANDING_FEE row is written by
-- the app, long after this has committed.

-- AlterEnum
ALTER TYPE "ChargeKind" ADD VALUE 'LANDING_FEE';

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "landingFeeCents" INTEGER;
