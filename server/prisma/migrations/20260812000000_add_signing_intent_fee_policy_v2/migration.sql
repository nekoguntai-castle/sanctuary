ALTER TABLE "transaction_signing_intents"
    ALTER COLUMN "snapshotVersion" SET DEFAULT 2,
    DROP CONSTRAINT "transaction_signing_intents_snapshot_version_check",
    ADD CONSTRAINT "transaction_signing_intents_snapshot_version_check"
        CHECK ("snapshotVersion" IN (1, 2));
