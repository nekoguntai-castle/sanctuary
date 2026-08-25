import prisma from '../../models/prisma';
import { Prisma, type Transaction } from '../../generated/prisma/client';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type {
  TransactionPaginationOptions,
  TransactionPaginatedResult,
  TransactionCursor,
} from '../types';

export async function deleteByWalletId(walletId: string): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId },
  });
  return result.count;
}

export async function deleteByWalletIds(walletIds: string[]): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId: { in: walletIds } },
  });
  return result.count;
}

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

export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.transaction.count({
    where: { walletId },
  });
}

export async function findByWalletIdPaginated(
  walletId: string,
  options: TransactionPaginationOptions = {}
): Promise<TransactionPaginatedResult> {
  const { limit = 50, cursor, direction = 'forward', includeCount = false } = options;
  const take = Math.min(limit, 200) + 1;

  let cursorCondition: Prisma.TransactionWhereInput = {};
  if (cursor) {
    if (direction === 'forward') {
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

  if (direction === 'backward') {
    items.reverse();
  }

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

type FindByTxidOptions = Pick<Prisma.TransactionFindUniqueArgs, 'select' | 'include'>;

export async function findByTxid(txid: string, walletId: string): Promise<Transaction | null>;
export async function findByTxid<T extends FindByTxidOptions>(
  txid: string,
  walletId: string,
  options: T
): Promise<Prisma.TransactionGetPayload<T> | null>;
export async function findByTxid(
  txid: string,
  walletId: string,
  options?: FindByTxidOptions
) {
  const query: Prisma.TransactionFindUniqueArgs = {
    where: {
      txid_walletId: { txid, walletId },
    },
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findUnique(query);
}

export async function findManyByTxids(txids: string[], walletId: string): Promise<Transaction[]> {
  const uniqueTxids = Array.from(new Set(txids.filter(txid => txid.length > 0)));
  if (uniqueTxids.length === 0) return [];

  return prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: uniqueTxids },
    },
  });
}

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
  /* v8 ignore start -- select/include are mutually tested through repository callers */
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  /* v8 ignore stop */
  return prisma.transaction.findFirst(query);
}

type FindAccessibleByTxidMatchesOptions = Pick<
  Prisma.TransactionFindManyArgs,
  'select' | 'include'
>;

export async function findAccessibleByTxidMatches(
  txid: string,
  userId: string
): Promise<Transaction[]>;
export async function findAccessibleByTxidMatches<T extends FindAccessibleByTxidMatchesOptions>(
  txid: string,
  userId: string,
  options: T
): Promise<Array<Prisma.TransactionGetPayload<T>>>;
export async function findAccessibleByTxidMatches(
  txid: string,
  userId: string,
  options?: FindAccessibleByTxidMatchesOptions
) {
  const query: Prisma.TransactionFindManyArgs = {
    where: {
      txid,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
    orderBy: [{ walletId: 'asc' }, { id: 'asc' }],
    take: 2,
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findMany(query);
}

export async function groupByType(walletId: string) {
  return prisma.transaction.groupBy({
    by: ['type'],
    where: { walletId },
    _count: { id: true },
    _sum: { amount: true },
  });
}

/**
 * Confirmed activity across several wallets since `startDate`, grouped by type.
 *
 * `blockTime` non-null is the same filter `getBucketedBalanceDeltas` applies,
 * so an activity summary and the balance chart drawn beside it always describe
 * the same set of transactions. Unconfirmed rows are excluded deliberately:
 * they have no settled position in the period, and the dashboard already
 * reports mempool exposure separately as pending totals.
 */
export async function groupActivityByType(walletIds: string[], startDate: Date) {
  return prisma.transaction.groupBy({
    by: ['type'],
    where: {
      walletId: { in: walletIds },
      blockTime: { not: null, gte: startDate },
    },
    _count: { id: true },
    _sum: { amount: true },
    _max: { blockTime: true },
  });
}

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

export async function findByWalletIdsWithDetails(
  walletIds: string[],
  options?: {
    where?: Prisma.TransactionWhereInput;
    include?: Prisma.TransactionInclude;
    orderBy?: Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[];
    select?: Prisma.TransactionSelect;
    take?: number;
    skip?: number;
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
    skip: options?.skip,
  };
  if (options?.select) query.select = options.select;
  else if (options?.include) query.include = options.include;
  return prisma.transaction.findMany(query);
}

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

export async function findWalletIdsWithPendingConfirmations(
  threshold: number = 6,
  network?: NetworkType,
): Promise<string[]> {
  const results = await prisma.transaction.findMany({
    where: {
      confirmations: { lt: threshold },
      ...(network === undefined ? {} : { wallet: { network } }),
    },
    select: { walletId: true },
    distinct: ['walletId'],
  });
  return results.map(r => r.walletId);
}

/**
 * Include wallets whose stored count was formerly deep enough but would fall
 * below the threshold at a reconciled lower tip.
 */
export async function findWalletIdsRequiringConfirmationUpdateAtHeight(
  threshold: number,
  network: NetworkType,
  authoritativeHeight: number,
  afterWalletId: string | null = null,
  limit = 100,
  queryTimeoutMs = 19_000,
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Confirmation wallet page limit is invalid');
  }
  if (afterWalletId !== null && (afterWalletId.length < 1 || afterWalletId.length > 200)) {
    throw new Error('Confirmation wallet cursor is invalid');
  }
  if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 1 || queryTimeoutMs > 60_000) {
    throw new Error('Confirmation wallet query timeout is invalid');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('statement_timeout', ${String(queryTimeoutMs)}, true)`,
    );
    const results = await tx.transaction.groupBy({
      by: ['walletId'],
      where: {
        wallet: { network },
        ...(afterWalletId === null ? {} : { walletId: { gt: afterWalletId } }),
        OR: [
          { confirmations: { lt: threshold } },
          { blockHeight: { gt: authoritativeHeight - threshold + 1 } },
        ],
      },
      orderBy: { walletId: 'asc' },
      take: limit + 1,
    });
    return results.map(result => result.walletId);
  }, { timeout: queryTimeoutMs + 1_000 });
}
