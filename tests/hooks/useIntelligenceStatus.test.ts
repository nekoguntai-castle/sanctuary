/**
 * useIntelligenceStatus Hook Tests
 *
 * Tests for the Treasury Intelligence status hook:
 * - Initial loading state
 * - Successful API call returns available status
 * - Failed API call returns unavailable status
 * - 5-minute cache behavior
 * - Cache invalidation via invalidateIntelligenceStatus()
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateIntelligenceStatus,
  useIntelligenceStatus,
} from '../../hooks/useIntelligenceStatus';
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
      endpointType: 'container',
    });

    const { result } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.available).toBe(true);
    expect(result.current.endpointType).toBe('container');
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

  it('should cache result for 5 minutes and reuse on subsequent renders', async () => {
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

  it('should refetch after cache expires', async () => {
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: true,
      ollamaConfigured: true,
      endpointType: 'host',
    });

    const { result: result1 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(1);

    // Advance time beyond 5-minute TTL
    const originalDateNow = Date.now;
    const baseTime = Date.now();
    Date.now = vi.fn(() => baseTime + 5 * 60 * 1000 + 1);

    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: false,
      ollamaConfigured: false,
    });

    const { result: result2 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result2.current.available).toBe(false);
    });

    Date.now = originalDateNow;
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
    invalidateIntelligenceStatus();

    // Next render should refetch
    vi.mocked(intelligenceApi.getIntelligenceStatus).mockResolvedValue({
      available: false,
      ollamaConfigured: false,
    });

    const { result: result2 } = renderHook(() => useIntelligenceStatus());

    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });

    expect(intelligenceApi.getIntelligenceStatus).toHaveBeenCalledTimes(2);
    expect(result2.current.available).toBe(false);
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
    unmount();

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

    unmount();

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
      endpointType: 'container',
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
    expect(second.current.endpointType).toBe('container');
  });
});
