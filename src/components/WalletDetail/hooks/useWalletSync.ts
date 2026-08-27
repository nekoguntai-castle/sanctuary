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

const describeSyncRequest = (
  result: syncApi.WalletSyncRequestResult,
): { title: string; warning: boolean } => {
  if (result.status === "merged") {
    return { title: "Sync Request Merged", warning: true };
  }
  if (result.wakeup === "enqueued") {
    return { title: "Sync Requested", warning: false };
  }
  return {
    title: result.wakeup === "unavailable"
      ? "Sync Request Saved"
      : "Sync Request Deferred",
    warning: true,
  };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletSyncParams {
  /** Wallet ID to operate on */
  walletId: string | undefined;
  ownershipKey?: string;
  /** Callback invoked after a successful sync / repair to reload wallet data */
  onDataRefresh: () => Promise<void>;
  syncState?: {
    syncStateVersion?: number;
    requestedIncrementalSyncGeneration?: number;
    processedIncrementalSyncGeneration?: number;
    requestedFullResyncGeneration?: number;
    processedFullResyncGeneration?: number;
  } | null;
}

export interface AcceptedSyncIntent {
  kind: "incremental" | "full_resync";
  generation: number;
}

interface AcceptedSyncRequest {
  intent: AcceptedSyncIntent;
  baseline: {
    requested: number;
    processed: number;
    stateVersion: number;
  };
}

function syncSnapshot(
  kind: AcceptedSyncIntent["kind"],
  syncState: UseWalletSyncParams["syncState"],
) {
  return {
    requested: kind === "full_resync"
      ? syncState?.requestedFullResyncGeneration ?? -1
      : syncState?.requestedIncrementalSyncGeneration ?? -1,
    processed: kind === "full_resync"
      ? syncState?.processedFullResyncGeneration ?? -1
      : syncState?.processedIncrementalSyncGeneration ?? -1,
    stateVersion: syncState?.syncStateVersion ?? -1,
  };
}

function isAcceptedRequestAcknowledged(
  accepted: AcceptedSyncRequest,
  syncState: UseWalletSyncParams["syncState"],
): boolean {
  if (!syncState) return false;
  const observed = syncSnapshot(accepted.intent.kind, syncState);
  const reached = observed.requested >= accepted.intent.generation
    || observed.processed >= accepted.intent.generation;
  const advanced = observed.requested > accepted.baseline.requested
    || observed.processed > accepted.baseline.processed
    || observed.stateVersion > accepted.baseline.stateVersion;
  return reached && advanced;
}

export interface UseWalletSyncReturn {
  requestSubmitting: boolean;
  acceptedIntent: AcceptedSyncIntent | null;
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
  syncState,
}: UseWalletSyncParams): UseWalletSyncReturn {
  const { handleError, showSuccess, showWarning } = useErrorHandler();
  const ownership = useWalletRouteOwnership(ownershipKey);

  const [syncing, setSyncing] = useState(false);
  const [acceptedRequest, setAcceptedRequest] = useState<AcceptedSyncRequest | null>(null);
  const acceptedIntent = acceptedRequest?.intent ?? null;
  const [syncRetryInfo, setSyncRetryInfo] = useState<SyncRetryInfo | null>(
    null,
  );

  useLayoutEffect(() => {
    setSyncing(false);
    setAcceptedRequest(null);
    setSyncRetryInfo(null);
  }, [ownershipKey]);

  useLayoutEffect(() => {
    if (acceptedRequest && isAcceptedRequestAcknowledged(acceptedRequest, syncState)) {
      setAcceptedRequest(null);
    }
  }, [acceptedRequest, syncState]);

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
      const intent = { kind: "incremental", generation: result.generation } as const;
      setAcceptedRequest({ intent, baseline: syncSnapshot(intent.kind, syncState) });
      const notification = describeSyncRequest(result);
      if (notification.warning) {
        showWarning(result.message, notification.title);
      } else {
        showSuccess(result.message, notification.title);
      }
      // Admission succeeded even if this best-effort status refresh does not.
      try {
        await onDataRefresh();
      } catch (refreshError) {
        log.warn("Sync request accepted but status refresh failed", { error: refreshError });
        if (owns(token, id)) {
          showWarning(
            "The sync request was accepted, but its latest status could not be refreshed yet.",
            "Sync Status Not Refreshed",
          );
        }
      }
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
      const intent = { kind: "full_resync", generation: result.generation } as const;
      setAcceptedRequest({ intent, baseline: syncSnapshot(intent.kind, syncState) });
      // A green "Resync Queued" for a `deduplicated` response is why a wallet
      // whose dedup key never clears looks like it resyncs on every click and
      // never changes. The two outcomes must not look alike.
      if (result.status === "deduplicated") {
        showWarning(result.message, "Resync Already Queued");
      } else if (result.wakeup === "unavailable") {
        showWarning(result.message, "Resync Request Saved");
      } else {
        showSuccess(result.message, "Resync Queued");
      }
      try {
        await onDataRefresh();
      } catch (refreshError) {
        log.warn("Resync request accepted but status refresh failed", { error: refreshError });
        if (owns(token, id)) {
          showWarning(
            "The full-resync request was accepted, but its latest status could not be refreshed yet.",
            "Sync Status Not Refreshed",
          );
        }
      }
    } catch (err) {
      log.error("Failed to resync wallet", { error: err });
      if (owns(token, id)) handleError(err, "Resync Failed");
    } finally {
      if (owns(token, id)) setSyncing(false);
    }
  };

  return {
    requestSubmitting: syncing,
    acceptedIntent,
    syncing,
    setSyncing,
    syncRetryInfo,
    setSyncRetryInfo,
    handleSync,
    handleFullResync,
  };
}
