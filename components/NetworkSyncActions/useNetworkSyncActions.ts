import { useState } from 'react';
import type { TabNetwork } from '../NetworkTabs';
import * as syncApi from '../../src/api/sync';
import { formatNetworkTitle } from '../../src/app/networks';
import { extractErrorMessage } from '../../utils/errorHandler';
import type { NetworkSyncActionState, NetworkSyncResult } from './types';

interface UseNetworkSyncActionsParams {
  network: TabNetwork;
  walletCount: number;
  onSyncStarted?: () => void;
}

const SYNC_RESULT_TIMEOUT_MS = 5000;
const RESYNC_RESULT_TIMEOUT_MS = 8000;

const createSyncSuccessResult = (queued: number): NetworkSyncResult => ({
  type: 'success',
  message: `Queued ${queued} wallet${queued !== 1 ? 's' : ''} for sync`,
});

const createResyncSuccessResult = (
  accepted: number,
  deduplicated: number,
  rejected: number,
  indeterminate: number,
): NetworkSyncResult => {
  const details = [
    ...(deduplicated > 0 ? [`${deduplicated} already queued`] : []),
    ...(rejected > 0 ? [`${rejected} rejected`] : []),
    ...(indeterminate > 0 ? [`${indeterminate} queue state unknown`] : []),
  ];
  const suffix = details.length > 0 ? `; ${details.join('; ')}.` : '.';
  return {
    type: 'success',
    message: `Queued ${accepted} wallet${accepted !== 1 ? 's' : ''} for resync${suffix}`,
  };
};

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
      setResult(createResyncSuccessResult(
        response.acceptedWalletIds.length,
        response.deduplicatedWalletIds.length,
        response.rejectedWallets.length,
        response.indeterminateWallets.length,
      ));
      onSyncStarted?.();
    } catch (error) {
      setResult(createErrorResult(error, 'Failed to resync wallets'));
    } finally {
      setResyncing(false);
      setTimeout(() => setResult(null), RESYNC_RESULT_TIMEOUT_MS);
    }
  };

  return {
    networkLabel: formatNetworkTitle(network),
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
