/**
 * useLoadingState Hook Tests
 *
 * Tests for the loading state management hook that handles async operations
 * with loading state, error handling, and optional success/error callbacks.
 */

import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useAsyncAction,useLoadingState } from '../../src/hooks/useLoadingState';

describe('useLoadingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should have loading false by default', () => {
      const { result } = renderHook(() => useLoadingState());

      expect(result.current.loading).toBe(false);
    });

    it('should have error as null initially', () => {
      const { result } = renderHook(() => useLoadingState());

      expect(result.current.error).toBeNull();
    });

    it('should have data as null initially', () => {
      const { result } = renderHook(() => useLoadingState<string>());

      expect(result.current.data).toBeNull();
    });

    it('should accept initial loading state', () => {
      const { result } = renderHook(() =>
        useLoadingState({ initialLoading: true })
      );

      expect(result.current.loading).toBe(true);
    });
  });

  describe('execute - Success', () => {
    it('should set loading true during operation', async () => {
      const { result } = renderHook(() => useLoadingState());

      let resolvePromise: () => void;
      const operation = () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve;
        });

      act(() => {
        result.current.execute(operation);
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise!();
      });

      expect(result.current.loading).toBe(false);
    });

    it('should return result from successful operation', async () => {
      const { result } = renderHook(() => useLoadingState<string>());

      const returnValue = await act(async () => {
        return result.current.execute(async () => 'success');
      });

      expect(returnValue).toBe('success');
    });

    it('should set data on successful operation', async () => {
      const { result } = renderHook(() => useLoadingState<string>());

      await act(async () => {
        await result.current.execute(async () => 'test data');
      });

      expect(result.current.data).toBe('test data');
    });

    it('should clear previous error on new execution', async () => {
      const { result } = renderHook(() => useLoadingState());

      // First, cause an error
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('first error');
        });
      });

      expect(result.current.error).toBe('first error');

      // Then succeed
      await act(async () => {
        await result.current.execute(async () => {});
      });

      expect(result.current.error).toBeNull();
    });

    it('should call onSuccess callback on success', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useLoadingState({ onSuccess }));

      await act(async () => {
        await result.current.execute(async () => {});
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute - Error', () => {
    it('should set error message on failure', async () => {
      const { result } = renderHook(() => useLoadingState());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Something went wrong');
        });
      });

      expect(result.current.error).toBe('Something went wrong');
    });

    it('should return null on failure', async () => {
      const { result } = renderHook(() => useLoadingState<string>());

      const returnValue = await act(async () => {
        return result.current.execute(async () => {
          throw new Error('error');
        });
      });

      expect(returnValue).toBeNull();
    });

    it('should set loading false after error', async () => {
      const { result } = renderHook(() => useLoadingState());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('error');
        });
      });

      expect(result.current.loading).toBe(false);
    });

    it('should call onError callback with error message', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useLoadingState({ onError }));

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('test error');
        });
      });

      expect(onError).toHaveBeenCalledWith('test error');
    });

    it('should handle non-Error thrown values', async () => {
      const { result } = renderHook(() => useLoadingState());

      await act(async () => {
        await result.current.execute(async () => {
          throw 'string error';
        });
      });

      expect(result.current.error).toBe('string error');
    });

    it('should handle errors with no message', async () => {
      const { result } = renderHook(() => useLoadingState());

      await act(async () => {
        await result.current.execute(async () => {
          throw {};
        });
      });

      // Should have some error message (from extractErrorMessage utility)
      expect((result.current.error ?? '').length).toBeGreaterThan(0);
    });
  });

  describe('clearError', () => {
    it('should clear the error state', async () => {
      const { result } = renderHook(() => useLoadingState());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('error');
        });
      });

      expect(result.current.error).toBe('error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should be stable across renders', () => {
      const { result, rerender } = renderHook(() => useLoadingState());
      const clearError1 = result.current.clearError;

      rerender();

      expect(result.current.clearError).toBe(clearError1);
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      const { result } = renderHook(() =>
        useLoadingState<string>({ initialLoading: true })
      );

      // Set some data
      await act(async () => {
        await result.current.execute(async () => 'data');
      });

      expect(result.current.data).toBe('data');

      act(() => {
        result.current.reset();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.data).toBeNull();
    });

    it('should be stable across renders', () => {
      const { result, rerender } = renderHook(() => useLoadingState());
      const reset1 = result.current.reset;

      rerender();

      expect(result.current.reset).toBe(reset1);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple sequential operations', async () => {
      const { result } = renderHook(() => useLoadingState<number>());

      await act(async () => {
        await result.current.execute(async () => 1);
      });
      expect(result.current.data).toBe(1);

      await act(async () => {
        await result.current.execute(async () => 2);
      });
      expect(result.current.data).toBe(2);

      await act(async () => {
        await result.current.execute(async () => 3);
      });
      expect(result.current.data).toBe(3);
    });

    it('should handle success after failure', async () => {
      const { result } = renderHook(() => useLoadingState<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('failed');
        });
      });

      expect(result.current.error).toBe('failed');
      expect(result.current.data).toBeNull();

      await act(async () => {
        await result.current.execute(async () => 'recovered');
      });

      expect(result.current.error).toBeNull();
      expect(result.current.data).toBe('recovered');
    });
  });

  describe('Typed Data', () => {
    interface User {
      id: number;
      name: string;
    }

    it('should preserve type of returned data', async () => {
      const { result } = renderHook(() => useLoadingState<User>());

      const user: User = { id: 1, name: 'Test' };

      await act(async () => {
        await result.current.execute(async () => user);
      });

      expect(result.current.data).toEqual(user);
      // TypeScript should allow this without errors
      expect(result.current.data?.name).toBe('Test');
    });

    it('should handle array data', async () => {
      const { result } = renderHook(() => useLoadingState<User[]>());

      const users: User[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      await act(async () => {
        await result.current.execute(async () => users);
      });

      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].name).toBe('Alice');
    });
  });
});

describe('useAsyncAction', () => {
  it('should provide run instead of execute', async () => {
    const { result } = renderHook(() => useAsyncAction());

    expect(result.current.run).toBeDefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle async operations', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let operationCalled = false;

    await act(async () => {
      await result.current.run(async () => {
        operationCalled = true;
      });
    });

    expect(operationCalled).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle errors', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('action failed');
      });
    });

    expect(result.current.error).toBe('action failed');
  });

  it('should call onSuccess callback', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAsyncAction({ onSuccess }));

    await act(async () => {
      await result.current.run(async () => {});
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('should call onError callback', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAsyncAction({ onError }));

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('action error');
      });
    });

    expect(onError).toHaveBeenCalledWith('action error');
  });

  it('should provide clearError and reset', () => {
    const { result } = renderHook(() => useAsyncAction());

    expect(result.current.clearError).toBeDefined();
    expect(result.current.reset).toBeDefined();
  });
});
