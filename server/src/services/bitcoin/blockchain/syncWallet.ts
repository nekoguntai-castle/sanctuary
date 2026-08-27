/**
 * Sync Wallet
 *
 * Orchestrates full wallet synchronization using the modular sync pipeline.
 * Handles recursive syncing when gap limit expansion discovers new transactions.
 */

import { getNodeClient } from '../nodeClient';
import {
  walletRepository,
  addressRepository,
  transactionRepository,
} from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { walletLog } from '../../../websocket/notifications';
import { executeSyncPipeline, defaultSyncPhases } from '../sync';
import { normalizeLegacyBitcoinNetwork } from '../networks';
import type { SyncWalletResult } from './types';
import type { WalletSyncMutationFence } from '../../../repositories/types';
import { runWalletSyncMutation } from '../sync/mutationBoundary';
import {
  createSyncStageRuntime,
  type SyncAttemptRuntime,
} from '../sync/attemptRuntime';

const log = createLogger('BITCOIN:SVC_SYNC_WALLET');

class OwnershipRepairPersistenceError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Failed to persist ownership repair targets');
    this.name = 'OwnershipRepairPersistenceError';
    this.cause = cause;
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
 *
 * The optional signal is checked between completed phases and recursive gap
 * passes. An interrupted sync may leave already-committed phase work for the
 * next idempotent sync to reconcile.
 */
// BIP-44 gap limit expansion can trigger recursive syncs when newly generated
// addresses have transactions. Cap recursion to prevent infinite loops when
// scattered transaction patterns keep shrinking the consecutive unused gap.
const MAX_GAP_LIMIT_RECURSION = 10;

export async function syncWallet(
  walletId: string,
  depth = 0,
  signal?: AbortSignal,
  mutationFence?: WalletSyncMutationFence,
  attemptDeadlineAt = Number.POSITIVE_INFINITY,
): Promise<SyncWalletResult> {
  signal?.throwIfAborted();
  const attemptRuntime: SyncAttemptRuntime | undefined = signal
    ? { signal, deadlineAt: attemptDeadlineAt }
    : undefined;
  const result = await executeSyncPipeline(walletId, defaultSyncPhases, {
    ...(signal ? { signal } : {}),
    ...(mutationFence ? { mutationFence } : {}),
    ...(attemptRuntime ? { attemptRuntime } : {}),
  });
  signal?.throwIfAborted();

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

    const recursiveResult = await scanGeneratedAddresses({
      walletId,
      depth,
      generatedCount: result.stats.newAddressesGenerated,
      signal,
      mutationFence,
      attemptRuntime,
      attemptDeadlineAt,
    });
    if (recursiveResult) {
      return {
        addresses: result.addresses + recursiveResult.addresses,
        transactions: result.transactions + recursiveResult.transactions,
        utxos: result.utxos + recursiveResult.utxos,
      };
    }
  }

  return {
    addresses: result.addresses,
    transactions: result.transactions,
    utxos: result.utxos,
  };
}

type RecursiveScanInput = {
  walletId: string;
  depth: number;
  generatedCount: number;
  signal?: AbortSignal;
  mutationFence?: WalletSyncMutationFence;
  attemptRuntime?: SyncAttemptRuntime;
  attemptDeadlineAt: number;
};

const scanGeneratedAddresses = async (
  input: RecursiveScanInput,
): Promise<SyncWalletResult | undefined> => {
  const wallet = await walletRepository.findById(input.walletId);
  input.signal?.throwIfAborted();
  if (!wallet) return undefined;
  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet');
  const stage = input.attemptRuntime
    ? createSyncStageRuntime(input.attemptRuntime, 'gap_limit_recursive_history')
    : undefined;
  const options = stage ? { signal: stage.signal, deadlineAt: stage.deadlineAt } : undefined;
  try {
    const client = options ? await getNodeClient(network, options) : await getNodeClient(network);
    const addresses = await addressRepository.findRecentUnused(
      input.walletId,
      input.generatedCount,
    );
    input.signal?.throwIfAborted();
    if (addresses.length === 0) return undefined;
    const addressStrings = addresses.map(address => address.address);
    const histories = options
      ? await client.getAddressHistoryBatch(addressStrings, options)
      : await client.getAddressHistoryBatch(addressStrings);
    input.signal?.throwIfAborted();
    if (![...histories.values()].some(history => history.length > 0)) return undefined;
    const txids = [...new Set(
      [...histories.values()].flatMap(history => history.map(item => item.tx_hash)),
    )];
    await persistOwnershipRepair(input, txids);
    return syncWallet(
      input.walletId,
      input.depth + 1,
      input.signal,
      input.mutationFence,
      input.attemptDeadlineAt,
    );
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof OwnershipRepairPersistenceError) throw error;
    log.warn(`[BLOCKCHAIN] Failed to scan new addresses: ${error}`);
    return undefined;
  } finally {
    stage?.dispose();
  }
};

const persistOwnershipRepair = async (
  input: RecursiveScanInput,
  txids: string[],
): Promise<void> => {
  try {
    await runWalletSyncMutation(
      {
        walletId: input.walletId,
        mutationFence: input.mutationFence,
        attemptRuntime: input.attemptRuntime,
      },
      'ownership_repair',
      async (tx, deferPostCommit) => {
        const targetAddressCount = (
          await addressRepository.findAddressStrings(input.walletId, tx)
        ).length;
        await transactionRepository.markOwnershipRepairNeeded(
          input.walletId,
          txids,
          targetAddressCount,
          tx,
        );
        deferPostCommit(() => walletLog(
          input.walletId,
          'info',
          'BLOCKCHAIN',
          `Found transactions on new addresses, re-syncing (depth ${input.depth + 1})...`,
        ));
      },
    );
  } catch (error) {
    throw new OwnershipRepairPersistenceError(error);
  }
};
