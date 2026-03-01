/**
 * Sync Queue Management
 *
 * Handles priority-based queue ordering, enqueueing, and dispatching
 * of wallet sync jobs. Enforces queue size limits and priority eviction.
 */

import { getConfig } from '../../config';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { SyncJob, SyncState, SyncResult } from './types';
import { MAX_QUEUE_SIZE } from './types';

const log = createLogger('SYNC:QUEUE');

/**
 * Sort the queue by priority (high > normal > low), then by request time (FIFO within same priority).
 */
export function sortQueue(state: SyncState): void {
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  state.syncQueue.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.requestedAt.getTime() - b.requestedAt.getTime();
  });
}

/**
 * Queue a wallet for sync.
 *
 * @param executeSyncJob - Callback to execute sync when queue is processed.
 *   Provided by the main SyncService to avoid circular dependency.
 */
export function queueSync(
  state: SyncState,
  walletId: string,
  priority: 'high' | 'normal' | 'low' = 'normal',
  executeSyncJob: (walletId: string) => Promise<SyncResult>,
): void {
  // Don't queue if already actively syncing
  if (state.activeSyncs.has(walletId)) {
    log.info(`[SYNC] Wallet ${walletId} already syncing, skipping queue`);
    return;
  }

  const existingIndex = state.syncQueue.findIndex(j => j.walletId === walletId);
  if (existingIndex >= 0) {
    // Upgrade priority if higher
    if (priority === 'high' && state.syncQueue[existingIndex].priority !== 'high') {
      state.syncQueue[existingIndex].priority = 'high';
      sortQueue(state);
    }
    return;
  }

  // Enforce queue size limit to prevent unbounded memory growth
  if (state.syncQueue.length >= MAX_QUEUE_SIZE) {
    // Try to evict a low-priority job
    const lowPriorityIndex = state.syncQueue.findIndex(j => j.priority === 'low');
    if (lowPriorityIndex >= 0) {
      const evicted = state.syncQueue.splice(lowPriorityIndex, 1)[0];
      log.warn(`[SYNC] Queue full, evicted low-priority wallet ${evicted.walletId}`);
    } else if (priority === 'low') {
      // Don't add low-priority if queue is full of higher priority
      log.warn(`[SYNC] Queue full (${MAX_QUEUE_SIZE}), rejecting low-priority wallet ${walletId}`);
      return;
    } else {
      // Evict oldest normal priority for high priority request
      const normalIndex = state.syncQueue.findIndex(j => j.priority === 'normal');
      if (normalIndex >= 0 && priority === 'high') {
        const evicted = state.syncQueue.splice(normalIndex, 1)[0];
        log.warn(`[SYNC] Queue full, evicted normal-priority wallet ${evicted.walletId} for high-priority`);
      } else {
        log.warn(`[SYNC] Queue full (${MAX_QUEUE_SIZE}), rejecting wallet ${walletId}`);
        return;
      }
    }
  }

  state.syncQueue.push({
    walletId,
    priority,
    requestedAt: new Date(),
  });

  sortQueue(state);
  log.info(`[SYNC] Queued wallet ${walletId} with ${priority} priority (queue size: ${state.syncQueue.length})`);

  // Start processing if not already
  processQueue(state, executeSyncJob);
}

/**
 * Process the sync queue, dispatching jobs up to maxConcurrentSyncs.
 */
export function processQueue(
  state: SyncState,
  executeSyncJob: (walletId: string) => Promise<SyncResult>,
): void {
  if (!state.isRunning) return;

  const { maxConcurrentSyncs } = getConfig().sync;
  while (state.syncQueue.length > 0 && state.activeSyncs.size < maxConcurrentSyncs) {
    const job = state.syncQueue.shift();
    if (!job) break;

    // Don't await - run concurrently
    executeSyncJob(job.walletId).catch(err => {
      log.error(`[SYNC] Failed to sync wallet ${job.walletId}`, { error: getErrorMessage(err) });
    });
  }
}
