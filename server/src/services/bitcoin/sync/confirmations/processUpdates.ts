/**
 * Process Transaction Updates
 *
 * Main field population logic that examines each transaction
 * and determines what fields need to be filled in.
 */

import { createLogger } from '../../../../utils/logger';
import { getBlockTimestamp } from '../../utils/blockHeight';
import { walletLog } from '../../../../websocket/notifications';
import { populateBlockHeight, populateBlockTime, populateFee, populateCounterpartyAddress, populateAddressId } from './fieldPopulators';
import type { PopulationStats, PendingUpdate } from './types';

const log = createLogger('CONFIRMATIONS');

/**
 * Process all transactions and collect pending database updates.
 * This is the main field population logic that examines each transaction
 * and determines what fields need to be filled in.
 */
export async function processTransactionUpdates(
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
