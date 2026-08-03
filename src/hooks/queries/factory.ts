/**
 * React Query Hook Factories
 *
 * Generic factories that generate query keys, useQuery hooks, and useMutation hooks
 * with automatic cache invalidation. Reduces boilerplate when adding new API domains.
 *
 * @example
 * // Define keys and hooks for a new API domain
 * const deviceKeys = createQueryKeys('devices');
 * // deviceKeys.all        => ['devices']
 * // deviceKeys.lists()    => ['devices', 'list']
 * // deviceKeys.detail(id) => ['devices', 'detail', id]
 *
 * const useDevices = createListQuery(deviceKeys, devicesApi.getDevices);
 * const useDevice = createDetailQuery(deviceKeys, devicesApi.getDevice);
 * const useCreateDevice = createMutation(devicesApi.createDevice, [deviceKeys.lists()]);
 */

import { useCallback } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type QueryKey,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Query Key Factory
// ---------------------------------------------------------------------------

export interface QueryKeys {
  all: readonly string[];
  lists: () => readonly string[];
  detail: (id: string) => readonly string[];
}

/**
 * Create a standard query key factory for an API domain.
 *
 * Returns an object with `all`, `lists()`, and `detail(id)` key builders
 * that follow the recommended TanStack Query key structure.
 */
export function createQueryKeys(domain: string): QueryKeys {
  const all = [domain] as const;
  return {
    all,
    lists: () => [...all, 'list'] as const,
    detail: (id: string) => [...all, 'detail', id] as const,
  };
}

// ---------------------------------------------------------------------------
// Query Hook Factories
// ---------------------------------------------------------------------------

interface ListQueryOptions {
  /** Refetch on an interval (ms) */
  refetchInterval?: number;
  /** How long data is considered fresh (ms) */
  staleTime?: number;
  /** Keep previous data while refetching */
  keepPrevious?: boolean;
}

/**
 * Create a useQuery hook that fetches a list from the given API function.
 *
 * @param keys - Query key factory produced by `createQueryKeys`
 * @param queryFn - API function that returns the list (no parameters)
 * @param options - Optional query configuration
 */
export function createListQuery<TData>(
  keys: QueryKeys,
  queryFn: () => Promise<TData>,
  options: ListQueryOptions = {}
) {
  const { refetchInterval, staleTime, keepPrevious = true } = options;

  return function useListQuery(overrides?: Partial<UseQueryOptions<TData>>) {
    return useQuery<TData>({
      queryKey: keys.lists(),
      queryFn,
      ...(keepPrevious && { placeholderData: keepPreviousData }),
      ...(refetchInterval !== undefined && { refetchInterval }),
      ...(staleTime !== undefined && { staleTime }),
      ...overrides,
    });
  };
}

interface DetailQueryOptions {
  /** Refetch on an interval (ms) */
  refetchInterval?: number;
  /** How long data is considered fresh (ms) */
  staleTime?: number;
  /** Keep previous data while refetching */
  keepPrevious?: boolean;
}

/**
 * Create a useQuery hook that fetches a single item by ID.
 *
 * The query is automatically disabled when `id` is undefined.
 *
 * @param keys - Query key factory produced by `createQueryKeys`
 * @param queryFn - API function that accepts an id string and returns the item
 * @param options - Optional query configuration
 */
export function createDetailQuery<TData>(
  keys: QueryKeys,
  queryFn: (id: string) => Promise<TData>,
  options: DetailQueryOptions = {}
) {
  const { refetchInterval, staleTime, keepPrevious = false } = options;

  return function useDetailQuery(id: string | undefined, overrides?: Partial<UseQueryOptions<TData>>) {
    return useQuery<TData>({
      queryKey: keys.detail(id!),
      queryFn: () => queryFn(id!),
      enabled: !!id,
      ...(keepPrevious && { placeholderData: keepPreviousData }),
      ...(refetchInterval !== undefined && { refetchInterval }),
      ...(staleTime !== undefined && { staleTime }),
      ...overrides,
    });
  };
}

// ---------------------------------------------------------------------------
// Mutation Hook Factory
// ---------------------------------------------------------------------------

interface MutationOptions<TData, TVariables> {
  /** Query keys to invalidate on success (static array or callback from variables) */
  invalidateKeys?: ((variables: TVariables) => QueryKey[]) | QueryKey[];
  /** Query keys to remove from cache on success */
  removeKeys?: ((variables: TVariables) => QueryKey[]) | QueryKey[];
  /** Additional onSuccess callback */
  onSuccess?: (data: TData, variables: TVariables) => void;
}

/**
 * Create a useMutation hook with automatic cache invalidation.
 *
 * @param mutationFn - API function to call
 * @param invalidateKeys - Query keys to invalidate after successful mutation
 * @param options - Optional mutation configuration
 *
 * @example
 * const useCreateDevice = createMutation(
 *   devicesApi.createDevice,
 *   { invalidateKeys: [deviceKeys.lists()] }
 * );
 *
 * // With dynamic key removal (e.g., after delete)
 * const useDeleteDevice = createMutation(
 *   (id: string) => devicesApi.deleteDevice(id),
 *   {
 *     invalidateKeys: [deviceKeys.lists()],
 *     removeKeys: (id) => [deviceKeys.detail(id)],
 *   }
 * );
 */
export function createMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: MutationOptions<TData, TVariables> = {}
) {
  const { invalidateKeys: invalidateKeysOpt, removeKeys, onSuccess: onSuccessCallback } = options;
  const invalidateKeys = invalidateKeysOpt ?? [];

  return function useMutationHook(
    overrides?: Partial<UseMutationOptions<TData, Error, TVariables, unknown>>
  ) {
    const queryClient = useQueryClient();
    const { onSuccess: overrideOnSuccess, ...restOverrides } = overrides ?? {};

    return useMutation<TData, Error, TVariables, unknown>({
      mutationFn,
      onSuccess: (data, variables, onMutateResult, context) => {
        // Invalidate specified query keys
        const keysToInvalidate = typeof invalidateKeys === 'function'
          ? invalidateKeys(variables)
          : invalidateKeys;
        for (const key of keysToInvalidate) {
          queryClient.invalidateQueries({ queryKey: key });
        }

        // Remove specified query keys
        if (removeKeys) {
          const keysToRemove = typeof removeKeys === 'function'
            ? removeKeys(variables)
            : removeKeys;
          for (const key of keysToRemove) {
            queryClient.removeQueries({ queryKey: key });
          }
        }

        onSuccessCallback?.(data, variables);
        overrideOnSuccess?.(data, variables, onMutateResult, context);
      },
      ...restOverrides,
    });
  };
}

// ---------------------------------------------------------------------------
// Invalidation Helper Factory
// ---------------------------------------------------------------------------

/**
 * Create a hook that returns a stable callback to invalidate all queries for a domain.
 *
 * @param keys - Query key factory produced by `createQueryKeys`
 * @param additionalKeys - Extra query keys to invalidate alongside the domain keys
 */
export function createInvalidateAll(keys: QueryKeys, additionalKeys: QueryKey[] = []) {
  return function useInvalidateAll() {
    const queryClient = useQueryClient();

    return useCallback(() => {
      queryClient.invalidateQueries({ queryKey: keys.all });
      for (const key of additionalKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }, [queryClient]);
  };
}
