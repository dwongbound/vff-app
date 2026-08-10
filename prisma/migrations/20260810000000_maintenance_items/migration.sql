-- What the airplane is due for: the annual, the oil change, the pitot-static
-- and transponder checks, the ELT.
--
-- The club has kept this on a spreadsheet whose ten columns are all arithmetic
-- on four facts — how long an item is good for (hours, calendar months) and
-- when it was last done (at what tach, on what date). Only those four are
-- stored here. Hours remaining, days remaining, tach due, date due and "which
-- item is next" are derived in lib/maintenance.ts, because a stored countdown
-- is wrong by one the morning after it's written.
--
-- Purely additive: a new type, a new table, no existing row touched. An
-- airplane with no rows here simply has nothing tracked, which is what every
-- airplane in an existing database starts as until the club types its sheet in.

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('INSPECTION', 'EQUIPMENT');

-- CreateTable
CREATE TABLE "maintenance_items" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'INSPECTION',
    "requiredByReg" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "intervalHours" DOUBLE PRECISION,
    "intervalMonths" INTEGER,
    "lastDoneTach" DOUBLE PRECISION,
    "lastDoneOn" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_items_aircraftId_active_idx" ON "maintenance_items"("aircraftId", "active");

-- AddForeignKey
ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
