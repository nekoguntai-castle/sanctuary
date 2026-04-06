/**
 * UTXO Repository
 *
 * Abstracts database operations for UTXOs.
 */

import prisma from '../models/prisma';
import type { UTXO, Prisma } from '@prisma/client';

/**
 * Get total unspent balance for a wallet
 */
export async function getUnspentBalance(walletId: string): Promise<bigint> {
  const result = await prisma.uTXO.aggregate({
    where: { walletId, spent: false },
    _sum: { amount: true },
  });
  return result._sum.amount || BigInt(0);
}

/**
 * Get total unspent balance for multiple wallets
 */
export async function getUnspentBalanceForWallets(walletIds: string[]): Promise<Map<string, bigint>> {
  const results = await prisma.uTXO.groupBy({
    by: ['walletId'],
    where: { walletId: { in: walletIds }, spent: false },
    _sum: { amount: true },
  });

  const balanceMap = new Map<string, bigint>();
  for (const result of results) {
    balanceMap.set(result.walletId, result._sum.amount || BigInt(0));
  }
  return balanceMap;
}

/**
 * Find all UTXOs for a wallet
 */
export async function findByWalletId(
  walletId: string,
  options?: {
    spent?: boolean;
    skip?: number;
    take?: number;
  }
): Promise<UTXO[]> {
  const where: Prisma.UTXOWhereInput = { walletId };

  if (options?.spent !== undefined) {
    where.spent = options.spent;
  }

  return prisma.uTXO.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { amount: 'desc' },
  });
}

/**
 * Find unspent UTXOs for a wallet
 */
export async function findUnspent(
  walletId: string,
  options?: { excludeFrozen?: boolean }
): Promise<UTXO[]> {
  const where: Prisma.UTXOWhereInput = { walletId, spent: false };
  if (options?.excludeFrozen) {
    where.frozen = false;
  }
  return prisma.uTXO.findMany({
    where,
    orderBy: { amount: 'desc' },
  });
}

/**
 * Mark UTXOs as spent
 */
export async function markAsSpent(txid: string, vout: number): Promise<UTXO | null> {
  try {
    return await prisma.uTXO.update({
      where: { txid_vout: { txid, vout } },
      data: { spent: true },
    });
  } catch {
    return null;
  }
}

/**
 * Delete all UTXOs for a wallet
 */
export async function deleteByWalletId(walletId: string): Promise<number> {
  const result = await prisma.uTXO.deleteMany({
    where: { walletId },
  });
  return result.count;
}

/**
 * Delete UTXOs for multiple wallets
 */
export async function deleteByWalletIds(walletIds: string[]): Promise<number> {
  const result = await prisma.uTXO.deleteMany({
    where: { walletId: { in: walletIds } },
  });
  return result.count;
}

/**
 * Count UTXOs for a wallet
 */
export async function countByWalletId(
  walletId: string,
  options?: { spent?: boolean }
): Promise<number> {
  const where: Prisma.UTXOWhereInput = { walletId };

  if (options?.spent !== undefined) {
    where.spent = options.spent;
  }

  return prisma.uTXO.count({ where });
}

/**
 * Count UTXOs by eligibility categories for payjoin
 * Returns counts for: eligible, total, frozen, unconfirmed, locked
 */
export async function countEligibility(walletId: string): Promise<{
  eligible: number;
  total: number;
  frozen: number;
  unconfirmed: number;
  locked: number;
}> {
  const [eligible, total, frozen, unconfirmed, locked] = await Promise.all([
    prisma.uTXO.count({
      where: { walletId, spent: false, frozen: false, confirmations: { gt: 0 }, draftLock: null },
    }),
    prisma.uTXO.count({
      where: { walletId, spent: false },
    }),
    prisma.uTXO.count({
      where: { walletId, spent: false, frozen: true },
    }),
    prisma.uTXO.count({
      where: { walletId, spent: false, confirmations: 0 },
    }),
    prisma.uTXO.count({
      where: { walletId, spent: false, draftLock: { isNot: null } },
    }),
  ]);
  return { eligible, total, frozen, unconfirmed, locked };
}

// Export as namespace
export const utxoRepository = {
  getUnspentBalance,
  getUnspentBalanceForWallets,
  findByWalletId,
  findUnspent,
  markAsSpent,
  deleteByWalletId,
  deleteByWalletIds,
  countByWalletId,
  countEligibility,
};

export default utxoRepository;
