import type { Transaction } from '../../types';

/**
 * The rows a transaction list displays: RBF-replaced transactions are dropped
 * before rendering rows and tiles. Callers that count "shown" or "loaded"
 * transactions use this so their counts match the list.
 */
export function excludeReplacedTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(tx => tx.rbfStatus !== 'replaced');
}
