import { describe, expect, it } from 'vitest';
import {
  isFilterResultPartial,
  partialFilterEmptyMessage,
} from '../../../../../src/components/WalletDetail/tabs/TransactionsTab/filterScope';

const AI_FILTER = { type: 'transactions', aggregation: null } as never;

describe('isFilterResultPartial', () => {
  // Every combination of the five operands: a result is partial only when older
  // pages are unloaded, at least one page has loaded, some filter is active, and
  // no known total shows that every live transaction is already loaded.
  const cases: Array<[boolean, number, number | undefined, boolean, boolean, boolean]> = [];
  for (const hasMoreTx of [false, true]) {
    for (const loadedCount of [0, 50]) {
      for (const totalCount of [undefined, 50, 100]) {
        for (const hasActiveFilters of [false, true]) {
          for (const aiActive of [false, true]) {
            const allLoaded = totalCount !== undefined && loadedCount >= totalCount;
            const expected = !allLoaded && hasMoreTx && loadedCount > 0 && (hasActiveFilters || aiActive);
            cases.push([hasMoreTx, loadedCount, totalCount, hasActiveFilters, aiActive, expected]);
          }
        }
      }
    }
  }

  it('covers all 48 combinations', () => {
    expect(cases).toHaveLength(48);
  });

  it.each(cases)(
    'hasMoreTx=%s loadedCount=%s totalCount=%s hasActiveFilters=%s ai=%s -> %s',
    (hasMoreTx, loadedCount, totalCount, hasActiveFilters, aiActive, expected) => {
      expect(
        isFilterResultPartial({
          hasMoreTx,
          loadedCount,
          totalCount,
          hasActiveFilters,
          aiQueryFilter: aiActive ? AI_FILTER : null,
        })
      ).toBe(expected);
    }
  );

  it('is not partial for a wallet holding exactly one full page once that page is loaded', () => {
    expect(
      isFilterResultPartial({ hasMoreTx: true, loadedCount: 50, totalCount: 50, hasActiveFilters: true, aiQueryFilter: null })
    ).toBe(false);
  });

  it('stays partial while the known total exceeds the loaded rows', () => {
    expect(
      isFilterResultPartial({ hasMoreTx: true, loadedCount: 50, totalCount: 51, hasActiveFilters: true, aiQueryFilter: null })
    ).toBe(true);
  });
});

describe('partialFilterEmptyMessage', () => {
  it('names the loaded count and points at Load More', () => {
    expect(partialFilterEmptyMessage(50)).toBe(
      'No matches in the 50 loaded transactions. Load more to search older transactions.'
    );
  });
});
