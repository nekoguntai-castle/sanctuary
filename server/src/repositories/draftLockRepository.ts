/**
 * Draft UTXO Lock Repository
 *
 * Abstracts database operations for draft transaction UTXO locks.
 */

import prisma from '../models/prisma';
import type { DraftUtxoLock } from '../generated/prisma/client';

/**
 * Lock UTXOs for a draft atomically.
 * Returns lock result with success status and conflict info.
 */
export async function lockUtxos(
  draftId: string,
  utxoIds: string[]
): Promise<{
  success: boolean;
  lockedCount: number;
  failedUtxoIds: string[];
  lockedByDraftIds: string[];
}> {
  return prisma.$transaction(async (tx) => {
    // Remove any existing locks for this draft (in case of update)
    await tx.draftUtxoLock.deleteMany({ where: { draftId } });

    // Check if any UTXOs are already locked by other drafts
    const existingLocks = await tx.draftUtxoLock.findMany({
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
    const createdLocks = await tx.draftUtxoLock.createMany({
      data: utxoIds.map(utxoId => ({ draftId, utxoId })),
    });

    if (createdLocks.count !== utxoIds.length) {
      const conflictingLocks = await tx.draftUtxoLock.findMany({
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
  });
}

/**
 * Delete all locks for a draft
 */
export async function deleteByDraftId(draftId: string): Promise<number> {
  const result = await prisma.draftUtxoLock.deleteMany({
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
    select: { draftId: true, utxoId: true, createdAt: true } as any,
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
  refs: Array<{ txid: string; vout: number }>
) {
  return prisma.uTXO.findMany({
    where: {
      walletId,
      OR: refs.map(ref => ({ txid: ref.txid, vout: ref.vout })),
    },
    select: { id: true, txid: true, vout: true },
  });
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
};

export default draftLockRepository;
