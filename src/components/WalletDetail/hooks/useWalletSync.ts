/**
 * useWalletSync Hook
 *
 * Manages wallet synchronisation state and actions.
 * Extracted from WalletDetail.tsx to isolate sync-related concerns.
 */

import { useLayoutEffect, useState } from "react";
import * as syncApi from "../../../api/sync";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import { createLogger } from "../../../utils/logger";
import type { SyncRetryInfo } from "../types";
import type { RouteToken } from '../../../hooks/requestOwnership';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';

const log = createLogger("useWalletSync");
const NETWORK_SYNC_OFF_PATTERN = /sync is off in Node Configuration/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletSyncParams {
  /** Wallet ID to operate on */
  walletId: string | undefined;
  ownershipKey?: string;
  /** Callback invoked after a successful sync / repair to reload wallet data */
  onDataRefresh: () => Promise<void>;
}

export interface UseWalletSyncReturn {
  /** Whether a sync or resync is currently in progress */
  syncing: boolean;
  setSyncing: (v: boolean) => void;
  /** Retry information shown during sync retries */
  syncRetryInfo: SyncRetryInfo | null;
  setSyncRetryInfo: (info: SyncRetryInfo | null) => void;
  /** Trigger an immediate sync */
  handleSync: () => Promise<void>;
  /** Trigger a full resync (clears history and re-syncs) */
  handleFullResync: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletSync({
  walletId,
  ownershipKey = walletId ?? '',
  onDataRefresh,
}: UseWalletSyncParams): UseWalletSyncReturn {
  const { handleError, showSuccess, showWarning } = useErrorHandler();
  const ownership = useWalletRouteOwnership(ownershipKey);

  const [syncing, setSyncing] = useState(false);
  const [syncRetryInfo, setSyncRetryInfo] = useState<SyncRetryInfo | null>(
    null,
  );

  useLayoutEffect(() => {
    setSyncing(false);
    setSyncRetryInfo(null);
  }, [ownershipKey]);

  const owns = (token: RouteToken, id: string) => (
    id === walletId && ownership.isRouteOwner(token)
  );

  // Immediate sync using sync API
  const handleSync = async () => {
    if (!walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;

    try {
      setSyncing(true);
      const result = await syncApi.syncWallet(id);
      if (!owns(token, id)) return;
      if (!result.success && result.error) {
        log.error("Sync error", { error: result.error });
        // The pattern selects the *title*, not whether the user is told at all.
        // Every other failure used to reach `log.error` and nowhere else.
        showWarning(
          result.error,
          NETWORK_SYNC_OFF_PATTERN.test(result.error)
            ? "Wallet Sync Off"
            : "Sync Failed",
        );
      }
      // Reload wallet data after sync
      await onDataRefresh();
    } catch (err) {
      log.error("Failed to sync wallet", { error: err });
      if (owns(token, id)) handleError(err, "Sync Failed");
    } finally {
      if (owns(token, id)) setSyncing(false);
    }
  };

  // Full resync - clears transactions and re-syncs from blockchain
  const handleFullResync = async () => {
    if (!walletId) return;
    const id = walletId;

    if (
      !confirm(
        "This will clear all transaction history and re-sync from the blockchain. This is useful if transactions are missing. Continue?",
      )
    ) {
      return;
    }
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;

    try {
      setSyncing(true);
      const result = await syncApi.resyncWallet(id);
      if (!owns(token, id)) return;
      // A green "Resync Queued" for a `deduplicated` response is why a wallet
      // whose dedup key never clears looks like it resyncs on every click and
      // never changes. The two outcomes must not look alike.
      if (result.status === "deduplicated") {
        showWarning(result.message, "Resync Already Queued");
      } else {
        showSuccess(result.message, "Resync Queued");
      }
      // Reload wallet data after resync is queued
      await onDataRefresh();
    } catch (err) {
      log.error("Failed to resync wallet", { error: err });
      if (owns(token, id)) handleError(err, "Resync Failed");
    } finally {
      if (owns(token, id)) setSyncing(false);
    }
  };

  return {
    syncing,
    setSyncing,
    syncRetryInfo,
    setSyncRetryInfo,
    handleSync,
    handleFullResync,
  };
}
