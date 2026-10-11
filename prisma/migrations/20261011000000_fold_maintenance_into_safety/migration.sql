-- The club has no Maintenance Officer: the Safety Officer keeps the
-- maintenance sheet as well as triaging squawks. The MAINTENANCE_OFFICER
-- position goes, and its one power (`maintenance:manage`) moves to
-- SAFETY_OFFICER in lib/positions.ts.
--
-- Hand-written, because dropping an enum value is the destructive kind of
-- enum change (see 20260807000000_squawk_status_vocabulary): the generated
-- `USING (positions::text[]::Position_new[])` aborts with "invalid input value
-- for enum" on any member who still holds the old office.
--
-- So the DATA moves first. Anyone holding MAINTENANCE_OFFICER becomes
-- SAFETY_OFFICER — the office that now does that job — so nobody who could
-- keep the sheet yesterday is locked out of it today. DISTINCT so a member
-- who held both doesn't end up holding Safety Officer twice. (It has to be a
-- separate UPDATE: Postgres doesn't allow a subquery in ALTER COLUMN's USING.)
UPDATE "users"
SET "positions" = ARRAY(
  SELECT DISTINCT CASE WHEN p::text = 'MAINTENANCE_OFFICER' THEN 'SAFETY_OFFICER' ELSE p::text END
  FROM unnest("positions") AS p
)::"Position"[]
WHERE 'MAINTENANCE_OFFICER' = ANY("positions"::text[]);

-- Then the type, now that no row holds the value being removed.
CREATE TYPE "Position_new" AS ENUM (
  'PRESIDENT',
  'VICE_PRESIDENT',
  'SECRETARY',
  'FINANCE_OFFICER',
  'SAFETY_OFFICER',
  'INSTRUCTOR'
);

ALTER TABLE "users"
  ALTER COLUMN "positions" TYPE "Position_new"[]
  USING ("positions"::text[]::"Position_new"[]);

DROP TYPE "Position";
ALTER TYPE "Position_new" RENAME TO "Position";
