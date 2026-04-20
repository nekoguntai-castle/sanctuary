import { getDeviceIcon, getWalletIcon } from '../../ui/CustomIcons';
import { WalletType, isMultisigType } from '../../../types';
import type { Device as ApiDevice } from '../../../src/api/devices';
import type { Wallet as ApiWallet } from '../../../src/api/wallets';
import type { SubNavItemProps } from '../types';

export const getSortedWallets = (wallets: ApiWallet[]) =>
  [...wallets].sort((first, second) => first.name.localeCompare(second.name));

export const getSortedDevices = (devices: ApiDevice[]) =>
  [...devices].sort((first, second) => first.label.localeCompare(second.label));

export const getWalletSyncStatus = (wallet: ApiWallet): SubNavItemProps['statusDot'] => {
  if (wallet.syncInProgress) return 'syncing';
  if (wallet.lastSyncStatus === 'success') return 'synced';
  if (wallet.lastSyncStatus === 'failed') return 'error';
  return 'pending';
};

const getWalletType = (wallet: ApiWallet) =>
  isMultisigType(wallet.type) ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

const getWalletColor = (wallet: ApiWallet, active: boolean) => {
  const isMultisig = isMultisigType(wallet.type);

  if (active) {
    return isMultisig
      ? 'text-warning-700 dark:text-warning-400'
      : 'text-success-700 dark:text-success-400';
  }

  return isMultisig ? 'text-warning-500' : 'text-success-500';
};

export const getWalletActiveColor = (wallet: ApiWallet) => getWalletColor(wallet, true);

export const renderWalletIcon = (wallet: ApiWallet) =>
  getWalletIcon(getWalletType(wallet), `w-3 h-3 ${getWalletColor(wallet, false)}`);

export const renderDeviceIcon = (device: ApiDevice) =>
  getDeviceIcon(device.type, 'w-3 h-3 text-sanctuary-400');
