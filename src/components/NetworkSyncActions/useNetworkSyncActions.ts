import { useState } from 'react';
import type { TabNetwork } from '../NetworkTabs';
import * as syncApi from '../../api/sync';
import { formatNetworkTitle } from '../../app/networks';
import { extractErrorMessage } from '../../utils/errorHandler';
import type {
  NetworkSyncActionState,
  NetworkSyncResult,
  NetworkSyncWallet,
} from './types';

interface UseNetworkSyncActionsParams {
  network: TabNetwork;
  walletCount: number;
  /** Used to name the wallets a batch could not queue. */
  wallets?: NetworkSyncWallet[];
  onSyncStarted?: () => void;
}

const SYNC_RESULT_TIMEOUT_MS = 5000;
const RESYNC_RESULT_TIMEOUT_MS = 8000;

const REJECTION_REASONS: Record<string, string> = {
  queue_unavailable: 'queue unavailable',
  queue_error: 'queue error',
};

const createSyncSuccessResult = (queued: number): NetworkSyncResult => ({
  type: 'success',
  message: `Queued ${queued} wallet${queued !== 1 ? 's' : ''} for sync`,
});

/**
 * Describe the outcome of a per-network full resync.
 *
 * Two things used to go wrong here. The hook was handed only `.length`, so the
 * wallet ids and the rejection reasons the API already returns were discarded
 * before anything could name them; and every outcome was typed `'success'`, so
 * "Queued 0 wallets for resync; 3 already queued" rendered in the same green as
 * a batch that actually ran.
 */
const createResyncResult = (
  response: syncApi.NetworkResyncResult,
  nameOf: (walletId: string) => string,
): NetworkSyncResult => {
  const accepted = response.acceptedWalletIds.length;
  const list = (walletIds: string[]) => walletIds.map(nameOf).join(', ');

  const details = [
    ...(response.deduplicatedWalletIds.length > 0
      ? [`${response.deduplicatedWalletIds.length} already queued: ${list(response.deduplicatedWalletIds)}`]
      : []),
    ...(response.rejectedWallets.length > 0
      ? [
          `${response.rejectedWallets.length} rejected: ${response.rejectedWallets
            .map((rejected) => `${nameOf(rejected.walletId)} (${REJECTION_REASONS[rejected.reason] ?? rejected.reason})`)
            .join(', ')}`,
        ]
      : []),
    ...(response.indeterminateWallets.length > 0
      ? [
          `${response.indeterminateWallets.length} queue state unknown: ${list(
            response.indeterminateWallets.map((wallet) => wallet.walletId),
          )}`,
        ]
      : []),
    // Wallets the user can see in this tab but that no network resync reaches.
    // They were never in the batch, so a count that omits them is a lie.
    ...(response.excludedWallets.length > 0
      ? [
          `${response.excludedWallets.length} not on a syncable network: ${list(
            response.excludedWallets.map((wallet) => wallet.walletId),
          )}`,
        ]
      : []),
  ];
  const suffix = details.length > 0 ? `; ${details.join('; ')}.` : '.';

  const type: NetworkSyncResult['type'] =
    response.rejectedWallets.length > 0
      ? 'error'
      : accepted === 0 ||
          response.indeterminateWallets.length > 0 ||
          response.excludedWallets.length > 0
        ? 'warning'
        : 'success';

  return {
    type,
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
  wallets = [],
  onSyncStarted,
}: UseNetworkSyncActionsParams): NetworkSyncActionState => {
  const [syncing, setSyncing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [showResyncDialog, setShowResyncDialog] = useState(false);
  const [result, setResult] = useState<NetworkSyncResult | null>(null);

  // An id the caller does not know about is still better named by its id than
  // dropped from the message entirely.
  const nameOf = (walletId: string) =>
    wallets.find((wallet) => wallet.id === walletId)?.name ?? walletId;

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

    let outcome: NetworkSyncResult;
    try {
      outcome = createResyncResult(await syncApi.resyncNetworkWallets(network), nameOf);
      onSyncStarted?.();
    } catch (error) {
      outcome = createErrorResult(error, 'Failed to resync wallets');
    }

    setResult(outcome);
    setResyncing(false);
    // A partial failure is the one result the user most needs to read, and the
    // only one they cannot reproduce by clicking again. It stays until dismissed.
    if (outcome.type === 'success') {
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
