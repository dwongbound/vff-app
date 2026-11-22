-- Members › Remove: a soft delete. See the comment on User.removedAt.
ALTER TABLE "users" ADD COLUMN "removedAt" TIMESTAMP(3),
ADD COLUMN "removedById" TEXT;
