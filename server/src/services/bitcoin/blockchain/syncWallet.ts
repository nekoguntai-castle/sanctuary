/**
 * Sync Wallet
 *
 * Orchestrates full wallet synchronization using the modular sync pipeline.
 * Handles recursive syncing when gap limit expansion discovers new transactions.
 */

import { getNodeClient } from '../nodeClient';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { walletLog } from '../../../websocket/notifications';
import { executeSyncPipeline, defaultSyncPhases } from '../sync';
import type { SyncWalletResult } from './types';

const log = createLogger('BLOCKCHAIN');

/**
 * Sync all addresses for a wallet using the modular sync pipeline
 *
 * The sync pipeline processes wallet synchronization in discrete phases:
 * 1. RBF Cleanup - Mark replaced pending transactions
 * 2. Fetch Histories - Get transaction history for all addresses
 * 3. Check Existing - Filter out already-processed transactions
 * 4. Process Transactions - Fetch details, classify, and insert
 * 5. Fetch UTXOs - Get unspent outputs for all addresses
 * 6. Reconcile UTXOs - Mark spent UTXOs, update confirmations
 * 7. Insert UTXOs - Add new UTXOs to database
 * 8. Update Addresses - Mark addresses with history as "used"
 * 9. Gap Limit - Generate new addresses if needed
 * 10. Fix Consolidations - Correct misclassified consolidation transactions
 */
export async function syncWallet(walletId: string): Promise<SyncWalletResult> {
  const result = await executeSyncPipeline(walletId, defaultSyncPhases);

  // Handle recursive sync for gap limit expansion
  if (result.stats.newAddressesGenerated > 0) {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (wallet) {
      const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
      const client = await getNodeClient(network);

      const newAddresses = await prisma.address.findMany({
        where: {
          walletId,
          used: false,
        },
        orderBy: { createdAt: 'desc' },
        take: result.stats.newAddressesGenerated,
      });

      if (newAddresses.length > 0) {
        try {
          const newHistoryResults = await client.getAddressHistoryBatch(newAddresses.map(a => a.address));

          let foundTransactions = false;
          for (const [, history] of newHistoryResults) {
            if (history.length > 0) {
              foundTransactions = true;
              break;
            }
          }

          if (foundTransactions) {
            walletLog(walletId, 'info', 'BLOCKCHAIN', 'Found transactions on new addresses, re-syncing...');
            const recursiveResult = await syncWallet(walletId);
            return {
              addresses: result.addresses + recursiveResult.addresses,
              transactions: result.transactions + recursiveResult.transactions,
              utxos: result.utxos + recursiveResult.utxos,
            };
          }
        } catch (error) {
          log.warn(`[BLOCKCHAIN] Failed to scan new addresses: ${error}`);
        }
      }
    }
  }

  return {
    addresses: result.addresses,
    transactions: result.transactions,
    utxos: result.utxos,
  };
}
