-- Reimbursements: money the club owes a member for something they bought for
-- it, filed by the member themselves or by the Finance Officer for them.
--
-- APPENDED to the enum, the safe kind of change: Postgres sorts an enum in
-- declaration order, and adding at the end leaves every existing line's sort
-- position alone (see 20260822010000_recurring_paybacks).
ALTER TYPE "ChargeKind" ADD VALUE 'REIMBURSEMENT';
