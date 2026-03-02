/**
 * Fetch Helpers for Field Population
 *
 * Batch fetching functions for block heights, transaction details,
 * and previous transactions needed during field population.
 */

import { createLogger } from '../../../../utils/logger';
import { getNodeClient } from '../../nodeClient';
import { walletLog } from '../../../../websocket/notifications';
import { mapWithConcurrency } from '../../../../utils/async';

const log = createLogger('CONFIRMATIONS');

/**
 * Fetch block heights from address history for transactions missing blockHeight.
 * More reliable than verbose tx for some servers (e.g., Blockstream).
 */
export async function fetchBlockHeightsFromHistory(
  walletId: string,
  transactions: Array<{ blockHeight: number | null; txid: string }>,
  walletAddressSet: Set<string>,
  client: Awaited<ReturnType<typeof getNodeClient>>
): Promise<Map<string, number>> {
  const txHeightFromHistory = new Map<string, number>();

  const hasMissingBlockHeight = transactions.some(tx => tx.blockHeight === null);
  const addressesForHistory = hasMissingBlockHeight ? walletAddressSet : new Set<string>();

  const HISTORY_BATCH_SIZE = 10;
  const addressList = Array.from(addressesForHistory);

  if (addressList.length > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Fetching address history for ${addressList.length} addresses`);
  }

  for (let i = 0; i < addressList.length; i += HISTORY_BATCH_SIZE) {
    const batch = addressList.slice(i, i + HISTORY_BATCH_SIZE);
    const batchNum = Math.floor(i / HISTORY_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(addressList.length / HISTORY_BATCH_SIZE);

    walletLog(walletId, 'debug', 'POPULATE', `Address history batch ${batchNum}/${totalBatches} (${batch.length} addresses)`);

    const results = await mapWithConcurrency(
      batch,
      async (address) => {
        try {
          const history = await client.getAddressHistory(address);
          return history;
        } catch (error) {
          return [];
        }
      },
      3
    );
    for (const history of results) {
      for (const item of history) {
        if (item.height > 0) {
          txHeightFromHistory.set(item.tx_hash, item.height);
        }
      }
    }
  }

  if (txHeightFromHistory.size > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Found block heights for ${txHeightFromHistory.size} transactions from address history`);
  }

  return txHeightFromHistory;
}

/**
 * Batch fetch transaction details from the blockchain.
 */
export async function fetchTransactionDetails(
  walletId: string,
  transactions: Array<{ txid: string }>,
  client: Awaited<ReturnType<typeof getNodeClient>>
): Promise<Map<string, any>> {
  const TX_BATCH_SIZE = 5;
  const txDetailsCache = new Map<string, any>();
  const txids = transactions.map(tx => tx.txid);

  walletLog(walletId, 'info', 'POPULATE', `Fetching details for ${txids.length} transactions`);

  let fetchedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < txids.length; i += TX_BATCH_SIZE) {
    const batch = txids.slice(i, i + TX_BATCH_SIZE);
    const batchNum = Math.floor(i / TX_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(txids.length / TX_BATCH_SIZE);

    walletLog(walletId, 'debug', 'POPULATE', `Transaction batch ${batchNum}/${totalBatches} (${batch.length} txs)`);

    const results = await mapWithConcurrency(
      batch,
      async (txid) => {
        try {
          const details = await client.getTransaction(txid, true);
          return { txid, details };
        } catch (error) {
          log.warn(`Failed to fetch tx ${txid}`, { error: String(error) });
          return { txid, details: null };
        }
      },
      3
    );
    for (const result of results) {
      if (result.details) {
        txDetailsCache.set(result.txid, result.details);
        fetchedCount++;
      } else {
        failedCount++;
      }
    }

    // Progress update every 5 batches or at the end
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      walletLog(walletId, 'info', 'POPULATE', `Transaction fetch progress: ${fetchedCount}/${txids.length} (${failedCount} failed)`);
    }
  }

  return txDetailsCache;
}

/**
 * Batch fetch previous transactions needed for fee calculation and counterparty address.
 * Fixes an N+1 query problem where we were fetching previous txs one-by-one in the loop.
 */
export async function fetchPreviousTransactions(
  walletId: string,
  transactions: Array<{ txid: string; type: string; fee: bigint | null; counterpartyAddress: string | null }>,
  txDetailsCache: Map<string, any>,
  client: Awaited<ReturnType<typeof getNodeClient>>
): Promise<Map<string, any>> {
  const TX_BATCH_SIZE = 5;
  const prevTxCache = new Map<string, any>();
  const requiredPrevTxids = new Set<string>();

  // First pass: collect all previous txids we'll need
  for (const tx of transactions) {
    const txDetails = txDetailsCache.get(tx.txid);
    if (!txDetails) continue;

    const inputs = txDetails.vin || [];
    const isSentTx = tx.type === 'sent' || tx.type === 'send';
    const isConsolidationTx = tx.type === 'consolidation';
    const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

    // Need previous txs for fee calculation (sent/consolidation transactions without prevout data)
    if (tx.fee === null && (isSentTx || isConsolidationTx) && txDetails.fee == null) {
      for (const input of inputs) {
        if (!input.coinbase && !input.prevout && input.txid && input.vout != null) {
          requiredPrevTxids.add(input.txid);
        }
      }
    }

    // Need previous txs for counterparty address (received transactions without prevout data)
    if (tx.counterpartyAddress === null && isReceivedTx) {
      for (const input of inputs) {
        if (!input.coinbase && !input.prevout && input.txid && input.vout != null) {
          requiredPrevTxids.add(input.txid);
        }
      }
    }
  }

  // Batch fetch all required previous transactions
  if (requiredPrevTxids.size > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Batch fetching ${requiredPrevTxids.size} previous transactions for fee/address calculation`);

    const prevTxidsList = Array.from(requiredPrevTxids);
    let prevFetched = 0;
    let prevFailed = 0;

    for (let i = 0; i < prevTxidsList.length; i += TX_BATCH_SIZE) {
      const batch = prevTxidsList.slice(i, i + TX_BATCH_SIZE);

      const results = await mapWithConcurrency(
        batch,
        async (txid) => {
          try {
            const details = await client.getTransaction(txid, true);
            return { txid, details };
          } catch (error) {
            log.warn(`Failed to fetch previous tx ${txid}`, { error: String(error) });
            return { txid, details: null };
          }
        },
        3
      );

      for (const result of results) {
        if (result.details) {
          prevTxCache.set(result.txid, result.details);
          prevFetched++;
        } else {
          prevFailed++;
        }
      }
    }

    walletLog(walletId, 'info', 'POPULATE', `Previous transactions fetched: ${prevFetched} success, ${prevFailed} failed`);
  }

  return prevTxCache;
}
