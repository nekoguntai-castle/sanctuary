import { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetworkSyncActions } from '../../../src/components/NetworkSyncActions/useNetworkSyncActions';
import { NetworkSyncActions } from '../../../src/components/NetworkSyncActions';
import type { TabNetwork } from '../../../src/components/NetworkTabs';
import * as syncApi from '../../../src/api/sync';

vi.mock('../../../src/api/sync', () => ({ syncNetworkWallets: vi.fn(), resyncNetworkWallets: vi.fn() }));
const syncResponse = {
  success: true, requested: 1, merged: 0, rejected: 0, indeterminate: 0, walletIds: ['w'],
  outcomes: [{ walletId: 'w', status: 'requested', generation: 1, wakeup: 'enqueued' }],
} as syncApi.NetworkSyncResult;
const resyncResponse = {
  success: true, queued: 1, walletIds: ['w'], acceptedWalletIds: ['w'],
  deduplicatedWalletIds: [], rejectedWallets: [], indeterminateWallets: [], excludedWallets: [],
} as syncApi.NetworkResyncResult;
type Kind = 'sync' | 'resync';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pending(kind: Kind) {
  const request = deferred<typeof syncResponse & typeof resyncResponse>();
  if (kind === 'sync') vi.mocked(syncApi.syncNetworkWallets).mockReturnValueOnce(request.promise);
  else vi.mocked(syncApi.resyncNetworkWallets).mockReturnValueOnce(request.promise);
  return { ...request, succeed: () => request.resolve((kind === 'sync' ? syncResponse : resyncResponse) as typeof syncResponse & typeof resyncResponse) };
}
function setup(callback = vi.fn()) {
  const hook = renderHook(({ network }) => useNetworkSyncActions({ network, walletCount: 1, onSyncStarted: callback }),
    { initialProps: { network: 'mainnet' as TabNetwork } });
  return { ...hook, callback };
}
function start(state: ReturnType<typeof useNetworkSyncActions>, kind: Kind) {
  return kind === 'sync' ? state.handleSyncAll() : state.handleResyncAll();
}
function expectBusy(state: ReturnType<typeof useNetworkSyncActions>, kind: Kind) {
  expect(state.syncing).toBe(kind === 'sync');
  expect(state.resyncing).toBe(kind === 'resync');
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('network action ownership', () => {
  it.each([
    ['sync', 'success'], ['sync', 'error'], ['resync', 'success'], ['resync', 'error'],
  ] as const)('retires %s A success/error (%s) after A-B-A while new A is pending', async (kind, outcome) => {
    const old = pending(kind);
    const newest = pending(kind);
    const { result, rerender, callback } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = start(result.current, kind); });
    rerender({ network: 'testnet3' });
    rerender({ network: 'mainnet' });
    act(() => { second = start(result.current, kind); });
    await act(async () => {
      if (outcome === 'success') old.succeed(); else old.reject(new Error('retired error'));
      await first;
    });
    expectBusy(result.current, kind);
    expect(result.current.result).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { newest.succeed(); await second; });
    expect(result.current.syncing || result.current.resyncing).toBe(false);
    expect(result.current.result?.type).toBe('success');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([['sync', 'success'], ['sync', 'error'], ['resync', 'success'], ['resync', 'error']] as const)(
    'keeps the newer result when old %s completes last with %s', async (kind, outcome) => {
    const old = pending(kind);
    const newest = pending(kind);
    const { result, callback } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = start(result.current, kind); second = start(result.current, kind); });
    await act(async () => { newest.succeed(); await second; });
    const currentResult = result.current.result;
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => {
      if (outcome === 'success') old.succeed(); else old.reject(new Error('obsolete'));
      await first;
    });
    expect(result.current.result).toBe(currentResult);
    expect(callback).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(kind === 'sync' ? 4000 : 7000));
    expect(result.current.result).toBeNull();
  });

  it.each(['sync', 'resync'] as const)('retires both busy flags when %s is superseded by the other action', async kind => {
    const other = kind === 'sync' ? 'resync' : 'sync';
    const old = pending(kind);
    const newest = pending(other);
    const { result } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = start(result.current, kind); second = start(result.current, other); });
    expectBusy(result.current, other);
    await act(async () => { old.succeed(); await first; });
    expectBusy(result.current, other);
    await act(async () => { newest.succeed(); await second; });
    expect(result.current.syncing || result.current.resyncing).toBe(false);
  });

  it.each(['sync', 'resync'] as const)('ignores pending %s completion after unmount', async kind => {
    const request = pending(kind);
    const { result, unmount, callback } = setup();
    let work!: Promise<void>;
    act(() => { work = start(result.current, kind); });
    unmount();
    await act(async () => { request.succeed(); await work; });
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears result timers on admission and preserves a later resync error', async () => {
    const first = pending('sync');
    const second = pending('resync');
    const { result, unmount } = setup();
    let work!: Promise<void>;
    act(() => { work = result.current.handleSyncAll(); });
    await act(async () => { first.succeed(); await work; });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { work = result.current.handleResyncAll(); });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { second.reject(new Error('persistent failure')); await work; });
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.result?.message).toBe('persistent failure');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a retired timer callback clear the current result or timer', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const first = pending('sync');
    const second = pending('sync');
    const { result, unmount } = setup();
    let work!: Promise<void>;
    act(() => { work = result.current.handleSyncAll(); });
    await act(async () => { first.succeed(); await work; });
    const retiredCallback = timeout.mock.calls.find(([, delay]) => delay === 5000)![0] as () => void;
    act(() => { work = result.current.handleSyncAll(); });
    await act(async () => { second.succeed(); await work; });
    const currentResult = result.current.result;
    act(() => retiredCallback());
    expect(result.current.result).toBe(currentResult);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    timeout.mockRestore();
  });

  it.each(['network', 'unmount'] as const)('clears an armed result timer on %s', async retirement => {
    const request = pending('sync');
    const { result, rerender, unmount } = setup();
    let work!: Promise<void>;
    act(() => { work = result.current.handleSyncAll(); });
    await act(async () => { request.succeed(); await work; });
    expect(vi.getTimerCount()).toBe(1);
    if (retirement === 'network') rerender({ network: 'signet' }); else unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['sync', 'resync'] as const)('rechecks ownership after a %s success callback starts another action', async kind => {
    const first = pending(kind);
    const second = pending('resync');
    let reentered!: Promise<void>;
    const callback = vi.fn(() => { reentered = result.current.handleResyncAll(); });
    const { result } = setup(callback);
    let work!: Promise<void>;
    act(() => { work = start(result.current, kind); });
    await act(async () => { first.succeed(); await work; });
    expectBusy(result.current, 'resync');
    expect(result.current.result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    callback.mockImplementation(() => {});
    await act(async () => { second.succeed(); await reentered; });
  });

  it('permits StrictMode replay actions but retires the cleaned-up setup', async () => {
    const first = pending('sync');
    const second = pending('sync');
    const callback = vi.fn();
    const work: Promise<void>[] = [];
    const { result } = renderHook(() => {
      const state = useNetworkSyncActions({ network: 'mainnet', walletCount: 1, onSyncStarted: callback });
      useEffect(() => { work.push(state.handleSyncAll()); }, []);
      return state;
    }, { wrapper: StrictMode });
    expect(work).toHaveLength(2);
    await act(async () => { first.succeed(); await work[0]; });
    expectBusy(result.current, 'sync');
    expect(callback).not.toHaveBeenCalled();
    await act(async () => { second.succeed(); await work[1]; });
    expect(result.current.syncing).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps both compact controls disabled while the current roundtrip request runs', async () => {
    const first = pending('sync');
    const second = pending('sync');
    const view = render(<NetworkSyncActions network="mainnet" walletCount={1} compact />);
    fireEvent.click(screen.getByTitle('Sync all Mainnet wallets'));
    view.rerender(<NetworkSyncActions network="testnet3" walletCount={1} compact />);
    view.rerender(<NetworkSyncActions network="mainnet" walletCount={1} compact />);
    fireEvent.click(screen.getByTitle('Sync all Mainnet wallets'));
    await act(async () => { first.succeed(); });
    expect(screen.getByTitle('Syncing...')).toBeDisabled();
    expect(screen.getByTitle('Full resync all Mainnet wallets')).toBeDisabled();
    await act(async () => { second.succeed(); });
    expect(screen.getByTitle('Sync all Mainnet wallets')).toBeEnabled();
  });
});
