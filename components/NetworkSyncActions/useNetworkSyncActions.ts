import { useState } from 'react';
import type { TabNetwork } from '../NetworkTabs';
import * as syncApi from '../../src/api/sync';
import { extractErrorMessage } from '../../utils/errorHandler';
import type { NetworkSyncActionState, NetworkSyncResult } from './types';

interface UseNetworkSyncActionsParams {
  network: TabNetwork;
  walletCount: number;
  onSyncStarted?: () => void;
}

const SYNC_RESULT_TIMEOUT_MS = 5000;
const RESYNC_RESULT_TIMEOUT_MS = 8000;

const getNetworkLabel = (network: TabNetwork) => (
  network.charAt(0).toUpperCase() + network.slice(1)
);

const createSyncSuccessResult = (queued: number): NetworkSyncResult => ({
  type: 'success',
  message: `Queued ${queued} wallet${queued !== 1 ? 's' : ''} for sync`,
});

const createResyncSuccessResult = (
  deletedTransactions: number,
  queued: number
): NetworkSyncResult => ({
  type: 'success',
  message: `Cleared ${deletedTransactions} transactions. Queued ${queued} wallet${queued !== 1 ? 's' : ''} for resync.`,
});

const createErrorResult = (error: unknown, fallback: string): NetworkSyncResult => ({
  type: 'error',
  message: extractErrorMessage(error, fallback),
});

export const useNetworkSyncActions = ({
  network,
  walletCount,
  onSyncStarted,
}: UseNetworkSyncActionsParams): NetworkSyncActionState => {
  const [syncing, setSyncing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [showResyncDialog, setShowResyncDialog] = useState(false);
  const [result, setResult] = useState<NetworkSyncResult | null>(null);

  const handleSyncAll = async () => {
    setSyncing(true);
    setResult(null);

    try {
      const response = await syncApi.syncNetworkWallets(network);
      setResult(createSyncSuccessResult(response.queued));
      onSyncStarted?.();
    } catch (error) {
      setResult(createErrorResult(error, 'Failed to queue wallets for sync'));
    } finally {
      setSyncing(false);
      setTimeout(() => setResult(null), SYNC_RESULT_TIMEOUT_MS);
    }
  };

  const handleResyncAll = async () => {
    setShowResyncDialog(false);
    setResyncing(true);
    setResult(null);

    try {
      const response = await syncApi.resyncNetworkWallets(network);
      setResult(createResyncSuccessResult(response.deletedTransactions, response.queued));
      onSyncStarted?.();
    } catch (error) {
      setResult(createErrorResult(error, 'Failed to resync wallets'));
    } finally {
      setResyncing(false);
      setTimeout(() => setResult(null), RESYNC_RESULT_TIMEOUT_MS);
    }
  };

  return {
    networkLabel: getNetworkLabel(network),
    syncing,
    resyncing,
    showResyncDialog,
    result,
    isDisabled: walletCount === 0,
    handleSyncAll,
    handleResyncAll,
    openResyncDialog: () => setShowResyncDialog(true),
    closeResyncDialog: () => setShowResyncDialog(false),
  };
};
