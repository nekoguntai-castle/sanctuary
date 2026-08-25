-- Resumable, generation-fenced per-network header reconciliation.
--
-- The authoritative checkpoint is intentionally not used as a page cursor:
-- only a completely validated target whose confirmation refresh succeeded may
-- replace it. These operational rows survive process/database restarts but are
-- not authoritative backup state; a restore rediscovers the live tip.
BEGIN;

CREATE TABLE "network_header_reconciliations" (
  "network" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "ownerToken" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "targetHeight" INTEGER NOT NULL,
  "targetHash" TEXT NOT NULL,
  "targetHeaderHex" TEXT NOT NULL,
  "targetObservedAt" TIMESTAMP(3) NOT NULL,
  "anchorHeight" INTEGER NOT NULL,
  "anchorHash" TEXT NOT NULL,
  "cursorHeight" INTEGER,
  "cursorHash" TEXT,
  "confirmationCursorWalletId" TEXT,
  "confirmationEnumerationComplete" BOOLEAN NOT NULL DEFAULT false,
  "pendingTargetHeight" INTEGER,
  "pendingTargetHash" TEXT,
  "pendingTargetPreviousHash" TEXT,
  "pendingTargetHeaderHex" TEXT,
  "pendingTargetObservedAt" TIMESTAMP(3),
  "pendingTargetGenesisHash" TEXT,
  "gapStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastFailureClass" TEXT,
  "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
  "retryEligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "network_header_reconciliations_pkey" PRIMARY KEY ("network"),
  CONSTRAINT "network_header_reconciliations_generation_check"
    CHECK ("generation" >= 1 AND "generation" <= 2147483647),
  CONSTRAINT "network_header_reconciliations_failure_count_check"
    CHECK ("consecutiveFailureCount" >= 0 AND "consecutiveFailureCount" <= 30),
  CONSTRAINT "network_header_reconciliations_mode_check"
    CHECK ("mode" IN ('forward', 'ancestor_search', 'genesis_rebuild')),
  CONSTRAINT "network_header_reconciliations_height_check"
    CHECK (
      "targetHeight" >= 0 AND "targetHeight" <= 2147483647
      AND "anchorHeight" >= 0 AND "anchorHeight" <= 2147483647
      AND ("cursorHeight" IS NULL OR ("cursorHeight" >= 0 AND "cursorHeight" <= 2147483647))
    ),
  CONSTRAINT "network_header_reconciliations_hash_check"
    CHECK (
      "targetHash" ~ '^[0-9a-f]{64}$'
      AND "anchorHash" ~ '^[0-9a-f]{64}$'
      AND ("cursorHash" IS NULL OR "cursorHash" ~ '^[0-9a-f]{64}$')
    ),
  CONSTRAINT "network_header_reconciliations_header_check"
    CHECK ("targetHeaderHex" ~ '^[0-9A-Fa-f]{160}$'),
  CONSTRAINT "network_header_reconciliations_confirmation_cursor_check"
    CHECK (
      "confirmationCursorWalletId" IS NULL
      OR length("confirmationCursorWalletId") BETWEEN 1 AND 200
    ),
  CONSTRAINT "network_header_reconciliations_pending_target_check"
    CHECK (
      ("pendingTargetHeight" IS NULL)
      = ("pendingTargetHash" IS NULL)
      AND ("pendingTargetHeight" IS NULL)
      = ("pendingTargetPreviousHash" IS NULL)
      AND ("pendingTargetHeight" IS NULL)
      = ("pendingTargetHeaderHex" IS NULL)
      AND ("pendingTargetHeight" IS NULL)
      = ("pendingTargetObservedAt" IS NULL)
      AND ("pendingTargetHeight" IS NULL)
      = ("pendingTargetGenesisHash" IS NULL)
      AND (
        "pendingTargetHeight" IS NULL
        OR (
          "cursorHeight" = "targetHeight"
          AND "cursorHash" = "targetHash"
          AND "pendingTargetHeight" >= 0
          AND "pendingTargetHeight" <= 2147483647
          AND "pendingTargetHash" ~ '^[0-9a-f]{64}$'
          AND "pendingTargetPreviousHash" ~ '^[0-9a-f]{64}$'
          AND "pendingTargetGenesisHash" ~ '^[0-9a-f]{64}$'
          AND "pendingTargetHeaderHex" ~ '^[0-9A-Fa-f]{160}$'
        )
      )
    ),
  CONSTRAINT "network_header_reconciliations_cursor_check"
    CHECK (
      ("cursorHeight" IS NULL) = ("cursorHash" IS NULL)
      AND (
        "cursorHeight" IS NULL
        OR (
          "cursorHeight" <= "targetHeight"
          AND ("cursorHeight" < "targetHeight" OR "cursorHash" = "targetHash")
        )
      )
    ),
  CONSTRAINT "network_header_reconciliations_failure_check"
    CHECK (
      "lastFailureClass" IS NULL
      OR "lastFailureClass" IN (
        'endpoint_unavailable',
        'validation_failed',
        'confirmation_failed',
        'ownership_lost'
      )
    )
);

CREATE INDEX "network_header_reconciliations_retryEligibleAt_network_idx"
ON "network_header_reconciliations"("retryEligibleAt", "network");

CREATE TABLE "network_header_confirmation_retries" (
  "network" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "network_header_confirmation_retries_pkey" PRIMARY KEY ("network", "walletId"),
  CONSTRAINT "network_header_confirmation_retries_network_fkey"
    FOREIGN KEY ("network") REFERENCES "network_header_reconciliations"("network")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "network_header_confirmation_retries_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "network_header_confirmation_retries_network_walletId_idx"
ON "network_header_confirmation_retries"("network", "walletId");

CREATE INDEX "network_header_confirmation_retries_walletId_idx"
ON "network_header_confirmation_retries"("walletId");

CREATE TABLE "network_header_reconciliation_headers" (
  "network" TEXT NOT NULL,
  "height" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "previousHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "network_header_reconciliation_headers_pkey" PRIMARY KEY ("network", "height"),
  CONSTRAINT "network_header_reconciliation_headers_network_fkey"
    FOREIGN KEY ("network") REFERENCES "network_header_reconciliations"("network")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "network_header_reconciliation_headers_height_check"
    CHECK ("height" >= 0 AND "height" <= 2147483647),
  CONSTRAINT "network_header_reconciliation_headers_hash_check"
    CHECK ("hash" ~ '^[0-9a-f]{64}$' AND "previousHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "network_header_history" (
  "network" TEXT NOT NULL,
  "height" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "previousHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "network_header_history_pkey" PRIMARY KEY ("network", "height"),
  CONSTRAINT "network_header_history_height_check"
    CHECK ("height" >= 0 AND "height" <= 2147483647),
  CONSTRAINT "network_header_history_hash_check"
    CHECK ("hash" ~ '^[0-9a-f]{64}$' AND "previousHash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "network_header_history_network_hash_idx"
ON "network_header_history"("network", "hash");

COMMIT;
