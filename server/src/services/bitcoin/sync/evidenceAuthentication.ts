import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { RawTransactionEvidenceError } from '../rawTransactionEvidence';
import { recordRejectedEvidence } from './rejectedEvidence';
import type {
  EvidenceProjectionRole,
  RawTransaction,
  SyncContext,
} from './types';
import type { NodeRequestOptions } from '../nodeClient';
import { isSyncStageBudgetError } from './attemptRuntime';
import { isElectrumResponseTooLargeError } from '../electrum/protocol';
import { createCooperativeScheduler } from '../../../utils/cooperativeScheduler';
import {
  createCompactTransactionEvidenceProjector,
  DetachedTransactionEvidenceError,
  type CompactTransactionEvidenceProjector,
} from './transactionEvidenceThread';
import type {
  ExactTransactionOutputsEvidenceResult,
  TransactionEvidenceComplexity,
} from './transactionEvidenceProjection';
import { transactionOutputScriptHex } from './transactionOutputEvidence';
import {
  recordCompactProjection,
  recordExactOutputProjection,
  recordFullProjection,
  recordRemoteEvidenceFetch,
  releaseAuthenticatedTransactionDetails,
} from './evidenceArchitectureReceipts';

export { releaseAuthenticatedTransactionDetails } from './evidenceArchitectureReceipts';

const log = createLogger('BITCOIN:SVC_SYNC_EVIDENCE');
const FETCH_BATCH_SIZE = 10;
const MISSING_RESULT = 'missing_result';
export const MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT = 64 * 1024 * 1024;
export const MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT = 100_000;
/**
 * Bounds decoded outputs charged to the attempt (legacy detail entries). Compact
 * envelopes retain none; the current batch's full projections are bounded by the
 * candidate batch size × the per-transaction output limit.
 */
export const MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT = 600_000;
export const MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT = 64 * 1024 * 1024;
export const MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION = 25_000;
export const MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION = 25_000;
/** A refusal caused by the attempt's remaining capacity, not by the transaction alone. */
export const ATTEMPT_EVIDENCE_CAPACITY_EXCEEDED = 'attempt_evidence_capacity_exceeded';
const TRANSACTION_COMPLEXITY_EXCEEDED = 'transaction_complexity_exceeded';
type ComplexityRefusalReason = typeof ATTEMPT_EVIDENCE_CAPACITY_EXCEEDED | typeof TRANSACTION_COMPLEXITY_EXCEEDED;

const isAttemptCancellation = (reason: unknown): boolean => !isSyncStageBudgetError(reason);

const reasonCode = (error: unknown): string => {
  if (error instanceof RawTransactionEvidenceError) return error.reason;
  if (typeof error === 'object' && error !== null && 'reason' in error
    && typeof error.reason === 'string') return error.reason;
  return getErrorMessage(error) === MISSING_RESULT ? MISSING_RESULT : 'fetch_failed';
};

const recordFailClosed = (ctx: SyncContext, reason: string): void => {
  recordRejectedEvidence(ctx, reason);
  log.warn('[SYNC] Rejected unauthenticated transaction evidence', { reason, count: 1 });
};

interface EvidenceComplexity extends TransactionEvidenceComplexity {}
const evidenceComplexity = new WeakMap<SyncContext, EvidenceComplexity>();
const outpointFetchTails = new WeakMap<SyncContext, Promise<void>>();
const attemptOnlySignals = new WeakMap<AbortSignal, AbortSignal>();
const capacityLoggedAttempts = new WeakSet<SyncContext>();

export interface EvidenceRequestOptions extends NodeRequestOptions {
  evidenceRole?: EvidenceProjectionRole;
}

export const clearAuthenticatedEvidenceComplexity = (ctx: SyncContext): void => {
  evidenceComplexity.delete(ctx);
};

export const releaseAuthenticatedEvidence = (
  ctx: SyncContext,
  scope: 'attempt' | 'rollback',
): void => {
  releaseAuthenticatedTransactionDetails(ctx, { scope });
  ctx.authenticatedTransactionEvidence.clear();
  ctx.authenticatedOutpointEvidence.clear();
  ctx.authenticatedOutpointCoverage.clear();
  ctx.authenticatedSpentOutpointKeys.clear();
  clearAuthenticatedEvidenceComplexity(ctx);
};

export const authenticatedRawHexChars = (
  details: RawTransaction,
  compactFallbackChars = 0,
): number => details.hex !== undefined
  ? details.hex.length
  : details.raw !== undefined ? details.raw.byteLength * 2 : compactFallbackChars;

const addComplexity = (
  target: EvidenceComplexity,
  addition: TransactionEvidenceComplexity,
): void => {
  target.rawHexChars += addition.rawHexChars;
  target.inputs += addition.inputs;
  target.outputs += addition.outputs;
  target.scriptHexChars += addition.scriptHexChars;
};

const addLegacyDetailsComplexity = (
  target: EvidenceComplexity,
  details: RawTransaction,
): void => {
  target.rawHexChars += authenticatedRawHexChars(details);
  target.inputs += details.vin.length;
  target.outputs += details.vout.length;
  for (const input of details.vin) target.scriptHexChars += input?.coinbase?.length ?? 0;
  for (const output of details.vout) {
    target.scriptHexChars += transactionOutputScriptHex(output)?.length ?? 0;
  }
};

/**
 * A compact envelope keeps its canonical bytes, packed input outpoints and the
 * indexes of wallet scripts it pays, never a decoded output. Its outputs were
 * scanned once by the projector (bounded per transaction) and are not resident,
 * so they are not charged to the attempt's retained-output ceiling.
 */
const retainedEnvelopeComplexity = (
  complexity: TransactionEvidenceComplexity,
): TransactionEvidenceComplexity => ({ ...complexity, outputs: 0 });

const complexityFor = (ctx: SyncContext): EvidenceComplexity => {
  const existing = evidenceComplexity.get(ctx);
  if (existing) return existing;
  const initialized = { rawHexChars: 0, inputs: 0, outputs: 0, scriptHexChars: 0 };
  for (const envelope of ctx.authenticatedTransactionEvidence.values()) {
    addComplexity(initialized, retainedEnvelopeComplexity(envelope.complexity));
  }
  for (const [txid, details] of ctx.txDetailsCache) {
    if (!ctx.authenticatedTransactionEvidence.has(txid)) {
      addLegacyDetailsComplexity(initialized, details);
    }
  }
  evidenceComplexity.set(ctx, initialized);
  return initialized;
};

const remainingProjectionLimits = (complexity: EvidenceComplexity) => ({
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

const rawHexFits = (complexity: EvidenceComplexity, details: RawTransaction): boolean => (
  authenticatedRawHexChars(details)
  <= MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT - complexity.rawHexChars
);

/**
 * Relabels a complexity refusal as attempt capacity when an attempt remainder,
 * not a per-transaction limit, was the binding one. A raw-hex refusal is
 * capacity only when the transaction alone would fit a fresh attempt; the
 * projector arms apply only when the raw-hex check passed.
 */
const complexityRefusalReason = (
  complexity: EvidenceComplexity,
  details: RawTransaction,
  rawHexRefused: boolean,
): ComplexityRefusalReason => {
  // Each arm reads "the attempt remainder is below the per-transaction bound". A
  // transaction's script bytes are a subset of its canonical bytes, so its raw-hex
  // length bounds its script hex. The projector cannot say which limit it hit, so
  // a refusal on a nearly full attempt reads as capacity (plan D-15.11).
  const transactionHexChars = authenticatedRawHexChars(details);
  const attemptBound = rawHexRefused
    ? MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT >= transactionHexChars
    : complexity.inputs
        > MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT - MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION
      || complexity.outputs
        > MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT - MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION
      || complexity.scriptHexChars + transactionHexChars
        > MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT;
  return attemptBound ? ATTEMPT_EVIDENCE_CAPACITY_EXCEEDED : TRANSACTION_COMPLEXITY_EXCEEDED;
};

/**
 * Records a compact refusal under its label and logs the first capacity refusal
 * of an attempt once at error, with the used resident counters only (outputs
 * are not resident, see retainedEnvelopeComplexity).
 */
const recordCompactRefusal = (
  ctx: SyncContext,
  reason: string,
  details: RawTransaction | undefined,
  rawHexRefused: boolean,
): void => {
  const label = reason === TRANSACTION_COMPLEXITY_EXCEEDED && details
    ? complexityRefusalReason(complexityFor(ctx), details, rawHexRefused)
    : reason;
  if (label === ATTEMPT_EVIDENCE_CAPACITY_EXCEEDED && !capacityLoggedAttempts.has(ctx)) {
    capacityLoggedAttempts.add(ctx);
    const { rawHexChars, inputs, scriptHexChars } = complexityFor(ctx);
    log.error('[SYNC] Wallet history exceeds the per-attempt authenticated evidence capacity', {
      walletId: ctx.walletId,
      rawHexChars,
      inputs,
      scriptHexChars,
    });
  }
  recordFailClosed(ctx, label);
};

const shouldRethrow = (error: unknown, signal?: AbortSignal): boolean => (
  error instanceof DetachedTransactionEvidenceError
  || Boolean(signal?.aborted && isAttemptCancellation(signal.reason))
);

const localProjectionSignal = (
  ctx: SyncContext,
  fallback?: AbortSignal,
): AbortSignal | undefined => {
  if (ctx.attemptRuntime) return ctx.attemptRuntime.signal;
  if (!fallback) return undefined;
  const existing = attemptOnlySignals.get(fallback);
  if (existing) return existing;
  const controller = new AbortController();
  const forwardAttemptCancellation = (): void => {
    if (isAttemptCancellation(fallback.reason)) controller.abort(fallback.reason);
  };
  if (fallback.aborted) forwardAttemptCancellation();
  else fallback.addEventListener('abort', forwardAttemptCancellation, { once: true });
  attemptOnlySignals.set(fallback, controller.signal);
  return controller.signal;
};

const throwIfAttemptCancelled = (ctx: SyncContext, fallback?: AbortSignal): void => {
  const signal = ctx.attemptRuntime?.signal ?? fallback;
  if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();
};

const cacheCompactResult = async (
  ctx: SyncContext,
  expectedTxid: string,
  details: RawTransaction | undefined,
  projector: CompactTransactionEvidenceProjector,
  signal?: AbortSignal,
  retainOnBudgetExpiry = false,
): Promise<boolean> => {
  let rawHexRefused = false;
  try {
    signal?.throwIfAborted();
    if (!details) throw new Error(MISSING_RESULT);
    const complexity = complexityFor(ctx);
    if (!rawHexFits(complexity, details)) {
      rawHexRefused = true;
      throw new RawTransactionEvidenceError(TRANSACTION_COMPLEXITY_EXCEEDED);
    }
    const envelope = await projector.projectCompact({
      expectedTxid,
      details,
      network: ctx.network,
      limits: remainingProjectionLimits(complexity),
    }, localProjectionSignal(ctx, signal));
    if (retainOnBudgetExpiry) throwIfAttemptCancelled(ctx, signal);
    else signal?.throwIfAborted();
    addComplexity(complexity, retainedEnvelopeComplexity(envelope.complexity));
    ctx.authenticatedTransactionEvidence.set(expectedTxid, envelope);
    recordCompactProjection(
      ctx,
      expectedTxid,
      envelope.digest,
      envelope.canonicalBytes.byteLength,
    );
    return true;
  } catch (error) {
    ctx.authenticatedTransactionEvidence.delete(expectedTxid);
    if (shouldRethrow(error, signal)) throw error;
    recordCompactRefusal(
      ctx,
      signal?.aborted && isSyncStageBudgetError(signal.reason)
        ? 'fetch_budget_exhausted'
        : reasonCode(error),
      details,
      rawHexRefused,
    );
    return false;
  }
};

const fetchFallback = async (
  ctx: SyncContext,
  txid: string,
  projector: CompactTransactionEvidenceProjector,
  options?: EvidenceRequestOptions,
): Promise<boolean> => {
  try {
    recordRemoteEvidenceFetch(ctx, [txid], 'single');
    const details = ctx.client.getRawTransactionEvidence
      ? await ctx.client.getRawTransactionEvidence(txid, options)
      : options
        ? await ctx.client.getTransaction(txid, false, options)
        : await ctx.client.getTransaction(txid, false);
    return await cacheCompactResult(ctx, txid, details, projector, options?.signal, true);
  } catch (error) {
    if (shouldRethrow(error, options?.signal)) throw error;
    recordFailClosed(ctx,
      options?.signal?.aborted && isSyncStageBudgetError(options.signal.reason)
        ? 'fetch_budget_exhausted'
        : isElectrumResponseTooLargeError(error) ? 'response_frame_too_large' : 'fetch_failed');
    return false;
  }
};

const fetchCompactWithProjector = async (
  ctx: SyncContext,
  txids: readonly string[],
  projector: CompactTransactionEvidenceProjector,
  options?: EvidenceRequestOptions,
): Promise<Set<string>> => {
  const signal = options?.signal;
  if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();
  const checkpoint = createCooperativeScheduler(signal, { shouldThrowAbort: isAttemptCancellation });
  const unique = [...new Set(txids)];
  const accepted = new Set(unique.filter(txid => ctx.authenticatedTransactionEvidence.has(txid)));
  const pending = unique.filter(txid => !accepted.has(txid));
  const settled = new Set<string>();
  const recordUnsettledBudget = (): void => {
    for (const txid of pending) {
      if (settled.has(txid)) continue;
      recordFailClosed(ctx, 'fetch_budget_exhausted');
      settled.add(txid);
    }
  };
  if (signal?.aborted) {
    recordUnsettledBudget();
    return accepted;
  }

  for (let offset = 0; offset < pending.length; offset += FETCH_BATCH_SIZE) {
    const batchTxids = pending.slice(offset, offset + FETCH_BATCH_SIZE);
    let oversizedFrame = false;
    recordRemoteEvidenceFetch(ctx, batchTxids, 'batch');
    const request = ctx.client.getRawTransactionEvidenceBatch
      ? ctx.client.getRawTransactionEvidenceBatch(batchTxids, options)
      : options
        ? ctx.client.getTransactionsBatch(batchTxids, false, options)
        : ctx.client.getTransactionsBatch(batchTxids, false);
    const results = await request.then(value => value, error => {
      if (signal?.aborted) {
        if (isSyncStageBudgetError(signal.reason)) {
          recordUnsettledBudget();
          return undefined;
        }
        signal.throwIfAborted();
      }
      if (isElectrumResponseTooLargeError(error)) {
        for (const txid of batchTxids) {
          recordFailClosed(ctx, 'response_frame_too_large');
          settled.add(txid);
        }
        oversizedFrame = true;
      }
      return undefined;
    });
    if (signal?.aborted && isAttemptCancellation(signal.reason)) signal.throwIfAborted();
    if (signal?.aborted && isSyncStageBudgetError(signal.reason)) {
      recordUnsettledBudget();
      return accepted;
    }
    if (oversizedFrame) continue;

    for (const txid of batchTxids) {
      const didAccept = results
        ? await cacheCompactResult(ctx, txid, results.get(txid), projector, signal)
        : await fetchFallback(ctx, txid, projector, options);
      results?.delete(txid);
      if (didAccept) accepted.add(txid);
      settled.add(txid);
      if (signal?.aborted && isSyncStageBudgetError(signal.reason)) {
        recordUnsettledBudget();
        return accepted;
      }
      await checkpoint();
    }
  }
  return accepted;
};

export async function fetchCompactAuthenticatedTransactions(
  ctx: SyncContext,
  txids: readonly string[],
  options?: EvidenceRequestOptions,
): Promise<Set<string>> {
  const projector = createCompactTransactionEvidenceProjector([...ctx.walletScriptToAddress.keys()]);
  try {
    return await fetchCompactWithProjector(ctx, txids, projector, options);
  } finally {
    await projector.close();
  }
}

export async function fetchAuthenticatedTransactions(
  ctx: SyncContext,
  txids: readonly string[],
  options?: EvidenceRequestOptions,
): Promise<Set<string>> {
  const unique = [...new Set(txids)];
  const accepted = new Set(unique.filter(txid => ctx.txDetailsCache.has(txid)));
  const pending = unique.filter(txid => !accepted.has(txid));
  if (pending.length === 0) {
    if (options?.signal?.aborted && isAttemptCancellation(options.signal.reason)) {
      options.signal.throwIfAborted();
    }
    return accepted;
  }
  const projector = createCompactTransactionEvidenceProjector([...ctx.walletScriptToAddress.keys()]);
  try {
    const compact = await fetchCompactWithProjector(ctx, pending, projector, options);
    for (const txid of pending) {
      const envelope = ctx.authenticatedTransactionEvidence.get(txid);
      if (!compact.has(txid) || !envelope) continue;
      try {
        throwIfAttemptCancelled(ctx, options?.signal);
        const projected = await projector.projectFull(
          envelope,
          localProjectionSignal(ctx, options?.signal),
        );
        throwIfAttemptCancelled(ctx, options?.signal);
        ctx.txDetailsCache.set(txid, projected.value);
        const role = options?.evidenceRole ?? 'current';
        recordFullProjection(ctx, txid, projected, role);
        accepted.add(txid);
      } catch (error) {
        ctx.txDetailsCache.delete(txid);
        if (shouldRethrow(error, options?.signal)) throw error;
        recordFailClosed(ctx, reasonCode(error));
      }
    }
    return accepted;
  } finally {
    await projector.close();
  }
}

const withOutpointFetchLock = async (
  ctx: SyncContext,
  signal: AbortSignal | undefined,
  task: () => Promise<void>,
): Promise<void> => {
  const previous = outpointFetchTails.get(ctx) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  outpointFetchTails.set(ctx, tail);
  await previous;
  try {
    signal?.throwIfAborted();
    await task();
  } finally {
    release();
    if (outpointFetchTails.get(ctx) === tail) outpointFetchTails.delete(ctx);
  }
};

const assertExactOutputPartition = (
  pendingVouts: readonly number[],
  result: ExactTransactionOutputsEvidenceResult,
): void => {
  const returnedVouts = new Set([
    ...result.outputs.map(output => output.vout),
    ...result.missingVouts,
    ...result.invalidVouts,
  ]);
  if (returnedVouts.size !== result.outputs.length
      + result.missingVouts.length
      + result.invalidVouts.length
    || returnedVouts.size !== pendingVouts.length
    || pendingVouts.some(vout => !returnedVouts.has(vout))) {
    throw new RawTransactionEvidenceError('evidence_digest_mismatch');
  }
};

const publishAuthenticatedOutpointResult = (
  ctx: SyncContext,
  txid: string,
  coverage: Set<number>,
  result: ExactTransactionOutputsEvidenceResult,
  role: EvidenceProjectionRole,
): void => {
  for (const output of result.outputs) {
    const { vout } = output;
    ctx.authenticatedOutpointEvidence.set(`${txid}:${vout}`, {
      txid,
      vout,
      valueSats: output.valueSats,
      scriptHex: output.scriptPubKeyHex.toLowerCase(),
    });
  }
  for (const _vout of result.missingVouts) recordFailClosed(ctx, 'missing_output');
  for (const _vout of result.invalidVouts) recordFailClosed(ctx, 'invalid_vout');
  for (const output of result.outputs) coverage.add(output.vout);
  for (const vout of result.missingVouts) coverage.add(vout);
  ctx.authenticatedOutpointCoverage.set(txid, coverage);
  recordExactOutputProjection(ctx, txid, result, role);
};

const removePendingOutpointEvidence = (
  ctx: SyncContext,
  txid: string,
  pendingVouts: readonly number[],
): void => {
  for (const vout of pendingVouts) {
    ctx.authenticatedOutpointEvidence.delete(`${txid}:${vout}`);
  }
};

const fetchTransactionOutpoints = async (
  ctx: SyncContext,
  txid: string,
  vouts: ReadonlySet<number>,
  projector: CompactTransactionEvidenceProjector,
  options?: EvidenceRequestOptions,
): Promise<void> => {
  const envelope = ctx.authenticatedTransactionEvidence.get(txid);
  if (!envelope) return;
  const coverage = ctx.authenticatedOutpointCoverage.get(txid) ?? new Set<number>();
  const pendingVouts = [...vouts].filter(vout => !coverage.has(vout));
  if (pendingVouts.length === 0) return;
  try {
    throwIfAttemptCancelled(ctx, options?.signal);
    const result = await projector.extractOutputs(
      envelope,
      pendingVouts,
      localProjectionSignal(ctx, options?.signal),
    );
    throwIfAttemptCancelled(ctx, options?.signal);
    assertExactOutputPartition(pendingVouts, result);
    publishAuthenticatedOutpointResult(
      ctx,
      txid,
      coverage,
      result,
      options?.evidenceRole ?? 'unspecified',
    );
  } catch (error) {
    removePendingOutpointEvidence(ctx, txid, pendingVouts);
    if (shouldRethrow(error, options?.signal)) throw error;
    recordFailClosed(ctx, reasonCode(error));
  }
};

const fetchAuthenticatedOutpointsLocked = async (
  ctx: SyncContext,
  requests: ReadonlyMap<string, ReadonlySet<number>>,
  options?: EvidenceRequestOptions,
): Promise<void> => {
  const projector = createCompactTransactionEvidenceProjector([...ctx.walletScriptToAddress.keys()]);
  try {
    await fetchCompactWithProjector(ctx, [...requests.keys()], projector, options);
    for (const [txid, vouts] of requests) {
      await fetchTransactionOutpoints(ctx, txid, vouts, projector, options);
    }
  } finally {
    await projector.close();
  }
}

export async function fetchAuthenticatedOutpoints(
  ctx: SyncContext,
  requests: ReadonlyMap<string, ReadonlySet<number>>,
  options?: EvidenceRequestOptions,
): Promise<void> {
  await withOutpointFetchLock(
    ctx,
    options?.signal,
    () => fetchAuthenticatedOutpointsLocked(ctx, requests, options),
  );
}
