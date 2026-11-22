-- CreateTable
CREATE TABLE "airports" (
    "code" TEXT NOT NULL,
    "landingFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("code")
);

-- The club's home field, at the fee the code used to hard-wire.
INSERT INTO "airports" ("code", "landingFeeCents", "updatedAt")
VALUES ('KTOA', 600, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
