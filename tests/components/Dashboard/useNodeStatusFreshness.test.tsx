import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FRESHNESS_WINDOW_MS,
  useNodeStatusFreshness,
} from '../../../src/components/Dashboard/hooks/useNodeStatusFreshness';

const BASE_NOW = 1_700_000_000_000;

describe('useNodeStatusFreshness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports not last-known immediately after fresh data with no error', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    expect(result.current.isLastKnown).toBe(false);
  });

  it('reports last-known immediately when no data has ever been retained', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: 0, error: null, network: 'mainnet' })
    );

    // Nothing retained to call "last known" — the presenter's initial/loading
    // path (isPlaceholderData/isLoading) handles this case instead.
    expect(result.current.isLastKnown).toBe(false);
  });

  it('flips to last-known via its own scheduled timer without any query event, at exactly the 120s boundary', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    expect(result.current.isLastKnown).toBe(false);

    act(() => {
      vi.advanceTimersByTime(FRESHNESS_WINDOW_MS);
    });

    expect(result.current.isLastKnown).toBe(true);
  });

  it('does not flip before the 120s boundary', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    act(() => {
      vi.advanceTimersByTime(FRESHNESS_WINDOW_MS - 1);
    });

    expect(result.current.isLastKnown).toBe(false);
  });

  it('is last-known immediately when a refetch error is present, even before 120s elapses', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({
        dataUpdatedAt: BASE_NOW,
        error: new Error('refetch failed'),
        network: 'mainnet',
      })
    );

    expect(result.current.isLastKnown).toBe(true);
  });

  it('a successful refresh (new dataUpdatedAt, error cleared) returns immediately to current', () => {
    const { result, rerender } = renderHook(
      (props: { dataUpdatedAt: number; error: Error | null }) =>
        useNodeStatusFreshness({ ...props, network: 'mainnet' }),
      { initialProps: { dataUpdatedAt: BASE_NOW, error: new Error('down') as Error | null } }
    );

    expect(result.current.isLastKnown).toBe(true);

    act(() => {
      vi.setSystemTime(BASE_NOW + 5_000);
      rerender({ dataUpdatedAt: BASE_NOW + 5_000, error: null });
    });

    expect(result.current.isLastKnown).toBe(false);
  });

  it('re-evaluates immediately on window focus (foreground return after background-tab throttling)', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    // Simulate the background tab missing its own scheduled timer tick (as if
    // the timer never fired) and only catching up on foreground return.
    act(() => {
      vi.setSystemTime(BASE_NOW + FRESHNESS_WINDOW_MS + 30_000);
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current.isLastKnown).toBe(true);
  });

  it('re-evaluates immediately on visibilitychange', () => {
    const { result } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    act(() => {
      vi.setSystemTime(BASE_NOW + FRESHNESS_WINDOW_MS + 1);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.isLastKnown).toBe(true);
  });

  it('a rapid network switch cancels the prior network timer instead of letting it fire', () => {
    const { result, rerender } = renderHook(
      (props: { dataUpdatedAt: number; network: string }) =>
        useNodeStatusFreshness({ dataUpdatedAt: props.dataUpdatedAt, error: null, network: props.network }),
      { initialProps: { dataUpdatedAt: BASE_NOW, network: 'mainnet' } }
    );

    // Switch to a fresh network before the mainnet timer would have fired.
    act(() => {
      vi.advanceTimersByTime(10_000);
      rerender({ dataUpdatedAt: BASE_NOW + 10_000, network: 'testnet3' });
    });

    expect(result.current.isLastKnown).toBe(false);

    // Advance to when the *original* mainnet timer (dataUpdatedAt + 120s)
    // would have fired. If it had survived the switch, this would flip.
    act(() => {
      vi.advanceTimersByTime(FRESHNESS_WINDOW_MS - 10_000);
    });

    // Only 110s have elapsed since the testnet3 data arrived — not yet stale.
    expect(result.current.isLastKnown).toBe(false);

    // 10s more completes 120s for the new network's own timer.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.isLastKnown).toBe(true);
  });

  it('clears its pending timer on unmount and never updates state afterward', () => {
    const setStateSpy = vi.spyOn(console, 'error');
    const { unmount } = renderHook(() =>
      useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' })
    );

    unmount();

    // Assert before advancing: an uncleared one-shot would still be pending here.
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(FRESHNESS_WINDOW_MS + 1_000);
    });

    // React 18 no longer warns on setState-after-unmount, so prove the
    // cleanup directly: the pending timeout was cleared and no evaluation
    // reached React afterwards.
    expect(setStateSpy).not.toHaveBeenCalled();
    setStateSpy.mockRestore();
  });

  it('does not re-render when focus fires with an unchanged verdict', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useNodeStatusFreshness({ dataUpdatedAt: BASE_NOW, error: null, network: 'mainnet' });
    });

    // Lazy initializer already computed `isLastKnown: false`; the mount
    // effect's own evaluate() recomputes the same value and must bail out
    // via the functional setState update rather than forcing a second render.
    expect(result.current.isLastKnown).toBe(false);
    const renderCountAfterMount = renderCount;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current.isLastKnown).toBe(false);
    expect(renderCount).toBe(renderCountAfterMount);
  });
});
