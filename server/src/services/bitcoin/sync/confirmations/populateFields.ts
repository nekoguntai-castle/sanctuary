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
import { getBlockHeight } from '../../utils/blockHeight';
import { getNodeClient } from '../../nodeClient';
import { walletLog } from '../../../../websocket/notifications';
import { recalculateWalletBalances } from '../../utils/balanceCalculation';
import { executeInChunks } from './batchUpdates';
import { fetchBlockHeightsFromHistory, fetchTransactionDetails, fetchPreviousTransactions } from './fetchHelpers';
import { processTransactionUpdates } from './processUpdates';
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
