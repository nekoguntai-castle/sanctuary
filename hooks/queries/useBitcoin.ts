import { useQuery, keepPreviousData } from '@tanstack/react-query';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createQueryKeys } from './factory';

// Query key factory for bitcoin-related queries
export const bitcoinKeys = {
  ...createQueryKeys('bitcoin'),
  status: (network: bitcoinApi.BitcoinStatusNetwork = 'mainnet') => ['bitcoin', 'status', network] as const,
  fees: (network: bitcoinApi.BitcoinFeeNetwork = 'mainnet') => ['bitcoin', 'fees', network] as const,
  mempool: (network: bitcoinApi.BitcoinDashboardNetwork = 'mainnet') => ['bitcoin', 'mempool', network] as const,
};

/**
 * Hook to fetch Bitcoin network status
 */
export function useBitcoinStatus(network: bitcoinApi.BitcoinStatusNetwork = 'mainnet') {
  return useQuery({
    queryKey: bitcoinKeys.status(network),
    queryFn: () => bitcoinApi.getStatus(network),
    // Refetch status every 60 seconds
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch current fee estimates
 */
export function useFeeEstimates(network: bitcoinApi.BitcoinFeeNetwork = 'mainnet') {
  return useQuery({
    queryKey: bitcoinKeys.fees(network),
    queryFn: () => bitcoinApi.getFeeEstimates(network),
    // Fees change frequently, refetch every 30 seconds
    refetchInterval: 30_000,
    // Keep stale time short for fees
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch mempool and block data for visualization
 */
export function useMempoolData(network: bitcoinApi.BitcoinDashboardNetwork = 'mainnet') {
  return useQuery({
    queryKey: bitcoinKeys.mempool(network),
    queryFn: () => bitcoinApi.getMempoolData(network),
    // Mempool changes frequently, refetch every 30 seconds
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
