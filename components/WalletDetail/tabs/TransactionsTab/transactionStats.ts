import type { NaturalQueryResult } from '../../../../src/api/ai';
import type { TransactionStats } from '../../../../src/api/transactions';

export function getTransactionStatsForList(
  transactionStats: TransactionStats | null,
  aiQueryFilter: NaturalQueryResult | null,
  hasActiveFilters: boolean
): TransactionStats | undefined {
  if (aiQueryFilter || hasActiveFilters) {
    return undefined;
  }

  return transactionStats || undefined;
}
