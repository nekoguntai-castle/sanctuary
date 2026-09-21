import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';
import { LIVE_TRANSACTION_WHERE, withLiveTransactionWhere } from '../transactions/visibility';

export async function getTransactionStats(walletId: string) {
  const [typeStats, feeStats, lastTransaction] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { walletId, ...LIVE_TRANSACTION_WHERE },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        walletId,
        type: { in: ['sent', 'consolidation'] },
        fee: { gt: 0 },
        ...LIVE_TRANSACTION_WHERE,
      },
      _count: { id: true },
      _sum: { fee: true },
    }),
    prisma.transaction.findFirst({
      where: { walletId, ...LIVE_TRANSACTION_WHERE },
      orderBy: [
        { blockTime: { sort: 'desc', nulls: 'first' } },
        { createdAt: 'desc' },
        // Match recalculation's final chronological row when timestamps tie.
        { id: 'desc' },
      ],
      select: { balanceAfter: true },
    }),
  ]);

  return { typeStats, feeStats, lastTransaction };
}

export async function findPendingTransactions(walletId: string, limit: number) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: { not: 'replaced' },
      OR: [{ blockHeight: 0 }, { blockHeight: null }],
    },
    include: { transactionLabels: { include: { label: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function findWalletTransactions(
  walletId: string,
  options: { limit: number; offset?: number }
) {
  return prisma.transaction.findMany({
    where: { walletId, ...LIVE_TRANSACTION_WHERE },
    include: {
      transactionLabels: { include: { label: true } },
    },
    orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
    take: options.limit,
    /* v8 ignore start -- list callers provide explicit offsets */
    skip: options.offset ?? 0,
    /* v8 ignore stop */
  });
}

export async function findWalletTransactionDetail(walletId: string, txid: string) {
  // A direct txid lookup is an audit read, so replaced history remains
  // addressable even though list, aggregate, and balance reads hide it.
  return prisma.transaction.findFirst({
    where: { walletId, txid },
    include: {
      wallet: { select: { id: true, name: true, type: true, network: true } },
      address: true,
      inputs: { orderBy: { inputIndex: 'asc' } },
      outputs: { orderBy: { outputIndex: 'asc' } },
      transactionLabels: { include: { label: true } },
    },
  });
}

/** Search the live ledger; replaced audit rows are excluded from every caller filter. */
export async function queryTransactions(where: Prisma.TransactionWhereInput, limit: number) {
  return prisma.transaction.findMany({
    where: withLiveTransactionWhere(where),
    include: { transactionLabels: { include: { label: true } } },
    orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}

export async function aggregateFees(walletId: string, cutoff: Date) {
  return prisma.transaction.aggregate({
    where: {
      walletId,
      fee: { gt: 0 },
      blockTime: { gte: cutoff },
      ...LIVE_TRANSACTION_WHERE,
    },
    _count: { id: true },
    _sum: { fee: true },
    _avg: { fee: true },
  });
}
