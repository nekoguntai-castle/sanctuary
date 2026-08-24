-- Durable per-network chain-tip progress.
--
-- Keyed by the network itself: this is the first table whose identity is a
-- network rather than a wallet or an address. Absence of a row means UNKNOWN,
-- never "the tip is current", so a freshly migrated database reconciles rather
-- than reading as covered.
--
-- The CHECK constraints mirror the style of address_subscription_checkpoints in
-- 20260822070000_add_incremental_sync_intent: the database refuses malformed
-- chain data even if an application path ever stops validating it.
BEGIN;

ALTER TABLE "address_subscription_checkpoints"
ADD COLUMN "coverageGapStartedAt" TIMESTAMP(3);

UPDATE "address_subscription_checkpoints"
SET "coverageGapStartedAt" = address."createdAt"
FROM "addresses" AS address
WHERE address."id" = "address_subscription_checkpoints"."addressId"
  AND (
    "address_subscription_checkpoints"."statusKnown" = FALSE
    OR "address_subscription_checkpoints"."processedEnrollmentGeneration"
      < "address_subscription_checkpoints"."requestedEnrollmentGeneration"
  );

ALTER TABLE "address_subscription_checkpoints"
ALTER COLUMN "coverageGapStartedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Normalize both new and compatibility-floor writers. Older workers do not
-- know this column: a request must still open a gap, while any exact settled
-- completion must close it during a rolling deployment.
CREATE FUNCTION "normalize_address_subscription_coverage_gap"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."statusKnown" = TRUE
    AND NEW."processedEnrollmentGeneration" = NEW."requestedEnrollmentGeneration" THEN
    NEW."coverageGapStartedAt" := NULL;
  ELSIF NEW."coverageGapStartedAt" IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW."coverageGapStartedAt" := CURRENT_TIMESTAMP;
    ELSE
      NEW."coverageGapStartedAt" := COALESCE(
        OLD."coverageGapStartedAt",
        CURRENT_TIMESTAMP
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "normalize_address_subscription_coverage_gap"
BEFORE INSERT OR UPDATE ON "address_subscription_checkpoints"
FOR EACH ROW
EXECUTE FUNCTION "normalize_address_subscription_coverage_gap"();

ALTER TABLE "address_subscription_checkpoints"
ADD CONSTRAINT "address_subscription_checkpoints_coverage_gap_check"
CHECK (
  (
    "statusKnown" = TRUE
    AND "processedEnrollmentGeneration" = "requestedEnrollmentGeneration"
    AND "coverageGapStartedAt" IS NULL
  )
  OR
  (
    (
      "statusKnown" = FALSE
      OR "processedEnrollmentGeneration" < "requestedEnrollmentGeneration"
    )
    AND "coverageGapStartedAt" IS NOT NULL
  )
);

CREATE TABLE "address_subscription_comparison_failures" (
  "addressId" TEXT NOT NULL,
  "enrollmentGeneration" INTEGER NOT NULL,
  "firstFailedAt" TIMESTAMP(3) NOT NULL,
  "lastFailedAt" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "address_subscription_comparison_failures_pkey" PRIMARY KEY ("addressId"),
  CONSTRAINT "address_subscription_comparison_failures_addressId_fkey"
    FOREIGN KEY ("addressId") REFERENCES "address_subscription_checkpoints"("addressId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "address_subscription_failure_generation_bounds_check"
    CHECK ("enrollmentGeneration" >= 1 AND "enrollmentGeneration" <= 2147483647),
  CONSTRAINT "address_subscription_failure_attempt_bounds_check"
    CHECK ("attemptCount" >= 1 AND "attemptCount" <= 2147483647),
  CONSTRAINT "address_subscription_failure_time_order_check"
    CHECK ("lastFailedAt" >= "firstFailedAt")
);

CREATE TABLE "network_subscription_coverage_state" (
  "network" TEXT NOT NULL,
  "historicalComparisonFailureCount" INTEGER NOT NULL DEFAULT 0,
  "firstComparisonFailureAt" TIMESTAMP(3),
  "lastComparisonFailureAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "network_subscription_coverage_state_pkey" PRIMARY KEY ("network"),
  CONSTRAINT "network_subscription_coverage_count_bounds_check"
    CHECK (
      "historicalComparisonFailureCount" >= 0
      AND "historicalComparisonFailureCount" <= 2147483647
    ),
  CONSTRAINT "network_subscription_coverage_history_coherence_check"
    CHECK (
      (
        "historicalComparisonFailureCount" = 0
        AND "firstComparisonFailureAt" IS NULL
        AND "lastComparisonFailureAt" IS NULL
      )
      OR
      (
        "historicalComparisonFailureCount" > 0
        AND "firstComparisonFailureAt" IS NOT NULL
        AND "lastComparisonFailureAt" IS NOT NULL
        AND "lastComparisonFailureAt" >= "firstComparisonFailureAt"
      )
    )
);

CREATE TABLE "network_header_checkpoints" (
  "network" TEXT NOT NULL,
  "lastProcessedHeight" INTEGER NOT NULL,
  "lastProcessedHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "coverageGapStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "network_header_checkpoints_pkey" PRIMARY KEY ("network"),
  -- Block hashes are the reversed double-SHA256 of an 80-byte header: exactly
  -- 64 lowercase hex characters, as produced by hashBlockHeader().
  CONSTRAINT "network_header_checkpoints_hash_format_check"
    CHECK ("lastProcessedHash" ~ '^[0-9a-f]{64}$'),
  -- Genesis is height 0; a negative height is never a real observation.
  CONSTRAINT "network_header_checkpoints_height_bounds_check"
    CHECK ("lastProcessedHeight" >= 0 AND "lastProcessedHeight" <= 2147483647)
);

COMMIT;
