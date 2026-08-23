/**
 * Draft UTXO Lock Repository
 *
 * Abstracts database operations for draft transaction UTXO locks.
 */

import prisma, { type PrismaTxClient } from '../models/prisma';
import type { DraftUtxoLock } from '../generated/prisma/client';

export type DraftLockDbClient = Pick<typeof prisma, 'draftUtxoLock' | 'uTXO'>;

async function lockUtxosWithClient(
  client: DraftLockDbClient,
  draftId: string,
  utxoIds: string[]
): Promise<{
  success: boolean;
  lockedCount: number;
  failedUtxoIds: string[];
  lockedByDraftIds: string[];
}> {
  // Remove any existing locks for this draft (in case of update)
  await client.draftUtxoLock.deleteMany({ where: { draftId } });

  // Check if any UTXOs are already locked by other drafts
  const existingLocks = await client.draftUtxoLock.findMany({
    where: {
      utxoId: { in: utxoIds },
      draftId: { not: draftId },
    },
    include: {
      draft: { select: { id: true, label: true } },
      utxo: { select: { txid: true, vout: true } },
    },
  });

  if (existingLocks.length > 0) {
    return {
      success: false,
      lockedCount: 0,
      failedUtxoIds: existingLocks.map(lock => lock.utxoId),
      lockedByDraftIds: [...new Set(existingLocks.map(lock => lock.draftId))],
    };
  }

  // Create new locks
  const createdLocks = await client.draftUtxoLock.createMany({
    data: utxoIds.map(utxoId => ({ draftId, utxoId })),
  });

  if (createdLocks.count !== utxoIds.length) {
    const conflictingLocks = await client.draftUtxoLock.findMany({
      where: {
        utxoId: { in: utxoIds },
        draftId: { not: draftId },
      },
    });

    return {
      success: false,
      lockedCount: createdLocks.count,
      failedUtxoIds: conflictingLocks.map(lock => lock.utxoId),
      lockedByDraftIds: [...new Set(conflictingLocks.map(lock => lock.draftId))],
    };
  }

  return {
    success: true,
    lockedCount: createdLocks.count,
    failedUtxoIds: [],
    lockedByDraftIds: [],
  };
}

/**
 * Lock UTXOs for a draft atomically.
 * Returns lock result with success status and conflict info.
 */
export async function lockUtxos(
  draftId: string,
  utxoIds: string[],
  client?: DraftLockDbClient
): Promise<{
  success: boolean;
  lockedCount: number;
  failedUtxoIds: string[];
  lockedByDraftIds: string[];
}> {
  if (client) {
    return lockUtxosWithClient(client, draftId, utxoIds);
  }

  return prisma.$transaction(async tx => lockUtxosWithClient(tx, draftId, utxoIds));
}

/**
 * Delete all locks for a draft
 */
export async function deleteByDraftId(
  draftId: string,
  client: PrismaTxClient = prisma
): Promise<number> {
  const result = await client.draftUtxoLock.deleteMany({
    where: { draftId },
  });
  return result.count;
}

/**
 * Find locks for UTXOs, optionally excluding a specific draft
 */
export async function findByUtxoIds(
  utxoIds: string[],
  excludeDraftId?: string
) {
  return prisma.draftUtxoLock.findMany({
    where: {
      utxoId: { in: utxoIds },
      ...(excludeDraftId ? { draftId: { not: excludeDraftId } } : {}),
    },
    include: {
      draft: { select: { id: true, label: true } },
      utxo: { select: { id: true, txid: true, vout: true } },
    },
  });
}

/**
 * Find all locks for a specific draft
 */
export async function findByDraftId(draftId: string) {
  return prisma.draftUtxoLock.findMany({
    where: { draftId },
    include: {
      draft: { select: { id: true, label: true } },
      utxo: { select: { id: true, txid: true, vout: true } },
    },
  });
}

/**
 * Find a lock by UTXO ID (unique)
 */
export async function findByUtxoId(
  utxoId: string
): Promise<DraftUtxoLock | null> {
  return prisma.draftUtxoLock.findUnique({
    where: { utxoId },
    select: { draftId: true, utxoId: true, createdAt: true },
  }) as Promise<DraftUtxoLock | null>;
}

/**
 * Find conflicting locks for UTXOs not owned by a given draft
 */
export async function findConflicts(
  utxoIds: string[],
  excludeDraftId: string
) {
  return prisma.draftUtxoLock.findMany({
    where: {
      utxoId: { in: utxoIds },
      draftId: { not: excludeDraftId },
    },
    select: { utxoId: true, draftId: true },
  });
}

/**
 * Resolve UTXO references (txid:vout) to IDs within a wallet
 */
export async function resolveUtxoRefs(
  walletId: string,
  refs: Array<{ txid: string; vout: number }>,
  client?: Pick<DraftLockDbClient, 'uTXO'>
) {
  const db = client ?? prisma;
  return db.uTXO.findMany({
    where: {
      walletId,
      OR: refs.map(ref => ({ txid: ref.txid, vout: ref.vout })),
    },
    select: { id: true, txid: true, vout: true },
  });
}

/**
 * Find locks for spent UTXOs with draft label info (for sync reconciliation)
 */
export async function findLocksByUtxoIdsWithDraftInfo(
  utxoIds: string[],
  client: PrismaTxClient = prisma
) {
  /* v8 ignore next -- sync reconciliation avoids empty UTXO batches */
  if (utxoIds.length === 0) return [];
  return client.draftUtxoLock.findMany({
    where: { utxoId: { in: utxoIds } },
    select: {
      draftId: true,
      draft: { select: { id: true, label: true, recipient: true } },
    },
  });
}

/**
 * Aggregate lock stats for support package.
 * Orphaned locks (where the draft has been deleted) are flagged separately
 * because they're the canonical symptom of stuck-state bugs.
 */
export interface DraftLockSupportStats {
  total: number;
  oldestLockAgeMs: number | null;
  distinctDrafts: number;
}

export async function getSupportStats(now: Date = new Date()): Promise<DraftLockSupportStats> {
  const [total, oldest, distinctDraftRows] = await Promise.all([
    prisma.draftUtxoLock.count(),
    prisma.draftUtxoLock.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.draftUtxoLock.groupBy({ by: ['draftId'] }),
  ]);

  return {
    total,
    oldestLockAgeMs: oldest ? now.getTime() - oldest.createdAt.getTime() : null,
    distinctDrafts: distinctDraftRows.length,
  };
}

// Export as namespace
export const draftLockRepository = {
  lockUtxos,
  deleteByDraftId,
  findByUtxoIds,
  findByDraftId,
  findByUtxoId,
  findConflicts,
  resolveUtxoRefs,
  findLocksByUtxoIdsWithDraftInfo,
  getSupportStats,
};

export default draftLockRepository;
