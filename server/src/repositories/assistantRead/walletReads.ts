import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';
import { buildWalletAccessWhere } from '../accessControl';

type WalletScopeFilter = {
  walletIds?: string[];
};

type DashboardSummaryOptions = WalletScopeFilter & {
  limit: number;
  network?: string;
};

function scopedWalletWhere(userId: string, filter: WalletScopeFilter = {}): Prisma.WalletWhereInput | null {
  if (filter.walletIds && filter.walletIds.length === 0) {
    return null;
  }
  return {
    ...buildWalletAccessWhere(userId),
    ...(filter.walletIds ? { id: { in: filter.walletIds } } : {}),
  };
}

export async function getWalletBalance(walletId: string) {
  return Promise.all([
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, confirmations: { gt: 0 } },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, confirmations: 0 },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
}

export async function getDashboardSummary(userId: string, options: DashboardSummaryOptions) {
  const where = scopedWalletWhere(userId, options);
  if (!where) {
    return { wallets: [], balances: [], transactionCounts: [], pendingCounts: [] };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      ...where,
      ...(options.network ? { network: options.network } : {}),
    },
    select: {
      id: true,
      name: true,
      type: true,
      scriptType: true,
      network: true,
      quorum: true,
      totalSigners: true,
      groupId: true,
      groupRole: true,
      syncInProgress: true,
      lastSyncedAt: true,
      lastSyncedBlockHeight: true,
      lastSyncStatus: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          addresses: true,
          devices: true,
          draftTransactions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  });

  const ids = wallets.map(wallet => wallet.id);
  if (ids.length === 0) {
    return { wallets, balances: [], transactionCounts: [], pendingCounts: [] };
  }

  const [balances, transactionCounts, pendingCounts] = await Promise.all([
    prisma.uTXO.groupBy({
      by: ['walletId'],
      where: { walletId: { in: ids }, spent: false },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['walletId'],
      where: { walletId: { in: ids } },
      _count: { id: true },
    }),
    prisma.transaction.groupBy({
      by: ['walletId'],
      where: {
        walletId: { in: ids },
        rbfStatus: { not: 'replaced' },
        OR: [{ blockHeight: 0 }, { blockHeight: null }],
      },
      _count: { id: true },
    }),
  ]);

  return { wallets, balances, transactionCounts, pendingCounts };
}

export async function findWalletDetailSummary(walletId: string, userId: string) {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    include: {
      devices: {
        include: {
          device: {
            select: {
              id: true,
              type: true,
              model: { select: { manufacturer: true, name: true } },
            },
          },
        },
        orderBy: { signerIndex: 'asc' },
      },
      group: { select: { id: true, name: true } },
      users: {
        select: { role: true },
      },
      _count: {
        select: {
          addresses: true,
          transactions: true,
          utxos: true,
          draftTransactions: true,
          vaultPolicies: true,
        },
      },
    },
  });
}
