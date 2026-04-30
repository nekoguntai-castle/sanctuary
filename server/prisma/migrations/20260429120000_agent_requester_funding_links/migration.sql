-- Agent funding links now model requester authority, not funding-wallet signer authority.
-- Existing signer metadata is retained for legacy relationships, but new links do not
-- require the agent to be a Bitcoin signer on the funding wallet.

DROP INDEX IF EXISTS "wallet_agents_fundingWalletId_operationalWalletId_signerDeviceId_key";

ALTER TABLE "wallet_agents" DROP CONSTRAINT IF EXISTS "wallet_agents_signerDeviceId_fkey";

ALTER TABLE "wallet_agents" ALTER COLUMN "signerDeviceId" DROP NOT NULL;

ALTER TABLE "wallet_agents"
  ADD CONSTRAINT "wallet_agents_signerDeviceId_fkey"
  FOREIGN KEY ("signerDeviceId") REFERENCES "devices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "wallet_agents_fundingWalletId_operationalWalletId_key"
  ON "wallet_agents"("fundingWalletId", "operationalWalletId");
