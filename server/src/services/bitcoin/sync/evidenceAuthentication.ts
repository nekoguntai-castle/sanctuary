import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { getNetwork } from '../utils';
import {
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import { recordRejectedEvidence } from './rejectedEvidence';
import type {
  RawTransaction,
  SyncContext,
  TransactionOutput,
  TxHistoryEntry,
} from './types';
import type { NodeRequestOptions } from '../nodeClient';
import {
  isSyncStageBudgetError,
  mapWithSyncConcurrency,
  SYNC_REMOTE_FALLBACK_CONCURRENCY,
} from './attemptRuntime';
import { isElectrumResponseTooLargeError } from '../electrum/protocol';
import { createCooperativeScheduler } from '../../../utils/cooperativeScheduler';

const log = createLogger('BITCOIN:SVC_SYNC_EVIDENCE');
const FETCH_BATCH_SIZE = 100;
const isAttemptCancellation = (reason: unknown): boolean => !isSyncStageBudgetError(reason);

/** Sentinel for "the server listed this txid but returned no entry for it". */
const MISSING_RESULT = 'missing_result';

// `missing_result` (the server returned no entry for a txid it listed) and a
// genuine transport failure are different faults with different remedies, so
// they no longer collapse into one `fetch_failed` label.
const reasonCode = (error: unknown): string => {
  if (error instanceof RawTransactionEvidenceError) return error.reason;
  // getErrorMessage already normalises a non-Error throw, so there is no
  // unreachable `instanceof Error` fallback to carry here.
  return getErrorMessage(error) === MISSING_RESULT ? MISSING_RESULT : 'fetch_failed';
};

const recordFailClosed = (ctx: SyncContext, reason: string): void => {
  recordRejectedEvidence(ctx, reason);
  log.warn('[SYNC] Rejected unauthenticated transaction evidence', { reason, count: 1 });
};

const decodeAddress = (script: Uint8Array, ctx: SyncContext): string | undefined => {
  try {
    return bitcoin.address.fromOutputScript(script, getNetwork(ctx.network));
  } catch {
    return undefined;
  }
};

const toAuthenticatedDetails = (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction,
): RawTransaction => {
  const authenticated = parseAuthenticatedRawTransaction({
    expectedTxid,
    rawHex: details.hex ?? '',
  });
  if (details.txid.toLowerCase() !== authenticated.txid) {
    throw new RawTransactionEvidenceError('txid_mismatch');
  }
  const transaction = authenticated.transaction;
  return {
    txid: authenticated.txid,
    time: details.time,
    blocktime: details.blocktime,
    blockheight: details.blockheight,
    confirmations: details.confirmations,
    blockhash: details.blockhash,
    hex: authenticated.canonicalHex,
    vin: transaction.ins.map(input => {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const coinbase = txid === '00'.repeat(32) && input.index === 0xffffffff;
      return coinbase
        ? { coinbase: Buffer.from(input.script).toString('hex') }
        : { txid, vout: input.index };
    }),
    vout: transaction.outs.map((output, n): TransactionOutput => {
      const address = decodeAddress(output.script, ctx);
      return {
        n,
        value: Number(output.value) / 100_000_000,
        scriptPubKey: {
          hex: Buffer.from(output.script).toString('hex'),
          address,
          addresses: address ? [address] : [],
        },
      };
    }),
  };
};

const cacheAuthenticatedResult = (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction | undefined,
): boolean => {
  try {
    if (!details) throw new Error(MISSING_RESULT);
    ctx.txDetailsCache.set(expectedTxid, toAuthenticatedDetails(ctx, expectedTxid, details));
    return true;
  } catch (error) {
    ctx.txDetailsCache.delete(expectedTxid);
    recordFailClosed(ctx, reasonCode(error));
    return false;
  }
};

/** Fetches raw transactions and puts only txid-bound, byte-derived details in the cache. */
export async function fetchAuthenticatedTransactions(
  ctx: SyncContext,
  txids: readonly string[],
  options?: NodeRequestOptions,
): Promise<Set<string>> {
  if (options?.signal?.aborted && isAttemptCancellation(options.signal.reason)) {
    options.signal.throwIfAborted();
  }
  const checkpoint = createCooperativeScheduler(options?.signal, {
    shouldThrowAbort: isAttemptCancellation,
  });
  const accepted = new Set<string>();
  const settled = new Set<string>();
  const unique = [...new Set(txids)];
  for (const txid of unique) {
    if (ctx.txDetailsCache.has(txid)) {
      accepted.add(txid);
      settled.add(txid);
    }
    await checkpoint();
  }
  const pending = unique.filter(txid => !accepted.has(txid));
  if (options?.signal?.aborted) {
    for (const txid of pending) {
      recordFailClosed(ctx, 'fetch_budget_exhausted');
    }
    return accepted;
  }
  for (let offset = 0; offset < pending.length; offset += FETCH_BATCH_SIZE) {
    if (options?.signal?.aborted) {
      for (const txid of pending.slice(offset)) {
        recordFailClosed(ctx, 'fetch_budget_exhausted');
      }
      return accepted;
    }
    const batchTxids = pending.slice(offset, offset + FETCH_BATCH_SIZE);
    let budgetExpired = false;
    let oversizedFrame = false;
    const batchRequest = options
      ? ctx.client.getTransactionsBatch(batchTxids, false, options)
      : ctx.client.getTransactionsBatch(batchTxids, false);
    const results = await batchRequest.then(
      value => value,
      (error) => {
        if (options?.signal?.aborted) {
          if (isSyncStageBudgetError(options.signal.reason)) {
            for (const txid of batchTxids) {
              recordFailClosed(ctx, 'fetch_budget_exhausted');
            }
            budgetExpired = true;
            return undefined;
          }
          options.signal.throwIfAborted();
        }
        if (isElectrumResponseTooLargeError(error)) {
          for (const txid of batchTxids) {
            recordFailClosed(ctx, 'response_frame_too_large');
            settled.add(txid);
          }
          oversizedFrame = true;
        }
        return undefined;
      },
    );
    if (budgetExpired) return accepted;
    if (oversizedFrame) continue;
    if (results) {
      for (const txid of batchTxids) {
        if (cacheAuthenticatedResult(ctx, txid, results.get(txid))) accepted.add(txid);
        settled.add(txid);
        await checkpoint();
      }
    } else {
      try {
        await mapWithSyncConcurrency(
          batchTxids,
          SYNC_REMOTE_FALLBACK_CONCURRENCY,
          options?.signal ? { signal: options.signal } : undefined,
          async (txid) => {
            try {
              const details = options
                ? await ctx.client.getTransaction(txid, false, options)
                : await ctx.client.getTransaction(txid, false);
              if (cacheAuthenticatedResult(ctx, txid, details)) accepted.add(txid);
              settled.add(txid);
              await checkpoint();
            } catch (error) {
              options?.signal?.throwIfAborted();
              recordFailClosed(
                ctx,
                isElectrumResponseTooLargeError(error)
                  ? 'response_frame_too_large'
                  : 'fetch_failed',
              );
              settled.add(txid);
              await checkpoint();
            }
          },
        );
      } catch (error) {
        if (options?.signal?.aborted && isSyncStageBudgetError(options.signal.reason)) {
          for (const txid of batchTxids) {
            if (!settled.has(txid)) recordFailClosed(ctx, 'fetch_budget_exhausted');
          }
          return accepted;
        }
        throw error;
      }
    }
  }
  return accepted;
}

const previousTxids = async (
  ctx: SyncContext,
  txids: Iterable<string>,
  checkpoint: () => Promise<void>,
): Promise<string[]> => {
  const result = new Set<string>();
  for (const txid of txids) {
    for (const input of ctx.txDetailsCache.get(txid)?.vin ?? []) {
      if (!input.coinbase && input.txid) result.add(input.txid);
      await checkpoint();
    }
  }
  return [...result];
};

const paysScript = async (
  details: RawTransaction,
  script: string,
  checkpoint: () => Promise<void>,
): Promise<boolean> => {
  for (const output of details.vout) {
    if (output.scriptPubKey.hex?.toLowerCase() === script) return true;
    await checkpoint();
  }
  return false;
};

const spendsScript = async (
  ctx: SyncContext,
  details: RawTransaction,
  script: string,
  checkpoint: () => Promise<void>,
): Promise<boolean> => {
  for (const input of details.vin) {
    if (input.txid && input.vout !== undefined) {
      const previousScript = ctx.txDetailsCache
        .get(input.txid)
        ?.vout[input.vout]
        ?.scriptPubKey.hex
        ?.toLowerCase();
      if (previousScript === script) return true;
    }
    await checkpoint();
  }
  return false;
};

const collectAuthenticatedSpentOutpoints = async (
  ctx: SyncContext,
  acceptedCurrent: ReadonlySet<string>,
  checkpoint: () => Promise<void>,
): Promise<void> => {
  ctx.authenticatedSpentOutpointKeys.clear();
  for (const txid of acceptedCurrent) {
    for (const input of ctx.txDetailsCache.get(txid)?.vin ?? []) {
      if (input.txid && input.vout !== undefined) {
        const previous = ctx.txDetailsCache.get(input.txid)?.vout[input.vout];
        const script = previous?.scriptPubKey.hex?.toLowerCase();
        if (script && ctx.walletScriptToAddress.has(script)) {
          ctx.authenticatedSpentOutpointKeys.add(`${input.txid}:${input.vout}`);
        }
      }
      await checkpoint();
    }
  }
};

const authenticateAddressHistory = async (
  ctx: SyncContext,
  address: SyncContext['addresses'][number],
  acceptedCurrent: ReadonlySet<string>,
  checkpoint: () => Promise<void>,
): Promise<TxHistoryEntry[]> => {
  const script = address.scriptPubKey?.toLowerCase();
  const history = ctx.historyResults.get(address.address) ?? [];
  if (script === undefined) return [];
  const authenticated: TxHistoryEntry[] = [];
  for (const item of history) {
    const details = acceptedCurrent.has(item.tx_hash)
      ? ctx.txDetailsCache.get(item.tx_hash)
      : undefined;
    const relevant = details !== undefined
      && (await paysScript(details, script, checkpoint)
        || await spendsScript(ctx, details, script, checkpoint));
    if (details !== undefined && !relevant) {
      recordFailClosed(ctx, 'history_script_mismatch');
    }
    if (relevant) authenticated.push(item);
    await checkpoint();
  }
  return authenticated;
};

/** Replaces remote history with only raw-authenticated, script-relevant entries. */
export async function authenticateHistoryResults(
  ctx: SyncContext,
  options?: NodeRequestOptions,
): Promise<void> {
  const checkpoint = createCooperativeScheduler(options?.signal, {
    shouldThrowAbort: isAttemptCancellation,
  });
  const currentTxidSet = new Set<string>();
  for (const history of ctx.historyResults.values()) {
    for (const item of history) {
      currentTxidSet.add(item.tx_hash);
      await checkpoint();
    }
  }
  const currentTxids = [...currentTxidSet];
  const acceptedCurrent = await fetchAuthenticatedTransactions(ctx, currentTxids, options);
  const previous = await previousTxids(ctx, acceptedCurrent, checkpoint);
  await fetchAuthenticatedTransactions(ctx, previous, options);

  await collectAuthenticatedSpentOutpoints(ctx, acceptedCurrent, checkpoint);

  const filtered = new Map<string, TxHistoryEntry[]>();
  for (const address of ctx.addresses) {
    filtered.set(
      address.address,
      await authenticateAddressHistory(ctx, address, acceptedCurrent, checkpoint),
    );
  }
  ctx.historyResults = filtered;
  ctx.allTxids = new Set();
  ctx.txHeightMap = new Map();
  for (const history of filtered.values()) {
    for (const item of history) {
      ctx.allTxids.add(item.tx_hash);
      ctx.txHeightMap.set(item.tx_hash, item.height);
      await checkpoint();
    }
  }
}
