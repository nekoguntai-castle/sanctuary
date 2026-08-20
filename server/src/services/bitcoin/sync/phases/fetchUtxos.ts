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
import { authenticateRawTransactionOutput, RawTransactionEvidenceError } from '../../rawTransactionEvidence';
import { fetchAuthenticatedTransactions } from '../evidenceAuthentication';
import { recordRejectedEvidence } from '../rejectedEvidence';

const log = createLogger('BITCOIN:SVC_SYNC_UTXOS');

const recordFailClosed = (ctx: SyncContext, reason: string): void => {
  recordRejectedEvidence(ctx, reason);
  log.warn('[SYNC] Rejected unauthenticated UTXO evidence', { reason, count: 1 });
};

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
      for (const addr of batchAddresses) {
        const utxos = batchResults.get(addr);
        if (utxos) {
          await authenticateAddressUtxos(ctx, addr, utxos);
        } else {
          recordFailClosed(ctx, 'missing_utxo_result');
        }
      }
    } catch (error) {
      log.warn(`[SYNC] Batch UTXO fetch failed, falling back to individual requests`, { error: getErrorMessage(error) });

      // Fallback to individual requests
      for (const addr of batchAddresses) {
        try {
          const utxos = await client.getAddressUTXOs(addr);
          await authenticateAddressUtxos(ctx, addr, utxos);
        } catch (e) {
          log.warn(`[SYNC] Failed to get UTXOs for ${addr}`, { error: getErrorMessage(e) });
          recordFailClosed(ctx, 'utxo_fetch_failed');
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

const authenticateAddressUtxos = async (
  ctx: SyncContext,
  address: string,
  utxos: SyncContext['utxoResults'][number]['utxos'],
): Promise<void> => {
  const addressRecord = ctx.addressMap.get(address);
  const expectedScript = addressRecord?.scriptPubKey?.toLowerCase();
  if (!expectedScript) {
    recordFailClosed(ctx, 'missing_canonical_script');
    return;
  }

  await fetchAuthenticatedTransactions(ctx, utxos.map(utxo => utxo.tx_hash));
  const accepted = [] as typeof utxos;
  for (const utxo of utxos) {
    try {
      const rawHex = ctx.txDetailsCache.get(utxo.tx_hash)?.hex;
      if (!rawHex) throw new Error('missing_raw_transaction');
      authenticateRawTransactionOutput({
        expectedTxid: utxo.tx_hash,
        rawHex,
        vout: utxo.tx_pos,
        expectedValueSats: BigInt(utxo.value),
        expectedScriptPubKeyHex: expectedScript,
      });
      accepted.push(utxo);
    } catch (error) {
      recordFailClosed(
        ctx,
        error instanceof RawTransactionEvidenceError ? error.reason : 'missing_raw_transaction',
      );
    }
  }

  // Accepted siblings remain useful, but any invalid member makes omission
  // non-authoritative for destructive spent/draft reconciliation.
  ctx.utxoResults.push({ address, utxos: accepted });
  // A successful listunspent response authenticates listed outputs, not the
  // absence of an output. Spending requires authenticated transaction input
  // evidence; omission alone must never delete prior state or drafts.
};
