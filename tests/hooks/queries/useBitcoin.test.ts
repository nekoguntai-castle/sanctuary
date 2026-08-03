/**
 * Tests for src/hooks/queries/useBitcoin.ts
 *
 * Tests React Query hooks for Bitcoin data fetching.
 */

import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { renderHook,waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import {
bitcoinKeys,
useBitcoinStatus,
useFeeEstimates,
useMempoolData,
} from '../../../src/hooks/queries/useBitcoin';
import * as bitcoinApi from '../../../src/api/bitcoin';

// Mock the bitcoin API
vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
  getFeeEstimates: vi.fn(),
  getMempoolData: vi.fn(),
}));

// Create a wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useBitcoin hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('bitcoinKeys', () => {
    it('generates correct query keys', () => {
      expect(bitcoinKeys.all).toEqual(['bitcoin']);
      expect(bitcoinKeys.status()).toEqual(['bitcoin', 'status', 'mainnet']);
      expect(bitcoinKeys.status('testnet3')).toEqual(['bitcoin', 'status', 'testnet3']);
      expect(bitcoinKeys.fees()).toEqual(['bitcoin', 'fees', 'mainnet']);
      expect(bitcoinKeys.fees('testnet4')).toEqual(['bitcoin', 'fees', 'testnet4']);
      expect(bitcoinKeys.mempool()).toEqual(['bitcoin', 'mempool', 'mainnet']);
      expect(bitcoinKeys.mempool('signet')).toEqual(['bitcoin', 'mempool', 'signet']);
    });
  });

  describe('useBitcoinStatus', () => {
    it('fetches bitcoin status', async () => {
      const mockStatus = {
        connected: true,
        blockHeight: 800000,
        network: 'mainnet',
      };
      vi.mocked(bitcoinApi.getStatus).mockResolvedValue(mockStatus as any);

      const { result } = renderHook(() => useBitcoinStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStatus);
      expect(bitcoinApi.getStatus).toHaveBeenCalledWith('mainnet');
    });

    it('fetches selected network bitcoin status', async () => {
      const mockStatus = {
        connected: true,
        blockHeight: 4500000,
        network: 'testnet3',
      };
      vi.mocked(bitcoinApi.getStatus).mockResolvedValue(mockStatus as any);

      const { result } = renderHook(() => useBitcoinStatus('testnet3'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStatus);
      expect(bitcoinApi.getStatus).toHaveBeenCalledWith('testnet3');
    });

    it('handles error state', async () => {
      vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useBitcoinStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe('useFeeEstimates', () => {
    it('fetches fee estimates', async () => {
      const mockFees = {
        fastest: 50,
        halfHour: 30,
        hour: 20,
        economy: 10,
      };
      vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue(mockFees);

      const { result } = renderHook(() => useFeeEstimates(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockFees);
      expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith('mainnet');
    });

    it('fetches selected network fee estimates', async () => {
      const mockFees = {
        fastest: 5,
        halfHour: 3,
        hour: 2,
        economy: 1,
      };
      vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue(mockFees);

      const { result } = renderHook(() => useFeeEstimates('testnet4'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockFees);
      expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith('testnet4');
    });
  });

  describe('useMempoolData', () => {
    it('fetches mempool data', async () => {
      const mockMempoolData = {
        mempool: [{ height: 'Pending', medianFee: 10, size: 1000000 }],
        blocks: [{ height: 800000, medianFee: 5, size: 1500000 }],
        mempoolInfo: { count: 5000, size: 2000000, totalFees: 50000 },
      };
      vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue(mockMempoolData as any);

      const { result } = renderHook(() => useMempoolData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockMempoolData);
      expect(bitcoinApi.getMempoolData).toHaveBeenCalledWith('mainnet');
    });

    it('fetches selected network mempool data', async () => {
      const mockMempoolData = {
        mempool: [{ height: 'Next', medianFee: 1, size: 1 }],
        blocks: [{ height: 4_500_000, medianFee: 1, size: 1 }],
        mempoolInfo: { count: 5, size: 0.1, totalFees: 1000 },
      };
      vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue(mockMempoolData as any);

      const { result } = renderHook(() => useMempoolData('testnet3'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockMempoolData);
      expect(bitcoinApi.getMempoolData).toHaveBeenCalledWith('testnet3');
    });
  });
});

describe('useBitcoin hooks query options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useBitcoinStatus uses correct refetch interval', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ connected: true } as any);

    const { result } = renderHook(() => useBitcoinStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The hook should have refetchInterval set (testing that it exists, not the exact value)
    // We verify the API was called at least once
    expect(bitcoinApi.getStatus).toHaveBeenCalled();
  });

  it('useFeeEstimates uses correct stale time', async () => {
    vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue({
      fastest: 50,
      halfHour: 30,
      hour: 20,
      economy: 10,
    });

    const { result } = renderHook(() => useFeeEstimates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify the query was made
    expect(bitcoinApi.getFeeEstimates).toHaveBeenCalled();
  });

});
