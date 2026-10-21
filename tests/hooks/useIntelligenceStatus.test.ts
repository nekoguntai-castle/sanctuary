/**
 * useIntelligenceStatus Hook Tests
 *
 * Tests for the Treasury Intelligence status hook:
 * - Initial loading state
 * - Successful API call returns available status
 * - Failed API call returns unavailable status
 * - Shared observable cache behavior
 * - Cache invalidation via invalidateIntelligenceStatus()
 * - Terminal client errors (feature gate 403) stop polling
 * - Transient failures back off exponentially up to a one-minute cap
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateIntelligenceStatus,
  useIntelligenceStatus,
} from '../../src/hooks/useIntelligenceStatus';
import * as intelligenceApi from '../../src/api/intelligence';
import { ApiError } from '../../src/api/client';

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

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
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

  describe('failure handling', () => {
    const statusMock = () => vi.mocked(intelligenceApi.getIntelligenceStatus);
    const calls = () => statusMock().mock.calls.length;
    const flush = async () => { await act(async () => { await Promise.resolve(); }); };
    const advance = async (ms: number) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    };
    const nextTimer = async () => {
      await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
    };
    const featureGateError = (status = 403) => new ApiError('Features not available', status, {
      error: 'Features not available',
      disabledFeatures: ['aiAssistant', 'treasuryIntelligence'],
    });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([401, 403, 404])('treats a feature-gate %i as terminal and stops polling', async (status) => {
      statusMock().mockRejectedValue(featureGateError(status));

      const { result } = renderHook(() => useIntelligenceStatus());
      await flush();
      await advance(120_000);

      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);
      expect(result.current).toEqual({ available: false, loading: false });
    });

    it('backs off transient failures exponentially up to a one-minute cap', async () => {
      statusMock().mockRejectedValue(new Error('outage'));

      renderHook(() => useIntelligenceStatus());
      await flush();
      expect(calls()).toBe(1);

      const steps: Array<[number, number]> = [
        [1_000, 2],
        [1_999, 2],
        [1, 3],
        [4_000, 4],
        [8_000, 5],
        [16_000, 6],
        [32_000, 7],
        [60_000, 8],
        [60_000, 9],
      ];
      for (const [ms, expected] of steps) {
        await advance(ms);
        expect(calls(), `after +${ms} ms`).toBe(expected);
      }
    });

    it('rechecks a terminal status after invalidation', async () => {
      statusMock().mockRejectedValue(featureGateError());

      const { result } = renderHook(() => useIntelligenceStatus());
      await flush();

      statusMock().mockResolvedValue({ available: true, ollamaConfigured: true });
      act(() => invalidateIntelligenceStatus());
      await flush();

      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
      expect(result.current.available).toBe(true);
    });

    it('rechecks a terminal status when a new session subscribes after every consumer unmounted', async () => {
      statusMock().mockRejectedValue(featureGateError());

      const first = renderHook(() => useIntelligenceStatus());
      await flush();
      act(() => first.unmount());

      renderHook(() => useIntelligenceStatus());
      await flush();

      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
    });

    it('does not refetch a terminal status for an additional consumer', async () => {
      statusMock().mockRejectedValue(featureGateError());

      renderHook(() => useIntelligenceStatus());
      await flush();

      const second = renderHook(() => useIntelligenceStatus());
      await flush();

      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);
      expect(second.result.current).toEqual({ available: false, loading: false });
    });

    it.each([0, 408, 429, 503])('treats a status %i ApiError as transient', async (status) => {
      statusMock()
        .mockRejectedValueOnce(new ApiError('transient', status))
        .mockResolvedValueOnce({ available: true, ollamaConfigured: true });

      const { result } = renderHook(() => useIntelligenceStatus());
      await flush();
      expect(calls()).toBe(1);

      await advance(1_000);
      expect(calls()).toBe(2);
      expect(result.current).toEqual({ available: true, loading: false });
    });

    it('backs off consecutive transient ApiErrors', async () => {
      statusMock()
        .mockRejectedValueOnce(new ApiError('rate limited', 429))
        .mockRejectedValueOnce(new ApiError('unavailable', 503))
        .mockResolvedValueOnce({ available: true, ollamaConfigured: true });

      const { result } = renderHook(() => useIntelligenceStatus());
      await flush();

      await advance(1_000);
      expect(calls()).toBe(2);
      await advance(2_000);
      expect(calls()).toBe(3);
      expect(result.current).toEqual({ available: true, loading: false });
    });

    it('restarts the backoff at one second after an invalidation', async () => {
      statusMock().mockRejectedValue(new Error('outage'));

      renderHook(() => useIntelligenceStatus());
      await flush();
      await nextTimer();
      await nextTimer();

      act(() => invalidateIntelligenceStatus());
      await flush();
      const before = calls();

      await advance(999);
      expect(calls()).toBe(before);
      await advance(1);
      expect(calls()).toBe(before + 1);
    });

    it('restarts the backoff when the last consumer leaves', async () => {
      statusMock().mockRejectedValue(new Error('outage'));

      const first = renderHook(() => useIntelligenceStatus());
      await flush();
      await nextTimer();
      await nextTimer();
      act(() => first.unmount());

      renderHook(() => useIntelligenceStatus());
      await flush();
      const before = calls();

      await advance(999);
      expect(calls()).toBe(before);
      await advance(1);
      expect(calls()).toBe(before + 1);
    });
  });
});
