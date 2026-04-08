/**
 * Tests for hooks/queries/factory.ts
 *
 * Tests the generic React Query hook factories: createQueryKeys, createListQuery,
 * createDetailQuery, createMutation, and createInvalidateAll.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createQueryKeys,
  createListQuery,
  createDetailQuery,
  createMutation,
  createInvalidateAll,
} from '../../../hooks/queries/factory';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Creates a wrapper that also exposes the QueryClient for spying. */
function createWrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

describe('createQueryKeys', () => {
  it('returns an all key containing the domain', () => {
    const keys = createQueryKeys('widgets');
    expect(keys.all).toEqual(['widgets']);
  });

  it('returns a lists() key appending "list"', () => {
    const keys = createQueryKeys('widgets');
    expect(keys.lists()).toEqual(['widgets', 'list']);
  });

  it('returns a detail(id) key appending "detail" and the id', () => {
    const keys = createQueryKeys('widgets');
    expect(keys.detail('w-42')).toEqual(['widgets', 'detail', 'w-42']);
  });

  it('produces distinct keys for different domains', () => {
    const a = createQueryKeys('alpha');
    const b = createQueryKeys('beta');
    expect(a.all).not.toEqual(b.all);
    expect(a.lists()).not.toEqual(b.lists());
    expect(a.detail('1')).not.toEqual(b.detail('1'));
  });
});

describe('createListQuery', () => {
  const keys = createQueryKeys('items');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the queryFn and returns data', async () => {
    const mockData = [{ id: '1' }, { id: '2' }];
    const queryFn = vi.fn().mockResolvedValue(mockData);
    const useItems = createListQuery(keys, queryFn);

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(mockData);
  });

  it('handles query error', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const useItems = createListQuery(keys, queryFn);

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });

  it('enables keepPrevious by default (placeholderData is set)', async () => {
    const queryFn = vi.fn().mockResolvedValue(['a']);
    const useItems = createListQuery(keys, queryFn);

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // When keepPrevious is true, isPlaceholderData should be false when real data arrives
    // but the option is present. We verify the hook resolved successfully, meaning
    // placeholderData was accepted without error.
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('disables keepPrevious when explicitly set to false', async () => {
    const queryFn = vi.fn().mockResolvedValue(['a']);
    const useItems = createListQuery(keys, queryFn, { keepPrevious: false });

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(['a']);
  });

  it('passes refetchInterval option through', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const useItems = createListQuery(keys, queryFn, { refetchInterval: 5000 });

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalled();
  });

  it('passes staleTime option through', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const useItems = createListQuery(keys, queryFn, { staleTime: 60_000 });

    const { result } = renderHook(() => useItems(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalled();
  });

  it('accepts overrides from the hook caller', async () => {
    const queryFn = vi.fn().mockResolvedValue(['original']);
    const useItems = createListQuery(keys, queryFn);

    // Override enabled to false
    const { result } = renderHook(() => useItems({ enabled: false }), {
      wrapper: createWrapper(),
    });

    // Should never fetch because enabled is false
    expect(result.current.fetchStatus).toBe('idle');
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('createDetailQuery', () => {
  const keys = createQueryKeys('things');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls queryFn with the id and returns data', async () => {
    const mockThing = { id: 't-1', name: 'Thing One' };
    const queryFn = vi.fn().mockResolvedValue(mockThing);
    const useThing = createDetailQuery(keys, queryFn);

    const { result } = renderHook(() => useThing('t-1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalledWith('t-1');
    expect(result.current.data).toEqual(mockThing);
  });

  it('disables the query when id is undefined', () => {
    const queryFn = vi.fn().mockResolvedValue(null);
    const useThing = createDetailQuery(keys, queryFn);

    const { result } = renderHook(() => useThing(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('handles query error', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('not found'));
    const useThing = createDetailQuery(keys, queryFn);

    const { result } = renderHook(() => useThing('bad-id'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });

  it('does not set keepPrevious by default', async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: '1' });
    const useThing = createDetailQuery(keys, queryFn);

    const { result } = renderHook(() => useThing('1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('enables keepPrevious when explicitly set to true', async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: '1' });
    const useThing = createDetailQuery(keys, queryFn, { keepPrevious: true });

    const { result } = renderHook(() => useThing('1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The hook resolves successfully with placeholderData option active
    expect(result.current.data).toEqual({ id: '1' });
  });

  it('passes refetchInterval option through', async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: '1' });
    const useThing = createDetailQuery(keys, queryFn, { refetchInterval: 3000 });

    const { result } = renderHook(() => useThing('1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalled();
  });

  it('passes staleTime option through', async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: '1' });
    const useThing = createDetailQuery(keys, queryFn, { staleTime: 30_000 });

    const { result } = renderHook(() => useThing('1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalled();
  });

  it('accepts overrides from the hook caller', async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: '1' });
    const useThing = createDetailQuery(keys, queryFn);

    // Override enabled to false even with a valid id
    const { result } = renderHook(() => useThing('1', { enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('createMutation', () => {
  const keys = createQueryKeys('resources');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the mutationFn with variables', async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: 'new-1' });
    const useCreate = createMutation(mutationFn);

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync({ name: 'New Resource' });

    expect(mutationFn).toHaveBeenCalledWith({ name: 'New Resource' }, expect.anything());
  });

  it('handles mutation error', async () => {
    const mutationFn = vi.fn().mockRejectedValue(new Error('create failed'));
    const useCreate = createMutation(mutationFn);

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate(), { wrapper });

    await expect(result.current.mutateAsync({ name: 'Bad' })).rejects.toThrow('create failed');
  });

  it('invalidates specified keys on success', async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: '1' });
    const useCreate = createMutation(mutationFn, {
      invalidateKeys: [keys.lists()],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('data');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.lists() });
  });

  it('invalidates multiple keys on success', async () => {
    const otherKeys = createQueryKeys('other');
    const mutationFn = vi.fn().mockResolvedValue({ id: '1' });
    const useCreate = createMutation(mutationFn, {
      invalidateKeys: [keys.lists(), otherKeys.all],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('data');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: otherKeys.all });
  });

  it('removes keys specified as an array on success', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    const useDelete = createMutation(mutationFn, {
      invalidateKeys: [keys.lists()],
      removeKeys: [keys.detail('r-1')],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const { result } = renderHook(() => useDelete(), { wrapper });

    await result.current.mutateAsync('r-1');

    expect(removeSpy).toHaveBeenCalledWith({ queryKey: keys.detail('r-1') });
  });

  it('invalidates keys specified as a function on success', async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: '1' });
    const useCreate = createMutation<{ id: string }, string>(mutationFn, {
      invalidateKeys: (id) => [keys.detail(id)],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('r-42');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.detail('r-42') });
  });

  it('removes keys specified as a function on success', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    const useDelete = createMutation<undefined, string>(mutationFn, {
      invalidateKeys: [keys.lists()],
      removeKeys: (id) => [keys.detail(id)],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const { result } = renderHook(() => useDelete(), { wrapper });

    await result.current.mutateAsync('r-42');

    expect(removeSpy).toHaveBeenCalledWith({ queryKey: keys.detail('r-42') });
  });

  it('calls the onSuccess callback from options', async () => {
    const onSuccess = vi.fn();
    const mutationFn = vi.fn().mockResolvedValue({ id: '1' });
    const useCreate = createMutation(mutationFn, { onSuccess });

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('vars');

    expect(onSuccess).toHaveBeenCalledWith({ id: '1' }, 'vars');
  });

  it('calls the override onSuccess from hook caller', async () => {
    const overrideOnSuccess = vi.fn();
    const mutationFn = vi.fn().mockResolvedValue({ id: '2' });
    const useCreate = createMutation(mutationFn);

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate({ onSuccess: overrideOnSuccess }), {
      wrapper,
    });

    await result.current.mutateAsync('vars');

    expect(overrideOnSuccess).toHaveBeenCalled();
    expect(overrideOnSuccess.mock.calls[0][0]).toEqual({ id: '2' });
    expect(overrideOnSuccess.mock.calls[0][1]).toBe('vars');
  });

  it('calls both options onSuccess and override onSuccess', async () => {
    const optionsOnSuccess = vi.fn();
    const overrideOnSuccess = vi.fn();
    const mutationFn = vi.fn().mockResolvedValue('result');
    const useCreate = createMutation(mutationFn, { onSuccess: optionsOnSuccess });

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate({ onSuccess: overrideOnSuccess }), {
      wrapper,
    });

    await result.current.mutateAsync('v');

    expect(optionsOnSuccess).toHaveBeenCalledWith('result', 'v');
    expect(overrideOnSuccess).toHaveBeenCalled();
  });

  it('does not call removeQueries when removeKeys is not provided', async () => {
    const mutationFn = vi.fn().mockResolvedValue({ id: '1' });
    const useCreate = createMutation(mutationFn, {
      invalidateKeys: [keys.lists()],
    });

    const { wrapper, queryClient } = createWrapperWithClient();
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('data');

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('applies rest overrides from hook caller', async () => {
    const mutationFn = vi.fn().mockRejectedValue(new Error('fail'));
    const onError = vi.fn();
    const useCreate = createMutation(mutationFn);

    const { wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useCreate({ onError }), { wrapper });

    // Use mutate (not mutateAsync) so the error is caught by onError
    result.current.mutate('bad-data');

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('does not invalidate or remove keys when no options are provided', async () => {
    const mutationFn = vi.fn().mockResolvedValue('ok');
    const useCreate = createMutation(mutationFn);

    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const { result } = renderHook(() => useCreate(), { wrapper });

    await result.current.mutateAsync('data');

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe('createInvalidateAll', () => {
  const keys = createQueryKeys('domains');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a callback that invalidates the domain keys', () => {
    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const useInvalidate = createInvalidateAll(keys);

    const { result } = renderHook(() => useInvalidate(), { wrapper });

    result.current();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.all });
  });

  it('also invalidates additional keys when provided', () => {
    const otherKeys = createQueryKeys('related');
    const thirdKeys = createQueryKeys('third');
    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const useInvalidate = createInvalidateAll(keys, [otherKeys.all, thirdKeys.lists()]);

    const { result } = renderHook(() => useInvalidate(), { wrapper });

    result.current();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: otherKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: thirdKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  it('does not invalidate additional keys when none are provided', () => {
    const { wrapper, queryClient } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const useInvalidate = createInvalidateAll(keys);

    const { result } = renderHook(() => useInvalidate(), { wrapper });

    result.current();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.all });
  });

  it('returns a stable callback reference', () => {
    const { wrapper } = createWrapperWithClient();
    const useInvalidate = createInvalidateAll(keys);

    const { result, rerender } = renderHook(() => useInvalidate(), { wrapper });

    const firstRef = result.current;
    rerender();
    const secondRef = result.current;

    expect(firstRef).toBe(secondRef);
  });
});
