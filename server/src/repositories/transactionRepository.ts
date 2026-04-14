/**
 * Transaction Repository
 *
 * Abstracts database operations for transactions.
 */

import prisma, { type PrismaTxClient } from '../models/prisma';
import type { Transaction, Prisma } from '../generated/prisma/client';
import type {
  TransactionPaginationOptions,
  TransactionPaginatedResult,
  TransactionCursor,
} from './types';

/**
 * Delete all transactions for a wallet
 * Returns count of deleted transactions
 */
export async function deleteByWalletId(walletId: string): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId },
  });
  return result.count;
}

/**
 * Delete all transactions for multiple wallets
 */
export async function deleteByWalletIds(walletIds: string[]): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId: { in: walletIds } },
  });
  return result.count;
}

/**
 * Find transactions by wallet
 */
export async function findByWalletId(
  walletId: string,
  options?: {
    skip?: number;
    take?: number;
    orderBy?: Prisma.TransactionOrderByWithRelationInput;
  }
): Promise<Transaction[]> {
  return prisma.transaction.findMany({
    where: { walletId },
    skip: options?.skip,
    take: options?.take,
    orderBy: options?.orderBy || { blockTime: 'desc' },
  });
}

/**
 * Count transactions for a wallet
 */
export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.transaction.count({
    where: { walletId },
  });
}

/**
 * Find transactions by wallet with cursor-based pagination
 * Uses (blockTime, id) compound cursor for stable ordering
 * Much more efficient than offset-based for deep pagination
 */
export async function findByWalletIdPaginated(
  walletId: string,
  options: TransactionPaginationOptions = {}
): Promise<TransactionPaginatedResult> {
  const { limit = 50, cursor, direction = 'forward', includeCount = false } = options;
  const take = Math.min(limit, 200) + 1; // Fetch one extra to detect hasMore

  // Build cursor condition for compound (blockTime, id) cursor
  let cursorCondition: Prisma.TransactionWhereInput = {};
  if (cursor) {
    if (direction === 'forward') {
      // Forward = older transactions (descending blockTime)
      cursorCondition = {
        OR: [
          { blockTime: { lt: cursor.blockTime } },
          {
            blockTime: cursor.blockTime,
            id: { lt: cursor.id },
          },
        ],
      };
    } else {
      // Backward = newer transactions (ascending blockTime)
      cursorCondition = {
        OR: [
          { blockTime: { gt: cursor.blockTime } },
          {
            blockTime: cursor.blockTime,
            id: { gt: cursor.id },
          },
        ],
      };
    }
  }

  const [transactions, totalCount] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        walletId,
        ...cursorCondition,
      },
      take,
      orderBy: direction === 'forward'
        ? [{ blockTime: 'desc' }, { id: 'desc' }]
        : [{ blockTime: 'asc' }, { id: 'asc' }],
    }),
    includeCount ? prisma.transaction.count({ where: { walletId } }) : Promise.resolve(undefined),
  ]);

  const hasMore = transactions.length > limit;
  const items = transactions.slice(0, limit);

  // Reverse if paginating backward to maintain consistent descending order
  if (direction === 'backward') {
    items.reverse();
  }

  // Build next cursor from last item
  let nextCursor: TransactionCursor | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem.blockTime) {
      nextCursor = {
        blockTime: lastItem.blockTime,
        id: lastItem.id,
      };
    }
  }

  return {
    items,
    nextCursor,
    hasMore,
    ...(totalCount !== undefined ? { totalCount } : {}),
  };
}

/**
 * Find transaction by txid
 */
export async function findByTxid(txid: string, walletId: string): Promise<Transaction | null> {
  return prisma.transaction.findFirst({
    where: { txid, walletId },
  });
}

/**
 * Find transactions for balance history chart
 */
export async function findForBalanceHistory(
  walletId: string,
  startDate: Date
): Promise<{ blockTime: Date | null; balanceAfter: bigint | null }[]> {
  return prisma.transaction.findMany({
    where: {
      walletId,
      blockTime: { gte: startDate },
      type: { not: 'consolidation' },
    },
    select: {
      blockTime: true,
      balanceAfter: true,
    },
    orderBy: { blockTime: 'asc' },
  });
}

/**
 * Find transactions with labels for export
 */
export async function findWithLabels(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { label: { not: null } },
        { memo: { not: null } },
        { transactionLabels: { some: {} } },
      ],
    },
    include: {
      transactionLabels: {
        include: {
          label: true,
        },
      },
    },
  });
}

/**
 * Get bucketed balance deltas using raw SQL (for balance history charts)
 */
export async function getBucketedBalanceDeltas(
  walletIds: string[],
  startDate: Date,
  bucketUnit: 'hour' | 'day' | 'week' | 'month'
): Promise<Array<{ bucket: Date; amount: bigint }>> {
  switch (bucketUnit) {
    case 'hour':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('hour', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'day':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('day', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'week':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('week', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'month':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('month', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
  }
}

/**
 * Find the most recent transaction for a wallet (for balance lookups)
 */
export async function findLastByWalletId(
  walletId: string,
  options?: { select?: Prisma.TransactionSelect }
) {
  return prisma.transaction.findFirst({
    where: { walletId },
    orderBy: [
      { blockTime: { sort: 'desc', nulls: 'first' } },
      { createdAt: 'desc' },
    ],
    select: options?.select,
  });
}

/**
 * Find a transaction by ID with wallet access check
 */
export async function findByIdWithAccess(
  id: string,
  userId: string,
  options?: { select?: Prisma.TransactionSelect; include?: Prisma.TransactionInclude }
) {
  const query: Prisma.TransactionFindFirstArgs = {
    where: {
      id,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findFirst(query);
}

/**
 * Find a transaction by txid with wallet access check
 */
type FindByTxidWithAccessOptions = Omit<Prisma.TransactionFindFirstArgs, 'where'>;

export async function findByTxidWithAccess(
  txid: string,
  userId: string
): Promise<Transaction | null>;
export async function findByTxidWithAccess<T extends FindByTxidWithAccessOptions>(
  txid: string,
  userId: string,
  options: T
): Promise<Prisma.TransactionGetPayload<T> | null>;
export async function findByTxidWithAccess(
  txid: string,
  userId: string,
  options?: FindByTxidWithAccessOptions
) {
  const query: Prisma.TransactionFindFirstArgs = {
    where: {
      txid,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findFirst(query);
}

/**
 * Group transactions by type with counts and sums
 */
export async function groupByType(walletId: string) {
  return prisma.transaction.groupBy({
    by: ['type'],
    where: { walletId },
    _count: { id: true },
    _sum: { amount: true },
  });
}

/**
 * Aggregate fees for sent/consolidation transactions
 */
export async function aggregateFees(walletId: string) {
  return prisma.transaction.aggregate({
    where: {
      walletId,
      type: { in: ['sent', 'consolidation'] },
      fee: { gt: 0 },
    },
    _sum: { fee: true },
  });
}

/**
 * Find transactions by wallet with full details (includes, labels, etc.)
 */
type FindByWalletIdWithDetailsOptions = Omit<Prisma.TransactionFindManyArgs, 'where'> & {
  where?: Prisma.TransactionWhereInput;
};

export async function findByWalletIdWithDetails(
  walletId: string
): Promise<Transaction[]>;
export async function findByWalletIdWithDetails<T extends FindByWalletIdWithDetailsOptions>(
  walletId: string,
  options: T
): Promise<Array<Prisma.TransactionGetPayload<T>>>;
export async function findByWalletIdWithDetails(
  walletId: string,
  options?: FindByWalletIdWithDetailsOptions
) {
  return prisma.transaction.findMany({
    where: {
      ...options?.where,
      // Keep the scoped wallet constraint last so caller filters cannot override it.
      walletId,
    },
    include: options?.include,
    orderBy: options?.orderBy ?? { blockTime: 'desc' },
    take: options?.take,
    skip: options?.skip,
  });
}

/**
 * Find transactions across multiple wallets with details
 */
export async function findByWalletIdsWithDetails(
  walletIds: string[],
  options?: {
    where?: Prisma.TransactionWhereInput;
    include?: Prisma.TransactionInclude;
    orderBy?: Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[];
    select?: Prisma.TransactionSelect;
    take?: number;
  }
) {
  const query: Prisma.TransactionFindManyArgs = {
    where: {
      ...options?.where,
      // Keep the scoped wallet constraint last so caller filters cannot override it.
      walletId: { in: walletIds },
    },
    orderBy: options?.orderBy ?? { blockTime: 'desc' },
    take: options?.take,
  };
  if (options?.select) query.select = options.select;
  else if (options?.include) query.include = options.include;
  return prisma.transaction.findMany(query);
}

/**
 * Aggregate spending by period for a wallet
 */
export async function aggregateSpending(
  walletId: string,
  cutoff: Date
) {
  return prisma.transaction.aggregate({
    where: { walletId, type: 'sent', blockTime: { gte: cutoff } },
    _count: { _all: true },
    _sum: { amount: true },
  });
}

/**
 * Shape of a single row produced by the transaction-export path.
 *
 * Narrowed to exactly the fields the export handler serializes — avoids
 * pulling the full Transaction row graph on large wallets. The previous
 * implementation included `transactionLabels` via a join that was never
 * read by the export (it emits the scalar `label` column); dropped here.
 */
export interface ExportTransactionRow {
  id: string;
  txid: string;
  type: string;
  amount: bigint;
  balanceAfter: bigint | null;
  fee: bigint | null;
  confirmations: number;
  label: string | null;
  memo: string | null;
  counterpartyAddress: string | null;
  blockHeight: number | null;
  blockTime: Date | null;
  createdAt: Date;
}

/**
 * Fetch one page of transactions for CSV/JSON export.
 *
 * The export handler calls this repeatedly with increasing `skip` until a
 * short page comes back, streaming each page to the client rather than
 * loading the full result set into memory. Deterministic ordering is
 * required — `(blockTime, id)` gives a stable total order even when
 * multiple transactions share a block time, and `id` breaks ties within
 * the pending (blockTime IS NULL) segment as well.
 *
 * Accepts an optional `client` argument so the handler can scope all
 * paged reads to a single Prisma interactive transaction with
 * REPEATABLE READ isolation — without that, concurrent writes (e.g. a
 * background wallet sync inserting new rows) would shift the `skip`
 * offset between pages and cause rows to be duplicated or missed.
 */
export async function findExportPage(
  walletId: string,
  dateFilter: { gte?: Date; lte?: Date } | undefined,
  skip: number,
  take: number,
  client: PrismaTxClient | typeof prisma = prisma,
): Promise<ExportTransactionRow[]> {
  return client.transaction.findMany({
    where: {
      walletId,
      ...(dateFilter && Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      balanceAfter: true,
      fee: true,
      confirmations: true,
      label: true,
      memo: true,
      counterpartyAddress: true,
      blockHeight: true,
      blockTime: true,
      createdAt: true,
    },
    orderBy: [{ blockTime: 'asc' }, { id: 'asc' }],
    skip,
    take,
  });
}

/**
 * Find block times for transactions by txids (for UTXO date enrichment)
 */
export async function findBlockTimesByTxids(
  walletId: string,
  txids: string[]
): Promise<Map<string, Date | null>> {
  const transactions = await prisma.transaction.findMany({
    where: {
      txid: { in: txids },
      walletId,
    },
    select: {
      txid: true,
      blockTime: true,
    },
  });
  return new Map(transactions.map(t => [t.txid, t.blockTime]));
}

// ============================================================================
// Sync pipeline methods (bulk operations for performance-critical sync code)
// ============================================================================

/**
 * Find transactions by wallet and txids with custom select
 * Used by sync pipeline for existence checks, I/O population, and label application
 */
export async function findByWalletIdAndTxids<T extends Prisma.TransactionSelect>(
  walletId: string,
  txids: string[],
  select: T
) {
  return prisma.transaction.findMany({
    where: { walletId, txid: { in: txids } },
    select,
  });
}

/**
 * Find pending transactions with their stored inputs (for RBF cleanup)
 */
export async function findPendingWithInputs(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: { some: {} },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

/**
 * Find confirmed transactions sharing any of the given inputs (for RBF cleanup)
 */
export async function findConfirmedWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { gt: 0 },
      inputs: {
        some: {
          OR: inputPatterns.map(i => ({ txid: i.txid, vout: i.vout })),
        },
      },
    },
    select: {
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

/**
 * Update RBF status fields on a single transaction
 */
export async function updateRbfStatus(
  id: string,
  data: { rbfStatus?: string; replacedByTxid?: string | null }
): Promise<void> {
  await prisma.transaction.update({
    where: { id },
    data,
  });
}

/**
 * Find pending (unconfirmed, active RBF) transactions sharing specific inputs (for RBF detection)
 */
export async function findPendingWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: {
        some: {
          OR: inputPatterns.map(p => ({ txid: p.txid, vout: p.vout })),
        },
      },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

/**
 * Find replaced transactions missing the replacedByTxid link (for retroactive RBF linking)
 */
export async function findUnlinkedReplaced(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: 'replaced',
      replacedByTxid: null,
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

/**
 * Bulk create transactions (sync pipeline batch insert)
 */
export async function createMany(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transaction.createMany({
    data: data as Prisma.TransactionCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Create a single transaction record (using unchecked input for direct scalar IDs)
 */
export async function create(
  data: Prisma.TransactionUncheckedCreateInput
) {
  return prisma.transaction.create({ data });
}

/**
 * Bulk create transaction inputs
 */
export async function createManyInputs(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionInput.createMany({
    data: data as Prisma.TransactionInputCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Bulk create transaction outputs
 */
export async function createManyOutputs(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionOutput.createMany({
    data: data as Prisma.TransactionOutputCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Bulk create transaction labels
 */
export async function createManyTransactionLabels(
  data: Array<{ transactionId: string; labelId: string }>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionLabel.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Find address labels by address IDs
 */
export async function findAddressLabelsByAddressIds(addressIds: string[]) {
  return prisma.addressLabel.findMany({
    where: { addressId: { in: addressIds } },
  });
}

/**
 * Find transactions without inputs/outputs (for post-sync I/O population)
 */
export async function findWithoutIO(
  walletId: string,
  txids: string[]
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: txids },
      inputs: { none: {} },
      outputs: { none: {} },
    },
    select: { id: true, txid: true, type: true },
  });
}

/**
 * Batch update RBF status using a $transaction block
 * Used by RBF detection to atomically mark multiple pending txs as replaced
 */
export async function batchUpdateRbfStatus(
  updates: Array<{ id: string; rbfStatus: string; replacedByTxid: string }>
): Promise<void> {
  if (updates.length === 0) return;
  await prisma.$transaction(
    updates.map(u =>
      prisma.transaction.update({
        where: { id: u.id },
        data: { rbfStatus: u.rbfStatus, replacedByTxid: u.replacedByTxid },
      })
    )
  );
}

/**
 * Find sent transactions with their outputs for consolidation detection
 */
export async function findSentWithOutputs(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId, type: 'sent' },
    include: {
      outputs: {
        select: { id: true, address: true, isOurs: true },
      },
    },
  });
}

/**
 * Update a transaction's type and amount (for consolidation correction)
 */
export async function updateTypeAndAmount(
  id: string,
  data: { type: string; amount: bigint }
): Promise<void> {
  await prisma.transaction.update({
    where: { id },
    data,
  });
}

/**
 * Bulk update isOurs flag and outputType on transaction outputs
 */
export async function updateOutputsIsOurs(
  ids: string[],
  data: { isOurs: boolean; outputType: string }
): Promise<void> {
  if (ids.length === 0) return;
  await prisma.transactionOutput.updateMany({
    where: { id: { in: ids } },
    data,
  });
}

/**
 * Find all transactions for balance recalculation, sorted by block time
 */
export async function findForBalanceRecalculation(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId },
    orderBy: [
      { blockTime: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, amount: true },
  });
}

/**
 * Batch update balanceAfter for multiple transactions in chunked $transactions.
 * Preserves atomicity within each chunk to avoid long-running locks.
 */
export async function batchUpdateBalances(
  updates: Array<{ id: string; balanceAfter: bigint }>,
  batchSize: number = 500
): Promise<void> {
  await batchUpdateByIds(
    updates.map(u => ({ id: u.id, data: { balanceAfter: u.balanceAfter } })),
    batchSize
  );
}

/**
 * Find transactions below a confirmation threshold (for confirmation updates)
 */
export async function findBelowConfirmationThreshold(
  walletId: string,
  threshold: number
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: threshold },
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });
}

/**
 * Find transactions with missing fields (for field population during sync)
 */
export async function findWithMissingFields(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        { addressId: null },
        { blockTime: null },
        { fee: null },
        { counterpartyAddress: null },
      ],
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      fee: true,
      blockHeight: true,
      blockTime: true,
      confirmations: true,
      addressId: true,
      counterpartyAddress: true,
    },
  });
}

/**
 * Batch update transactions by ID in chunked $transactions.
 * Used by sync pipeline for performance-critical bulk updates.
 * Each chunk runs as an atomic $transaction to avoid long-running locks.
 *
 * @param updates - Array of { id, data } pairs
 * @param batchSize - Number of updates per chunk
 */
export async function batchUpdateByIds(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  batchSize: number
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      chunk.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: u.data,
        })
      )
    );
  }
}

/**
 * Find distinct wallet IDs with pending confirmations (< threshold)
 */
export async function findWalletIdsWithPendingConfirmations(
  threshold: number = 6
): Promise<string[]> {
  const results = await prisma.transaction.findMany({
    where: { confirmations: { lt: threshold } },
    select: { walletId: true },
    distinct: ['walletId'],
  });
  return results.map(r => r.walletId);
}

/**
 * Find a transaction by txid across all wallets (no wallet filter)
 */
export async function findByTxidGlobal(txid: string): Promise<Transaction | null> {
  return prisma.transaction.findFirst({
    where: { txid },
  });
}

// Export as namespace
export const transactionRepository = {
  deleteByWalletId,
  deleteByWalletIds,
  findByWalletId,
  findByWalletIdPaginated,
  countByWalletId,
  findByTxid,
  findForBalanceHistory,
  findWithLabels,
  getBucketedBalanceDeltas,
  findLastByWalletId,
  findByIdWithAccess,
  findByTxidWithAccess,
  groupByType,
  aggregateFees,
  findByWalletIdWithDetails,
  findByWalletIdsWithDetails,
  aggregateSpending,
  findExportPage,
  findBlockTimesByTxids,
  // Sync pipeline methods
  findByWalletIdAndTxids,
  findPendingWithInputs,
  findConfirmedWithSharedInputs,
  updateRbfStatus,
  findPendingWithSharedInputs,
  findUnlinkedReplaced,
  createMany,
  create,
  createManyInputs,
  createManyOutputs,
  createManyTransactionLabels,
  findAddressLabelsByAddressIds,
  findWithoutIO,
  batchUpdateRbfStatus,
  findSentWithOutputs,
  updateTypeAndAmount,
  updateOutputsIsOurs,
  findForBalanceRecalculation,
  batchUpdateBalances,
  findBelowConfirmationThreshold,
  findWithMissingFields,
  batchUpdateByIds,
  findWalletIdsWithPendingConfirmations,
  findByTxidGlobal,
};

export default transactionRepository;
