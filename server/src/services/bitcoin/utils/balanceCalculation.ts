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
import type { PrismaTxClient } from '../../../models/prisma';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;

const log = createLogger('BITCOIN:SVC_BALANCE');

export interface ConsolidationCorrectionCandidate {
  readonly id: string;
  readonly txid: string;
  readonly amount: bigint;
}

export interface ConsolidationCorrectionPlan {
  readonly walletId: string;
  readonly walletAddresses: readonly string[];
  readonly candidates: readonly ConsolidationCorrectionCandidate[];
}

/**
 * Prepare a consolidation-repair plan without holding a mutation transaction.
 *
 * During sync, a consolidation can be misclassified as "sent" if the output
 * address wasn't in the wallet's address set yet (it gets derived later via
 * gap limit expansion). This function finds such transactions and corrects them.
 *
 * A transaction should be a "consolidation" if:
 * - It's currently marked as "sent"
 * - ALL outputs go to wallet addresses (no external outputs)
 *
 * Address and transaction reads deliberately happen before the caller enters
 * its short fenced write transaction.
 */
export async function prepareMisclassifiedConsolidations(
  walletId: string,
  tx?: PrismaTxClient,
): Promise<ConsolidationCorrectionPlan> {
  // Get all wallet addresses
  const walletAddressStrings = await addressRepository.findAddressStrings(walletId, tx);
  const walletAddressSet = new Set(walletAddressStrings);

  // Find all "sent" transactions with their outputs
  const sentTransactions = await transactionRepository.findSentWithOutputs(walletId, tx);

  const candidates: ConsolidationCorrectionCandidate[] = [];

  for (const transaction of sentTransactions) {
    // Skip if no outputs recorded (can't verify)
    if (!transaction.outputs || transaction.outputs.length === 0) continue;

    // Check if ALL outputs go to wallet addresses
    let allOutputsToWallet = true;
    let hasWalletOutput = false;
    for (const output of transaction.outputs) {
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
      candidates.push({
        id: transaction.id,
        txid: transaction.txid,
        amount: transaction.fee !== null ? -transaction.fee : BigInt(0),
      });
    }
  }

  return { walletId, walletAddresses: walletAddressStrings, candidates };
}

export async function persistMisclassifiedConsolidations(
  plan: ConsolidationCorrectionPlan,
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<number> {
  let corrected = 0;
  const walletAddresses = [...plan.walletAddresses];
  for (const candidate of plan.candidates) {
    const changed = await balanceCorrectionRepository.correctTransactionToConsolidation(
      candidate.id,
      candidate.amount,
      walletAddresses,
      tx,
    );
    if (!changed) continue;
    corrected++;
    const publishCorrection = () => log.info(
      `Correcting misclassified consolidation: ${candidate.txid}`
    );
    if (deferPostCommit) deferPostCommit(publishCorrection);
    else publishCorrection();
  }

  if (corrected > 0) {
    const publishSummary = () => log.info(
      `Corrected ${corrected} misclassified consolidations in wallet ${plan.walletId}`
    );
    if (deferPostCommit) deferPostCommit(publishSummary);
    else publishSummary();
  }

  return corrected;
}

/** Compatibility wrapper for non-canonical callers; canonical sync splits reads and fenced writes. */
export async function correctMisclassifiedConsolidations(
  walletId: string,
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<number> {
  const plan = await prepareMisclassifiedConsolidations(walletId, tx);
  return persistMisclassifiedConsolidations(plan, tx, deferPostCommit);
}

/**
 * Recalculate balanceAfter for all transactions in a wallet
 * Called after new transactions are inserted to ensure running balances are accurate
 * OPTIMIZED: Uses batched updates instead of N+1 individual queries
 */
export async function recalculateWalletBalances(
  walletId: string,
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<void> {
  const transactionCount = await transactionRepository.recalculateBalancesAtomically(walletId, tx);
  if (transactionCount > 0) {
    const publish = () => log.debug(
      `Recalculated balances for ${transactionCount} transactions in wallet ${walletId}`
    );
    if (deferPostCommit) deferPostCommit(publish);
    else publish();
  }
}
