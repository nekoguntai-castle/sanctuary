/**
 * Loading State Hook
 *
 * Encapsulates the common async loading pattern with loading state,
 * error handling, and optional success callback.
 */

import { useState, useCallback } from 'react';
import { extractErrorMessage } from '@sanctuary/shared/utils/errors';

interface LoadingState<T = void> {
  /** Whether an async operation is in progress */
  loading: boolean;
  /** Error message from the last failed operation, or null */
  error: string | null;
  /** Result from the last successful operation, or null */
  data: T | null;
  /** Execute an async operation with automatic loading/error handling */
  execute: (operation: () => Promise<T>) => Promise<T | null>;
  /** Clear the error state */
  clearError: () => void;
  /** Reset all state (loading, error, data) */
  reset: () => void;
}

interface UseLoadingStateOptions {
  /** Initial loading state (default: false) */
  initialLoading?: boolean;
  /** Callback when operation succeeds */
  onSuccess?: () => void;
  /** Callback when operation fails */
  onError?: (error: string) => void;
}

/**
 * Hook for managing async operation state
 *
 * @example
 * // Basic usage
 * const { loading, error, execute } = useLoadingState();
 *
 * const handleSubmit = async () => {
 *   await execute(async () => {
 *     await api.submitForm(data);
 *   });
 * };
 *
 * @example
 * // With data return
 * const { loading, error, data, execute } = useLoadingState<User[]>();
 *
 * useEffect(() => {
 *   execute(async () => {
 *     return await api.getUsers();
 *   });
 * }, []);
 *
 * @example
 * // With callbacks
 * const { loading, error, execute } = useLoadingState({
 *   onSuccess: () => showToast('Saved!'),
 *   onError: (err) => showToast(err, 'error'),
 * });
 */
export function useLoadingState<T = void>(
  options: UseLoadingStateOptions = {}
): LoadingState<T> {
  const { initialLoading = false, onSuccess, onError } = options;

  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  const execute = useCallback(
    async (operation: () => Promise<T>): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await operation();
        setData(result);
        onSuccess?.();
        return result;
      } catch (err) {
        const errorMessage = extractErrorMessage(err);
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError]
  );

  return {
    loading,
    error,
    data,
    execute,
    clearError,
    reset,
  };
}

/**
 * Simpler hook for operations that don't return data
 *
 * @example
 * const { loading, error, run } = useAsyncAction();
 *
 * const handleDelete = () => run(async () => {
 *   await api.deleteItem(id);
 * });
 */
export function useAsyncAction(options: UseLoadingStateOptions = {}) {
  const state = useLoadingState<void>(options);

  return {
    loading: state.loading,
    error: state.error,
    run: state.execute,
    clearError: state.clearError,
    reset: state.reset,
  };
}
