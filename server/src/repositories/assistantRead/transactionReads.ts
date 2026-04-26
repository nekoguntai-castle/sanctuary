import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';

export async function getTransactionStats(walletId: string) {
  const [typeStats, feeStats, lastTransaction] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { walletId },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        walletId,
        type: { in: ['sent', 'consolidation'] },
        fee: { gt: 0 },
      },
      _count: { id: true },
      _sum: { fee: true },
    }),
    prisma.transaction.findFirst({
      where: { walletId },
      orderBy: [{ blockTime: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
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
    where: { walletId },
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

export async function queryTransactions(where: Prisma.TransactionWhereInput, limit: number) {
  return prisma.transaction.findMany({
    where,
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
    },
    _count: { id: true },
    _sum: { fee: true },
    _avg: { fee: true },
  });
}
