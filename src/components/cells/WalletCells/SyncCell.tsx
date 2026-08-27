import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import {
  getWalletSyncPresentation,
  type WalletSyncTone,
} from '../../../utils/walletSyncPresentation';
import type { WalletCellProps, WalletWithPending } from './types';

// Semantics (tone, label, reason) come from `getWalletSyncPresentation`; the
// glyphs stay local because the wallet table has always used the outline
// circle set, and matching it is not worth a visual regression elsewhere.
const TONE_ICONS: Record<WalletSyncTone, LucideIcon> = {
  syncing: RefreshCw,
  resyncing: RefreshCw,
  retrying: RefreshCw,
  success: CheckCircle,
  stale: Clock,
  failed: AlertCircle,
  partial: Clock,
  cached: Clock,
  never: Clock,
  unknown: AlertCircle,
};

// `success`, `warning` and `sent` invert per mode and declare no 300/400
// shade, so the base class is correct in both; `rose` is standard Tailwind and
// keeps its explicit dark variant.
const TONE_CLASSES: Record<WalletSyncTone, string> = {
  syncing: 'text-primary-600 dark:text-primary-400',
  resyncing: 'text-primary-600 dark:text-primary-400',
  retrying: 'text-warning-600',
  success: 'text-success-600',
  stale: 'text-warning-600',
  failed: 'text-rose-600 dark:text-rose-400',
  partial: 'text-warning-600',
  cached: 'text-sanctuary-400',
  never: 'text-sanctuary-400',
  unknown: 'text-warning-600',
};

// The wallet table is the comparison surface — the one place a user sees every
// wallet's sync state side by side — so it keeps its visible text label and
// gains the reason behind it rather than trading one for the other.
const TONE_LABELS: Partial<Record<WalletSyncTone, string>> = {
  cached: 'Pending',
  never: 'Pending',
};

function SyncStatusIndicator({ wallet, syncNow }: { wallet: WalletWithPending; syncNow?: number }) {
  const presentation = getWalletSyncPresentation(wallet, null, syncNow);
  const Icon = TONE_ICONS[presentation.tone];
  const label = TONE_LABELS[presentation.tone] ?? presentation.label;

  return (
    <Tooltip
      content={presentation.reason}
      label={`Sync status: ${label}`}
      placement="bottom"
    >
      <span
        className={`inline-flex items-center gap-1.5 text-xs ${TONE_CLASSES[presentation.tone]}`}
      >
        <Icon
          className={`w-3.5 h-3.5 ${presentation.spinning ? 'animate-spin' : ''}`}
        />
        {label}
      </span>
    </Tooltip>
  );
}

export function SyncCell({ item: wallet, syncNow }: WalletCellProps & { syncNow?: number }) {
  return <SyncStatusIndicator wallet={wallet} syncNow={syncNow} />;
}
