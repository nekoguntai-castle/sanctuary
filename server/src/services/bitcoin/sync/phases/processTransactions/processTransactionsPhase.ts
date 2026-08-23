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
import { classifyTransactions } from './classification';
import { repairTransactionIO, storeTransactionIO } from './transactionIO';
import { applyAddressLabels } from './addressLabels';
import { sendNotifications } from './notifications';
import { fetchAuthenticatedTransactions } from '../../evidenceAuthentication';
import { runWalletSyncMutation } from '../../mutationBoundary';

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
    client,
    newTxids,
    txDetailsCache,
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
    const classificationRepairTxids = batchTxids.filter(
      txid => ctx.classificationRepairTxids.has(txid)
    );
    const ioRepairTxids = batchTxids.filter(txid => ctx.ioRepairTxids.has(txid));

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

    walletLog(
      walletId,
      'info',
      'SYNC',
      `Fetching transactions ${batchIndex + 1}-${Math.min(batchIndex + TX_BATCH_SIZE, newTxids.length)} of ${newTxids.length}...`
    );

    // Step 1: Fetch this batch of transactions
    await fetchAuthenticatedTransactions(ctx, batchTxids);

    const batchTxidSet = new Set(batchTxids.filter(txid => txDetailsCache.has(txid)));

    // Step 1b: Batch prefetch previous transactions for inputs (avoids N+1 queries)
    await prefetchPreviousTransactions(ctx, batchTxidSet);

    // Step 2: Classify transactions in this batch
    const transactionsToCreate = await classifyTransactions(ctx, batchTxidSet);

    // Step 3: Insert batch to DB
    if (transactionsToCreate.length > 0) {
      const persisted = await runWalletSyncMutation(
        ctx,
        'transaction_batch',
        (tx, deferPostCommit) => persistTransactionBatch(
          ctx,
          transactionsToCreate,
          tx,
          deferPostCommit,
        ),
      );
      const newTransactions = persisted.created;
      repairedTransactions += persisted.repaired.length;
      await applyPersistedAddressLabels(ctx, [...persisted.created, ...persisted.repaired]);

      if (newTransactions.length > 0) {
        totalTransactions += newTransactions.length;
        allNewTransactions.push(...newTransactions);

        // Log batch results
        logBatchResults(walletId, newTransactions);
      }
    }
    const classifiedTxids = new Set(transactionsToCreate.map(transaction => transaction.txid));
    const unclassifiedIoRepairTxids = ioRepairTxids.filter(
      txid => batchTxidSet.has(txid) && !classifiedTxids.has(txid)
    );
    if (unclassifiedIoRepairTxids.length > 0) {
      await runWalletSyncMutation(
        ctx,
        'transaction_io_repair',
        (tx, deferPostCommit) => repairTransactionIO(
          ctx,
          unclassifiedIoRepairTxids,
          tx,
          deferPostCommit,
        ),
      );
    }

    // Small delay between batches
    if (batchIndex + TX_BATCH_SIZE < newTxids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
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
 * Batch prefetch previous transactions for inputs to avoid N+1 queries
 */
async function prefetchPreviousTransactions(
  ctx: SyncContext,
  batchTxidSet: Set<string>
): Promise<void> {
  const { walletId, client, txDetailsCache } = ctx;

  const prevTxidsNeeded = new Set<string>();
  for (const txid of batchTxidSet) {
    const txDetails = txDetailsCache.get(txid);
    if (!txDetails?.vin) continue;
    for (const input of txDetails.vin) {
      if (input.coinbase) continue;
      if (!getInlineInputAddress(input) && input.txid && !txDetailsCache.has(input.txid)) {
        prevTxidsNeeded.add(input.txid);
      }
    }
  }

  if (prevTxidsNeeded.size > 0) {
    const prevTxidsArray = Array.from(prevTxidsNeeded);
    walletLog(walletId, 'debug', 'SYNC', `Prefetching ${prevTxidsArray.length} previous transactions for input resolution...`);
    try {
      await fetchAuthenticatedTransactions(ctx, prevTxidsArray);
    } catch (error) {
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
