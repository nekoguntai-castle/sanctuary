/**
 * Balance Calculation Utilities
 *
 * Handles wallet balance recalculation, running balance updates,
 * and correction of misclassified transactions.
 */

import {
  addressRepository,
  balanceCorrectionRepository,
  transactionRepository,
} from '../../../repositories';
import { createLogger } from '../../../utils/logger';

const log = createLogger('BITCOIN:SVC_BALANCE');

/**
 * Correct misclassified consolidation transactions
 *
 * During sync, a consolidation can be misclassified as "sent" if the output
 * address wasn't in the wallet's address set yet (it gets derived later via
 * gap limit expansion). This function finds such transactions and corrects them.
 *
 * A transaction should be a "consolidation" if:
 * - It's currently marked as "sent"
 * - ALL outputs go to wallet addresses (no external outputs)
 *
 * @returns Number of transactions corrected
 */
export async function correctMisclassifiedConsolidations(walletId: string): Promise<number> {
  // Get all wallet addresses
  const walletAddressStrings = await addressRepository.findAddressStrings(walletId);
  const walletAddressSet = new Set(walletAddressStrings);

  // Find all "sent" transactions with their outputs
  const sentTransactions = await transactionRepository.findSentWithOutputs(walletId);

  let corrected = 0;

  for (const tx of sentTransactions) {
    // Skip if no outputs recorded (can't verify)
    if (!tx.outputs || tx.outputs.length === 0) continue;

    // Check if ALL outputs go to wallet addresses
    let allOutputsToWallet = true;
    let hasWalletOutput = false;
    for (const output of tx.outputs) {
      if (!output.address) {
        // Unknown address (e.g., OP_RETURN) - skip this output
        continue;
      }
      if (walletAddressSet.has(output.address)) {
        hasWalletOutput = true;
      } else {
        // Output to external address - this is NOT a consolidation
        allOutputsToWallet = false;
        break;
      }
    }

    if (allOutputsToWallet && hasWalletOutput) {
      // This is actually a consolidation - fix it
      log.info(`Correcting misclassified consolidation: ${tx.txid}`);

      const changed = await balanceCorrectionRepository.correctTransactionToConsolidation(
        tx.id,
        tx.fee !== null ? -tx.fee : BigInt(0),
        walletAddressStrings,
      );
      if (changed) corrected++;
    }
  }

  if (corrected > 0) {
    log.info(`Corrected ${corrected} misclassified consolidations in wallet ${walletId}`);
  }

  return corrected;
}

/**
 * Recalculate balanceAfter for all transactions in a wallet
 * Called after new transactions are inserted to ensure running balances are accurate
 * OPTIMIZED: Uses batched updates instead of N+1 individual queries
 */
export async function recalculateWalletBalances(walletId: string): Promise<void> {
  const transactionCount = await transactionRepository.recalculateBalancesAtomically(walletId);
  if (transactionCount > 0) {
    log.debug(`Recalculated balances for ${transactionCount} transactions in wallet ${walletId}`);
  }
}
