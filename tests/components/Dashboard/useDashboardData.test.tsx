import { act,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useDashboardData } from '../../../components/Dashboard/hooks/useDashboardData';

const mockNavigate = vi.fn();
const mockSetSearchParams = vi.fn();
let mockSearchParams = new URLSearchParams();

const mockCheckVersion = vi.fn();
const mockLoggerWarn = vi.fn();
const mockSubscribeWallets = vi.fn();
const mockUnsubscribeWallets = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockAddNotification = vi.fn();
const mockPlayEventSound = vi.fn();
const mockInvalidateAllWallets = vi.fn();
const mockUpdateWalletSyncStatus = vi.fn();
const mockRefetchMempool = vi.fn();

const wsEventHandlers: Record<string, ((event: any) => void) | undefined> = {};

let walletsData: any[] | undefined;
let walletsLoading = false;
let recentTxData: any[] | undefined;
let txLoading = false;
let pendingTxData: any[] | undefined;
let balanceHistoryData: Array<{ name: string; value: number }>;

let feeEstimatesData: any;
let feesLoading = false;
let bitcoinStatusData: any;
let statusLoading = false;
let mempoolDataData: any;
let mempoolLoading = false;
let mempoolRefreshing = false;

let wsConnected = false;
let wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
let delayedRenderReady = true;

let currencyState: any;
let userState: any;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams, mockSetSearchParams] as const,
  };
});

vi.mock('../../../src/api/admin', () => ({
  checkVersion: (...args: any[]) => mockCheckVersion(...args),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: (...args: any[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../hooks/websocket', () => ({
  useWebSocket: () => ({
    connected: wsConnected,
    state: wsState,
    subscribeWallets: mockSubscribeWallets,
    unsubscribeWallets: mockUnsubscribeWallets,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  }),
  useWebSocketEvent: (eventType: string, callback: (event: any) => void) => {
    wsEventHandlers[eventType] = callback;
  },
}));

vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({
    addNotification: mockAddNotification,
  }),
}));

vi.mock('../../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: mockPlayEventSound,
  }),
}));

vi.mock('../../../hooks/queries/useWallets', () => ({
  useWallets: () => ({ data: walletsData, isLoading: walletsLoading }),
  useRecentTransactions: () => ({ data: recentTxData, isLoading: txLoading }),
  usePendingTransactions: () => ({ data: pendingTxData }),
  useInvalidateAllWallets: () => mockInvalidateAllWallets,
  useUpdateWalletSyncStatus: () => mockUpdateWalletSyncStatus,
  useBalanceHistory: () => ({ data: balanceHistoryData }),
}));

vi.mock('../../../hooks/queries/useBitcoin', () => ({
  useFeeEstimates: () => ({ data: feeEstimatesData, isLoading: feesLoading }),
  useBitcoinStatus: () => ({ data: bitcoinStatusData, isLoading: statusLoading }),
  useMempoolData: () => ({
    data: mempoolDataData,
    isLoading: mempoolLoading,
    refetch: mockRefetchMempool,
    isFetching: mempoolRefreshing,
  }),
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: () => currencyState,
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => userState,
}));

vi.mock('../../../hooks/useDelayedRender', () => ({
  useDelayedRender: () => delayedRenderReady,
}));

const resetState = () => {
  mockSearchParams = new URLSearchParams();
  walletsData = [
    {
      id: 'w-main-low',
      name: 'Main Low',
      type: 'single_sig',
      balance: 1000,
      scriptType: 'wpkh',
      network: 'mainnet',
      descriptor: 'desc-1',
      fingerprint: 'fp1',
      lastSyncStatus: 'success',
      syncInProgress: false,
      lastSyncedAt: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'w-main-high',
      name: 'Main High',
      type: 'multi_sig',
      balance: 4000,
      scriptType: 'wsh',
      network: 'mainnet',
      descriptor: 'desc-2',
      fingerprint: 'fp2',
      lastSyncStatus: 'partial',
      syncInProgress: true,
      lastSyncedAt: '2026-02-02T00:00:00.000Z',
    },
    {
      id: 'w-test',
      name: 'Test Wallet',
      type: 'single_sig',
      balance: 3000,
      scriptType: 'wpkh',
      network: 'testnet',
      descriptor: 'desc-3',
      fingerprint: 'fp3',
      lastSyncStatus: null,
      syncInProgress: false,
      lastSyncedAt: null,
    },
    {
      id: 'w-fallback',
      name: 'Fallback Network',
      type: 'single_sig',
      balance: 2000,
      scriptType: 'wpkh',
      network: undefined,
      descriptor: null,
      fingerprint: null,
      lastSyncStatus: null,
      syncInProgress: false,
      lastSyncedAt: null,
    },
  ];
  walletsLoading = false;

  recentTxData = [
    {
      id: 'tx-received',
      txid: 'abc',
      walletId: 'w-main-high',
      amount: '1500',
      fee: '100',
      confirmations: 2,
      blockHeight: 900001,
      blockTime: '2026-02-10T00:00:00.000Z',
      label: 'inbound',
      type: 'received',
    },
    {
      id: 'tx-sent',
      txid: 'def',
      walletId: 'w-main-low',
      amount: 500,
      fee: 25,
      confirmations: 0,
      blockHeight: undefined,
      blockTime: undefined,
      label: '',
      type: 'sent',
      isLocked: true,
      lockedByDraftLabel: 'Draft Payment',
    },
  ];
  txLoading = false;
  pendingTxData = [{ txid: 'pending-1' }];
  balanceHistoryData = [
    { name: 'Start', value: 5000 },
    { name: 'Now', value: 8000 },
  ];

  feeEstimatesData = { fastest: 18.6, hour: 9, economy: 3.4 };
  feesLoading = false;
  bitcoinStatusData = { connected: true, explorerUrl: 'https://mempool.space' };
  statusLoading = false;
  mempoolDataData = {
    mempool: [{ id: 'mp1' }],
    blocks: [{ id: 'b1' }, { id: 'b2' }],
    queuedBlocksSummary: { highPriority: 1, mediumPriority: 2, lowPriority: 3 },
  };
  mempoolLoading = false;
  mempoolRefreshing = false;

  wsConnected = true;
  wsState = 'connected';
  delayedRenderReady = true;

  currencyState = {
    format: vi.fn((sats: number) => `${sats}`),
    btcPrice: 100000,
    priceChange24h: 1.23,
    currencySymbol: '$',
    priceLoading: false,
    lastPriceUpdate: new Date('2026-02-15T12:00:00.000Z'),
    showFiat: true,
  };
  userState = { user: { id: 'user-1' } };

  Object.keys(wsEventHandlers).forEach(key => {
    delete wsEventHandlers[key];
  });
};

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetState();
    mockCheckVersion.mockResolvedValue({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com/release',
      releaseName: 'Stability',
      publishedAt: '2026-02-01T00:00:00.000Z',
      releaseNotes: 'Test notes',
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('maps API data, derives dashboard values, and sets up subscriptions', async () => {
    const removeVisibilitySpy = vi.spyOn(document, 'removeEventListener');

    const { result, unmount } = renderHook(() => useDashboardData());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.versionInfo?.latestVersion).toBe('1.1.0');

    expect(result.current.wallets).toHaveLength(4);
    expect(result.current.filteredWallets.map(w => w.id)).toEqual([
      'w-main-high',
      'w-fallback',
      'w-main-low',
    ]);
    expect(result.current.walletCounts).toEqual({
      mainnet: 3,
      testnet: 1,
      signet: 0,
    });
    expect(result.current.totalBalance).toBe(7000);
    expect(result.current.loading).toBe(false);
    expect(result.current.isMainnet).toBe(true);

    expect(result.current.recentTx).toHaveLength(2);
    expect(result.current.recentTx[0].amount).toBe(1500);
    expect(result.current.recentTx[0].fee).toBe(100);
    expect(result.current.recentTx[0].confirmations).toBeGreaterThan(0);
    expect(result.current.recentTx[1].amount).toBe(-500);
    expect(result.current.recentTx[1].confirmations).toBe(0);
    expect(result.current.recentTx[1].isLocked).toBe(true);
    expect(result.current.recentTx[1].lockedByDraftLabel).toBe('Draft Payment');
    expect(result.current.pendingTxs).toEqual(pendingTxData);

    expect(result.current.fees).toEqual({ fast: 18.6, medium: 9, slow: 3.4 });
    expect(result.current.formatFeeRate(undefined)).toBe('---');
    expect(result.current.formatFeeRate(10.6)).toBe('11');
    expect(result.current.formatFeeRate(9)).toBe('9');
    expect(result.current.formatFeeRate(9.2)).toBe('9.2');

    expect(result.current.nodeStatus).toBe('connected');
    expect(result.current.mempoolBlocks).toHaveLength(3);
    expect(result.current.queuedBlocksSummary).toEqual(mempoolDataData.queuedBlocksSummary);
    expect(result.current.lastMempoolUpdate).not.toBeNull();
    expect(result.current.chartReady).toBe(true);
    expect(result.current.chartData).toEqual([
      { name: 'Start', sats: 5000 },
      { name: 'Now', sats: 8000 },
    ]);
    expect(result.current.priceChangePositive).toBe(true);

    expect(mockSubscribeWallets).toHaveBeenCalledWith([
      'w-main-low',
      'w-main-high',
      'w-test',
      'w-fallback',
    ]);
    expect(mockSubscribe).toHaveBeenCalledWith('blocks');
    expect(mockSubscribe).toHaveBeenCalledWith('mempool');

    act(() => {
      result.current.refreshMempoolData();
    });
    expect(mockRefetchMempool).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    unmount();
    expect(mockUnsubscribeWallets).toHaveBeenCalledWith([
      'w-main-low',
      'w-main-high',
      'w-test',
      'w-fallback',
    ]);
    expect(mockUnsubscribe).toHaveBeenCalledWith('blocks');
    expect(mockUnsubscribe).toHaveBeenCalledWith('mempool');
    expect(removeVisibilitySpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );
  });

  it('handles URL network selection and updates URL params through handleNetworkChange', async () => {
    mockSearchParams = new URLSearchParams('network=testnet');

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.selectedNetwork).toBe('testnet');
    expect(result.current.isMainnet).toBe(false);
    expect(result.current.filteredWallets.map(w => w.id)).toEqual(['w-test']);

    act(() => {
      result.current.handleNetworkChange('signet');
    });
    expect(result.current.selectedNetwork).toBe('signet');
    expect(mockSearchParams.get('network')).toBe('signet');
    expect(mockSetSearchParams).toHaveBeenLastCalledWith(mockSearchParams, { replace: true });

    act(() => {
      result.current.handleNetworkChange('mainnet');
    });
    expect(result.current.selectedNetwork).toBe('mainnet');
    expect(mockSearchParams.get('network')).toBeNull();
    expect(mockSetSearchParams).toHaveBeenLastCalledWith(mockSearchParams, { replace: true });
  });

  it('covers loading/unknown/error node status and mainnet fallback for invalid URL network', async () => {
    mockSearchParams = new URLSearchParams('network=regtest');
    walletsData = [];
    walletsLoading = true;
    feeEstimatesData = undefined;
    mempoolDataData = undefined;
    mempoolRefreshing = true;
    statusLoading = true;
    bitcoinStatusData = undefined;
    currencyState.priceChange24h = null;

    const { result, rerender } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.selectedNetwork).toBe('mainnet');
    expect(result.current.loading).toBe(true);
    expect(result.current.nodeStatus).toBe('checking');
    expect(result.current.fees).toBeNull();
    expect(result.current.mempoolBlocks).toEqual([]);
    expect(result.current.queuedBlocksSummary).toBeNull();
    expect(result.current.lastMempoolUpdate).toBeNull();
    expect(result.current.priceChangePositive).toBe(false);
    expect(result.current.mempoolRefreshing).toBe(true);

    statusLoading = false;
    rerender();
    expect(result.current.nodeStatus).toBe('unknown');

    bitcoinStatusData = { connected: false };
    rerender();
    expect(result.current.nodeStatus).toBe('error');
  });

  it('handles version-check failures by logging a warning', async () => {
    mockCheckVersion.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckVersion).toHaveBeenCalledTimes(1);
    expect(result.current.versionInfo).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith('Failed to check for updates', {
      error: expect.any(Error),
    });
  });

  it('covers nullish query fallbacks, hidden visibility branch, and wsDisconnected reconnect branch', async () => {
    walletsData = null as any;
    recentTxData = null as any;
    pendingTxData = null as any;
    wsConnected = false;

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.wallets).toEqual([]);
    expect(result.current.filteredWallets).toEqual([]);
    expect(result.current.recentTx).toEqual([]);
    expect(result.current.pendingTxs).toEqual([]);

    const invalidateCountBeforeVisibility = mockInvalidateAllWallets.mock.calls.length;
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(600);
    });
    expect(mockInvalidateAllWallets.mock.calls.length).toBe(invalidateCountBeforeVisibility);
  });

  it('handles websocket transaction/balance/block/confirmation/sync events', async () => {
    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.wsConnected).toBe(true);
    expect(result.current.wsState).toBe('connected');

    expect(wsEventHandlers.transaction).toBeTypeOf('function');
    expect(wsEventHandlers.balance).toBeTypeOf('function');
    expect(wsEventHandlers.block).toBeTypeOf('function');
    expect(wsEventHandlers.confirmation).toBeTypeOf('function');
    expect(wsEventHandlers.sync).toBeTypeOf('function');

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'received',
          amount: 250000,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Received',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('receive');

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'consolidation',
          amount: 120000,
          confirmations: 0,
        },
      });
    });
    expect(mockPlayEventSound).toHaveBeenCalledWith('send');

    const notificationCountBeforeSmallBalance = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.balance?.({
        data: {
          change: 9000,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledTimes(notificationCountBeforeSmallBalance);

    act(() => {
      wsEventHandlers.balance?.({
        data: {
          change: 25000,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance',
        title: 'Balance Updated',
      })
    );

    act(() => {
      wsEventHandlers.block?.({
        data: {
          height: 900100,
          transactionCount: 3120,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block',
        title: 'New Block Mined',
      })
    );
    expect(mockRefetchMempool).toHaveBeenCalled();

    const soundCountBeforeConfirmations = mockPlayEventSound.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        title: 'Transaction Confirmed',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('confirmation');

    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 1,
          confirmations: 3,
        },
      });
    });
    expect(mockPlayEventSound.mock.calls.length).toBe(soundCountBeforeConfirmations + 1);

    const confirmationNoticeCount = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 2,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification.mock.calls.length).toBe(confirmationNoticeCount);

    act(() => {
      wsEventHandlers.sync?.({
        data: {
          walletId: 'w-main-low',
          inProgress: false,
          status: 'success',
        },
      });
    });
    expect(mockUpdateWalletSyncStatus).toHaveBeenCalledWith('w-main-low', false, 'success');

    const syncCallCount = mockUpdateWalletSyncStatus.mock.calls.length;
    act(() => {
      wsEventHandlers.sync?.({
        data: {
          inProgress: true,
          status: 'partial',
        },
      });
    });
    expect(mockUpdateWalletSyncStatus.mock.calls.length).toBe(syncCallCount);

    expect(mockInvalidateAllWallets).toHaveBeenCalled();
  });

  it('covers websocket/event fallback branches and fee-zero transaction mapping', async () => {
    recentTxData = [
      {
        id: 'tx-fee-zero',
        txid: 'fee-zero',
        walletId: 'w-main-low',
        amount: 1000,
        fee: 0,
        confirmations: 0,
        type: 'sent',
      },
    ];

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.recentTx[0].fee).toBeUndefined();

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'sent',
          // amount + confirmations intentionally omitted for nullish fallbacks
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Sent',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('send');

    const soundCountBeforeUnknownType = mockPlayEventSound.mock.calls.length;
    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'self_transfer',
          amount: 500,
        },
      });
    });
    expect(mockPlayEventSound.mock.calls.length).toBe(soundCountBeforeUnknownType);

    act(() => {
      wsEventHandlers.balance?.({ data: {} });
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    act(() => {
      wsEventHandlers.balance?.({
        data: { change: -20000 },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance',
        message: expect.stringContaining('-'),
      })
    );

    act(() => {
      wsEventHandlers.block?.({
        data: {
          height: 900101,
          // transactionCount intentionally omitted for fallback
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block',
        message: expect.stringContaining('0 transactions'),
      })
    );

    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          confirmations: 1,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        message: '1 confirmation reached',
      })
    );

    const notifyCountBeforeNoConfirm = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          // confirmations omitted => fallback to 0
        },
      });
    });
    expect(mockAddNotification.mock.calls.length).toBe(notifyCountBeforeNoConfirm);

    act(() => {
      wsEventHandlers.sync?.({
        data: {
          walletId: 'w-main-high',
          status: 'partial',
          // inProgress omitted => fallback false
        },
      });
    });
    expect(mockUpdateWalletSyncStatus).toHaveBeenCalledWith('w-main-high', false, 'partial');
  });
});
