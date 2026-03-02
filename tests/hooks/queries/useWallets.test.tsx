import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useWallets,
  useCreateWallet,
  useImportWallet,
  useUpdateWallet,
  useRecentTransactions,
  usePendingTransactions,
  useInvalidateAllWallets,
  useUpdateWalletSyncStatus,
  useBalanceHistory,
  walletKeys,
} from '../../../hooks/queries/useWallets';

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
}));

import * as walletsApi from '../../../src/api/wallets';
import * as transactionsApi from '../../../src/api/transactions';

const mockGetWallets = vi.mocked(walletsApi.getWallets);
const mockCreateWallet = vi.mocked(walletsApi.createWallet);
const mockImportWallet = vi.mocked(walletsApi.importWallet);
const mockUpdateWallet = vi.mocked(walletsApi.updateWallet);
const mockGetRecentTransactions = vi.mocked(transactionsApi.getRecentTransactions);
const mockGetPendingTransactions = vi.mocked(transactionsApi.getPendingTransactions);
const mockGetBalanceHistory = vi.mocked(transactionsApi.getBalanceHistory);

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

    expect(mockGetRecentTransactions).toHaveBeenCalledWith(5, ['w1', 'w2']);
    expect(result.current.data[0].txid).toBe('tx1');
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
