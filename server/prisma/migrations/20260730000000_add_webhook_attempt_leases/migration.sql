-- Fence concurrent webhook workers while keeping due deliveries recoverable.
ALTER TABLE "webhook_deliveries"
  ADD COLUMN "attemptLeaseToken" TEXT,
  ADD COLUMN "attemptLeaseExpiresAt" TIMESTAMP(3);
