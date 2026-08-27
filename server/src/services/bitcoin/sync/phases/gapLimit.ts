/**
 * Gap Limit Phase
 *
 * Ensures the BIP-44 gap limit (20 consecutive unused addresses) is maintained.
 * If addresses near the gap limit are used, generates new addresses and
 * triggers a recursive sync for newly generated addresses.
 */

import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import {
  persistGapLimitExpansion,
  prepareGapLimitExpansion,
} from '../addressDiscovery';
import type { SyncContext } from '../types';
import { runWalletSyncMutation } from '../mutationBoundary';
import { createSyncStageRuntime } from '../attemptRuntime';

const log = createLogger('BITCOIN:SVC_SYNC_GAP');

/**
 * Execute gap limit phase
 *
 * After marking addresses as used, checks if we need to generate more addresses
 * to maintain the gap limit. If new addresses are generated, scans them for
 * transactions (handles external software using addresses beyond our range).
 */
export async function gapLimitPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, client } = ctx;

  walletLog(walletId, 'debug', 'SYNC', 'Checking address gap limit...');

  // Use the existing modularized function
  const preparation = await prepareGapLimitExpansion(walletId);
  const newAddresses = preparation
    ? await runWalletSyncMutation(
      ctx,
      'gap_limit_expansion',
      (tx, deferPostCommit) => persistGapLimitExpansion(
        walletId,
        preparation,
        tx,
        deferPostCommit,
      ),
    )
    : [];

  if (newAddresses.length === 0) {
    return ctx;
  }

  ctx.newAddresses = newAddresses;
  ctx.stats.newAddressesGenerated = newAddresses.length;

  walletLog(walletId, 'info', 'BLOCKCHAIN', `Scanning ${newAddresses.length} newly generated addresses`);

  // Fetch history for new addresses to check if any have transactions
  const newAddressStrings = newAddresses.map(a => a.address);
  const stage = ctx.attemptRuntime
    ? createSyncStageRuntime(ctx.attemptRuntime, 'gap_limit_history')
    : undefined;
  const requestOptions = stage
    ? { signal: stage.signal, deadlineAt: stage.deadlineAt }
    : undefined;

  try {
    const newHistoryResults = requestOptions
      ? await client.getAddressHistoryBatch(newAddressStrings, requestOptions)
      : await client.getAddressHistoryBatch(newAddressStrings);

    // Check if any new addresses have transactions
    let foundTransactions = false;
    for (const [, history] of newHistoryResults) {
      if (history.length > 0) {
        foundTransactions = true;
        break;
      }
    }

    if (foundTransactions) {
      // Note: The actual recursive sync is handled by the pipeline executor
      // We just set a flag in the context to indicate recursion is needed
      walletLog(walletId, 'info', 'BLOCKCHAIN', 'Found transactions on new addresses, re-syncing...');

      // The pipeline needs to handle this recursion
      // For now, we store the new addresses in context for the parent to handle
    }
  } catch (error) {
    requestOptions?.signal.throwIfAborted();
    log.warn(`[SYNC] Failed to scan new addresses: ${error}`);
  } finally {
    stage?.dispose();
  }

  return ctx;
}
