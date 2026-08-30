import { AlertTriangle, Check, Clock } from 'lucide-react';
import type {
  WalletSyncPresentation,
  WalletSyncSubject,
} from './walletSyncPresentationTypes';

/**
 * Readings for a wallet that is not currently working: a completed sync, a
 * settled failure, or one that has never run. The in-flight states live in
 * `walletSyncPresentation.ts` alongside the dispatcher.
 */

function parsedTime(lastSyncedAt: string | null | undefined): number | null {
  if (!lastSyncedAt) return null;
  const parsed = new Date(lastSyncedAt).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** Absolute local timestamp, for "last synced" copy. */
export function localTime(lastSyncedAt: string): string {
  return new Date(lastSyncedAt).toLocaleString();
}

/**
 * A wallet whose last sync succeeded.
 *
 * Wallet history sync is activity-driven, so elapsed time alone is not evidence
 * that a settled success is stale. Lifecycle drift, leases, retries, and
 * action-required state are classified before this presentation is reached.
 */
export function successPresentation(wallet: WalletSyncSubject): WalletSyncPresentation {
  const syncedAt = parsedTime(wallet.lastSyncedAt);

  // A malformed recorded timestamp is inconsistent evidence. A missing
  // timestamp is permitted because completion state can be observed before the
  // timestamp column is populated.
  if (wallet.lastSyncedAt && syncedAt === null) {
    const reason = 'The last recorded sync time cannot be read.';
    return {
      tone: 'stale',
      label: 'Stale',
      reason,
      description: reason,
      icon: Clock,
      spinning: false,
    };
  }

  return {
    tone: 'success',
    label: 'Synced',
    reason: null,
    description: wallet.lastSyncedAt
      ? `Last synced: ${localTime(wallet.lastSyncedAt)}`
      : 'Synced',
    icon: Check,
    spinning: false,
  };
}

/**
 * A settled, non-successful outcome. `lastSyncError` is preferred over the
 * fallback wherever the server recorded one.
 */
export function terminalPresentation(
  tone: 'failed' | 'partial' | 'unknown',
  label: string,
  fallbackReason: string,
  wallet: WalletSyncSubject,
): WalletSyncPresentation {
  const reason = wallet.lastSyncError || fallbackReason;
  return {
    tone,
    label,
    reason,
    description: reason,
    icon: tone === 'partial' ? Clock : AlertTriangle,
    spinning: false,
  };
}

/**
 * A wallet with no recorded sync status: cached from an earlier run, or never
 * synced at all.
 */
export function idlePresentation(wallet: WalletSyncSubject): WalletSyncPresentation {
  const reason = wallet.lastSyncError || null;

  if (wallet.lastSyncedAt) {
    return {
      tone: 'cached',
      label: 'Cached',
      reason,
      description: reason || `Cached from ${localTime(wallet.lastSyncedAt)}`,
      icon: Clock,
      spinning: false,
    };
  }

  return {
    tone: 'never',
    label: 'Not Synced',
    reason,
    description: reason || 'Never synced',
    icon: AlertTriangle,
    spinning: false,
  };
}
