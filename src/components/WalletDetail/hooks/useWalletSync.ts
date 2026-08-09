/**
 * useWalletSync Hook
 *
 * Manages wallet synchronisation state and actions: sync, full resync, and repair.
 * Extracted from WalletDetail.tsx to isolate sync-related concerns.
 */

import { useLayoutEffect, useState } from "react";
import * as syncApi from "../../../api/sync";
import * as walletsApi from "../../../api/wallets";
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
  /** Whether a repair is currently in progress */
  repairing: boolean;
  /** Retry information shown during sync retries */
  syncRetryInfo: SyncRetryInfo | null;
  setSyncRetryInfo: (info: SyncRetryInfo | null) => void;
  /** Trigger an immediate sync */
  handleSync: () => Promise<void>;
  /** Trigger a full resync (clears history and re-syncs) */
  handleFullResync: () => Promise<void>;
  /** Repair wallet descriptor from linked devices */
  handleRepairWallet: () => Promise<void>;
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
  const [repairing, setRepairing] = useState(false);
  const [syncRetryInfo, setSyncRetryInfo] = useState<SyncRetryInfo | null>(
    null,
  );

  useLayoutEffect(() => {
    setSyncing(false);
    setRepairing(false);
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
        if (NETWORK_SYNC_OFF_PATTERN.test(result.error)) {
          showWarning(result.error, "Wallet Sync Off");
        }
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
      showSuccess(result.message, "Resync Queued");
      // Reload wallet data after resync is queued
      await onDataRefresh();
    } catch (err) {
      log.error("Failed to resync wallet", { error: err });
      if (owns(token, id)) handleError(err, "Resync Failed");
    } finally {
      if (owns(token, id)) setSyncing(false);
    }
  };

  // Repair wallet descriptor - regenerates from attached devices
  const handleRepairWallet = async () => {
    if (!walletId) return;
    const id = walletId;
    const token = ownership.captureRoute(ownershipKey);
    if (!owns(token, id)) return;

    try {
      setRepairing(true);
      const result = await walletsApi.repairWallet(id);
      if (!owns(token, id)) return;
      if (result.success) {
        showSuccess(result.message, "Repair Complete");
        await onDataRefresh();
      } else {
        handleError(new Error(result.message), "Repair Failed");
      }
    } catch (err) {
      log.error("Failed to repair wallet", { error: err });
      if (owns(token, id)) handleError(err, "Repair Failed");
    } finally {
      if (owns(token, id)) setRepairing(false);
    }
  };

  return {
    syncing,
    setSyncing,
    repairing,
    syncRetryInfo,
    setSyncRetryInfo,
    handleSync,
    handleFullResync,
    handleRepairWallet,
  };
}
