CREATE TABLE "transaction_signing_intents" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "snapshotDigest" TEXT NOT NULL,
    "unsignedPsbtBase64" TEXT NOT NULL,
    "unsignedPsbtSha256" TEXT NOT NULL,
    "supersededById" TEXT,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_signing_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transaction_signing_intents_walletId_createdAt_idx"
    ON "transaction_signing_intents"("walletId", "createdAt");
CREATE INDEX "transaction_signing_intents_expiresAt_idx"
    ON "transaction_signing_intents"("expiresAt");

ALTER TABLE "transaction_signing_intents"
    ADD CONSTRAINT "transaction_signing_intents_snapshot_version_check"
        CHECK ("snapshotVersion" = 1),
    ADD CONSTRAINT "transaction_signing_intents_network_check"
        CHECK ("network" IN ('mainnet', 'testnet3', 'testnet4', 'signet', 'regtest')),
    ADD CONSTRAINT "transaction_signing_intents_source_check"
        CHECK ("source" IN ('standard', 'batch', 'hardware', 'rbf', 'cpfp', 'advanced_batch', 'agent', 'payjoin')),
    ADD CONSTRAINT "transaction_signing_intents_snapshot_digest_check"
        CHECK ("snapshotDigest" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "transaction_signing_intents_psbt_digest_check"
        CHECK ("unsignedPsbtSha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "transaction_signing_intents_expiry_check"
        CHECK ("expiresAt" > "createdAt");

CREATE FUNCTION "protect_transaction_signing_intent_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."walletId" IS DISTINCT FROM OLD."walletId"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."network" IS DISTINCT FROM OLD."network"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."snapshotVersion" IS DISTINCT FROM OLD."snapshotVersion"
    OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
    OR NEW."snapshotDigest" IS DISTINCT FROM OLD."snapshotDigest"
    OR NEW."unsignedPsbtBase64" IS DISTINCT FROM OLD."unsignedPsbtBase64"
    OR NEW."unsignedPsbtSha256" IS DISTINCT FROM OLD."unsignedPsbtSha256"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Transaction signing intent authorization snapshots are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transaction_signing_intents_protect_snapshot"
BEFORE UPDATE ON "transaction_signing_intents"
FOR EACH ROW
EXECUTE FUNCTION "protect_transaction_signing_intent_snapshot"();

ALTER TABLE "draft_transactions"
    ADD COLUMN "signingIntentId" TEXT,
    ADD COLUMN "signingIntentDigest" TEXT;
