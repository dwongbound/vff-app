-- Collapse SquawkSeverity + SquawkStatus into one status vocabulary.
--
-- Hand-written rather than generated, because the generated version is a naive
--   ALTER COLUMN status TYPE SquawkStatus_new USING (status::text::SquawkStatus_new)
-- which fails outright on any existing row: 'OPEN' is not a value of the new
-- enum, so Postgres aborts with "invalid input value for enum".
--
-- The mapping below is chosen to PRESERVE DISPATCH STATE. The one thing that
-- must never happen is a grounded airplane quietly coming back on the line, so
-- GROUNDING is mapped first and explicitly:
--
--   status=RESOLVED              -> CLOSED              (already dealt with)
--   severity=GROUNDING (open)    -> REVIEWED_GROUNDED   (airplane stays down)
--   anything else still open     -> NEW                 (needs triage)
--
-- Open NOTE/MONITOR squawks become NEW rather than REVIEWED_OK_TO_FLY on
-- purpose: nobody has ruled on them under the new vocabulary, and NEW renders
-- amber, so an untriaged item can't be misread as "someone checked, it's fine".

CREATE TYPE "SquawkStatus_new" AS ENUM (
  'NEW',
  'REVIEWED_OK_TO_FLY',
  'REVIEWED_IN_WORK',
  'REVIEWED_GROUNDED',
  'CLOSED'
);

-- The default references the old type, so it has to go before the type swap.
ALTER TABLE "squawks" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "squawks"
  ALTER COLUMN "status" TYPE "SquawkStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'RESOLVED'   THEN 'CLOSED'
      WHEN "severity"::text = 'GROUNDING' THEN 'REVIEWED_GROUNDED'
      ELSE 'NEW'
    END
  )::"SquawkStatus_new";

ALTER TABLE "squawks" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "SquawkStatus";
ALTER TYPE "SquawkStatus_new" RENAME TO "SquawkStatus";

-- Severity is gone: what a squawk means for dispatch is now the status itself.
ALTER TABLE "squawks" DROP COLUMN "severity";
DROP TYPE "SquawkSeverity";
