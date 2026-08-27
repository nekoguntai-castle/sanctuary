import type { LucideIcon } from 'lucide-react';
import type { SyncExecutionOwner } from '@sanctuary/shared/constants/sync';

/**
 * Shared shape for one reading of a wallet's sync state.
 *
 * Split out from `walletSyncPresentation.ts` so the settled-state builders can
 * import it without a cycle.
 */

/**
 * Structural view of the four persisted sync columns.
 *
 * Deliberately not `Wallet`: the dashboard's mapped rows, the grid card's API
 * wallet and the table's `WalletWithPending` are different shapes over the same
 * columns, and every one of them needs this helper. Same reasoning as
 * `WalletCapabilitySource` in `walletCapabilities.ts`.
 */
export interface WalletSyncSubject {
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  lastSyncedAt?: string | null;
  syncInProgress?: boolean;
  syncExecutionOwner?: SyncExecutionOwner | null;
  syncNextRetryAt?: string | null;
  syncStartedAt?: string | null;
  syncStateVersion?: number;
  requestedIncrementalSyncGeneration?: number;
  claimedIncrementalSyncGeneration?: number;
  processedIncrementalSyncGeneration?: number;
  incrementalSyncClaimedAt?: string | null;
  incrementalSyncLeaseExpiresAt?: string | null;
  syncActionRequiredAt?: string | null;
  requestedFullResyncGeneration?: number;
  preparedFullResyncGeneration?: number;
  processedFullResyncGeneration?: number;
}

/**
 * Live retry metadata pushed over the sync WebSocket. Null on every page load,
 * which is why the attempt count must never be invented from a default.
 */
export interface WalletSyncRetryDetail {
  retryCount: number;
  maxRetries: number;
  error?: string;
}

export type WalletSyncTone =
  | 'syncing'
  | 'resyncing'
  | 'retrying'
  | 'success'
  | 'stale'
  | 'failed'
  | 'partial'
  | 'cached'
  | 'never'
  | 'unknown';

export interface WalletSyncPresentation {
  tone: WalletSyncTone;
  /** Short badge text. */
  label: string;
  /**
   * Why the wallet is in this state, drawn from `lastSyncError` wherever it is
   * non-null. Null when there is nothing to explain — a healthy sync.
   */
  reason: string | null;
  /** Full sentence for a tooltip or an `aria-label`; never empty. */
  description: string;
  icon: LucideIcon;
  /** Whether the icon should spin, i.e. the wallet is actively working. */
  spinning: boolean;
}
