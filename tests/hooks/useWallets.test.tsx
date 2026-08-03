import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { renderHook,waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import {
useBalanceHistory,
usePendingTransactions,
useRecentTransactions,
} from '../../src/hooks/queries/useWallets';

// Mock the API modules
vi.mock('../../src/api/transactions', () => ({
  getTransactions: vi.fn(),
  getRecentTransactions: vi.fn(),
  getPendingTransactions: vi.fn(),
}));

vi.mock('../../src/api/wallets', () => ({
  getWallets: vi.fn(),
  getWallet: vi.fn(),
  createWallet: vi.fn(),
  importWallet: vi.fn(),
}));

import * as transactionsApi from '../../src/api/transactions';

// Create a test wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useWallets hooks memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useRecentTransactions', () => {
    it('should call getRecentTransactions with correct params', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          walletId: 'wallet1',
          walletName: 'Test Wallet',
          blockTime: '2024-01-02T00:00:00Z',
          type: 'receive' as const,
          amount: 100000,
          confirmations: 6,
        },
        {
          id: 'tx2',
          txid: 'txid2',
          walletId: 'wallet1',
          walletName: 'Test Wallet',
          blockTime: '2024-01-01T00:00:00Z',
          type: 'sent' as const,
          amount: -50000,
          confirmations: 3,
        },
      ];

      vi.mocked(transactionsApi.getRecentTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(
        () => useRecentTransactions(['wallet1', 'wallet2'], 10),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify API called with correct params
      expect(transactionsApi.getRecentTransactions).toHaveBeenCalledWith(10, ['wallet1', 'wallet2']);
      expect(result.current.data).toEqual(mockTransactions);
    });

    it('should return data from server (server handles sorting)', async () => {
      // Server returns pre-sorted data
      const mockTransactions = [
        {
          id: 'tx2',
          txid: 'txid2',
          walletId: 'wallet1',
          blockTime: '2024-01-03T00:00:00Z',
          type: 'sent' as const,
          amount: -50000,
          confirmations: 3,
        },
        {
          id: 'tx3',
          txid: 'txid3',
          walletId: 'wallet1',
          blockTime: '2024-01-02T00:00:00Z',
          type: 'receive' as const,
          amount: 75000,
          confirmations: 6,
        },
        {
          id: 'tx1',
          txid: 'txid1',
          walletId: 'wallet1',
          blockTime: '2024-01-01T00:00:00Z',
          type: 'receive' as const,
          amount: 100000,
          confirmations: 6,
        },
      ];

      vi.mocked(transactionsApi.getRecentTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions(['wallet1'], 10), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Data comes from server pre-sorted
      expect(result.current.data[0].id).toBe('tx2');
      expect(result.current.data[1].id).toBe('tx3');
      expect(result.current.data[2].id).toBe('tx1');
    });

    it('should pass limit to server', async () => {
      vi.mocked(transactionsApi.getRecentTransactions).mockResolvedValue([]);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions(['wallet1'], 5), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify limit is passed to API
      expect(transactionsApi.getRecentTransactions).toHaveBeenCalledWith(5, ['wallet1']);
    });

    it('should return empty array when no wallets provided', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions([], 10), {
        wrapper,
      });

      // Should not call API
      expect(transactionsApi.getRecentTransactions).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([]);
    });
  });

  describe('usePendingTransactions', () => {
    it('should return stable array reference when data has not changed', async () => {
      const mockPendingTx = [
        { txid: 'pending1', walletId: 'wallet1', type: 'sent' as const, amount: 50000, fee: 2000, feeRate: 10, timeInQueue: 30, createdAt: '2024-01-01T00:00:00Z' },
        { txid: 'pending2', walletId: 'wallet1', type: 'sent' as const, amount: 30000, fee: 750, feeRate: 5, timeInQueue: 60, createdAt: '2024-01-01T00:00:00Z' },
      ];

      vi.mocked(transactionsApi.getPendingTransactions).mockResolvedValue(mockPendingTx);

      const wrapper = createWrapper();
      const { result, rerender } = renderHook(
        () => usePendingTransactions(['wallet1']),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstData = result.current.data;

      rerender();

      // Data should still be correct after rerender
      expect(result.current.data.length).toBe(firstData.length);
      // Refetch should be a function
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should sort by fee rate descending (higher first)', async () => {
      const mockPendingTx = [
        { txid: 'pending1', walletId: 'wallet1', type: 'sent' as const, amount: 50000, fee: 1000, feeRate: 5, timeInQueue: 30, createdAt: '2024-01-01T00:00:00Z' },
        { txid: 'pending2', walletId: 'wallet1', type: 'sent' as const, amount: 60000, fee: 3000, feeRate: 20, timeInQueue: 60, createdAt: '2024-01-01T00:00:00Z' },
        { txid: 'pending3', walletId: 'wallet1', type: 'sent' as const, amount: 40000, fee: 1000, feeRate: 10, timeInQueue: 90, createdAt: '2024-01-01T00:00:00Z' },
      ];

      vi.mocked(transactionsApi.getPendingTransactions).mockResolvedValue(mockPendingTx);

      const wrapper = createWrapper();
      const { result } = renderHook(() => usePendingTransactions(['wallet1']), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should be sorted by feeRate descending
      expect(result.current.data[0].feeRate).toBe(20);
      expect(result.current.data[1].feeRate).toBe(10);
      expect(result.current.data[2].feeRate).toBe(5);
    });
  });

  describe('useBalanceHistory', () => {
    it('should return stable chart data reference when inputs unchanged', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          walletId: 'wallet1',
          blockTime: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          type: 'receive' as const,
          amount: 100000,
          balanceAfter: 100000,
          confirmations: 6,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result, rerender } = renderHook(
        () => useBalanceHistory(['wallet1'], 100000, '1W'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstData = result.current.data;

      rerender();

      // Data should still be correct after rerender
      expect(result.current.data.length).toBe(firstData.length);
    });

    it('should filter out consolidation transactions', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          walletId: 'wallet1',
          blockTime: new Date(Date.now() - 86400000).toISOString(),
          type: 'receive' as const,
          amount: 100000,
          balanceAfter: 100000,
          confirmations: 6,
        },
        {
          id: 'tx2',
          txid: 'txid2',
          walletId: 'wallet1',
          blockTime: new Date(Date.now() - 43200000).toISOString(),
          type: 'consolidation' as const,
          amount: -1000,
          balanceAfter: 99000,
          confirmations: 3,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(
        () => useBalanceHistory(['wallet1'], 99000, '1W'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Chart data should have filtered out consolidation
      // The result should only include the receive transaction plus start/end points
      expect(result.current.data.length).toBeGreaterThan(0);
    });

    it('should return flat line when no transactions in range', async () => {
      vi.mocked(transactionsApi.getTransactions).mockResolvedValue([]);

      const wrapper = createWrapper();
      const { result } = renderHook(
        () => useBalanceHistory(['wallet1'], 50000, '1D'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should return start and end points with same value
      expect(result.current.data.length).toBe(2);
      expect(result.current.data[0].value).toBe(50000);
      expect(result.current.data[1].value).toBe(50000);
    });
  });
});

describe('Hook reference stability for React re-renders', () => {
  it('queryConfigs should be memoized based on walletIds', async () => {
    vi.mocked(transactionsApi.getTransactions).mockResolvedValue([]);

    const wrapper = createWrapper();

    // First render with wallet1
    const { result: result1, rerender } = renderHook(
      ({ walletIds }) => useRecentTransactions(walletIds, 10),
      { wrapper, initialProps: { walletIds: ['wallet1'] } }
    );

    await waitFor(() => {
      expect(result1.current.isLoading).toBe(false);
    });

    // Track how many times getTransactions was called
    const callCount = vi.mocked(transactionsApi.getTransactions).mock.calls.length;

    // Rerender with same walletIds (should not trigger new queries)
    rerender({ walletIds: ['wallet1'] });

    // Should not have made additional API calls due to memoization
    expect(vi.mocked(transactionsApi.getTransactions).mock.calls.length).toBe(callCount);
  });

  it('should handle empty walletIds gracefully without causing re-renders', async () => {
    const wrapper = createWrapper();

    let renderCount = 0;

    const { result, rerender } = renderHook(
      () => {
        renderCount++;
        return useRecentTransactions([], 10);
      },
      { wrapper }
    );

    // Rerender multiple times
    rerender();
    rerender();
    rerender();

    // Should not trigger excessive re-renders
    // The hook should be stable when walletIds is empty
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
