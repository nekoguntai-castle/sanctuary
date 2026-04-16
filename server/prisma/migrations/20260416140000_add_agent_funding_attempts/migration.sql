-- Record agent funding attempts for monitoring and repeated-failure alerts.

CREATE TABLE "agent_funding_attempts" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "keyId" TEXT,
    "keyPrefix" TEXT,
    "fundingWalletId" TEXT NOT NULL,
    "operationalWalletId" TEXT,
    "draftId" TEXT,
    "status" TEXT NOT NULL,
    "reasonCode" TEXT,
    "reasonMessage" TEXT,
    "amount" BIGINT,
    "feeRate" DOUBLE PRECISION,
    "recipient" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_funding_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_funding_attempts_agentId_createdAt_idx" ON "agent_funding_attempts"("agentId", "createdAt");
CREATE INDEX "agent_funding_attempts_agentId_status_createdAt_idx" ON "agent_funding_attempts"("agentId", "status", "createdAt");
CREATE INDEX "agent_funding_attempts_reasonCode_idx" ON "agent_funding_attempts"("reasonCode");
CREATE INDEX "agent_funding_attempts_draftId_idx" ON "agent_funding_attempts"("draftId");

ALTER TABLE "agent_funding_attempts" ADD CONSTRAINT "agent_funding_attempts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "wallet_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
