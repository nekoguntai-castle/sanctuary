import { RefreshCw } from 'lucide-react';
import type {
  WalletSyncPresentation,
  WalletSyncRetryDetail,
  WalletSyncSubject,
} from './walletSyncPresentationTypes';
import {
  idlePresentation,
  successPresentation,
  terminalPresentation,
} from './walletSyncSettledStates';

/**
 * One reading of a wallet's sync state, shared by every surface that shows it.
 *
 * Five surfaces used to re-derive this independently — the wallet-detail badge,
 * the dashboard row, the wallet table cell, the grid card and the sidebar dot —
 * and all five got it wrong differently. The worst of it: `'resyncing'`, which
 * `resyncRepository` writes the moment a full resync deletes the transaction
 * history, was handled by none of them and fell through to "Never synced".
 *
 * The settled readings live in `walletSyncSettledStates.ts`; this module owns
 * the in-flight ones and the precedence between them.
 */

export type {
  WalletSyncPresentation,
  WalletSyncRetryDetail,
  WalletSyncSubject,
  WalletSyncTone,
} from './walletSyncPresentationTypes';
export { STALE_SYNC_THRESHOLD_MS } from './walletSyncSettledStates';

function resyncingPresentation(
  wallet: WalletSyncSubject,
): WalletSyncPresentation {
  // `resyncRepository` sets `syncInProgress: true` in the same update, so an
  // in-flight resync would otherwise read as a plain "Syncing" and a resync
  // stranded by a reaper would read as "Never synced" — for a wallet whose
  // history was just deleted. Both deserve their own wording.
  const running = wallet.syncInProgress === true;
  const reason =
    wallet.lastSyncError ||
    (running
      ? 'Full resync in progress: transaction history was cleared and is being rebuilt.'
      : 'A full resync was started but is no longer running. Transaction history may be incomplete until it is re-run.');

  return {
    tone: 'resyncing',
    label: 'Resyncing',
    reason,
    description: reason,
    icon: RefreshCw,
    spinning: running,
  };
}

function retryingPresentation(
  wallet: WalletSyncSubject,
  retry: WalletSyncRetryDetail | null,
): WalletSyncPresentation {
  // No attempt count without live metadata. The old default of "1/3" was shown
  // on every page load, where the real attempt number is simply unknown.
  const reason =
    retry?.error ||
    wallet.lastSyncError ||
    'The last sync attempt failed and is being retried.';

  return {
    tone: 'retrying',
    label: retry ? `Retrying ${retry.retryCount}/${retry.maxRetries}` : 'Retrying',
    reason,
    description: reason,
    icon: RefreshCw,
    spinning: true,
  };
}

function syncingPresentation(): WalletSyncPresentation {
  return {
    tone: 'syncing',
    label: 'Syncing',
    reason: null,
    description: 'Syncing in progress…',
    icon: RefreshCw,
    spinning: true,
  };
}

/** Statuses that describe a settled, non-successful outcome. */
const TERMINAL_PRESENTATIONS: Record<
  string,
  { tone: 'failed' | 'partial' | 'unknown'; label: string; description: string }
> = {
  failed: {
    tone: 'failed',
    label: 'Failed',
    description: 'The last sync attempt failed.',
  },
  partial: {
    tone: 'partial',
    label: 'Partial',
    description: 'The last sync completed only part of the wallet.',
  },
};

/**
 * Describe a wallet's sync state.
 *
 * Precedence is deliberate: `'resyncing'` and `'retrying'` outrank the raw
 * `syncInProgress` flag because both are strictly more specific than "Syncing"
 * and both still convey activity.
 *
 * `now` is injectable so callers and tests can pin the staleness clock.
 */
export function getWalletSyncPresentation(
  wallet: WalletSyncSubject,
  syncRetryInfo: WalletSyncRetryDetail | null = null,
  now: number = Date.now(),
): WalletSyncPresentation {
  const status = wallet.lastSyncStatus;

  if (status === 'resyncing') return resyncingPresentation(wallet);
  if (status === 'retrying' || syncRetryInfo) {
    return retryingPresentation(wallet, syncRetryInfo);
  }
  if (wallet.syncInProgress) return syncingPresentation();
  if (status === 'success') return successPresentation(wallet, now);
  if (!status) return idlePresentation(wallet);

  const terminal = TERMINAL_PRESENTATIONS[status];
  // `'partial'` is the only legacy value in the union with no server writer;
  // anything else reaching here is a status this build does not know about.
  return terminal
    ? terminalPresentation(terminal.tone, terminal.label, terminal.description, wallet)
    : terminalPresentation(
        'unknown',
        'Unknown',
        `Unrecognised sync status "${status}".`,
        wallet,
      );
}
