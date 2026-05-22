-- Wallet-scoped outbound webhook endpoints and durable delivery outbox.
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[] NOT NULL,
    "filters" JSONB,
    "payloadProfile" TEXT NOT NULL DEFAULT 'sanctuary_wallet_event_v1',
    "authType" TEXT NOT NULL DEFAULT 'none',
    "secretEncrypted" TEXT,
    "headerConfig" JSONB,
    "profileConfig" JSONB,
    "retryConfig" JSONB,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "failureNotificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "lastDeliveryStatus" TEXT,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadProfile" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "eventPayload" JSONB NOT NULL,
    "requestBody" JSONB,
    "requestBodyHash" TEXT,
    "requestHeadersRedacted" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "responseBodyHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_walletId_idx" ON "webhook_endpoints"("walletId");
CREATE INDEX "webhook_endpoints_walletId_enabled_idx" ON "webhook_endpoints"("walletId", "enabled");
CREATE INDEX "webhook_endpoints_payloadProfile_idx" ON "webhook_endpoints"("payloadProfile");

CREATE UNIQUE INDEX "webhook_deliveries_endpointId_eventId_payloadProfile_key"
    ON "webhook_deliveries"("endpointId", "eventId", "payloadProfile");
CREATE INDEX "webhook_deliveries_walletId_idx" ON "webhook_deliveries"("walletId");
CREATE INDEX "webhook_deliveries_endpointId_idx" ON "webhook_deliveries"("endpointId");
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");
CREATE INDEX "webhook_deliveries_eventId_idx" ON "webhook_deliveries"("eventId");

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
