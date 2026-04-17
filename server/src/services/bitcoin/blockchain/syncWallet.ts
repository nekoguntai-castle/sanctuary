/**
 * Sync Wallet
 *
 * Orchestrates full wallet synchronization using the modular sync pipeline.
 * Handles recursive syncing when gap limit expansion discovers new transactions.
 */

import { getNodeClient } from '../nodeClient';
import { walletRepository, addressRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { walletLog } from '../../../websocket/notifications';
import { executeSyncPipeline, defaultSyncPhases } from '../sync';
import type { SyncWalletResult } from './types';

const log = createLogger('BITCOIN:SVC_SYNC_WALLET');

async function subscribeGeneratedAddresses(
  walletId: string,
  client: Awaited<ReturnType<typeof getNodeClient>>,
  addresses: string[]
): Promise<void> {
  /* v8 ignore next -- caller avoids empty generated-address batches */
  if (addresses.length === 0) return;

  try {
    await client.subscribeAddressBatch(addresses);
  } catch (error) {
    log.warn(`[BLOCKCHAIN] Failed to batch-subscribe generated addresses for wallet ${walletId}`, {
      /* v8 ignore start -- defensive: callers pass Error instances from Electrum clients in practice */
      error: error instanceof Error ? error.message : String(error),
      /* v8 ignore stop */
      count: addresses.length,
    });

    for (const address of addresses) {
      try {
        await client.subscribeAddress(address);
      } catch (subscribeError) {
        /* v8 ignore next 3 -- defensive per-address fallback path is only reached after batch failure */
        log.warn(`[BLOCKCHAIN] Failed to subscribe generated address ${address} for wallet ${walletId}`, {
          error: subscribeError instanceof Error ? subscribeError.message : String(subscribeError),
        });
      }
    }
  }
}

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
// BIP-44 gap limit expansion can trigger recursive syncs when newly generated
// addresses have transactions. Cap recursion to prevent infinite loops when
// scattered transaction patterns keep shrinking the consecutive unused gap.
const MAX_GAP_LIMIT_RECURSION = 10;

export async function syncWallet(walletId: string, depth = 0): Promise<SyncWalletResult> {
  const result = await executeSyncPipeline(walletId, defaultSyncPhases);

  // Handle recursive sync for gap limit expansion
  if (result.stats.newAddressesGenerated > 0) {
    if (depth >= MAX_GAP_LIMIT_RECURSION) {
      log.warn(`[BLOCKCHAIN] Gap limit recursion depth ${depth} reached for wallet ${walletId}, stopping`, {
        newAddressesGenerated: result.stats.newAddressesGenerated,
      });
      return {
        addresses: result.addresses,
        transactions: result.transactions,
        utxos: result.utxos,
      };
    }

    const wallet = await walletRepository.findById(walletId);
    if (wallet) {
      const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';
      const client = await getNodeClient(network);

      const newAddresses = await addressRepository.findRecentUnused(walletId, result.stats.newAddressesGenerated);

      if (newAddresses.length > 0) {
        try {
          await subscribeGeneratedAddresses(walletId, client, newAddresses.map(a => a.address));
          const newHistoryResults = await client.getAddressHistoryBatch(newAddresses.map(a => a.address));

          let foundTransactions = false;
          for (const [, history] of newHistoryResults) {
            if (history.length > 0) {
              foundTransactions = true;
              break;
            }
          }

          if (foundTransactions) {
            walletLog(walletId, 'info', 'BLOCKCHAIN', `Found transactions on new addresses, re-syncing (depth ${depth + 1})...`);
            const recursiveResult = await syncWallet(walletId, depth + 1);
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
