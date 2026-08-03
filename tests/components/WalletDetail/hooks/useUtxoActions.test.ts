import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useUtxoActions } from '../../../../src/components/WalletDetail/hooks/useUtxoActions';
import * as transactionsApi from '../../../../src/api/transactions';
import { logError } from '../../../../src/utils/errorHandler';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../../src/api/transactions', () => ({
  freezeUTXO: vi.fn(),
}));

vi.mock('../../../../src/utils/errorHandler', () => ({
  logError: vi.fn(),
}));

describe('useUtxoActions', () => {
  const setUTXOs = vi.fn();
  const setUtxoStats = vi.fn();
  const handleError = vi.fn();
  const navigate = vi.fn();

  const baseUtxos = [
    {
      id: 'utxo-1',
      txid: 'tx-1',
      vout: 0,
      frozen: false,
      amount: 1000,
    },
    {
      id: 'utxo-2',
      txid: 'tx-2',
      vout: 1,
      frozen: true,
      amount: 2000,
    },
  ] as any;

  const renderUtxoActions = (overrides: Partial<Parameters<typeof useUtxoActions>[0]> = {}) =>
    renderHook(() =>
      useUtxoActions({
        walletId: 'wallet-1',
        utxos: baseUtxos,
        setUTXOs,
        setUtxoStats,
        handleError,
        navigate,
        ...overrides,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transactionsApi.freezeUTXO).mockResolvedValue(undefined as never);
  });

  it('optimistically toggles freeze state and persists on success', async () => {
    const { result } = renderUtxoActions();

    await act(async () => {
      await result.current.handleToggleFreeze('tx-1', 0);
    });

    expect(transactionsApi.freezeUTXO).toHaveBeenCalledWith('utxo-1', true);
    expect(setUTXOs).toHaveBeenCalledTimes(1);
    expect(setUtxoStats).toHaveBeenCalledTimes(1);

    const setUtxosUpdater = setUTXOs.mock.calls[0][0];
    const setStatsUpdater = setUtxoStats.mock.calls[0][0];

    const updatedUtxos = setUtxosUpdater(baseUtxos);
    const updatedStats = setStatsUpdater(baseUtxos);

    expect(updatedUtxos[0].frozen).toBe(true);
    expect(updatedStats[0].frozen).toBe(true);
  });

  it('reverts optimistic updates and reports errors when freeze call fails', async () => {
    vi.mocked(transactionsApi.freezeUTXO).mockRejectedValueOnce(new Error('freeze failed'));
    const { result } = renderUtxoActions();

    await act(async () => {
      await result.current.handleToggleFreeze('tx-1', 0);
    });

    expect(setUTXOs).toHaveBeenCalledTimes(2);
    expect(setUtxoStats).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(loggerSpies, expect.any(Error), 'Failed to freeze UTXO');
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Freeze UTXO');

    const optimistic = setUTXOs.mock.calls[0][0];
    const rollback = setUTXOs.mock.calls[1][0];
    const statsOptimistic = setUtxoStats.mock.calls[0][0];
    const statsRollback = setUtxoStats.mock.calls[1][0];

    const afterOptimistic = optimistic(baseUtxos);
    const afterRollback = rollback(afterOptimistic);
    const statsAfterOptimistic = statsOptimistic(baseUtxos);
    const statsAfterRollback = statsRollback(statsAfterOptimistic);
    expect(afterRollback[0].frozen).toBe(false);
    expect(statsAfterRollback[0].frozen).toBe(false);
    expect(result.current.pendingFreezeIds.size).toBe(0);
  });

  it('rejects a same-ID second toggle synchronously before rerender', async () => {
    const pending = createDeferred<void>();
    vi.mocked(transactionsApi.freezeUTXO).mockReturnValueOnce(pending.promise as never);
    const { result } = renderUtxoActions();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleToggleFreeze('tx-1', 0);
      second = result.current.handleToggleFreeze('tx-1', 0);
    });

    expect(transactionsApi.freezeUTXO).toHaveBeenCalledTimes(1);
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-1']));

    await act(async () => {
      pending.resolve();
      await Promise.all([first, second]);
    });
    expect(result.current.pendingFreezeIds.size).toBe(0);
  });

  it('allows independent UTXO IDs to mutate concurrently', async () => {
    const firstPending = createDeferred<void>();
    const secondPending = createDeferred<void>();
    vi.mocked(transactionsApi.freezeUTXO)
      .mockReturnValueOnce(firstPending.promise as never)
      .mockReturnValueOnce(secondPending.promise as never);
    const { result } = renderUtxoActions();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleToggleFreeze('tx-1', 0);
      second = result.current.handleToggleFreeze('tx-2', 1);
    });

    expect(transactionsApi.freezeUTXO).toHaveBeenCalledTimes(2);
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-1', 'utxo-2']));

    await act(async () => {
      firstPending.resolve();
      await first;
    });
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-2']));

    await act(async () => {
      secondPending.resolve();
      await second;
    });
    expect(result.current.pendingFreezeIds.size).toBe(0);
  });

  it('ignores an old-wallet rejection without rolling back or releasing a new same-ID request', async () => {
    const oldWalletPending = createDeferred<void>();
    const newWalletPending = createDeferred<void>();
    vi.mocked(transactionsApi.freezeUTXO)
      .mockReturnValueOnce(oldWalletPending.promise as never)
      .mockReturnValueOnce(newWalletPending.promise as never);
    const walletBUtxos = [{ ...baseUtxos[0], txid: 'tx-wallet-b', frozen: false }];
    const { result, rerender } = renderHook(
      ({ walletId, utxos }) => useUtxoActions({
        walletId,
        utxos,
        setUTXOs,
        setUtxoStats,
        handleError,
        navigate,
      }),
      { initialProps: { walletId: 'wallet-a', utxos: baseUtxos } },
    );

    let request!: Promise<void>;
    act(() => { request = result.current.handleToggleFreeze('tx-1', 0); });
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-1']));

    rerender({ walletId: 'wallet-b', utxos: walletBUtxos });
    expect(result.current.pendingFreezeIds.size).toBe(0);
    let newWalletRequest!: Promise<void>;
    act(() => { newWalletRequest = result.current.handleToggleFreeze('tx-wallet-b', 0); });
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-1']));
    const callsBeforeOldSettlement = setUTXOs.mock.calls.length;

    await act(async () => {
      oldWalletPending.reject(new Error('old wallet failed'));
      await request;
    });

    expect(setUTXOs).toHaveBeenCalledTimes(callsBeforeOldSettlement);
    expect(setUtxoStats).toHaveBeenCalledTimes(callsBeforeOldSettlement);
    expect(result.current.pendingFreezeIds).toEqual(new Set(['utxo-1']));
    expect(handleError).not.toHaveBeenCalled();

    await act(async () => {
      newWalletPending.resolve();
      await newWalletRequest;
    });
    expect(result.current.pendingFreezeIds.size).toBe(0);
  });

  it('suppresses settlement work after unmount', async () => {
    const pending = createDeferred<void>();
    vi.mocked(transactionsApi.freezeUTXO).mockReturnValueOnce(pending.promise as never);
    const { result, unmount } = renderUtxoActions();
    let request!: Promise<void>;
    act(() => { request = result.current.handleToggleFreeze('tx-1', 0); });
    const utxoUpdateCalls = setUTXOs.mock.calls.length;
    const statsUpdateCalls = setUtxoStats.mock.calls.length;
    unmount();

    await act(async () => {
      pending.reject(new Error('late failure'));
      await request;
    });

    expect(setUTXOs).toHaveBeenCalledTimes(utxoUpdateCalls);
    expect(setUtxoStats).toHaveBeenCalledTimes(statsUpdateCalls);
    expect(handleError).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('guards when utxo is missing or missing id', async () => {
    const { result: missingResult } = renderUtxoActions({
      utxos: [],
    });

    await act(async () => {
      await missingResult.current.handleToggleFreeze('tx-1', 0);
    });

    expect(loggerSpies.error).toHaveBeenCalledWith('UTXO not found or missing ID');
    expect(transactionsApi.freezeUTXO).not.toHaveBeenCalled();
    expect(setUTXOs).not.toHaveBeenCalled();
    expect(setUtxoStats).not.toHaveBeenCalled();

    const { result: noIdResult } = renderUtxoActions({
      utxos: [{ txid: 'tx-1', vout: 0, amount: 1000, address: 'bc1qtest', confirmations: 1, frozen: false }],
    });

    await act(async () => {
      await noIdResult.current.handleToggleFreeze('tx-1', 0);
    });

    expect(loggerSpies.error).toHaveBeenCalledWith('UTXO not found or missing ID');
    expect(transactionsApi.freezeUTXO).not.toHaveBeenCalled();
  });

  it('toggles selected ids, resets selection on wallet change, and navigates with selected set', async () => {
    const { result, rerender } = renderUtxoActions({ walletId: 'wallet-1' });

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
      result.current.handleToggleSelect('tx-2:1');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-1:0', 'tx-2:1']);

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-2:1']);

    act(() => {
      result.current.handleSendSelected();
    });
    expect(navigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
      state: { preSelected: ['tx-2:1'] },
    });

    rerender();
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-2:1']);

    const { result: changedWalletResult, rerender: rerenderChanged } = renderUtxoActions({ walletId: 'wallet-9' });
    act(() => {
      changedWalletResult.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(changedWalletResult.current.selectedUtxos)).toEqual(['tx-1:0']);

    rerenderChanged();
    expect(Array.from(changedWalletResult.current.selectedUtxos)).toEqual(['tx-1:0']);
  });

  it('clears selected utxos when walletId actually changes', () => {
    const { result, rerender } = renderHook(
      ({ walletId }) =>
        useUtxoActions({
          walletId,
          utxos: baseUtxos,
          setUTXOs,
          setUtxoStats,
          handleError,
          navigate,
        }),
      {
        initialProps: { walletId: 'wallet-1' as string | undefined },
      }
    );

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-1:0']);

    rerender({ walletId: 'wallet-2' });
    expect(Array.from(result.current.selectedUtxos)).toEqual([]);
  });
});
