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

import { db as prisma } from '../../../../../repositories/db';
import { createLogger } from '../../../../../utils/logger';
import { walletLog } from '../../../../../websocket/notifications';
import { recalculateWalletBalances } from '../../../utils/balanceCalculation';
import type { SyncContext, TransactionCreateData } from '../../types';
import { classifyTransactions } from './classification';
import { storeTransactionIO } from './transactionIO';
import { applyAddressLabels } from './addressLabels';
import { sendNotifications } from './notifications';

const log = createLogger('SYNC-TX');

/** Number of transactions to process per batch (optimized for Electrum server limits) */
const TX_BATCH_SIZE = 25;

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
    return ctx;
  }

  walletLog(walletId, 'info', 'SYNC', `Processing ${newTxids.length} new transactions...`);

  let totalTransactions = 0;
  const allNewTransactions: TransactionCreateData[] = [];

  // Process transactions in batches
  for (let batchIndex = 0; batchIndex < newTxids.length; batchIndex += TX_BATCH_SIZE) {
    const batchTxids = newTxids.slice(batchIndex, batchIndex + TX_BATCH_SIZE);

    walletLog(
      walletId,
      'info',
      'SYNC',
      `Fetching transactions ${batchIndex + 1}-${Math.min(batchIndex + TX_BATCH_SIZE, newTxids.length)} of ${newTxids.length}...`
    );

    // Step 1: Fetch this batch of transactions
    try {
      const batchResults = await client.getTransactionsBatch(batchTxids, true);
      for (const [txid, details] of batchResults) {
        txDetailsCache.set(txid, details);
      }
    } catch (error) {
      log.warn(`[SYNC] Batch tx fetch failed, falling back to individual requests`, { error: String(error) });
      for (const txid of batchTxids) {
        try {
          const details = await client.getTransaction(txid, true);
          txDetailsCache.set(txid, details);
        } catch (e) {
          log.warn(`[SYNC] Failed to get tx ${txid}`, { error: String(e) });
        }
      }
    }

    const batchTxidSet = new Set(batchTxids.filter(txid => txDetailsCache.has(txid)));

    // Step 1b: Batch prefetch previous transactions for inputs (avoids N+1 queries)
    await prefetchPreviousTransactions(ctx, batchTxidSet);

    // Step 2: Classify transactions in this batch
    const transactionsToCreate = await classifyTransactions(ctx, batchTxidSet);

    // Step 3: Insert batch to DB
    if (transactionsToCreate.length > 0) {
      const newTransactions = await insertTransactionBatch(walletId, transactionsToCreate);

      if (newTransactions.length > 0) {
        totalTransactions += newTransactions.length;
        allNewTransactions.push(...newTransactions);

        // Log batch results
        logBatchResults(walletId, newTransactions);

        // Store transaction inputs/outputs
        await storeTransactionIO(ctx, newTransactions);

        // Auto-apply address labels
        await applyAddressLabels(walletId, newTransactions);

        // Send notifications
        await sendNotifications(walletId, newTransactions);
      }
    }

    // Small delay between batches
    if (batchIndex + TX_BATCH_SIZE < newTxids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Recalculate running balances
  if (allNewTransactions.length > 0) {
    await recalculateWalletBalances(walletId);

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
      if (!input.prevout?.scriptPubKey && input.txid && !txDetailsCache.has(input.txid)) {
        prevTxidsNeeded.add(input.txid);
      }
    }
  }

  if (prevTxidsNeeded.size > 0) {
    const prevTxidsArray = Array.from(prevTxidsNeeded);
    walletLog(walletId, 'debug', 'SYNC', `Prefetching ${prevTxidsArray.length} previous transactions for input resolution...`);
    try {
      const prevBatchResults = await client.getTransactionsBatch(prevTxidsArray, true);
      for (const [txid, details] of prevBatchResults) {
        txDetailsCache.set(txid, details);
      }
    } catch (error) {
      log.warn(`[SYNC] Batch prev tx fetch failed, will fall back to individual requests`, { error: String(error) });
    }
  }
}

/**
 * Insert a batch of transactions to the database, deduplicating and checking for existing
 */
async function insertTransactionBatch(
  walletId: string,
  transactionsToCreate: TransactionCreateData[]
): Promise<TransactionCreateData[]> {
  // Deduplicate by txid:type
  const uniqueTxs = new Map<string, TransactionCreateData>();
  for (const tx of transactionsToCreate) {
    const key = `${tx.txid}:${tx.type}`;
    if (!uniqueTxs.has(key)) {
      uniqueTxs.set(key, tx);
    }
  }

  const uniqueTxArray = Array.from(uniqueTxs.values());

  // Check for existing
  const existingTxids = new Set(
    (await prisma.transaction.findMany({
      where: {
        walletId,
        txid: { in: uniqueTxArray.map(tx => tx.txid) },
      },
      select: { txid: true },
    })).map(tx => tx.txid)
  );

  const newTransactions = uniqueTxArray.filter(tx => !existingTxids.has(tx.txid));

  if (newTransactions.length > 0) {
    await prisma.transaction.createMany({
      data: uniqueTxArray,
      skipDuplicates: true,
    });
  }

  return newTransactions;
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
