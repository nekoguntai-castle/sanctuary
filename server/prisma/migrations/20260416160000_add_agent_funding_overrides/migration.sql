-- Human-created exceptional funding windows for linked wallet agents.
CREATE TABLE "agent_funding_overrides" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "fundingWalletId" TEXT NOT NULL,
  "operationalWalletId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "reason" TEXT NOT NULL,
  "maxAmountSats" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "usedAt" TIMESTAMP(3),
  "usedDraftId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_funding_overrides_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_funding_overrides"
  ADD CONSTRAINT "agent_funding_overrides_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "wallet_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "agent_funding_overrides_agentId_status_expiresAt_idx"
  ON "agent_funding_overrides"("agentId", "status", "expiresAt");

CREATE INDEX "agent_funding_overrides_fundingWalletId_idx"
  ON "agent_funding_overrides"("fundingWalletId");

CREATE INDEX "agent_funding_overrides_operationalWalletId_idx"
  ON "agent_funding_overrides"("operationalWalletId");

CREATE INDEX "agent_funding_overrides_createdByUserId_idx"
  ON "agent_funding_overrides"("createdByUserId");

CREATE INDEX "agent_funding_overrides_usedDraftId_idx"
  ON "agent_funding_overrides"("usedDraftId");
