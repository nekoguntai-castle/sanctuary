/**
 * Populate Missing Transaction Fields
 *
 * Fills in missing transaction data (blockHeight, addressId, blockTime,
 * fee, counterpartyAddress) from the blockchain. Called during sync to
 * fill in data for transactions that were created before these fields
 * existed or were populated.
 *
 * OPTIMIZED with batch fetching and batch updates.
 */

import { db as prisma } from '../../../../repositories/db';
import { createLogger } from '../../../../utils/logger';
import { getBlockHeight, getBlockTimestamp } from '../../utils/blockHeight';
import { getNodeClient } from '../../nodeClient';
import { walletLog } from '../../../../websocket/notifications';
import { recalculateWalletBalances } from '../../utils/balanceCalculation';
import { mapWithConcurrency } from '../../../../utils/async';
import { executeInChunks } from './batchUpdates';
import type { ConfirmationUpdate, PopulateFieldsResult } from './types';

const log = createLogger('CONFIRMATIONS');

/**
 * Populate missing transaction fields (blockHeight, addressId, blockTime, fee) from blockchain
 * Called during sync to fill in data for transactions that were created before
 * these fields existed or were populated
 * OPTIMIZED with batch fetching and batch updates
 * Returns both count and confirmation updates for notification broadcasting
 */
export async function populateMissingTransactionFields(walletId: string): Promise<PopulateFieldsResult> {
  // Get wallet to determine network for correct block height
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true },
  });
  if (!wallet) {
    return { updated: 0, confirmationUpdates: [] };
  }

  const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
  const client = await getNodeClient(network);

  // Find transactions with missing fields (including fee and counterparty address)
  // OPTIMIZED: Don't include all wallet addresses - fetch them separately with only needed fields
  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        { addressId: null },
        { blockTime: null },
        { fee: null },
        { counterpartyAddress: null },
      ],
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      fee: true,
      blockHeight: true,
      blockTime: true,
      confirmations: true,
      addressId: true,
      counterpartyAddress: true,
    },
  });

  // Fetch wallet addresses separately with only needed fields (more memory efficient)
  const walletAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { id: true, address: true },
  });

  // Attach addresses to a lookup structure for efficient access
  const walletAddressLookup = new Map(walletAddresses.map(a => [a.address, a.id]));
  const walletAddressSet = new Set(walletAddresses.map(a => a.address));

  if (transactions.length === 0) {
    walletLog(walletId, 'info', 'POPULATE', 'All transaction fields are complete');
    return { updated: 0, confirmationUpdates: [] };
  }

  log.debug(`Populating missing fields for ${transactions.length} transactions in wallet ${walletId}`);
  walletLog(walletId, 'info', 'POPULATE', `Starting field population for ${transactions.length} transactions`, {
    missingFields: {
      blockHeight: transactions.filter(t => t.blockHeight === null).length,
      fee: transactions.filter(t => t.fee === null).length,
      blockTime: transactions.filter(t => t.blockTime === null).length,
      counterpartyAddress: transactions.filter(t => t.counterpartyAddress === null).length,
      addressId: transactions.filter(t => t.addressId === null).length,
    },
  });

  const currentHeight = await getBlockHeight(network);

  // PHASE 0: Get block heights from address history
  const txHeightFromHistory = await fetchBlockHeightsFromHistory(
    walletId, transactions, walletAddressSet, client
  );

  // PHASE 1: Batch fetch all transaction details
  const txDetailsCache = await fetchTransactionDetails(walletId, transactions, client);

  // PHASE 1.5: Batch fetch previous transactions needed for fee/counterparty calculation
  const prevTxCache = await fetchPreviousTransactions(
    walletId, transactions, txDetailsCache, client
  );

  // PHASE 2: Process transactions and collect updates
  const { pendingUpdates, updated, stats } = await processTransactionUpdates(
    walletId, transactions, txDetailsCache, prevTxCache, txHeightFromHistory,
    walletAddresses, walletAddressLookup, walletAddressSet, currentHeight, network
  );

  // Log field population summary
  walletLog(walletId, 'info', 'POPULATE', `Fields calculated: ${pendingUpdates.length} transactions have updates`, {
    fees: stats.feesPopulated,
    blockHeights: stats.blockHeightsPopulated,
    blockTimes: stats.blockTimesPopulated,
    counterpartyAddresses: stats.counterpartyAddressesPopulated,
    addressIds: stats.addressIdsPopulated,
  });

  // PHASE 3: Batch apply all updates
  let totalUpdated = 0;
  if (pendingUpdates.length > 0) {
    walletLog(walletId, 'info', 'POPULATE', `Saving ${pendingUpdates.length} transaction updates to database...`);
    log.debug(`Applying ${pendingUpdates.length} transaction updates...`);
    await executeInChunks(
      pendingUpdates,
      (u) => prisma.transaction.update({
        where: { id: u.id },
        data: u.data,
      }),
      walletId
    );
    totalUpdated = pendingUpdates.length;
    walletLog(walletId, 'info', 'POPULATE', `Saved ${totalUpdated} transaction updates`);

    // Recalculate running balances if any amounts were updated
    const hasAmountUpdates = pendingUpdates.some(u => u.data.amount !== undefined);
    if (hasAmountUpdates) {
      walletLog(walletId, 'info', 'POPULATE', 'Recalculating running balances...');
      await recalculateWalletBalances(walletId);
    }
  } else {
    walletLog(walletId, 'info', 'POPULATE', 'No transaction updates needed');
  }

  // Extract confirmation updates for notification broadcasting
  // Only include updates where confirmations actually changed
  const confirmationUpdates: ConfirmationUpdate[] = pendingUpdates
    .filter(u => u.data.confirmations !== undefined && u.data.confirmations !== u.oldConfirmations)
    .map(u => ({
      txid: u.txid,
      oldConfirmations: u.oldConfirmations,
      newConfirmations: u.data.confirmations as number,
    }));

  log.debug(`Populated missing fields for ${totalUpdated} transactions, ${confirmationUpdates.length} confirmation updates`);
  walletLog(walletId, 'info', 'POPULATE', `Field population complete: ${totalUpdated} transactions updated, ${confirmationUpdates.length} confirmation changes`);
  return { updated: totalUpdated, confirmationUpdates };
}

/**
 * Fetch block heights from address history for transactions missing blockHeight.
 * More reliable than verbose tx for some servers (e.g., Blockstream).
 */
async function fetchBlockHeightsFromHistory(
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
async function fetchTransactionDetails(
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
async function fetchPreviousTransactions(
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

/**
 * Statistics tracked during field population
 */
interface PopulationStats {
  feesPopulated: number;
  blockHeightsPopulated: number;
  blockTimesPopulated: number;
  counterpartyAddressesPopulated: number;
  addressIdsPopulated: number;
}

/**
 * Pending update entry
 */
interface PendingUpdate {
  id: string;
  txid: string;
  oldConfirmations: number;
  data: Record<string, unknown>;
}

/**
 * Process all transactions and collect pending database updates.
 * This is the main field population logic that examines each transaction
 * and determines what fields need to be filled in.
 */
async function processTransactionUpdates(
  walletId: string,
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: bigint;
    fee: bigint | null;
    blockHeight: number | null;
    blockTime: Date | null;
    confirmations: number;
    addressId: string | null;
    counterpartyAddress: string | null;
  }>,
  txDetailsCache: Map<string, any>,
  prevTxCache: Map<string, any>,
  txHeightFromHistory: Map<string, number>,
  walletAddresses: Array<{ id: string; address: string }>,
  walletAddressLookup: Map<string, string>,
  walletAddressSet: Set<string>,
  currentHeight: number,
  network: 'mainnet' | 'testnet' | 'signet' | 'regtest'
): Promise<{ pendingUpdates: PendingUpdate[]; updated: number; stats: PopulationStats }> {
  const pendingUpdates: PendingUpdate[] = [];
  let updated = 0;

  const stats: PopulationStats = {
    feesPopulated: 0,
    blockHeightsPopulated: 0,
    blockTimesPopulated: 0,
    counterpartyAddressesPopulated: 0,
    addressIdsPopulated: 0,
  };

  let processedCount = 0;
  const totalTxCount = transactions.length;
  const LOG_INTERVAL = 20;

  walletLog(walletId, 'info', 'POPULATE', 'Processing transactions and calculating fields...');

  for (const tx of transactions) {
    processedCount++;

    if (processedCount % LOG_INTERVAL === 0 || processedCount === totalTxCount) {
      walletLog(walletId, 'info', 'POPULATE', `Processing: ${processedCount}/${totalTxCount} (fees: ${stats.feesPopulated}, heights: ${stats.blockHeightsPopulated}, times: ${stats.blockTimesPopulated})`);
    }
    try {
      const txDetails = txDetailsCache.get(tx.txid);
      const oldConfirmations = tx.confirmations;
      const updates: Record<string, unknown> = {};

      // Populate blockHeight if missing
      populateBlockHeight(tx, txDetails, txHeightFromHistory, currentHeight, updates, stats);

      // Skip remaining field population if we don't have transaction details
      if (!txDetails) {
        if (Object.keys(updates).length > 0) {
          pendingUpdates.push({ id: tx.id, txid: tx.txid, oldConfirmations, data: updates });
          updated++;
        }
        continue;
      }

      // Populate blockTime if missing
      populateBlockTime(tx, txDetails, updates, stats);

      // Derive blockTime from block header if txDetails.time was not available
      if (tx.blockTime === null && !updates.blockTime && (tx.blockHeight || updates.blockHeight)) {
        const height = (updates.blockHeight || tx.blockHeight) as number;
        const blockTime = await getBlockTimestamp(height, network);
        if (blockTime) {
          updates.blockTime = blockTime;
          stats.blockTimesPopulated++;
        }
      }

      const inputs = txDetails.vin || [];
      const outputs = txDetails.vout || [];
      const isSentTx = tx.type === 'sent' || tx.type === 'send';
      const isConsolidationTx = tx.type === 'consolidation';
      const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

      // Populate fee if missing
      populateFee(tx, txDetails, inputs, outputs, prevTxCache, isSentTx, isConsolidationTx, updates, stats);

      // Populate counterparty address if missing
      populateCounterpartyAddress(
        tx, inputs, outputs, prevTxCache, walletAddressSet,
        isSentTx, isReceivedTx, updates, stats
      );

      // Populate addressId if missing
      populateAddressId(
        tx, txDetails, walletAddresses, walletAddressLookup, walletAddressSet,
        updates, stats
      );

      // Collect updates if any
      if (Object.keys(updates).length > 0) {
        if (updates.fee !== undefined) stats.feesPopulated++;
        if (updates.blockHeight !== undefined) stats.blockHeightsPopulated++;
        if (updates.blockTime !== undefined) stats.blockTimesPopulated++;
        if (updates.counterpartyAddress !== undefined) stats.counterpartyAddressesPopulated++;
        if (updates.addressId !== undefined) stats.addressIdsPopulated++;

        pendingUpdates.push({ id: tx.id, txid: tx.txid, oldConfirmations, data: updates });
      }
    } catch (error) {
      log.warn(`Failed to populate fields for tx ${tx.txid}`, { error: String(error) });
      walletLog(walletId, 'warn', 'POPULATE', `Failed to process tx ${tx.txid.slice(0, 8)}...`, { error: String(error) });
    }
  }

  return { pendingUpdates, updated, stats };
}

/**
 * Populate blockHeight from various sources (Electrum, RPC, address history)
 */
function populateBlockHeight(
  tx: { blockHeight: number | null; txid: string },
  txDetails: any,
  txHeightFromHistory: Map<string, number>,
  currentHeight: number,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.blockHeight !== null) return;

  if (txDetails?.blockheight) {
    updates.blockHeight = txDetails.blockheight;
    updates.confirmations = Math.max(0, currentHeight - txDetails.blockheight + 1);
    stats.blockHeightsPopulated++;
  } else if (txDetails?.confirmations && txDetails.confirmations > 0) {
    const calculatedBlockHeight = currentHeight - txDetails.confirmations + 1;
    updates.blockHeight = calculatedBlockHeight;
    updates.confirmations = txDetails.confirmations;
    stats.blockHeightsPopulated++;
  } else if (txHeightFromHistory.has(tx.txid)) {
    const heightFromHistory = txHeightFromHistory.get(tx.txid)!;
    updates.blockHeight = heightFromHistory;
    updates.confirmations = Math.max(0, currentHeight - heightFromHistory + 1);
    stats.blockHeightsPopulated++;
    log.debug(`Got blockHeight ${heightFromHistory} from address history for tx ${tx.txid}`);
  }
}

/**
 * Populate blockTime from transaction details or block header
 */
function populateBlockTime(
  tx: { blockTime: Date | null; blockHeight: number | null },
  txDetails: any,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.blockTime !== null) return;

  if (txDetails.time) {
    updates.blockTime = new Date(txDetails.time * 1000);
    stats.blockTimesPopulated++;
  }
  // Note: async getBlockTimestamp fallback is handled in processTransactionUpdates
}

/**
 * Populate fee from transaction details or input/output calculation
 */
function populateFee(
  tx: { fee: bigint | null; type: string; amount: bigint; txid: string },
  txDetails: any,
  inputs: any[],
  outputs: any[],
  prevTxCache: Map<string, any>,
  isSentTx: boolean,
  isConsolidationTx: boolean,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.fee !== null || (!isSentTx && !isConsolidationTx)) return;

  try {
    if (txDetails.fee != null && txDetails.fee > 0) {
      const feeSats = Math.round(txDetails.fee * 100000000);
      if (feeSats > 0 && feeSats < 100000000) {
        updates.fee = BigInt(feeSats);
        if (isConsolidationTx && tx.amount === BigInt(0)) {
          updates.amount = BigInt(-feeSats);
        }
        stats.feesPopulated++;
      } else {
        log.warn(`Invalid fee from Electrum for tx ${tx.txid}: ${txDetails.fee} BTC`);
      }
    } else {
      let totalInputValue = 0;
      let totalOutputValue = 0;

      for (const output of outputs) {
        if (output.value != null) {
          totalOutputValue += Math.round(output.value * 100000000);
        }
      }

      for (const input of inputs) {
        if (input.coinbase) {
          totalInputValue = totalOutputValue;
          break;
        }

        if (input.prevout && input.prevout.value != null) {
          totalInputValue += Math.round(input.prevout.value * 100000000);
        } else if (input.txid && input.vout != null) {
          const prevTx = prevTxCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            totalInputValue += Math.round(prevTx.vout[input.vout].value * 100000000);
          }
        }
      }

      if (totalInputValue > 0 && totalInputValue >= totalOutputValue) {
        const fee = totalInputValue - totalOutputValue;
        if (fee > 0 && fee < 100000000) {
          updates.fee = BigInt(fee);
          if (isConsolidationTx && tx.amount === BigInt(0)) {
            updates.amount = BigInt(-fee);
          }
          stats.feesPopulated++;
        }
      }
    }
  } catch (feeError) {
    log.warn(`Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
  }
}

/**
 * Populate counterparty address (sender for received, recipient for sent)
 */
function populateCounterpartyAddress(
  tx: { counterpartyAddress: string | null; txid: string },
  inputs: any[],
  outputs: any[],
  prevTxCache: Map<string, any>,
  walletAddressSet: Set<string>,
  isSentTx: boolean,
  isReceivedTx: boolean,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.counterpartyAddress !== null) return;

  try {
    if (isReceivedTx) {
      for (const input of inputs) {
        if (input.coinbase) break;

        if (input.prevout && input.prevout.scriptPubKey) {
          const senderAddr = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          if (senderAddr) {
            updates.counterpartyAddress = senderAddr;
            break;
          }
        } else if (input.txid && input.vout != null) {
          const prevTx = prevTxCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            const senderAddr = prevOutput.scriptPubKey?.address ||
              (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            if (senderAddr) {
              updates.counterpartyAddress = senderAddr;
              break;
            }
          }
        }
      }
    } else if (isSentTx) {
      for (const output of outputs) {
        const outputAddr = output.scriptPubKey?.address ||
          (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);
        if (outputAddr && !walletAddressSet.has(outputAddr)) {
          updates.counterpartyAddress = outputAddr;
          break;
        }
      }
    }
  } catch (counterpartyError) {
    log.warn(`Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
  }
}

/**
 * Populate addressId by matching transaction inputs/outputs to wallet addresses
 */
function populateAddressId(
  tx: { addressId: string | null; type: string },
  txDetails: any,
  walletAddresses: Array<{ id: string; address: string }>,
  walletAddressLookup: Map<string, string>,
  walletAddressSet: Set<string>,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.addressId !== null || walletAddresses.length === 0) return;

  // Check outputs for receive transactions
  if (tx.type === 'received' || tx.type === 'receive') {
    const outputs = txDetails.vout || [];
    for (const output of outputs) {
      const outputAddresses = output.scriptPubKey?.addresses || [];
      if (output.scriptPubKey?.address) {
        outputAddresses.push(output.scriptPubKey.address);
      }

      for (const addr of outputAddresses) {
        if (walletAddressSet.has(addr)) {
          const addressId = walletAddressLookup.get(addr);
          if (addressId) {
            updates.addressId = addressId;
            break;
          }
        }
      }
      if (updates.addressId) break;
    }
  }

  // Check inputs for send transactions
  if (tx.type === 'sent' || tx.type === 'send') {
    const inputs = txDetails.vin || [];
    for (const input of inputs) {
      if (input.prevout && input.prevout.scriptPubKey) {
        const inputAddress = input.prevout.scriptPubKey.address ||
          (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);

        if (inputAddress && walletAddressSet.has(inputAddress)) {
          const addressId = walletAddressLookup.get(inputAddress);
          if (addressId) {
            updates.addressId = addressId;
            break;
          }
        }
      }
    }
  }
}
