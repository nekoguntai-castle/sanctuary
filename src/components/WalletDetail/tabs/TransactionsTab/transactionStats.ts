import type { NaturalQueryResult } from '../../../../api/ai';
import type { TransactionStats } from '../../../../api/transactions';

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
