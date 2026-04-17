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

import { walletRepository, transactionRepository, addressRepository } from '../../../../repositories';
import { createLogger } from '../../../../utils/logger';
import { getBlockHeight } from '../../utils/blockHeight';
import { getNodeClient } from '../../nodeClient';
import { walletLog } from '../../../../websocket/notifications';
import { recalculateWalletBalances } from '../../utils/balanceCalculation';
import { Semaphore } from '../../../../events/semaphore';
import { executeInChunks } from './batchUpdates';
import { fetchBlockHeightsFromHistory, fetchTransactionDetails, fetchPreviousTransactions } from './fetchHelpers';
import { processTransactionUpdates } from './processUpdates';
import type { ConfirmationUpdate, PopulationStats, PopulateFieldsResult } from './types';

const log = createLogger('BITCOIN:SVC_CONFIRMATIONS');

// Limit concurrent populate operations to prevent memory exhaustion
// when multiple wallets sync simultaneously during startup catch-up
const POPULATE_MAX_CONCURRENT = 2;
const populateSemaphore = new Semaphore(POPULATE_MAX_CONCURRENT);

// Process transactions in chunks to bound memory usage during field population.
// Each chunk fetches tx details + previous txs, processes them, writes to DB,
// then releases the caches for GC before the next chunk.
const POPULATE_CHUNK_SIZE = 50;

/**
 * Populate missing transaction fields (blockHeight, addressId, blockTime, fee) from blockchain
 * Called during sync to fill in data for transactions that were created before
 * these fields existed or were populated
 * OPTIMIZED with batch fetching and batch updates
 * Returns both count and confirmation updates for notification broadcasting
 */
export async function populateMissingTransactionFields(walletId: string): Promise<PopulateFieldsResult> {
  // Get wallet to determine network for correct block height
  const network = await walletRepository.findNetwork(walletId);
  if (network === null) {
    return { updated: 0, confirmationUpdates: [] };
  }

  // Acquire semaphore to limit concurrent populate operations
  return populateSemaphore.run(async () => {
    const castNetwork = (network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
    const client = await getNodeClient(castNetwork);

    // Find transactions with missing fields
    const transactions = await transactionRepository.findWithMissingFields(walletId);

    // Fetch wallet addresses separately with only needed fields (more memory efficient)
    const walletAddresses = await addressRepository.findIdAndAddressByWalletId(walletId);

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

    const currentHeight = await getBlockHeight(castNetwork);

    // PHASE 0: Get block heights from address history (runs once — small Map<txid, number>)
    const txHeightFromHistory = await fetchBlockHeightsFromHistory(
      walletId, transactions, walletAddressSet, client
    );

    // Process in chunks to bound memory: fetch, process, write, then release caches for GC
    const allConfirmationUpdates: ConfirmationUpdate[] = [];
    const aggregateStats: PopulationStats = {
      feesPopulated: 0,
      blockHeightsPopulated: 0,
      blockTimesPopulated: 0,
      counterpartyAddressesPopulated: 0,
      addressIdsPopulated: 0,
    };
    let totalUpdated = 0;
    let hasAmountUpdates = false;
    const totalChunks = Math.ceil(transactions.length / POPULATE_CHUNK_SIZE);

    for (let i = 0; i < transactions.length; i += POPULATE_CHUNK_SIZE) {
      const chunk = transactions.slice(i, i + POPULATE_CHUNK_SIZE);
      const chunkNum = Math.floor(i / POPULATE_CHUNK_SIZE) + 1;

      /* v8 ignore next -- multi-chunk logging is covered by chunking behavior tests */
      if (totalChunks > 1) {
        walletLog(walletId, 'info', 'POPULATE', `Processing chunk ${chunkNum}/${totalChunks} (${chunk.length} transactions)`);
      }

      const txDetailsCache = await fetchTransactionDetails(walletId, chunk, client);
      const prevTxCache = await fetchPreviousTransactions(walletId, chunk, txDetailsCache, client);

      const { pendingUpdates, stats } = await processTransactionUpdates(
        walletId, chunk, txDetailsCache, prevTxCache, txHeightFromHistory,
        walletAddresses, walletAddressLookup, walletAddressSet, currentHeight, castNetwork
      );

      if (pendingUpdates.length > 0) {
        await executeInChunks(pendingUpdates, walletId);
        if (pendingUpdates.some(u => u.data.amount !== undefined)) {
          hasAmountUpdates = true;
        }

        // Extract confirmation updates immediately so pendingUpdates can be GC'd
        for (const u of pendingUpdates) {
          if (u.data.confirmations !== undefined && u.data.confirmations !== u.oldConfirmations) {
            allConfirmationUpdates.push({
              txid: u.txid,
              oldConfirmations: u.oldConfirmations,
              newConfirmations: u.data.confirmations as number,
            });
          }
        }
      }

      totalUpdated += pendingUpdates.length;
      aggregateStats.feesPopulated += stats.feesPopulated;
      aggregateStats.blockHeightsPopulated += stats.blockHeightsPopulated;
      aggregateStats.blockTimesPopulated += stats.blockTimesPopulated;
      aggregateStats.counterpartyAddressesPopulated += stats.counterpartyAddressesPopulated;
      aggregateStats.addressIdsPopulated += stats.addressIdsPopulated;
    }

    walletLog(walletId, 'info', 'POPULATE', `Fields calculated: ${totalUpdated} transactions have updates`, {
      fees: aggregateStats.feesPopulated,
      blockHeights: aggregateStats.blockHeightsPopulated,
      blockTimes: aggregateStats.blockTimesPopulated,
      counterpartyAddresses: aggregateStats.counterpartyAddressesPopulated,
      addressIds: aggregateStats.addressIdsPopulated,
    });

    if (totalUpdated > 0) {
      walletLog(walletId, 'info', 'POPULATE', `Saved ${totalUpdated} transaction updates`);
      if (hasAmountUpdates) {
        walletLog(walletId, 'info', 'POPULATE', 'Recalculating running balances...');
        await recalculateWalletBalances(walletId);
      }
    } else {
      walletLog(walletId, 'info', 'POPULATE', 'No transaction updates needed');
    }

    const confirmationUpdates = allConfirmationUpdates;

    log.debug(`Populated missing fields for ${totalUpdated} transactions, ${confirmationUpdates.length} confirmation updates`);
    walletLog(walletId, 'info', 'POPULATE', `Field population complete: ${totalUpdated} transactions updated, ${confirmationUpdates.length} confirmation changes`);
    return { updated: totalUpdated, confirmationUpdates };
  });
}
