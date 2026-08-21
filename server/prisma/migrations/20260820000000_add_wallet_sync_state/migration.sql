-- Expand wallet sync persistence with bounded machine-readable current state.
-- `lastSyncError` remains untouched as a readable compatibility projection;
-- later application phases will stop parsing control state from that text.
ALTER TABLE "wallets"
ADD COLUMN "syncExecutionOwner" TEXT,
ADD COLUMN "syncRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "syncNextRetryAt" TIMESTAMP(3),
ADD COLUMN "syncStartedAt" TIMESTAMP(3),
ADD COLUMN "syncStateVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastSyncFailureClass" TEXT;

ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_sync_execution_owner_check"
CHECK (
  "syncExecutionOwner" IS NULL
  OR "syncExecutionOwner" IN ('inline', 'worker')
),
ADD CONSTRAINT "wallets_sync_retry_count_check"
CHECK (
  "syncRetryCount" >= 0
  AND "syncRetryCount" <= 2147483647
),
ADD CONSTRAINT "wallets_sync_state_version_check"
CHECK (
  "syncStateVersion" >= 0
  AND "syncStateVersion" <= 2147483647
),
ADD CONSTRAINT "wallets_sync_failure_class_check"
CHECK (
  "lastSyncFailureClass" IS NULL
  OR "lastSyncFailureClass" IN (
    'electrum_unavailable',
    'node_rpc_unavailable',
    'descriptor_policy_missing',
    'canonical_evidence_missing',
    'evidence_authentication_failed',
    'lock_contention',
    'timeout',
    'sync_cancelled',
    'database_unavailable',
    'other'
  )
);

-- Every legacy `retrying` row was scheduled by the inline heap-timer path.
-- Recover only bounded decimal suffixes; malformed or hand-edited text safely
-- retains the default count instead of risking an integer-cast migration error.
UPDATE "wallets"
SET
  "syncExecutionOwner" = 'inline',
  "syncRetryCount" = LEAST(
    substring(
      "lastSyncError"
      FROM '\(retrying ([1-9][0-9]{0,9})/[1-9][0-9]{0,9}\)[[:space:]]*$'
    )::numeric,
    2147483647
  )::integer
WHERE "lastSyncStatus" = 'retrying'
  AND substring(
    "lastSyncError"
    FROM '\(retrying ([1-9][0-9]{0,9})/[1-9][0-9]{0,9}\)[[:space:]]*$'
  ) IS NOT NULL;

-- Backfill the existing support taxonomy without persisting matched text or
-- changing the readable error. Ordering mirrors the legacy first-match rules.
UPDATE "wallets"
SET "lastSyncFailureClass" = CASE
  WHEN "lastSyncError" ~* 'receive evidence|evidence authentication'
    THEN 'evidence_authentication_failed'
  WHEN "lastSyncError" ~* 'canonical'
    THEN 'canonical_evidence_missing'
  WHEN "lastSyncError" ~* 'already syncing|sync already in progress|lock held|lock_held|retry budget|lost distributed lock|lock authority'
    THEN 'lock_contention'
  WHEN "lastSyncError" ~* 'exceeded the [0-9]+s limit|was cancelled|did not respond to cancellation|operation was aborted|queue is shutting down'
    THEN 'sync_cancelled'
  WHEN "lastSyncError" ~* 'descriptor|policy'
    THEN 'descriptor_policy_missing'
  WHEN "lastSyncError" ~* 'prisma|database|connection pool|too many connections|connection terminated'
    THEN 'database_unavailable'
  WHEN "lastSyncError" ~* 'node rpc|node returned|node configuration|sync is off|bitcoind|bitcoin core'
    THEN 'node_rpc_unavailable'
  WHEN "lastSyncError" ~* 'electrum|socket error|econnrefused|econnreset|ehostunreach|enetunreach|enotfound|epipe|connection (closed|ended|not connected)|pool is shutting down|pool request queue'
    THEN 'electrum_unavailable'
  WHEN "lastSyncError" ~* 'timed out|timeout|etimedout'
    THEN 'timeout'
  ELSE 'other'
END
WHERE "lastSyncError" IS NOT NULL;

CREATE INDEX "wallets_syncExecutionOwner_syncInProgress_idx"
ON "wallets"("syncExecutionOwner", "syncInProgress");

CREATE INDEX "wallets_lastSyncStatus_syncNextRetryAt_idx"
ON "wallets"("lastSyncStatus", "syncNextRetryAt");
