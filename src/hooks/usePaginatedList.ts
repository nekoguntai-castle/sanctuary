/**
 * usePaginatedList Hook
 *
 * Manages the common pagination state pattern used across wallet data views:
 * items array, offset, hasMore flag, and loading state.
 *
 * Reduces useState sprawl — replaces 4-5 individual useState calls per list.
 */

import { useState, useCallback, type SetStateAction } from 'react';

export interface PaginatedListState<T> {
  items: T[];
  offset: number;
  hasMore: boolean;
  loading: boolean;
}

const initialState = <T>(): PaginatedListState<T> => ({
  items: [],
  offset: 0,
  hasMore: true,
  loading: false,
});

export function usePaginatedList<T>() {
  const [state, setState] = useState<PaginatedListState<T>>(initialState);

  const setItems = useCallback((action: SetStateAction<T[]>) => {
    setState(prev => ({
      ...prev,
      items: typeof action === 'function' ? (action as (prev: T[]) => T[])(prev.items) : action,
    }));
  }, []);

  const setOffset = useCallback((offset: number) => {
    setState(prev => ({ ...prev, offset }));
  }, []);

  const setHasMore = useCallback((hasMore: boolean) => {
    setState(prev => ({ ...prev, hasMore }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, loading }));
  }, []);

  const appendItems = useCallback((newItems: T[], totalOrPageSize: number, mode: 'total' | 'pageSize' = 'pageSize') => {
    setState(prev => {
      const nextOffset = prev.offset + newItems.length;
      return {
        items: [...prev.items, ...newItems],
        offset: nextOffset,
        hasMore: mode === 'total' ? nextOffset < totalOrPageSize : newItems.length === totalOrPageSize,
        loading: false,
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
  }, []);

  const replaceItems = useCallback((items: T[], offset: number, hasMore: boolean) => {
    setState({ items, offset, hasMore, loading: false });
  }, []);

  return {
    ...state,
    setItems,
    setOffset,
    setHasMore,
    setLoading,
    appendItems,
    replaceItems,
    reset,
  };
}
