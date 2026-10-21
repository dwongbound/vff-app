-- CreateTable
CREATE TABLE "invoice_sends" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,

    CONSTRAINT "invoice_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_sends_memberId_scope_idx" ON "invoice_sends"("memberId", "scope");

-- AddForeignKey
ALTER TABLE "invoice_sends" ADD CONSTRAINT "invoice_sends_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sends" ADD CONSTRAINT "invoice_sends_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

