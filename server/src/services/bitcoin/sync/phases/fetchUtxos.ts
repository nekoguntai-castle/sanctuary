/**
 * Fetch UTXOs Phase
 *
 * Fetches unspent transaction outputs for all wallet addresses
 * using batch RPC calls. Populates utxoResults, allUtxoKeys, and utxoDataMap.
 */

import { createLogger } from '../../../../utils/logger';
import { getErrorMessage } from '../../../../utils/errors';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('BITCOIN:SVC_SYNC_UTXOS');

/** Number of addresses to fetch per batch RPC call */
const BATCH_SIZE = 50;

/**
 * Execute fetch UTXOs phase
 *
 * Uses batch RPC calls to efficiently fetch UTXOs for all addresses.
 * Falls back to individual requests if batching fails.
 * Tracks which addresses were successfully queried for reconciliation.
 */
export async function fetchUtxosPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, client, addresses } = ctx;

  walletLog(walletId, 'info', 'SYNC', `Fetching UTXOs (${addresses.length} addresses)...`);
  log.debug(`[SYNC] Fetching UTXOs for ${addresses.length} addresses using batch RPC...`);

  const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Log progress for larger wallets
    if (addresses.length > BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `UTXO batch ${batchNum}/${totalBatches}...`);
    }

    try {
      const batchResults = await client.getAddressUTXOsBatch(batchAddresses);
      // Convert Map to array format and track successful fetches
      for (const [addr, utxos] of batchResults) {
        ctx.utxoResults.push({ address: addr, utxos });
        ctx.successfullyFetchedAddresses.add(addr);
      }
    } catch (error) {
      log.warn(`[SYNC] Batch UTXO fetch failed, falling back to individual requests`, { error: getErrorMessage(error) });

      // Fallback to individual requests
      for (const addr of batchAddresses) {
        try {
          const utxos = await client.getAddressUTXOs(addr);
          ctx.utxoResults.push({ address: addr, utxos });
          ctx.successfullyFetchedAddresses.add(addr);
        } catch (e) {
          log.warn(`[SYNC] Failed to get UTXOs for ${addr}`, { error: getErrorMessage(e) });
          // Don't add to successfullyFetchedAddresses - we don't know the true state
        }
      }
    }
  }

  // Collect all UTXO identifiers and build lookup map
  for (const result of ctx.utxoResults) {
    for (const utxo of result.utxos) {
      const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
      ctx.allUtxoKeys.add(key);
      ctx.utxoDataMap.set(key, { address: result.address, utxo });
    }
  }

  ctx.stats.utxosFetched = ctx.allUtxoKeys.size;

  return ctx;
}
