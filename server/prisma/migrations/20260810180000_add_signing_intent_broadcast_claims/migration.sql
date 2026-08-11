ALTER TABLE "transaction_signing_intents"
    ADD COLUMN "broadcastState" TEXT NOT NULL DEFAULT 'ready',
    ADD COLUMN "broadcastTxid" TEXT,
    ADD COLUMN "broadcastRawTx" TEXT,
    ADD COLUMN "broadcastMetadata" JSONB,
    ADD COLUMN "broadcastLeaseToken" TEXT,
    ADD COLUMN "broadcastLeaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "broadcastAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "broadcastLastAttemptAt" TIMESTAMP(3),
    ADD COLUMN "broadcastAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "broadcastCompletedAt" TIMESTAMP(3),
    ADD COLUMN "broadcastLastError" TEXT;

CREATE INDEX "transaction_signing_intents_broadcastState_broadcastLeaseExpiresAt_idx"
    ON "transaction_signing_intents"("broadcastState", "broadcastLeaseExpiresAt");

ALTER TABLE "transaction_signing_intents"
    ADD CONSTRAINT "transaction_signing_intents_broadcast_attempt_count_check"
        CHECK ("broadcastAttemptCount" >= 0),
    ADD CONSTRAINT "transaction_signing_intents_broadcast_txid_check"
        CHECK ("broadcastTxid" IS NULL OR "broadcastTxid" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "transaction_signing_intents_broadcast_raw_tx_check"
        CHECK ("broadcastRawTx" IS NULL OR "broadcastRawTx" ~ '^(?:[0-9a-f]{2})+$'),
    ADD CONSTRAINT "transaction_signing_intents_broadcast_metadata_check"
        CHECK ("broadcastMetadata" IS NULL OR jsonb_typeof("broadcastMetadata") = 'object'),
    ADD CONSTRAINT "transaction_signing_intents_broadcast_state_check"
        CHECK (
          (
            "broadcastState" = 'ready'
            AND "consumedAt" IS NULL
            AND "broadcastTxid" IS NULL
            AND "broadcastRawTx" IS NULL
            AND "broadcastMetadata" IS NULL
            AND "broadcastLeaseToken" IS NULL
            AND "broadcastLeaseExpiresAt" IS NULL
            AND "broadcastAcceptedAt" IS NULL
            AND "broadcastCompletedAt" IS NULL
          )
          OR
          (
            "broadcastState" = 'claimed'
            AND "consumedAt" IS NULL
            AND "broadcastTxid" IS NOT NULL
            AND "broadcastRawTx" IS NOT NULL
            AND "broadcastMetadata" IS NOT NULL
            AND "broadcastLeaseToken" IS NOT NULL
            AND "broadcastLeaseExpiresAt" IS NOT NULL
            AND "broadcastAcceptedAt" IS NULL
            AND "broadcastCompletedAt" IS NULL
          )
          OR
          (
            "broadcastState" = 'unknown'
            AND "consumedAt" IS NULL
            AND "broadcastTxid" IS NOT NULL
            AND "broadcastRawTx" IS NOT NULL
            AND "broadcastMetadata" IS NOT NULL
            AND "broadcastLeaseToken" IS NULL
            AND "broadcastLeaseExpiresAt" IS NULL
            AND "broadcastAcceptedAt" IS NULL
            AND "broadcastCompletedAt" IS NULL
          )
          OR
          (
            "broadcastState" = 'accepted'
            AND "consumedAt" IS NOT NULL
            AND "broadcastTxid" IS NOT NULL
            AND "broadcastRawTx" IS NOT NULL
            AND "broadcastMetadata" IS NOT NULL
            AND "broadcastLeaseToken" IS NULL
            AND "broadcastLeaseExpiresAt" IS NULL
            AND "broadcastAcceptedAt" IS NOT NULL
            AND "broadcastCompletedAt" IS NULL
          )
          OR
          (
            "broadcastState" = 'complete'
            AND "consumedAt" IS NOT NULL
            AND "broadcastTxid" IS NOT NULL
            AND "broadcastRawTx" IS NOT NULL
            AND "broadcastMetadata" IS NOT NULL
            AND "broadcastLeaseToken" IS NULL
            AND "broadcastLeaseExpiresAt" IS NULL
            AND "broadcastAcceptedAt" IS NOT NULL
            AND "broadcastCompletedAt" IS NOT NULL
          )
        );
