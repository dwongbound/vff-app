-- CreateEnum
CREATE TYPE "SignupCodeKind" AS ENUM ('MEMBER', 'INSTRUCTOR');

-- AlterEnum
ALTER TYPE "Position" ADD VALUE 'INSTRUCTOR';

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "instructorId" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedById" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "instructorId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "clubMember" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "signup_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "SignupCodeKind" NOT NULL DEFAULT 'MEMBER',
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signup_codes_code_key" ON "signup_codes"("code");

-- CreateIndex
CREATE INDEX "flights_instructorId_signedAt_idx" ON "flights"("instructorId", "signedAt");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_codes" ADD CONSTRAINT "signup_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
