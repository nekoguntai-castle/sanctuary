/**
 * useAIStatus Hook Tests
 *
 * Tests for the AI status hook that checks if AI features are enabled.
 * Covers loading states, successful fetches, error handling, and cache behavior.
 */

import { renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock the AI API
const mockGetAIStatus = vi.fn();

vi.mock('../../src/api/ai', () => ({
  getAIStatus: () => mockGetAIStatus(),
}));

// Import hook after mocks
import { invalidateAIStatusCache,useAIStatus } from '../../hooks/useAIStatus';

describe('useAIStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the cache before each test
    invalidateAIStatusCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear the cache after each test to prevent interference
    invalidateAIStatusCache();
  });

  describe('Initial Loading State', () => {
    it('should return loading state initially', () => {
      mockGetAIStatus.mockImplementation(() => new Promise<never>(() => undefined));

      const { result } = renderHook(() => useAIStatus());

      // Initial state should be loading
      expect(result.current).toEqual({
        enabled: false,
        loading: true,
        available: false,
      });
    });

    it('should trigger API call on mount', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Successful Fetch', () => {
    it('should return correct status when AI is available and container is running', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
        model: 'llama3.2:1b',
        endpoint: 'http://localhost:11434',
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: true,
          loading: false,
          available: true,
        });
      });
    });

    it('should return disabled when AI is not available', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: false,
        containerAvailable: false,
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });

    it('should keep AI enabled when setup status is enabled but provider is not available', async () => {
      mockGetAIStatus.mockResolvedValue({
        enabled: true,
        configured: false,
        available: false,
        endpoint: 'http://10.114.123.214:1234',
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: true,
          loading: false,
          available: false,
        });
      });
    });

    it('should return unavailable when AI is available but container is not running', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: false,
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: true,
          loading: false,
          available: false,
        });
      });
    });

    it('should handle containerAvailable being undefined', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        // containerAvailable is undefined
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: true,
          loading: false,
          available: false, // Should be false when containerAvailable is falsy
        });
      });
    });
  });

  describe('API Error Handling', () => {
    it('should return disabled state on API error', async () => {
      mockGetAIStatus.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });

    it('should return disabled state on 503 error', async () => {
      mockGetAIStatus.mockRejectedValue(new Error('503: Service unavailable'));

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });

    it('should handle timeout errors gracefully', async () => {
      mockGetAIStatus.mockRejectedValue(new Error('Request timeout'));

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });
  });

  describe('Cache Behavior', () => {
    it('should cache result - multiple instances should share cached result', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      // First hook instance
      const { result: result1 } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      // API should have been called once
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);

      // Second hook instance should use cached result
      const { result: result2 } = renderHook(() => useAIStatus());

      // Second instance should immediately have the cached data
      expect(result2.current).toEqual({
        enabled: true,
        loading: false,
        available: true,
      });

      // API should still only have been called once (cache hit)
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);
    });

    it('should not make duplicate requests when multiple hooks mount simultaneously', async () => {
      let resolvePromise!: (value: any) => void;
      mockGetAIStatus.mockImplementation(
        () => new Promise(resolve => { resolvePromise = resolve; })
      );

      // Mount multiple hooks at the same time
      const { result: result1 } = renderHook(() => useAIStatus());
      const { result: result2 } = renderHook(() => useAIStatus());
      const { result: result3 } = renderHook(() => useAIStatus());

      // All should be in loading state
      expect(result1.current.loading).toBe(true);
      expect(result2.current.loading).toBe(true);
      expect(result3.current.loading).toBe(true);

      // Only one API call should have been made
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);

      // Resolve the promise
      resolvePromise({ available: true, containerAvailable: true });

      // All hooks should update with the same result
      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
        expect(result2.current.loading).toBe(false);
        expect(result3.current.loading).toBe(false);
      });

      expect(result1.current).toEqual({
        enabled: true,
        loading: false,
        available: true,
      });
      expect(result2.current).toEqual({
        enabled: true,
        loading: false,
        available: true,
      });
      expect(result3.current).toEqual({
        enabled: true,
        loading: false,
        available: true,
      });

      // Still only one API call
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear cache when invalidateAIStatusCache is called', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      // First hook instance
      const { result: result1 } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);

      // Invalidate the cache
      invalidateAIStatusCache();

      // Mock a different response for the second fetch
      mockGetAIStatus.mockResolvedValue({
        available: false,
        containerAvailable: false,
      });

      // Second hook instance after invalidation
      const { result: result2 } = renderHook(() => useAIStatus());

      // Should start with loading state (cache was cleared)
      expect(result2.current.loading).toBe(true);

      // Should trigger a fresh API call
      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalledTimes(2);
      });

      // Should reflect the new API response
      await waitFor(() => {
        expect(result2.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });

    it('should trigger fresh API call after cache invalidation', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      // First fetch
      const { result: result1, unmount } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);

      // Unmount first hook
      unmount();

      // Invalidate cache
      invalidateAIStatusCache();

      // Change mock response
      mockGetAIStatus.mockResolvedValue({
        available: false,
        containerAvailable: false,
        message: 'AI service is down',
      });

      // Second fetch with new hook
      const { result: result2 } = renderHook(() => useAIStatus());

      // Should make a new API call
      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalledTimes(2);
      });

      // Should get the new response
      await waitFor(() => {
        expect(result2.current).toEqual({
          enabled: false,
          loading: false,
          available: false,
        });
      });
    });
  });

  describe('Hook Rerender Behavior', () => {
    it('should maintain cached state across rerenders', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      const { result, rerender } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const firstResult = result.current;

      // Rerender the hook
      rerender();

      // Should maintain the same state
      expect(result.current).toEqual(firstResult);

      // Should not trigger another API call
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);
    });

    it('should not reset to loading state on rerender', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      const { result, rerender } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Multiple rerenders
      rerender();
      rerender();
      rerender();

      // Should never go back to loading state
      expect(result.current.loading).toBe(false);
      expect(result.current.enabled).toBe(true);
      expect(result.current.available).toBe(true);

      // Should still only have one API call
      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle API returning null values', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: null as any,
        containerAvailable: null as any,
      });

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current).toEqual({
        enabled: false,
        loading: false,
        available: false,
      });
    });

    it('should handle API returning empty object', async () => {
      mockGetAIStatus.mockResolvedValue({} as any);

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current).toEqual({
        enabled: false,
        loading: false,
        available: false,
      });
    });

    it('should handle API returning only available field', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
      } as any);

      const { result } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current).toEqual({
        enabled: true,
        loading: false,
        available: false, // containerAvailable is falsy
      });
    });
  });

  describe('Multiple Cache Invalidations', () => {
    it('should handle multiple invalidations correctly', async () => {
      mockGetAIStatus.mockResolvedValue({
        available: true,
        containerAvailable: true,
      });

      // First fetch
      const { result: result1, unmount: unmount1 } = renderHook(() => useAIStatus());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      expect(mockGetAIStatus).toHaveBeenCalledTimes(1);

      unmount1();

      // Multiple invalidations
      invalidateAIStatusCache();
      invalidateAIStatusCache();
      invalidateAIStatusCache();

      // Second fetch
      const { result: result2 } = renderHook(() => useAIStatus());

      // Should still make exactly one new API call
      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(result2.current.loading).toBe(false);
      });
    });
  });
});
