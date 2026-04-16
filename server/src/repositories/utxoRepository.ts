/**
 * UTXO Repository
 *
 * Abstracts database operations for UTXOs.
 */

import prisma from '../models/prisma';
import type { UTXO, Prisma } from '../generated/prisma/client';

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
 * Count unspent, unfrozen UTXOs for a wallet
 */
export async function countUnspentUnfrozen(walletId: string): Promise<number> {
  return prisma.uTXO.count({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
  });
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

/**
 * Find a UTXO by ID with wallet access check
 */
export async function findByIdWithAccess(
  utxoId: string,
  userId: string
): Promise<UTXO | null> {
  return prisma.uTXO.findFirst({
    where: {
      id: utxoId,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
  });
}

/**
 * Find a UTXO by ID with wallet and user details
 */
export async function findByIdWithWalletAccess(
  utxoId: string,
  userId: string
) {
  return prisma.uTXO.findFirst({
    where: {
      id: utxoId,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
    include: {
      wallet: {
        include: {
          users: {
            where: { userId },
          },
        },
      },
    },
  });
}

/**
 * Find a UTXO by ID (select walletId only)
 */
export async function findWalletIdByUtxoId(
  utxoId: string
): Promise<string | null> {
  const utxo = await prisma.uTXO.findUnique({
    where: { id: utxoId },
    select: { walletId: true },
  });
  return utxo?.walletId ?? null;
}

/**
 * Update a UTXO by ID
 */
export async function updateById(
  utxoId: string,
  data: Prisma.UTXOUpdateInput
): Promise<UTXO> {
  return prisma.uTXO.update({
    where: { id: utxoId },
    data,
  });
}

/**
 * Aggregate unspent UTXOs for a wallet (count + sum)
 */
export async function aggregateUnspent(walletId: string) {
  return prisma.uTXO.aggregate({
    where: { walletId, spent: false },
    _count: { _all: true },
    _sum: { amount: true },
  });
}

/**
 * Find unspent UTXOs with draft lock details (for UTXO list views)
 */
export async function findUnspentWithDraftLocks(
  walletId: string,
  options?: { take?: number; skip?: number }
) {
  return prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
    },
    orderBy: { amount: 'desc' },
    include: {
      draftLock: {
        include: {
          draft: {
            select: { id: true, label: true },
          },
        },
      },
    },
    take: options?.take,
    skip: options?.skip,
  });
}

/**
 * Find UTXOs by txids for a wallet (for frozen/locked state lookups)
 */
export async function findByTxidsUnspent(
  walletIds: string[],
  txids: string[]
) {
  return prisma.uTXO.findMany({
    where: {
      walletId: { in: walletIds },
      txid: { in: txids },
      spent: false,
    },
    select: {
      walletId: true,
      txid: true,
      frozen: true,
      draftLock: {
        include: {
          draft: {
            select: { label: true },
          },
        },
      },
    },
  });
}

/**
 * Aggregate UTXOs by date window (for age profile milestones)
 */
export async function aggregateByDateWindow(
  walletId: string,
  windowStart: Date,
  windowEnd: Date
) {
  return prisma.uTXO.aggregate({
    where: { walletId, spent: false, createdAt: { gte: windowStart, lt: windowEnd } },
    _count: { _all: true },
    _sum: { amount: true },
  });
}

/**
 * Count UTXOs by IDs that belong to a specific wallet
 */
export async function countByIdsInWallet(
  ids: string[],
  walletId: string
): Promise<number> {
  return prisma.uTXO.count({
    where: {
      id: { in: ids },
      walletId,
    },
  });
}

/**
 * Find available (unspent, unfrozen) UTXOs for transaction building.
 * Supports confirmation threshold filtering and draft lock exclusion.
 */
export async function findAvailableForSpending(
  walletId: string,
  options?: {
    minConfirmations?: number;
    excludeDraftLocked?: boolean;
  }
): Promise<UTXO[]> {
  const where: Prisma.UTXOWhereInput = {
    walletId,
    spent: false,
    frozen: false,
  };

  if (options?.minConfirmations !== undefined) {
    where.confirmations = { gte: options.minConfirmations };
  }

  if (options?.excludeDraftLocked) {
    where.draftLock = null;
  }

  return prisma.uTXO.findMany({
    where,
    orderBy: { amount: 'desc' },
  });
}

/**
 * Find UTXOs by wallet with custom select (for reconciliation)
 */
export async function findByWalletIdWithSelect<T extends Prisma.UTXOSelect>(
  walletId: string,
  select: T
) {
  return prisma.uTXO.findMany({
    where: { walletId },
    select,
  });
}

/**
 * Bulk mark UTXOs as spent by IDs
 */
export async function markManyAsSpent(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.uTXO.updateMany({
    where: { id: { in: ids } },
    data: { spent: true },
  });
  return result.count;
}

/**
 * Batch update UTXOs by ID in chunked $transaction blocks
 * Used by sync pipeline for performance-critical bulk updates (e.g., confirmations).
 */
export async function batchUpdateByIds(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  batchSize: number
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      chunk.map(u =>
        prisma.uTXO.update({
          where: { id: u.id },
          data: u.data,
        })
      )
    );
  }
}

/**
 * Find existing UTXOs by outpoints (txid:vout) for a wallet, in chunks.
 * Returns a Set of "txid:vout" keys that already exist.
 */
export async function findExistingByOutpoints(
  walletId: string,
  outpoints: Array<{ txid: string; vout: number }>,
  chunkSize: number = 500
): Promise<Set<string>> {
  const existingSet = new Set<string>();
  for (let i = 0; i < outpoints.length; i += chunkSize) {
    const chunk = outpoints.slice(i, i + chunkSize);
    const existing = await prisma.uTXO.findMany({
      where: {
        walletId,
        OR: chunk.map(k => ({ txid: k.txid, vout: k.vout })),
      },
      select: { txid: true, vout: true },
    });
    for (const u of existing) {
      existingSet.add(`${u.txid}:${u.vout}`);
    }
  }
  return existingSet;
}

/**
 * Find exact wallet UTXOs by outpoint with state needed for spend validation.
 */
export async function findByOutpointsForWallet(
  walletId: string,
  outpoints: Array<{ txid: string; vout: number }>
) {
  if (outpoints.length === 0) {
    return [];
  }

  return prisma.uTXO.findMany({
    where: {
      walletId,
      OR: outpoints.map(outpoint => ({
        txid: outpoint.txid,
        vout: outpoint.vout,
      })),
    },
    select: {
      id: true,
      txid: true,
      vout: true,
      address: true,
      amount: true,
      spent: true,
      frozen: true,
      draftLock: {
        select: {
          draftId: true,
        },
      },
    },
  });
}

/**
 * Find existing UTXOs by outpoints (txid:vout) without wallet filter.
 * Used by single-address sync.
 */
export async function findExistingByOutpointsGlobal(
  outpoints: Array<{ txid: string; vout: number }>
): Promise<Set<string>> {
  if (outpoints.length === 0) return new Set();
  const existing = await prisma.uTXO.findMany({
    where: {
      OR: outpoints.map(o => ({ txid: o.txid, vout: o.vout })),
    },
    select: { txid: true, vout: true },
  });
  return new Set(existing.map(u => `${u.txid}:${u.vout}`));
}

/**
 * Bulk create UTXOs
 */
export async function createMany(
  data: Array<{
    walletId: string;
    txid: string;
    vout: number;
    address: string;
    amount: bigint;
    scriptPubKey: string;
    confirmations: number;
    blockHeight: number | null;
    spent: boolean;
  }>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.uTXO.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Find a UTXO by ID with wallet info
 */
export async function findByIdWithWallet(utxoId: string) {
  return prisma.uTXO.findUnique({
    where: { id: utxoId },
    include: {
      wallet: { select: { id: true } },
    },
  });
}

/**
 * Count unspent UTXOs at a specific address in a wallet
 */
export async function countUnspentByAddress(
  walletId: string,
  address: string
): Promise<number> {
  return prisma.uTXO.count({
    where: { walletId, address, spent: false },
  });
}

/**
 * Count unspent UTXOs from the same transaction in a wallet (excluding a specific UTXO)
 */
export async function countUnspentByTxid(
  walletId: string,
  txid: string,
  excludeId?: string
): Promise<number> {
  return prisma.uTXO.count({
    where: {
      walletId,
      txid,
      spent: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/**
 * Count unspent UTXOs at a specific block height from different transactions
 */
export async function countUnspentByBlockHeight(
  walletId: string,
  blockHeight: number,
  excludeId: string,
  excludeTxid: string
): Promise<number> {
  return prisma.uTXO.count({
    where: {
      walletId,
      blockHeight,
      spent: false,
      id: { not: excludeId },
      txid: { not: excludeTxid },
    },
  });
}

/**
 * Find unspent UTXOs with only amount field (for aggregate calculations)
 */
export async function findUnspentAmounts(
  walletId: string
): Promise<Array<{ amount: bigint }>> {
  return prisma.uTXO.findMany({
    where: { walletId, spent: false },
    select: { amount: true },
  });
}

/**
 * Find unspent, unfrozen UTXOs for privacy scoring
 */
export async function findUnspentForPrivacy(walletId: string) {
  return prisma.uTXO.findMany({
    where: { walletId, spent: false, frozen: false },
    select: {
      id: true,
      txid: true,
      vout: true,
      amount: true,
      address: true,
      blockHeight: true,
    },
    orderBy: { amount: 'desc' },
  });
}

/**
 * Find UTXOs by IDs with selected fields for spend privacy analysis
 */
export async function findByIdsForPrivacy(utxoIds: string[]) {
  return prisma.uTXO.findMany({
    where: { id: { in: utxoIds } },
    select: {
      address: true,
      txid: true,
      amount: true,
    },
  });
}

/**
 * Find a UTXO by outpoint (txid:vout compound key)
 */
export async function findByOutpoint(
  txid: string,
  vout: number
): Promise<UTXO | null> {
  return prisma.uTXO.findUnique({
    where: { txid_vout: { txid, vout } },
  });
}

/**
 * Get confirmed and unconfirmed balance separately for a wallet
 */
export async function getConfirmedUnconfirmedBalance(
  walletId: string
): Promise<{ confirmed: number; unconfirmed: number }> {
  const [confirmedResult, unconfirmedResult] = await Promise.all([
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, blockHeight: { not: null } },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, blockHeight: null },
      _sum: { amount: true },
    }),
  ]);
  return {
    confirmed: Number(confirmedResult._sum.amount || 0),
    unconfirmed: Number(unconfirmedResult._sum.amount || 0),
  };
}

/**
 * Get available UTXOs for selection with dynamic where clause
 */
export async function findAvailableForSelection(
  walletId: string,
  options: {
    excludeFrozen?: boolean;
    excludeUnconfirmed?: boolean;
    excludeUtxoIds?: string[];
  }
): Promise<Array<{
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight: number | null;
}>> {
  const where: Prisma.UTXOWhereInput = {
    walletId,
    spent: false,
  };

  if (options.excludeFrozen !== false) {
    where.frozen = false;
  }
  if (options.excludeUnconfirmed) {
    where.confirmations = { gt: 0 };
  }
  if (options.excludeUtxoIds?.length) {
    where.id = { notIn: options.excludeUtxoIds };
  }
  where.draftLock = null;

  return prisma.uTXO.findMany({
    where,
    select: {
      id: true,
      txid: true,
      vout: true,
      address: true,
      amount: true,
      confirmations: true,
      blockHeight: true,
    },
    orderBy: { amount: 'desc' },
  });
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
  countUnspentUnfrozen,
  countEligibility,
  findByIdWithAccess,
  findByIdWithWalletAccess,
  findWalletIdByUtxoId,
  updateById,
  aggregateUnspent,
  findUnspentWithDraftLocks,
  findByTxidsUnspent,
  aggregateByDateWindow,
  countByIdsInWallet,
  findAvailableForSpending,
  // Sync pipeline methods
  findByWalletIdWithSelect,
  markManyAsSpent,
  batchUpdateByIds,
  findExistingByOutpoints,
  findByOutpointsForWallet,
  findExistingByOutpointsGlobal,
  createMany,
  // Privacy methods
  findByIdWithWallet,
  countUnspentByAddress,
  countUnspentByTxid,
  countUnspentByBlockHeight,
  findUnspentAmounts,
  findUnspentForPrivacy,
  findByIdsForPrivacy,
  findByOutpoint,
  getConfirmedUnconfirmedBalance,
  findAvailableForSelection,
};

export default utxoRepository;
