-- Add agent funding policy controls and metadata linking drafts back to agents.

ALTER TABLE "wallet_agents"
ADD COLUMN "maxFundingAmountSats" BIGINT,
ADD COLUMN "maxOperationalBalanceSats" BIGINT,
ADD COLUMN "dailyFundingLimitSats" BIGINT,
ADD COLUMN "weeklyFundingLimitSats" BIGINT,
ADD COLUMN "cooldownMinutes" INTEGER,
ADD COLUMN "requireHumanApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyOnOperationalSpend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "pauseOnUnexpectedSpend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastFundingDraftAt" TIMESTAMP(3);

ALTER TABLE "draft_transactions"
ADD COLUMN "agentId" TEXT,
ADD COLUMN "agentOperationalWalletId" TEXT;

CREATE INDEX "wallet_agents_lastFundingDraftAt_idx" ON "wallet_agents"("lastFundingDraftAt");
CREATE INDEX "draft_transactions_agentId_createdAt_idx" ON "draft_transactions"("agentId", "createdAt");
CREATE INDEX "draft_transactions_agentOperationalWalletId_idx" ON "draft_transactions"("agentOperationalWalletId");
