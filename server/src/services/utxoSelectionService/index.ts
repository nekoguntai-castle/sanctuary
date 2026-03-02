/**
 * UTXO Selection Service
 *
 * Provides different strategies for selecting UTXOs for transactions:
 * - Privacy: Minimize address linkage, prefer already-linked UTXOs
 * - Efficiency: Minimize transaction fees (fewest inputs)
 * - Oldest First: Use oldest UTXOs first (reduce UTXO set age)
 * - Largest First: Use largest UTXOs (minimize input count)
 * - Smallest First: Use smallest UTXOs (consolidation mode)
 */

import { createLogger } from '../../utils/logger';
import { getAvailableUtxos } from './queries';
import {
  selectForPrivacy,
  selectForEfficiency,
  selectOldestFirst,
  selectLargestFirst,
  selectSmallestFirst,
} from './strategies';
import type { SelectionStrategy, SelectionResult, SelectionOptions } from './types';

const log = createLogger('UTXO-SELECTION');

// Re-export all types and strategy helpers
export type { SelectionStrategy, SelectedUtxo, SelectionResult, SelectionOptions } from './types';
export { calculateFee } from './strategies';

/**
 * Select UTXOs using the specified strategy
 */
export async function selectUtxos(options: SelectionOptions): Promise<SelectionResult> {
  const {
    walletId,
    targetAmount,
    feeRate,
    strategy,
    excludeFrozen = true,
    excludeUnconfirmed = false,
    excludeUtxoIds = [],
    scriptType = 'native_segwit',
  } = options;

  // Validate that targetAmount is positive
  if (targetAmount <= BigInt(0)) {
    throw new Error('targetAmount must be a positive BigInt');
  }

  log.debug(`Selecting UTXOs for wallet ${walletId}`, {
    targetAmount: targetAmount.toString(),
    feeRate,
    strategy,
  });

  const utxos = await getAvailableUtxos(walletId, {
    excludeFrozen,
    excludeUnconfirmed,
    excludeUtxoIds,
  });

  if (utxos.length === 0) {
    return {
      selected: [],
      totalAmount: BigInt(0),
      estimatedFee: BigInt(0),
      changeAmount: BigInt(0),
      inputCount: 0,
      strategy,
      warnings: ['No available UTXOs'],
    };
  }

  switch (strategy) {
    case 'privacy':
      return selectForPrivacy(utxos, targetAmount, feeRate, scriptType);
    case 'efficiency':
      return selectForEfficiency(utxos, targetAmount, feeRate, scriptType);
    case 'oldest_first':
      return selectOldestFirst(utxos, targetAmount, feeRate, scriptType);
    case 'largest_first':
      return selectLargestFirst(utxos, targetAmount, feeRate, scriptType);
    case 'smallest_first':
      return selectSmallestFirst(utxos, targetAmount, feeRate, scriptType);
  }
}

/**
 * Compare different selection strategies for a given amount
 */
export async function compareStrategies(
  walletId: string,
  targetAmount: bigint,
  feeRate: number,
  scriptType: string = 'native_segwit'
): Promise<Record<SelectionStrategy, SelectionResult>> {
  const strategies: SelectionStrategy[] = [
    'privacy',
    'efficiency',
    'oldest_first',
    'largest_first',
    'smallest_first',
  ];

  const results: Record<string, SelectionResult> = {};

  for (const strategy of strategies) {
    results[strategy] = await selectUtxos({
      walletId,
      targetAmount,
      feeRate,
      strategy,
      scriptType,
    });
  }

  return results as Record<SelectionStrategy, SelectionResult>;
}

/**
 * Get recommended strategy based on context
 */
export function getRecommendedStrategy(
  utxoCount: number,
  feeRate: number,
  prioritizePrivacy: boolean = false
): { strategy: SelectionStrategy; reason: string } {
  if (prioritizePrivacy) {
    return {
      strategy: 'privacy',
      reason: 'Minimizes address linkage for better privacy',
    };
  }

  if (feeRate > 50) {
    return {
      strategy: 'efficiency',
      reason: 'High fee environment - minimizing input count saves fees',
    };
  }

  if (feeRate < 5 && utxoCount > 20) {
    return {
      strategy: 'smallest_first',
      reason: 'Low fee environment - good time to consolidate small UTXOs',
    };
  }

  return {
    strategy: 'efficiency',
    reason: 'Default: minimizes transaction fees',
  };
}
