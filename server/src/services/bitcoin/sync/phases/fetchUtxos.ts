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
import {
  authenticateProjectedTransactionOutput,
  RawTransactionEvidenceError,
} from '../../rawTransactionEvidence';
import { fetchAuthenticatedTransactions } from '../evidenceAuthentication';
import { recordRejectedEvidence } from '../rejectedEvidence';
import type { NodeRequestOptions } from '../../nodeClient';
import {
  createSyncStageRuntime,
  isSyncStageBudgetError,
  mapWithSyncConcurrency,
  SYNC_REMOTE_FALLBACK_CONCURRENCY,
  type SyncStageRuntime,
} from '../attemptRuntime';
import { transactionOutputScriptHex } from '../transactionOutputEvidence';

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

  const stage = ctx.attemptRuntime
    ? createSyncStageRuntime(ctx.attemptRuntime, 'utxo_observation')
    : undefined;
  const requestOptions = stage
    ? { signal: stage.signal, deadlineAt: stage.deadlineAt }
    : undefined;
  const settledAddresses = new Set<string>();

  try {
    try {
      await fetchAddressUtxos(ctx, stage, requestOptions, settledAddresses);
    } catch (error) {
      if (!isSyncStageBudgetError(requestOptions?.signal.reason)) throw error;
      ctx.attemptRuntime?.phaseProgress?.budgetExpired(
        'UTXO fetch exceeded its remote budget; retaining only authenticated evidence.',
      );
      ctx.attemptRuntime?.phaseProgress?.begin(
        'utxo_reconciliation',
        'Continuing UTXO reconciliation with authenticated evidence.',
        {
          completed: settledAddresses.size,
          total: addresses.length,
          unit: 'addresses',
        },
      );
      for (const { address } of addresses) {
        if (settledAddresses.has(address)) continue;
        recordFailClosed(ctx, 'fetch_budget_exhausted');
        settledAddresses.add(address);
      }
    }
  } finally {
    stage?.dispose();
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

async function fetchAddressUtxos(
  ctx: SyncContext,
  stage: SyncStageRuntime | undefined,
  requestOptions: NodeRequestOptions | undefined,
  settledAddresses: Set<string>,
): Promise<void> {
  const { walletId, client, addresses } = ctx;
  const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    requestOptions?.signal?.throwIfAborted();
    const batchAddresses = addresses.slice(i, i + BATCH_SIZE).map(a => a.address);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (addresses.length > BATCH_SIZE) {
      walletLog(walletId, 'debug', 'SYNC', `UTXO batch ${batchNum}/${totalBatches}...`);
    }

    const batchRequest = requestOptions
      ? client.getAddressUTXOsBatch(batchAddresses, requestOptions)
      : client.getAddressUTXOsBatch(batchAddresses);
    await batchRequest.then(
      async batchResults => {
        for (const address of batchAddresses) {
          const utxos = batchResults.get(address);
          if (utxos) await authenticateAddressUtxos(ctx, address, utxos, requestOptions);
          else recordFailClosed(ctx, 'missing_utxo_result');
          settledAddresses.add(address);
        }
      },
      async error => {
        requestOptions?.signal?.throwIfAborted();
        log.warn('[SYNC] Batch UTXO fetch failed, falling back to individual requests', {
          error: getErrorMessage(error),
        });
        await mapWithSyncConcurrency(
          batchAddresses,
          SYNC_REMOTE_FALLBACK_CONCURRENCY,
          stage,
          async (address) => {
            try {
              const utxos = requestOptions
                ? await client.getAddressUTXOs(address, requestOptions)
                : await client.getAddressUTXOs(address);
              await authenticateAddressUtxos(ctx, address, utxos, requestOptions);
              settledAddresses.add(address);
            } catch (fallbackError) {
              requestOptions?.signal?.throwIfAborted();
              log.warn(`[SYNC] Failed to get UTXOs for ${address}`, {
                error: getErrorMessage(fallbackError),
              });
              recordFailClosed(ctx, 'utxo_fetch_failed');
              settledAddresses.add(address);
              return;
            }
          },
        );
      },
    );
  }
}

const authenticateAddressUtxos = async (
  ctx: SyncContext,
  address: string,
  utxos: SyncContext['utxoResults'][number]['utxos'],
  options?: NodeRequestOptions,
): Promise<void> => {
  const addressRecord = ctx.addressMap.get(address);
  const expectedScript = addressRecord?.scriptPubKey?.toLowerCase();
  if (!expectedScript) {
    recordFailClosed(ctx, 'missing_canonical_script');
    return;
  }

  const authenticatedTxids = await fetchAuthenticatedTransactions(
    ctx,
    utxos.map(utxo => utxo.tx_hash),
    options,
  );
  const accepted = [] as typeof utxos;
  for (const utxo of utxos) {
    if (!authenticatedTxids.has(utxo.tx_hash)) continue;
    try {
      const cached = ctx.txDetailsCache.get(utxo.tx_hash);
      if (!cached) throw new Error('missing_raw_transaction');
      const output = cached.vout[utxo.tx_pos];
      authenticateProjectedTransactionOutput({
        expectedTxid: utxo.tx_hash,
        authenticatedTxid: cached.txid,
        vout: utxo.tx_pos,
        output: output ? {
          value: output.value,
          scriptPubKeyHex: transactionOutputScriptHex(output),
        } : undefined,
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
