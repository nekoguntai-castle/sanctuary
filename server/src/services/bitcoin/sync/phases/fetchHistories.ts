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

const log = createLogger('BITCOIN:SVC_SYNC_HISTORIES');

/** Number of addresses to fetch per batch RPC call */
const BATCH_SIZE = 50;

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

  const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

  // Process addresses in batches
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Log progress for larger wallets
    if (addresses.length > BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `Address history batch ${batchNum}/${totalBatches}...`);
    }

    try {
      const batchResults = await client.getAddressHistoryBatch(batchAddresses);
      // Merge results into context
      for (const [addr, history] of batchResults) {
        ctx.historyResults.set(addr, history);
      }
    } catch (error) {
      log.warn(`[SYNC] Batch history failed, falling back to individual requests`, { error: getErrorMessage(error) });

      // Fallback to individual requests
      for (const addr of batchAddresses) {
        try {
          const history = await client.getAddressHistory(addr);
          ctx.historyResults.set(addr, history);
        } catch (e) {
          log.warn(`[SYNC] Failed to get history for ${addr}`, { error: getErrorMessage(e) });
          ctx.historyResults.set(addr, []);
        }
      }
    }
  }

  // Collect all unique txids and build height map
  let addressesWithActivity = 0;
  for (const [, history] of ctx.historyResults.entries()) {
    if (history.length > 0) {
      addressesWithActivity++;
    }
    for (const item of history) {
      ctx.allTxids.add(item.tx_hash);
      ctx.txHeightMap.set(item.tx_hash, item.height);
    }
  }

  ctx.stats.historiesFetched = ctx.historyResults.size;

  walletLog(
    walletId,
    'info',
    'SYNC',
    `Found ${ctx.allTxids.size} transactions across ${addressesWithActivity} active addresses`
  );

  return ctx;
}
