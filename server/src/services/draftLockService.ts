/**
 * Draft UTXO Lock Service
 *
 * Manages UTXO locks for draft transactions to prevent double-spending
 * when multiple drafts might try to use the same UTXOs.
 *
 * Key features:
 * - One UTXO can only be locked by one draft at a time
 * - Locks are automatically released when draft is deleted (cascade)
 * - Locks are automatically released when UTXO is spent (cascade)
 * - RBF drafts skip locking (they reuse same UTXOs as original tx)
 */

import { draftLockRepository } from '../repositories';
import type { DraftLockDbClient } from '../repositories/draftLockRepository';
import { createLogger } from '../utils/logger';
import { getErrorMessage, isUniqueConstraintError } from '../utils/errors';

const log = createLogger('DRAFT_LOCK:SVC');

export interface LockResult {
  success: boolean;
  lockedCount: number;
  failedUtxoIds: string[]; // UTXOs that couldn't be locked (already locked by another draft)
  lockedByDraftIds: string[]; // Draft IDs that hold conflicting locks
}

export interface UtxoLockInfo {
  utxoId: string;
  txid: string;
  vout: number;
  draftId: string;
  draftLabel?: string;
  lockedAt: Date;
}

export interface LockUtxosForDraftOptions {
  isRBF?: boolean;
  client?: DraftLockDbClient;
}

/**
 * Lock UTXOs for a draft transaction
 * Returns success only if ALL UTXOs can be locked (atomic operation)
 */
export async function lockUtxosForDraft(
  draftId: string,
  utxoIds: string[],
  options: LockUtxosForDraftOptions = {}
): Promise<LockResult> {
  const uniqueUtxoIds = [...new Set(utxoIds)];

  // RBF drafts skip locking - they reuse UTXOs from the original transaction
  if (options.isRBF) {
    log.debug(`Skipping UTXO locking for RBF draft ${draftId}`);
    return {
      success: true,
      lockedCount: 0,
      failedUtxoIds: [],
      lockedByDraftIds: [],
    };
  }

  if (uniqueUtxoIds.length === 0) {
    return {
      success: true,
      lockedCount: 0,
      failedUtxoIds: [],
      lockedByDraftIds: [],
    };
  }

  try {
    // Delegate to repository's atomic lock method
    const lockResult = await draftLockRepository.lockUtxos(draftId, uniqueUtxoIds, options.client);

    if (!lockResult.success) {
      log.warn(`Cannot lock UTXOs for draft ${draftId}: UTXOs already locked`, {
        failedUtxoIds: lockResult.failedUtxoIds,
        lockedByDraftIds: lockResult.lockedByDraftIds,
      });
      return lockResult;
    }

    log.debug(`Locked ${lockResult.lockedCount} UTXOs for draft ${draftId}`);

    return lockResult;
  } catch (error) {
    log.error(`Failed to lock UTXOs for draft ${draftId}`, { error: getErrorMessage(error) });

    // Check if it's a unique constraint violation (race condition)
    if (isUniqueConstraintError(error)) {
      let failedUtxoIds = uniqueUtxoIds;
      let lockedByDraftIds: string[] = [];

      try {
        const conflictingLocks = await draftLockRepository.findConflicts(uniqueUtxoIds, draftId);

        if (conflictingLocks.length > 0) {
          failedUtxoIds = [...new Set(conflictingLocks.map(lock => lock.utxoId))];
          lockedByDraftIds = [...new Set(conflictingLocks.map(lock => lock.draftId))];
        }
      } catch (lookupError) {
        log.warn(`Failed to inspect conflicting draft locks for ${draftId}`, {
          error: getErrorMessage(lookupError),
        });
      }

      return {
        success: false,
        lockedCount: 0,
        failedUtxoIds,
        lockedByDraftIds,
      };
    }

    throw error;
  }
}

/**
 * Unlock all UTXOs for a draft transaction
 * Called when draft is deleted or broadcast
 */
export async function unlockUtxosForDraft(draftId: string): Promise<number> {
  try {
    const count = await draftLockRepository.deleteByDraftId(draftId);

    if (count > 0) {
      log.debug(`Unlocked ${count} UTXOs for draft ${draftId}`);
    }

    return count;
  } catch (error) {
    log.error(`Failed to unlock UTXOs for draft ${draftId}`, { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Check which UTXOs are available (not locked by other drafts)
 */
export async function getAvailableUtxoIds(
  utxoIds: string[],
  excludeDraftId?: string
): Promise<{ available: string[]; locked: UtxoLockInfo[] }> {
  if (utxoIds.length === 0) {
    return { available: [], locked: [] };
  }

  const locks = await draftLockRepository.findByUtxoIds(utxoIds, excludeDraftId);

  const lockedUtxoIds = new Set(locks.map(lock => lock.utxoId));
  const available = utxoIds.filter(id => !lockedUtxoIds.has(id));

  const locked: UtxoLockInfo[] = locks.map(lock => ({
    utxoId: lock.utxoId,
    txid: lock.utxo.txid,
    vout: lock.utxo.vout,
    draftId: lock.draftId,
    draftLabel: lock.draft.label || undefined,
    lockedAt: lock.createdAt,
  }));

  return { available, locked };
}

/**
 * Get all locks for a specific draft
 */
export async function getLocksForDraft(draftId: string): Promise<UtxoLockInfo[]> {
  const locks = await draftLockRepository.findByDraftId(draftId);

  return locks.map(lock => ({
    utxoId: lock.utxoId,
    txid: lock.utxo.txid,
    vout: lock.utxo.vout,
    draftId: lock.draftId,
    draftLabel: lock.draft.label || undefined,
    lockedAt: lock.createdAt,
  }));
}

/**
 * Check if a UTXO is locked by any draft
 */
export async function isUtxoLocked(utxoId: string): Promise<{ locked: boolean; draftId?: string }> {
  const lock = await draftLockRepository.findByUtxoId(utxoId);

  return {
    locked: !!lock,
    draftId: lock?.draftId,
  };
}

/**
 * Convert "txid:vout" format to UTXO IDs
 * Used when creating drafts with selectedUtxoIds
 */
export async function resolveUtxoIds(
  walletId: string,
  selectedUtxoRefs: string[],
  client?: Pick<DraftLockDbClient, 'uTXO'>
): Promise<{ found: string[]; notFound: string[] }> {
  if (selectedUtxoRefs.length === 0) {
    return { found: [], notFound: [] };
  }

  // Parse txid:vout references
  const refs = selectedUtxoRefs.map(ref => {
    const [txid, voutStr] = ref.split(':');
    return { txid, vout: parseInt(voutStr, 10) };
  });

  // Find UTXOs by txid and vout
  const utxos = await draftLockRepository.resolveUtxoRefs(walletId, refs, client);

  // Map found UTXOs
  const foundMap = new Map<string, string>();
  for (const utxo of utxos) {
    foundMap.set(`${utxo.txid}:${utxo.vout}`, utxo.id);
  }

  const found: string[] = [];
  const notFound: string[] = [];

  for (const ref of selectedUtxoRefs) {
    const id = foundMap.get(ref);
    if (id) {
      found.push(id);
    } else {
      notFound.push(ref);
    }
  }

  return { found, notFound };
}
