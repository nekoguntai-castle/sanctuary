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
import { resolvePersistedBitcoinNetwork } from '../../networks';
import { SystemSettingSchemas } from '../../../../utils/safeJson';
import { executeInChunks } from './batchUpdates';
import type { ConfirmationUpdate, PopulateFieldsCommitHandler } from './types';

interface ConfirmationWriteOptions {
  markNewlyConfirmedRbfStatus: boolean;
}

function assertNotAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function assertAuthoritativeHeight(currentHeight: number): void {
  if (!Number.isSafeInteger(currentHeight) || currentHeight < 0) {
    throw new Error('Authoritative block height must be a non-negative safe integer');
  }
}

async function updatePersistedConfirmations(
  walletId: string,
  currentHeightSource: number | (() => Promise<number>),
  options: ConfirmationWriteOptions,
  signal?: AbortSignal,
  onCommit?: PopulateFieldsCommitHandler,
): Promise<ConfirmationUpdate[]> {
  if (typeof currentHeightSource === 'number') {
    assertAuthoritativeHeight(currentHeightSource);
  }
  assertNotAborted(signal);

  const deepConfirmationThreshold = await systemSettingRepository.getParsed(
    'deepConfirmationThreshold',
    SystemSettingSchemas.number,
    DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  );
  assertNotAborted(signal);

  const transactions = typeof currentHeightSource === 'number'
    ? await transactionRepository.findRequiringConfirmationUpdateAtHeight(
        walletId,
        deepConfirmationThreshold,
        currentHeightSource,
      )
    : await transactionRepository.findBelowConfirmationThreshold(
        walletId,
        deepConfirmationThreshold,
      );
  assertNotAborted(signal);

  if (transactions.length === 0) return [];

  const currentHeight = typeof currentHeightSource === 'number'
    ? currentHeightSource
    : await currentHeightSource();
  assertAuthoritativeHeight(currentHeight);
  assertNotAborted(signal);

  const updates = transactions.flatMap((tx) => {
    if (!tx.blockHeight) return [];
    const newConfirmations = Math.max(0, currentHeight - tx.blockHeight + 1);
    if (newConfirmations === tx.confirmations) return [];
    return [{
      id: tx.id,
      txid: tx.txid,
      oldConfirmations: tx.confirmations,
      newConfirmations,
    }];
  });

  if (updates.length === 0) return [];
  await executeInChunks(
    updates.map(update => ({
      ...update,
      data: {
        confirmations: update.newConfirmations,
        ...(options.markNewlyConfirmedRbfStatus
          && update.oldConfirmations === 0
          && update.newConfirmations > 0
          ? { rbfStatus: 'confirmed' }
          : {}),
      },
    })),
    walletId,
    committed => onCommit?.({
      updated: 0,
      confirmationUpdates: committed.map(update => ({
        txid: update.txid,
        oldConfirmations: update.oldConfirmations,
        newConfirmations: update.newConfirmations,
      })),
    }),
    signal,
    undefined,
    true,
  );

  return updates.map(({ txid, oldConfirmations, newConfirmations }) => ({
    txid,
    oldConfirmations,
    newConfirmations,
  }));
}

/**
 * Refresh already-persisted transaction confirmations from a reconciled tip.
 * This path deliberately performs no wallet-history, missing-field, or live-tip
 * lookup and writes no transaction field other than `confirmations`.
 */
export async function updateTransactionConfirmationsAtHeight(
  walletId: string,
  authoritativeHeight: number,
  signal?: AbortSignal,
  onCommit?: PopulateFieldsCommitHandler,
): Promise<ConfirmationUpdate[]> {
  return updatePersistedConfirmations(
    walletId,
    authoritativeHeight,
    { markNewlyConfirmedRbfStatus: false },
    signal,
    onCommit,
  );
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

  const castNetwork = resolvePersistedBitcoinNetwork(network);

  return updatePersistedConfirmations(
    walletId,
    () => getBlockHeight(castNetwork),
    { markNewlyConfirmedRbfStatus: true },
    signal,
    onCommit,
  );
}
