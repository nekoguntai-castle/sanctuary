import { renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useWalletWebSocket } from '../../../../src/components/WalletDetail/hooks/useWalletWebSocket';
import { useWalletEvents } from '../../../../src/hooks/websocket';

const socketState = vi.hoisted(() => ({ connected: true }));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/hooks/websocket', () => ({
  useWalletEvents: vi.fn(),
  useWebSocket: () => ({ connected: socketState.connected }),
}));

const addNotification = vi.fn();
vi.mock('../../../../src/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    addNotification,
  }),
}));

describe('useWalletWebSocket', () => {
  let handlers: Record<string, (data: any) => void>;

  const setWallet = vi.fn();
  const setTransactions = vi.fn();
  const setSyncing = vi.fn();
  const setSyncRetryInfo = vi.fn();
  const fetchData = vi.fn();

  const renderWithWallet = (wallet: any = { id: 'wallet-1', name: 'Primary Wallet', balance: 10_000 }, walletId: string | undefined = 'wallet-1') =>
    renderHook(() =>
      useWalletWebSocket({
        walletId,
        wallet,
        setWallet,
        setTransactions,
        setSyncing,
        setSyncRetryInfo,
        fetchData,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    socketState.connected = true;
    handlers = {};
    vi.mocked(useWalletEvents).mockImplementation((_, cb) => {
      handlers = cb as Record<string, (data: any) => void>;
    });

    renderWithWallet();
  });

  it('handles transaction events with notification and silent refresh', () => {
    handlers.onTransaction({
      txid: 'tx-1',
      type: 'received',
      amount: 12_345,
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Received',
        duration: 10000,
      })
    );
    expect(fetchData).toHaveBeenCalledWith(true);
  });

  it('defaults missing transaction amount to zero in notifications', () => {
    handlers.onTransaction({
      txid: 'tx-no-amount',
      type: 'received',
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        message: expect.stringContaining('BTC'),
      })
    );
    expect(fetchData).toHaveBeenCalledWith(true);
  });

  it('uses sent and consolidation transaction titles', () => {
    handlers.onTransaction({
      txid: 'tx-sent',
      type: 'sent',
      amount: 1_000,
    });

    handlers.onTransaction({
      txid: 'tx-consolidation',
      type: 'consolidation',
      amount: 2_000,
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bitcoin Sent',
        message: expect.stringContaining('-'),
      })
    );
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Consolidation',
        message: expect.stringContaining('-'),
      })
    );
  });

  it('falls back to generic wallet name in transaction notifications', () => {
    renderWithWallet(null);

    handlers.onTransaction({
      txid: 'tx-1',
      type: 'received',
      amount: 5_000,
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('in wallet'),
      })
    );
  });

  it('updates wallet balance on balance events', () => {
    handlers.onBalance({ balance: 55_000, confirmed: 55_000 });
    const updater = setWallet.mock.calls[0][0] as (wallet: any) => any;
    expect(updater({
      id: 'wallet-1',
      balance: 10_000,
      syncStateVersion: 7,
      lastSyncStatus: 'success',
    })).toEqual({
      id: 'wallet-1',
      balance: 55_000,
      syncStateVersion: 7,
      lastSyncStatus: 'success',
    });
    expect(updater({ id: 'other-wallet', balance: 10_000 })).toEqual({
      id: 'other-wallet',
      balance: 10_000,
    });
  });

  it('does not update wallet balance when wallet is missing or data lacks balance', () => {
    renderWithWallet(null);
    handlers.onBalance({ balance: 55_000, confirmed: 55_000 });
    expect(setWallet).not.toHaveBeenCalled();

    renderWithWallet();
    handlers.onBalance({ confirmed: 55_000 });
    expect(setWallet).not.toHaveBeenCalled();
  });

  it('updates confirmations and emits milestone notifications', () => {
    handlers.onConfirmation({ txid: 'tx-1', confirmations: 3 });

    const updater = setTransactions.mock.calls[0][0] as (txs: any[]) => any[];
    const updated = updater([{ txid: 'tx-1', confirmations: 0 }, { txid: 'tx-2', confirmations: 0 }]);

    expect(updated[0].confirmations).toBe(3);
    expect(updated[1].confirmations).toBe(0);
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        title: 'Transaction Confirmed',
      })
    );
  });

  it('formats singular confirmation notification message and defaults confirmations to zero', () => {
    handlers.onConfirmation({ txid: 'tx-1', confirmations: 1 });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '1 confirmation reached',
      })
    );

    handlers.onConfirmation({ txid: 'tx-1' });
    const updater = setTransactions.mock.calls[1][0] as (txs: any[]) => any[];
    const updated = updater([{ txid: 'tx-1', confirmations: 5 }]);
    expect(updated[0].confirmations).toBe(0);
  });

  it('does not emit confirmation notification for non-milestone confirmations', () => {
    handlers.onConfirmation({ txid: 'tx-1', confirmations: 2 });
    expect(addNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'confirmation' })
    );
  });

  it('tracks retry info for retrying sync events', () => {
    handlers.onSync({
      inProgress: true,
      status: 'retrying',
      retryCount: 2,
      maxRetries: 5,
      error: 'temporary failure',
      lastSyncedAt: '2026-03-01T00:00:00.000Z',
    });

    const updater = setWallet.mock.calls[0][0] as (wallet: any) => any;
    const updatedWallet = updater({
      id: 'wallet-1',
      balance: 10_000,
      lastSyncStatus: 'idle',
      lastSyncedAt: null,
    });

    expect(updatedWallet.syncInProgress).toBe(true);
    expect(updatedWallet.lastSyncStatus).toBe('retrying');
    expect(setSyncRetryInfo).toHaveBeenCalledWith({
      retryCount: 2,
      maxRetries: 5,
      error: 'temporary failure',
    });
  });

  it('preserves previous sync metadata when sync event omits status timestamps', () => {
    handlers.onSync({
      inProgress: true,
      status: '',
      lastSyncedAt: undefined,
    });

    const updater = setWallet.mock.calls[0][0] as (wallet: any) => any;
    const updatedWallet = updater({
      id: 'wallet-1',
      balance: 10_000,
      lastSyncStatus: 'idle',
      lastSyncedAt: '2026-02-01T00:00:00.000Z',
    });

    expect(updatedWallet.syncInProgress).toBe(true);
    expect(updatedWallet.lastSyncStatus).toBe('idle');
    expect(updatedWallet.lastSyncedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(setSyncRetryInfo).not.toHaveBeenCalled();
    expect(setSyncing).not.toHaveBeenCalled();
  });

  it('returns null from sync wallet updater when previous wallet is null', () => {
    handlers.onSync({
      inProgress: true,
      status: 'retrying',
      retryCount: 1,
      maxRetries: 3,
    });

    const updater = setWallet.mock.calls[0][0] as (wallet: any) => any;
    expect(updater(null)).toBeNull();
  });

  it('clears syncing and refreshes on successful sync completion', () => {
    handlers.onSync({
      inProgress: false,
      status: 'success',
      retryCount: 0,
      maxRetries: 5,
    });

    expect(setSyncRetryInfo).toHaveBeenCalledWith(null);
    expect(setSyncing).toHaveBeenCalledWith(false);
    expect(fetchData).toHaveBeenCalledWith(true);
  });

  it('clears syncing without refreshing when sync fails', () => {
    handlers.onSync({
      inProgress: false,
      status: 'failed',
    });

    expect(setSyncRetryInfo).toHaveBeenCalledWith(null);
    expect(setSyncing).toHaveBeenCalledWith(false);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('applies a newer complete snapshot and clears nullable wallet fields', () => {
    renderWithWallet({
      id: 'wallet-1',
      name: 'Primary Wallet',
      balance: 10_000,
      syncStateVersion: 4,
    });

    handlers.onSync({
      inProgress: false,
      status: 'complete',
      syncStatus: 'success',
      error: null,
      failureClass: null,
      executionOwner: null,
      retryCount: 0,
      nextRetryAt: null,
      startedAt: null,
      stateVersion: 5,
      lastSyncedAt: '2026-08-20T12:00:00.000Z',
    });

    const updater = setWallet.mock.calls.at(-1)?.[0] as (wallet: any) => any;
    expect(updater({
      id: 'wallet-1',
      syncStateVersion: 4,
      lastSyncError: 'temporary failure',
      lastSyncFailureClass: 'electrum_unavailable',
      syncExecutionOwner: 'worker',
      syncRetryCount: 2,
      syncNextRetryAt: 'later',
      syncStartedAt: 'earlier',
    })).toMatchObject({
      syncStateVersion: 5,
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    });
  });

  it.each([3, 4])('rejects stale or equal version %s including local side effects', (stateVersion) => {
    renderWithWallet({
      id: 'wallet-1',
      name: 'Primary Wallet',
      balance: 10_000,
      syncStateVersion: 4,
    });
    vi.clearAllMocks();

    handlers.onSync({
      inProgress: false,
      status: 'success',
      stateVersion,
    });

    expect(setWallet).not.toHaveBeenCalled();
    expect(setSyncRetryInfo).not.toHaveBeenCalled();
    expect(setSyncing).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('rejects a duplicate version immediately after accepting it', () => {
    renderWithWallet({
      id: 'wallet-1',
      name: 'Primary Wallet',
      balance: 10_000,
      syncStateVersion: 4,
    });
    vi.clearAllMocks();

    handlers.onSync({ inProgress: true, status: 'retrying', stateVersion: 5 });
    handlers.onSync({ inProgress: false, status: 'success', stateVersion: 5 });

    expect(setWallet).toHaveBeenCalledTimes(1);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('silently refetches the component-local wallet after reconnect', () => {
    socketState.connected = false;
    const view = renderWithWallet();
    vi.clearAllMocks();

    socketState.connected = true;
    view.rerender();

    expect(fetchData).toHaveBeenCalledWith(true);
  });

  it('registers wallet events even when walletId is undefined', () => {
    renderHook(() =>
      useWalletWebSocket({
        walletId: undefined,
        wallet: { id: 'wallet-1', name: 'Primary Wallet', balance: 10_000 } as any,
        setWallet,
        setTransactions,
        setSyncing,
        setSyncRetryInfo,
        fetchData,
      })
    );

    expect(vi.mocked(useWalletEvents).mock.calls.at(-1)?.[0]).toBeUndefined();
    handlers.onBalance({ walletId: 'wallet-1', balance: 1 });
    expect(setWallet).not.toHaveBeenCalled();
  });

  it('rejects a stale wallet A event after wallet B becomes current', () => {
    const view = renderHook(
      ({ walletId }) => useWalletWebSocket({
        walletId,
        ownershipKey: `${walletId}:user:mainnet`,
        wallet: { id: walletId, name: walletId, balance: 10_000 } as any,
        setWallet,
        setTransactions,
        setSyncing,
        setSyncRetryInfo,
        fetchData,
      }),
      { initialProps: { walletId: 'wallet-A' } },
    );
    const staleHandlers = handlers;

    view.rerender({ walletId: 'wallet-B' });
    vi.clearAllMocks();
    handlers.onBalance({ walletId: 'wallet-A', balance: 88_000 });
    staleHandlers.onBalance({ walletId: 'wallet-A', balance: 99_000 });
    staleHandlers.onTransaction({ walletId: 'wallet-A', txid: 'stale-A', type: 'received' });
    staleHandlers.onConfirmation({ walletId: 'wallet-A', txid: 'stale-A', confirmations: 6 });
    staleHandlers.onSync({ walletId: 'wallet-A', inProgress: false, status: 'success' });

    expect(setWallet).not.toHaveBeenCalled();
    expect(addNotification).not.toHaveBeenCalled();
    expect(setSyncing).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
  });
});
