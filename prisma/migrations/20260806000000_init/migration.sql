-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SquawkSeverity" AS ENUM ('NOTE', 'MONITOR', 'GROUNDING');

-- CreateEnum
CREATE TYPE "SquawkStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CheckoutKind" AS ENUM ('PREFLIGHT', 'RUNWAY');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReservationPurpose" AS ENUM ('LOCAL', 'CROSS_COUNTRY', 'TRAINING', 'CHECKRIDE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'FINANCE_OFFICER', 'SAFETY_OFFICER', 'MAINTENANCE_OFFICER');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('DUES', 'FLIGHT', 'FUEL_CREDIT', 'ONE_OFF');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "positions" "Position"[],
    "certificate" TEXT,
    "medicalExpiresOn" TIMESTAMP(3),
    "flightReviewOn" TIMESTAMP(3),
    "tourSeenAt" TIMESTAMP(3),
    "totalTimeHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aircraft" (
    "id" TEXT NOT NULL,
    "tailNumber" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "hourlyRateCents" INTEGER,
    "fuelCapacityGal" DOUBLE PRECISION,
    "homeBase" TEXT,
    "lastTach" DOUBLE PRECISION,
    "lastHobbs" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "purpose" "ReservationPurpose" NOT NULL DEFAULT 'LOCAL',
    "notes" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flights" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reservationId" TEXT,
    "flownOn" TIMESTAMP(3) NOT NULL,
    "tachStart" DOUBLE PRECISION NOT NULL,
    "tachEnd" DOUBLE PRECISION NOT NULL,
    "hobbsStart" DOUBLE PRECISION,
    "hobbsEnd" DOUBLE PRECISION,
    "landings" INTEGER NOT NULL DEFAULT 1,
    "nightLandings" INTEGER NOT NULL DEFAULT 0,
    "withInstructor" BOOLEAN NOT NULL DEFAULT false,
    "departure" TEXT,
    "arrival" TEXT,
    "route" TEXT,
    "fuelAddedGal" DOUBLE PRECISION,
    "fuelCostCents" INTEGER,
    "oilAddedQts" DOUBLE PRECISION,
    "tiedDown" BOOLEAN NOT NULL DEFAULT true,
    "cabinClean" BOOLEAN NOT NULL DEFAULT true,
    "turnoffCheckoutVersion" INTEGER,
    "turnoffAnswers" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squawks" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "flightId" TEXT,
    "checkoutId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "SquawkSeverity" NOT NULL DEFAULT 'NOTE',
    "status" "SquawkStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "squawks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkouts" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CheckoutKind" NOT NULL,
    "checkoutVersion" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB NOT NULL,
    "fuelOnBoardGal" DOUBLE PRECISION,
    "oilQuarts" DOUBLE PRECISION,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "flightId" TEXT,
    "squawkId" TEXT,
    "checkoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_charges" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "memberId" TEXT,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "flightId" TEXT,
    "recurringChargeId" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_tailNumber_key" ON "aircraft"("tailNumber");

-- CreateIndex
CREATE INDEX "reservations_aircraftId_startsAt_idx" ON "reservations"("aircraftId", "startsAt");

-- CreateIndex
CREATE INDEX "reservations_userId_startsAt_idx" ON "reservations"("userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "flights_reservationId_key" ON "flights"("reservationId");

-- CreateIndex
CREATE INDEX "flights_aircraftId_flownOn_idx" ON "flights"("aircraftId", "flownOn");

-- CreateIndex
CREATE INDEX "flights_userId_flownOn_idx" ON "flights"("userId", "flownOn");

-- CreateIndex
CREATE INDEX "squawks_aircraftId_status_idx" ON "squawks"("aircraftId", "status");

-- CreateIndex
CREATE INDEX "checkouts_aircraftId_kind_createdAt_idx" ON "checkouts"("aircraftId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "checkouts_userId_createdAt_idx" ON "checkouts"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "photos_key_key" ON "photos"("key");

-- CreateIndex
CREATE INDEX "photos_flightId_idx" ON "photos"("flightId");

-- CreateIndex
CREATE INDEX "photos_squawkId_idx" ON "photos"("squawkId");

-- CreateIndex
CREATE INDEX "photos_checkoutId_idx" ON "photos"("checkoutId");

-- CreateIndex
CREATE INDEX "charges_memberId_period_idx" ON "charges"("memberId", "period");

-- CreateIndex
CREATE INDEX "charges_period_idx" ON "charges"("period");

-- CreateIndex
CREATE UNIQUE INDEX "charges_memberId_recurringChargeId_period_key" ON "charges"("memberId", "recurringChargeId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "charges_flightId_kind_key" ON "charges"("flightId", "kind");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "flights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "checkouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squawks" ADD CONSTRAINT "squawks_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_squawkId_fkey" FOREIGN KEY ("squawkId") REFERENCES "squawks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_recurringChargeId_fkey" FOREIGN KEY ("recurringChargeId") REFERENCES "recurring_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
