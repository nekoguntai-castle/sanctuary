import { getDeviceIcon, getWalletIcon } from '../../ui/CustomIcons';
import { WalletType, isMultisigType } from '../../../types';
import type { Device as ApiDevice } from '../../../api/devices';
import type { Wallet as ApiWallet } from '../../../api/wallets';
import type { SubNavItemProps } from '../types';
import {
  getWalletSyncPresentation,
  type WalletSyncTone,
} from '../../../utils/walletSyncPresentation';

export const getSortedWallets = (wallets: ApiWallet[]) =>
  [...wallets].sort((first, second) => first.name.localeCompare(second.name));

export const getSortedDevices = (devices: ApiDevice[]) =>
  [...devices].sort((first, second) => first.label.localeCompare(second.label));

const SYNC_TONE_DOTS: Record<WalletSyncTone, NonNullable<SubNavItemProps['statusDot']>> = {
  syncing: 'syncing',
  resyncing: 'resyncing',
  retrying: 'retrying',
  success: 'synced',
  stale: 'stale',
  failed: 'error',
  partial: 'stale',
  cached: 'pending',
  never: 'pending',
  unknown: 'error',
};

export const getWalletSyncStatus = (wallet: ApiWallet): SubNavItemProps['statusDot'] =>
  SYNC_TONE_DOTS[getWalletSyncPresentation(wallet).tone];

/**
 * Title for the sync dot. It used to echo the enum word the dot had already
 * collapsed everything into ("pending"), which told the reader nothing they
 * could act on.
 */
export const getWalletSyncTitle = (wallet: ApiWallet): string =>
  getWalletSyncPresentation(wallet).description;

const getWalletType = (wallet: ApiWallet) =>
  isMultisigType(wallet.type) ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

const getWalletColor = (wallet: ApiWallet, active: boolean) => {
  const isMultisig = isMultisigType(wallet.type);

  if (active) {
    return isMultisig
      ? 'text-warning-700'
      : 'text-success-700';
  }

  return isMultisig ? 'text-warning-500' : 'text-success-500';
};

export const getWalletActiveColor = (wallet: ApiWallet) => getWalletColor(wallet, true);

export const renderWalletIcon = (wallet: ApiWallet) =>
  getWalletIcon(getWalletType(wallet), `w-3 h-3 ${getWalletColor(wallet, false)}`);

export const renderDeviceIcon = (device: ApiDevice) =>
  getDeviceIcon(device.type, 'w-3 h-3 text-sanctuary-400');
