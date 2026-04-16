-- Create agent wallet metadata and scoped API keys for funding-draft submission.

CREATE TABLE "wallet_agents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "fundingWalletId" TEXT NOT NULL,
    "operationalWalletId" TEXT NOT NULL,
    "signerDeviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "wallet_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_api_keys" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scope" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "lastUsedAgent" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "agent_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_agents_fundingWalletId_operationalWalletId_signerDeviceId_key" ON "wallet_agents"("fundingWalletId", "operationalWalletId", "signerDeviceId");
CREATE INDEX "wallet_agents_userId_idx" ON "wallet_agents"("userId");
CREATE INDEX "wallet_agents_status_idx" ON "wallet_agents"("status");
CREATE INDEX "wallet_agents_fundingWalletId_idx" ON "wallet_agents"("fundingWalletId");
CREATE INDEX "wallet_agents_operationalWalletId_idx" ON "wallet_agents"("operationalWalletId");
CREATE INDEX "wallet_agents_signerDeviceId_idx" ON "wallet_agents"("signerDeviceId");
CREATE INDEX "wallet_agents_revokedAt_idx" ON "wallet_agents"("revokedAt");

CREATE UNIQUE INDEX "agent_api_keys_keyHash_key" ON "agent_api_keys"("keyHash");
CREATE INDEX "agent_api_keys_agentId_idx" ON "agent_api_keys"("agentId");
CREATE INDEX "agent_api_keys_expiresAt_idx" ON "agent_api_keys"("expiresAt");
CREATE INDEX "agent_api_keys_revokedAt_idx" ON "agent_api_keys"("revokedAt");

ALTER TABLE "wallet_agents" ADD CONSTRAINT "wallet_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_agents" ADD CONSTRAINT "wallet_agents_fundingWalletId_fkey" FOREIGN KEY ("fundingWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_agents" ADD CONSTRAINT "wallet_agents_operationalWalletId_fkey" FOREIGN KEY ("operationalWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_agents" ADD CONSTRAINT "wallet_agents_signerDeviceId_fkey" FOREIGN KEY ("signerDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "wallet_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
