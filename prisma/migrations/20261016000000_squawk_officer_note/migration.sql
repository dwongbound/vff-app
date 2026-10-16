-- The Safety Officer's note on a squawk: read by everyone, written only with
-- `squawk:manage`. Who wrote it and when ride along, so the card can say so.
ALTER TABLE "squawks" ADD COLUMN "officerNote" TEXT,
ADD COLUMN "officerNoteAt" TIMESTAMP(3),
ADD COLUMN "officerNoteById" TEXT;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_officerNoteById_fkey" FOREIGN KEY ("officerNoteById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
