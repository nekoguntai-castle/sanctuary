/**
 * Paginated list state with synchronous ownership for replacements and continuations.
 */

import { useCallback, useRef, useState, type SetStateAction } from 'react';

export interface PaginatedListState<T> {
  items: T[];
  offset: number;
  hasMore: boolean;
  loading: boolean;
}

export interface ListEpochToken {
  epoch: number;
}

export interface ListContinuationToken extends ListEpochToken {
  offset: number;
  requestId: number;
}

type HasMoreMode = 'total' | 'pageSize';
type ItemReducer<T> = (items: T[]) => T[];

const initialState = <T>(): PaginatedListState<T> => ({
  items: [],
  offset: 0,
  hasMore: true,
  loading: false,
});

const sameContinuation = (
  left: ListContinuationToken | null,
  right: ListContinuationToken,
): boolean => Boolean(
  left
  && left.epoch === right.epoch
  && left.requestId === right.requestId
  && left.offset === right.offset,
);

const applyReducers = <T>(items: T[], reducers: ItemReducer<T>[]): T[] => (
  reducers.reduce((current, reducer) => reducer(current), items)
);

export function usePaginatedList<T>() {
  const [state, setReactState] = useState<PaginatedListState<T>>(initialState);
  const stateRef = useRef(state);
  const ownershipRef = useRef({
    epoch: 0,
    replacementPending: false,
    requestId: 0,
    continuation: null as ListContinuationToken | null,
    continuationBaseItems: null as T[] | null,
    reducers: [] as ItemReducer<T>[],
  });

  const updateState = useCallback((update: SetStateAction<PaginatedListState<T>>) => {
    const nextState = typeof update === 'function'
      ? (update as (previous: PaginatedListState<T>) => PaginatedListState<T>)(stateRef.current)
      : update;
    stateRef.current = nextState;
    setReactState(nextState);
  }, []);

  const setItems = useCallback((action: SetStateAction<T[]>) => {
    updateState(previous => ({
      ...previous,
      items: typeof action === 'function'
        ? (action as (items: T[]) => T[])(previous.items)
        : action,
    }));
  }, [updateState]);

  const setOffset = useCallback((offset: number) => {
    updateState(previous => ({ ...previous, offset }));
  }, [updateState]);

  const setHasMore = useCallback((hasMore: boolean) => {
    updateState(previous => ({ ...previous, hasMore }));
  }, [updateState]);

  const setLoading = useCallback((loading: boolean) => {
    updateState(previous => ({ ...previous, loading }));
  }, [updateState]);

  const appendItems = useCallback((
    newItems: T[],
    totalOrPageSize: number,
    mode: HasMoreMode = 'pageSize',
  ) => {
    updateState(previous => {
      const nextOffset = previous.offset + newItems.length;
      return {
        items: [...previous.items, ...newItems],
        offset: nextOffset,
        hasMore: mode === 'total'
          ? nextOffset < totalOrPageSize
          : newItems.length === totalOrPageSize,
        loading: false,
      };
    });
  }, [updateState]);

  const invalidateOwnership = useCallback(() => {
    const ownership = ownershipRef.current;
    ownership.epoch += 1;
    ownership.replacementPending = false;
    ownership.continuation = null;
    ownership.continuationBaseItems = null;
    ownership.reducers = [];
  }, []);

  // Apply immediately for responsive UI, then replay the reducer over the
  // owning async result so a late page cannot overwrite the newer mutation.
  const mutateItems = useCallback((action: SetStateAction<T[]>) => {
    const reducer: ItemReducer<T> = typeof action === 'function'
      ? action as ItemReducer<T>
      : () => action;
    const ownership = ownershipRef.current;
    if (ownership.replacementPending || ownership.continuation) {
      ownership.reducers.push(reducer);
    }
    updateState(previous => ({
      ...previous,
      items: reducer(previous.items),
    }));
  }, [updateState]);

  const reset = useCallback(() => {
    invalidateOwnership();
    updateState(initialState());
  }, [invalidateOwnership, updateState]);

  const replaceItems = useCallback((items: T[], offset: number, hasMore: boolean) => {
    invalidateOwnership();
    updateState({ items, offset, hasMore, loading: false });
  }, [invalidateOwnership, updateState]);

  // Every begin must finish through commit/fail with the returned token. A new
  // replacement invalidates older pages and their deferred reducers.
  const beginReplacement = useCallback((): ListEpochToken => {
    const ownership = ownershipRef.current;
    ownership.epoch += 1;
    ownership.replacementPending = true;
    ownership.continuation = null;
    ownership.continuationBaseItems = null;
    ownership.reducers = [];
    updateState(previous => ({ ...previous, loading: true }));
    return { epoch: ownership.epoch };
  }, [updateState]);

  const isEpochOwner = useCallback((token: ListEpochToken): boolean => (
    token.epoch === ownershipRef.current.epoch
  ), []);

  const setHasMoreForEpoch = useCallback((token: ListEpochToken, total: number): boolean => {
    if (token.epoch !== ownershipRef.current.epoch) return false;
    updateState(previous => ({ ...previous, hasMore: previous.offset < total }));
    return true;
  }, [updateState]);

  const captureEpoch = useCallback((): ListEpochToken => ({
    epoch: ownershipRef.current.epoch,
  }), []);

  const commitReplacement = useCallback((
    token: ListEpochToken,
    items: T[],
    offset: number,
    hasMore: boolean,
  ): boolean => {
    const ownership = ownershipRef.current;
    if (!ownership.replacementPending || token.epoch !== ownership.epoch) return false;
    ownership.replacementPending = false;
    const committedItems = applyReducers(items, ownership.reducers);
    ownership.reducers = [];
    updateState({ items: committedItems, offset, hasMore, loading: false });
    return true;
  }, [updateState]);

  const failReplacement = useCallback((token: ListEpochToken): boolean => {
    const ownership = ownershipRef.current;
    if (!ownership.replacementPending || token.epoch !== ownership.epoch) return false;
    ownership.replacementPending = false;
    ownership.reducers = [];
    updateState(previous => ({ ...previous, loading: false }));
    return true;
  }, [updateState]);

  const claimContinuation = useCallback((): ListContinuationToken | null => {
    const ownership = ownershipRef.current;
    const current = stateRef.current;
    if (ownership.replacementPending || ownership.continuation || current.loading || !current.hasMore) {
      return null;
    }

    ownership.requestId += 1;
    const token = {
      epoch: ownership.epoch,
      offset: current.offset,
      requestId: ownership.requestId,
    };
    ownership.continuation = token;
    ownership.continuationBaseItems = current.items;
    ownership.reducers = [];
    updateState(previous => ({ ...previous, loading: true }));
    return token;
  }, [updateState]);

  const commitContinuation = useCallback((
    token: ListContinuationToken,
    newItems: T[],
    totalOrPageSize: number,
    mode: HasMoreMode = 'pageSize',
  ): boolean => {
    const ownership = ownershipRef.current;
    if (token.epoch !== ownership.epoch || !sameContinuation(ownership.continuation, token)) {
      return false;
    }

    ownership.continuation = null;
    const baseItems = ownership.continuationBaseItems as T[];
    const committedItems = applyReducers([...baseItems, ...newItems], ownership.reducers);
    ownership.continuationBaseItems = null;
    ownership.reducers = [];
    const nextOffset = token.offset + newItems.length;
    updateState({
      items: committedItems,
      offset: nextOffset,
      hasMore: mode === 'total'
        ? nextOffset < totalOrPageSize
        : newItems.length === totalOrPageSize,
      loading: false,
    });
    return true;
  }, [updateState]);

  const failContinuation = useCallback((token: ListContinuationToken): boolean => {
    const ownership = ownershipRef.current;
    if (token.epoch !== ownership.epoch || !sameContinuation(ownership.continuation, token)) {
      return false;
    }
    ownership.continuation = null;
    ownership.continuationBaseItems = null;
    ownership.reducers = [];
    updateState(previous => ({ ...previous, loading: false }));
    return true;
  }, [updateState]);

  return {
    ...state,
    appendItems,
    beginReplacement,
    captureEpoch,
    claimContinuation,
    commitContinuation,
    commitReplacement,
    failContinuation,
    failReplacement,
    invalidateOwnership,
    isEpochOwner,
    mutateItems,
    replaceItems,
    reset,
    setHasMore,
    setHasMoreForEpoch,
    setItems,
    setLoading,
    setOffset,
  };
}
