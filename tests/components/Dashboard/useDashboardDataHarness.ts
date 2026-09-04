/**
 * Mock harness for the useDashboardData tests.
 *
 * Extracted so the test file has room to grow: it had reached 994 of the
 * large-file gate's 1000-line cap, where the next test added would have
 * failed CI. No test moved — only the scaffolding they all share.
 */
import { vi } from 'vitest';

export const mockNavigate = vi.fn();
export const mockSetSearchParams = vi.fn();

export const mockCheckVersion = vi.fn();
export const mockLoggerWarn = vi.fn();
export const mockSubscribeWallets = vi.fn();
export const mockUnsubscribeWallets = vi.fn();
export const mockSubscribe = vi.fn();
export const mockUnsubscribe = vi.fn();
export const mockAddNotification = vi.fn();
export const mockPlayEventSound = vi.fn();
export const mockInvalidateAllWallets = vi.fn();
export const mockRefetchMempool = vi.fn();

export const wsEventHandlers: Record<string, ((event: any) => void) | undefined> = {};

export const recentTxCalls: { pageSize: number; page: number }[] = [];
export const activitySummaryCalls: { timeframe: string }[] = [];

/**
 * Mutable fixtures, shared by the mocks below and by the tests.
 *
 * An object rather than `let` bindings: a test cannot reassign an imported
 * binding across a module boundary, and these are reassigned constantly.
 *
 * The key type is derived from this initialiser rather than being
 * `Record<string, any>`, which would have lost something the `let` bindings
 * gave us for free: as loose string keys, `state.walletsDta = [...]` compiles
 * and silently does nothing. Keys are now closed, so a typo is a tsc error
 * again. Values stay `any` — these are heterogeneous fixtures reassigned per
 * test, and pinning them buys noise rather than safety.
 */
const INITIAL_STATE = {
  mockSearchParams: new URLSearchParams(),
  walletsData: undefined,
  walletsLoading: false,
  recentTxData: undefined,
  txLoading: false,
  recentTxFetching: false,
  recentTxHasNext: false,
  pendingTxData: undefined,
  balanceHistoryData: undefined,
  activitySummaryData: undefined,
  activitySummaryIsError: false,
  walletsIsError: false,
  balanceHistoryIsUnavailable: false,
  mempoolIsError: false,
  feesIsError: false,
  feeEstimatesData: undefined,
  feesLoading: false,
  bitcoinStatusData: undefined,
  statusLoading: false,
  statusIsPlaceholderData: false,
  statusError: null as unknown,
  statusDataUpdatedAt: 0,
  bitcoinStatusNetworks: [],
  mempoolNetworks: [],
  mempoolDataData: undefined,
  mempoolLoading: false,
  mempoolRefreshing: false,
  wsConnected: false,
  wsState: 'disconnected',
  delayedRenderReady: true,
  currencyState: undefined,
  userState: undefined,
  activeNetworkState: 'mainnet',
};

export const state: Record<keyof typeof INITIAL_STATE, any> = { ...INITIAL_STATE };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [state.mockSearchParams, mockSetSearchParams] as const,
  };
});

vi.mock('../../../src/api/admin', () => ({
  checkVersion: (...args: any[]) => mockCheckVersion(...args),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    warn: (...args: any[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/websocket', () => ({
  useWebSocket: () => ({
    connected: state.wsConnected,
    state: state.wsState,
    subscribeWallets: mockSubscribeWallets,
    unsubscribeWallets: mockUnsubscribeWallets,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  }),
  useWebSocketEvent: (eventType: string, callback: (event: any) => void) => {
    wsEventHandlers[eventType] = callback;
  },
}));

vi.mock('../../../src/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    addNotification: mockAddNotification,
  }),
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: state.activeNetworkState,
    isMainnet: state.activeNetworkState === 'mainnet',
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: mockPlayEventSound,
  }),
}));

vi.mock('../../../src/hooks/queries/useWallets', () => ({
  useWallets: () => ({ data: state.walletsData, isLoading: state.walletsLoading, isError: state.walletsIsError }),
  useRecentTransactions: (_ids: string[], pageSize: number, page: number) => {
    recentTxCalls.push({ pageSize, page });
    return {
      data: state.recentTxData,
      isLoading: state.txLoading,
      isFetching: state.recentTxFetching,
      page,
      pageSize,
      hasPreviousPage: page > 0,
      hasNextPage: state.recentTxHasNext,
    };
  },
  usePendingTransactions: () => ({ data: state.pendingTxData }),
  useInvalidateAllWallets: () => mockInvalidateAllWallets,
  useBalanceHistory: () => ({ data: state.balanceHistoryData, isUnavailable: state.balanceHistoryIsUnavailable }),
  useActivitySummary: (_ids: string[], timeframe: string) => {
    activitySummaryCalls.push({ timeframe });
    return { data: state.activitySummaryData, isError: state.activitySummaryIsError };
  },
}));

vi.mock('../../../src/hooks/queries/useBitcoin', () => ({
  useFeeEstimates: () => ({ data: state.feeEstimatesData, isLoading: state.feesLoading, isError: state.feesIsError }),
  useBitcoinStatus: (network: string) => {
    state.bitcoinStatusNetworks.push(network);
    return {
      data: state.bitcoinStatusData,
      isLoading: state.statusLoading,
      isPlaceholderData: state.statusIsPlaceholderData,
      error: state.statusError,
      dataUpdatedAt: state.statusDataUpdatedAt,
    };
  },
  useMempoolData: (network: string) => {
    state.mempoolNetworks.push(network);
    return {
      data: state.mempoolDataData,
      isLoading: state.mempoolLoading,
      refetch: mockRefetchMempool,
      isFetching: state.mempoolRefreshing,
      isError: state.mempoolIsError,
    };
  },
}));

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  useCurrency: () => state.currencyState,
}));

vi.mock('../../../src/contexts/UserContext', () => ({
  useUser: () => state.userState,
}));

// Stateful, matching the pattern in WalletSummary.test: the activity page size
// runs through this hook, and the reset-on-change effect needs a real setter.
export const mockPreferences = new Map<string, unknown>();

vi.mock('../../../src/hooks/useUserPreference', async () => {
  const { useState } = await import('react');
  return {
    useUserPreference: (key: string, defaultValue: unknown) => {
      const [value, setValue] = useState(
        mockPreferences.has(key) ? mockPreferences.get(key) : defaultValue
      );
      return [
        value,
        (newValue: unknown) => {
          mockPreferences.set(key, newValue);
          setValue(newValue);
        },
      ];
    },
  };
});

vi.mock('../../../src/hooks/useDelayedRender', () => ({
  useDelayedRender: () => state.delayedRenderReady,
}));

export const resetState = () => {
  state.mockSearchParams = new URLSearchParams();
  state.recentTxFetching = false;
  state.recentTxHasNext = false;
  recentTxCalls.length = 0;
  activitySummaryCalls.length = 0;
  state.activitySummaryData = { count: 3, receivedSats: 500, sentSats: 200, latestAt: null };
  state.activitySummaryIsError = false;
  state.walletsIsError = false;
  state.balanceHistoryIsUnavailable = false;
  state.mempoolIsError = false;
  state.feesIsError = false;
  mockPreferences.clear();
  state.walletsData = [
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
      network: 'testnet3',
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
  state.walletsLoading = false;

  state.recentTxData = [
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
  state.txLoading = false;
  state.pendingTxData = [{ txid: 'pending-1' }];
  state.balanceHistoryData = [
    { name: 'Start', value: 5000 },
    { name: 'Now', value: 8000 },
  ];

  state.feeEstimatesData = { fastest: 18.6, hour: 9, economy: 3.4 };
  state.feesLoading = false;
  state.bitcoinStatusData = { connected: true, explorerUrl: 'https://mempool.space', network: 'mainnet' };
  state.statusLoading = false;
  state.statusIsPlaceholderData = false;
  state.statusError = null;
  state.statusDataUpdatedAt = Date.now();
  state.bitcoinStatusNetworks = [];
  state.mempoolNetworks = [];
  state.mempoolDataData = {
    mempool: [{ id: 'mp1' }],
    blocks: [{ id: 'b1' }, { id: 'b2' }],
    queuedBlocksSummary: { highPriority: 1, mediumPriority: 2, lowPriority: 3 },
  };
  state.mempoolLoading = false;
  state.mempoolRefreshing = false;

  state.wsConnected = true;
  state.wsState = 'connected';
  state.delayedRenderReady = true;
  state.activeNetworkState = 'mainnet';

  state.currencyState = {
    format: vi.fn((sats: number) => `${sats}`),
    btcPrice: 100000,
    priceChange24h: 1.23,
    currencySymbol: '$',
    priceLoading: false,
    lastPriceUpdate: new Date('2026-02-15T12:00:00.000Z'),
    showFiat: true,
  };
  state.userState = { user: { id: 'user-1' } };

  Object.keys(wsEventHandlers).forEach(key => {
    delete wsEventHandlers[key];
  });
};
