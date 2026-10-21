import type { NaturalQueryResult } from '../../../../api/ai';

interface FilterScopeInput {
  /** Older pages exist that have not been loaded. */
  hasMoreTx: boolean;
  /**
   * Live (non-RBF-replaced) transactions loaded so far. Counted like the
   * server's `totalCount`, which also excludes replaced rows.
   */
  loadedCount: number;
  /** The wallet's live transaction count from the stats endpoint, when known. */
  totalCount?: number;
  hasActiveFilters: boolean;
  aiQueryFilter: NaturalQueryResult | null;
}

/**
 * Manual and AI filters run only over the loaded pages. A result is partial
 * when some filter is active and older pages are still unloaded. With nothing
 * loaded yet there is no result to qualify, and no Load More button to point
 * at (LoadMoreTransactions hides it for an empty list). `hasMoreTx` is a guess
 * from a full last page, so a known total that every loaded row already covers
 * (a wallet holding an exact multiple of the page size) is not partial.
 */
export function isFilterResultPartial({
  hasMoreTx,
  loadedCount,
  totalCount,
  hasActiveFilters,
  aiQueryFilter,
}: FilterScopeInput): boolean {
  if (totalCount !== undefined && loadedCount >= totalCount) {
    return false;
  }
  return hasMoreTx && loadedCount > 0 && (hasActiveFilters || aiQueryFilter !== null);
}

/** Empty-state text for a partial filter result: no match among the loaded rows is not "none at all". */
export function partialFilterEmptyMessage(loadedCount: number): string {
  return `No matches in the ${loadedCount} loaded transactions. Load more to search older transactions.`;
}
