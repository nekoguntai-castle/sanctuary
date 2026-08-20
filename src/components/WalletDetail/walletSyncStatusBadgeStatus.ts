import type { LucideIcon } from "lucide-react";
import type { Wallet } from "../../types";
import {
  getWalletSyncPresentation,
  type WalletSyncTone,
} from "../../utils/walletSyncPresentation";
import type { SyncRetryInfo } from "./types";

export interface StatusDescriptor {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  /** Tooltip text: the failure reason where one exists, otherwise the state. */
  detail: string;
  className: string;
}

const BASE_BADGE =
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium";
const SPINNING_ICON = "w-3 h-3 mr-1 animate-spin";
const STATIC_ICON = "w-3 h-3 mr-1";

// `warning`, `success` and `sent` invert per mode and declare no 300/400 shade,
// so the base class is correct in both modes and the `dark:` entries here stay
// on the opacity variants of shade 500, which every theme emits.
const TONE_CLASSES: Record<WalletSyncTone, string> = {
  syncing:
    "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30",
  resyncing:
    "bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20",
  retrying:
    "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  success:
    "bg-success-100 text-success-700 border border-success-200 dark:bg-success-500/10 dark:border-success-500/20",
  stale:
    "bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20",
  failed:
    "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
  partial:
    "bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20",
  cached:
    "bg-sanctuary-100 text-sanctuary-600 border border-sanctuary-200 dark:bg-sanctuary-800 dark:text-sanctuary-400 dark:border-sanctuary-700",
  never:
    "bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20",
  unknown:
    "bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20",
};

export function getWalletSyncStatusDescriptor(
  wallet: Wallet,
  syncing: boolean,
  syncRetryInfo: SyncRetryInfo | null,
): StatusDescriptor {
  // `syncing` is the local optimistic flag set the moment the user clicks Sync;
  // the persisted column catches up a request later.
  const presentation = getWalletSyncPresentation(
    { ...wallet, syncInProgress: syncing || wallet.syncInProgress },
    syncRetryInfo,
  );

  return {
    icon: presentation.icon,
    iconClassName: presentation.spinning ? SPINNING_ICON : STATIC_ICON,
    label: presentation.label,
    detail: presentation.description,
    className: `${BASE_BADGE} ${TONE_CLASSES[presentation.tone]}`,
  };
}
