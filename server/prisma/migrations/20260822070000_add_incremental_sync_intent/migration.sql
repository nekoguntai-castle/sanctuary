-- Add a durable incremental-sync compatibility floor without changing any
-- existing producer. Old binaries ignore these columns; new readers treat any
-- ambiguous legacy work as pending rather than falsely completed.
BEGIN;

ALTER TABLE "wallets"
ADD COLUMN "requestedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "claimedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "incrementalSyncLeaseToken" UUID,
ADD COLUMN "incrementalSyncClaimedAt" TIMESTAMP(3),
ADD COLUMN "incrementalSyncLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "syncActionRequiredAt" TIMESTAMP(3),
ADD COLUMN "preparedFullResyncGeneration" INTEGER NOT NULL DEFAULT 0;

-- A successful, inactive wallet is the only legacy state that proves there is
-- no unfinished incremental request. Every other non-success state retains one
-- generation of intent for the canonical worker to reconcile after cutover.
UPDATE "wallets"
SET "requestedIncrementalSyncGeneration" = 1
WHERE "lastSyncedAt" IS NULL
   OR "syncInProgress" = TRUE
   OR (
     "lastSyncStatus" IS NOT NULL
     AND "lastSyncStatus" <> 'success'
   );

-- A settled legacy failure remains pending but requires deliberate operator or
-- user action. Active/retrying work stays automatically eligible.
UPDATE "wallets"
SET "syncActionRequiredAt" = "updatedAt"
WHERE "lastSyncStatus" = 'failed'
  AND "syncInProgress" = FALSE;

-- The old processed counter was advanced by destructive preparation. Preserve
-- that fact separately, and claim rebuild completion only when a post-reset
-- successful sync left a durable lastSyncedAt checkpoint.
UPDATE "wallets"
SET
  "preparedFullResyncGeneration" = "processedFullResyncGeneration",
  "processedFullResyncGeneration" = CASE
    WHEN "lastSyncedAt" IS NOT NULL THEN "processedFullResyncGeneration"
    ELSE 0
  END;

ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_incremental_sync_generation_bounds_check"
CHECK (
  0 <= "processedIncrementalSyncGeneration"
  AND "processedIncrementalSyncGeneration" <= "claimedIncrementalSyncGeneration"
  AND "claimedIncrementalSyncGeneration" <= "requestedIncrementalSyncGeneration"
  AND "requestedIncrementalSyncGeneration" <= 2147483647
),
ADD CONSTRAINT "wallets_incremental_sync_lease_coherence_check"
CHECK (
  (
    "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
    AND "incrementalSyncLeaseToken" IS NULL
    AND "incrementalSyncClaimedAt" IS NULL
    AND "incrementalSyncLeaseExpiresAt" IS NULL
  )
  OR
  (
    "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
    AND "incrementalSyncLeaseToken" IS NOT NULL
    AND "incrementalSyncClaimedAt" IS NOT NULL
    AND "incrementalSyncLeaseExpiresAt" > "incrementalSyncClaimedAt"
  )
),
-- Keep the old processed counter independently bounded by its existing
-- constraint: v0.8.66 producers still advance it without knowing about the
-- additive prepared counter during the mixed-version window.
ADD CONSTRAINT "wallets_full_resync_preparation_bounds_check"
CHECK (
  0 <= "preparedFullResyncGeneration"
  AND "preparedFullResyncGeneration" <= "requestedFullResyncGeneration"
  AND "requestedFullResyncGeneration" <= 2147483647
);

-- Stable cursor and due-time indexes cover only unfinished, automatically
-- actionable intent. Quiet wallets never enter these indexes.
CREATE INDEX "wallets_incremental_sync_pending_cursor_idx"
ON "wallets"("id")
WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
  AND "syncActionRequiredAt" IS NULL;

CREATE INDEX "wallets_incremental_sync_retry_due_idx"
ON "wallets"("syncNextRetryAt", "id")
WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
  AND "syncActionRequiredAt" IS NULL;

CREATE INDEX "wallets_incremental_sync_lease_expiry_idx"
ON "wallets"("incrementalSyncLeaseExpiresAt", "id")
WHERE "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration";

CREATE TABLE "address_subscription_checkpoints" (
  "addressId" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "scriptHash" TEXT,
  "statusKnown" BOOLEAN NOT NULL DEFAULT FALSE,
  "observedStatus" TEXT,
  "lastObservedAt" TIMESTAMP(3),
  "requestedEnrollmentGeneration" INTEGER NOT NULL DEFAULT 1,
  "processedEnrollmentGeneration" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "address_subscription_checkpoints_pkey" PRIMARY KEY ("addressId"),
  CONSTRAINT "address_subscription_checkpoints_addressId_fkey"
    FOREIGN KEY ("addressId") REFERENCES "addresses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "address_subscription_checkpoints_enrollment_bounds_check"
    CHECK (
      0 <= "processedEnrollmentGeneration"
      AND "processedEnrollmentGeneration" <= "requestedEnrollmentGeneration"
      AND "requestedEnrollmentGeneration" <= 2147483647
    ),
  CONSTRAINT "address_subscription_checkpoints_status_coherence_check"
    CHECK (
      (
        "statusKnown" = FALSE
        AND "observedStatus" IS NULL
        AND "lastObservedAt" IS NULL
      )
      OR
      (
        "statusKnown" = TRUE
        AND "lastObservedAt" IS NOT NULL
      )
    ),
  CONSTRAINT "address_subscription_checkpoints_processed_evidence_check"
    CHECK (
      "processedEnrollmentGeneration" = 0
      OR (
        "statusKnown" = TRUE
        AND "scriptHash" IS NOT NULL
        AND "lastObservedAt" IS NOT NULL
      )
    ),
  CONSTRAINT "address_subscription_checkpoints_script_hash_check"
    CHECK (
      "scriptHash" IS NULL
      OR "scriptHash" ~ '^[0-9a-f]{64}$'
    )
);

-- Unknown is intentionally distinct from an authoritative null/no-history
-- status. The canonical subscriber will establish the first observation.
INSERT INTO "address_subscription_checkpoints" (
  "addressId",
  "network",
  "requestedEnrollmentGeneration",
  "processedEnrollmentGeneration"
)
SELECT "addresses"."id", "wallets"."network", 1, 0
FROM "addresses"
INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId";

CREATE INDEX "address_subscription_checkpoints_network_scriptHash_idx"
ON "address_subscription_checkpoints"("network", "scriptHash");

CREATE INDEX "address_subscription_checkpoints_pending_enrollment_idx"
ON "address_subscription_checkpoints"("network", "addressId")
WHERE "requestedEnrollmentGeneration" > "processedEnrollmentGeneration";

COMMIT;
