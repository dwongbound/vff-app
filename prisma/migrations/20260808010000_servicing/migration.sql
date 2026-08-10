-- Fuel and oil put into the airplane on its own, with no flight attached.
--
-- Servicing already existed on Flight (fuelAddedGal / fuelCostCents /
-- oilAddedQts) for the after-you-land case. This is the same fact for the
-- before-you-fly one, which had nowhere to go — and a pilot who has to invent
-- a flight to record a fill-up records fewer fill-ups.
--
-- `paidPersonally` is the club sheet's "Fuel Purchase Personal Card" column,
-- finally modelled: only a member's own card produces a credit. It defaults to
-- true because that's the case where somebody is owed money, and a default
-- that quietly swallows a debt is the worse of the two mistakes.
--
-- Purely additive: every existing row is untouched, and `charges.servicingId`
-- is null for every charge that already exists (all of which came from a
-- flight or a recurring rule).
ALTER TABLE "charges" ADD COLUMN     "servicingId" TEXT;

-- CreateTable
CREATE TABLE "servicing" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "servicedAt" TIMESTAMP(3) NOT NULL,
    "fuelAddedGal" DOUBLE PRECISION,
    "fuelCostCents" INTEGER,
    "oilAddedQts" DOUBLE PRECISION,
    "paidPersonally" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servicing_aircraftId_servicedAt_idx" ON "servicing"("aircraftId", "servicedAt");

-- One FUEL_CREDIT per fill-up, the same idempotency the flight-derived lines
-- get. Postgres treats NULLs as distinct, so this constrains only the rows
-- that actually came from a fill-up.
CREATE UNIQUE INDEX "charges_servicingId_kind_key" ON "charges"("servicingId", "kind");

-- AddForeignKey
ALTER TABLE "servicing" ADD CONSTRAINT "servicing_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicing" ADD CONSTRAINT "servicing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_servicingId_fkey" FOREIGN KEY ("servicingId") REFERENCES "servicing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
