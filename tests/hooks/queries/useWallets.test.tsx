import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { act,renderHook,waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import {
useBalanceHistory,
useCreateWallet,
useActivitySummary,
useImportWallet,
useInvalidateAllWallets,
usePendingTransactions,
useRecentTransactions,
useUpdateWallet,
useUpdateWalletSyncStatus,
useWalletSparklines,
useWallets,
walletKeys,
} from '../../../src/hooks/queries/useWallets';

vi.mock('../../../src/api/wallets', () => ({
  getWallets: vi.fn(),
  createWallet: vi.fn(),
  importWallet: vi.fn(),
  updateWallet: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getRecentTransactions: vi.fn(),
  getPendingTransactions: vi.fn(),
  getBalanceHistory: vi.fn(),
  getActivitySummary: vi.fn(),
}));

import * as transactionsApi from '../../../src/api/transactions';
import * as walletsApi from '../../../src/api/wallets';

const mockGetWallets = vi.mocked(walletsApi.getWallets);
const mockCreateWallet = vi.mocked(walletsApi.createWallet);
const mockImportWallet = vi.mocked(walletsApi.importWallet);
const mockUpdateWallet = vi.mocked(walletsApi.updateWallet);
const mockGetRecentTransactions = vi.mocked(transactionsApi.getRecentTransactions);
const mockGetPendingTransactions = vi.mocked(transactionsApi.getPendingTransactions);
const mockGetBalanceHistory = vi.mocked(transactionsApi.getBalanceHistory);
const mockGetActivitySummary = vi.mocked(transactionsApi.getActivitySummary);

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

const createWrapper = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('walletKeys', () => {
  it('builds stable query keys', () => {
    expect(walletKeys.all).toEqual(['wallets']);
    expect(walletKeys.lists()).toEqual(['wallets', 'list']);
    expect(walletKeys.detail('w1')).toEqual(['wallets', 'detail', 'w1']);
    expect(walletKeys.utxos('w1')).toEqual(['wallets', 'utxos', 'w1']);
    expect(walletKeys.addresses('w1')).toEqual(['wallets', 'addresses', 'w1']);
    expect(walletKeys.balance('w1')).toEqual(['wallets', 'balance', 'w1']);
    expect(walletKeys.transactions('w1', { page: 1, limit: 10, offset: 0 })).toEqual([
      'wallets',
      'transactions',
      'w1',
      1,
      10,
      0,
    ]);
  });
});

describe('wallet query and mutation hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('fetches wallets', async () => {
    mockGetWallets.mockResolvedValue([{ id: 'w1', name: 'Wallet 1', balance: 0 } as any]);

    const { result } = renderHook(() => useWallets(), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]?.id).toBe('w1');
  });

  it('creates wallet and invalidates wallet list query', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockCreateWallet.mockResolvedValue({ id: 'w2' } as any);

    const { result } = renderHook(() => useCreateWallet(), { wrapper: createWrapper(queryClient) });
    await result.current.mutateAsync({ name: 'Wallet 2' } as any);

    expect(mockCreateWallet).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
  });

  it('imports wallet and invalidates wallet list query', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockImportWallet.mockResolvedValue({ wallet: { id: 'w3' } } as any);

    const { result } = renderHook(() => useImportWallet(), { wrapper: createWrapper(queryClient) });
    await result.current.mutateAsync({ descriptor: 'wpkh(...)' } as any);

    expect(mockImportWallet).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
  });

  it('updates wallet and invalidates detail + list queries', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockUpdateWallet.mockResolvedValue({ id: 'w1', name: 'Updated' } as any);

    const { result } = renderHook(() => useUpdateWallet(), { wrapper: createWrapper(queryClient) });
    await result.current.mutateAsync({
      walletId: 'w1',
      data: { name: 'Updated' } as any,
    });

    expect(mockUpdateWallet).toHaveBeenCalledWith('w1', { name: 'Updated' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletKeys.detail('w1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
  });
});

describe('aggregated transaction hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('returns empty recent transactions when walletIds are empty', () => {
    const { result } = renderHook(() => useRecentTransactions([], 5), { wrapper: createWrapper(queryClient) });

    expect(result.current.data).toEqual([]);
    expect(mockGetRecentTransactions).not.toHaveBeenCalled();
  });

  it('manual refetch on recent transactions with empty walletIds returns empty without API calls', async () => {
    const { result } = renderHook(() => useRecentTransactions([], 5), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      const refetchResult = await result.current.refetch();
      expect(refetchResult.data).toEqual([]);
    });

    expect(mockGetRecentTransactions).not.toHaveBeenCalled();
  });

  it('fetches recent transactions when walletIds exist', async () => {
    mockGetRecentTransactions.mockResolvedValue([{ txid: 'tx1', amount: 123 } as any]);

    const { result } = renderHook(() => useRecentTransactions(['w1', 'w2'], 5), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    // pageSize + 1: the extra row is how hasNextPage is derived without a
    // second COUNT query over every wallet.
    expect(mockGetRecentTransactions).toHaveBeenCalledWith(6, ['w1', 'w2'], 0);
    expect(result.current.data[0].txid).toBe('tx1');
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.hasPreviousPage).toBe(false);
  });

  it('derives paging state and hides the sentinel row', async () => {
    // Six rows back for a page size of five: the sixth exists only to prove a
    // next page, and must not be displayed.
    mockGetRecentTransactions.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ txid: `tx${i}`, amount: 1 })) as any
    );

    const { result } = renderHook(() => useRecentTransactions(['w1'], 5, 2), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(5));

    expect(mockGetRecentTransactions).toHaveBeenCalledWith(6, ['w1'], 10);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.hasPreviousPage).toBe(true);
    expect(result.current.data.map(t => t.txid)).not.toContain('tx5');
  });

  it('keeps rows while paging but never across a wallet-set change', async () => {
    mockGetRecentTransactions.mockResolvedValue([{ txid: 'mainnet-tx', amount: 1 } as any]);

    const { result, rerender } = renderHook(
      ({ ids, page }: { ids: string[]; page: number }) => useRecentTransactions(ids, 5, page),
      { wrapper: createWrapper(queryClient), initialProps: { ids: ['w1'], page: 0 } }
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    // Same wallets, next page: the previous rows stay on screen so the table
    // does not collapse mid-click.
    mockGetRecentTransactions.mockImplementation(() => new Promise(() => {}));
    rerender({ ids: ['w1'], page: 1 });
    expect(result.current.data).toHaveLength(1);

    // Different wallet set: showing the previous network's activity would be a
    // straightforward lie, so it must fall back to empty.
    rerender({ ids: ['w2'], page: 0 });
    expect(result.current.data).toHaveLength(0);
  });

  it('reports no next page on a short final page', async () => {
    mockGetRecentTransactions.mockResolvedValue(
      Array.from({ length: 2 }, (_, i) => ({ txid: `tx${i}`, amount: 1 })) as any
    );

    const { result } = renderHook(() => useRecentTransactions(['w1'], 5, 1), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.hasPreviousPage).toBe(true);
  });

  it('returns empty pending transactions when walletIds are empty', () => {
    const { result } = renderHook(() => usePendingTransactions([]), { wrapper: createWrapper(queryClient) });

    expect(result.current.data).toEqual([]);
    expect(mockGetPendingTransactions).not.toHaveBeenCalled();
  });

  it('manual refetch on pending transactions with empty walletIds returns empty without API calls', async () => {
    const { result } = renderHook(() => usePendingTransactions([]), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      const refetchResult = await result.current.refetch();
      expect(refetchResult.data).toEqual([]);
    });

    expect(mockGetPendingTransactions).not.toHaveBeenCalled();
  });

  it('aggregates and sorts pending transactions by feeRate', async () => {
    mockGetPendingTransactions
      .mockResolvedValueOnce([
        { txid: 'tx-low', feeRate: 2 } as any,
        { txid: 'tx-high', feeRate: 10 } as any,
      ])
      .mockResolvedValueOnce([{ txid: 'tx-mid', feeRate: 5 } as any]);

    const { result } = renderHook(() => usePendingTransactions(['w1', 'w2']), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    expect(mockGetPendingTransactions).toHaveBeenNthCalledWith(1, 'w1');
    expect(mockGetPendingTransactions).toHaveBeenNthCalledWith(2, 'w2');
    expect(result.current.data.map((tx: any) => tx.txid)).toEqual(['tx-high', 'tx-mid', 'tx-low']);
  });
});

describe('wallet cache helper hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('invalidates all wallet queries', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useInvalidateAllWallets(), { wrapper: createWrapper(queryClient) });

    act(() => result.current());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['balanceHistory'] });
  });

  it('updates sync status in wallet list and detail cache entries', () => {
    queryClient.setQueryData(walletKeys.lists(), [
      { id: 'w1', name: 'Wallet 1', syncInProgress: false, lastSyncStatus: 'idle' },
      { id: 'w2', name: 'Wallet 2', syncInProgress: false },
    ]);
    queryClient.setQueryData(walletKeys.detail('w1'), {
      id: 'w1',
      name: 'Wallet 1',
      syncInProgress: false,
      lastSyncStatus: 'idle',
    });

    const { result } = renderHook(() => useUpdateWalletSyncStatus(), { wrapper: createWrapper(queryClient) });

    act(() => result.current('w1', true, 'syncing'));
    const listAfterStart = queryClient.getQueryData(walletKeys.lists()) as any[];
    const detailAfterStart = queryClient.getQueryData(walletKeys.detail('w1')) as any;
    expect(listAfterStart[0].syncInProgress).toBe(true);
    expect(listAfterStart[0].lastSyncStatus).toBe('syncing');
    expect(detailAfterStart.syncInProgress).toBe(true);
    expect(detailAfterStart.lastSyncStatus).toBe('syncing');

    act(() => result.current('w1', false));
    const listAfterFinish = queryClient.getQueryData(walletKeys.lists()) as any[];
    const detailAfterFinish = queryClient.getQueryData(walletKeys.detail('w1')) as any;
    expect(listAfterFinish[0].syncInProgress).toBe(false);
    expect(detailAfterFinish.syncInProgress).toBe(false);
    expect(listAfterFinish[0].lastSyncedAt).toEqual(expect.any(String));
    expect(detailAfterFinish.lastSyncedAt).toEqual(expect.any(String));
    expect(new Date(listAfterFinish[0].lastSyncedAt).toString()).not.toBe('Invalid Date');
    expect(new Date(detailAfterFinish.lastSyncedAt).toString()).not.toBe('Invalid Date');
  });

  it('no-ops sync status cache updates when list/detail caches are missing', () => {
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const { result } = renderHook(() => useUpdateWalletSyncStatus(), { wrapper: createWrapper(queryClient) });

    act(() => result.current('missing-wallet', true, 'syncing'));

    expect(setQueryDataSpy).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(walletKeys.lists())).toBeUndefined();
    expect(queryClient.getQueryData(walletKeys.detail('missing-wallet'))).toBeUndefined();
  });
});

describe('useBalanceHistory', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('returns default balance points when walletIds are empty', () => {
    const { result } = renderHook(() => useBalanceHistory([], 1000, '1W'), { wrapper: createWrapper(queryClient) });

    expect(result.current.data).toEqual([
      { name: 'Start', value: 1000 },
      { name: 'Now', value: 1000 },
    ]);
    expect(mockGetBalanceHistory).not.toHaveBeenCalled();
  });

  it('keeps empty-wallet balance history query fetch guarded from API calls', async () => {
    renderHook(() => useBalanceHistory([], 1000, '1W'), { wrapper: createWrapper(queryClient) });

    const query = queryClient.getQueryCache().find({
      queryKey: ['balanceHistory', '', '1W', 1000],
    });
    expect(query).not.toBeUndefined();
    expect(query?.queryKey).toEqual(['balanceHistory', '', '1W', 1000]);

    await act(async () => {
      await (query as any).fetch();
    });

    expect(queryClient.getQueryData(['balanceHistory', '', '1W', 1000])).toEqual([]);
    expect(mockGetBalanceHistory).not.toHaveBeenCalled();
  });

  it('fetches balance history when walletIds exist', async () => {
    mockGetBalanceHistory.mockResolvedValue([
      { name: 'Start', value: 900 },
      { name: 'Now', value: 1200 },
    ] as any);

    const { result } = renderHook(() => useBalanceHistory(['w1'], 1200, '1M'), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(mockGetBalanceHistory).toHaveBeenCalledWith('1M', 1200, ['w1']);
    expect(result.current.data[1].value).toBe(1200);
  });
});

describe('useActivitySummary', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('stays undefined and makes no call when there are no wallets', () => {
    const { result } = renderHook(() => useActivitySummary([], '1W'), {
      wrapper: createWrapper(queryClient),
    });

    // Undefined rather than a zeroed placeholder: the collapsed bar renders
    // nothing until it knows, instead of claiming "0 confirmed".
    expect(result.current.data).toBeUndefined();
    expect(mockGetActivitySummary).not.toHaveBeenCalled();
  });

  it('fetches the summary for the selected period and wallets', async () => {
    mockGetActivitySummary.mockResolvedValue({
      count: 14,
      receivedSats: 1_200_000,
      sentSats: 770_000,
      latestAt: '2026-08-01T00:00:00.000Z',
    } as any);

    const { result } = renderHook(() => useActivitySummary(['w1', 'w2'], '1M'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(mockGetActivitySummary).toHaveBeenCalledWith('1M', ['w1', 'w2']);
    expect(result.current.data?.count).toBe(14);
  });

  it('refetches when the period changes', async () => {
    mockGetActivitySummary.mockResolvedValue({
      count: 1,
      receivedSats: 0,
      sentSats: 0,
      latestAt: null,
    } as any);

    const { rerender, result } = renderHook(
      ({ timeframe }: { timeframe: '1W' | '1Y' }) => useActivitySummary(['w1'], timeframe),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { timeframe: '1W' as '1W' | '1Y' },
      }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ timeframe: '1Y' });
    await waitFor(() => expect(mockGetActivitySummary).toHaveBeenCalledWith('1Y', ['w1']));
  });

  it('reports a failed aggregate rather than hiding it', async () => {
    mockGetActivitySummary.mockRejectedValue(new Error('aggregate failed'));

    const { result } = renderHook(() => useActivitySummary(['w1'], '1W'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useWalletSparklines', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('returns sparkline data per wallet', async () => {
    mockGetBalanceHistory
      .mockResolvedValueOnce([
        { name: 'Mon', value: 100 },
        { name: 'Tue', value: 200 },
        { name: 'Wed', value: 150 },
      ] as any)
      .mockResolvedValueOnce([
        { name: 'Mon', value: 500 },
        { name: 'Tue', value: 600 },
      ] as any);

    const wallets = [
      { id: 'w1', balance: 150 },
      { id: 'w2', balance: 600 },
    ];
    const { result } = renderHook(() => useWalletSparklines(wallets), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current['w1']?.status).toBe('ready');
      expect(result.current['w2']?.status).toBe('ready');
    });

    expect(result.current['w1']).toEqual({ status: 'ready', values: [100, 200, 150] });
    expect(result.current['w2']).toEqual({ status: 'ready', values: [500, 600] });
  });

  it('returns empty object for empty wallets', () => {
    const { result } = renderHook(() => useWalletSparklines([]), { wrapper: createWrapper(queryClient) });
    expect(result.current).toEqual({});
  });

  it('marks wallets with fewer than 2 real points unavailable', async () => {
    mockGetBalanceHistory
      .mockResolvedValueOnce([{ name: 'Now', value: 100 }] as any) // only 1 point
      .mockResolvedValueOnce([
        { name: 'Mon', value: 200 },
        { name: 'Tue', value: 300 },
      ] as any);

    const wallets = [
      { id: 'w1', balance: 100 },
      { id: 'w2', balance: 300 },
    ];
    const { result } = renderHook(() => useWalletSparklines(wallets), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current['w2']?.status).toBe('ready');
    });

    expect(result.current['w1']).toEqual({ status: 'unavailable' });
    expect(result.current['w2']).toEqual({ status: 'ready', values: [200, 300] });
  });

  it('handles API errors gracefully', async () => {
    mockGetBalanceHistory
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([
        { name: 'Mon', value: 400 },
        { name: 'Tue', value: 500 },
      ] as any);

    const wallets = [
      { id: 'w-fail', balance: 0 },
      { id: 'w-ok', balance: 500 },
    ];
    const { result } = renderHook(() => useWalletSparklines(wallets), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current['w-ok']?.status).toBe('ready');
    });

    expect(result.current['w-fail']).toEqual({ status: 'error' });
    expect(result.current['w-ok']).toEqual({ status: 'ready', values: [400, 500] });
  });

  it('keys requests by current balance and ignores an older in-flight result', async () => {
    const oldRequest = createDeferred<any[]>();
    const newRequest = createDeferred<any[]>();
    mockGetBalanceHistory
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);

    const { result, rerender } = renderHook(
      ({ balance }) => useWalletSparklines([{ id: 'w1', balance }]),
      { initialProps: { balance: 100 }, wrapper: createWrapper(queryClient) }
    );
    await waitFor(() => expect(mockGetBalanceHistory).toHaveBeenCalledWith('1W', 100, ['w1']));

    rerender({ balance: 200 });
    await waitFor(() => expect(mockGetBalanceHistory).toHaveBeenCalledWith('1W', 200, ['w1']));

    oldRequest.resolve([
      { name: 'Mon', value: 90 },
      { name: 'Tue', value: 100 },
    ]);
    await act(async () => undefined);
    expect(result.current['w1']).toEqual({ status: 'unavailable' });

    newRequest.resolve([
      { name: 'Mon', value: 180 },
      { name: 'Tue', value: 200 },
    ]);
    await waitFor(() => {
      expect(result.current['w1']).toEqual({ status: 'ready', values: [180, 200] });
    });
  });

  it('uses deterministic query identity when wallets are reordered', async () => {
    mockGetBalanceHistory
      .mockResolvedValueOnce([{ name: 'Mon', value: 10 }, { name: 'Tue', value: 20 }] as any)
      .mockResolvedValueOnce([{ name: 'Mon', value: 30 }, { name: 'Tue', value: 40 }] as any);
    const walletA = { id: 'a', balance: 20 };
    const walletB = { id: 'b', balance: 40 };

    const { result, rerender } = renderHook(
      ({ wallets }) => useWalletSparklines(wallets),
      {
        initialProps: { wallets: [walletB, walletA] },
        wrapper: createWrapper(queryClient),
      }
    );
    await waitFor(() => expect(result.current.a?.status).toBe('ready'));

    rerender({ wallets: [walletA, walletB] });
    await act(async () => undefined);

    expect(mockGetBalanceHistory).toHaveBeenCalledTimes(2);
    expect(mockGetBalanceHistory.mock.calls).toEqual([
      ['1W', 20, ['a']],
      ['1W', 40, ['b']],
    ]);
  });
});
