import { Check, AlertTriangle, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Wallet } from "../../types";
import type { SyncRetryInfo } from "./types";

export interface StatusDescriptor {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  title: string;
  className: string;
}

const BASE_BADGE =
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium";
const SPINNING_ICON = "w-3 h-3 mr-1 animate-spin";
const STATIC_ICON = "w-3 h-3 mr-1";

function lastSyncedTitle(lastSyncedAt: string | null | undefined): string {
  return lastSyncedAt
    ? `Last synced: ${new Date(lastSyncedAt).toLocaleString()}`
    : "";
}

function retryingDescriptor(
  wallet: Wallet,
  syncRetryInfo: SyncRetryInfo | null,
): StatusDescriptor | null {
  if (wallet.lastSyncStatus !== "retrying" && !syncRetryInfo) return null;
  const retryCount = syncRetryInfo?.retryCount || 1;
  const maxRetries = syncRetryInfo?.maxRetries || 3;
  return {
    icon: RefreshCw,
    iconClassName: SPINNING_ICON,
    label: `Retrying ${retryCount}/${maxRetries}`,
    title: syncRetryInfo?.error || "Sync failed, retrying...",
    className: `${BASE_BADGE} bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20`,
  };
}

function syncingDescriptor(
  wallet: Wallet,
  syncing: boolean,
): StatusDescriptor | null {
  if (!syncing && !wallet.syncInProgress) return null;
  return {
    icon: RefreshCw,
    iconClassName: SPINNING_ICON,
    label: "Syncing",
    title: "",
    className: `${BASE_BADGE} bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30`,
  };
}

function successDescriptor(wallet: Wallet): StatusDescriptor | null {
  if (wallet.lastSyncStatus !== "success") return null;
  return {
    icon: Check,
    iconClassName: STATIC_ICON,
    label: "Synced",
    title: lastSyncedTitle(wallet.lastSyncedAt),
    className: `${BASE_BADGE} bg-success-100 text-success-700 border border-success-200 dark:bg-success-500/10 dark:border-success-500/20`,
  };
}

function failedDescriptor(wallet: Wallet): StatusDescriptor | null {
  if (wallet.lastSyncStatus !== "failed") return null;
  return {
    icon: AlertTriangle,
    iconClassName: STATIC_ICON,
    label: "Failed",
    title: wallet.lastSyncError || "Last sync failed",
    className: `${BASE_BADGE} bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20`,
  };
}

function cachedDescriptor(wallet: Wallet): StatusDescriptor | null {
  if (!wallet.lastSyncedAt) return null;
  return {
    icon: Check,
    iconClassName: STATIC_ICON,
    label: "Cached",
    title: lastSyncedTitle(wallet.lastSyncedAt),
    className: `${BASE_BADGE} bg-sanctuary-100 text-sanctuary-600 border border-sanctuary-200 dark:bg-sanctuary-800 dark:text-sanctuary-400 dark:border-sanctuary-700`,
  };
}

function notSyncedDescriptor(): StatusDescriptor {
  return {
    icon: AlertTriangle,
    iconClassName: STATIC_ICON,
    label: "Not Synced",
    title: "Never synced",
    className: `${BASE_BADGE} bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:border-warning-500/20`,
  };
}

export function getWalletSyncStatusDescriptor(
  wallet: Wallet,
  syncing: boolean,
  syncRetryInfo: SyncRetryInfo | null,
): StatusDescriptor {
  return (
    retryingDescriptor(wallet, syncRetryInfo) ??
    syncingDescriptor(wallet, syncing) ??
    successDescriptor(wallet) ??
    failedDescriptor(wallet) ??
    cachedDescriptor(wallet) ??
    notSyncedDescriptor()
  );
}
