-- The airplane's Google Calendar becomes the schedule's source of truth.
--
-- A reservation can now MIRROR a Google event (`googleEventId`), which brings
-- three things the app never had to represent: an event whose creator has no
-- account here (so `userId` may be null), an all-day event, and an event's own
-- hand-typed title. See lib/googleCalendarSync.ts.
ALTER TABLE "reservations" ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "googleEventId" TEXT,
ADD COLUMN "title" TEXT;

CREATE UNIQUE INDEX "reservations_googleEventId_key" ON "reservations"("googleEventId");

-- CreateTable
CREATE TABLE "google_connections" (
    "id" TEXT NOT NULL DEFAULT 'club',
    "accountEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aircraft_calendars" (
    "aircraftId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "calendarName" TEXT,
    "syncToken" TEXT,
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aircraft_calendars_pkey" PRIMARY KEY ("aircraftId")
);

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aircraft_calendars" ADD CONSTRAINT "aircraft_calendars_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
