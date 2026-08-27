/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletSyncLifecycleClock } from '../../src/hooks/useWalletSyncLifecycleClock';
import type { WalletSyncSubject } from '../../src/utils/walletSyncPresentationTypes';

const START = Date.parse('2026-08-26T12:00:00.000Z');

const active = (expiry: string): WalletSyncSubject => ({
  syncInProgress: true,
  syncExecutionOwner: 'worker',
  requestedIncrementalSyncGeneration: 2,
  claimedIncrementalSyncGeneration: 2,
  processedIncrementalSyncGeneration: 1,
  incrementalSyncClaimedAt: '2026-08-26T11:59:00.000Z',
  incrementalSyncLeaseExpiresAt: expiry,
});

describe('useWalletSyncLifecycleClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances exactly at the nearest lease boundary with one timer', () => {
    const wallets = [
      active('2026-08-26T12:01:00.000Z'),
      active('2026-08-26T12:02:00.000Z'),
    ];
    const view = renderHook(() => useWalletSyncLifecycleClock(wallets, 'mainnet', {
      maxTickMs: 300_000,
    }));

    expect(vi.getTimerCount()).toBe(1);
    expect(view.result.current).toBe(START);
    act(() => vi.advanceTimersByTime(59_999));
    expect(view.result.current).toBe(START);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toBe(START + 60_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reschedules when a lease renews before expiry', () => {
    const view = renderHook(
      ({ expiry }) => useWalletSyncLifecycleClock([active(expiry)], 'wallet-1', {
        maxTickMs: 300_000,
      }),
      { initialProps: { expiry: '2026-08-26T12:01:00.000Z' } },
    );

    act(() => vi.advanceTimersByTime(30_000));
    view.rerender({ expiry: '2026-08-26T12:02:00.000Z' });
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.result.current).toBe(START);
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.result.current).toBe(START + 90_000);
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.result.current).toBe(START + 120_000);
  });

  it('uses a coarse bounded fallback tick when the boundary is far away', () => {
    const view = renderHook(() => useWalletSyncLifecycleClock([
      active('2026-08-26T13:00:00.000Z'),
    ], 'wallet-1', { maxTickMs: 10_000 }));

    act(() => vi.advanceTimersByTime(10_000));
    expect(view.result.current).toBe(START + 10_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('resets the reading and timer on scope change', () => {
    const view = renderHook(
      ({ scope }) => useWalletSyncLifecycleClock([], scope, { maxTickMs: 10_000 }),
      { initialProps: { scope: 'wallet-1' } },
    );
    act(() => vi.advanceTimersByTime(5_000));
    view.rerender({ scope: 'wallet-2' });
    expect(view.result.current).toBe(START + 5_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears its only timer on unmount', () => {
    const view = renderHook(() => useWalletSyncLifecycleClock([], 'wallet-1'));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
