-- Wallet-scoped usage windows used NULL userId values. PostgreSQL treats NULL
-- values as distinct in normal unique indexes, so concurrent wallet-scoped
-- creates could split policy spend across duplicate rows. Move wallet-scoped
-- rows to a reserved non-user UUID so the existing composite unique index
-- enforces one window for both user-scoped and wallet-scoped limits.

WITH wallet_window_groups AS (
    SELECT
        COALESCE(
            MIN("id") FILTER (WHERE "userId" = '00000000-0000-0000-0000-000000000000'),
            MIN("id")
        ) AS "keepId",
        "policyId",
        "walletId",
        "windowType",
        "windowStart",
        SUM("totalSpent")::bigint AS "totalSpent",
        SUM("txCount")::integer AS "txCount",
        MAX("windowEnd") AS "windowEnd"
    FROM "policy_usage_windows"
    WHERE "userId" IS NULL
       OR "userId" = '00000000-0000-0000-0000-000000000000'
    GROUP BY "policyId", "walletId", "windowType", "windowStart"
    HAVING COUNT(*) > 1
),
merged_wallet_windows AS (
    UPDATE "policy_usage_windows" AS target
       SET "userId" = '00000000-0000-0000-0000-000000000000',
           "totalSpent" = wallet_window_groups."totalSpent",
           "txCount" = wallet_window_groups."txCount",
           "windowEnd" = wallet_window_groups."windowEnd",
           "updatedAt" = CURRENT_TIMESTAMP
      FROM wallet_window_groups
     WHERE target."id" = wallet_window_groups."keepId"
    RETURNING target."id"
)
DELETE FROM "policy_usage_windows" AS duplicate
USING wallet_window_groups
WHERE (duplicate."userId" IS NULL
       OR duplicate."userId" = '00000000-0000-0000-0000-000000000000')
  AND duplicate."policyId" = wallet_window_groups."policyId"
  AND duplicate."walletId" = wallet_window_groups."walletId"
  AND duplicate."windowType" = wallet_window_groups."windowType"
  AND duplicate."windowStart" = wallet_window_groups."windowStart"
  AND duplicate."id" <> wallet_window_groups."keepId";

UPDATE "policy_usage_windows"
   SET "userId" = '00000000-0000-0000-0000-000000000000',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "userId" IS NULL;

ALTER TABLE "policy_usage_windows"
    ALTER COLUMN "userId" SET DEFAULT '00000000-0000-0000-0000-000000000000',
    ALTER COLUMN "userId" SET NOT NULL;
