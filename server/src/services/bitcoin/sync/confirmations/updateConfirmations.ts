/**
 * Transaction Confirmation Updates
 *
 * Updates confirmation counts for pending transactions using the current
 * block height. Returns detailed info about which transactions changed,
 * for milestone notifications.
 */

import { walletRepository, transactionRepository, systemSettingRepository } from '../../../../repositories';
import { DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../../../constants';
import { getBlockHeight } from '../../utils/blockHeight';
import { normalizeLegacyBitcoinNetwork } from '../../networks';
import { SystemSettingSchemas } from '../../../../utils/safeJson';
import { executeInChunks } from './batchUpdates';
import type { ConfirmationUpdate, PopulateFieldsCommitHandler } from './types';

function assertNotAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * Update confirmations for pending transactions - OPTIMIZED with batch updates
 * Returns detailed info about which transactions changed, for milestone notifications
 */
export async function updateTransactionConfirmations(
  walletId: string,
  signal?: AbortSignal,
  onCommit?: PopulateFieldsCommitHandler,
): Promise<ConfirmationUpdate[]> {
  assertNotAborted(signal);
  // Get wallet to determine network for correct block height
  const network = await walletRepository.findNetwork(walletId);
  assertNotAborted(signal);
  if (network === null) return [];

  const castNetwork = normalizeLegacyBitcoinNetwork(network, 'mainnet');

  // Get deep confirmation threshold from settings
  const deepConfirmationThreshold = await systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number, DEFAULT_DEEP_CONFIRMATION_THRESHOLD);
  assertNotAborted(signal);

  const transactions = await transactionRepository.findBelowConfirmationThreshold(walletId, deepConfirmationThreshold);
  assertNotAborted(signal);

  if (transactions.length === 0) return [];

  const currentHeight = await getBlockHeight(castNetwork);
  assertNotAborted(signal);

  // Calculate new confirmations and collect updates
  const updates: Array<{ id: string; txid: string; oldConfirmations: number; newConfirmations: number }> = [];

  for (const tx of transactions) {
    if (tx.blockHeight) {
      const newConfirmations = Math.max(0, currentHeight - tx.blockHeight + 1);
      if (newConfirmations !== tx.confirmations) {
        updates.push({
          id: tx.id,
          txid: tx.txid,
          oldConfirmations: tx.confirmations,
          newConfirmations,
        });
      }
    }
  }

  // Batch update using chunked transactions to avoid long locks
  if (updates.length > 0) {
    await executeInChunks(
      updates.map(u => ({
        id: u.id,
        txid: u.txid,
        oldConfirmations: u.oldConfirmations,
        newConfirmations: u.newConfirmations,
        data: {
          confirmations: u.newConfirmations,
          // When a transaction transitions from 0 to confirmed, update rbfStatus
          // to 'confirmed' to prevent cleanup logic from incorrectly marking it as replaced
          ...(u.oldConfirmations === 0 && u.newConfirmations > 0 ? { rbfStatus: 'confirmed' } : {}),
        },
      })),
      walletId,
      (committed) => onCommit?.({
        updated: 0,
        confirmationUpdates: committed.map(update => ({
          txid: update.txid,
          oldConfirmations: update.oldConfirmations,
          newConfirmations: update.newConfirmations,
        })),
      }),
      signal,
    );
  }

  return updates.map(u => ({
    txid: u.txid,
    oldConfirmations: u.oldConfirmations,
    newConfirmations: u.newConfirmations,
  }));
}
