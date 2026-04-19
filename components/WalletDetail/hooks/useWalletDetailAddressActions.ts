import { useCallback } from 'react';
import * as transactionsApi from '../../../src/api/transactions';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';

const log = createLogger('WalletDetail');

export function useWalletDetailAddressActions({
  walletId,
  loadingAddresses,
  hasMoreAddresses,
  loadAddresses,
  loadAddressSummary,
  addressOffset,
  addressPageSize,
  handleError,
}: {
  walletId: string | undefined;
  loadingAddresses: boolean;
  hasMoreAddresses: boolean;
  loadAddresses: (walletId: string, limit: number, offset: number, reset: boolean) => Promise<void>;
  loadAddressSummary: (walletId: string) => Promise<void>;
  addressOffset: number;
  addressPageSize: number;
  handleError: (error: unknown, title?: string) => void;
}) {
  const handleLoadMoreAddressPage = useCallback(async () => {
    if (!walletId || loadingAddresses || !hasMoreAddresses) return;
    await loadAddresses(walletId, addressPageSize, addressOffset, false);
  }, [walletId, loadingAddresses, hasMoreAddresses, loadAddresses, addressPageSize, addressOffset]);

  const handleGenerateMoreAddresses = useCallback(async () => {
    if (!walletId) return;

    try {
      await transactionsApi.generateAddresses(walletId, 10);
      await loadAddressSummary(walletId);
      await loadAddresses(walletId, addressPageSize, 0, true);
    } catch (err) {
      logError(log, err, 'Failed to generate more addresses');
      handleError(err, 'Failed to Generate Addresses');
    }
  }, [walletId, loadAddressSummary, loadAddresses, addressPageSize, handleError]);

  const handleFetchUnusedAddresses = useCallback(async (wId: string) => {
    const unusedReceive = await transactionsApi.getAddresses(wId, { used: false, change: false, limit: 10 });
    if (unusedReceive.length > 0) return unusedReceive;
    await transactionsApi.generateAddresses(wId, 10);
    return transactionsApi.getAddresses(wId, { used: false, change: false, limit: 10 });
  }, []);

  return {
    handleLoadMoreAddressPage,
    handleGenerateMoreAddresses,
    handleFetchUnusedAddresses,
  };
}
