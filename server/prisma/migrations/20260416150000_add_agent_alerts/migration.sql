-- Persist agent operational monitoring policy and alert history.

ALTER TABLE "wallet_agents" ADD COLUMN "minOperationalBalanceSats" BIGINT;
ALTER TABLE "wallet_agents" ADD COLUMN "largeOperationalSpendSats" BIGINT;
ALTER TABLE "wallet_agents" ADD COLUMN "largeOperationalFeeSats" BIGINT;
ALTER TABLE "wallet_agents" ADD COLUMN "repeatedFailureThreshold" INTEGER;
ALTER TABLE "wallet_agents" ADD COLUMN "repeatedFailureLookbackMinutes" INTEGER;
ALTER TABLE "wallet_agents" ADD COLUMN "alertDedupeMinutes" INTEGER;

CREATE TABLE "agent_alerts" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "walletId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "txid" TEXT,
    "amountSats" BIGINT,
    "feeSats" BIGINT,
    "thresholdSats" BIGINT,
    "observedCount" INTEGER,
    "reasonCode" TEXT,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "agent_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_alerts_agentId_createdAt_idx" ON "agent_alerts"("agentId", "createdAt");
CREATE INDEX "agent_alerts_agentId_status_createdAt_idx" ON "agent_alerts"("agentId", "status", "createdAt");
CREATE INDEX "agent_alerts_walletId_idx" ON "agent_alerts"("walletId");
CREATE INDEX "agent_alerts_type_idx" ON "agent_alerts"("type");
CREATE INDEX "agent_alerts_txid_idx" ON "agent_alerts"("txid");
CREATE INDEX "agent_alerts_dedupeKey_idx" ON "agent_alerts"("dedupeKey");

ALTER TABLE "agent_alerts" ADD CONSTRAINT "agent_alerts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "wallet_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
