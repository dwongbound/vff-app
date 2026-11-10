-- AlterTable
ALTER TABLE "users" ADD COLUMN     "calendarInviteEmail" TEXT,
ADD COLUMN     "calendarInvites" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "googleListTokenEnc" TEXT;
