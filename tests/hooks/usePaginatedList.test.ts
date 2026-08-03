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
});
