import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';
import { ADDRESS_SYNC_IO_UPSERT_MAX_ROWS } from '../../constants/addressSyncPersistence';

const deduplicateTransactions = (
  transactions: Array<{ id: string; txid: string }>,
): Array<{ id: string; txid: string }> => (
  [...new Map(transactions.map(transaction => [transaction.id, transaction])).values()]
);

/**
 * Reconcile pending replacements entirely inside PostgreSQL. Each statement
 * updates at most one persistence chunk, so a maximum-input transaction never
 * returns or clones its input graph in the worker isolate.
 */
export async function reconcilePendingRbfForConfirmedTransactions(
  walletId: string,
  confirmedTransactions: Array<{ id: string; txid: string }>,
  client: PrismaTxClient = prisma,
  assertActive: () => void = () => undefined,
): Promise<number> {
  const confirmed = deduplicateTransactions(confirmedTransactions);
  if (confirmed.length === 0) return 0;
  const authenticatedValues = confirmed.map(transaction => Prisma.sql`(
    ${transaction.id}::text,
    ${transaction.txid}::text
  )`);

  let updatedCount = 0;
  for (;;) {
    assertActive();
    const rows = await client.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      WITH replacement_candidates AS (
        SELECT DISTINCT ON (pending."id")
          pending."id",
          authenticated."txid" AS "replacementTxid"
        FROM (VALUES ${Prisma.join(authenticatedValues)}) AS authenticated("id", "txid")
        INNER JOIN "transactions" AS confirmed
          ON confirmed."id" = authenticated."id"
          AND confirmed."txid" = authenticated."txid"
        INNER JOIN "transaction_inputs" AS confirmed_input
          ON confirmed_input."transactionId" = confirmed."id"
        INNER JOIN "transaction_inputs" AS pending_input
          ON pending_input."txid" = confirmed_input."txid"
          AND pending_input."vout" = confirmed_input."vout"
        INNER JOIN "transactions" AS pending
          ON pending."id" = pending_input."transactionId"
        WHERE confirmed."walletId" = ${walletId}
          AND pending."walletId" = ${walletId}
          AND pending."confirmations" = 0
          AND pending."rbfStatus" = 'active'
          AND pending."id" <> confirmed."id"
          AND pending."txid" <> confirmed."txid"
        ORDER BY pending."id", authenticated."txid"
        LIMIT ${ADDRESS_SYNC_IO_UPSERT_MAX_ROWS}
      ), updated AS (
        UPDATE "transactions" AS pending
        SET "rbfStatus" = 'replaced',
            "replacedByTxid" = replacement_candidates."replacementTxid",
            "updatedAt" = CURRENT_TIMESTAMP
        FROM replacement_candidates
        WHERE pending."id" = replacement_candidates."id"
        RETURNING pending."id"
      )
      SELECT COUNT(*)::integer AS "count" FROM updated
    `);
    assertActive();
    const chunkCount = Number(rows[0]?.count ?? 0);
    updatedCount += chunkCount;
    if (chunkCount < ADDRESS_SYNC_IO_UPSERT_MAX_ROWS) return updatedCount;
  }
}

export type WalletRbfCleanupTarget = 'active' | 'unlinked';

const targetPredicate = (target: WalletRbfCleanupTarget): Prisma.Sql => (
  target === 'active'
    ? Prisma.sql`target."confirmations" = 0 AND target."rbfStatus" = 'active'`
    : Prisma.sql`target."rbfStatus" = 'replaced' AND target."replacedByTxid" IS NULL`
);

/** Revalidate and apply one cleanup decision under the caller's wallet fence. */
export async function reconcileWalletRbfReplacement(
  walletId: string,
  targetId: string,
  replacementTxid: string,
  target: WalletRbfCleanupTarget,
  client: PrismaTxClient = prisma,
): Promise<boolean> {
  const statusAssignment = target === 'active'
    ? Prisma.sql`"rbfStatus" = 'replaced',`
    : Prisma.empty;
  const updated = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "transactions" AS target
    SET ${statusAssignment}
        "replacedByTxid" = ${replacementTxid},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE target."id" = ${targetId}
      AND target."walletId" = ${walletId}
      AND ${targetPredicate(target)}
      AND EXISTS (
        SELECT 1
        FROM "transactions" AS confirmed
        INNER JOIN "transaction_inputs" AS confirmed_input
          ON confirmed_input."transactionId" = confirmed."id"
        INNER JOIN "transaction_inputs" AS target_input
          ON target_input."transactionId" = target."id"
          AND target_input."txid" = confirmed_input."txid"
          AND target_input."vout" = confirmed_input."vout"
        WHERE confirmed."walletId" = ${walletId}
          AND confirmed."txid" = ${replacementTxid}
          AND confirmed."confirmations" > 0
          AND confirmed."id" <> target."id"
      )
    RETURNING target."id"
  `);
  return updated.length === 1;
}

/** Return one bounded page of stored RBF links without loading input relations. */
export async function findWalletRbfReplacements(
  walletId: string,
  target: WalletRbfCleanupTarget,
  client: PrismaTxClient = prisma,
  assertActive: () => void = () => undefined,
): Promise<Array<{ id: string; txid: string; replacementTxid: string }>> {
  assertActive();
  const rows = await client.$queryRaw<Array<{
    id: string;
    txid: string;
    replacementTxid: string;
  }>>(Prisma.sql`
    SELECT DISTINCT ON (target."id")
      target."id",
      target."txid",
      confirmed."txid" AS "replacementTxid"
    FROM "transactions" AS target
    INNER JOIN "transaction_inputs" AS target_input
      ON target_input."transactionId" = target."id"
    INNER JOIN "transaction_inputs" AS confirmed_input
      ON confirmed_input."txid" = target_input."txid"
      AND confirmed_input."vout" = target_input."vout"
    INNER JOIN "transactions" AS confirmed
      ON confirmed."id" = confirmed_input."transactionId"
    WHERE target."walletId" = ${walletId}
      AND confirmed."walletId" = ${walletId}
      AND confirmed."confirmations" > 0
      AND target."id" <> confirmed."id"
      AND target."txid" <> confirmed."txid"
      AND ${targetPredicate(target)}
    ORDER BY target."id", confirmed."txid"
    LIMIT ${ADDRESS_SYNC_IO_UPSERT_MAX_ROWS}
  `);
  assertActive();
  return rows;
}
