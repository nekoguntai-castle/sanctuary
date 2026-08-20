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

/**
 * How old a successful sync may be before its green check becomes a lie.
 *
 * The server re-queues any wallet whose last sync is older than
 * `SYNC_STALE_THRESHOLD_MS` (10 minutes by default), so an hour without a
 * successful sync means six consecutive cycles did not run for this wallet —
 * exactly the state that used to render as a healthy "Synced".
 */
export const STALE_SYNC_THRESHOLD_MS = 60 * 60 * 1000;

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
 * A wallet whose last sync succeeded — demoted to a `stale` tone once that
 * success is old enough that the green check would be misleading.
 */
export function successPresentation(
  wallet: WalletSyncSubject,
  now: number,
): WalletSyncPresentation {
  const syncedAt = parsedTime(wallet.lastSyncedAt);

  // A missing timestamp is not evidence of staleness — a wallet can report a
  // successful sync before the column is populated. Only a timestamp we can
  // read and that is genuinely old demotes the badge.
  if (wallet.lastSyncedAt && (syncedAt === null || now - syncedAt > STALE_SYNC_THRESHOLD_MS)) {
    const reason = syncedAt === null
      ? 'The last recorded sync time cannot be read, and no sync has succeeded since.'
      : `Last synced ${localTime(wallet.lastSyncedAt)}, and no sync has succeeded since.`;
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
