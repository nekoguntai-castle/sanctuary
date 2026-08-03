/**
 * useDelayedRender Hook Tests
 *
 * Tests for the delayed render hook used to prevent chart dimension warnings.
 * Covers initial state, delayed transition, cleanup, and dependency reset.
 */

import { act,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useDelayedRender } from '../../src/hooks/useDelayedRender';

describe('useDelayedRender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useDelayedRender());

      expect(result.current).toBe(false);
    });

    it('should return false before delay expires', () => {
      const { result } = renderHook(() => useDelayedRender(100));

      // Advance time but not enough for delay
      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current).toBe(false);
    });
  });

  describe('Delayed Transition', () => {
    it('should return true after default delay (100ms)', () => {
      const { result } = renderHook(() => useDelayedRender());

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(true);
    });

    it('should return true after custom delay', () => {
      const { result } = renderHook(() => useDelayedRender(200));

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe(true);
    });

    it('should handle zero delay', () => {
      const { result } = renderHook(() => useDelayedRender(0));

      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe(true);
    });

    it('should handle very long delay', () => {
      const { result } = renderHook(() => useDelayedRender(5000));

      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should clean up timer on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { unmount } = renderHook(() => useDelayedRender(100));

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should not cause memory leak on rapid mount/unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      for (let i = 0; i < 10; i++) {
        const { unmount } = renderHook(() => useDelayedRender(100));
        unmount();
      }

      // Each unmount should trigger cleanup
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(10);
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('Dependency Reset', () => {
    it('should reset to false when dependencies change', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useDelayedRender(100, deps),
        { initialProps: { deps: ['initial'] } }
      );

      // First, let the timer complete
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe(true);

      // Change dependencies - should reset to false
      rerender({ deps: ['changed'] });
      expect(result.current).toBe(false);

      // Should become true again after delay
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe(true);
    });

    it('should not reset when dependencies are the same', () => {
      const deps = ['stable'];
      const { result, rerender } = renderHook(
        () => useDelayedRender(100, deps),
      );

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe(true);

      // Rerender with same deps reference - should stay true
      rerender();
      expect(result.current).toBe(true);
    });

    it('should reset when delay changes', () => {
      const { result, rerender } = renderHook(
        ({ delay }) => useDelayedRender(delay),
        { initialProps: { delay: 100 } }
      );

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe(true);

      // Change delay - should reset
      rerender({ delay: 200 });
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current).toBe(true);
    });
  });

  describe('Multiple Instances', () => {
    it('should work independently with multiple instances', () => {
      const { result: result1 } = renderHook(() => useDelayedRender(100));
      const { result: result2 } = renderHook(() => useDelayedRender(200));

      expect(result1.current).toBe(false);
      expect(result2.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result1.current).toBe(true);
      expect(result2.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result1.current).toBe(true);
      expect(result2.current).toBe(true);
    });
  });
});
