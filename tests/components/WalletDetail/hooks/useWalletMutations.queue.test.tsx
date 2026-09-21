import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletMutations } from '../../../../src/components/WalletDetail/hooks/useWalletMutations';
import { subscribeWalletRenameDrain } from '../../../../src/components/WalletDetail/hooks/walletRenameEpoch';
import * as walletsApi from '../../../../src/api/wallets';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../../src/api/wallets', () => ({ getWallet: vi.fn(), updateWallet: vi.fn() }));

const handleError = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const wallet = (id: string, name = id) => ({ id, name }) as never;

describe('Wallet rename ordering and rollback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    { first: 'reject', second: 'resolve', expected: 'Second', errors: 0 },
    { first: 'resolve', second: 'reject', expected: 'First', errors: 1 },
    { first: 'reject', second: 'reject', expected: 'Original', errors: 1 },
    { first: 'resolve', second: 'resolve', expected: 'Second', errors: 0 },
  ] as const)('serializes renames when the first $first and second $second', async ({ first, second, expected, errors }) => {
    const firstUpdate = deferred<never>();
    const secondUpdate = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const view = renderHook(
      ({ currentWallet }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey: 'A:user:mainnet',
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original') } },
    );

    let firstPending!: Promise<void>;
    let secondPending!: Promise<void>;
    act(() => {
      firstPending = view.result.current.handleUpdateWallet({ name: 'First' });
      secondPending = view.result.current.handleUpdateWallet({ name: 'Second' });
    });
    expect(displayed.name).toBe('Second');
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(1, 'A', { name: 'First' });

    await act(async () => {
      if (first === 'resolve') firstUpdate.resolve(undefined as never);
      else firstUpdate.reject(new Error('first failed'));
      await firstPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    expect(displayed.name).toBe('Second');

    // A sync may refresh non-name fields while the second request is pending.
    displayed = { ...displayed, syncStateVersion: 7 };
    await act(async () => {
      if (second === 'resolve') secondUpdate.resolve(undefined as never);
      else secondUpdate.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed).toEqual({ id: 'A', name: expected, syncStateVersion: 7 });
    expect(handleError).toHaveBeenCalledTimes(errors);
  });

  it('continues the next accepted rename when reporting an earlier failure throws', async () => {
    const firstUpdate = deferred<never>();
    const secondUpdate = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);
    let secondPending!: Promise<void>;
    let view!: ReturnType<typeof renderHook<ReturnType<typeof useWalletMutations>, undefined>>;
    const reportFailure = vi.fn(() => {
      // A retry accepted while the first failure is being reported must run next.
      secondPending = view.result.current.handleUpdateWallet({ name: 'Second' });
      throw new Error('error handler failed');
    });
    const onDrain = vi.fn();
    const unsubscribe = subscribeWalletRenameDrain('A:user', onDrain);
    let displayed = { id: 'A', name: 'Original' };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    view = renderHook(() => useWalletMutations({
      walletId: 'A',
      wallet: wallet('A', 'Original'),
      ownershipKey: 'A:user:mainnet',
      setWallet: setWallet as never,
      handleError: reportFailure,
    }));

    let firstPending!: Promise<void>;
    act(() => {
      firstPending = view.result.current.handleUpdateWallet({ name: 'First' });
    });
    expect(displayed.name).toBe('First');
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstUpdate.reject(new Error('first write failed'));
      await expect(firstPending).rejects.toThrow('error handler failed');
    });
    expect(displayed.name).toBe('Second');
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    expect(onDrain).not.toHaveBeenCalled();

    await act(async () => {
      secondUpdate.resolve(undefined as never);
      await secondPending;
    });
    expect(displayed.name).toBe('Second');
    expect(onDrain).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('restores the confirmed server name after a later rename fails', async () => {
    const secondUpdate = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockResolvedValueOnce({ name: 'Server Canonical' } as never)
      .mockReturnValueOnce(secondUpdate.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const view = renderHook(
      ({ currentWallet }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey: 'A:user:mainnet',
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original') } },
    );

    await act(() => view.result.current.handleUpdateWallet({ name: 'First' }));
    expect(displayed.name).toBe('Server Canonical');
    view.rerender({ currentWallet: displayed as never });
    let secondPending!: Promise<void>;
    act(() => { secondPending = view.result.current.handleUpdateWallet({ name: 'Second' }); });
    expect(displayed.name).toBe('Second');

    displayed = { ...displayed, syncStateVersion: 5 };
    await act(async () => {
      secondUpdate.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'Server Canonical', syncStateVersion: 5 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('preserves an external name when a delayed PATCH returns a normalized name', async () => {
    const update = deferred<never>();
    vi.mocked(walletsApi.updateWallet).mockReturnValueOnce(update.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((change: (current: typeof displayed) => typeof displayed) => {
      displayed = change(displayed);
    });
    const view = renderHook(() => useWalletMutations({
      walletId: 'A',
      wallet: wallet('A', 'Original'),
      ownershipKey: 'A:user:mainnet',
      setWallet: setWallet as never,
      handleError,
    }));

    let pending!: Promise<void>;
    act(() => { pending = view.result.current.handleUpdateWallet({ name: 'First' }); });
    displayed = { ...displayed, name: 'External', syncStateVersion: 9 };
    await act(async () => {
      update.resolve({ name: 'Server Canonical' } as never);
      await pending;
    });

    expect(displayed).toEqual({ id: 'A', name: 'External', syncStateVersion: 9 });
    expect(handleError).not.toHaveBeenCalled();
  });

  it('drops queued A writes after a route switch without blocking B', async () => {
    const firstA = deferred<never>();
    const updateB = deferred<never>();
    vi.mocked(walletsApi.updateWallet).mockImplementation((id, data) => {
      if (id === 'B') return updateB.promise;
      return data.name === 'First A' ? firstA.promise : Promise.reject(new Error('stale A write'));
    });
    const setWallet = vi.fn();
    const view = renderHook(
      ({ walletId, currentWallet, ownershipKey }) => useWalletMutations({
        walletId,
        wallet: currentWallet as never,
        ownershipKey,
        setWallet,
        handleError,
      }),
      { initialProps: { walletId: 'A', currentWallet: wallet('A'), ownershipKey: 'A:user:mainnet' } },
    );

    let firstPending!: Promise<void>;
    let secondPending!: Promise<void>;
    act(() => {
      firstPending = view.result.current.handleUpdateWallet({ name: 'First A' });
      secondPending = view.result.current.handleUpdateWallet({ name: 'Second A' });
    });
    view.rerender({ walletId: 'B', currentWallet: wallet('B'), ownershipKey: 'B:user:mainnet' });
    let bPending!: Promise<void>;
    act(() => { bPending = view.result.current.handleUpdateWallet({ name: 'Renamed B' }); });
    expect(walletsApi.updateWallet).toHaveBeenCalledWith('B', { name: 'Renamed B' });
    expect(walletsApi.updateWallet).not.toHaveBeenCalledWith('A', { name: 'Second A' });

    setWallet.mockClear();
    await act(async () => {
      firstA.reject(new Error('stale A failure'));
      await Promise.all([firstPending, secondPending]);
    });
    expect(walletsApi.updateWallet).not.toHaveBeenCalledWith('A', { name: 'Second A' });
    expect(setWallet).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
    await act(async () => {
      updateB.resolve(undefined as never);
      await bPending;
    });
    expect(setWallet).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('waits for an in-flight A write when returning to A before another rename', async () => {
    const oldA = deferred<never>();
    const newA = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(oldA.promise)
      .mockReturnValueOnce(newA.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const view = renderHook(
      ({ walletId, currentWallet, ownershipKey }) => useWalletMutations({
        walletId,
        wallet: currentWallet as never,
        ownershipKey,
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { walletId: 'A', currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' } },
    );

    let oldPending!: Promise<void>;
    act(() => { oldPending = view.result.current.handleUpdateWallet({ name: 'First A' }); });
    view.rerender({ walletId: 'B', currentWallet: wallet('B'), ownershipKey: 'B:user:mainnet' });
    view.rerender({ walletId: 'A', currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' });
    let newPending!: Promise<void>;
    act(() => { newPending = view.result.current.handleUpdateWallet({ name: 'New A' }); });
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldA.resolve(undefined as never);
      await oldPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'New A' });
    displayed = { ...displayed, syncStateVersion: 8 };
    await act(async () => {
      newA.reject(new Error('new A failed'));
      await newPending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'First A', syncStateVersion: 8 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('does not treat an optimistic name as confirmed across a same-wallet route change', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const view = renderHook(
      ({ currentWallet, ownershipKey }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey,
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' } },
    );

    let firstPending!: Promise<void>;
    act(() => { firstPending = view.result.current.handleUpdateWallet({ name: 'First' }); });
    expect(displayed.name).toBe('First');
    view.rerender({ currentWallet: wallet('A', 'First'), ownershipKey: 'A:user:testnet' });
    let secondPending!: Promise<void>;
    act(() => { secondPending = view.result.current.handleUpdateWallet({ name: 'Second' }); });
    expect(displayed.name).toBe('Second');
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error('first failed'));
      await firstPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    expect(displayed.name).toBe('Second');
    expect(handleError).not.toHaveBeenCalled();
    displayed = { ...displayed, syncStateVersion: 9 };
    await act(async () => {
      second.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'Original', syncStateVersion: 9 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('rolls back a failed rename after a network route change keeps the same wallet visible', async () => {
    const update = deferred<never>();
    vi.mocked(walletsApi.updateWallet).mockReturnValue(update.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((change: (current: typeof displayed) => typeof displayed) => {
      displayed = change(displayed);
    });
    const view = renderHook(
      ({ currentWallet, ownershipKey }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey,
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' } },
    );

    let pending!: Promise<void>;
    act(() => { pending = view.result.current.handleUpdateWallet({ name: 'First' }); });
    view.rerender({ currentWallet: wallet('A', 'First'), ownershipKey: 'A:user:testnet' });
    displayed = { ...displayed, syncStateVersion: 12 };
    await act(async () => {
      update.reject(new Error('rename failed'));
      await pending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'Original', syncStateVersion: 12 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('keeps a fresh A snapshot after A to B to A when an old A rename fails', async () => {
    const update = deferred<never>();
    vi.mocked(walletsApi.updateWallet).mockReturnValue(update.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((change: (current: typeof displayed) => typeof displayed) => {
      displayed = change(displayed);
    });
    const view = renderHook(
      ({ walletId, currentWallet, ownershipKey }) => useWalletMutations({
        walletId,
        wallet: currentWallet as never,
        ownershipKey,
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { walletId: 'A', currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' } },
    );

    let pending!: Promise<void>;
    act(() => { pending = view.result.current.handleUpdateWallet({ name: 'First' }); });
    view.rerender({ walletId: 'B', currentWallet: wallet('B'), ownershipKey: 'B:user:mainnet' });
    displayed = { id: 'A', name: 'External', syncStateVersion: 15 };
    view.rerender({ walletId: 'A', currentWallet: wallet('A', 'External'), ownershipKey: 'A:user:mainnet' });
    await act(async () => {
      update.reject(new Error('old A failed'));
      await pending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'External', syncStateVersion: 15 });
    expect(handleError).not.toHaveBeenCalled();
  });

  it('persists a queued rename across a same-wallet network change', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((change: (current: typeof displayed) => typeof displayed) => {
      displayed = change(displayed);
    });
    const view = renderHook(
      ({ currentWallet, ownershipKey }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey,
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original'), ownershipKey: 'A:user:mainnet' } },
    );

    let firstPending!: Promise<void>;
    let secondPending!: Promise<void>;
    act(() => {
      firstPending = view.result.current.handleUpdateWallet({ name: 'First' });
      secondPending = view.result.current.handleUpdateWallet({ name: 'Second' });
    });
    view.rerender({ currentWallet: wallet('A', 'Second'), ownershipKey: 'A:user:testnet' });
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(undefined as never);
      await firstPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    expect(displayed.name).toBe('Second');
    await act(async () => {
      second.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed.name).toBe('First');
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('keeps rename ordering and confirmed rollback across an unmount and remount', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const makeHook = (name: string) => renderHook(() => useWalletMutations({
      walletId: 'A',
      wallet: wallet('A', name),
      ownershipKey: 'A:user:mainnet',
      setWallet: setWallet as never,
      handleError,
    }));

    const firstView = makeHook('Original');
    let firstPending!: Promise<void>;
    act(() => { firstPending = firstView.result.current.handleUpdateWallet({ name: 'First' }); });
    firstView.unmount();
    const secondView = makeHook('First');
    let secondPending!: Promise<void>;
    act(() => { secondPending = secondView.result.current.handleUpdateWallet({ name: 'Second' }); });
    expect(walletsApi.updateWallet).toHaveBeenCalledTimes(1);
    expect(displayed.name).toBe('Second');

    await act(async () => {
      first.resolve(undefined as never);
      await firstPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    displayed = { ...displayed, syncStateVersion: 10 };
    await act(async () => {
      second.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'First', syncStateVersion: 10 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('uses an external name snapshot as rollback after its earlier write is idle', async () => {
    vi.mocked(walletsApi.updateWallet)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('second failed'));
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((update: (current: typeof displayed) => typeof displayed) => {
      displayed = update(displayed);
    });
    const view = renderHook(
      ({ currentWallet }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey: 'A:user:mainnet',
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original') } },
    );

    await act(() => view.result.current.handleUpdateWallet({ name: 'First' }));
    displayed = { ...displayed, name: 'External', syncStateVersion: 11 };
    view.rerender({ currentWallet: wallet('A', 'External') });
    await act(() => view.result.current.handleUpdateWallet({ name: 'Second' }));
    expect(displayed).toEqual({ id: 'A', name: 'External', syncStateVersion: 11 });
    expect(handleError).toHaveBeenCalledOnce();
  });

  it('does not overwrite an external name refresh when the latest rename fails', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    vi.mocked(walletsApi.updateWallet)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let displayed = { id: 'A', name: 'Original', syncStateVersion: 1 };
    const setWallet = vi.fn((change: (current: typeof displayed) => typeof displayed) => {
      displayed = change(displayed);
    });
    const view = renderHook(
      ({ currentWallet }) => useWalletMutations({
        walletId: 'A',
        wallet: currentWallet as never,
        ownershipKey: 'A:user:mainnet',
        setWallet: setWallet as never,
        handleError,
      }),
      { initialProps: { currentWallet: wallet('A', 'Original') } },
    );

    let firstPending!: Promise<void>;
    let secondPending!: Promise<void>;
    act(() => {
      firstPending = view.result.current.handleUpdateWallet({ name: 'First' });
      secondPending = view.result.current.handleUpdateWallet({ name: 'Second' });
    });
    await act(async () => {
      first.resolve(undefined as never);
      await firstPending;
    });
    expect(walletsApi.updateWallet).toHaveBeenNthCalledWith(2, 'A', { name: 'Second' });
    displayed = { ...displayed, name: 'External', syncStateVersion: 16 };
    view.rerender({ currentWallet: wallet('A', 'External') });
    await act(async () => {
      second.reject(new Error('second failed'));
      await secondPending;
    });
    expect(displayed).toEqual({ id: 'A', name: 'External', syncStateVersion: 16 });
    expect(handleError).toHaveBeenCalledOnce();
  });

});
