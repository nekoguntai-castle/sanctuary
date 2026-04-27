import { WalletType } from '../../types';

interface WalletFilterContext {
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
}

interface WalletCountDevice {
  id: string;
  walletCount?: number;
  wallets?: unknown[];
  isOwner?: boolean;
}

export function getAccountBadgeClass(purpose: string): string {
  const isMultisig = purpose === 'multisig';
  return isMultisig
    ? 'bg-warning-600 text-white dark:bg-warning-100 dark:text-warning-700'
    : 'bg-success-600 text-white dark:bg-success-100 dark:text-success-700';
}

export function getWalletBadgeClass(walletType: string): string {
  const isMultisig = walletType === 'multi_sig' || walletType === WalletType.MULTI_SIG;
  return isMultisig
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
}

export function getDeviceWalletCount(device: WalletCountDevice): number {
  return device.walletCount ?? device.wallets?.length ?? 0;
}

export function hasExclusiveBadge(
  filterContext: WalletFilterContext | undefined,
  deviceId: string
): boolean {
  return Boolean(
    filterContext
      && filterContext.walletFilter !== 'all'
      && filterContext.walletFilter !== 'unassigned'
      && filterContext.exclusiveDeviceIds.has(deviceId)
  );
}

export function canDeleteDevice(device: WalletCountDevice): boolean {
  return Boolean(device.isOwner && getDeviceWalletCount(device) === 0);
}
