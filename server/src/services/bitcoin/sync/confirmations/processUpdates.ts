/**
 * Process Transaction Updates
 *
 * Main field population logic that examines each transaction
 * and determines what fields need to be filled in.
 */

import { createLogger } from '../../../../utils/logger';
import { getErrorMessage } from '../../../../utils/errors';
import { getBlockTimestamp } from '../../utils/blockHeight';
import { walletLog } from '../../../../websocket/notifications';
import { populateBlockHeight, populateBlockTime, populateFee, populateCounterpartyAddress, populateAddressId } from './fieldPopulators';
import type { PopulationStats, PendingUpdate } from './types';

const log = createLogger('BITCOIN:SVC_CONFIRMATIONS');
const LOG_INTERVAL = 20;

interface TransactionForUpdate {
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
}

type NetworkName = 'mainnet' | 'testnet' | 'signet' | 'regtest';

/**
 * Process all transactions and collect pending database updates.
 * This is the main field population logic that examines each transaction
 * and determines what fields need to be filled in.
 */
export async function processTransactionUpdates(
  walletId: string,
  transactions: TransactionForUpdate[],
  txDetailsCache: Map<string, any>,
  prevTxCache: Map<string, any>,
  txHeightFromHistory: Map<string, number>,
  walletAddresses: Array<{ id: string; address: string }>,
  walletAddressLookup: Map<string, string>,
  walletAddressSet: Set<string>,
  currentHeight: number,
  network: NetworkName
): Promise<{ pendingUpdates: PendingUpdate[]; updated: number; stats: PopulationStats }> {
  const pendingUpdates: PendingUpdate[] = [];
  const stats = createPopulationStats();

  let processedCount = 0;
  const totalTxCount = transactions.length;

  walletLog(walletId, 'info', 'POPULATE', 'Processing transactions and calculating fields...');

  for (const tx of transactions) {
    processedCount++;

    logProgress(walletId, processedCount, totalTxCount, stats);
    try {
      const pendingUpdate = await processSingleTransaction({
        tx,
        txDetailsCache,
        prevTxCache,
        txHeightFromHistory,
        walletAddresses,
        walletAddressLookup,
        walletAddressSet,
        currentHeight,
        network,
        stats,
      });
      if (pendingUpdate) pendingUpdates.push(pendingUpdate);
    } catch (error) {
      log.warn(`Failed to populate fields for tx ${tx.txid}`, { error: getErrorMessage(error) });
      walletLog(walletId, 'warn', 'POPULATE', `Failed to process tx ${tx.txid.slice(0, 8)}...`, { error: getErrorMessage(error) });
    }
  }

  return { pendingUpdates, updated: pendingUpdates.length, stats };
}

function createPopulationStats(): PopulationStats {
  return {
    feesPopulated: 0,
    blockHeightsPopulated: 0,
    blockTimesPopulated: 0,
    counterpartyAddressesPopulated: 0,
    addressIdsPopulated: 0,
  };
}

function logProgress(
  walletId: string,
  processedCount: number,
  totalTxCount: number,
  stats: PopulationStats
): void {
  if (processedCount % LOG_INTERVAL !== 0 && processedCount !== totalTxCount) {
    return;
  }

  walletLog(walletId, 'info', 'POPULATE', `Processing: ${processedCount}/${totalTxCount} (fees: ${stats.feesPopulated}, heights: ${stats.blockHeightsPopulated}, times: ${stats.blockTimesPopulated})`);
}

async function processSingleTransaction(input: {
  tx: TransactionForUpdate;
  txDetailsCache: Map<string, any>;
  prevTxCache: Map<string, any>;
  txHeightFromHistory: Map<string, number>;
  walletAddresses: Array<{ id: string; address: string }>;
  walletAddressLookup: Map<string, string>;
  walletAddressSet: Set<string>;
  currentHeight: number;
  network: NetworkName;
  stats: PopulationStats;
}): Promise<PendingUpdate | null> {
  const { tx, stats } = input;
  const txDetails = input.txDetailsCache.get(tx.txid);
  const updates: Record<string, unknown> = {};

  populateBlockHeight(tx, txDetails, input.txHeightFromHistory, input.currentHeight, updates, stats);

  if (txDetails) {
    await populateTransactionDetails(input, txDetails, updates);
  }

  return Object.keys(updates).length > 0
    ? { id: tx.id, txid: tx.txid, oldConfirmations: tx.confirmations, data: updates }
    : null;
}

async function populateTransactionDetails(
  input: {
    tx: TransactionForUpdate;
    prevTxCache: Map<string, any>;
    walletAddresses: Array<{ id: string; address: string }>;
    walletAddressLookup: Map<string, string>;
    walletAddressSet: Set<string>;
    network: NetworkName;
    stats: PopulationStats;
  },
  txDetails: any,
  updates: Record<string, unknown>
): Promise<void> {
  const { tx, stats } = input;
  populateBlockTime(tx, txDetails, updates, stats);
  await populateBlockTimeFromHeader(tx, updates, input.network, stats);

  const inputs = txDetails.vin || [];
  const outputs = txDetails.vout || [];
  const isSentTx = tx.type === 'sent' || tx.type === 'send';
  const isConsolidationTx = tx.type === 'consolidation';
  const isReceivedTx = tx.type === 'received' || tx.type === 'receive';

  populateFee(tx, txDetails, inputs, outputs, input.prevTxCache, isSentTx, isConsolidationTx, updates, stats);
  populateCounterpartyAddress(
    tx, inputs, outputs, input.prevTxCache, input.walletAddressSet,
    isSentTx, isReceivedTx, updates, stats
  );
  populateAddressId(
    tx, txDetails, input.walletAddresses, input.walletAddressLookup, input.walletAddressSet,
    updates, stats
  );
}

async function populateBlockTimeFromHeader(
  tx: TransactionForUpdate,
  updates: Record<string, unknown>,
  network: NetworkName,
  stats: PopulationStats
): Promise<void> {
  if (tx.blockTime !== null || updates.blockTime || (!tx.blockHeight && !updates.blockHeight)) {
    return;
  }

  const height = (updates.blockHeight || tx.blockHeight) as number;
  const blockTime = await getBlockTimestamp(height, network);
  if (blockTime) {
    updates.blockTime = blockTime;
    stats.blockTimesPopulated++;
  }
}
