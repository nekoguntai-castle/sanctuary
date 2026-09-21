import type { PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';

const TRANSACTION_PATCH_FIELDS = new Set([
  'addressId',
  'amount',
  'blockHeight',
  'blockTime',
  'confirmations',
  'counterpartyAddress',
  'fee',
  'rbfStatus',
]);

function serializeTransactionFieldPatches(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
): string {
  for (const update of updates) {
    for (const field of Object.keys(update.data)) {
      if (!TRANSACTION_PATCH_FIELDS.has(field)) {
        throw new Error(`Unsupported transaction batch-update field: ${field}`);
      }
    }
  }
  return JSON.stringify(updates, (_key, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ));
}

/**
 * Apply one heterogeneous field-update chunk with one PostgreSQL round trip.
 * RBF membership changes and multirow chunks first acquire wallet advisory
 * locks, serializing them with full balance recalculation before they take row
 * locks. Single-row routine field patches keep one database round trip.
 * Wallets are deduplicated before repair admission, and live-to-live status
 * changes avoid unnecessary full-wallet recalculation.
 * The final completeness expression deliberately raises a descriptive cast
 * error if any requested row vanished, rolling back that chunk. Its repair
 * count reference forces PostgreSQL to run the materialized repair CTE even
 * though callers do not consume its result.
 */
export async function executeTransactionFieldPatch(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  client: PrismaTxClient,
): Promise<void> {
  const patches = serializeTransactionFieldPatches(updates);
  if (
    updates.length > 1
    || updates.some(update => Object.prototype.hasOwnProperty.call(update.data, 'rbfStatus'))
  ) {
    await client.$executeRaw(Prisma.sql`
      WITH patches AS (
        SELECT "id", "data"
        FROM jsonb_to_recordset(${patches}::JSONB) AS patch("id" TEXT, "data" JSONB)
      ), target_wallets AS MATERIALIZED (
        -- Ordering wallet ids makes overlapping multi-wallet chunks acquire
        -- the shared advisory locks consistently.
        SELECT DISTINCT transaction."walletId"
        FROM "transactions" AS transaction
        INNER JOIN patches ON patches."id" = transaction."id"
        WHERE ${updates.length > 1}
          OR (transaction."rbfStatus" = 'replaced') IS DISTINCT FROM
             ((patches."data" ->> 'rbfStatus') = 'replaced')
        ORDER BY transaction."walletId"
      ), previous_lock_timeout AS MATERIALIZED (
        SELECT current_setting('lock_timeout') AS value
      ), lock_budget AS MATERIALIZED (
        -- Thirty seconds leaves headroom inside the clientless transaction's
        -- 60-second callback budget; a lower statement_timeout still wins.
        SELECT set_config('lock_timeout', '30000', true) AS configured
        FROM previous_lock_timeout
      ), acquired_locks AS MATERIALIZED (
        -- Salt 0 is shared with recalculateBalancesAtomically. Materialization
        -- makes every target lock complete before the prior timeout is restored.
        SELECT pg_advisory_xact_lock(hashtextextended("walletId", 0)) AS acquired
        FROM target_wallets
        CROSS JOIN lock_budget
      ), restored_timeout AS MATERIALIZED (
        SELECT set_config('lock_timeout', previous_lock_timeout.value, true) AS restored
        FROM previous_lock_timeout
        CROSS JOIN (SELECT COUNT(*) FROM acquired_locks) lock_count
      )
      SELECT restored FROM restored_timeout
    `);
  }
  await client.$executeRaw(Prisma.sql`
    WITH patches AS (
      SELECT "id", "data"
      FROM jsonb_to_recordset(${patches}::JSONB) AS patch("id" TEXT, "data" JSONB)
    ), locked AS MATERIALIZED (
      SELECT transaction."id", transaction."rbfStatus"
      FROM "transactions" AS transaction
      INNER JOIN patches ON patches."id" = transaction."id"
      ORDER BY transaction."blockTime" ASC,
               transaction."createdAt" ASC,
               transaction."id" ASC
      FOR UPDATE OF transaction
    ), updated AS (
    UPDATE "transactions" AS transaction
    SET "addressId" = CASE WHEN patches."data" ? 'addressId'
          THEN patches."data" ->> 'addressId' ELSE transaction."addressId" END,
        "amount" = CASE WHEN patches."data" ? 'amount'
          THEN (patches."data" ->> 'amount')::BIGINT ELSE transaction."amount" END,
        "blockHeight" = CASE WHEN patches."data" ? 'blockHeight'
          THEN (patches."data" ->> 'blockHeight')::INTEGER ELSE transaction."blockHeight" END,
        "blockTime" = CASE WHEN patches."data" ? 'blockTime'
          THEN (patches."data" ->> 'blockTime')::TIMESTAMP(3) ELSE transaction."blockTime" END,
        "confirmations" = CASE WHEN patches."data" ? 'confirmations'
          THEN (patches."data" ->> 'confirmations')::INTEGER ELSE transaction."confirmations" END,
        "counterpartyAddress" = CASE WHEN patches."data" ? 'counterpartyAddress'
          THEN patches."data" ->> 'counterpartyAddress' ELSE transaction."counterpartyAddress" END,
        "fee" = CASE WHEN patches."data" ? 'fee'
          THEN (patches."data" ->> 'fee')::BIGINT ELSE transaction."fee" END,
        "rbfStatus" = CASE WHEN patches."data" ? 'rbfStatus'
          THEN patches."data" ->> 'rbfStatus' ELSE transaction."rbfStatus" END,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM patches
    INNER JOIN locked ON locked."id" = patches."id"
    WHERE transaction."id" = patches."id"
    RETURNING transaction."walletId",
      patches."data" ? 'rbfStatus'
      AND (locked."rbfStatus" = 'replaced') IS DISTINCT FROM
          ((patches."data" ->> 'rbfStatus') = 'replaced')
      AS "liveMembershipChanged"
    ), repaired_wallets AS (
      SELECT DISTINCT "walletId"
      FROM updated
      WHERE "liveMembershipChanged"
    ), repairs AS MATERIALIZED (
      SELECT "queue_wallet_balance_repair"("walletId")
      FROM repaired_wallets
    ), completeness AS (
      SELECT CASE WHEN COUNT(*) = ${updates.length} THEN 1 ELSE
        ('transaction patch target count mismatch: expected '
          || ${updates.length}::TEXT || ', updated ' || COUNT(*)::TEXT)::INTEGER
      END AS value
      FROM updated
    )
    SELECT completeness.value,
           (SELECT COUNT(*) FROM repairs) AS "repairCount"
    FROM completeness
  `);
}
