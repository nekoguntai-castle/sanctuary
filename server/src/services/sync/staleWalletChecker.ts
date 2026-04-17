/**
 * Stale Wallet Checker
 *
 * Detects and handles wallets with stale or stuck sync states:
 * - resetStuckSyncs: Clears syncInProgress flags left over from a previous server session.
 * - checkAndQueueStaleSyncs: Finds wallets that haven't been synced recently and queues them.
 */

import { walletRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import type { SyncState } from './types';

const log = createLogger('SYNC:STALE');

/**
 * Reset any wallets that have syncInProgress stuck as true.
 * This happens if the server was restarted during a sync.
 */
export async function resetStuckSyncs(): Promise<void> {
  try {
    const count = await walletRepository.resetAllStuckSyncFlags();
    if (count > 0) {
      const result = { count };
      log.info(`[SYNC] Reset ${result.count} stuck sync flags from previous session`);
    }
  } catch (error) {
    log.error('[SYNC] Failed to reset stuck sync flags', { error: getErrorMessage(error) });
  }
}

/**
 * Check for stale wallets and queue them for sync.
 * Also auto-unstucks wallets that have syncInProgress=true but aren't actually syncing.
 *
 * @param state - Shared sync state (reads isRunning and activeSyncs).
 * @param queueSync - Callback to queue a wallet for sync with a given priority.
 */
export async function checkAndQueueStaleSyncs(
  state: SyncState,
  queueSync: (walletId: string, priority: 'high' | 'normal' | 'low') => void,
): Promise<void> {
  if (!state.isRunning) return;

  try {
    // First, check for stuck syncs - wallets marked as syncing in DB but not in memory
    // This can happen if sync times out or crashes without proper cleanup
    const stuckWallets = await walletRepository.findStuckSyncing();

    // Reset any wallet that's marked as syncing but isn't actually syncing
    let unstuckCount = 0;
    for (const wallet of stuckWallets) {
      if (!state.activeSyncs.has(wallet.id)) {
        /* v8 ignore next -- fallback id is defensive when wallet name is absent */
        log.warn(`[SYNC] Auto-unstuck wallet ${wallet.name || wallet.id} (was stuck with syncInProgress=true)`);
        await walletRepository.update(wallet.id, { syncInProgress: false });
        unstuckCount++;
      }
    }

    if (unstuckCount > 0) {
      log.info(`[SYNC] Auto-unstuck ${unstuckCount} wallets that had stale syncInProgress flags`);
    }

    // Now check for stale wallets that need syncing
    const { staleThresholdMs } = getConfig().sync;
    const staleWallets = await walletRepository.findStale({ staleThresholdMs });

    for (const wallet of staleWallets) {
      queueSync(wallet.id, 'low');
    }

    if (staleWallets.length > 0) {
      log.info(`[SYNC] Queued ${staleWallets.length} stale wallets for background sync`);
    }
  } catch (error) {
    log.error('[SYNC] Failed to check for stale syncs', { error: getErrorMessage(error) });
  }
}
