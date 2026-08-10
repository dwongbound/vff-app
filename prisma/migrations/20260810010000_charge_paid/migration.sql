-- Marking a statement line as settled.
--
-- Distinct from `voided`, which already exists and means something else: a
-- voided line should never have stood, while a paid one stood and has been
-- met. Both stay on the statement — the club's books are append-mostly on
-- purpose — but only voiding changes what was charged. Paying changes what is
-- OUTSTANDING, which is the number the Finance Officer actually reads.
--
-- `paidById` records who ticked it off, and is SET NULL rather than cascading:
-- a member leaving the club must not take the payment record with them.
--
-- Purely additive. Every existing line comes out unpaid, which is the honest
-- reading of a database that has never recorded a payment.
ALTER TABLE "charges" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidById" TEXT;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
