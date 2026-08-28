import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import { recordRejectedEvidence } from './rejectedEvidence';
import type {
  RawTransaction,
  SyncContext,
  TxHistoryEntry,
} from './types';
import type { NodeRequestOptions } from '../nodeClient';
import { isSyncStageBudgetError } from './attemptRuntime';
import { isElectrumResponseTooLargeError } from '../electrum/protocol';
import { createCooperativeScheduler } from '../../../utils/cooperativeScheduler';
import {
  createTransactionEvidenceProjector,
  projectedTransactionEvidenceComplexity,
  type TransactionEvidenceProjector,
} from './transactionEvidenceThread';
import { transactionOutputScriptHex } from './transactionOutputEvidence';

const log = createLogger('BITCOIN:SVC_SYNC_EVIDENCE');
const FETCH_BATCH_SIZE = 10;
export const MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT = 64 * 1024 * 1024;
export const MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT = 100_000;
export const MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT = 600_000;
export const MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT = 64 * 1024 * 1024;
export const MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION = 25_000;
export const MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION = 25_000;
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

interface EvidenceComplexity {
  rawHexChars: number;
  inputs: number;
  outputs: number;
  scriptHexChars: number;
}

const evidenceComplexity = new WeakMap<SyncContext, EvidenceComplexity>();

const addDetailsComplexity = (total: EvidenceComplexity, details: RawTransaction): void => {
  total.rawHexChars += details.hex?.length ?? (details.raw?.byteLength ?? 0) * 2;
  total.inputs += details.vin.length;
  total.outputs += details.vout.length;
  for (const input of details.vin) total.scriptHexChars += input?.coinbase?.length ?? 0;
  for (const output of details.vout) {
    total.scriptHexChars += transactionOutputScriptHex(output)?.length ?? 0;
  }
};

const complexityFor = (ctx: SyncContext): EvidenceComplexity => {
  const existing = evidenceComplexity.get(ctx);
  if (existing) return existing;
  const initialized = { rawHexChars: 0, inputs: 0, outputs: 0, scriptHexChars: 0 };
  for (const details of ctx.txDetailsCache.values()) addDetailsComplexity(initialized, details);
  evidenceComplexity.set(ctx, initialized);
  return initialized;
};

const remainingProjectionLimits = (
  complexity: EvidenceComplexity,
) => ({
  maxInputs: Math.min(
    MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION,
    MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT - complexity.inputs,
  ),
  maxOutputs: Math.min(
    MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION,
    MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT - complexity.outputs,
  ),
  maxScriptHexChars:
    MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT - complexity.scriptHexChars,
});

const rawHexFits = (complexity: EvidenceComplexity, details: RawTransaction): boolean => {
  const rawHexChars = details.hex?.length ?? 0;
  return rawHexChars <= MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT
    - complexity.rawHexChars;
};

const mapEvidenceFallbacks = async <T>(
  items: readonly T[],
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  for (const item of items) {
    signal?.throwIfAborted();
    await fn(item);
    signal?.throwIfAborted();
  }
};

const cacheAuthenticatedResult = async (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction | undefined,
  projector: TransactionEvidenceProjector,
  signal?: AbortSignal,
): Promise<boolean> => {
  try {
    if (!details) throw new Error(MISSING_RESULT);
    const complexity = complexityFor(ctx);
    if (!rawHexFits(complexity, details)) {
      throw new RawTransactionEvidenceError('transaction_complexity_exceeded');
    }
    const authenticated = await projector.project(
      {
        expectedTxid,
        details,
        network: ctx.network,
        limits: remainingProjectionLimits(complexity),
      },
      signal,
    );
    const projected = projectedTransactionEvidenceComplexity(authenticated);
    if (projected) {
      complexity.rawHexChars += projected.rawHexChars;
      complexity.inputs += projected.inputs;
      complexity.outputs += projected.outputs;
      complexity.scriptHexChars += projected.scriptHexChars;
    } else {
      addDetailsComplexity(complexity, authenticated);
    }
    ctx.txDetailsCache.set(expectedTxid, authenticated);
    return true;
  } catch (error) {
    if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();
    ctx.txDetailsCache.delete(expectedTxid);
    recordFailClosed(
      ctx,
      signal?.aborted && isSyncStageBudgetError(signal.reason)
        ? 'fetch_budget_exhausted'
        : reasonCode(error),
    );
    return false;
  }
};

/** Fetches raw transactions and puts only txid-bound, byte-derived details in the cache. */
export async function fetchAuthenticatedTransactions(
  ctx: SyncContext,
  txids: readonly string[],
  options?: NodeRequestOptions,
): Promise<Set<string>> {
  const unique = [...new Set(txids)];
  if (unique.every(txid => ctx.txDetailsCache.has(txid))) {
    if (options?.signal?.aborted && isAttemptCancellation(options.signal.reason)) {
      options.signal.throwIfAborted();
    }
    return new Set(unique);
  }
  const projector = createTransactionEvidenceProjector();
  try {
    return await fetchAuthenticatedTransactionsWithProjector(ctx, txids, projector, options);
  } finally {
    await projector.close();
  }
}

async function fetchAuthenticatedTransactionsWithProjector(
  ctx: SyncContext,
  txids: readonly string[],
  projector: TransactionEvidenceProjector,
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
  const recordUnsettledBudget = (): void => {
    for (const txid of pending) {
      if (settled.has(txid)) continue;
      recordFailClosed(ctx, 'fetch_budget_exhausted');
      settled.add(txid);
    }
  };
  if (options?.signal?.aborted) {
    recordUnsettledBudget();
    return accepted;
  }
  for (let offset = 0; offset < pending.length; offset += FETCH_BATCH_SIZE) {
    const batchTxids = pending.slice(offset, offset + FETCH_BATCH_SIZE);
    let budgetExpired = false;
    let oversizedFrame = false;
    const batchRequest = ctx.client.getRawTransactionEvidenceBatch
      ? ctx.client.getRawTransactionEvidenceBatch(batchTxids, options)
      : options
        ? ctx.client.getTransactionsBatch(batchTxids, false, options)
        : ctx.client.getTransactionsBatch(batchTxids, false);
    const results = await batchRequest.then(
      value => value,
      (error) => {
        if (options?.signal?.aborted) {
          if (isSyncStageBudgetError(options.signal.reason)) {
            recordUnsettledBudget();
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
        if (await cacheAuthenticatedResult(
          ctx,
          txid,
          results.get(txid),
          projector,
          options?.signal,
        )) accepted.add(txid);
        settled.add(txid);
        if (options?.signal?.aborted && isSyncStageBudgetError(options.signal.reason)) {
          recordUnsettledBudget();
          return accepted;
        }
        await checkpoint();
        if (options?.signal?.aborted && isSyncStageBudgetError(options.signal.reason)) {
          recordUnsettledBudget();
          return accepted;
        }
      }
    } else {
      try {
        await mapEvidenceFallbacks(
          batchTxids,
          options?.signal,
          async (txid) => {
            try {
              const details = ctx.client.getRawTransactionEvidence
                ? await ctx.client.getRawTransactionEvidence(txid, options)
                : options
                  ? await ctx.client.getTransaction(txid, false, options)
                  : await ctx.client.getTransaction(txid, false);
              const authenticated = await cacheAuthenticatedResult(
                ctx,
                txid,
                details,
                projector,
                options?.signal,
              );
              if (authenticated) {
                accepted.add(txid);
              } else {
                accepted.delete(txid);
              }
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
          recordUnsettledBudget();
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
    if (transactionOutputScriptHex(output)?.toLowerCase() === script) return true;
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
      const previousScript = transactionOutputScriptHex(
        ctx.txDetailsCache.get(input.txid)?.vout[input.vout],
      )?.toLowerCase();
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
        const script = transactionOutputScriptHex(previous)?.toLowerCase();
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
