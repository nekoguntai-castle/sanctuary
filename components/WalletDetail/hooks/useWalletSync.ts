/**
 * useWalletSync Hook
 *
 * Manages wallet synchronisation state and actions: sync, full resync, and repair.
 * Extracted from WalletDetail.tsx to isolate sync-related concerns.
 */

import { useState } from "react";
import * as syncApi from "../../../src/api/sync";
import * as walletsApi from "../../../src/api/wallets";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import { createLogger } from "../../../utils/logger";
import type { SyncRetryInfo } from "../types";

const log = createLogger("useWalletSync");
const NETWORK_SYNC_OFF_PATTERN = /sync is off in Node Configuration/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletSyncParams {
  /** Wallet ID to operate on */
  walletId: string | undefined;
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
  onDataRefresh,
}: UseWalletSyncParams): UseWalletSyncReturn {
  const { handleError, showSuccess, showWarning } = useErrorHandler();

  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [syncRetryInfo, setSyncRetryInfo] = useState<SyncRetryInfo | null>(
    null,
  );

  // Immediate sync using sync API
  const handleSync = async () => {
    if (!walletId) return;

    try {
      setSyncing(true);
      const result = await syncApi.syncWallet(walletId);
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
      handleError(err, "Sync Failed");
    } finally {
      setSyncing(false);
    }
  };

  // Full resync - clears transactions and re-syncs from blockchain
  const handleFullResync = async () => {
    if (!walletId) return;

    if (
      !confirm(
        "This will clear all transaction history and re-sync from the blockchain. This is useful if transactions are missing. Continue?",
      )
    ) {
      return;
    }

    try {
      setSyncing(true);
      const result = await syncApi.resyncWallet(walletId);
      showSuccess(result.message, "Resync Queued");
      // Reload wallet data after resync is queued
      await onDataRefresh();
    } catch (err) {
      log.error("Failed to resync wallet", { error: err });
      handleError(err, "Resync Failed");
    } finally {
      setSyncing(false);
    }
  };

  // Repair wallet descriptor - regenerates from attached devices
  const handleRepairWallet = async () => {
    if (!walletId) return;

    try {
      setRepairing(true);
      const result = await walletsApi.repairWallet(walletId);
      if (result.success) {
        showSuccess(result.message, "Repair Complete");
        await onDataRefresh();
      } else {
        handleError(new Error(result.message), "Repair Failed");
      }
    } catch (err) {
      log.error("Failed to repair wallet", { error: err });
      handleError(err, "Repair Failed");
    } finally {
      setRepairing(false);
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
