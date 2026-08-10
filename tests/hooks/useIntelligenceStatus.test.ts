/**
 * useIntelligenceStatus Hook Tests
 *
 * Tests for the Treasury Intelligence status hook:
 * - Initial loading state
 * - Successful API call returns available status
 * - Failed API call returns unavailable status
 * - Shared observable cache behavior
 * - Cache invalidation via invalidateIntelligenceStatus()
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateIntelligenceStatus,
  useIntelligenceStatus,
} from '../../src/hooks/useIntelligenceStatus';
import * as intelligenceApi from '../../src/api/intelligence';

vi.mock('../../src/api/intelligence', () => ({
  getIntelligenceStatus: vi.fn(),
}));

describe('useIntelligenceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateIntelligenceStatus();
  });

  it('should return loading state initially', () => {
    // Never resolve so the hook stays in loading state
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useIntelligenceStatus());

    expect(result.current.available).toBe(false);
    expect(result.current.loading).toBe(true);
  });

  it('should return available status after successful API call', async () => {
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: true,
      ollamaConfigured: true,
      endpointType: 'host',
    });

    const { result } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.endpointType).toBe('host');
  });

  it('should return unavailable status when API throws', async () => {
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockRejectedValue(
      new Error('Feature not enabled')
    );

    const { result } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(false);
    expect(result.current.endpointType).toBeUndefined();
  });

  it('keeps retrying failed capability requests until the shared snapshot recovers', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(intelligenceApi.getIntelligenceStatus)
        .mockRejectedValueOnce(new Error('temporary outage'))
        .mockRejectedValueOnce(new Error('continued outage'))
        .mockResolvedValueOnce({
          available: true,
          ollamaConfigured: true,
          endpointType: 'remote',
        });

      const { result } = renderHook(() => useIntelligenceStatus());
      await act(async () => { await Promise.resolve(); });
      expect(result.current).toEqual({ available: false, loading: false });

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual({ available: false, loading: false });

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(3);
      expect(result.current).toEqual({ available: true, loading: false, endpointType: 'remote' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should share a result and reuse it on subsequent renders', async () => {
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: true,
      ollamaConfigured: true,
      endpointType: 'remote',
    });

    const { result: result1 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);

    // Second render should use cache
    const { result: result2 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });

    expect(result2.current.available).toBe(true);
    expect(result2.current.endpointType).toBe('remote');
    // Should not have made a second API call
    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);
  });

  it('deduplicates simultaneous mounted requests', async () => {
    let resolveStatus!: (value: intelligenceApi.IntelligenceStatus) => void;
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockReturnValue(new Promise(resolve => {
      resolveStatus = resolve;
    }));

    const first = renderHook(() => useIntelligenceStatus());
    const second = renderHook(() => useIntelligenceStatus());
    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);

    await act(async () => resolveStatus({ available: true, ollamaConfigured: true }));
    expect(first.result.current.available).toBe(true);
    expect(second.result.current.available).toBe(true);
  });

  it('should clear cache when invalidateIntelligenceStatus is called', async () => {
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: true,
      ollamaConfigured: true,
    });

    const { result: result1 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);

    // Invalidate cache
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: false,
      ollamaConfigured: false,
    });

    await act(async () => invalidateIntelligenceStatus());

    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result1.current.available).toBe(false));
  });

  it('ignores an older completion after invalidation', async () => {
    let resolveOld!: (value: intelligenceApi.IntelligenceStatus) => void;
    let resolveNew!: (value: intelligenceApi.IntelligenceStatus) => void;
    vi.mocked(intelligenceApi.getIntelligenceStatus)
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve; }));

    const { result } = renderHook(() => useIntelligenceStatus());
    act(() => invalidateIntelligenceStatus());
    await act(async () => resolveNew({ available: false, ollamaConfigured: false }));
    await act(async () => resolveOld({ available: true, ollamaConfigured: true, endpointType: 'host' }));

    expect(result.current).toEqual({ available: false, loading: false });
  });

  it('ignores an older rejection after invalidation', async () => {
    let rejectOld!: (reason: Error) => void;
    vi.mocked(intelligenceApi.getIntelligenceStatus)
      .mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce({ available: true, ollamaConfigured: true, endpointType: 'host' });

    const { result } = renderHook(() => useIntelligenceStatus());
    act(() => invalidateIntelligenceStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => rejectOld(new Error('stale failure')));

    expect(result.current).toEqual({ available: true, loading: false, endpointType: 'host' });
  });

  it('should not update state after unmount (mountedRef guard)', async () => {
    let resolvePromise: (value: intelligenceApi.IntelligenceStatus) => void;
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { result, unmount } = renderHook(() => useIntelligenceStatus());

    expect(result.current.loading).toBe(true);

    // Unmount before the promise resolves
    act(() => unmount());

    // Resolve after unmount - should not throw
    await act(async () => {
      resolvePromise!({
        available: true,
        ollamaConfigured: true,
      });
    });

    // The hook's internal state would not be updated, but no error should be thrown
    expect(result.current.loading).toBe(true);
  });

  it('should not update state after unmount when API throws', async () => {
    let rejectPromise: (error: Error) => void;
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockReturnValue(
      new Promise((_, reject) => {
        rejectPromise = reject;
      })
    );

    const { result, unmount } = renderHook(() => useIntelligenceStatus());

    expect(result.current.loading).toBe(true);

    act(() => unmount());

    await act(async () => {
      rejectPromise!(new Error('Network error'));
    });

    // Should not throw despite component being unmounted
    expect(result.current.loading).toBe(true);
  });

  it('should return cached result immediately if available on mount', async () => {
    // First: populate the cache
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: true,
      ollamaConfigured: true,
      endpointType: 'host',
    });

    const { result: first } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(first.current.loading).toBe(false);
    });

    // Second mount: should start with cached result (no loading state)
    const { result: second } = renderHook(() => useIntelligenceStatus());

    // The initial state should already have the cached value
    expect(second.current.available).toBe(true);
    expect(second.current.loading).toBe(false);
    expect(second.current.endpointType).toBe('host');
  });
});
