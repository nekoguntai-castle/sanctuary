/**
 * Process Transactions Phase - Main Orchestrator
 *
 * The most complex sync phase - coordinates:
 * 1. Batch fetching transaction details
 * 2. Classifying transactions (received/sent/consolidation)
 * 3. Creating transaction records with inputs/outputs
 * 4. RBF detection and linking
 * 5. Auto-applying address labels
 * 6. Sending notifications
 */

import { transactionRepository } from '../../../../../repositories';
import type { PrismaTxClient } from '../../../../../models/prisma';
import { createLogger } from '../../../../../utils/logger';
import { getErrorMessage } from '../../../../../utils/errors';
import { walletLog } from '../../../../../websocket/notifications';
import { recalculateWalletBalances } from '../../../utils/balanceCalculation';
import type { SyncContext, TransactionCreateData } from '../../types';
import {
  classifyTransactions,
  locallyClassifiableTransactionIds,
} from './classification';
import { repairTransactionIO, storeTransactionIO } from './transactionIO';
import { applyAddressLabels } from './addressLabels';
import { sendNotifications } from './notifications';
import {
  fetchAuthenticatedOutpoints,
  fetchAuthenticatedTransactions,
  releaseAuthenticatedTransactionDetails,
} from '../../evidenceAuthentication';
import { runWalletSyncMutation } from '../../mutationBoundary';
import type { NodeRequestOptions } from '../../../nodeClient';
import {
  abortableSyncDelay,
  createSyncStageRuntime,
  isSyncStageBudgetError,
} from '../../attemptRuntime';
import { createCandidateBatchProgress } from './progress';
import { prefetchTransactionBlockTimestamps } from './timestampPrefetch';
import { isSyncAttemptTimeoutError } from '../../../../sync/syncAttemptErrors';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/** Number of transactions to process per batch (optimized for Electrum server limits) */
const TX_BATCH_SIZE = 25;

type BatchPersistenceResult = {
  created: TransactionCreateData[];
  repaired: TransactionCreateData[];
};

const getInlineInputAddress = (input: {
  prevout?: { scriptPubKey?: { address?: string; addresses?: string[] } };
}): string | undefined => {
  return input.prevout?.scriptPubKey?.address
    || input.prevout?.scriptPubKey?.addresses?.[0];
};

/**
 * Execute process transactions phase
 *
 * Fetches and processes new transactions in batches, saving progress
 * incrementally to support interrupted syncs.
 */
export async function processTransactionsPhase(ctx: SyncContext): Promise<SyncContext> {
  const {
    walletId,
    newTxids,
  } = ctx;

  if (newTxids.length === 0) {
    // Creates and authoritative repairs leave balanceAfter null until the
    // serialized balance pass succeeds, so unchanged polling remains cheap.
    if (await transactionRepository.hasPendingBalanceRecalculation(walletId)) {
      await runWalletSyncMutation(ctx, 'balance_recalculation', async (tx, deferPostCommit) => {
        await recalculateWalletBalances(walletId, tx, deferPostCommit);
      });
    }
    return ctx;
  }

  walletLog(walletId, 'info', 'SYNC', `Processing ${newTxids.length} transaction candidates...`);

  let totalTransactions = 0;
  let repairedTransactions = 0;
  const allNewTransactions: TransactionCreateData[] = [];

  // Process transactions in batches
  for (let batchIndex = 0; batchIndex < newTxids.length; batchIndex += TX_BATCH_SIZE) {
    const batchTxids = newTxids.slice(batchIndex, batchIndex + TX_BATCH_SIZE);
    const batch = Math.floor(batchIndex / TX_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(newTxids.length / TX_BATCH_SIZE);
    const batchEnd = Math.min(batchIndex + TX_BATCH_SIZE, newTxids.length);
    const progress = createCandidateBatchProgress(
      walletId, batch, batchCount, Date.now, ctx.attemptRuntime?.telemetry,
      ctx.attemptRuntime?.phaseProgress,
    );
    const classificationRepairTxids = batchTxids.filter(
      txid => ctx.classificationRepairTxids.has(txid),
    );
    const ioRepairTxids = batchTxids.filter(txid => ctx.ioRepairTxids.has(txid));
    try {

    // Advance selected repairs before network I/O so missing/null/failed raw
    // fetches rotate behind the durable backlog instead of starving it.
    await runWalletSyncMutation(ctx, 'repair_attempt_cursors', async (tx) => {
      await transactionRepository.markClassificationRepairAttempts(
        walletId,
        classificationRepairTxids,
        tx,
      );
      await transactionRepository.markIoRepairAttempts(walletId, ioRepairTxids, tx);
    });

    progress.start(
      'candidate_fetch',
      'transactions',
      `Fetching transactions ${batchIndex + 1}-${batchEnd} of ${newTxids.length}...`,
    );

    const stage = ctx.attemptRuntime
      ? createSyncStageRuntime(ctx.attemptRuntime, 'candidate_batch_remote')
      : undefined;
    const requestOptions = stage
      ? { signal: stage.signal, deadlineAt: stage.deadlineAt }
      : undefined;
    const batchTxidSet = new Set<string>();
    const classifiedTxids = new Set<string>();
    const rejectedBeforePage = ctx.rejectedEvidenceCount;
    let persistenceReported = false;
    try {
      const pageBlockTimestamps = await prefetchTransactionBlockTimestamps(
        ctx,
        new Set(batchTxids),
        requestOptions,
      ).catch(error => {
        if (isCandidateBudgetExpiry(error, requestOptions)) return new Map<number, Date | null>();
        throw error;
      });
      for (const [candidateIndex, txid] of batchTxids.entries()) {
        try {
          const resolved = await resolveCandidateBatch(
            ctx,
            [txid],
            requestOptions,
            progress,
            pageBlockTimestamps,
            candidateIndex === 0,
          );
          for (const availableTxid of resolved.batchTxidSet) batchTxidSet.add(availableTxid);
          for (const transaction of resolved.transactionsToCreate) {
            classifiedTxids.add(transaction.txid);
          }
          if (!persistenceReported) {
            progress.start(
              'persistence',
              'transactions',
              `Saving transaction batch ${batch} of ${batchCount}...`,
            );
            persistenceReported = true;
          }
          if (resolved.transactionsToCreate.length > 0) {
            const persisted = await persistTransactionsIndividually(
              ctx,
              resolved.transactionsToCreate,
            );
            repairedTransactions += persisted.repaired.length;
            if (persisted.created.length > 0) {
              totalTransactions += persisted.created.length;
              allNewTransactions.push(...persisted.created);
              logBatchResults(walletId, persisted.created);
            }
          }
          if (ioRepairTxids.includes(txid)
            && resolved.batchTxidSet.has(txid)
            && !classifiedTxids.has(txid)) {
            ctx.attemptRuntime?.signal.throwIfAborted();
            await runWalletSyncMutation(
              ctx,
              'transaction_io_repair',
              (tx, deferPostCommit) => repairTransactionIO(
                ctx, [txid], tx, deferPostCommit,
              ),
            );
            ctx.attemptRuntime?.signal.throwIfAborted();
          }
        } finally {
          releaseAuthenticatedTransactionDetails(ctx, { scope: 'candidate', txid });
        }
      }
    } catch (error) {
      emitCandidateTerminalProgress(progress, error, requestOptions?.signal);
      throw error;
    } finally {
      stage?.dispose();
    }
    progress.candidates(batchTxidSet.size, ctx.rejectedEvidenceCount - rejectedBeforePage);
    progress.complete(batchEnd, newTxids.length);

    // Small delay between batches
    if (batchIndex + TX_BATCH_SIZE < newTxids.length) {
      if (ctx.attemptRuntime) await abortableSyncDelay(100, ctx.attemptRuntime);
      else await new Promise(resolve => setTimeout(resolve, 100));
    }
    } finally {
      // The selected current transaction is the only full graph owned by the
      // attempt. Exact parent evidence lives in the compact outpoint maps.
      releaseAuthenticatedTransactionDetails(ctx, { scope: 'batch' });
    }
  }

  if (
    totalTransactions > 0
    || repairedTransactions > 0
    || await transactionRepository.hasPendingBalanceRecalculation(walletId)
  ) {
    await runWalletSyncMutation(ctx, 'balance_recalculation', async (tx, deferPostCommit) => {
      await recalculateWalletBalances(walletId, tx, deferPostCommit);
    });
  }

  if (allNewTransactions.length > 0 || repairedTransactions > 0) {
    const received = allNewTransactions.filter(t => t.type === 'received').length;
    const sent = allNewTransactions.filter(t => t.type === 'sent').length;
    const consolidation = allNewTransactions.filter(t => t.type === 'consolidation').length;

    walletLog(walletId, 'info', 'BLOCKCHAIN', `Recorded ${totalTransactions} new transactions`, {
      received,
      sent,
      consolidation,
    });
  }

  ctx.newTransactions = allNewTransactions;
  ctx.stats.newTransactionsCreated = totalTransactions;
  ctx.stats.transactionsProcessed = newTxids.length;

  return ctx;
}

/**
 * Keep the remote candidate page independent from the authoritative mutation
 * unit. A single high-fanout transaction may already approach the supported I/O
 * ceiling, so sharing one fence transaction across 25 candidates amplifies both
 * the retained row graph and Prisma serialization beyond the worker cgroup.
 */
async function persistTransactionsIndividually(
  ctx: SyncContext,
  transactions: TransactionCreateData[],
): Promise<BatchPersistenceResult> {
  const aggregate: BatchPersistenceResult = { created: [], repaired: [] };

  for (const transaction of transactions) {
    ctx.attemptRuntime?.signal.throwIfAborted();
    const persisted = await runWalletSyncMutation(
      ctx,
      'transaction_batch',
      (tx, deferPostCommit) => persistTransactionBatch(
        ctx,
        [transaction],
        tx,
        deferPostCommit,
      ),
    );
    ctx.attemptRuntime?.signal.throwIfAborted();
    aggregate.created.push(...persisted.created);
    aggregate.repaired.push(...persisted.repaired);
    await applyPersistedAddressLabels(ctx, [...persisted.created, ...persisted.repaired]);
  }

  return aggregate;
}

const availableBatchTransactionIds = (
  batchTxids: string[],
  txDetailsCache: SyncContext['txDetailsCache'],
): Set<string> => new Set(batchTxids.filter(txid => txDetailsCache.has(txid)));

const resolveCandidateBatch = async (
  ctx: SyncContext,
  batchTxids: string[],
  options: NodeRequestOptions | undefined,
  progress: ReturnType<typeof createCandidateBatchProgress>,
  pageBlockTimestamps: ReadonlyMap<number, Date | null>,
  reportProgress = true,
): Promise<{
  batchTxidSet: Set<string>;
  transactionsToCreate: TransactionCreateData[];
}> => {
  try {
    await fetchAuthenticatedTransactions(ctx, batchTxids, options);
    const batchTxidSet = availableBatchTransactionIds(batchTxids, ctx.txDetailsCache);
    options?.signal?.throwIfAborted();
    if (reportProgress) progress.start('parent_fetch', 'transactions', 'Resolving previous transactions for this batch...');
    await prefetchPreviousTransactions(ctx, batchTxidSet, options);
    if (reportProgress) progress.start('timestamp_fetch', 'block_heights', 'Resolving block timestamps for this batch...');
    const blockTimestamps = pageBlockTimestamps;
    if (reportProgress) progress.start('classification', 'transactions', 'Classifying transactions in this batch...');
    const transactionsToCreate = await classifyTransactions(
      ctx,
      batchTxidSet,
      options,
      blockTimestamps,
    );
    return { batchTxidSet, transactionsToCreate };
  } catch (error) {
    const batchTxidSet = availableBatchTransactionIds(batchTxids, ctx.txDetailsCache);
    if (!isCandidateBudgetExpiry(error, options)) throw error;
    progress.fallback('Remote batch budget expired; continuing with locally complete transactions.');
    if (reportProgress) progress.start('classification', 'transactions', 'Classifying locally complete transactions...');
    return {
      batchTxidSet,
      transactionsToCreate: await classifyTransactions(
        ctx,
        locallyClassifiableTransactionIds(ctx, batchTxidSet),
        undefined,
        new Map(),
      ),
    };
  }
};

const isCandidateBudgetExpiry = (
  error: unknown,
  options: NodeRequestOptions | undefined,
): boolean => isSyncStageBudgetError(error)
  || isSyncStageBudgetError(options?.signal?.reason);

const emitCandidateTerminalProgress = (
  progress: ReturnType<typeof createCandidateBatchProgress>,
  error: unknown,
  signal: AbortSignal | undefined,
): void => {
  if (!signal?.aborted || isSyncStageBudgetError(error) || isSyncStageBudgetError(signal.reason)) {
    return;
  }
  const reason = signal.reason;
  const timeout = isSyncAttemptTimeoutError(reason);
  progress.terminal(
    timeout ? 'timeout' : 'aborted',
    timeout ? 'Transaction batch timed out.' : 'Transaction batch cancelled.',
  );
};

/**
 * Batch prefetch previous transactions for inputs to avoid N+1 queries
 */
async function prefetchPreviousTransactions(
  ctx: SyncContext,
  batchTxidSet: Set<string>,
  options?: NodeRequestOptions,
): Promise<void> {
  const { walletId, txDetailsCache } = ctx;

  const outpointsNeeded = new Map<string, Set<number>>();
  for (const txid of batchTxidSet) {
    const txDetails = txDetailsCache.get(txid);
    if (!txDetails?.vin) continue;
    for (const input of txDetails.vin) {
      if (input.coinbase) continue;
      if (!getInlineInputAddress(input) && input.txid && input.vout !== undefined) {
        const vouts = outpointsNeeded.get(input.txid) ?? new Set<number>();
        vouts.add(input.vout);
        outpointsNeeded.set(input.txid, vouts);
      }
    }
  }

  if (outpointsNeeded.size > 0) {
    walletLog(walletId, 'debug', 'SYNC', `Prefetching ${outpointsNeeded.size} previous transactions for input resolution...`);
    try {
      await fetchAuthenticatedOutpoints(ctx, outpointsNeeded, {
        ...options,
        evidenceRole: 'parent',
      });
    } catch (error) {
      options?.signal?.throwIfAborted();
      log.warn(`[SYNC] Batch prev tx fetch failed, will fall back to individual requests`, { error: getErrorMessage(error) });
    }
  }
}

/**
 * Persist a classified batch while retaining exact created/repaired ownership.
 */
async function persistTransactionBatch(
  ctx: SyncContext,
  transactionsToCreate: TransactionCreateData[],
  tx: PrismaTxClient | undefined,
  deferPostCommit: (effect: () => void | Promise<void>) => void,
): Promise<BatchPersistenceResult> {
  const results = await transactionRepository.reconcileTransactionBatch(
    transactionsToCreate,
    tx,
  );
  const created = results
    .filter(result => result.outcome === 'created')
    .map(result => result.transaction as TransactionCreateData);
  const repaired = results
    .filter(result => result.outcome === 'repaired')
    .map(result => result.transaction as TransactionCreateData);
  // I/O persistence is duplicate-safe and repairs incomplete prior attempts for
  // created, repaired, and unchanged classifications alike.
  await storeTransactionIO(
    ctx,
    results.map(result => result.transaction as TransactionCreateData),
    tx,
    deferPostCommit,
  );

  if (created.length > 0) {
    deferPostCommit(() => sendNotifications(ctx.walletId, created));
  }

  return { created, repaired };
}

/**
 * Labels are cosmetic follow-up work. Give them their own fenced transaction
 * so a label write failure cannot roll back an authoritative transaction/IO
 * batch that has already committed.
 */
async function applyPersistedAddressLabels(
  ctx: SyncContext,
  transactions: TransactionCreateData[],
): Promise<void> {
  if (transactions.length === 0) return;
  const labelFailure = await runWalletSyncMutation(
    ctx,
    'transaction_labels',
    async (tx) => {
      await applyAddressLabels(ctx.walletId, transactions, tx);
    },
  ).then(() => undefined, error => error);
  if (labelFailure !== undefined) {
    log.warn(`[SYNC] Failed to auto-apply address labels: ${labelFailure}`);
  }
}

/**
 * Log batch results (received/sent/consolidation summary)
 */
function logBatchResults(walletId: string, newTransactions: TransactionCreateData[]): void {
  const received = newTransactions.filter(t => t.type === 'received');
  const sent = newTransactions.filter(t => t.type === 'sent');
  const consolidation = newTransactions.filter(t => t.type === 'consolidation');
  const receivedTotal = received.reduce((sum, t) => sum + t.amount, BigInt(0));
  const sentTotal = sent.reduce((sum, t) => sum + t.amount, BigInt(0));

  const parts: string[] = [];
  if (received.length > 0) parts.push(`+${(Number(receivedTotal) / 100000000).toFixed(8)} BTC (${received.length} received)`);
  if (sent.length > 0) parts.push(`${(Number(sentTotal) / 100000000).toFixed(8)} BTC (${sent.length} sent)`);
  if (consolidation.length > 0) parts.push(`${consolidation.length} consolidation`);

  walletLog(walletId, 'info', 'TX', `Saved: ${parts.join(', ')}`);
}
