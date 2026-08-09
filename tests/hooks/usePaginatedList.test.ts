/**
 * usePaginatedList Hook Tests
 *
 * Tests for the pagination state management hook that reduces useState sprawl
 * by combining items, offset, hasMore, and loading into a single state object.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePaginatedList } from '../../src/hooks/usePaginatedList';

describe('usePaginatedList', () => {
  describe('initial state', () => {
    it('starts with empty items, offset 0, hasMore true, loading false', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      expect(result.current.items).toEqual([]);
      expect(result.current.offset).toBe(0);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('setItems', () => {
    it('sets items with a direct value', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.setItems(['a', 'b', 'c']);
      });

      expect(result.current.items).toEqual(['a', 'b', 'c']);
    });

    it('sets items with an updater function', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.setItems(['a']);
      });

      act(() => {
        result.current.setItems(prev => [...prev, 'b']);
      });

      expect(result.current.items).toEqual(['a', 'b']);
    });

    it('updater function receives current items', () => {
      const { result } = renderHook(() => usePaginatedList<number>());

      act(() => {
        result.current.setItems([1, 2, 3]);
      });

      act(() => {
        result.current.setItems(prev => prev.filter(n => n > 1));
      });

      expect(result.current.items).toEqual([2, 3]);
    });
  });

  describe('setOffset', () => {
    it('updates the offset', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.setOffset(50);
      });

      expect(result.current.offset).toBe(50);
    });
  });

  describe('setHasMore', () => {
    it('updates the hasMore flag', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      expect(result.current.hasMore).toBe(true);

      act(() => {
        result.current.setHasMore(false);
      });

      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('updates the loading flag', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.loading).toBe(true);
    });
  });

  describe('appendItems', () => {
    it('appends items and determines hasMore by pageSize mode', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['a', 'b'], 2);
      });

      expect(result.current.items).toEqual(['a', 'b']);
      expect(result.current.offset).toBe(2);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.loading).toBe(false);
    });

    it('sets hasMore false when page is not full (pageSize mode)', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['a'], 2);
      });

      expect(result.current.hasMore).toBe(false);
    });

    it('determines hasMore by total mode', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['a', 'b'], 5, 'total');
      });

      expect(result.current.hasMore).toBe(true);
      expect(result.current.offset).toBe(2);
    });

    it('sets hasMore false when offset reaches total (total mode)', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['a', 'b', 'c'], 3, 'total');
      });

      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('replaceItems', () => {
    it('replaces all state values at once', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['old'], 10);
      });

      act(() => {
        result.current.replaceItems(['x', 'y'], 2, false);
      });

      expect(result.current.items).toEqual(['x', 'y']);
      expect(result.current.offset).toBe(2);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      const { result } = renderHook(() => usePaginatedList<string>());

      act(() => {
        result.current.appendItems(['a', 'b'], 2);
        result.current.setLoading(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.items).toEqual([]);
      expect(result.current.offset).toBe(0);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('request ownership', () => {
    it('permits only one same-tick continuation claim and one append', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      let first: ReturnType<typeof result.current.claimContinuation>;
      let second: ReturnType<typeof result.current.claimContinuation>;

      act(() => {
        first = result.current.claimContinuation();
        second = result.current.claimContinuation();
      });

      expect(first!).not.toBeNull();
      expect(second!).toBeNull();
      act(() => {
        expect(result.current.commitContinuation(first!, ['next'], 1)).toBe(true);
        expect(result.current.commitContinuation(first!, ['duplicate'], 1)).toBe(false);
      });
      expect(result.current.items).toEqual(['next']);
      expect(result.current.offset).toBe(1);
    });

    it('invalidates a continuation when a replacement starts', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      let continuation: ReturnType<typeof result.current.claimContinuation>;
      let replacement: ReturnType<typeof result.current.beginReplacement>;

      act(() => {
        continuation = result.current.claimContinuation();
        replacement = result.current.beginReplacement();
      });
      expect(result.current.claimContinuation()).toBeNull();

      act(() => {
        expect(result.current.commitContinuation(continuation!, ['stale'], 1)).toBe(false);
        expect(result.current.failContinuation(continuation!)).toBe(false);
        expect(result.current.commitReplacement(replacement!, ['fresh'], 1, false)).toBe(true);
      });
      expect(result.current).toMatchObject({
        items: ['fresh'],
        offset: 1,
        hasMore: false,
        loading: false,
      });
    });

    it('does not let stale replacement failure clear newer loading state', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      let older: ReturnType<typeof result.current.beginReplacement>;
      let newer: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        older = result.current.beginReplacement();
        newer = result.current.beginReplacement();
        expect(result.current.failReplacement(older!)).toBe(false);
      });
      expect(result.current.loading).toBe(true);
      act(() => {
        expect(result.current.failReplacement(newer!)).toBe(true);
      });
      expect(result.current.loading).toBe(false);
    });

    it('updates metadata only for the current epoch', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      const current = result.current.captureEpoch();
      act(() => {
        expect(result.current.setHasMoreForEpoch(current, 0)).toBe(true);
      });
      expect(result.current.hasMore).toBe(false);

      let replacement: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        replacement = result.current.beginReplacement();
        expect(result.current.setHasMoreForEpoch(current, 10)).toBe(false);
      });
      expect(result.current.loading).toBe(true);
      act(() => {
        expect(result.current.commitReplacement(replacement!, [], 0, true)).toBe(true);
        expect(result.current.commitReplacement(replacement!, ['late'], 1, false)).toBe(false);
      });
      expect(result.current.items).toEqual([]);
    });

    it('replays replacement-time reducers over the owned result without ending loading', () => {
      const { result } = renderHook(() => usePaginatedList<{ id: string; count: number }>());
      let replacement: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        replacement = result.current.beginReplacement();
        result.current.mutateItems(items => items.map(item => ({ ...item, count: item.count + 1 })));
      });

      expect(result.current).toMatchObject({ items: [], loading: true, offset: 0, hasMore: true });
      act(() => {
        expect(result.current.commitReplacement(
          replacement!,
          [{ id: 'loaded', count: 0 }],
          1,
          false,
        )).toBe(true);
      });
      expect(result.current).toMatchObject({
        items: [{ id: 'loaded', count: 1 }],
        loading: false,
        offset: 1,
        hasMore: false,
      });
    });

    it('supports direct-value mutations without changing pagination metadata', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      act(() => {
        result.current.setOffset(4);
        result.current.setHasMore(false);
        result.current.mutateItems(['direct']);
      });
      expect(result.current).toMatchObject({
        items: ['direct'],
        loading: false,
        offset: 4,
        hasMore: false,
      });
    });

    it('replays continuation-time reducers exactly once over its base and new page', () => {
      const { result } = renderHook(() => usePaginatedList<{ id: string; count: number }>());
      let continuation: ReturnType<typeof result.current.claimContinuation>;
      act(() => {
        result.current.setItems([{ id: 'existing', count: 0 }]);
        result.current.setOffset(1);
        continuation = result.current.claimContinuation();
        result.current.mutateItems(items => items.map(item => ({ ...item, count: item.count + 1 })));
      });
      expect(result.current).toMatchObject({
        items: [{ id: 'existing', count: 1 }],
        loading: true,
        offset: 1,
        hasMore: true,
      });

      act(() => {
        expect(result.current.commitContinuation(
          continuation!,
          [{ id: 'new', count: 0 }],
          2,
          'total',
        )).toBe(true);
      });
      expect(result.current).toMatchObject({
        items: [{ id: 'existing', count: 1 }, { id: 'new', count: 1 }],
        loading: false,
        offset: 2,
        hasMore: false,
      });
    });

    it('clears older reducers when a new replacement starts or the list resets', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      let older: ReturnType<typeof result.current.beginReplacement>;
      let newer: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        result.current.setItems(['visible']);
        older = result.current.beginReplacement();
        result.current.mutateItems(items => [...items, 'old-reducer']);
        newer = result.current.beginReplacement();
      });
      expect(result.current).toMatchObject({ items: ['visible', 'old-reducer'], loading: true });

      act(() => {
        expect(result.current.commitReplacement(older!, ['older'], 1, false)).toBe(false);
        expect(result.current.commitReplacement(newer!, ['newer'], 1, false)).toBe(true);
      });
      expect(result.current.items).toEqual(['newer']);

      act(() => {
        const pending = result.current.beginReplacement();
        result.current.mutateItems(items => [...items, 'reset-reducer']);
        result.current.reset();
        expect(result.current.commitReplacement(pending, ['late'], 1, false)).toBe(false);
      });
      expect(result.current).toMatchObject({ items: [], loading: false, offset: 0, hasMore: true });
    });

    it('keeps a mutation when its owned request fails and does not replay it later', () => {
      const { result } = renderHook(() => usePaginatedList<string>());
      let failed: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        result.current.setItems(['original']);
        failed = result.current.beginReplacement();
        result.current.mutateItems(items => [...items, 'mutation']);
        expect(result.current.failReplacement(failed!)).toBe(true);
      });
      expect(result.current).toMatchObject({ items: ['original', 'mutation'], loading: false });

      let later: ReturnType<typeof result.current.beginReplacement>;
      act(() => {
        later = result.current.beginReplacement();
        expect(result.current.commitReplacement(later!, ['fresh'], 1, false)).toBe(true);
      });
      expect(result.current.items).toEqual(['fresh']);
    });
  });
});
