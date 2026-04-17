/**
 * MCP Read Repository
 *
 * Query helpers for the read-only MCP surface. These keep MCP handlers behind
 * the repository boundary while preserving explicit, redacted DTO shaping in
 * the MCP layer.
 */

import prisma from '../models/prisma';
import type { Prisma } from '../generated/prisma/client';

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getLatestFeeEstimate() {
  return prisma.feeEstimate.findFirst({
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLatestPrice(currency: string) {
  return prisma.priceData.findFirst({
    where: { currency },
    orderBy: { createdAt: 'desc' },
  });
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
    /* v8 ignore start -- MCP list callers provide explicit offsets */
    skip: options.offset ?? 0,
    /* v8 ignore stop */
  });
}

export async function findWalletTransactionDetail(walletId: string, txid: string) {
  return prisma.transaction.findFirst({
    where: { walletId, txid },
    include: {
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

export async function queryUtxos(where: Prisma.UTXOWhereInput, limit: number) {
  return prisma.uTXO.findMany({
    where,
    include: {
      draftLock: {
        include: {
          draft: { select: { id: true, label: true } },
        },
      },
    },
    orderBy: { amount: 'desc' },
    take: limit,
  });
}

export async function searchAddresses(where: Prisma.AddressWhereInput, limit: number) {
  return prisma.address.findMany({
    where,
    include: { addressLabels: { include: { label: true } } },
    orderBy: { index: 'asc' },
    take: limit,
  });
}

export async function countDrafts(walletId: string): Promise<number> {
  return prisma.draftTransaction.count({ where: { walletId } });
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

export const mcpReadRepository = {
  checkDatabase,
  getLatestFeeEstimate,
  getLatestPrice,
  getWalletBalance,
  findWalletTransactions,
  findWalletTransactionDetail,
  queryTransactions,
  queryUtxos,
  searchAddresses,
  countDrafts,
  aggregateFees,
};

export default mcpReadRepository;
