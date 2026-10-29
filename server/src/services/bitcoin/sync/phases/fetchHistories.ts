/**
 * Fetch Histories Phase
 *
 * Fetches transaction history for all wallet addresses using batch RPC calls.
 * Populates historyResults, allTxids, and txHeightMap in the context.
 */

import { createLogger } from '../../../../utils/logger';
import { getErrorMessage } from '../../../../utils/errors';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';
import type { NodeRequestOptions } from '../../nodeClient';
import { authenticateHistoryResults } from '../historyEvidenceAuthentication';
import { recordRejectedEvidence } from '../rejectedEvidence';
import {
  createSyncStageRuntime,
  createSyncWindowRuntime,
  isSyncStageBudgetError,
  mapWithSyncConcurrency,
  SYNC_REMOTE_BATCH_SIZE,
  syncHistoryWindowMs,
  workScaledStageBudgetMs,
  type SyncStageRuntime,
} from '../attemptRuntime';
import { isElectrumResponseTooLargeError } from '../../electrum/protocol';
import { createCooperativeScheduler } from '../../../../utils/cooperativeScheduler';

const log = createLogger('BITCOIN:SVC_SYNC_HISTORIES');

const recordHistoryFetchFailure = (ctx: SyncContext, reason: string): void => {
  recordRejectedEvidence(ctx, reason);
  log.warn('[SYNC] Rejected incomplete address-history evidence', { reason, count: 1 });
};

const isAttemptCancellation = (reason: unknown): boolean => !isSyncStageBudgetError(reason);

/**
 * Execute fetch histories phase
 *
 * Uses batch RPC calls to efficiently fetch transaction history
 * for all wallet addresses. Falls back to individual requests
 * if batching fails.
 */
export async function fetchHistoriesPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, client, addresses } = ctx;

  walletLog(walletId, 'info', 'SYNC', `Fetching address histories (${addresses.length} addresses)...`);
  log.debug(`[SYNC] Fetching history for ${addresses.length} addresses using batch RPC...`);

  // Each stage of the history phase is budgeted from its own item count, and
  // all of them share one window sized from the time left in the attempt.
  const windowOpenedAt = Date.now();
  const historyWindow = ctx.attemptRuntime
    ? createSyncWindowRuntime(
      ctx.attemptRuntime,
      syncHistoryWindowMs(ctx.attemptRuntime.deadlineAt, windowOpenedAt),
      windowOpenedAt,
    )
    : undefined;
  const openStage = historyWindow
    ? (name: string, items: number) => createSyncStageRuntime(
      historyWindow, name, workScaledStageBudgetMs(items),
    )
    : undefined;
  const stage = openStage?.('address_histories', addresses.length);
  const requestOptions = stage
    ? { signal: stage.signal, deadlineAt: stage.deadlineAt }
    : undefined;
  const settledAddresses = new Set<string>();

  try {
    try {
      await fetchAddressHistories(ctx, stage, requestOptions, settledAddresses);
    } catch (error) {
      if (!isSyncStageBudgetError(requestOptions?.signal.reason)) throw error;
      ctx.attemptRuntime?.phaseProgress?.budgetExpired(
        'Address-history fetch exceeded its remote budget; retaining only complete evidence.',
      );
      ctx.attemptRuntime?.phaseProgress?.begin(
        'address_history',
        'Continuing address-history reconciliation with complete evidence.',
        {
          completed: settledAddresses.size,
          total: addresses.length,
          unit: 'addresses',
        },
      );
      for (const { address } of addresses) {
        if (settledAddresses.has(address)) continue;
        ctx.historyResults.set(address, []);
        recordHistoryFetchFailure(ctx, 'fetch_budget_exhausted');
        settledAddresses.add(address);
      }
    }

    let addressesWithActivity = 0;
    const checkpoint = createCooperativeScheduler(requestOptions?.signal, {
      shouldThrowAbort: isAttemptCancellation,
    });
    for (const history of ctx.historyResults.values()) {
      if (history.length > 0) addressesWithActivity++;
      for (const item of history) {
        ctx.allTxids.add(item.tx_hash);
        ctx.txHeightMap.set(item.tx_hash, item.height);
        await checkpoint();
      }
    }

    await authenticateHistoryResults(ctx, { openStage });

    ctx.stats.historiesFetched = ctx.historyResults.size;

    walletLog(
      walletId,
      'info',
      'SYNC',
      `Found ${ctx.allTxids.size} transactions across ${addressesWithActivity} active addresses`,
    );

    return ctx;
  } finally {
    stage?.dispose();
  }
}

async function fetchAddressHistories(
  ctx: SyncContext,
  stage: SyncStageRuntime | undefined,
  requestOptions: NodeRequestOptions | undefined,
  settledAddresses: Set<string>,
): Promise<void> {
  const { walletId, client, addresses } = ctx;
  const totalBatches = Math.ceil(addresses.length / SYNC_REMOTE_BATCH_SIZE);
  const checkpoint = createCooperativeScheduler(requestOptions?.signal, {
    shouldThrowAbort: isAttemptCancellation,
  });
  for (let i = 0; i < addresses.length; i += SYNC_REMOTE_BATCH_SIZE) {
    requestOptions?.signal?.throwIfAborted();
    const batchAddresses = addresses.slice(i, i + SYNC_REMOTE_BATCH_SIZE).map(a => a.address);
    const batchNum = Math.floor(i / SYNC_REMOTE_BATCH_SIZE) + 1;
    if (addresses.length > SYNC_REMOTE_BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `Address history batch ${batchNum}/${totalBatches}...`);
    }

    await client.getAddressHistoryBatch(batchAddresses, requestOptions).then(
      async batchResults => {
        for (const address of batchAddresses) {
          const history = batchResults.get(address);
          ctx.historyResults.set(address, history ?? []);
          if (!history) recordHistoryFetchFailure(ctx, 'missing_history_result');
          settledAddresses.add(address);
          await checkpoint();
        }
      },
      async error => {
        requestOptions?.signal?.throwIfAborted();
        log.warn('[SYNC] Batch history failed, falling back to individual requests', {
          error: getErrorMessage(error),
        });
        await mapWithSyncConcurrency(
          batchAddresses,
          1,
          stage,
          async (address) => {
            try {
              ctx.historyResults.set(
                address,
                await client.getAddressHistory(address, requestOptions),
              );
              settledAddresses.add(address);
            } catch (fallbackError) {
              requestOptions?.signal?.throwIfAborted();
              log.warn(`[SYNC] Failed to get history for ${address}`, {
                error: getErrorMessage(fallbackError),
              });
              ctx.historyResults.set(address, []);
              recordHistoryFetchFailure(
                ctx,
                isElectrumResponseTooLargeError(fallbackError)
                  ? 'response_frame_too_large'
                  : 'history_fetch_failed',
              );
              settledAddresses.add(address);
              return;
            }
          },
        );
      },
    );
  }
}
